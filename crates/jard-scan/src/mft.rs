//! Direct NTFS MFT (Master File Table) scanner for Windows.
//!
//! When running with Administrator privileges on an NTFS volume, reading the `$MFT`
//! directly bypasses directory-by-directory syscalls and can enumerate hundreds of
//! thousands of files in 1–2 seconds.
//!
//! If Administrator privileges are absent, or the volume is not NTFS, or any error
//! occurs during reading, scanning falls back seamlessly to the standard folder walker.

#![cfg(windows)]

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::time::Instant;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetVolumeInformationW, ReadFile, SetFilePointerEx, FILE_ATTRIBUTE_NORMAL,
    FILE_BEGIN, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::IO::DeviceIoControl;

use crate::node::{flags, Node, NodeId};
use crate::progress::Progress;
use crate::tree::{display_path, Tree};
use crate::walk::Options;

const FSCTL_GET_NTFS_VOLUME_DATA: u32 = 0x00090064;

#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
struct NtfsVolumeData {
    serial: i64,
    sectors: i64,
    clusters: i64,
    free: i64,
    reserved: i64,
    bytes_per_sector: u32,
    bytes_per_cluster: u32,
    bytes_per_record: u32,
    clusters_per_record: u32,
    mft_length: i64,
    mft_start_lcn: i64,
    mft2_start_lcn: i64,
    mft_zone_start: i64,
    mft_zone_end: i64,
}

const ATTR_STANDARD_INFORMATION: u32 = 0x10;
const ATTR_FILE_NAME: u32 = 0x30;
const ATTR_DATA: u32 = 0x80;
const ATTR_REPARSE_POINT: u32 = 0xC0;

const TAG_CLOUD: u32 = 0x9000_001A;
const TAG_CLOUD_MASK: u32 = 0xFFFF_0FFF;

/// Windows FILETIME (100-nanosecond intervals since Jan 1, 1601) to Unix epoch seconds.
fn filetime_to_unix(ft: u64) -> u64 {
    const UNIX_EPOCH_DELTA: u64 = 116_444_736_000_000_000;
    if ft > UNIX_EPOCH_DELTA {
        (ft - UNIX_EPOCH_DELTA) / 10_000_000
    } else {
        0
    }
}

