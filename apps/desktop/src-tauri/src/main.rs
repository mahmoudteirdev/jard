// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    // The modes with no window. Every other argument is a folder to scan, handled by the app.
    match args.as_slice() {
        // Windows' task scheduler: just the scan.
        [_, "--scheduled", folder] => std::process::exit(jard_desktop_lib::run_scheduled(folder)),
        // At sign-in, when turned on: warn about full drives and leave.
        [_, "--startup-check"] => std::process::exit(jard_desktop_lib::startup_check()),
        // The uninstaller, for each thing the person chose to remove.
        [_, "--uninstall-clean", what] => std::process::exit(jard_desktop_lib::uninstall_clean(what)),
        // One operation with administrator rights, then gone.
        [_, "--elevated", data_dir, job, sha] => std::process::exit(jard_desktop_lib::run_elevated(data_dir, job, sha)),
        // Restarting with administrator rights: the old copy has to close first.
        [_, "--after-exit", pid, ..] => {
            if let Ok(pid) = pid.parse() {
                jard_desktop_lib::wait_for_exit(pid);
            }
        }
        _ => {}
    }
    jard_desktop_lib::run();
}
