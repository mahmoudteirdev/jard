//! Mounted drives and their free space, for the drive picker.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DriveKind {
    Fixed,
    Removable,
    Network,
    Optical,
    Ram,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// Path to scan: `C:\` on Windows.
    pub root: String,
    /// Volume label; may be empty.
    pub label: String,
    /// File system name such as `NTFS`; empty when not ready.
    pub fs: String,
    pub kind: DriveKind,
    pub total: u64,
    pub free: u64,
    /// False for an empty card reader or optical drive: nothing to scan.
    pub ready: bool,
}

/// Lists drives. On Windows: every drive letter. Elsewhere: not implemented yet, returns nothing.
pub fn list() -> Vec<Drive> {
    imp::list()
}

#[cfg(windows)]
mod imp {
    use super::{Drive, DriveKind};
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
    };

    fn text(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    pub fn list() -> Vec<Drive> {
        let mut buf = [0u16; 512];
        // SAFETY: buffer and its length are valid. Returns the length written, without the final NUL.
        let len = unsafe { GetLogicalDriveStringsW(buf.len() as u32, buf.as_mut_ptr()) } as usize;
        if len == 0 || len > buf.len() {
            return Vec::new();
        }
        // "C:\\\0D:\\\0\0": NUL-separated roots
        buf[..len].split(|&c| c == 0).filter(|r| !r.is_empty()).map(drive).collect()
    }

    fn drive(root: &[u16]) -> Drive {
        let root_nul: Vec<u16> = root.iter().copied().chain([0]).collect();
        // SAFETY: NUL-terminated path.
        let kind = match unsafe { GetDriveTypeW(root_nul.as_ptr()) } {
            2 => DriveKind::Removable,
            3 => DriveKind::Fixed,
            4 => DriveKind::Network,
            5 => DriveKind::Optical,
            6 => DriveKind::Ram,
            _ => DriveKind::Unknown,
        };
        let mut label = [0u16; 261];
        let mut fs = [0u16; 261];
        // SAFETY: all buffers valid with their lengths passed; unused outputs are null.
        let ready = unsafe {
            GetVolumeInformationW(
                root_nul.as_ptr(),
                label.as_mut_ptr(),
                label.len() as u32,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                fs.as_mut_ptr(),
                fs.len() as u32,
            )
        } != 0;
        let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
        if ready {
            // SAFETY: valid out pointers.
            unsafe { GetDiskFreeSpaceExW(root_nul.as_ptr(), &mut avail, &mut total, &mut free) };
        }
        Drive {
            root: String::from_utf16_lossy(root),
            label: if ready { text(&label) } else { String::new() },
            fs: if ready { text(&fs) } else { String::new() },
            kind,
            total,
            free,
            ready,
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn list() -> Vec<super::Drive> {
        Vec::new()
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn system_drive_is_listed() {
        let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let drives = super::list();
        let c = drives.iter().find(|d| d.root.eq_ignore_ascii_case(&format!("{sys}\\"))).expect("system drive");
        assert!(c.ready && c.total > 0 && c.free <= c.total, "{c:?}");
        assert_eq!(c.kind, super::DriveKind::Fixed);
    }
}