/// Extracts the drive letter from a path, e.g. "C" from "C:\Users" or "\\?\C:\".
fn drive_letter(path: &Path) -> Option<char> {
    let s = path.to_str()?;
    let s = s.strip_prefix(r"\\?\").unwrap_or(s);
    let mut chars = s.chars();
    let letter = chars.next()?;
    if chars.next()? == ':' && letter.is_ascii_alphabetic() {
        Some(letter.to_ascii_uppercase())
    } else {
        None
    }
}

/// Checks whether `path` refers to a drive root, e.g. "C:\", "C:", or "\\?\C:\".
pub fn is_drive_root(path: &Path) -> bool {
    let s = match path.to_str() {
        Some(s) => s,
        None => return false,
    };
    let s = s.strip_prefix(r"\\?\").unwrap_or(s);
    let s = s.trim_end_matches(['\\', '/']);
    s.len() == 2 && s.ends_with(':') && s.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
}

/// Checks whether `path` is a drive root on an NTFS volume and the volume can be opened for MFT reading.
pub fn can_scan_mft(path: &Path) -> bool {
    if !is_drive_root(path) {
        return false;
    }
    let letter = match drive_letter(path) {
        Some(l) => l,
        None => return false,
    };

    // Check file system name
    let root_path = format!(r"{}:\", letter);
    let root_wide: Vec<u16> = root_path.encode_utf16().chain(Some(0)).collect();
    let mut fs_name = [0u16; 64];
    let ok = unsafe {
        GetVolumeInformationW(
            root_wide.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    };
    if ok == 0 {
        return false;
    }
    let fs_str = OsString::from_wide(&fs_name)
        .to_string_lossy()
        .trim_matches('\0')
        .to_string();
    if !fs_str.eq_ignore_ascii_case("NTFS") {
        return false;
    }

    // Check if we can open the raw volume handle (requires Administrator privileges)
    let vol_path = format!(r"\\.\{}:", letter);
    let vol_wide: Vec<u16> = vol_path.encode_utf16().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            vol_wide.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::FILE_GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        false
    } else {
        unsafe { CloseHandle(handle) };
        true
    }
}

/// A parsed record entry from the MFT.
struct MftRecord {
    record_num: u64,
    parent_num: u64,
    name: Box<str>,
    is_dir: bool,
    apparent: u64,
    on_disk: u64,
    flags: u8,
    modified: u64,
}

/// Scans `root` directly using the NTFS Master File Table.
pub fn scan_mft(root: &Path, opts: &Options, progress: &Progress) -> io::Result<Tree> {
    let started = Instant::now();
    let canonical = fs::canonicalize(root)?;
    if !canonical.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "scan root is not a folder"));
    }

    let letter = drive_letter(&canonical)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "cannot determine drive letter"))?;

    let vol_path = format!(r"\\.\{}:", letter);
    let vol_wide: Vec<u16> = vol_path.encode_utf16().chain(Some(0)).collect();

    let handle = unsafe {
        CreateFileW(
            vol_wide.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::FILE_GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        let err = unsafe { GetLastError() };
        return Err(io::Error::from_raw_os_error(err as i32));
    }

    let mut vol_data = NtfsVolumeData::default();
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_GET_NTFS_VOLUME_DATA,
            std::ptr::null(),
            0,
            &mut vol_data as *mut _ as *mut _,
            std::mem::size_of::<NtfsVolumeData>() as u32,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        unsafe { CloseHandle(handle) };
        return Err(io::Error::other("FSCTL_GET_NTFS_VOLUME_DATA failed"));
    }

    let cluster_size = vol_data.bytes_per_cluster as u64;
    let record_size = vol_data.bytes_per_record as usize;
    if record_size < 512 || cluster_size == 0 {
        unsafe { CloseHandle(handle) };
        return Err(io::Error::other("invalid NTFS volume geometry"));
    }

    // Read Record 0 to extract non-resident data runs of $MFT
    let mft_start_offset = vol_data.mft_start_lcn * cluster_size as i64;
    let mut new_pos = 0i64;
    unsafe {
        SetFilePointerEx(handle, mft_start_offset, &mut new_pos, FILE_BEGIN);
    }

    let read_len = (cluster_size as usize).max(record_size);
    let mut rec0_buf = vec![0u8; read_len];
    let mut read_bytes = 0u32;
    let ok = unsafe {
        ReadFile(
            handle,
            rec0_buf.as_mut_ptr() as *mut _,
            read_len as u32,
            &mut read_bytes,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 || (read_bytes as usize) < record_size || &rec0_buf[0..4] != b"FILE" {
        unsafe { CloseHandle(handle) };
        return Err(io::Error::other("failed to read MFT Record 0"));
    }

    // Fixup Record 0
    apply_fixup(&mut rec0_buf[0..record_size]);

    // Extract data runs of $MFT from Record 0
    let runs = match extract_mft_runs(&rec0_buf[0..record_size]) {
        Some(r) if !r.is_empty() => r,
        _ => {
            unsafe { CloseHandle(handle) };
            return Err(io::Error::other("could not extract $MFT data runs"));
        }
    };

    // Buffer for reading in 1 MB chunks
    let chunk_size = 1024 * 1024;
    let mut chunk = vec![0u8; chunk_size];

    // Indexed records: parent_num -> list of child records
    let mut children_by_parent: HashMap<u64, Vec<MftRecord>> = HashMap::new();
    let mut records_by_num: HashMap<u64, (u64, Box<str>, bool)> = HashMap::new();

    let mut total_files = 0u64;
    let mut total_bytes = 0u64;
    let mut reported_files = 0u64;
    let mut reported_bytes = 0u64;
    let mut last_progress = Instant::now();

    'read_loop: for (lcn, cluster_count) in runs {
        let mut byte_offset = lcn * cluster_size as i64;
        let run_bytes = cluster_count * cluster_size;
        let mut bytes_left = run_bytes;

        while bytes_left > 0 {
            if progress.is_cancelled() {
                break 'read_loop;
            }

            let to_read = (chunk_size as u64).min(bytes_left) as u32;
            unsafe {
                SetFilePointerEx(handle, byte_offset, &mut new_pos, FILE_BEGIN);
            }
            let mut read = 0u32;
            let ok = unsafe {
                ReadFile(
                    handle,
                    chunk.as_mut_ptr() as *mut _,
                    to_read,
                    &mut read,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || read == 0 {
                break;
            }
            byte_offset += read as i64;
            bytes_left -= read as u64;

            let num_records = read as usize / record_size;
            for r in 0..num_records {
                let r_off = r * record_size;
                let rec = &mut chunk[r_off..r_off + record_size];
                if &rec[0..4] != b"FILE" {
                    continue;
                }

                let r_flags = u16::from_le_bytes([rec[22], rec[23]]);
                if (r_flags & 1) == 0 {
                    continue; // Deleted or free record
                }

                let base_frn = u64::from_le_bytes([
                    rec[32], rec[33], rec[34], rec[35], rec[36], rec[37], rec[38], rec[39],
                ]) & 0x0000_FFFF_FFFF_FFFF;
                if base_frn != 0 {
                    continue; // Skip extension records; base record holds directory links
                }

                let record_num = u32::from_le_bytes([rec[44], rec[45], rec[46], rec[47]]) as u64;

                apply_fixup(rec);

                if let Some(entry) = parse_mft_record(record_num, rec, cluster_size) {
                    if !entry.is_dir {
                        total_files += 1;
                        total_bytes += entry.on_disk;
                    }

                    records_by_num.insert(entry.record_num, (entry.parent_num, entry.name.clone(), entry.is_dir));
                    children_by_parent
                        .entry(entry.parent_num)
                        .or_default()
                        .push(entry);
                }
            }

            if last_progress.elapsed().as_millis() >= 100 {
                let df = total_files - reported_files;
                let db = total_bytes - reported_bytes;
                if df > 0 || db > 0 {
                    progress.add_dir(df, db, 0);
                    reported_files = total_files;
                    reported_bytes = total_bytes;
                }
                last_progress = Instant::now();
            }
        }
    }

    unsafe { CloseHandle(handle) };

    // Resolve the target root record number.
    // In NTFS, the drive root `\` is always record 5.
    let target_frn = resolve_target_frn(&canonical, &records_by_num, &children_by_parent)?;

    // Build the final Tree
    let cancelled = progress.is_cancelled();
    let tree = build_tree_from_mft(
        canonical,
        target_frn,
        &children_by_parent,
        opts,
        started.elapsed(),
        cancelled,
    );

    Ok(tree)
}

/// Applies the NTFS multi-sector update sequence array fixup to an in-memory MFT record.
fn apply_fixup(rec: &mut [u8]) {
    if rec.len() < 512 {
        return;
    }
    let usa_off = u16::from_le_bytes([rec[4], rec[5]]) as usize;
    let usa_cnt = u16::from_le_bytes([rec[6], rec[7]]) as usize;
    if usa_off + usa_cnt * 2 > rec.len() || usa_cnt == 0 {
        return;
    }
    let seq = rec[usa_off..usa_off + usa_cnt * 2].to_vec();
    for i in 1..usa_cnt {
        let sec_end = i * 512;
        if sec_end <= rec.len() {
            rec[sec_end - 2] = seq[i * 2];
            rec[sec_end - 1] = seq[i * 2 + 1];
        }
    }
}

/// Decodes the run-length encoded data runs of a non-resident attribute.
fn extract_mft_runs(rec: &[u8]) -> Option<Vec<(i64, u64)>> {
    let attrs_off = u16::from_le_bytes([rec[20], rec[21]]) as usize;
    let mut off = attrs_off;
    while off + 8 <= rec.len() {
        let attr_type = u32::from_le_bytes([rec[off], rec[off + 1], rec[off + 2], rec[off + 3]]);
        if attr_type == 0xFFFF_FFFF {
            break;
        }
        let attr_len = u32::from_le_bytes([rec[off + 4], rec[off + 5], rec[off + 6], rec[off + 7]]) as usize;
        if attr_len == 0 || off + attr_len > rec.len() {
            break;
        }

        if attr_type == ATTR_DATA && rec[off + 8] == 1 {
            // Non-resident $DATA
            let run_off = u16::from_le_bytes([rec[off + 32], rec[off + 33]]) as usize;
            let mut p = off + run_off;
            let mut current_lcn: i64 = 0;
            let mut runs = Vec::new();

            while p < off + attr_len {
                let header = rec[p];
                p += 1;
                if header == 0 {
                    break;
                }
                let len_bytes = (header & 0x0F) as usize;
                let off_bytes = ((header >> 4) & 0x0F) as usize;
                if len_bytes == 0 || p + len_bytes + off_bytes > rec.len() {
                    break;
                }
                let mut len: u64 = 0;
                for i in 0..len_bytes {
                    len |= (rec[p + i] as u64) << (i * 8);
                }
                p += len_bytes;
                let mut lcn_off: i64 = 0;
                for i in 0..off_bytes {
                    lcn_off |= (rec[p + i] as i64) << (i * 8);
                }
                if off_bytes > 0 && (rec[p + off_bytes - 1] & 0x80) != 0 {
                    for i in off_bytes..8 {
                        lcn_off |= 0xFFi64 << (i * 8);
                    }
                }
                p += off_bytes;
                current_lcn += lcn_off;
                runs.push((current_lcn, len));
            }
            return Some(runs);
        }
        off += attr_len;
    }
    None
}

/// Parses an MFT record and extracts its primary name, parent directory, size, and attributes.
fn parse_mft_record(record_num: u64, rec: &[u8], cluster_size: u64) -> Option<MftRecord> {
    let r_flags = u16::from_le_bytes([rec[22], rec[23]]);
    let is_dir = (r_flags & 2) != 0;

    let attrs_off = u16::from_le_bytes([rec[20], rec[21]]) as usize;
    let mut off = attrs_off;

    let mut best_name: Option<String> = None;
    let mut best_parent: u64 = 0;
    let mut modified = 0u64;
    let mut apparent = 0u64;
    let mut on_disk = 0u64;
    let mut node_flags = 0u8;

    while off + 8 <= rec.len() {
        let attr_type = u32::from_le_bytes([rec[off], rec[off + 1], rec[off + 2], rec[off + 3]]);
        if attr_type == 0xFFFF_FFFF {
            break;
        }
        let attr_len = u32::from_le_bytes([rec[off + 4], rec[off + 5], rec[off + 6], rec[off + 7]]) as usize;
        if attr_len == 0 || off + attr_len > rec.len() {
            break;
        }

        match attr_type {
            ATTR_STANDARD_INFORMATION => {
                if rec[off + 8] == 0 && off + 24 <= rec.len() {
                    let val_off = u16::from_le_bytes([rec[off + 20], rec[off + 21]]) as usize;
                    let val = off + val_off;
                    if val + 32 <= off + attr_len && val + 32 <= rec.len() {
                        let m_ft = u64::from_le_bytes([
                            rec[val + 8], rec[val + 9], rec[val + 10], rec[val + 11],
                            rec[val + 12], rec[val + 13], rec[val + 14], rec[val + 15],
                        ]);
                        modified = filetime_to_unix(m_ft);
                    }
                }
            }
            ATTR_FILE_NAME => {
                if rec[off + 8] == 0 && off + 24 <= rec.len() {
                    let val_off = u16::from_le_bytes([rec[off + 20], rec[off + 21]]) as usize;
                    let val = off + val_off;
                    if val + 66 <= off + attr_len && val + 66 <= rec.len() {
                        let parent_frn = u64::from_le_bytes([
                            rec[val], rec[val + 1], rec[val + 2], rec[val + 3],
                            rec[val + 4], rec[val + 5], rec[val + 6], rec[val + 7],
                        ]) & 0x0000_FFFF_FFFF_FFFF;

                        let name_len = rec[val + 64] as usize;
                        let ns = rec[val + 65]; // 0: POSIX, 1: Win32, 2: DOS, 3: Win32 & DOS

                        if val + 66 + name_len * 2 <= off + attr_len && val + 66 + name_len * 2 <= rec.len() {
                            let chars: Vec<u16> = (0..name_len)
                                .map(|i| u16::from_le_bytes([rec[val + 66 + i * 2], rec[val + 66 + i * 2 + 1]]))
                                .collect();
                            let name = String::from_utf16_lossy(&chars);

                            // Prefer Win32 / POSIX names over 8.3 short names
                            if best_name.is_none() || ns == 1 || ns == 3 {
                                best_name = Some(name);
                                best_parent = parent_frn;
                            }
                        }
                    }
                }
            }
            ATTR_DATA => {
                // Default unnamed stream
                let name_len = rec[off + 9] as usize;
                if name_len == 0 {
                    let non_res = rec[off + 8];
                    if non_res == 0 && off + 20 <= rec.len() {
                        // Resident data
                        let val_len = u32::from_le_bytes([rec[off + 16], rec[off + 17], rec[off + 18], rec[off + 19]]) as u64;
                        apparent = val_len;
                        on_disk = if val_len > 0 { cluster_size } else { 0 };
                    } else if non_res == 1 && off + 56 <= rec.len() {
                        // Non-resident data
                        let alloc = u64::from_le_bytes([
                            rec[off + 40], rec[off + 41], rec[off + 42], rec[off + 43],
                            rec[off + 44], rec[off + 45], rec[off + 46], rec[off + 47],
                        ]);
                        let real = u64::from_le_bytes([
                            rec[off + 48], rec[off + 49], rec[off + 50], rec[off + 51],
                            rec[off + 52], rec[off + 53], rec[off + 54], rec[off + 55],
                        ]);
                        apparent = real;
                        on_disk = alloc;

                        // Check compressed or sparse flags
                        let comp_unit = u16::from_le_bytes([rec[off + 34], rec[off + 35]]);
                        if comp_unit != 0 {
                            node_flags |= flags::COMPRESSED;
                        }
                    }
                }
            }
            ATTR_REPARSE_POINT => {
                node_flags |= flags::REPARSE;
                if rec[off + 8] == 0 && off + 24 <= rec.len() {
                    let val_off = u16::from_le_bytes([rec[off + 20], rec[off + 21]]) as usize;
                    let val = off + val_off;
                    if val + 4 <= off + attr_len && val + 4 <= rec.len() {
                        let tag = u32::from_le_bytes([rec[val], rec[val + 1], rec[val + 2], rec[val + 3]]);
                        if tag & TAG_CLOUD_MASK == TAG_CLOUD {
                            node_flags |= flags::CLOUD;
                        }
                    }
                }
            }
            _ => {}
        }
        off += attr_len;
    }

    let name = best_name?;

    // Record numbers < 16 are reserved NTFS system metadata (0: $MFT, 1: $MFTMirr, ..., 5: Root directory).
    // Root directory (FRN 5) is the container itself, not a child.
    if record_num < 16 || record_num == best_parent {
        return None;
    }

    // Filter out dot, dotdot, or empty names.
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    // Filter out internal system metadata files directly in the root ($MFT, $LogFile, etc.)
    // unless they belong to normal user directories.
    if best_parent == 5 && name.starts_with('$') && !name.starts_with("$RECYCLE.BIN") {
        return None;
    }

    Some(MftRecord {
        record_num,
        parent_num: best_parent,
        name: name.into_boxed_str(),
        is_dir,
        apparent,
        on_disk,
        flags: node_flags,
        modified,
    })
}

/// Resolves the root FRN for `canonical`.
/// For a drive root (e.g. `C:\`), it is always record 5.
/// For subfolders, it traces the components down from record 5.
fn resolve_target_frn(
    canonical: &Path,
    _records: &HashMap<u64, (u64, Box<str>, bool)>,
    children: &HashMap<u64, Vec<MftRecord>>,
) -> io::Result<u64> {
    let s = canonical.to_str().unwrap_or("");
    let s = s.strip_prefix(r"\\?\").unwrap_or(s);

    let parts: Vec<&str> = s
        .split(['\\', '/'])
        .filter(|p| !p.is_empty() && !p.ends_with(':'))
        .collect();

    let mut current_frn: u64 = 5; // Root directory in NTFS

    for part in parts {
        let child_list = children.get(&current_frn).ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("folder not found in MFT: {part}"))
        })?;

        let found = child_list
            .iter()
            .find(|c| c.is_dir && c.name.eq_ignore_ascii_case(part))
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, format!("subfolder not found in MFT: {part}"))
            })?;

        current_frn = found.record_num;
    }

    Ok(current_frn)
}

