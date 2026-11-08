//! Linux and macOS listing with `read_dir` + `lstat`.

use std::fs;
use std::io::ErrorKind;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use super::{Entry, ListError, Listing};
use crate::node::flags;

pub struct Volume {
    /// Device of the scanned folder. Folders on another device (mounts, /proc) are not walked.
    dev: u64,
}

impl Volume {
    pub fn for_path(path: &Path) -> Self {
        Volume { dev: fs::metadata(path).map_or(0, |m| m.dev()) }
    }
}

pub fn list_dir(dir: &Path, vol: &Volume, want_ids: bool) -> Listing {
    let mut out = Listing { entries: Vec::new(), error: None };
    let read = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(e) => {
            out.error =
                Some(if e.kind() == ErrorKind::PermissionDenied { ListError::Denied } else { ListError::Incomplete });
            return out;
        }
    };

    for item in read {
        // DirEntry::metadata does not follow symlinks.
        let Ok((item, md)) = item.and_then(|i| i.metadata().map(|m| (i, m))) else {
            out.error = Some(ListError::Incomplete);
            continue;
        };
        let name = item.file_name();
        let ft = md.file_type();
        let mut e = Entry {
            display: name.to_string_lossy().into(),
            name,
            is_dir: ft.is_dir(),
            traverse: false,
            apparent: 0,
            on_disk: 0,
            modified: 0,
            flags: if ft.is_symlink() { flags::REPARSE } else { 0 },
            file_id: None,
        };
        if e.is_dir {
            e.traverse = md.dev() == vol.dev;
            if !e.traverse {
                e.flags |= flags::REPARSE;
            }
        } else {
            e.apparent = md.len();
            e.modified = u64::try_from(md.mtime()).unwrap_or(0);
            e.on_disk = md.blocks() * 512; // st_blocks is always in 512-byte units
            if ft.is_file() && e.on_disk < e.apparent {
                e.flags |= flags::SPARSE;
            }
            if want_ids && ft.is_file() && md.nlink() > 1 {
                e.file_id = Some((md.dev(), md.ino()));
            }
        }
        out.entries.push(e);
    }
    out
}
