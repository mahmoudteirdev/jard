//! What the Windows scheduled task runs: `jard-desktop --scheduled <folder>`. No window. Scans, saves
//! the result for comparing, applies the rules the person turned on, and warns if the drive is full.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use jard_clean::{LogKind, Request, Store};
use jard_scan::{flags, NodeId, Options, Progress, Tree};

use crate::clean::{browser_cache_tails, temp_tails};
use crate::saved::save_scan_in;
use crate::system::powershell;
use crate::tools::{data_dir_for_task, Schedule};

const SIX_MONTHS: u64 = 182 * 86_400;

/// What the turned-on rules would move. Every path still goes through the quarantine's own checks.
pub(crate) fn rule_targets(tree: &Tree, s: &Schedule, now: u64) -> Vec<Request> {
    let mut ids: Vec<NodeId> = Vec::new();
    if s.rule_temp {
        for (n, _) in tree.folders_ending_with(temp_tails()) {
            for c in tree.children(n.id, jard_scan::SortKey::OnDisk, 0, None) {
                // Something touched lately may be in use by a running program.
                if c.is_dir || c.modified + 7 * 86_400 < now {
                    ids.push(c.id);
                }
            }
        }
    }
    if s.rule_browser_cache {
        ids.extend(tree.folders_ending_with(browser_cache_tails()).iter().map(|(n, _)| n.id));
    }
    if s.rule_old_downloads {
        for (n, _) in tree.folders_ending_with(&[&["downloads"]]) {
            // Downloads of a user profile only: ...\Users\<name>\Downloads.
            let grand = n.parent.and_then(|p| tree.get(p)).and_then(|p| p.parent).and_then(|p| tree.get(p));
            if !grand.is_some_and(|g| g.name.eq_ignore_ascii_case("users")) {
                continue;
            }
            for c in tree.children(n.id, jard_scan::SortKey::OnDisk, 0, None) {
                if !c.is_dir && c.modified > 0 && c.modified + SIX_MONTHS < now {
                    ids.push(c.id);
                }
            }
        }
    }
    ids.into_iter()
        .filter_map(|id| {
            let n = tree.get(id)?;
            if n.has(flags::REPARSE) || n.has(flags::CLOUD) {
                return None;
            }
            Some(Request {
                path: tree.path(id)?,
                is_dir: n.is_dir,
                apparent: n.apparent,
                on_disk: n.on_disk,
                files: n.files,
            })
        })
        .collect()
}

fn toast(text: &str) {
    // Only ever called with a fixed sentence and a drive letter checked below.
    let script = format!(
        "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;\
         $x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);\
         $t=$x.GetElementsByTagName('text');$t.Item(0).InnerText='جَرد';$t.Item(1).InnerText='{text}';\
         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x));"
    );
    let _ = powershell(&script);
}

/// Runs one scheduled scan. Returns the process exit code.
pub fn run(root: &str) -> i32 {
    let Some(dir) = data_dir_for_task() else { return 2 };
    let Ok(store) = Store::open(&dir) else { return 3 };
    let schedule: Option<Schedule> =
        std::fs::read(dir.join("schedule.json")).ok().and_then(|raw| serde_json::from_slice(&raw).ok());

    let Ok(tree) = jard_scan::scan(root, &Options::default(), &Progress::new()) else { return 4 };
    let r = tree.root_node();
    store.log_event(LogKind::Scanned, r.files, r.on_disk);
    if save_scan_in(&dir.join("scans"), &tree, true).is_err() {
        return 5;
    }

    if let Some(s) = &schedule {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let targets = rule_targets(&tree, s, now);
        if !targets.is_empty() {
            let outcomes = store.quarantine(&targets);
            let failed: Vec<_> = outcomes.iter().filter(|o| o.failure.is_some()).collect();
            // Nobody is watching a scheduled run: leave a trace, or a failure looks like nothing to do.
            if !failed.is_empty() {
                store.log_event(LogKind::RuleFailed, failed.len() as u64, 0);
            }
        }
        if s.notify_full {
            for d in jard_scan::drives::list() {
                let letter = d.root.chars().next().filter(char::is_ascii_alphabetic);
                let on_this_drive = Path::new(root).starts_with(&d.root);
                if let (Some(l), true, true) = (letter, on_this_drive, d.total > 0 && d.free * 10 < d.total) {
                    toast(&format!("قرص {l}: ممتلئ بأكثر من 90%. افتح جَرد لتعرف أين ذهبت المساحة."));
                }
            }
        }
    }
    store.purge_expired();
    0
}
