//! jard-clean: the quarantine. Nothing Jard removes is deleted straight away: it moves aside for
//! 30 days and can be put back.
//!
//! Three rules keep this safe:
//!
//! - **A move is a rename on the same drive.** It happens whole or not at all, takes no extra space
//!   and needs no copying, so a crash can't leave half a folder. A file that can't be renamed (open
//!   in another program, no permission) simply stays where it was, and the others still go.
//! - **Protected paths are refused here**, whatever the caller asks ([`protect`]).
//! - **Links are moved, not followed.** Moving a junction moves the junction; what it points at stays.
//!
//! Each item is a folder in the quarantine holding `item.json` and `payload`. The JSON is written
//! first, so after a crash an item either has both or is an unfinished move with nothing to lose.

pub mod capacity;
pub mod protect;

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub use protect::{Protected, Reason};

/// How long an item stays before it is deleted for good.
pub const RETENTION_DAYS: u64 = 30;
const DAY: u64 = 86_400;
/// Hidden folder at the top of a drive, for drives other than the one holding the app's data.
const DRIVE_DIR: &str = ".jard-quarantine";
const ITEM_FILE: &str = "item.json";
const PAYLOAD: &str = "payload";

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// What to move. Sizes come from the scan, so nothing has to be re-measured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub path: PathBuf,
    pub is_dir: bool,
    pub apparent: u64,
    pub on_disk: u64,
    pub files: u64,
}

/// A quarantined file or folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// Where it came from, for showing and for restoring.
    pub original: String,
    pub is_dir: bool,
    pub apparent: u64,
    pub on_disk: u64,
    pub files: u64,
    pub moved_at: u64,
    pub expires_at: u64,
}

/// Why something could not be moved, restored or deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Failure {
    Protected {
        reason: Reason,
    },
    /// Open in another program.
    InUse,
    /// Needs administrator rights.
    Denied,
    /// It is already gone.
    Missing,
    /// Something now sits at the original path.
    Conflict,
    /// No quarantine could be set up on that drive.
    NoQuarantine,
    Other {
        message: String,
    },
}

impl From<io::Error> for Failure {
    fn from(e: io::Error) -> Self {
        // Raw Windows codes: sharing violation, lock violation, and "being used by another process".
        match e.raw_os_error() {
            Some(32 | 33) => return Failure::InUse,
            Some(2 | 3) => return Failure::Missing,
            _ => {}
        }
        match e.kind() {
            io::ErrorKind::PermissionDenied => Failure::Denied,
            io::ErrorKind::NotFound => Failure::Missing,
            _ => Failure::Other { message: e.to_string() },
        }
    }
}

/// Result for one path in a batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub path: String,
    pub item: Option<Item>,
    pub failure: Option<Failure>,
}

/// What a batch would do, with nothing moved.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub movable: Vec<String>,
    pub refused: Vec<Refusal>,
    pub apparent: u64,
    pub on_disk: u64,
    pub files: u64,
    pub effects: Vec<Effect>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub path: String,
    pub reason: Reason,
}

/// A side effect worth knowing about before moving something.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectKind {
    /// In a synced folder: the removal may spread to the person's other devices.
    Synced,
    /// A browser cache: the browser starts slower once, and pages load again.
    BrowserCache,
    /// A package cache: it is downloaded again on the next build. Needs internet.
    PackageCache,
    /// Inside Program Files: the program may stop working.
    InstalledProgram,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub kind: EffectKind,
    pub paths: Vec<String>,
}

fn effect_of(normalized: &str) -> Option<EffectKind> {
    let has = |needle: &str| normalized.contains(needle);
    if has("\\onedrive\\") || has("\\dropbox\\") || has("\\google drive\\") || has("\\icloud") {
        Some(EffectKind::Synced)
    } else if has("\\user data\\") && (has("\\cache") || has("code cache")) || has("\\mozilla\\firefox\\profiles\\") {
        Some(EffectKind::BrowserCache)
    } else if has("npm-cache") || has("\\.npm\\") || has("\\.gradle\\") || has("\\pnpm\\") || has("\\pip\\cache") {
        Some(EffectKind::PackageCache)
    } else if has("\\program files\\") || has("\\program files (x86)\\") {
        Some(EffectKind::InstalledProgram)
    } else {
        None
    }
}

