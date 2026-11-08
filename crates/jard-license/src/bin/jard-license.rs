//! Seller's tool. Keep the secret key away from this repository and back it up: without it no new
//! activations can be issued, and whoever has it can issue them.
//!
//! jard-license keygen <secret-file>
//! jard-license issue <secret-file> <device-code> <key> <customer-name> <out-file>

use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use jard_license::{check_key, issue, parse_secret, public_of, secret_to_text, KeyCheck, License};

fn run(args: &[String]) -> Result<(), String> {
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["keygen", path] => {
            if std::path::Path::new(path).exists() {
                return Err(format!("{path} already exists; refusing to overwrite a secret key"));
            }
            let mut secret = [0u8; 32];
            getrandom::getrandom(&mut secret).map_err(|e| e.to_string())?;
            std::fs::write(path, secret_to_text(&secret)).map_err(|e| e.to_string())?;
            println!("{}", public_of(&secret));
            Ok(())
        }
        ["issue", secret, device, key, name, out] => {
            let text = std::fs::read_to_string(secret).map_err(|e| format!("{secret}: {e}"))?;
            let secret = parse_secret(&text).ok_or("not a secret key file")?;
            let KeyCheck::Ok { key } = check_key(key) else { return Err("bad key".into()) };
            let issued = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let lic = License { device: (*device).into(), key, name: (*name).into(), issued };
            std::fs::write(out, issue(&secret, &lic)).map_err(|e| e.to_string())
        }
        _ => {
            Err("usage: jard-license keygen <secret-file> | issue <secret-file> <device> <key> <name> <out-file>"
                .into())
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
