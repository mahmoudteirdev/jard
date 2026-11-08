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
}

impl Tree {
    pub const ROOT: NodeId = 0;

    /// Builds the tree and rolls sizes up from the leaves.
    pub(crate) fn build(root: PathBuf, nodes: Vec<Node>, elapsed: Duration, cancelled: bool) -> Self {
        let mut tree = Tree { root, nodes, elapsed, partial: false, cancelled };
        tree.rollup();
        tree
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
    fn display_path_strips_verbatim_prefix() {
        assert_eq!(display_path(Path::new(r"\\?\C:\Users")), r"C:\Users");
        assert_eq!(display_path(Path::new(r"\\?\UNC\nas\share")), r"\\nas\share");
        assert_eq!(display_path(Path::new("/home/x")), "/home/x");
    }
}