/// What to do when something already sits at the original path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnConflict {
    Fail,
    /// Restore next to it as "name (restored)".
    KeepBoth,
}

/// One line of the operations history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: u64,
    pub kind: LogKind,
    pub count: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogKind {
    Quarantined,
    Restored,
    Deleted,
    Expired,
    Scanned,
    SecureDeleted,
    /// A scheduled rule could not move something. It stays where it was, until the next run.
    RuleFailed,
}

/// The quarantine. Cheap to share: it holds no open files.
pub struct Store {
    data_dir: PathBuf,
    protected: Protected,
    next: AtomicU32,
}

impl Store {
    /// Uses this machine's protected list. `data_dir` holds the log and the main quarantine.
    pub fn open(data_dir: impl Into<PathBuf>) -> io::Result<Self> {
        let data_dir: PathBuf = data_dir.into();
        let protected = Protected::for_this_system(std::slice::from_ref(&data_dir));
        Self::with_protected(data_dir, protected)
    }

    pub fn with_protected(data_dir: impl Into<PathBuf>, mut protected: Protected) -> io::Result<Self> {
        let data_dir: PathBuf = data_dir.into();
        fs::create_dir_all(&data_dir)?;
        let data_dir = fs::canonicalize(&data_dir)?; // on Windows `\\?\`: long paths work below it
        protected.add_deep(&data_dir, Reason::Jard);
        Ok(Store { data_dir, protected, next: AtomicU32::new(0) })
    }

    /// Why `path` may not be moved, if so. Used to grey out the action before anyone asks.
    pub fn check(&self, path: &Path) -> Option<Reason> {
        if path.file_name().is_some_and(|n| n == DRIVE_DIR)
            || path.ancestors().any(|a| a.file_name().is_some_and(|n| n == DRIVE_DIR))
        {
            return Some(Reason::Jard);
        }
        self.protected.check(path)
    }

    fn main_quarantine(&self) -> PathBuf {
        self.data_dir.join("quarantine")
    }

    /// The quarantine on the same drive as `target`, because a move must stay a rename.
    fn quarantine_for(&self, target: &Path) -> Option<PathBuf> {
        let want = volume_of(target)?;
        // Windows may answer "C:\\" for one path and "\\\\?\\C:\\" for another on the same drive.
        let same = volume_of(&self.data_dir).is_some_and(|v| protect::normalize(&v) == protect::normalize(&want));
        if same {
            return Some(self.main_quarantine());
        }
        Some(want.join(DRIVE_DIR))
    }

