//! Is a flash drive as big as it claims? Fake drives accept writes past their real size and quietly
//! wrap around, so the only honest test is to write known data, read it back and compare.
//!
//! Only the drive's free space is used and the test files are removed afterwards. On a genuinely
//! fake drive, though, writing past the real size can damage what is already there: the UI says so.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

const BLOCK: usize = 1024 * 1024;
const BLOCKS_PER_FILE: u64 = 64;
const SECTOR: usize = 4096;

/// A marker in every test file's name, so only our own files are ever removed.
const PREFIX: &str = "jard-capacity-test-";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityResult {
    pub written: u64,
    /// Bytes read back correctly, counted from the start.
    pub verified: u64,
    /// False when data came back different: the drive is smaller than it claims, or failing.
    pub ok: bool,
    pub cancelled: bool,
}

/// The same block for the same position every time, and different for every position.
fn fill(buf: &mut [u8], file: u64, block: u64) {
    let mut x = (file << 32 | block) ^ 0x9E37_79B9_7F4A_7C15;
    for chunk in buf.as_chunks_mut::<8>().0 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        chunk.copy_from_slice(&x.to_le_bytes());
    }
}

fn aligned_block() -> (Vec<u8>, usize) {
    let buf = vec![0u8; BLOCK + SECTOR];
    let off = (SECTOR - (buf.as_ptr() as usize % SECTOR)) % SECTOR;
    (buf, off)
}

fn open_uncached_read(path: &Path) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.read(true);
    // Without this, Windows answers from its cache and a fake drive looks perfect.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        o.custom_flags(0x2000_0000); // FILE_FLAG_NO_BUFFERING
    }
    o.open(path)
}

/// Writes up to `limit` bytes of test data into `dir`, verifies it, and removes it. Stops writing
/// at the first write error, which is what a full drive looks like. `progress` gets bytes so far.
pub fn test_capacity(
    dir: &Path,
    limit: u64,
    stop: &AtomicBool,
    mut progress: impl FnMut(&'static str, u64),
) -> io::Result<CapacityResult> {
    let mut files: Vec<PathBuf> = Vec::new();
    let run = (|| -> io::Result<CapacityResult> {
        let (mut buf, off) = aligned_block();
        let mut written = 0u64;
        let mut file_no = 0u64;
        'writing: while written < limit {
            let path = dir.join(format!("{PREFIX}{file_no}.tmp"));
            let mut f = match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(f) => f,
                Err(_) if written > 0 => break,
                Err(e) => return Err(e),
            };
            files.push(path);
            for block in 0..BLOCKS_PER_FILE {
                if stop.load(Ordering::Relaxed) {
                    return Ok(CapacityResult { written, verified: 0, ok: true, cancelled: true });
                }
                if written + BLOCK as u64 > limit {
                    break 'writing;
                }
                fill(&mut buf[off..off + BLOCK], file_no, block);
                if f.write_all(&buf[off..off + BLOCK]).is_err() {
                    break 'writing; // no room left: everything before this still gets verified
                }
                written += BLOCK as u64;
                progress("write", written);
            }
            f.sync_all()?;
            file_no += 1;
        }

        let mut expected = vec![0u8; BLOCK];
        let mut verified = 0u64;
        for (file_no, path) in files.iter().enumerate() {
            let mut f = open_uncached_read(path)?;
            for block in 0..BLOCKS_PER_FILE {
                if verified >= written {
                    break;
                }
                if stop.load(Ordering::Relaxed) {
                    return Ok(CapacityResult { written, verified, ok: true, cancelled: true });
                }
                if f.read_exact(&mut buf[off..off + BLOCK]).is_err() {
                    return Ok(CapacityResult { written, verified, ok: false, cancelled: false });
                }
                fill(&mut expected, file_no as u64, block);
                if buf[off..off + BLOCK] != expected[..] {
                    return Ok(CapacityResult { written, verified, ok: false, cancelled: false });
                }
                verified += BLOCK as u64;
                progress("verify", verified);
            }
        }
        Ok(CapacityResult { written, verified, ok: true, cancelled: false })
    })();
    for f in &files {
        let _ = fs::remove_file(f);
    }
    run
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("jard-cap-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_healthy_folder_verifies_and_is_left_clean() {
        let d = temp("ok");
        fs::write(d.join("keep.txt"), b"mine").unwrap();
        let limit = 70 * BLOCK as u64; // crosses into a second file
        let r = test_capacity(&d, limit, &AtomicBool::new(false), |_, _| {}).unwrap();
        assert_eq!((r.written, r.verified, r.ok, r.cancelled), (limit, limit, true, false));
        let left: Vec<_> = fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, ["keep.txt"], "only the person's file remains");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn stopping_leaves_no_test_files() {
        let d = temp("stop");
        let r = test_capacity(&d, 8 * BLOCK as u64, &AtomicBool::new(true), |_, _| {}).unwrap();
        assert!(r.cancelled);
        assert_eq!(fs::read_dir(&d).unwrap().count(), 0);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn positions_never_share_data_so_wraparound_is_caught() {
        let (mut a, mut b) = (vec![0u8; 4096], vec![0u8; 4096]);
        fill(&mut a, 0, 0);
        fill(&mut b, 0, 1);
        assert_ne!(a, b, "next block");
        fill(&mut b, 1, 0);
        assert_ne!(a, b, "next file");
        fill(&mut b, 0, 0);
        assert_eq!(a, b, "same position repeats");
    }
}
