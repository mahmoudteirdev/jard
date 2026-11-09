//! Administrator rights for one operation only. The app itself stays unelevated: a short-lived copy
//! of the program runs the job with the rights Windows just granted, writes the result, and exits.
//!
//! The job file sits in a folder the user can write to, so the elevated copy doesn't trust it blindly:
//! the job's SHA-256 is on its command line, which nothing can change once it has started. And every
//! move still goes through `Store`, so protected paths are refused however the job was written.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use jard_clean::{Failure, OnConflict, Outcome, Request, Store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// What Windows answers when the person says no to the prompt.
const ERROR_CANCELLED: i32 = 1223;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Job {
    Quarantine(Vec<Request>),
    Restore { id: String, keep_both: bool },
    Delete { id: String },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobResult {
    Quarantine(Vec<Outcome>),
    Restore(Result<String, Failure>),
    Delete(Option<Failure>),
}

pub(crate) enum Refused {
    /// The person said no. Nothing happened.
    Declined,
    Failed(String),
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Windows' "run as administrator". Returns once the prompt is answered; with `wait`, the job's exit code.
#[cfg(windows)]
fn shell_runas(params: &str, parent: Option<isize>, wait: bool) -> io::Result<u32> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};

    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let exe = wide(std::env::current_exe()?.as_os_str());
    let verb = wide("runas".as_ref());
    let params = wide(params.as_ref());
    // SAFETY: the struct is plain data, the strings outlive the call, and the handle is closed below.
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = if wait { SEE_MASK_NOCLOSEPROCESS } else { 0 };
        info.hwnd = parent.unwrap_or(0) as _;
        info.lpVerb = verb.as_ptr();
        info.lpFile = exe.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = if wait { 0 } else { 1 }; // a job has no window; the app does
        if ShellExecuteExW(&mut info) == 0 {
            return Err(io::Error::last_os_error());
        }
        if !wait {
            return Ok(0);
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        Ok(code)
    }
}

#[cfg(not(windows))]
fn shell_runas(_params: &str, _parent: Option<isize>, _wait: bool) -> io::Result<u32> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "not supported on this system"))
}

fn main_window(app: &AppHandle) -> Option<isize> {
    #[cfg(windows)]
    {
        app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

/// Runs a job with administrator rights. Blocks until Windows' prompt is answered and the job ends.
pub(crate) fn run_job(app: &AppHandle, job: &Job) -> Result<JobResult, Refused> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let dir = crate::paths::data_dir(app).map_err(Refused::Failed)?;
    fs::create_dir_all(&dir).map_err(|e| Refused::Failed(e.to_string()))?;
    let name = format!("elevate-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
    let job_path = dir.join(format!("{name}.json"));
    let out_path = dir.join(format!("{name}.out"));
    let bytes = serde_json::to_vec(job).map_err(|e| Refused::Failed(e.to_string()))?;
    fs::write(&job_path, &bytes).map_err(|e| Refused::Failed(e.to_string()))?;

    let params = format!(
        "--elevated \"{}\" \"{}\" {}",
        dir.display(),
        job_path.display(),
        hex(&Sha256::digest(&bytes))
    );
    let code = shell_runas(&params, main_window(app), true);
    let result = match code {
        Err(e) if e.raw_os_error() == Some(ERROR_CANCELLED) => Err(Refused::Declined),
        Err(e) => Err(Refused::Failed(e.to_string())),
        Ok(0) => fs::read(&out_path)
            .map_err(|e| e.to_string())
            .and_then(|b| serde_json::from_slice(&b).map_err(|e| e.to_string()))
            .map_err(Refused::Failed),
        Ok(code) => Err(Refused::Failed(format!("exit code {code}"))),
    };
    let _ = fs::remove_file(&job_path);
    let _ = fs::remove_file(&out_path);
    result
}

fn run_verified(data_dir: &Path, job_path: &Path, sha: &str) -> Result<(), String> {
    let bytes = fs::read(job_path).map_err(|e| e.to_string())?;
    if hex(&Sha256::digest(&bytes)) != sha {
        return Err("the job file changed after it was written".into());
    }
    let job: Job = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let store = Store::open(data_dir).map_err(|e| e.to_string())?;
    let result = match job {
        Job::Quarantine(items) => JobResult::Quarantine(store.quarantine(&items)),
        Job::Restore { id, keep_both } => {
            JobResult::Restore(store.restore(&id, if keep_both { OnConflict::KeepBoth } else { OnConflict::Fail }))
        }
        Job::Delete { id } => JobResult::Delete(store.delete(&id).err()),
    };
    let out = serde_json::to_vec(&result).map_err(|e| e.to_string())?;
    fs::write(job_path.with_extension("out"), out).map_err(|e| e.to_string())
}

/// The elevated copy's whole life: one job, then exit. Returns the process's exit code.
pub fn run_elevated(data_dir: &str, job_path: &str, sha: &str) -> i32 {
    match run_verified(&PathBuf::from(data_dir), &PathBuf::from(job_path), sha) {
        Ok(()) => 0,
        Err(_) => 3,
    }
}

/// Starts the whole app again with administrator rights, then closes this one.
/// False: the person said no, and this copy stays open.
#[tauri::command]
pub(crate) async fn relaunch_as_admin(app: AppHandle, folder: Option<String>) -> Result<bool, String> {
    let parent = main_window(&app);
    let mut params = format!("--after-exit {}", std::process::id());
    if let Some(f) = folder {
        // A backslash before the closing quote would escape it, as in "C:\". A path can't hold a quote.
        let f = f.replace('"', "");
        let f = if f.ends_with('\\') { format!("{f}\\") } else { f };
        params.push_str(&format!(" \"{f}\""));
    }
    let started = tauri::async_runtime::spawn_blocking(move || shell_runas(&params, parent, false))
        .await
        .map_err(|e| e.to_string())?;
    match started {
        Ok(_) => {
            app.exit(0);
            Ok(true)
        }
        Err(e) if e.raw_os_error() == Some(ERROR_CANCELLED) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Gives the old copy a moment to close, or the single-instance check would hand over to it.
pub fn wait_for_exit(pid: u32) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
        // SAFETY: a null handle is checked, and the handle is closed after waiting.
        unsafe {
            let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if !h.is_null() {
                WaitForSingleObject(h, 5000);
                CloseHandle(h);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// Whether this copy already has administrator rights.
#[tauri::command]
pub(crate) fn is_admin() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        // SAFETY: the out-pointers are valid for the sizes given, and the token is closed after use.
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }
            let mut e = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                (&mut e as *mut TOKEN_ELEVATION).cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            );
            CloseHandle(token);
            ok != 0 && e.TokenIsElevated != 0
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}
