//! Read-only facts about this machine: programs, disks, hardware, errors, open ports.
//!
//! Each reading is a fixed PowerShell script with nothing from the UI spliced in. The one action
//! here, uninstalling, looks the command up in the registry by key: the UI never supplies a command.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::{read, Scans};

#[cfg(windows)]
pub(crate) fn hidden(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hidden(_cmd: &mut Command) {}

/// Runs a fixed script and parses the JSON it prints. Tries to read as UTF-8 for Arabic names.
pub(crate) fn powershell(script: &str) -> Result<Value, String> {
    if !cfg!(windows) {
        return Ok(Value::Array(Vec::new()));
    }
    let full =
        format!("$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;{script}");
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &full]);
    hidden(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let text = text.trim().trim_start_matches('\u{feff}');
    if text.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let mut value = serde_json::from_str(text).map_err(|e| format!("bad output: {e}"))?;
    empty_objects_to_null(&mut value);
    Ok(value)
}

/// Windows PowerShell writes "nothing" as `{}` when an expression produced no value, and the UI
/// expects a null there. No reading here has a real empty object.
fn empty_objects_to_null(value: &mut Value) {
    match value {
        Value::Object(map) if map.is_empty() => *value = Value::Null,
        Value::Object(map) => map.values_mut().for_each(empty_objects_to_null),
        Value::Array(list) => list.iter_mut().for_each(empty_objects_to_null),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_nothing_becomes_null() {
        let mut v = serde_json::json!([{ "port": 80, "process": {}, "inner": { "x": [{}] } }]);
        empty_objects_to_null(&mut v);
        assert_eq!(v, serde_json::json!([{ "port": 80, "process": null, "inner": { "x": [null] } }]));
    }
}

async fn reading(script: &'static str) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || powershell(script)).await.map_err(|e| e.to_string())?
}

const PROGRAMS: &str = r#"
$keys='HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*';
$rows=Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and $_.UninstallString } |
 Select-Object @{n='key';e={$_.PSPath -replace '^.*::',''}},@{n='name';e={$_.DisplayName}},@{n='version';e={$_.DisplayVersion}},@{n='publisher';e={$_.Publisher}},@{n='sizeKb';e={$_.EstimatedSize}},@{n='installDate';e={$_.InstallDate}};
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

const DRIVERS: &str = r#"
$rows=Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceClass -in 'DISPLAY','NET','MEDIA','HDC','SCSIADAPTER','BLUETOOTH','USB' -and $_.DriverVersion } |
 Select-Object @{n='name';e={$_.DeviceName}},@{n='cls';e={$_.DeviceClass}},@{n='version';e={$_.DriverVersion}},@{n='date';e={if($_.DriverDate){$_.DriverDate.ToString('yyyy-MM-dd')}}},@{n='maker';e={$_.Manufacturer}};
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

const DISKS: &str = r#"
$rows=Get-PhysicalDisk | ForEach-Object { $r=$_ | Get-StorageReliabilityCounter;
 [pscustomobject]@{ name=$_.FriendlyName; media=[string]$_.MediaType; bus=[string]$_.BusType; health=[string]$_.HealthStatus; size=$_.Size; temperature=$r.Temperature; hours=$r.PowerOnHours; wear=$r.Wear; readErrors=$r.ReadErrorsTotal; writeErrors=$r.WriteErrorsTotal } };
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

const HARDWARE: &str = r#"
$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; $b=Get-CimInstance Win32_Battery | Select-Object -First 1; $full=Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1; $design=Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData | Select-Object -First 1;
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ cpuName=$cpu.Name; cpuLoad=$cpu.LoadPercentage; memTotal=[int64]$os.TotalVisibleMemorySize*1024; memFree=[int64]$os.FreePhysicalMemory*1024; osName=$os.Caption; bootedAt=$os.LastBootUpTime.ToString('o'); batteryCharge=$b.EstimatedChargeRemaining; batteryFull=$full.FullChargedCapacity; batteryDesign=$design.DesignedCapacity })"#;

