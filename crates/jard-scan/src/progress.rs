use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;

use serde::Serialize;

/// Live counters shared between the scan workers and whoever shows progress.
///
/// Numbers are read without locking, so a [`Snapshot`] taken mid-scan is approximate.
/// The final numbers come from the rolled-up [`crate::Tree`].
#[derive(Debug, Default)]
pub struct Progress {
    files: AtomicU64,
    dirs: AtomicU64,
    bytes: AtomicU64,
    denied: AtomicU64,
    done: AtomicBool,
    cancelled: AtomicBool,
    paused: AtomicBool,
    current: Mutex<String>,
}

/// Payload of the `scan://progress/{scanId}` event.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub files: u64,
    pub dirs: u64,
    /// On-disk bytes counted so far.
    pub bytes: u64,
    pub denied: u64,
    /// A folder being read right now (sampled, not every folder).
    pub current: String,
    pub done: bool,
    pub cancelled: bool,
    pub paused: bool,
}

impl Progress {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            files: self.files.load(Relaxed),
            dirs: self.dirs.load(Relaxed),
            bytes: self.bytes.load(Relaxed),
            denied: self.denied.load(Relaxed),
            current: self.current.lock().map(|c| c.clone()).unwrap_or_default(),
            done: self.done.load(Relaxed),
            cancelled: self.cancelled.load(Relaxed),
            paused: self.paused.load(Relaxed),
        }
    }

    /// Ask the scan to stop. What was read so far stays browsable, marked `PARTIAL`.
    pub fn cancel(&self) {
        self.cancelled.store(true, Relaxed);
    }

    /// Holds the scan after the folders being read now. Cancelling still works while paused.
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Relaxed)
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Relaxed)
    }

    pub fn is_done(&self) -> bool {
        self.done.load(Relaxed)
    }

    /// Adds one listed folder and its direct files. Returns the folder count so far.
    pub(crate) fn add_dir(&self, files: u64, bytes: u64, denied: u64) -> u64 {
        self.files.fetch_add(files, Relaxed);
        self.bytes.fetch_add(bytes, Relaxed);
        if denied > 0 {
            self.denied.fetch_add(denied, Relaxed);
        }
        self.dirs.fetch_add(1, Relaxed) + 1
    }

    /// Never blocks a worker: skipped if someone is reading it.
    pub(crate) fn set_current(&self, path: &Path) {
        if let Ok(mut cur) = self.current.try_lock() {
            cur.clear();
            cur.push_str(&crate::tree::display_path(path));
        }
    }

    pub(crate) fn finish(&self) {
        self.done.store(true, Relaxed);
    }
}