/// Converts the collected MFT hierarchy into a flat `jard_scan::Tree` with `child_id > parent_id`.
fn build_tree_from_mft(
    root_path: PathBuf,
    target_frn: u64,
    children_by_parent: &HashMap<u64, Vec<MftRecord>>,
    opts: &Options,
    elapsed: std::time::Duration,
    cancelled: bool,
) -> Tree {
    let mut nodes: Vec<Node> = Vec::new();

    // Track visited directory FRNs to prevent cycles, self-references, or duplicate traversal
    let mut visited_dirs: std::collections::HashSet<u64> = std::collections::HashSet::new();
    visited_dirs.insert(target_frn);

    // BFS Queue: (&MftRecord, parent_node_id, depth)
    let mut queue = std::collections::VecDeque::new();

    // Root node is at index 0
    let root_display = display_path(&root_path);
    let root_node = Node::new(Tree::ROOT, root_display.into(), None, true);
    nodes.push(root_node);

    if let Some(direct_children) = children_by_parent.get(&target_frn) {
        for c in direct_children {
            if !c.is_dir || visited_dirs.insert(c.record_num) {
                queue.push_back((c, Tree::ROOT, 1u32));
            }
        }
    }

    while let Some((entry, parent_id, depth)) = queue.pop_front() {
        let node_id = nodes.len() as NodeId;
        debug_assert!(node_id > parent_id, "child ID must be greater than parent ID");

        let mut node = Node::new(node_id, entry.name.clone(), Some(parent_id), entry.is_dir);
        node.apparent = entry.apparent;
        node.on_disk = entry.on_disk;
        node.flags = entry.flags;
        node.modified = entry.modified;

        if !entry.is_dir {
            node.files = 1;
            node.own_apparent = entry.apparent;
            node.own_on_disk = entry.on_disk;
            node.own_files = 1;
            let parent = &mut nodes[parent_id as usize];
            parent.own_apparent += entry.apparent;
            parent.own_on_disk += entry.on_disk;
            parent.own_files += 1;
        }

        // Check excluded folders
        let is_excluded = entry.is_dir && opts.excluded.iter().any(|ex| {
            ex.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.eq_ignore_ascii_case(&entry.name))
        });

        // Reparse points (junctions, symlinks) must not be traversed as directories.
        // Only cloud directories (e.g. OneDrive placeholders) are traversed.
        let is_reparse_dir = entry.is_dir && (entry.flags & flags::REPARSE != 0) && (entry.flags & flags::CLOUD == 0);

        // Check depth limit
        let depth_limited = opts.max_depth.is_some_and(|max| depth >= max);

        nodes[parent_id as usize].children.push(node_id);
        nodes.push(node);

        if entry.is_dir && !is_excluded && !is_reparse_dir {
            if depth_limited {
                nodes[node_id as usize].flags |= flags::PARTIAL;
            } else if let Some(sub_children) = children_by_parent.get(&entry.record_num) {
                for sc in sub_children {
                    if !sc.is_dir || visited_dirs.insert(sc.record_num) {
                        queue.push_back((sc, node_id, depth + 1));
                    }
                }
            }
        }
    }

    // Initialize every folder's totals with its own direct files before tree rollup
    for node in &mut nodes {
        if node.is_dir {
            node.apparent = node.own_apparent;
            node.on_disk = node.own_on_disk;
            node.files = node.own_files;
        }
    }

    Tree::build(root_path, nodes, elapsed, cancelled)
}