const STARTUP: &str = r#"
$skip='PSPath','PSParentPath','PSChildName','PSDrive','PSProvider';
$approved=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';
$rows=@();
foreach($k in @(@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','user',$true),@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','machine',$false),@('HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run','machine',$false))){
 $p=Get-ItemProperty $k[0]; if($p){ foreach($n in $p.PSObject.Properties.Name){ if($skip -notcontains $n){ $b=$approved.$n; $off=[bool]($k[2] -and $b -and ($b[0] -band 1));
  $rows+=[pscustomobject]@{ name=$n; where=$k[1]; user=$null; canToggle=$k[2]; disabled=$off } } } } };
foreach($d in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup'))){ Get-ChildItem -LiteralPath $d -File | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object { $rows+=[pscustomobject]@{ name=$_.BaseName; where='folder'; user=$null; canToggle=$false; disabled=$false } } };
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

const EVENTS: &str = r#"
$rows=Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddDays(-30)} -MaxEvents 40 |
 Select-Object @{n='provider';e={$_.ProviderName}},@{n='id';e={$_.Id}},@{n='level';e={$_.Level}},@{n='at';e={$_.TimeCreated.ToString('o')}},@{n='message';e={ if($_.Message){ ($_.Message -split "`n")[0] } }};
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

const PORTS: &str = r#"
$names=@{}; Get-Process | ForEach-Object { $names[[int]$_.Id]=$_.ProcessName };
$rows=Get-NetTCPConnection -State Listen | Group-Object LocalAddress,LocalPort | ForEach-Object { $c=$_.Group | Where-Object { $_.OwningProcess -ne 0 } | Select-Object -First 1; if(-not $c){ $c=$_.Group[0] };
 $p=$null; if($c.OwningProcess -ne 0){ $p=$names[[int]$c.OwningProcess] };
 [pscustomobject]@{ port=$c.LocalPort; address=$c.LocalAddress; process=$p } } | Sort-Object port;
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)"#;

#[tauri::command]
pub(crate) async fn installed_programs() -> Result<Value, String> {
    reading(PROGRAMS).await
}

#[tauri::command]
pub(crate) async fn installed_drivers() -> Result<Value, String> {
    reading(DRIVERS).await
}

#[tauri::command]
pub(crate) async fn disk_health() -> Result<Value, String> {
    reading(DISKS).await
}

#[tauri::command]
pub(crate) async fn hardware_now() -> Result<Value, String> {
    reading(HARDWARE).await
}

#[tauri::command]
pub(crate) async fn startup_programs() -> Result<Value, String> {
    reading(STARTUP).await
}

#[tauri::command]
pub(crate) async fn system_errors() -> Result<Value, String> {
    reading(EVENTS).await
}

#[tauri::command]
pub(crate) async fn open_ports() -> Result<Value, String> {
    reading(PORTS).await
}

/// Starts a program's own uninstaller. The key must be a real Uninstall key: its command is read
/// from the registry here, so nothing the UI sends can become a command.
#[tauri::command]
pub(crate) async fn uninstall_program(key: String) -> Result<(), String> {
    let is_uninstall_key = key.contains("\\CurrentVersion\\Uninstall\\")
        && (key.starts_with("HKEY_LOCAL_MACHINE\\") || key.starts_with("HKEY_CURRENT_USER\\"))
        && !key.contains(['\'', '"', '`', '$', ';', '|', '&', '\n', '\r']);
    if !is_uninstall_key {
        return Err("not an uninstall entry".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            "ConvertTo-Json -Compress -InputObject (Get-ItemProperty -LiteralPath 'Registry::{key}').UninstallString"
        );
        let Value::String(command) = powershell(&script)? else {
            return Err("this entry has no uninstaller".to_string());
        };
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &command]);
        hidden(&mut cmd);
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Speed {
    write_mb_s: f64,
    read_mb_s: f64,
    size_mb: u64,
}

const SPEED_BLOCK: usize = 1024 * 1024;
const SPEED_MB: u64 = 256;
const SECTOR: usize = 4096;

/// A block aligned for unbuffered I/O, which Windows requires to bypass its cache.
fn aligned(len: usize) -> (Vec<u8>, usize) {
    let buf = vec![0u8; len + SECTOR];
    let offset = SECTOR - (buf.as_ptr() as usize % SECTOR);
    (buf, offset % SECTOR)
}

