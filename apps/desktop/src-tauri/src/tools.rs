//! Actions that change something or stress the machine. Each starts only from an explicit request
//! in the UI, and nothing a page sends becomes part of a command line without being checked first.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use jard_clean::capacity::{test_capacity, CapacityResult};
use jard_clean::{Failure, Store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::system::{hidden, powershell};

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

fn quiet(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    hidden(&mut cmd);
    cmd.output()
}

/* ---------- startup programs ---------- */

/// Turns one of this user's startup programs on or off, the same way Task Manager does: the program
/// stays listed, and turning it back on restores it. Only this user's Run entries, no admin needed.
#[tauri::command]
pub(crate) async fn set_startup(name: String, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The value must really exist in the Run key. Arguments go directly, with no shell.
        let found = quiet("reg", &["query", RUN_KEY, "/v", &name]).map_err(|e| e.to_string())?;
        if !found.status.success() {
            return Err("not one of this user's startup programs".to_string());
        }
        let data = if enabled { "020000000000000000000000" } else { "030000000000000000000000" };
        let out = quiet("reg", &["add", APPROVED_KEY, "/v", &name, "/t", "REG_BINARY", "/d", data, "/f"])
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------- secure delete ---------- */

/// Overwrites a file and deletes it. This cannot be undone. The UI asks for the word "حذف" first.
#[tauri::command]
pub(crate) async fn secure_delete_file(
    store: State<'_, Arc<Store>>,
    path: String,
) -> Result<Result<u64, Failure>, String> {
    let store = Arc::clone(&store);
    tauri::async_runtime::spawn_blocking(move || store.secure_delete(Path::new(&path))).await.map_err(|e| e.to_string())
}

/* ---------- stress test ---------- */

#[derive(Default)]
pub(crate) struct Busy {
    stress_stop: AtomicBool,
    capacity_stop: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StressResult {
    seconds: f64,
    threads: usize,
    /// Work done per second across all threads: comparable between runs on this machine only.
    score: u64,
    stopped: bool,
}

/// At most five minutes, always. Keeps every core busy doing arithmetic.
#[tauri::command]
pub(crate) async fn stress_cpu(busy: State<'_, Arc<Busy>>, seconds: u64) -> Result<StressResult, String> {
    let limit = Duration::from_secs(seconds.clamp(1, 300));
    let busy = Arc::clone(&busy);
    busy.stress_stop.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
        let done = Arc::new(AtomicU64::new(0));
        let start = Instant::now();
        std::thread::scope(|s| {
            for t in 0..threads {
                let (done, busy) = (Arc::clone(&done), Arc::clone(&busy));
                s.spawn(move || {
                    let mut x = 0x1234_5678_9ABC_DEF0u64 ^ t as u64;
                    while start.elapsed() < limit && !busy.stress_stop.load(Ordering::Relaxed) {
                        for _ in 0..200_000 {
                            x ^= x << 13;
                            x ^= x >> 7;
                            x ^= x << 17;
                        }
                        done.fetch_add(1, Ordering::Relaxed);
                    }
                    std::hint::black_box(x);
                });
            }
        });
        let secs = start.elapsed().as_secs_f64();
        StressResult {
            seconds: secs,
            threads,
            score: (done.load(Ordering::Relaxed) as f64 / secs) as u64,
            stopped: busy.stress_stop.load(Ordering::Relaxed),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn stress_stop(busy: State<'_, Arc<Busy>>) {
    busy.stress_stop.store(true, Ordering::SeqCst);
}

/// Opens Windows' own memory diagnostic, which asks whether to restart now or later.
#[tauri::command]
pub(crate) fn open_memory_test() -> Result<(), String> {
    let mut cmd = Command::new("mdsched.exe");
    hidden(&mut cmd);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/* ---------- flash capacity ---------- */

/// Only drives Windows reports as removable, and only their top folder.
#[tauri::command]
pub(crate) async fn flash_capacity(
    app: AppHandle,
    busy: State<'_, Arc<Busy>>,
    root: String,
) -> Result<CapacityResult, String> {
    let drive =
        jard_scan::drives::list().into_iter().find(|d| d.root.eq_ignore_ascii_case(&root)).ok_or("no such drive")?;
    if drive.kind != jard_scan::drives::DriveKind::Removable || !drive.ready {
        return Err("only a removable drive can be tested".into());
    }
    let busy = Arc::clone(&busy);
    busy.capacity_stop.store(false, Ordering::SeqCst);
    // Leave a little room so the file system itself never runs completely out.
    let limit = drive.free.saturating_sub(16 * 1024 * 1024);
    tauri::async_runtime::spawn_blocking(move || {
        let mut last = Instant::now();
        test_capacity(Path::new(&drive.root), limit, &busy.capacity_stop, |stage, done| {
            if last.elapsed() > Duration::from_millis(250) {
                last = Instant::now();
                let _ = app.emit("flash://progress", (stage, done, limit));
            }
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn flash_stop(busy: State<'_, Arc<Busy>>) {
    busy.capacity_stop.store(true, Ordering::SeqCst);
}

/* ---------- VirusTotal ---------- */

fn sha256_of(path: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        match f.read(&mut buf)? {
            0 => break,
            n => h.update(&buf[..n]),
        }
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VtResult {
    sha256: String,
    /// False when VirusTotal has never seen this file.
    known: bool,
    malicious: u64,
    suspicious: u64,
    harmless: u64,
}

/// Sends the file's fingerprint and the person's own API key to VirusTotal. The file stays here.
#[tauri::command]
pub(crate) async fn virustotal_check(path: String, api_key: String) -> Result<VtResult, String> {
    if api_key.trim().is_empty() {
        return Err("no API key".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let sha256 = sha256_of(Path::new(&path)).map_err(|e| e.to_string())?;
        let url = format!("https://www.virustotal.com/api/v3/files/{sha256}");
        match ureq::get(&url).timeout(Duration::from_secs(20)).set("x-apikey", api_key.trim()).call() {
            Ok(resp) => {
                let v: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
                let stats = &v["data"]["attributes"]["last_analysis_stats"];
                let n = |k: &str| stats[k].as_u64().unwrap_or(0);
                Ok(VtResult {
                    known: true,
                    malicious: n("malicious"),
                    suspicious: n("suspicious"),
                    harmless: n("harmless") + n("undetected"),
                    sha256,
                })
            }
            Err(ureq::Error::Status(404, _)) => {
                Ok(VtResult { sha256, known: false, malicious: 0, suspicious: 0, harmless: 0 })
            }
            Err(ureq::Error::Status(401, _)) => Err("bad_key".into()),
            Err(ureq::Error::Status(429, _)) => Err("rate_limited".into()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------- schedule ---------- */

const TASK: &str = r"Jard\Scan";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Schedule {
    pub root: String,
    /// `daily`, `weekly` or `monthly`
    pub frequency: String,
    /// `SUN`..`SAT`, used when weekly.
    pub day: String,
    /// `HH:MM`, 24-hour.
    pub time: String,
    pub notify_full: bool,
    pub rule_temp: bool,
    pub rule_browser_cache: bool,
    pub rule_old_downloads: bool,
}

pub(crate) fn data_dir_for_task() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("app.jard.desktop"))
}

fn schedule_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string()).map(|d| d.join("schedule.json"))
}

fn valid_time(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u8>().is_ok_and(|h| h < 24)
        && t[3..].parse::<u8>().is_ok_and(|m| m < 60)
        && t.is_ascii()
}

/// Creates or replaces the Windows scheduled task for this user.
#[tauri::command]
pub(crate) async fn set_schedule(app: AppHandle, schedule: Schedule) -> Result<(), String> {
    if !valid_time(&schedule.time) {
        return Err("bad time".into());
    }
    if !["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].contains(&schedule.day.as_str()) {
        return Err("bad day".into());
    }
    if schedule.root.contains('"') || !Path::new(&schedule.root).is_dir() {
        return Err("no such folder".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let action = format!("\"{}\" --scheduled \"{}\"", exe.display(), schedule.root);
    if action.len() > 261 {
        return Err("path too long for a scheduled task".into());
    }
    let path = schedule_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec!["/Create", "/F", "/TN", TASK, "/TR", &action, "/ST", &schedule.time];
        match schedule.frequency.as_str() {
            "daily" => args.extend(["/SC", "DAILY"]),
            "monthly" => args.extend(["/SC", "MONTHLY", "/D", "1"]),
            "weekly" => args.extend(["/SC", "WEEKLY", "/D", &schedule.day]),
            _ => return Err("bad frequency".to_string()),
        }
        let out = quiet("schtasks", &args).map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(&path, serde_json::to_vec_pretty(&schedule).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The saved schedule, if the Windows task still exists.
#[tauri::command]
pub(crate) fn get_schedule(app: AppHandle) -> Result<Option<Schedule>, String> {
    let exists = quiet("schtasks", &["/Query", "/TN", TASK]).is_ok_and(|o| o.status.success());
    if !exists {
        return Ok(None);
    }
    let Ok(raw) = fs::read(schedule_path(&app)?) else { return Ok(None) };
    Ok(serde_json::from_slice(&raw).ok())
}

#[tauri::command]
pub(crate) fn remove_schedule(app: AppHandle) -> Result<(), String> {
    let _ = quiet("schtasks", &["/Delete", "/F", "/TN", TASK]);
    let _ = fs::remove_file(schedule_path(&app)?);
    Ok(())
}

/* ---------- reading the local network, without sending anything ---------- */

const NEIGHBORS: &str = r#"
$rows=Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -in 'Reachable','Stale','Permanent' -and $_.IPAddress -notmatch '^(22[4-9]|23\d|255)\.' -and $_.IPAddress -notmatch '\.255$' -and $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' } |
 Select-Object @{n='ip';e={$_.IPAddress}},@{n='mac';e={$_.LinkLayerAddress}},@{n='state';e={[string]$_.State}};
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

const PARTITIONS: &str = r#"
$rows=Get-Partition | ForEach-Object { $v=$_ | Get-Volume; [pscustomobject]@{ disk=$_.DiskNumber; number=$_.PartitionNumber; letter=[string]$_.DriveLetter; size=$_.Size; kind=[string]$_.Type; fs=[string]$v.FileSystem } };
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

/// Devices this computer already knows about from its own network table. No probes are sent.
#[tauri::command]
pub(crate) async fn network_neighbors() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| powershell(NEIGHBORS)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn disk_partitions() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| powershell(PARTITIONS)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_a_known_value() {
        let p = std::env::temp_dir().join(format!("jard-sha-{}", std::process::id()));
        fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_of(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        fs::remove_file(&p).unwrap();
    }

    #[test]
    fn times_are_checked_before_reaching_a_command() {
        for ok in ["00:00", "20:00", "23:59"] {
            assert!(valid_time(ok), "{ok}");
        }
        for bad in ["24:00", "12:60", "8:00", "20:00 /F", "ab:cd", "", "٢٠:٠٠"] {
            assert!(!valid_time(bad), "{bad}");
        }
    }
}
