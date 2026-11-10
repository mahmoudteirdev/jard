//! jard-scan: Jard's disk scan engine.
//!
//! Walks a folder with several threads and builds a flat tree ([`Tree`]) where each folder
//! carries three kinds of numbers: apparent size, size on disk, and bytes that are not
//! counted (cloud-only and duplicate hard links). A child's id is always greater than its
//! parent's, so the tree rolls up in one backward pass and the UI can ask for one folder's
//! children at a time.
//!
//! ```no_run
//! let scan = jard_scan::spawn("C:\\Users".into(), jard_scan::Options::default());
//! while !scan.is_finished() {
//!     let p = scan.progress().snapshot();
//!     println!("{} files, {} bytes", p.files, p.bytes);
//!     std::thread::sleep(std::time::Duration::from_millis(100));
//! }
//! let tree = scan.join().unwrap();
//! for child in tree.children(jard_scan::Tree::ROOT, jard_scan::SortKey::OnDisk, 0, Some(10)) {
//!     println!("{:>15} {}", child.on_disk, child.name);
//! }
//! ```

pub mod ai_query;
pub mod dev;
pub mod drives;
pub mod ghost;
#[cfg(windows)]
pub mod mft;
pub mod predict;
mod duplicates;
mod similar;
mod truth;
mod kinds;
mod node;
mod persist;
mod progress;
mod sys;
mod tree;
mod walk;

use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread::JoinHandle;

pub use ai_query::{parse_natural_query, ParsedAiQuery};
pub use duplicates::{find_duplicates, DuplicateGroup};
pub use dev::{scan_dev_projects, DevArtifact, DevProject};
pub use ghost::{find_ghost_files, GhostFile};
pub use predict::{predict_depletion, DepletionForecast, DepletionStatus, StorageSnapshot};
pub use similar::{find_similar, SimilarGroup, SimilarPhoto};
pub use truth::TruthFacts;
pub use kinds::{kind_totals, Kind, KindTotal, Query};
pub use node::{flags, Node, NodeId};
pub use progress::{Progress, Snapshot};
pub use sys::link_identity;
pub use tree::{display_path, SortKey, Tree};
pub use walk::{scan, Options};

/// A scan running on its own thread.
pub struct ScanHandle {
    progress: Arc<Progress>,
    thread: JoinHandle<io::Result<Tree>>,
}

/// Starts scanning `root` in the background.
pub fn spawn(root: PathBuf, opts: Options) -> ScanHandle {
    let progress = Arc::new(Progress::new());
    let shared = Arc::clone(&progress);
    let thread = std::thread::Builder::new()
        .name("jard-scan".into())
        .spawn(move || scan(&root, &opts, &shared))
        .expect("failed to start scan thread");
    ScanHandle { progress, thread }
}

impl ScanHandle {
    pub fn progress(&self) -> &Arc<Progress> {
        &self.progress
    }

    /// Stops the scan soon. [`ScanHandle::join`] still returns the partial tree.
    pub fn cancel(&self) {
        self.progress.cancel();
    }

    pub fn is_finished(&self) -> bool {
        self.thread.is_finished()
    }

    /// Waits for the scan and returns the tree.
    pub fn join(self) -> io::Result<Tree> {
        self.thread.join().map_err(|_| io::Error::other("scan thread panicked"))?
    }
}
