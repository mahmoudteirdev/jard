use std::collections::HashSet;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::node::{flags, Node, NodeId};
use crate::progress::Progress;
use crate::sys::{self, ListError};
use crate::tree::{display_path, Tree};

/// Scan settings. Deserializes from the `start_scan` `opts` object (camelCase, all optional).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// Worker threads. 0 picks a default from the CPU count.
    pub threads: usize,
    /// Deepest folder level to list; the scanned folder is level 0. Deeper folders show as `PARTIAL`.
    pub max_depth: Option<u32>,
    /// Count each hard-linked file once. Cheap on Unix; on Windows it opens every file, so it is off by default.
    pub dedup_hardlinks: bool,
    /// Fast MFT scan for Windows NTFS drives (requires Administrator privileges).
    pub fast_mft: bool,
    /// Folders the person chose to skip. They stay listed, with nothing read under them.
    pub excluded: Vec<PathBuf>,
}

// Not derivable: dedup defaults to on for Unix, off for Windows.
#[allow(clippy::derivable_impls)]
impl Default for Options {
    fn default() -> Self {
        Options {
            threads: 0,
            max_depth: None,
            dedup_hardlinks: cfg!(unix),
            fast_mft: true,
            excluded: Vec::new(),
        }
    }
}

impl Options {
    fn worker_count(&self) -> usize {
        if self.threads > 0 {
            return self.threads;
        }
        std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(2, 16)
    }
}

/// Scans `root` on the calling thread (workers run in a thread scope) and returns the rolled-up tree.
///
/// Cancelling through `progress` returns early with what was read; unread folders are `PARTIAL`.
/// Fails only if `root` itself is missing or is not a folder.
pub fn scan(root: impl AsRef<Path>, opts: &Options, progress: &Progress) -> io::Result<Tree> {
    let root = root.as_ref();
    #[cfg(windows)]
    if opts.fast_mft && crate::mft::can_scan_mft(root) {
        if let Ok(tree) = crate::mft::scan_mft(root, opts, progress) {
            progress.finish();
            return Ok(tree);
        }
    }
    let result = scan_inner(root, opts, progress);
    progress.finish();
    result
}

fn scan_inner(root: &Path, opts: &Options, progress: &Progress) -> io::Result<Tree> {
    let started = Instant::now();
    // On Windows this gives a `\\?\` path, which lifts the 260-character limit for everything below.
    let root = std::fs::canonicalize(root)?;
    if !std::fs::metadata(&root)?.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "scan root is not a folder"));
    }

    let mut root_node = Node::new(Tree::ROOT, display_path(&root).into(), None, true);
    root_node.flags = flags::PARTIAL; // cleared once the folder is listed
    let walker = Walker {
        queue: Mutex::new(vec![Job { id: Tree::ROOT, path: root.clone(), depth: 0 }]),
        wake: Condvar::new(),
        pending: AtomicUsize::new(1),
        nodes: Mutex::new(vec![root_node]),
        seen_links: Mutex::new(HashSet::new()),
        volume: sys::Volume::for_path(&root),
        // Canonical like the root, so a folder matches however it was typed. One that's gone can't match.
        excluded: opts.excluded.iter().filter_map(|p| std::fs::canonicalize(p).ok()).collect(),
        progress,
        opts,
    };

    std::thread::scope(|s| {
        for i in 0..opts.worker_count() {
            std::thread::Builder::new()
                .name(format!("jard-scan-{i}"))
                .spawn_scoped(s, || walker.work())
                .expect("failed to start scan worker");
        }
    });

    let nodes = walker.nodes.into_inner().unwrap_or_else(|e| e.into_inner());
    Ok(Tree::build(root, nodes, started.elapsed(), progress.is_cancelled()))
}

/// A folder waiting to be listed. Its node already exists (flagged `PARTIAL`).
struct Job {
    id: NodeId,
    path: PathBuf,
    depth: u32,
}

