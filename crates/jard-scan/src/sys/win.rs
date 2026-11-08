//! Windows listing with FindFirstFileExW. One call per folder returns names, attributes,
//! sizes and reparse tags; only compressed, sparse and cloud files need an extra call for
//! their on-disk size.

use std::ffi::{c_void, OsString};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::Path;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
    GetCompressedFileSizeW, GetDiskFreeSpaceW, GetFileInformationByHandle, GetVolumePathNameW,
    BY_HANDLE_FILE_INFORMATION, FIND_FIRST_EX_LARGE_FETCH, WIN32_FIND_DATAW,
};

use super::{Entry, ListError, Listing};
use crate::node::flags;

// Spelled out here so the code does not depend on how windows-sys types each constant.
const ATTR_SPARSE: u32 = 0x200;
const ATTR_DIRECTORY: u32 = 0x10;
const ATTR_REPARSE_POINT: u32 = 0x400;
const ATTR_COMPRESSED: u32 = 0x800;
const ATTR_OFFLINE: u32 = 0x1000;
const ATTR_ENCRYPTED: u32 = 0x4000;
const ATTR_RECALL_ON_OPEN: u32 = 0x4_0000;
const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
/// Data is not (fully) on this disk.
const ATTR_NOT_LOCAL: u32 = ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS;

const TAG_DEDUP: u32 = 0x8000_0013;
const TAG_WOF: u32 = 0x8000_0017;
/// IO_REPARSE_TAG_CLOUD and CLOUD_1..CLOUD_F differ only in bits 12-15.
const TAG_CLOUD: u32 = 0x9000_001A;
const TAG_CLOUD_MASK: u32 = 0xFFFF_0FFF;

const ERROR_FILE_NOT_FOUND: u32 = 2;
const ERROR_ACCESS_DENIED: u32 = 5;
const ERROR_NO_MORE_FILES: u32 = 18;
const NO_ERROR: u32 = 0;
const INVALID_FILE_SIZE: u32 = 0xFFFF_FFFF;

const FILE_READ_ATTRIBUTES: u32 = 0x80;
const FILE_SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

const BACKSLASH: u16 = b'\\' as u16;
const DOT: u16 = b'.' as u16;

pub struct Volume {
    /// Allocation unit. Normal files take whole clusters on disk.
    cluster: u64,
}

impl Volume {
    pub fn for_path(path: &Path) -> Self {
        let mut cluster = 4096;
        let path = wide_nul(path.as_os_str().encode_wide());
        let mut root = [0u16; 1024];
        // SAFETY: both buffers are valid; `root` length is passed.
        unsafe {
            if GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) != 0 {
                let (mut per_cluster, mut per_sector, mut free, mut total) = (0u32, 0u32, 0u32, 0u32);
                if GetDiskFreeSpaceW(root.as_ptr(), &mut per_cluster, &mut per_sector, &mut free, &mut total) != 0 {
                    let c = u64::from(per_cluster) * u64::from(per_sector);
                    if c > 0 {
                        cluster = c;
                    }
                }
            }
        }
        Volume { cluster }
    }
}

enum Tag {
    None,
    Cloud,
    Wof,
    Dedup,
    /// Symlink, junction, mount point, app link...: not followed.
    Other,
}

fn classify(tag: u32) -> Tag {
    match tag {
        0 => Tag::None,
        TAG_WOF => Tag::Wof,
        TAG_DEDUP => Tag::Dedup,
        t if t & TAG_CLOUD_MASK == TAG_CLOUD => Tag::Cloud,
        _ => Tag::Other,
    }
}

