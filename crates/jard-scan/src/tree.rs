use std::collections::HashSet;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::node::{flags, Node, NodeId};

/// Sort order for [`Tree::children`]. Serialized as `"on_disk" | "apparent" | "name"`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    /// Largest on disk first.
    #[default]
    OnDisk,
    /// Largest apparent size first.
    Apparent,
    /// A to Z, ignoring case.
    Name,
}

/// The result of a scan: a flat, rolled-up tree. Node 0 is the scanned folder.
#[derive(Debug, Clone)]
pub struct Tree {
    /// The scanned folder as the OS sees it (on Windows a `\\?\` path, so long paths work).
    pub root: PathBuf,
    pub nodes: Vec<Node>,
    pub elapsed: Duration,
    /// True if the scan was cancelled or any folder was not fully read.
    pub partial: bool,
    pub cancelled: bool,
    /// Nodes taken out with [`Tree::detach`] (they left the disk after the scan).
    detached: HashSet<NodeId>,
}

impl Tree {
    pub const ROOT: NodeId = 0;

    /// Builds the tree and rolls sizes up from the leaves.
    pub(crate) fn build(root: PathBuf, nodes: Vec<Node>, elapsed: Duration, cancelled: bool) -> Self {
        let mut tree = Tree { root, nodes, elapsed, partial: false, cancelled, detached: HashSet::new() };
        tree.rollup();
        tree
    }

    /// A tree read back from disk: its totals are already rolled up.
    pub(crate) fn from_saved(
        root: PathBuf,
        nodes: Vec<Node>,
        elapsed: Duration,
        partial: bool,
        cancelled: bool,
    ) -> Self {
        Tree { root, nodes, elapsed, partial, cancelled, detached: HashSet::new() }
    }

    /// Adds every folder's totals into its parent. Relies on child id > parent id, so a
    /// single pass from the last node to the first sees each folder after all its children.
    fn rollup(&mut self) {
        for i in (1..self.nodes.len()).rev() {
            let n = &self.nodes[i];
            if !n.is_dir {
                continue; // files are already in their folder's own_* sums
            }
            let Some(parent) = n.parent else { continue };
            debug_assert!((parent as usize) < i, "child id must be greater than parent id");
            let (apparent, on_disk, files, dirs, cloud, dedup, denied, partial) = (
                n.apparent,
                n.on_disk,
                n.files,
                n.dirs,
                n.cloud_bytes,
                n.dedup_bytes,
                n.denied,
                n.flags & flags::PARTIAL,
            );
            let p = &mut self.nodes[parent as usize];
            p.apparent += apparent;
            p.on_disk += on_disk;
            p.files += files;
            p.dirs += 1 + dirs;
            p.cloud_bytes += cloud;
            p.dedup_bytes += dedup;
            p.denied += denied;
            p.flags |= partial;
        }
        self.partial = self.cancelled || self.nodes.first().is_some_and(|r| r.has(flags::PARTIAL));
    }

    pub fn root_node(&self) -> &Node {
        &self.nodes[Self::ROOT as usize]
    }

    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    /// Children of `id`, sorted, then paged with `offset` and `limit`.
    pub fn children(&self, id: NodeId, sort: SortKey, offset: usize, limit: Option<usize>) -> Vec<&Node> {
        let Some(node) = self.get(id) else { return Vec::new() };
        let mut kids: Vec<&Node> = node.children.iter().map(|&c| &self.nodes[c as usize]).collect();
        match sort {
            SortKey::OnDisk => kids.sort_by(|a, b| b.on_disk.cmp(&a.on_disk).then_with(|| a.name.cmp(&b.name))),
            SortKey::Apparent => kids.sort_by(|a, b| b.apparent.cmp(&a.apparent).then_with(|| a.name.cmp(&b.name))),
            SortKey::Name => kids.sort_by_cached_key(|n| n.name.to_lowercase()),
        }
        kids.into_iter().skip(offset).take(limit.unwrap_or(usize::MAX)).collect()
    }

    /// Full OS path of a node, for file operations.
    pub fn path(&self, id: NodeId) -> Option<PathBuf> {
        let mut names = Vec::new();
        let mut cur = self.get(id)?;
        while let Some(parent) = cur.parent {
            names.push(&*cur.name);
            cur = self.get(parent)?;
        }
        let mut path = self.root.clone();
        path.extend(names.iter().rev());
        Some(path)
    }

    /// Path for showing to people: no `\\?\` prefix.
    pub fn display_path(&self, id: NodeId) -> Option<String> {
        self.path(id).map(|p| display_path(&p))
    }

