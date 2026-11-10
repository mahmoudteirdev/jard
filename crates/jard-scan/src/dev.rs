//! Developer bloat scanner: detects abandoned projects and their cleanable artifacts
//! (node_modules, target, .venv, build, etc.) without touching source code or git histories.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevArtifact {
    pub name: String,
    pub path: PathBuf,
    pub apparent: u64,
    pub on_disk: u64,
    pub files: u64,
    pub clean_cmd: String,
    pub reinstall_cmd: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevProject {
    pub path: PathBuf,
    pub name: String,
    pub kind: String,
    pub last_modified: u64,
    pub days_inactive: u32,
    pub status: String, // "Active" (<30d), "Stale" (30-90d), "Abandoned" (>90d)
    pub artifacts: Vec<DevArtifact>,
    pub total_apparent: u64,
    pub total_on_disk: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Computes apparent and on-disk size for a folder recursively.
fn measure_folder(path: &Path) -> (u64, u64, u64) {
    let mut apparent = 0u64;
    let mut on_disk = 0u64;
    let mut files = 0u64;

    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                // Do not follow symlinks/junctions
                if !meta.file_type().is_symlink() {
                    stack.push(p);
                }
            } else {
                files += 1;
                let len = meta.len();
                apparent += len;
                // Estimate cluster allocation (4096 cluster size minimum on NTFS)
                let rounded = if len == 0 { 0 } else { len.div_ceil(4096) * 4096 };
                on_disk += rounded;
            }
        }
    }
    (apparent, on_disk, files)
}

/// Finds the most recent modification timestamp in a project root.
fn get_project_last_modified(project_dir: &Path) -> u64 {
    let mut latest = 0u64;

    // Check git index/HEAD first if present
    let git_head = project_dir.join(".git").join("HEAD");
    if let Ok(meta) = fs::metadata(&git_head) {
        if let Ok(modified) = meta.modified() {
            if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
                latest = latest.max(d.as_secs());
            }
        }
    }

    // Check top-level files
    if let Ok(entries) = fs::read_dir(project_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            // Skip large artifact folders when checking timestamps
            if name_str == "node_modules"
                || name_str == "target"
                || name_str == ".venv"
                || name_str == "venv"
                || name_str == ".git"
            {
                continue;
            }

            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
                        latest = latest.max(d.as_secs());
                    }
                }
            }
        }
    }

    if latest == 0 {
        if let Ok(meta) = fs::metadata(project_dir) {
            if let Ok(modified) = meta.modified() {
                if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
                    return d.as_secs();
                }
            }
        }
        now_secs()
    } else {
        latest
    }
}

