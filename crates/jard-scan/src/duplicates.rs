//! Finds files with identical content. Narrows by size, then a hash of the first 64 KiB, then a
//! hash of the whole file, so most files are never read past their start.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::node::{flags, NodeId};
use crate::sys;
use crate::tree::Tree;

const HEAD: usize = 64 * 1024;

/// Files with the same content. The first is the one to keep: the shortest path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateGroup {
    pub size: u64,
    pub files: Vec<NodeId>,
}

impl DuplicateGroup {
    /// Disk space freed by keeping only one copy.
    pub fn reclaimable(&self) -> u64 {
        self.size * (self.files.len() as u64 - 1)
    }
}

fn hash_head(path: &std::path::Path) -> io::Result<blake3::Hash> {
    let mut buf = vec![0u8; HEAD];
    let mut f = File::open(path)?;
    let mut filled = 0;
    while filled < HEAD {
        match f.read(&mut buf[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(blake3::hash(&buf[..filled]))
}

fn hash_all(path: &std::path::Path, stop: &AtomicBool) -> io::Result<blake3::Hash> {
    let mut h = blake3::Hasher::new();
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        match f.read(&mut buf)? {
            0 => return Ok(h.finalize()),
            n => {
                h.update(&buf[..n]);
            }
        }
    }
}

/// Groups files of at least `min_size` bytes with identical content, biggest savings first.
///
/// Skips what must not or cannot be compared: cloud files (reading one downloads it), links, and
/// files that can't be opened. Several hard links to one file are not duplicates: deleting one
/// frees nothing, so only one link of each file is compared. `stop` ends the search early.
pub fn find_duplicates(tree: &Tree, min_size: u64, stop: &AtomicBool) -> Vec<DuplicateGroup> {
    let mut by_size: HashMap<u64, Vec<NodeId>> = HashMap::new();
    for n in tree.live_files() {
        let skip = n.has(flags::CLOUD) || n.has(flags::REPARSE) || n.has(flags::DENIED);
        if n.apparent >= min_size && !skip {
            by_size.entry(n.apparent).or_default().push(n.id);
        }
    }

    let mut groups = Vec::new();
    for (size, ids) in by_size.into_iter().filter(|(_, ids)| ids.len() > 1) {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let mut by_head: HashMap<blake3::Hash, Vec<NodeId>> = HashMap::new();
        for id in ids {
            if let Some(h) = tree.path(id).and_then(|p| hash_head(&p).ok()) {
                by_head.entry(h).or_default().push(id);
            }
        }
        for same_head in by_head.into_values().filter(|v| v.len() > 1) {
            let mut by_full: HashMap<blake3::Hash, Vec<NodeId>> = HashMap::new();
            let mut seen_links = Vec::new();
            for id in same_head {
                let Some(path) = tree.path(id) else { continue };
                if let Some(link) = sys::link_identity(&path) {
                    if seen_links.contains(&link) {
                        continue;
                    }
                    seen_links.push(link);
                }
                // A file that fits in the head was already hashed whole, but one code path is simpler.
                if let Ok(h) = hash_all(&path, stop) {
                    by_full.entry(h).or_default().push(id);
                }
            }
            for mut files in by_full.into_values().filter(|v| v.len() > 1) {
                files.sort_by_cached_key(|&id| {
                    let p = tree.display_path(id).unwrap_or_default();
                    (p.len(), p)
                });
                groups.push(DuplicateGroup { size, files });
            }
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.reclaimable()));
    groups
}