    /// Every quarantine that exists right now, drives plugged in later included.
    fn roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![self.main_quarantine()];
        for d in jard_scan::drives::list() {
            let r = Path::new(&d.root).join(DRIVE_DIR);
            if d.ready && r.is_dir() {
                roots.push(r);
            }
        }
        roots
    }

    /// What moving `requests` would do. Moves nothing.
    pub fn preview(&self, requests: &[Request]) -> Preview {
        let mut out = Preview::default();
        let mut effects: Vec<Effect> = Vec::new();
        for r in requests {
            let shown = jard_scan::display_path(&r.path);
            if let Some(reason) = self.check(&r.path) {
                out.refused.push(Refusal { path: shown, reason });
                continue;
            }
            out.apparent += r.apparent;
            out.on_disk += r.on_disk;
            out.files += r.files;
            if let Some(kind) = effect_of(&format!("{}\\", protect::normalize(&r.path))) {
                match effects.iter_mut().find(|e| e.kind == kind) {
                    Some(e) => e.paths.push(shown.clone()),
                    None => effects.push(Effect { kind, paths: vec![shown.clone()] }),
                }
            }
            out.movable.push(shown);
        }
        out.effects = effects;
        out
    }

    /// Moves each request aside. One failing never stops the others.
    pub fn quarantine(&self, requests: &[Request]) -> Vec<Outcome> {
        let out: Vec<Outcome> = requests
            .iter()
            .map(|r| {
                let path = jard_scan::display_path(&r.path);
                match self.move_one(r) {
                    Ok(item) => Outcome { path, item: Some(item), failure: None },
                    Err(f) => Outcome { path, item: None, failure: Some(f) },
                }
            })
            .collect();
        let done = out.iter().filter_map(|o| o.item.as_ref());
        let (count, bytes) = done.fold((0, 0), |(c, b), i| (c + 1, b + i.on_disk));
        if count > 0 {
            self.log_event(LogKind::Quarantined, count, bytes);
        }
        out
    }

    fn move_one(&self, r: &Request) -> Result<Item, Failure> {
        if let Some(reason) = self.check(&r.path) {
            return Err(Failure::Protected { reason });
        }
        fs::symlink_metadata(&r.path)?; // gone already?
        let root = self.quarantine_for(&r.path).ok_or(Failure::NoQuarantine)?;
        fs::create_dir_all(&root).map_err(|_| Failure::NoQuarantine)?;
        hide(&root);

        let moved_at = now();
        let id = format!("{moved_at}-{}-{}", std::process::id(), self.next.fetch_add(1, Ordering::Relaxed));
        let dir = root.join(&id);
        fs::create_dir(&dir).map_err(|_| Failure::NoQuarantine)?;
        let item = Item {
            id,
            original: jard_scan::display_path(&r.path),
            is_dir: r.is_dir,
            apparent: r.apparent,
            on_disk: r.on_disk,
            files: r.files,
            moved_at,
            expires_at: moved_at + RETENTION_DAYS * DAY,
        };
        let moved = write_item(&dir, &item).map_err(Failure::from).and_then(|()| {
            // A rename, never copy-and-delete. Across drives it fails, and the file stays put.
            fs::rename(&r.path, dir.join(PAYLOAD)).map_err(Failure::from)
        });
        match moved {
            Ok(()) => Ok(item),
            Err(f) => {
                let _ = fs::remove_dir_all(&dir); // only item.json: the payload never arrived
                Err(f)
            }
        }
    }

    /// Overwrites a file with random-looking data and deletes it. No quarantine, no undo.
    ///
    /// Refuses what can't be honestly overwritten: folders, links, cloud placeholders (writing would
    /// download them first), and files with other hard links (the data is shared with another name).
    pub fn secure_delete(&self, path: &Path) -> Result<u64, Failure> {
        let unusable = |message: &str| Failure::Other { message: message.to_string() };
        if let Some(reason) = self.check(path) {
            return Err(Failure::Protected { reason });
        }
        let md = fs::symlink_metadata(path)?;
        if !md.is_file() {
            return Err(unusable("الحذف الآمن للملفات فقط، لا المجلدات ولا الروابط."));
        }
        if jard_scan::link_identity(path).is_some() {
            return Err(unusable("لهذا الملف اسم آخر (رابط صلب)، فالكتابة فوقه تغيّر الآخر أيضاً."));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            // offline, recall on open, recall on data access
            if md.file_attributes() & (0x1000 | 0x4_0000 | 0x40_0000) != 0 {
                return Err(unusable("الملف في السحابة وليس على هذا القرص. احذفه من خدمة المزامنة."));
            }
        }
        let len = md.len();
        {
            let mut f = fs::OpenOptions::new().write(true).open(path)?;
            let mut x = u64::from(std::process::id()) ^ now() ^ 0x9E37_79B9_7F4A_7C15;
            let mut buf = vec![0u8; 1024 * 1024];
            let mut left = len;
            while left > 0 {
                for chunk in buf.as_chunks_mut::<8>().0 {
                    x ^= x << 13;
                    x ^= x >> 7;
                    x ^= x << 17;
                    chunk.copy_from_slice(&x.to_le_bytes());
                }
                let n = left.min(buf.len() as u64) as usize;
                f.write_all(&buf[..n])?;
                left -= n as u64;
            }
            f.sync_all()?;
        }
        fs::remove_file(path)?;
        self.log_event(LogKind::SecureDeleted, 1, md.len());
        Ok(len)
    }

    /// Everything in quarantine, soonest to expire first. Unfinished moves are tidied away.
    pub fn list(&self) -> Vec<Item> {
        let mut items = Vec::new();
        for root in self.roots() {
            let Ok(entries) = fs::read_dir(&root) else { continue };
            for e in entries.flatten() {
                let dir = e.path();
                let Ok(item) = read_item(&dir) else { continue };
                if dir.join(PAYLOAD).symlink_metadata().is_ok() {
                    items.push(item);
                } else {
                    // Crashed between writing the JSON and the rename: nothing of the user's is here.
                    let _ = fs::remove_dir_all(&dir);
                }
            }
        }
        items.sort_by_key(|i| (i.expires_at, i.id.clone()));
        items
    }

    fn find(&self, id: &str) -> Result<(PathBuf, Item), Failure> {
        // An id is a folder name made by us: refuse anything that could point elsewhere.
        if id.is_empty() || id.contains(['/', '\\', '.', ':']) {
            return Err(Failure::Missing);
        }
        for root in self.roots() {
            let dir = root.join(id);
            if let Ok(item) = read_item(&dir) {
                return Ok((dir, item));
            }
        }
        Err(Failure::Missing)
    }

    /// Puts an item back where it came from. Returns the path it ended up at.
    pub fn restore(&self, id: &str, on_conflict: OnConflict) -> Result<String, Failure> {
        let (dir, item) = self.find(id)?;
        let original = long_path(Path::new(&item.original));
        let mut target = original.clone();
        if target.symlink_metadata().is_ok() {
            match on_conflict {
                OnConflict::Fail => return Err(Failure::Conflict),
                OnConflict::KeepBoth => target = free_name(&original),
            }
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(dir.join(PAYLOAD), &target)?;
        let _ = fs::remove_dir_all(&dir);
        self.drop_empty_root(&dir);
        self.log_event(LogKind::Restored, 1, item.on_disk);
        Ok(jard_scan::display_path(&target))
    }

    /// Deletes an item for good. This frees the space and cannot be undone.
    pub fn delete(&self, id: &str) -> Result<Item, Failure> {
        let (dir, item) = self.find(id)?;
        remove_item(&dir)?;
        self.drop_empty_root(&dir);
        self.log_event(LogKind::Deleted, 1, item.on_disk);
        Ok(item)
    }

    /// Deletes items whose time is up. Returns what went. Failures wait for the next run.
    pub fn purge_expired(&self) -> Vec<Item> {
        self.purge_expired_at(now())
    }

    /// [`Store::purge_expired`] with an explicit clock.
    pub fn purge_expired_at(&self, at: u64) -> Vec<Item> {
        let mut gone = Vec::new();
        for item in self.list().into_iter().filter(|i| i.expires_at <= at) {
            if let Ok((dir, _)) = self.find(&item.id) {
                if remove_item(&dir).is_ok() {
                    self.drop_empty_root(&dir);
                    gone.push(item);
                }
            }
        }
        if !gone.is_empty() {
            self.log_event(LogKind::Expired, gone.len() as u64, gone.iter().map(|i| i.on_disk).sum());
        }
        gone
    }

    /// Leaves no empty folder at the top of a drive.
    fn drop_empty_root(&self, item_dir: &Path) {
        if let Some(root) = item_dir.parent() {
            if root != self.main_quarantine() {
                let _ = fs::remove_dir(root); // fails, harmlessly, while anything is in it
            }
        }
    }

    fn log_path(&self) -> PathBuf {
        self.data_dir.join("log.jsonl")
    }

    /// Adds to the history. Counts and sizes only, never file names.
    pub fn log_event(&self, kind: LogKind, count: u64, bytes: u64) {
        let entry = LogEntry { at: now(), kind, count, bytes };
        let Ok(line) = serde_json::to_string(&entry) else { return };
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(self.log_path()) {
            let _ = writeln!(f, "{line}");
        }
    }

    /// The latest history entries, newest first.
    pub fn log(&self, limit: usize) -> Vec<LogEntry> {
        let Ok(f) = fs::File::open(self.log_path()) else { return Vec::new() };
        let mut all: Vec<LogEntry> =
            io::BufReader::new(f).lines().map_while(Result::ok).filter_map(|l| serde_json::from_str(&l).ok()).collect();
        all.reverse();
        all.truncate(limit);
        all
    }
}