struct Walker<'a> {
    /// LIFO, so the walk is roughly depth-first and the queue stays small.
    queue: Mutex<Vec<Job>>,
    wake: Condvar,
    /// Jobs queued or being worked on. The scan is over when it reaches 0.
    pending: AtomicUsize,
    /// The tree. Nodes are only appended, and a folder's children are appended after the
    /// folder itself, which is what makes every child id greater than its parent's.
    nodes: Mutex<Vec<Node>>,
    seen_links: Mutex<HashSet<(u64, u64)>>,
    volume: sys::Volume,
    excluded: Vec<PathBuf>,
    progress: &'a Progress,
    opts: &'a Options,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Walker<'_> {
    fn is_excluded(&self, path: &Path) -> bool {
        // Windows and macOS paths are compared without case; on Linux "Data" and "data" differ.
        let same = |a: &Path| {
            if cfg!(target_os = "linux") {
                a == path
            } else {
                a.as_os_str().eq_ignore_ascii_case(path.as_os_str())
            }
        };
        self.excluded.iter().any(|x| same(x))
    }

    fn work(&self) {
        while let Some(job) = self.next_job() {
            self.list(job);
            if self.pending.fetch_sub(1, SeqCst) == 1 {
                self.wake.notify_all(); // last job done: let idle workers exit
            }
        }
    }

    fn next_job(&self) -> Option<Job> {
        let mut queue = lock(&self.queue);
        loop {
            if self.progress.is_cancelled() {
                return None;
            }
            if !self.progress.is_paused() {
                if let Some(job) = queue.pop() {
                    return Some(job);
                }
                if self.pending.load(SeqCst) == 0 {
                    return None;
                }
            }
            // The timeout is how waiting workers notice a cancel.
            queue = self.wake.wait_timeout(queue, Duration::from_millis(50)).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    fn list(&self, job: Job) {
        let listing = sys::list_dir(&job.path, &self.volume, self.opts.dedup_hardlinks);
        let mut entries = listing.entries;

        // Hard links: the first link seen keeps its size, later ones move it to dedup_bytes.
        let mut dedup = vec![0u64; entries.len()];
        if self.opts.dedup_hardlinks {
            let mut seen = lock(&self.seen_links);
            for (e, d) in entries.iter_mut().zip(dedup.iter_mut()) {
                if let Some(key) = e.file_id {
                    e.flags |= flags::HARDLINK;
                    if !seen.insert(key) {
                        *d = e.on_disk;
                        e.on_disk = 0;
                    }
                }
            }
        }

        let child_depth = job.depth + 1;
        let descend = self.opts.max_depth.is_none_or(|max| child_depth <= max);
        let mut subdirs: Vec<(NodeId, OsString)> = Vec::new();
        let (mut apparent, mut on_disk, mut files, mut cloud, mut dedup_sum) = (0u64, 0u64, 0u64, 0u64, 0u64);
        let denied = matches!(listing.error, Some(ListError::Denied)) as u64;
        {
            let mut nodes = lock(&self.nodes);
            let mut ids = Vec::with_capacity(entries.len());
            for (e, dup) in entries.into_iter().zip(dedup) {
                let id = NodeId::try_from(nodes.len()).expect("more than 4 billion entries");
                ids.push(id);
                let mut node = Node::new(id, e.display, Some(job.id), e.is_dir);
                node.flags = e.flags;
                if e.is_dir {
                    if e.traverse {
                        node.flags |= flags::PARTIAL;
                        if descend && !self.is_excluded(&job.path.join(&e.name)) {
                            subdirs.push((id, e.name));
                        }
                    }
                } else {
                    let cloud_bytes =
                        if e.flags & flags::CLOUD != 0 { e.apparent.saturating_sub(e.on_disk) } else { 0 };
                    node.modified = e.modified;
                    node.own_apparent = e.apparent;
                    node.apparent = e.apparent;
                    node.own_on_disk = e.on_disk;
                    node.on_disk = e.on_disk;
                    node.own_files = 1;
                    node.files = 1;
                    node.cloud_bytes = cloud_bytes;
                    node.dedup_bytes = dup;
                    apparent += e.apparent;
                    on_disk += e.on_disk;
                    files += 1;
                    cloud += cloud_bytes;
                    dedup_sum += dup;
                }
                nodes.push(node);
            }

            let me = &mut nodes[job.id as usize];
            me.children = ids;
            me.own_apparent = apparent;
            me.apparent = apparent;
            me.own_on_disk = on_disk;
            me.on_disk = on_disk;
            me.own_files = files;
            me.files = files;
            me.cloud_bytes = cloud;
            me.dedup_bytes = dedup_sum;
            me.denied = denied;
            me.flags &= !flags::PARTIAL;
            match listing.error {
                None => {}
                Some(ListError::Denied) => me.flags |= flags::DENIED,
                Some(ListError::Incomplete) => me.flags |= flags::PARTIAL,
            }
        }

        let listed = self.progress.add_dir(files, on_disk, denied);
        if listed % 32 == 1 {
            self.progress.set_current(&job.path);
        }

        if !subdirs.is_empty() {
            let jobs: Vec<Job> = subdirs
                .into_iter()
                .map(|(id, name)| Job { id, path: job.path.join(name), depth: child_depth })
                .collect();
            let n = jobs.len();
            self.pending.fetch_add(n, SeqCst); // before this job's own decrement in work()
            lock(&self.queue).extend(jobs);
            if n == 1 {
                self.wake.notify_one();
            } else {
                self.wake.notify_all();
            }
        }
    }
}
