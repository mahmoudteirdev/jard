//! Pro activation and the diagnostic file. The diagnostic file is written only when asked for and
//! shown before it is saved: it holds no file names, volume labels or activation key.

use std::fs;
use std::path::{Path, PathBuf};

use jard_license::{check_key, device_code, verify, KeyCheck, License, LicenseError};
use serde::Serialize;
use tauri::{AppHandle};

const PUBLIC_KEY: &str = include_str!("../license_public.hex");

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::data_dir(app)
}

/// Windows' per-install ID. Only its hash ever leaves this function.
fn machine_id() -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
            .creation_flags(0x0800_0000)
            .output();
        if let Ok(out) = out {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(id) = text.split_whitespace().last() {
                return id.to_string();
            }
        }
    }
    "unknown-machine".into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LicenseStatus {
    device: String,
    license: Option<License>,
    /// Why a saved file no longer counts, when so.
    problem: Option<LicenseError>,
}

fn license_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("license.json"))
}

#[tauri::command]
pub(crate) fn license_status(app: AppHandle) -> Result<LicenseStatus, String> {
    let device = device_code(&machine_id());
    let (license, problem) = match fs::read_to_string(license_path(&app)?) {
        Err(_) => (None, None),
        Ok(text) => match verify(PUBLIC_KEY, &text, &device) {
            Ok(l) => (Some(l), None),
            Err(e) => (None, Some(e)),
        },
    };
    Ok(LicenseStatus { device, license, problem })
}

#[tauri::command]
pub(crate) fn check_license_key(key: String) -> KeyCheck {
    check_key(&key)
}

/// Checks an activation file and keeps a copy only if it is genuine and for this device.
#[tauri::command]
pub(crate) fn activate_file(app: AppHandle, path: String) -> Result<Result<License, LicenseError>, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 64 * 1024 {
        return Ok(Err(LicenseError::Unreadable));
    }
    let text = fs::read_to_string(&path).map_err(|_| "unreadable".to_string());
    let Ok(text) = text else { return Ok(Err(LicenseError::Unreadable)) };
    let result = verify(PUBLIC_KEY, &text, &device_code(&machine_id()));
    if result.is_ok() {
        let target = license_path(&app)?;
        fs::create_dir_all(target.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
        fs::write(target, text).map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn deactivate(app: AppHandle) -> Result<(), String> {
    match fs::remove_file(license_path(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Writes panics to a local file. Nothing is sent anywhere.
pub(crate) fn install_crash_log(app: &AppHandle) {
    let Ok(dir) = data_dir(app) else { return };
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = fs::create_dir_all(&dir);
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("crash.log")) {
            use std::io::Write;
            // Where in Jard's code, not the message: a message could quote a file name.
            let at = info.location().map_or_else(|| "unknown".to_string(), |l| format!("{}:{}", l.file(), l.line()));
            let _ = writeln!(f, "panic at {at}");
        }
        previous(info);
    }));
}

#[tauri::command]
pub(crate) fn diagnostics_text(app: AppHandle) -> Result<String, String> {
    let mut out = format!(
        "Jard diagnostic file\napp version: {}\nos: {} {}\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    if let Ok(locale) = std::env::var("LANG") {
        out += &format!("locale: {locale}\n");
    }
    out += "\ndrives (no labels):\n";
    for d in jard_scan::drives::list() {
        out += &format!("  {:?} fs={} total={} free={} ready={}\n", d.kind, d.fs, d.total, d.free, d.ready);
    }
    out += "\nsaved scans (no paths):\n";
    let dir = data_dir(&app)?.join("scans");
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        if e.path().extension().is_some_and(|x| x == "json") {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&fs::read(e.path()).unwrap_or_default()) {
                out += &format!("  files={} folders={} partial={}\n", v["files"], v["dirs"], v["partial"]);
            }
        }
    }
    out += "\ncrashes:\n";
    match fs::read_to_string(data_dir(&app)?.join("crash.log")) {
        Ok(text) => {
            let lines: Vec<&str> = text.lines().collect();
            for l in &lines[lines.len().saturating_sub(20)..] {
                out += &format!("  {l}\n");
            }
        }
        Err(_) => out += "  none\n",
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn save_diagnostics(app: AppHandle, path: String) -> Result<(), String> {
    fs::write(&path, diagnostics_text(app)?).map_err(|e| format!("{path}: {e}"))
}
