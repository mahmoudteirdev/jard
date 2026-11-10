//! Tauri commands for On-Device AI: Natural Language Query & Predictive Storage Depletion.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use jard_clean::Store;
use jard_scan::{
    ai_query::{parse_natural_query as parse_query, ParsedAiQuery},
    predict::{predict_depletion, DepletionForecast, StorageSnapshot},
    Kind,
};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{dto, read, NodeDto, Scans};

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiSearchHit {
    pub node: NodeDto,
    pub path: String,
    pub kind: Kind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiSearchResponse {
    pub parsed: ParsedAiQuery,
    pub hits: Vec<AiSearchHit>,
    pub total_matched_bytes: u64,
}

#[tauri::command]
pub(crate) fn parse_natural_query(prompt: String) -> ParsedAiQuery {
    parse_query(&prompt, now())
}

#[tauri::command]
pub(crate) fn search_natural_query(
    scans: State<'_, Scans>,
    store: State<'_, Arc<Store>>,
    scan_id: u32,
    prompt: String,
) -> Result<AiSearchResponse, String> {
    let parsed = parse_query(&prompt, now());
    let shared = scans.tree(scan_id)?;
    let tree = read(&shared);

    let mut hits: Vec<AiSearchHit> = Vec::new();
    let mut total_bytes: u64 = 0;

    let target_lower = parsed.target_folder.as_deref().map(|s| s.to_lowercase());

    for node in tree.search(&parsed.query, parsed.limit * 2) {
        if let Some(path) = tree.display_path(node.id) {
            if let Some(ref target) = target_lower {
                let path_lower = path.to_lowercase();
                if !path_lower.contains(target) {
                    continue;
                }
            }
            total_bytes += node.on_disk;
            hits.push(AiSearchHit {
                node: dto(&tree, &store, node),
                path,
                kind: Kind::of(&node.name),
            });
            if hits.len() >= parsed.limit {
                break;
            }
        }
    }

    Ok(AiSearchResponse {
        parsed,
        hits,
        total_matched_bytes: total_bytes,
    })
}

fn history_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::data_dir(app)?;
    Ok(dir.join("storage_history.json"))
}

#[tauri::command]
pub(crate) fn predict_storage_depletion(
    app: AppHandle,
    drive_root: Option<String>,
) -> Result<DepletionForecast, String> {
    let drives = jard_scan::drives::list();
    let target = match drive_root {
        Some(ref root) => drives.iter().find(|d| d.root.eq_ignore_ascii_case(root)),
        None => drives
            .iter()
            .find(|d| d.root.eq_ignore_ascii_case("C:\\") && d.ready)
            .or_else(|| drives.iter().find(|d| d.ready)),
    };

    let Some(drive) = target else {
        return Err("No active drive found to forecast".into());
    };

    let path = history_file(&app)?;
    let mut snapshots: Vec<StorageSnapshot> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|data| serde_json::from_str(&data).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let current_time = now();

    // Append current snapshot if more than 30 minutes since last recording
    let should_record = snapshots.last().map_or(true, |last| {
        current_time.saturating_sub(last.timestamp) >= 1800
    });

    if should_record {
        snapshots.push(StorageSnapshot {
            timestamp: current_time,
            free_bytes: drive.free,
            total_bytes: drive.total,
        });
        // Keep up to 120 historical records
        if snapshots.len() > 120 {
            snapshots.remove(0);
        }
        if let Ok(json) = serde_json::to_string_pretty(&snapshots) {
            let _ = fs::write(&path, json);
        }
    }

    Ok(predict_depletion(&snapshots, drive.free, drive.total, current_time))
}
