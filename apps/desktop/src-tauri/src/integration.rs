//! Jard's places in Windows, each one the person's to turn on or off: Explorer's right-click menu
//! and the check at sign-in. Plus the clean-up the uninstaller asks for.

use std::fs;

use jard_clean::Store;
use serde::Serialize;

use crate::system::hidden;

const MENU_KEYS: [&str; 2] = [r"HKCU\Software\Classes\Directory\shell\Jard", r"HKCU\Software\Classes\Drive\shell\Jard"];
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Jard";

fn reg(args: &[&str]) -> Result<bool, String> {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(args);
    hidden(&mut cmd);
    cmd.output().map(|o| o.status.success()).map_err(|e| e.to_string())
}

fn must(args: &[&str]) -> Result<(), String> {
    if reg(args)? {
        Ok(())
    } else {
        Err(format!("reg {} failed", args.first().unwrap_or(&"")))
    }
}

fn this_exe() -> Result<String, String> {
    std::env::current_exe().map_err(|e| e.to_string()).map(|p| p.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Integration {
    context_menu: bool,
    start_check: bool,
}

#[tauri::command]
pub(crate) fn get_integration() -> Result<Integration, String> {
    Ok(Integration {
        context_menu: reg(&["query", MENU_KEYS[0]])?,
        start_check: reg(&["query", RUN_KEY, "/v", RUN_VALUE])?,
    })
}

/// The same entries the installer writes, so turning this off and on leaves things as installed.
/// The choice is recorded too: an update must not bring back a menu the person removed.
#[tauri::command]
pub(crate) fn set_context_menu(enabled: bool) -> Result<(), String> {
    let exe = this_exe()?;
    must(&["add", r"HKCU\Software\Jard", "/v", "ContextMenu", "/d", if enabled { "1" } else { "0" }, "/f"])?;
    for key in MENU_KEYS {
        if enabled {
            let command = format!("{key}\\command");
            let open = format!("\"{exe}\" \"%1\"");
            must(&["add", key, "/ve", "/d", "افحص بجرد", "/f"])?;
            must(&["add", key, "/v", "Icon", "/d", &exe, "/f"])?;
            must(&["add", &command, "/ve", "/d", &open, "/f"])?;
        } else {
            let _ = reg(&["delete", key, "/f"])?; // already gone is fine
        }
    }
    Ok(())
}

/// At sign-in Jard only checks free space and warns if a drive is nearly full. No window stays open.
#[tauri::command]
pub(crate) fn set_start_check(enabled: bool) -> Result<(), String> {
    if enabled {
        let command = format!("\"{}\" --startup-check", this_exe()?);
        must(&["add", RUN_KEY, "/v", RUN_VALUE, "/d", &command, "/f"])
    } else {
        let _ = reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])?;
        Ok(())
    }
}

/// `--startup-check`: one warning per nearly full fixed drive, then exit.
pub fn startup_check() -> i32 {
    for d in jard_scan::drives::list() {
        let letter = d.root.chars().next().filter(char::is_ascii_alphabetic);
        let fixed = matches!(d.kind, jard_scan::drives::DriveKind::Fixed);
        if let (Some(l), true, true) = (letter, fixed, d.total > 0 && d.free * 10 < d.total) {
            crate::scheduled::toast(&format!("قرص {l}: ممتلئ بأكثر من 90%. افتح جَرد لتعرف أين ذهبت المساحة."));
        }
    }
    0
}

/// `--uninstall-clean <what>`: what the person chose to remove when uninstalling. Each part is
/// asked for separately, and the default is to keep it.
pub fn uninstall_clean(what: &str) -> i32 {
    let Some(dir) = crate::paths::data_dir_headless() else { return 2 };
    match what {
        "scans" => {
            let _ = fs::remove_dir_all(dir.join("scans"));
        }
        "license" => {
            let _ = fs::remove_file(dir.join("license.json"));
        }
        "quarantine" => {
            let Ok(store) = Store::open(&dir) else { return 3 };
            for item in store.list() {
                let _ = store.delete(&item.id);
            }
        }
        _ => return 1,
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_parts_are_refused() {
        assert_eq!(uninstall_clean("everything"), 1);
    }
}