pub fn list_dir(dir: &Path, vol: &Volume, want_ids: bool) -> Listing {
    let mut out = Listing { entries: Vec::new(), error: None };
    let mut base: Vec<u16> = dir.as_os_str().encode_wide().collect();
    if !matches!(base.last(), Some(&BACKSLASH) | Some(&0x2F)) {
        base.push(BACKSLASH);
    }
    let pattern = wide_nul(base.iter().copied().chain([b'*' as u16]));

    // SAFETY: zeroed WIN32_FIND_DATAW is a valid value; FindFirstFileExW fills it.
    let mut fd: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    let handle = unsafe {
        FindFirstFileExW(
            pattern.as_ptr(),
            FindExInfoBasic, // skips the 8.3 short name
            &mut fd as *mut WIN32_FIND_DATAW as *mut c_void,
            FindExSearchNameMatch,
            ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        out.error = match unsafe { GetLastError() } {
            ERROR_FILE_NOT_FOUND => None,
            ERROR_ACCESS_DENIED => Some(ListError::Denied),
            _ => Some(ListError::Incomplete),
        };
        return out;
    }

    let mut full = Vec::with_capacity(base.len() + 64);
    loop {
        if let Some(e) = entry(&fd, &base, &mut full, vol, want_ids) {
            out.entries.push(e);
        }
        // SAFETY: `handle` is a live find handle, `fd` is a valid out pointer.
        if unsafe { FindNextFileW(handle, &mut fd) } == 0 {
            if unsafe { GetLastError() } != ERROR_NO_MORE_FILES {
                out.error = Some(ListError::Incomplete);
            }
            break;
        }
    }
    // SAFETY: closing the handle opened above, once.
    unsafe { FindClose(handle) };
    out
}

fn entry(fd: &WIN32_FIND_DATAW, base: &[u16], full: &mut Vec<u16>, vol: &Volume, want_ids: bool) -> Option<Entry> {
    let len = fd.cFileName.iter().position(|&c| c == 0).unwrap_or(fd.cFileName.len());
    let name = &fd.cFileName[..len];
    if name == [DOT] || name == [DOT, DOT] {
        return None;
    }

    let attrs = fd.dwFileAttributes;
    let is_dir = attrs & ATTR_DIRECTORY != 0;
    // For reparse points, dwReserved0 holds the reparse tag.
    let tag = classify(if attrs & ATTR_REPARSE_POINT != 0 { fd.dwReserved0 } else { 0 });

    let mut f = 0u8;
    match tag {
        Tag::None | Tag::Dedup => {}
        Tag::Cloud => f |= flags::CLOUD,
        Tag::Wof => f |= flags::COMPRESSED,
        Tag::Other => f |= flags::REPARSE,
    }
    if attrs & ATTR_NOT_LOCAL != 0 {
        f |= flags::CLOUD;
    }
    if attrs & ATTR_COMPRESSED != 0 {
        f |= flags::COMPRESSED;
    }
    if attrs & ATTR_SPARSE != 0 {
        f |= flags::SPARSE;
    }
    if attrs & ATTR_ENCRYPTED != 0 {
        f |= flags::ENCRYPTED;
    }

    let mut e = Entry {
        name: OsString::from_wide(name),
        display: String::from_utf16_lossy(name).into(),
        is_dir,
        traverse: false,
        apparent: 0,
        on_disk: 0,
        flags: f,
        file_id: None,
    };
    if is_dir {
        // OneDrive folders are cloud reparse points and must be walked; junctions must not.
        e.traverse = !matches!(tag, Tag::Other);
        return Some(e);
    }

    e.apparent = (u64::from(fd.nFileSizeHigh) << 32) | u64::from(fd.nFileSizeLow);
    full.clear();
    full.extend_from_slice(base);
    full.extend_from_slice(name);
    full.push(0);

    let allocated = round_up(e.apparent, vol.cluster);
    // Any reparse tag may mean the data lives elsewhere (containers, dedup, placeholders): ask, don't assume.
    let needs_query = f & (flags::CLOUD | flags::COMPRESSED | flags::SPARSE) != 0 || !matches!(tag, Tag::None);
    e.on_disk = if needs_query {
        // Metadata only: does not download cloud files.
        compressed_size(full).unwrap_or(if attrs & ATTR_NOT_LOCAL != 0 { 0 } else { allocated })
    } else {
        allocated
    };
    if want_ids && !matches!(tag, Tag::Other) {
        e.file_id = hardlink_id(full);
    }
    Some(e)
}

fn round_up(n: u64, unit: u64) -> u64 {
    n.div_ceil(unit) * unit
}

fn wide_nul(s: impl Iterator<Item = u16>) -> Vec<u16> {
    s.chain([0]).collect()
}

fn compressed_size(path_nul: &[u16]) -> Option<u64> {
    let mut high = 0u32;
    // SAFETY: `path_nul` is NUL-terminated; `high` is a valid out pointer.
    let low = unsafe { GetCompressedFileSizeW(path_nul.as_ptr(), &mut high) };
    if low == INVALID_FILE_SIZE && unsafe { GetLastError() } != NO_ERROR {
        return None;
    }
    Some((u64::from(high) << 32) | u64::from(low))
}

/// Opens the file (attributes only) to read its link count and file index. Costly, so only
/// done when hard-link dedup is on.
fn hardlink_id(path_nul: &[u16]) -> Option<(u64, u64)> {
    // SAFETY: `path_nul` is NUL-terminated; the handle is closed before returning.
    unsafe {
        let h = CreateFileW(
            path_nul.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_ALL,
            ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        );
        if h == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        let ok = GetFileInformationByHandle(h, &mut info);
        CloseHandle(h);
        if ok == 0 || info.nNumberOfLinks < 2 {
            return None;
        }
        let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
        Some((u64::from(info.dwVolumeSerialNumber), index))
    }
}