fn speed_test(path: &Path) -> std::io::Result<Speed> {
    #[cfg(windows)]
    let (mut write_opts, mut read_opts) = {
        use std::os::windows::fs::OpenOptionsExt;
        const NO_BUFFERING: u32 = 0x2000_0000;
        const WRITE_THROUGH: u32 = 0x8000_0000;
        let mut w = OpenOptions::new();
        w.custom_flags(NO_BUFFERING | WRITE_THROUGH);
        let mut r = OpenOptions::new();
        r.custom_flags(NO_BUFFERING);
        (w, r)
    };
    #[cfg(not(windows))]
    let (mut write_opts, mut read_opts) = (OpenOptions::new(), OpenOptions::new());

    let (mut buf, off) = aligned(SPEED_BLOCK);
    // Not compressible, so a compressing drive can't flatter the result.
    let mut x = 0x2545_F491_4F6C_DD1Du64;
    for chunk in buf[off..off + SPEED_BLOCK].as_chunks_mut::<8>().0 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        chunk.copy_from_slice(&x.to_le_bytes());
    }

    let start = Instant::now();
    {
        let mut f = write_opts.write(true).create_new(true).open(path)?;
        for _ in 0..SPEED_MB {
            f.write_all(&buf[off..off + SPEED_BLOCK])?;
        }
        f.sync_all()?;
    }
    let write_s = start.elapsed().as_secs_f64();

    let start = Instant::now();
    {
        let mut f = read_opts.read(true).open(path)?;
        for _ in 0..SPEED_MB {
            f.read_exact(&mut buf[off..off + SPEED_BLOCK])?;
        }
    }
    let read_s = start.elapsed().as_secs_f64();
    let mb = SPEED_MB as f64 * (SPEED_BLOCK as f64 / 1e6);
    Ok(Speed { write_mb_s: mb / write_s, read_mb_s: mb / read_s, size_mb: SPEED_MB })
}

/// Writes and reads a temporary file in the app's data folder, then deletes it.
#[tauri::command]
pub(crate) async fn disk_speed(app: AppHandle) -> Result<Speed, String> {
    let dir: PathBuf = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("speedtest-{}.tmp", std::process::id()));
        let result = speed_test(&path).map_err(|e| e.to_string());
        let _ = fs::remove_file(&path); // whatever happened, the file goes
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A spreadsheet treats a cell starting with these as a formula, and file names come from anywhere.
fn csv_cell(s: &str) -> String {
    let safe = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{s}") } else { s.to_string() };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

/// Folders three levels down and files of at least 10 MB, as a CSV that Excel opens with Arabic intact.
#[tauri::command]
pub(crate) async fn export_csv(scans: State<'_, Scans>, scan_id: u32, path: String) -> Result<u64, String> {
    let shared = scans.tree(scan_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let tree = read(&shared);
        let mut out = std::io::BufWriter::new(fs::File::create(&path).map_err(|e| format!("{path}: {e}"))?);
        let write = |w: &mut std::io::BufWriter<fs::File>, line: String| {
            w.write_all(line.as_bytes()).map_err(|e| e.to_string())
        };
        write(&mut out, "\u{feff}path,type,apparent_bytes,on_disk_bytes,files\r\n".to_string())?;
        let mut depth = vec![0u32; tree.nodes.len()];
        let mut rows = 0u64;
        for n in &tree.nodes {
            let d = n.parent.map_or(0, |p| depth[p as usize] + 1);
            depth[n.id as usize] = d;
            let wanted = if n.is_dir { d <= 3 } else { n.on_disk >= 10_000_000 };
            if !wanted || !tree.is_attached(n) {
                continue;
            }
            let shown = tree.display_path(n.id).unwrap_or_default();
            let kind = if n.is_dir { "folder" } else { "file" };
            write(&mut out, format!("{},{kind},{},{},{}\r\n", csv_cell(&shown), n.apparent, n.on_disk, n.files))?;
            rows += 1;
        }
        out.flush().map_err(|e| e.to_string())?;
        Ok(rows)
    })
    .await
    .map_err(|e| e.to_string())?
}