    /// The largest files at or above `min_size` bytes on disk, largest first.
    pub fn largest_files(&self, min_size: u64, limit: usize) -> Vec<&Node> {
        let mut found: Vec<&Node> = self.live_files().filter(|n| n.on_disk >= min_size).collect();
        found.sort_by_key(|n| std::cmp::Reverse(n.on_disk));
        found.truncate(limit);
        found
    }

    /// Files at or above `min_size` not written to since `before` (seconds since 1970), largest first.
    pub fn old_files(&self, before: u64, min_size: u64, limit: usize) -> Vec<&Node> {
        let mut found: Vec<&Node> =
            self.live_files().filter(|n| n.on_disk >= min_size && n.modified > 0 && n.modified < before).collect();
        found.sort_by_key(|n| std::cmp::Reverse(n.on_disk));
        found.truncate(limit);
        found
    }

    /// Folders whose path ends with one of `tails` (segments compared ignoring ASCII case), largest
    /// first. Each comes with the index of the tail it matched.
    pub fn folders_ending_with(&self, tails: &[&[&str]]) -> Vec<(&Node, usize)> {
        let mut found: Vec<(&Node, usize)> = Vec::new();
        for n in self.nodes.iter().filter(|n| n.is_dir && n.on_disk > 0 && self.is_attached(n)) {
            let hit = tails.iter().position(|tail| {
                let mut cur = Some(n);
                tail.iter().rev().all(|seg| match cur {
                    Some(c) if c.name.eq_ignore_ascii_case(seg) => {
                        cur = c.parent.and_then(|p| self.get(p));
                        true
                    }
                    _ => false,
                })
            });
            if let Some(i) = hit {
                found.push((n, i));
            }
        }
        found.sort_by_key(|f| std::cmp::Reverse(f.0.on_disk));
        found
    }

    pub(crate) fn live_files(&self) -> impl Iterator<Item = &Node> {
        self.nodes.iter().filter(|n| !n.is_dir && self.is_attached(n))
    }

    /// False once the node, or a folder above it, was taken out with [`Tree::detach`].
    pub fn is_attached(&self, node: &Node) -> bool {
        if self.detached.is_empty() {
            return true;
        }
        let mut cur = node;
        loop {
            if self.detached.contains(&cur.id) {
                return false;
            }
            match cur.parent {
                Some(p) => cur = &self.nodes[p as usize],
                None => return true,
            }
        }
    }

    /// Takes a node out after it left the disk: every total above it shrinks at once, without a
    /// new scan. Returns false if there is nothing to do. [`Tree::reattach`] undoes it.
    pub fn detach(&mut self, id: NodeId) -> bool {
        if self.get(id).is_none_or(|n| n.parent.is_none()) || !self.detached.insert(id) {
            return false;
        }
        self.shift(id, false);
        true
    }

    /// Puts back a node removed with [`Tree::detach`], for example after a restore.
    pub fn reattach(&mut self, id: NodeId) -> bool {
        if !self.detached.remove(&id) {
            return false;
        }
        self.shift(id, true);
        true
    }

    fn shift(&mut self, id: NodeId, attach: bool) {
        let n = &self.nodes[id as usize];
        let (apparent, on_disk, files, dirs, cloud, dedup, denied, is_dir) = (
            n.apparent,
            n.on_disk,
            n.files,
            n.dirs + u64::from(n.is_dir),
            n.cloud_bytes,
            n.dedup_bytes,
            n.denied,
            n.is_dir,
        );
        let Some(parent) = n.parent else { return };
        let apply = |v: &mut u64, d: u64| *v = if attach { *v + d } else { v.saturating_sub(d) };

        let p = &mut self.nodes[parent as usize];
        if attach {
            p.children.push(id);
        } else {
            p.children.retain(|&c| c != id);
        }
        if !is_dir {
            apply(&mut p.own_apparent, apparent);
            apply(&mut p.own_on_disk, on_disk);
            apply(&mut p.own_files, 1);
        }
        let mut cur = Some(parent);
        while let Some(i) = cur {
            let a = &mut self.nodes[i as usize];
            apply(&mut a.apparent, apparent);
            apply(&mut a.on_disk, on_disk);
            apply(&mut a.files, files);
            apply(&mut a.dirs, dirs);
            apply(&mut a.cloud_bytes, cloud);
            apply(&mut a.dedup_bytes, dedup);
            apply(&mut a.denied, denied);
            cur = a.parent;
        }
    }

    /// Writes the whole tree as JSON (`export_json`).
    pub fn write_json<W: Write>(&self, out: W) -> io::Result<()> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Export<'a> {
            format: &'static str,
            version: u32,
            root: String,
            elapsed_ms: u64,
            partial: bool,
            nodes: &'a [Node],
        }
        let export = Export {
            format: "jard-scan",
            version: 1,
            root: display_path(&self.root),
            elapsed_ms: self.elapsed.as_millis() as u64,
            partial: self.partial,
            nodes: &self.nodes,
        };
        serde_json::to_writer(io::BufWriter::new(out), &export).map_err(io::Error::other)
    }
}