type ArtifactSpec = (&'static str, &'static str, &'static str);

/// Inspects a directory to check if it represents a known developer project and returns its artifact specs.
fn inspect_project(dir: &Path) -> Option<(String, Vec<ArtifactSpec>)> {
    let has_file = |name: &str| dir.join(name).is_file();

    if has_file("package.json") {
        Some((
            "Node".to_string(),
            vec![
                ("node_modules", "npm prune / rm -rf", "npm install"),
                (".next", "rm -rf .next", "npm run build"),
                (".nuxt", "rm -rf .nuxt", "npm run build"),
                (".turbo", "rm -rf .turbo", "turbo build"),
                ("dist", "rm -rf dist", "npm run build"),
            ],
        ))
    } else if has_file("Cargo.toml") {
        Some((
            "Rust".to_string(),
            vec![("target", "cargo clean", "cargo build")],
        ))
    } else if has_file("pyproject.toml")
        || has_file("requirements.txt")
        || has_file("Pipfile")
        || has_file("setup.py")
    {
        Some((
            "Python".to_string(),
            vec![
                (".venv", "rm -rf .venv", "python -m venv .venv"),
                ("venv", "rm -rf venv", "python -m venv venv"),
                ("__pycache__", "rm -rf __pycache__", "python"),
                (".pytest_cache", "rm -rf .pytest_cache", "pytest"),
            ],
        ))
    } else if has_file("build.gradle") || has_file("build.gradle.kts") || has_file("pom.xml") {
        Some((
            "Gradle".to_string(),
            vec![
                ("build", "./gradlew clean", "./gradlew build"),
                (".gradle", "rm -rf .gradle", "./gradlew build"),
            ],
        ))
    } else if has_file("pubspec.yaml") {
        Some((
            "Flutter".to_string(),
            vec![
                (".dart_tool", "flutter clean", "flutter pub get"),
                ("build", "flutter clean", "flutter build"),
            ],
        ))
    } else {
        None
    }
}

/// Scans given directory roots for developer projects and their cleanable artifacts.
pub fn scan_dev_projects(roots: &[PathBuf], max_depth: usize) -> Vec<DevProject> {
    let mut results = Vec::new();
    let current_time = now_secs();

    for root in roots {
        if !root.is_dir() {
            continue;
        }

        let mut queue: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];

        while let Some((dir, depth)) = queue.pop() {
            if depth > max_depth {
                continue;
            }

            // Check if this directory is a project
            if let Some((kind, artifact_specs)) = inspect_project(&dir) {
                let mut artifacts = Vec::new();
                let mut total_apparent = 0u64;
                let mut total_on_disk = 0u64;

                for (art_name, clean_cmd, reinstall_cmd) in artifact_specs {
                    let art_path = dir.join(art_name);
                    if art_path.is_dir() {
                        let (apparent, on_disk, files) = measure_folder(&art_path);
                        if apparent > 0 || files > 0 {
                            total_apparent += apparent;
                            total_on_disk += on_disk;
                            artifacts.push(DevArtifact {
                                name: art_name.to_string(),
                                path: art_path,
                                apparent,
                                on_disk,
                                files,
                                clean_cmd: clean_cmd.to_string(),
                                reinstall_cmd: reinstall_cmd.to_string(),
                            });
                        }
                    }
                }

                if !artifacts.is_empty() {
                    let last_modified = get_project_last_modified(&dir);
                    let diff_secs = current_time.saturating_sub(last_modified);
                    let days_inactive = (diff_secs / 86400) as u32;

                    let status = match days_inactive {
                        0..=29 => "Active".to_string(),
                        30..=89 => "Stale".to_string(),
                        _ => "Abandoned".to_string(),
                    };

                    let name = dir
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| dir.display().to_string());

                    results.push(DevProject {
                        path: dir.clone(),
                        name,
                        kind,
                        last_modified,
                        days_inactive,
                        status,
                        artifacts,
                        total_apparent,
                        total_on_disk,
                    });
                }

                // If this is a project, do not search deeper inside its build/node_modules directories,
                // but we might check sibling sub-packages in a monorepo
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if entry.file_type().is_ok_and(|ft| ft.is_dir())
                            && !name_str.starts_with('.')
                            && name_str != "node_modules"
                            && name_str != "target"
                            && name_str != "build"
                            && name_str != "dist"
                            && name_str != "vendor"
                        {
                            queue.push((path, depth + 1));
                        }
                    }
                }
            } else {
                // Not a recognized project, recurse deeper
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();

                        // Skip hidden system/tooling directories
                        if entry.file_type().is_ok_and(|ft| ft.is_dir())
                            && !name_str.starts_with('.')
                            && name_str != "node_modules"
                            && name_str != "target"
                            && name_str != "AppData"
                            && name_str != "Windows"
                            && name_str != "Program Files"
                            && name_str != "Program Files (x86)"
                        {
                            queue.push((path, depth + 1));
                        }
                    }
                }
            }
        }
    }

    results.sort_by_key(|a| std::cmp::Reverse(a.total_on_disk));
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn detects_rust_project_with_target() {
        let temp = std::env::temp_dir().join(format!("jard_dev_test_{}", now_secs()));
        let project = temp.join("sample_rust");
        let target = project.join("target");
        fs::create_dir_all(&target).unwrap();

        let mut cargo = File::create(project.join("Cargo.toml")).unwrap();
        writeln!(cargo, "[package]\nname = \"sample\"\nversion = \"0.1.0\"").unwrap();

        let mut dummy = File::create(target.join("dummy.bin")).unwrap();
        writeln!(dummy, "binary data content placeholder").unwrap();
        drop(dummy);
        drop(cargo);

        let projects = scan_dev_projects(std::slice::from_ref(&temp), 3);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].kind, "Rust");
        assert_eq!(projects[0].artifacts.len(), 1);
        assert_eq!(projects[0].artifacts[0].name, "target");
        assert!(projects[0].total_apparent > 0);

        let _ = fs::remove_dir_all(&temp);
    }
}
