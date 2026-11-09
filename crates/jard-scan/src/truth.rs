//! Why these numbers differ from what the file manager shows: every cause, counted from the scan.

use serde::Serialize;

use crate::node::{flags, NodeId};
use crate::tree::Tree;

/// How much of a tree each cause accounts for. A cause that isn't there counts 0.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TruthFacts {
    pub apparent: u64,
    pub on_disk: u64,
    /// Cloud placeholders: bytes that are in the cloud and not here.
    pub cloud_bytes: u64,
    pub cloud_files: u64,
    /// Extra hard links, counted once. 0 unless the scan looked for them.
    pub hardlink_bytes: u64,
    pub hardlink_files: u64,
    /// NTFS or WOF compression: full size and what it takes.
    pub compressed_apparent: u64,
    pub compressed_on_disk: u64,
    pub compressed_files: u64,
    pub sparse_apparent: u64,
    pub sparse_on_disk: u64,
    pub sparse_files: u64,
    /// Space lost to whole allocation units: on disk above apparent, for ordinary files.
    pub slack_bytes: u64,
    pub slack_files: u64,
    /// EFS-encrypted files. Their sizes are real; what's inside can't be read.
    pub encrypted_files: u64,
    /// Links and mount points, listed but not followed.
    pub links: u64,
    /// Folders that could not be listed.
    pub denied: u64,
    pub partial: bool,
    /// The folder that best shows the gap between the two numbers, when there is one.
    pub example: Option<NodeId>,
}

/// The gap between apparent and on disk must be at least this for a folder to make a good example.
const EXAMPLE_MIN_GAP: u64 = 1024 * 1024;

impl Tree {
    /// Counts every cause. Takes one pass over the tree.
    pub fn truth_facts(&self) -> TruthFacts {
        let root = self.root_node();
        let mut t = TruthFacts {
            apparent: root.apparent,
            on_disk: root.on_disk,
            cloud_bytes: root.cloud_bytes,
            hardlink_bytes: root.dedup_bytes,
            denied: root.denied,
            partial: self.partial,
            ..TruthFacts::default()
        };
        for n in &self.nodes {
            if !self.is_attached(n) {
                continue;
            }
            if n.flags & flags::REPARSE != 0 {
                t.links += 1;
            }
            if n.is_dir {
                continue;
            }
            if n.flags & flags::CLOUD != 0 {
                t.cloud_files += 1;
            }
            if n.dedup_bytes > 0 {
                t.hardlink_files += 1;
            }
            if n.flags & flags::ENCRYPTED != 0 {
                t.encrypted_files += 1;
            }
            if n.flags & flags::COMPRESSED != 0 {
                t.compressed_apparent += n.apparent;
                t.compressed_on_disk += n.on_disk;
                t.compressed_files += 1;
            } else if n.flags & flags::SPARSE != 0 {
                t.sparse_apparent += n.apparent;
                t.sparse_on_disk += n.on_disk;
                t.sparse_files += 1;
            } else if n.flags & flags::CLOUD == 0 && n.on_disk > n.apparent {
                t.slack_bytes += n.on_disk - n.apparent;
                t.slack_files += 1;
            }
        }
        t.example = self.widest_gap();
        t
    }

    /// Walks down from the top while one folder holds most of the gap, so the example is specific.
    fn widest_gap(&self) -> Option<NodeId> {
        let gap = |id: NodeId| self.get(id).map_or(0, |n| n.apparent.abs_diff(n.on_disk));
        let mut cur = Tree::ROOT;
        if gap(cur) < EXAMPLE_MIN_GAP {
            return None;
        }
        loop {
            let best = self.get(cur)?.children.iter().copied().filter(|&c| self.get(c).is_some_and(|n| n.is_dir && self.is_attached(n))).max_by_key(|&c| gap(c));
            match best {
                Some(b) if gap(b) >= EXAMPLE_MIN_GAP && gap(b) * 10 >= gap(cur) * 8 => cur = b,
                _ => return Some(cur),
            }
        }
    }
}
