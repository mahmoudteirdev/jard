//! Tauri commands for the AI Agent: system command execution, project scaffolding,
//! directory inspection, and file organization.
//! All commands require explicit human confirmation in the UI before execution.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Executes a shell command (PowerShell on Windows) and returns stdout/stderr.
/// The UI MUST display the exact command and obtain user approval before calling this.
#[tauri::command]
pub async fn run_agent_command(command: String) -> Result<AgentCommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &command])
            .output()
            .map_err(|e| format!("failed to spawn powershell: {e}"))?;

        #[cfg(not(target_os = "windows"))]
        let output = Command::new("sh")
            .args(["-c", &command])
            .output()
            .map_err(|e| format!("failed to spawn sh: {e}"))?;

        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        Ok(AgentCommandOutput {
            exit_code,
            stdout,
            stderr,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates or overwrites a file with the given content.
#[tauri::command]
pub async fn write_agent_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("cannot create directory: {e}"))?;
        }
        fs::write(&p, content).map_err(|e| format!("cannot write file: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads a file's content as text (capped at 128KB).
#[tauri::command]
pub async fn read_agent_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        let meta = fs::metadata(&p).map_err(|e| format!("file not found: {e}"))?;
        if meta.len() > 128 * 1024 {
            return Err("file exceeds 128KB read limit".to_string());
        }
        fs::read_to_string(&p).map_err(|e| format!("cannot read file: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lists files and subfolders in a target directory.
#[tauri::command]
pub async fn list_agent_dir(path: String) -> Result<Vec<AgentDirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = if path.trim().is_empty() {
            dirs_fallback()
        } else {
            PathBuf::from(path)
        };

        if !target.exists() {
            return Err("path does not exist".to_string());
        }

        let mut entries = Vec::new();
        let rd = fs::read_dir(&target).map_err(|e| format!("failed reading directory: {e}"))?;

        for entry in rd.flatten() {
            let p = entry.path();
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            let is_dir = p.is_dir();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

            entries.push(AgentDirEntry {
                name,
                path: p.to_string_lossy().to_string(),
                is_dir,
                size,
            });

            if entries.len() >= 150 {
                break;
            }
        }

        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves a file or folder from source to destination.
#[tauri::command]
pub async fn move_agent_file(from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&from);
        let dst = PathBuf::from(&to);
        if !src.exists() {
            return Err("source does not exist".to_string());
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("cannot create parent dir: {e}"))?;
        }
        fs::rename(&src, &dst).map_err(|e| format!("failed moving file: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Queries Google Gemini API directly via native HTTP client (bypassing browser CORS/WebView2 restrictions).
#[tauri::command]
pub async fn query_gemini_api(api_key: String, payload_json: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean_key = api_key.trim();
        if clean_key.is_empty() {
            return Err("مفتاح API غير موجود. يرجى إدخال مفتاح Gemini في الإعدادات.".to_string());
        }

        let models = [
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3-flash-preview",
            "gemini-3.8-flash",
            "gemini-flash-latest",
        ];

        let mut last_err = String::new();

        for model in models {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={clean_key}"
            );

            let res = ureq::post(&url)
                .timeout(std::time::Duration::from_secs(35))
                .set("Content-Type", "application/json")
                .send_string(&payload_json);

            match res {
                Ok(resp) => {
                    let text = resp.into_string().map_err(|e| e.to_string())?;
                    return Ok(text);
                }
                Err(ureq::Error::Status(code, resp)) => {
                    let err_body = resp.into_string().unwrap_or_default();
                    if err_body.contains("API_KEY_INVALID") || err_body.contains("PERMISSION_DENIED") {
                        return Err("مفتاح API غير صالح أو غير مفعّل في Google AI Studio.".to_string());
                    }
                    if code == 404 || code == 503 {
                        last_err = format!("Gemini {model} ({code}): {err_body}");
                        continue;
                    }
                    return Err(format!("خطأ من Gemini ({code}): {err_body}"));
                }
                Err(e) => {
                    last_err = format!("Gemini {model} network error: {e}");
                }
            }
        }

        Err(format!("تعذر الاتصال بخوادم Gemini: {last_err}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn dirs_fallback() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return PathBuf::from(userprofile);
    }
    PathBuf::from(".")
}