fn write_item(dir: &Path, item: &Item) -> io::Result<()> {
    let json = serde_json::to_vec_pretty(item).map_err(io::Error::other)?;
    let mut f = fs::File::create(dir.join(ITEM_FILE))?;
    f.write_all(&json)?;
    f.sync_all() // on disk before the rename that depends on it
}

fn read_item(dir: &Path) -> io::Result<Item> {
    serde_json::from_slice(&fs::read(dir.join(ITEM_FILE))?).map_err(io::Error::other)
}

/// Removes the payload first, so an interrupted delete still shows as an item until it is finished.
fn remove_item(dir: &Path) -> Result<(), Failure> {
    let payload = dir.join(PAYLOAD);
    match payload.symlink_metadata() {
        Ok(md) => {
            clear_read_only(&payload);
            // Links are removed, never entered: `is_dir` is false for them, and remove_dir_all
            // does not follow the ones it meets inside a folder.
            if md.is_dir() {
                fs::remove_dir_all(&payload)?;
            } else if is_folder_link(&md) {
                fs::remove_dir(&payload)?;
            } else {
                fs::remove_file(&payload)?;
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    fs::remove_dir_all(dir)?;
    Ok(())
}

/// A junction or directory symlink: on Windows these are deleted as folders, not as files.
#[cfg(windows)]
fn is_folder_link(md: &fs::Metadata) -> bool {
    use std::os::windows::fs::FileTypeExt;
    md.file_type().is_symlink_dir()
}

#[cfg(unix)]
fn is_folder_link(_md: &fs::Metadata) -> bool {
    false
}

fn clear_read_only(path: &Path) {
    if let Ok(md) = path.symlink_metadata() {
        let mut perm = md.permissions();
        if perm.readonly() {
            #[allow(clippy::permissions_set_readonly_false)] // Windows attribute, not Unix mode bits
            perm.set_readonly(false);
            let _ = fs::set_permissions(path, perm);
        }
    }
}

/// `C:\x` back to `\\?\C:\x`, so restoring works beyond 260 characters too.
fn long_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if cfg!(windows) && !s.starts_with(r"\\") && s.as_bytes().get(1) == Some(&b':') {
        PathBuf::from(format!(r"\\?\{s}"))
    } else if cfg!(windows) && s.starts_with(r"\\") && !s.starts_with(r"\\?\") {
        PathBuf::from(format!(r"\\?\UNC\{}", &s[2..]))
    } else {
        path.to_path_buf()
    }
}

/// `report.pdf` -> `report (restored).pdf`, then `(restored 2)`, until the name is free.
fn free_name(original: &Path) -> PathBuf {
    let stem = original.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = original.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1.. {
        let tag = if n == 1 { "restored".to_string() } else { format!("restored {n}") };
        let candidate = original.with_file_name(format!("{stem} ({tag}){ext}"));
        if candidate.symlink_metadata().is_err() {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(windows)]
fn volume_of(path: &Path) -> Option<PathBuf> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetVolumePathNameW;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let mut buf = vec![0u16; wide.len().max(64) + 8];
    // SAFETY: `wide` is NUL-terminated; `buf` and its length are valid.
    let ok = unsafe { GetVolumePathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
    if ok == 0 {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(PathBuf::from(std::ffi::OsString::from_wide(&buf[..end])))
}

#[cfg(unix)]
fn volume_of(path: &Path) -> Option<PathBuf> {
    // Walk up to the last folder on the same device as `path`.
    use std::os::unix::fs::MetadataExt;
    let dev = fs::symlink_metadata(path).ok()?.dev();
    let mut top = path.to_path_buf();
    for a in path.ancestors().skip(1) {
        if fs::symlink_metadata(a).ok()?.dev() != dev {
            break;
        }
        top = a.to_path_buf();
    }
    Some(top)
}

#[cfg(windows)]
fn hide(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::SetFileAttributesW;
    const HIDDEN: u32 = 0x2;
    // The main quarantine is under the app's data folder: only a drive-level one needs hiding.
    if path.file_name().is_some_and(|n| n == DRIVE_DIR) {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        // SAFETY: `wide` is NUL-terminated.
        unsafe { SetFileAttributesW(wide.as_ptr(), HIDDEN) };
    }
}

#[cfg(unix)]
fn hide(_path: &Path) {} // the leading dot does it
