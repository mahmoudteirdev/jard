// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // Windows' task scheduler: no window, just the scan.
    if let [_, flag, folder] = args.as_slice() {
        if flag == "--scheduled" {
            std::process::exit(jard_desktop_lib::run_scheduled(folder));
        }
    }
    jard_desktop_lib::run();
}
