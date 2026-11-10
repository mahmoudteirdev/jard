//! Ghost files hunter: finds stale downloads, one-time installers, and forgotten archives
//! that were accessed once or never opened again since download.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostFile {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub created: u64,
    pub last_accessed: u64,
    pub days_stale: u32,
    pub category: String, // "Installer", "Archive", "DiskImage", "Document", "Media", "Other"
    pub reason: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn categorize_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "exe" | "msi" | "apk" | "dmg" | "pkg" | "appx" | "msix" | "deb" | "rpm" => {
            Some("Installer")
        }
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" => Some("Archive"),
        "iso" | "img" | "vhd" | "vhdx" | "vmdk" => Some("DiskImage"),
        "pdf" | "docx" | "xlsx" | "pptx" | "csv" | "epub" => Some("Document"),
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "mp3" | "flac" | "wav" => Some("Media"),
        _ => None,
    }
}

/// Scans the given paths for files downloaded/created at least `min_days` ago that have not been
/// accessed since (or accessed only once within 24 hours of download).
pub fn find_ghost_files(roots: &[PathBuf], min_days: u32, min_size_bytes: u64) -> Vec<GhostFile> {
    let mut ghosts = Vec::new();
    let current_time = now_secs();
    let min_age_secs = (min_days as u64) * 86400;

    for root in roots {
        if !root.is_dir() {
            continue;
        }

        let mut stack = vec![root.clone()];

        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                if meta.is_dir() {
                    // Skip hidden folders
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if !name_str.starts_with('.')
                        && !meta.file_type().is_symlink()
                        && name_str != "node_modules"
                        && name_str != "AppData"
                        && name_str != "$RECYCLE.BIN"
                        && name_str != "System Volume Information"
                    {
                        stack.push(path);
                    }
                    continue;
                }

                let size = meta.len();
                if size < min_size_bytes {
                    continue;
                }

                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();

                let category = match categorize_extension(&ext) {
                    Some(cat) => cat.to_string(),
                    None => {
                        // If it's in a Downloads folder and large, treat as Other
                        let in_downloads = path.components().any(|c| {
                            c.as_os_str()
                                .to_string_lossy()
                                .eq_ignore_ascii_case("downloads")
                        });
                        if in_downloads && size >= 5_000_000 {
                            "Other".to_string()
                        } else {
                            continue;
                        }
                    }
                };

                let created = meta
                    .created()
                    .or_else(|_| meta.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs());

                let accessed = meta
                    .accessed()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(created, |d| d.as_secs());

                if created == 0 {
                    continue;
                }

                let age_secs = current_time.saturating_sub(created);
                if age_secs < min_age_secs {
                    continue;
                }

                let days_stale = (age_secs / 86400) as u32;

                // Check access pattern:
                // If accessed is close to created (within 24 hours) or last accessed is older than min_days,
                // it is a candidate ghost file.
                let access_age = current_time.saturating_sub(accessed);
                let untouched_since_download = accessed.saturating_sub(created) <= 86400;

                if untouched_since_download || access_age >= min_age_secs {
                    let reason = if untouched_since_download {
                        format!("تم تنزيله قبل {} يوماً ولم يُفتح مجدداً منذ تاريخ تنزيله", days_stale)
                    } else {
                        let access_days = (access_age / 86400) as u32;
                        format!("آخر استخدام كان قبل {} يوماً", access_days)
                    };

                    let name = entry.file_name().to_string_lossy().to_string();

                    ghosts.push(GhostFile {
                        path,
                        name,
                        size,
                        created,
                        last_accessed: accessed,
                        days_stale,
                        category,
                        reason,
                    });
                }
            }
        }
    }

    ghosts.sort_by_key(|a| std::cmp::Reverse(a.size));
    ghosts
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn detects_stale_installer() {
        let temp = std::env::temp_dir().join(format!("jard_ghost_test_{}", now_secs()));
        fs::create_dir_all(&temp).unwrap();

        let dummy_pkg = temp.join("setup_app.exe");
        let mut file = File::create(&dummy_pkg).unwrap();
        writeln!(file, "dummy installer binary payload").unwrap();
        drop(file);

        // Find ghost files with min_days 0 for testing
        let ghosts = find_ghost_files(std::slice::from_ref(&temp), 0, 10);
        assert_eq!(ghosts.len(), 1);
        assert_eq!(ghosts[0].category, "Installer");
        assert_eq!(ghosts[0].name, "setup_app.exe");

        let _ = fs::remove_dir_all(&temp);
    }
}
