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
    /// Last write time, seconds since 1970. 0 when unknown.
    pub modified: u64,
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

/// Identity of the file behind `path` when it has more than one hard link: same value, same data.
#[cfg(windows)]
pub fn link_identity(path: &std::path::Path) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    win::hardlink_id(&wide)
}

#[cfg(unix)]
pub fn link_identity(path: &std::path::Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let md = std::fs::symlink_metadata(path).ok()?;
    (md.nlink() > 1).then(|| (md.dev(), md.ino()))
}
