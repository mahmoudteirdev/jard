//! Paths Jard refuses to touch, and why. Checked here in Rust, not only in the UI, so a bug or a
//! crafted call in the UI cannot quarantine a system folder.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Why a path may not be moved. The UI turns each into a sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// Windows itself: removing it can stop the machine from booting.
    System,
    /// pagefile.sys and friends, managed by the system.
    SystemFile,
    /// Recycle bin and volume information.
    SystemArea,
    /// A drive, Program Files, the Users folder: holds too much to move as one.
    Container,
    /// A user's profile or a standard folder in it. Its contents can be moved, the folder can't.
    UserFolder,
    /// Contains something protected, so moving it would take that along.
    ContainsProtected,
    /// Jard's own program or data, quarantine included.
    Jard,
}

/// Comparable form: no `\\?\`, backslashes, lower case, no trailing separator.
pub fn normalize(path: &Path) -> String {
    let shown = jard_scan::display_path(path).replace('/', "\\");
    let mut s = shown.to_lowercase();
    while s.ends_with('\\') {
        s.pop();
    }
    s
}

fn is_under(path: &str, dir: &str) -> bool {
    path.len() > dir.len() && path.starts_with(dir) && path.as_bytes()[dir.len()] == b'\\'
}

fn is_drive_root(path: &str) -> bool {
    // "c:" after normalizing, or a bare "\\server\share"
    (path.len() == 2 && path.ends_with(':')) || path.is_empty() || path == "\\" || is_share_root(path)
}

fn is_share_root(path: &str) -> bool {
    path.strip_prefix("\\\\").is_some_and(|rest| rest.split('\\').filter(|s| !s.is_empty()).count() <= 2)
}

/// Names protected wherever they appear at the top of a drive.
const ROOT_FILES: &[&str] = &[
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
    "dumpstack.log",
    "dumpstack.log.tmp",
    "boottel.dat",
    "bootmgr",
    "bootnxt",
];
const ROOT_AREAS: &[&str] = &[
    "$recycle.bin",
    "system volume information",
    "documents and settings",
    "recovery",
    "boot",
    "$windows.~bt",
    "$windows.~ws",
    "$winreagent",
];

#[derive(Debug, Clone, Default)]
pub struct Protected {
    /// Nothing at or under these may move.
    deep: Vec<(String, Reason)>,
    /// These exact folders may not move; what is inside them may.
    exact: Vec<(String, Reason)>,
}

impl Protected {
    /// The list for this machine, plus Jard's own folders.
    pub fn for_this_system(jard_paths: &[PathBuf]) -> Self {
        let mut p = Protected::default();
        for path in jard_paths {
            p.add_deep(path, Reason::Jard);
        }
        if let Ok(exe) = std::env::current_exe() {
            p.add_deep(&exe, Reason::Jard);
        }
        let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
        for k in ["SystemRoot", "windir"] {
            if let Some(d) = env(k) {
                p.add_deep(&d, Reason::System);
            }
        }
        for k in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "ProgramData"] {
            if let Some(d) = env(k) {
                p.add_exact(&d, Reason::Container);
            }
        }
        // Programs expect the temp folder to exist: what is inside may go, the folder may not.
        for k in ["TEMP", "TMP"] {
            if let Some(d) = env(k) {
                p.add_exact(&d, Reason::UserFolder);
            }
        }
        if let Some(d) = env("LOCALAPPDATA") {
            p.add_exact(&d.join("Temp"), Reason::UserFolder);
        }
        if let Some(d) = env("PUBLIC").and_then(|p| p.parent().map(Path::to_path_buf)) {
            p.add_exact(&d, Reason::Container); // C:\Users
        }
        if let Some(home) = env("USERPROFILE") {
            p.add_exact(&home, Reason::UserFolder);
            for sub in [
                "AppData",
                "AppData\\Local",
                "AppData\\LocalLow",
                "AppData\\Roaming",
                "Desktop",
                "Documents",
                "Downloads",
                "Music",
                "Pictures",
                "Videos",
                "OneDrive",
            ] {
                p.add_exact(&home.join(sub), Reason::UserFolder);
            }
            if let Some(users) = home.parent() {
                p.add_exact(users, Reason::Container);
            }
        }
        #[cfg(unix)]
        {
            for d in ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/sbin", "/sys", "/usr", "/var"] {
                p.add_deep(Path::new(d), Reason::System);
            }
            for d in ["/System", "/Library", "/Applications"] {
                p.add_deep(Path::new(d), Reason::System);
            }
            if let Some(home) = env("HOME") {
                p.add_exact(&home, Reason::UserFolder);
            }
        }
        p
    }

    pub fn add_deep(&mut self, path: &Path, reason: Reason) {
        self.deep.push((normalize(path), reason));
    }

    pub fn add_exact(&mut self, path: &Path, reason: Reason) {
        self.exact.push((normalize(path), reason));
    }

    /// Why `path` may not be moved, or `None` if it may.
    pub fn check(&self, path: &Path) -> Option<Reason> {
        let p = normalize(path);
        if is_drive_root(&p) {
            return Some(Reason::Container);
        }
        for (dir, reason) in &self.deep {
            if p == *dir || is_under(&p, dir) {
                return Some(*reason);
            }
        }
        if let Some((_, reason)) = self.exact.iter().find(|(dir, _)| p == *dir) {
            return Some(*reason);
        }
        // Top of a drive: "c:\pagefile.sys", and anything inside "c:\$recycle.bin".
        if let Some((drive, rest)) = p.split_once('\\') {
            if drive.len() == 2 && drive.ends_with(':') {
                if ROOT_FILES.contains(&rest) {
                    return Some(Reason::SystemFile);
                }
                let first = rest.split('\\').next().unwrap_or(rest);
                if ROOT_AREAS.contains(&first) {
                    return Some(Reason::SystemArea);
                }
            }
        }
        // Moving a folder takes everything in it, protected things included.
        if self.deep.iter().chain(&self.exact).any(|(dir, _)| is_under(dir, &p)) {
            return Some(Reason::ContainsProtected);
        }
        None
    }
}
