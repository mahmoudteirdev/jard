//! Per-OS folder listing. Each backend fills the same [`Listing`].

use std::ffi::OsString;

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod win;

#[cfg(unix)]
pub use self::unix::{list_dir, Volume};
#[cfg(windows)]
pub use self::win::{list_dir, Volume};

/// One entry of a folder. For folders, sizes are 0 (their size comes from their contents).
pub struct Entry {
    /// Raw name, used to build the path of subfolders.
    pub name: OsString,
    pub display: Box<str>,
    pub is_dir: bool,
    /// Folder that should be listed. False for symlinks, junctions, mount points, other volumes.
    pub traverse: bool,
    pub apparent: u64,
    pub on_disk: u64,
    pub flags: u8,
    /// (volume, file index) when the file has more than one hard link and ids were asked for.
    pub file_id: Option<(u64, u64)>,
}

pub enum ListError {
    /// The folder could not be opened for lack of permission.
    Denied,
    /// Listing failed, or stopped partway (I/O error, drive removed).
    Incomplete,
}

pub struct Listing {
    pub entries: Vec<Entry>,
    pub error: Option<ListError>,
}
