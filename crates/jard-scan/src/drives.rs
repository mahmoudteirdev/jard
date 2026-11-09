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

/// Lists drives. On Windows: every drive letter. Elsewhere: every mount point backed by a device.
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

/// Reads the output of `df -kP`: the one format both Linux and macOS promise.
#[cfg_attr(windows, allow(dead_code))]
fn parse_df(text: &str) -> Vec<Drive> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            // Filesystem 1024-blocks Used Available Capacity Mounted-on, and the last may hold spaces.
            let mut parts = line.split_whitespace();
            let device = parts.next()?;
            let total: u64 = parts.next()?.parse().ok()?;
            let _used: u64 = parts.next()?.parse().ok()?;
            let free: u64 = parts.next()?.parse().ok()?;
            let _capacity = parts.next()?;
            let root = parts.collect::<Vec<_>>().join(" ");
            // tmpfs, devfs and the like are not disks anyone wants to clean.
            let is_disk = device.starts_with("/dev/") && !device.starts_with("/dev/loop");
            let network = device.contains(':') || device.starts_with("//");
            if root.is_empty() || total == 0 || !(is_disk || network) {
                return None;
            }
            let kind = if network {
                DriveKind::Network
            } else if root.starts_with("/media") || root.starts_with("/run/media") || root.starts_with("/Volumes") {
                DriveKind::Removable
            } else {
                DriveKind::Fixed
            };
            Some(Drive { root, label: String::new(), fs: String::new(), kind, total: total * 1024, free: free * 1024, ready: true })
        })
        .collect()
}

#[cfg(not(windows))]
mod imp {
    pub fn list() -> Vec<super::Drive> {
        std::process::Command::new("df")
            .arg("-kP")
            .output()
            .map(|o| super::parse_df(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod df_tests {
    use super::*;

    #[test]
    fn reads_df_and_skips_what_is_not_a_disk() {
        let text = "Filesystem 1024-blocks Used Available Capacity Mounted on\n\
            /dev/nvme0n1p2 1000 400 600 40% /\n\
            tmpfs 500 0 500 0% /run\n\
            /dev/loop3 100 100 0 100% /snap/core/1\n\
            /dev/sdb1 2000 0 2000 0% /media/me/My Disk\n\
            nas:/share 3000 0 3000 0% /mnt/nas\n";
        let d = parse_df(text);
        let roots: Vec<_> = d.iter().map(|x| x.root.as_str()).collect();
        assert_eq!(roots, ["/", "/media/me/My Disk", "/mnt/nas"]);
        assert_eq!(d[0].kind, DriveKind::Fixed);
        assert_eq!(d[0].free, 600 * 1024);
        assert_eq!(d[1].kind, DriveKind::Removable);
        assert_eq!(d[2].kind, DriveKind::Network);
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
