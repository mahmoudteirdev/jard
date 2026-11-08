//! Command-line front end, for checking the engine on real folders.
//!
//! jard-scan <folder> [--top N] [--threads N] [--max-depth N] [--dedup|--no-dedup] [--gib] [--json FILE]

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use jard_scan::{flags, Node, Options, SortKey, Tree};

struct Args {
    root: PathBuf,
    top: usize,
    binary: bool,
    json: Option<PathBuf>,
    opts: Options,
}

fn parse() -> Result<Args, String> {
    let mut it = std::env::args_os().skip(1);
    let mut args = Args { root: PathBuf::new(), top: 15, binary: false, json: None, opts: Options::default() };
    let mut root = None;
    let num = |v: Option<std::ffi::OsString>, name: &str| -> Result<u64, String> {
        v.and_then(|s| s.to_str()?.parse().ok()).ok_or_else(|| format!("{name} needs a number"))
    };
    while let Some(a) = it.next() {
        match a.to_str() {
            Some("--top") => args.top = num(it.next(), "--top")? as usize,
            Some("--threads") => args.opts.threads = num(it.next(), "--threads")? as usize,
            Some("--max-depth") => args.opts.max_depth = Some(num(it.next(), "--max-depth")? as u32),
            Some("--dedup") => args.opts.dedup_hardlinks = true,
            Some("--no-dedup") => args.opts.dedup_hardlinks = false,
            Some("--gib") => args.binary = true,
            Some("--json") => args.json = Some(it.next().ok_or("--json needs a file")?.into()),
            Some("-h" | "--help") => return Err(String::new()),
            _ if root.is_none() => root = Some(PathBuf::from(a)),
            _ => return Err(format!("unexpected argument {a:?}")),
        }
    }
    args.root = root.ok_or("missing folder")?;
    Ok(args)
}

fn size(n: u64, binary: bool) -> String {
    let (base, units) =
        if binary { (1024.0, ["B", "KiB", "MiB", "GiB", "TiB"]) } else { (1000.0, ["B", "KB", "MB", "GB", "TB"]) };
    let mut v = n as f64;
    let mut u = 0;
    while v >= base && u < units.len() - 1 {
        v /= base;
        u += 1;
    }
    if u == 0 {
        format!("{n} B")
    } else {
        format!("{v:.2} {}", units[u])
    }
}

fn badges(n: &Node) -> String {
    [
        (flags::CLOUD, 'C'),
        (flags::COMPRESSED, 'Z'),
        (flags::SPARSE, 'S'),
        (flags::REPARSE, 'R'),
        (flags::ENCRYPTED, 'E'),
        (flags::HARDLINK, 'H'),
        (flags::DENIED, 'D'),
        (flags::PARTIAL, 'P'),
    ]
    .iter()
    .map(|&(f, c)| if n.has(f) { c } else { '.' })
    .collect()
}

fn main() -> ExitCode {
    let args = match parse() {
        Ok(a) => a,
        Err(msg) => {
            if !msg.is_empty() {
                eprintln!("error: {msg}");
            }
            eprintln!(
                "usage: jard-scan <folder> [--top N] [--threads N] [--max-depth N] [--dedup|--no-dedup] [--gib] [--json FILE]"
            );
            return ExitCode::from(2);
        }
    };

    let scan = jard_scan::spawn(args.root.clone(), args.opts.clone());
    while !scan.is_finished() {
        let p = scan.progress().snapshot();
        eprint!(
            "\r{} files, {} folders, {} on disk, {} denied   ",
            p.files,
            p.dirs,
            size(p.bytes, args.binary),
            p.denied
        );
        let _ = std::io::stderr().flush();
        std::thread::sleep(Duration::from_millis(200));
    }
    eprintln!();
    let tree = match scan.join() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: {}: {e}", args.root.display());
            return ExitCode::FAILURE;
        }
    };

    let r = tree.root_node();
    let b = args.binary;
    println!("{}", r.name);
    println!("  apparent     {:>12}  ({} bytes)", size(r.apparent, b), r.apparent);
    println!("  on disk      {:>12}  ({} bytes)", size(r.on_disk, b), r.on_disk);
    println!(
        "  not counted  {:>12}  (cloud {}, hard links {})",
        size(r.cloud_bytes + r.dedup_bytes, b),
        size(r.cloud_bytes, b),
        size(r.dedup_bytes, b)
    );
    println!(
        "  {} files, {} folders, {} denied, {} nodes, {:.2?}{}",
        r.files,
        r.dirs,
        r.denied,
        tree.nodes.len(),
        tree.elapsed,
        if tree.partial { ", PARTIAL" } else { "" }
    );
    println!();
    println!("  {:>12} {:>12}  {:8}  name", "on disk", "apparent", "flags");
    for c in tree.children(Tree::ROOT, SortKey::OnDisk, 0, Some(args.top)) {
        let name = if c.is_dir { format!("{}{}", c.name, std::path::MAIN_SEPARATOR) } else { c.name.to_string() };
        println!("  {:>12} {:>12}  {}  {}", size(c.on_disk, b), size(c.apparent, b), badges(c), name);
    }
    println!("\n  flags: C cloud, Z compressed, S sparse, R reparse/not followed, E encrypted, H hard link, D denied, P partial");

    if let Some(path) = args.json {
        match std::fs::File::create(&path).and_then(|f| tree.write_json(f)) {
            Ok(()) => println!("  wrote {}", path.display()),
            Err(e) => {
                eprintln!("error: {}: {e}", path.display());
                return ExitCode::FAILURE;
            }
        }
    }
    ExitCode::SUCCESS
}