/// Strips Windows' verbatim prefix: `\\?\C:\x` -> `C:\x`, `\\?\UNC\srv\x` -> `\\srv\x`.
pub fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(id: NodeId, parent: Option<NodeId>, own: u64) -> Node {
        let mut n = Node::new(id, format!("d{id}").into(), parent, true);
        n.own_apparent = own;
        n.apparent = own;
        n.own_on_disk = own * 2;
        n.on_disk = own * 2;
        n.own_files = 1;
        n.files = 1;
        n
    }

    #[test]
    fn rollup_adds_folders_into_parents_once() {
        // 0 -> 1 -> 3, 0 -> 2
        let mut nodes = vec![dir(0, None, 1), dir(1, Some(0), 10), dir(2, Some(0), 100), dir(3, Some(1), 1000)];
        nodes[0].children = vec![1, 2];
        nodes[1].children = vec![3];
        nodes[3].flags = flags::PARTIAL;
        nodes[3].denied = 1;
        let t = Tree::build(PathBuf::from("root"), nodes, Duration::ZERO, false);

        assert_eq!(t.nodes[1].apparent, 1010);
        assert_eq!(t.nodes[0].apparent, 1111);
        assert_eq!(t.nodes[0].on_disk, 2222);
        assert_eq!(t.nodes[0].files, 4);
        assert_eq!(t.nodes[0].dirs, 3);
        assert_eq!(t.nodes[1].dirs, 1);
        assert_eq!(t.nodes[0].denied, 1);
        assert!(t.nodes[1].has(flags::PARTIAL));
        assert!(!t.nodes[2].has(flags::PARTIAL));
        assert!(t.partial);
    }

    #[test]
    fn detach_and_reattach_keep_totals_right() {
        // 0 -> 1 -> 2 (file 1000), 0 -> 3 (file 10)
        let mut root = Node::new(0, "r".into(), None, true);
        let mut d1 = Node::new(1, "d".into(), Some(0), true);
        let mut f2 = Node::new(2, "a".into(), Some(1), false);
        let mut f3 = Node::new(3, "b".into(), Some(0), false);
        for (n, size) in [(&mut f2, 1000), (&mut f3, 10)] {
            n.own_apparent = size;
            n.apparent = size;
            n.own_on_disk = size;
            n.on_disk = size;
            n.own_files = 1;
            n.files = 1;
        }
        d1.children = vec![2];
        (d1.apparent, d1.on_disk, d1.own_apparent, d1.own_on_disk, d1.own_files, d1.files) =
            (1000, 1000, 1000, 1000, 1, 1);
        root.children = vec![1, 3];
        (root.apparent, root.on_disk, root.own_apparent, root.own_on_disk, root.own_files, root.files) =
            (10, 10, 10, 10, 1, 1);
        let mut t = Tree::build(PathBuf::from("r"), vec![root, d1, f2, f3], Duration::ZERO, false);
        let total = t.nodes[0].apparent;
        assert_eq!((total, t.nodes[0].files, t.nodes[0].dirs), (1010, 2, 1));

        assert!(t.detach(1));
        assert!(!t.detach(1), "already out");
        assert_eq!((t.nodes[0].apparent, t.nodes[0].files, t.nodes[0].dirs), (10, 1, 0));
        assert_eq!(t.nodes[0].children, vec![3]);
        assert!(!t.is_attached(&t.nodes[2]), "a file under a detached folder is gone too");
        assert_eq!(t.largest_files(0, 10).len(), 1);

        assert!(t.detach(3));
        assert_eq!((t.nodes[0].own_apparent, t.nodes[0].own_files), (0, 0));
        assert!(t.reattach(3));
        assert!(t.reattach(1));
        assert!(!t.reattach(1), "already back");
        assert_eq!((t.nodes[0].apparent, t.nodes[0].files, t.nodes[0].dirs), (1010, 2, 1));
        assert_eq!(t.largest_files(0, 10).len(), 2);
        assert!(!t.detach(0), "the root cannot be detached");
    }

    #[test]
    fn display_path_strips_verbatim_prefix() {
        assert_eq!(display_path(Path::new(r"\\?\C:\Users")), r"C:\Users");
        assert_eq!(display_path(Path::new(r"\\?\UNC\nas\share")), r"\\nas\share");
        assert_eq!(display_path(Path::new("/home/x")), "/home/x");
    }
}
