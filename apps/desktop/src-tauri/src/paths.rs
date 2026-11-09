//! Where Jard keeps its data. Installed: the user's local app data. Portable: beside the program.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// This file beside the program makes it portable: nothing is written anywhere else.
const PORTABLE_MARKER: &str = "jard.portable";
const IDENTIFIER: &str = "app.jard.desktop";

/// The data folder of a portable copy, or None when installed.
pub(crate) fn portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    dir.join(PORTABLE_MARKER).exists().then(|| dir.join("data"))
}

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match portable_dir() {
        Some(dir) => Ok(dir),
        None => app.path().app_local_data_dir().map_err(|e| e.to_string()),
    }
}

/// The same folder for the modes that run without a window, where there is no `AppHandle`.
pub(crate) fn data_dir_headless() -> Option<PathBuf> {
    portable_dir().or_else(|| std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(IDENTIFIER)))
}

#[derive(serde::Serialize)]
pub(crate) struct PlatformFacts {
    os: &'static str,
    snapshots: Option<usize>,
}

/// What the screens need to show the right words for this system.
#[tauri::command]
pub(crate) async fn platform_facts() -> Result<PlatformFacts, String> {
    let os = std::env::consts::OS;
    let snapshots = if cfg!(target_os = "macos") {
        tauri::async_runtime::spawn_blocking(|| {
            let out = std::process::Command::new("tmutil").args(["listlocalsnapshots", "/"]).output().ok()?;
            let text = String::from_utf8_lossy(&out.stdout).into_owned();
            out.status.success().then(|| text.lines().filter(|l| l.contains("com.apple.TimeMachine")).count())
        })
        .await
        .map_err(|e| e.to_string())?
    } else {
        None
    };
    Ok(PlatformFacts { os, snapshots })
}

#[tauri::command]
pub(crate) fn is_portable() -> bool {
    portable_dir().is_some()
}
