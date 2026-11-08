use serde::Serialize;

/// Index into [`crate::Tree::nodes`]. A child's id is always greater than its parent's.
pub type NodeId = u32;

/// Bit flags on [`Node::flags`]. Values are part of the UI contract (HANDOFF §5).
pub mod flags {
    /// Cloud placeholder (OneDrive etc.). Part or all of its data is not on this disk.
    pub const CLOUD: u8 = 1;
    /// NTFS or WOF (CompactOS) compression: on disk is smaller than apparent.
    pub const COMPRESSED: u8 = 2;
    /// Sparse file: on disk is smaller than apparent.
    pub const SPARSE: u8 = 4;
    /// Symlink, junction, mount point or another volume. Not followed.
    pub const REPARSE: u8 = 8;
    /// EFS-encrypted.
    pub const ENCRYPTED: u8 = 16;
    /// Has more than one hard link. Only set when `dedup_hardlinks` is on.
    pub const HARDLINK: u8 = 32;
    /// The folder could not be listed. Not an error: the scan goes on.
    pub const DENIED: u8 = 64;
    /// The folder, or something under it, was not fully read (cancelled, depth limit, I/O error).
    pub const PARTIAL: u8 = 128;
}

/// One file or folder. The tree is a flat `Vec<Node>`; `children` and `parent` are ids into it.
///
/// For a folder, `own_*` cover only the files directly inside it, and the totals
/// (`apparent`, `on_disk`, `files`, `dirs`, `cloud_bytes`, `dedup_bytes`, `denied`)
/// cover everything below it once the tree is rolled up.
/// For a file, `own_*` and the totals are the same and `files` is 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: NodeId,
    /// File name as text. Not-valid-Unicode names are converted lossily.
    pub name: Box<str>,
    pub parent: Option<NodeId>,
    pub is_dir: bool,
    pub children: Vec<NodeId>,
    pub own_apparent: u64,
    pub own_on_disk: u64,
    pub own_files: u64,
    /// Logical size: what Explorer calls "Size".
    pub apparent: u64,
    /// Allocated size: what Explorer calls "Size on disk". Duplicate hard links count 0.
    pub on_disk: u64,
    pub files: u64,
    pub dirs: u64,
    /// Bytes that are in the cloud and not on this disk (apparent minus on disk of cloud files).
    pub cloud_bytes: u64,
    /// On-disk bytes not counted because they are another link to a file already counted.
    pub dedup_bytes: u64,
    /// Folders that could not be listed, this one included.
    pub denied: u64,
    pub flags: u8,
    /// Last write time of a file, in seconds since 1970. 0 for folders and when unknown.
    pub modified: u64,
}

impl Node {
    pub(crate) fn new(id: NodeId, name: Box<str>, parent: Option<NodeId>, is_dir: bool) -> Self {
        Node {
            id,
            name,
            parent,
            is_dir,
            children: Vec::new(),
            own_apparent: 0,
            own_on_disk: 0,
            own_files: 0,
            apparent: 0,
            on_disk: 0,
            files: 0,
            dirs: 0,
            cloud_bytes: 0,
            dedup_bytes: 0,
            denied: 0,
            flags: 0,
            modified: 0,
        }
    }

    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}
