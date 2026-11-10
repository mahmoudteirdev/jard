use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use jard_scan::{flags, scan, Node, Options, Progress, SortKey, Tree};

/// A fresh folder under the system temp dir, deleted on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!(
            "jard-scan-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        // canonical (on Windows `\\?\`) so long paths can be created below it
        TempDir(fs::canonicalize(&p).unwrap())
    }
    fn file(&self, rel: &str, len: usize) -> PathBuf {
        let p = self.0.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, vec![7u8; len]).unwrap();
        p
    }
    fn dir(&self, rel: &str) {
        fs::create_dir_all(self.0.join(rel)).unwrap();
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// root/a.bin 1000, root/b.bin 5000, root/sub/c.bin 20000, root/sub/deep/d.bin 300, root/empty/
fn sample() -> TempDir {
    let t = TempDir::new();
    t.file("a.bin", 1000);
    t.file("b.bin", 5000);
    t.file("sub/c.bin", 20_000);
    t.file("sub/deep/d.bin", 300);
    t.dir("empty");
    t
}

fn run(root: &Path, opts: Options) -> Tree {
    scan(root, &opts, &Progress::new()).unwrap()
}

fn find<'a>(tree: &'a Tree, name: &str) -> &'a Node {
    tree.nodes.iter().find(|n| &*n.name == name).unwrap_or_else(|| panic!("no node {name}"))
}

fn names(nodes: &[&Node]) -> Vec<String> {
    nodes.iter().map(|n| n.name.to_string()).collect()
}

#[test]
fn sizes_roll_up() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    let root = tree.root_node();

    assert!(!tree.partial);
    assert_eq!(root.flags, 0);
    assert_eq!(root.apparent, 26_300);
    assert_eq!(root.files, 4);
    assert_eq!(root.dirs, 3);
    assert_eq!(root.own_files, 2);
    assert_eq!(root.own_apparent, 6000);
    assert_eq!(tree.nodes.len(), 1 + 4 + 3);

    let sub = find(&tree, "sub");
    assert_eq!((sub.apparent, sub.files, sub.dirs, sub.own_files), (20_300, 2, 1, 1));
    let empty = find(&tree, "empty");
    assert_eq!((empty.apparent, empty.files, empty.dirs), (0, 0, 0));

    for n in tree.nodes.iter().filter(|n| !n.is_dir) {
        assert!(n.on_disk >= n.apparent, "{}: on disk {} < apparent {}", n.name, n.on_disk, n.apparent);
    }
    let file_disk: u64 = tree.nodes.iter().filter(|n| !n.is_dir).map(|n| n.on_disk).sum();
    assert_eq!(root.on_disk, file_disk);
}

#[test]
fn child_ids_are_greater_than_parent_ids() {
    let t = sample();
    let tree = run(&t.0, Options { threads: 8, ..Options::default() });
    for (i, n) in tree.nodes.iter().enumerate() {
        assert_eq!(n.id as usize, i);
        if let Some(p) = n.parent {
            assert!(p < n.id);
            assert!(tree.nodes[p as usize].children.contains(&n.id));
        }
        for &c in &n.children {
            assert_eq!(tree.nodes[c as usize].parent, Some(n.id));
        }
    }
}

#[test]
fn children_sort_and_page() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    let by_size = tree.children(Tree::ROOT, SortKey::Apparent, 0, None);
    assert_eq!(names(&by_size), ["sub", "b.bin", "a.bin", "empty"]);
    let by_name = tree.children(Tree::ROOT, SortKey::Name, 0, None);
    assert_eq!(names(&by_name), ["a.bin", "b.bin", "empty", "sub"]);
    let page = tree.children(Tree::ROOT, SortKey::Apparent, 1, Some(2));
    assert_eq!(names(&page), ["b.bin", "a.bin"]);
    assert!(tree.children(Tree::ROOT, SortKey::OnDisk, 10, None).is_empty());
    assert!(tree.children(9999, SortKey::OnDisk, 0, None).is_empty());
}

#[test]
fn paths_point_at_real_files() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    for n in &tree.nodes {
        let p = tree.path(n.id).unwrap();
        assert!(fs::symlink_metadata(&p).is_ok(), "missing {}", p.display());
    }
    let d = find(&tree, "d.bin");
    let shown = tree.display_path(d.id).unwrap();
    assert!(!shown.starts_with(r"\\?\"));
    assert!(shown.ends_with(&format!("sub{0}deep{0}d.bin", std::path::MAIN_SEPARATOR)), "{shown}");
}

#[test]
fn max_depth_leaves_deeper_folders_partial() {
    let t = sample();
    let tree = run(&t.0, Options { max_depth: Some(0), ..Options::default() });
    assert!(tree.partial);
    assert_eq!(tree.root_node().apparent, 6000);
    assert!(find(&tree, "sub").has(flags::PARTIAL));
    assert!(find(&tree, "empty").has(flags::PARTIAL));
    assert!(find(&tree, "sub").children.is_empty());

    let tree = run(&t.0, Options { max_depth: Some(1), ..Options::default() });
    assert_eq!(tree.root_node().apparent, 26_000);
    assert!(find(&tree, "deep").has(flags::PARTIAL));
    assert!(!find(&tree, "empty").has(flags::PARTIAL));
}

#[test]
fn cancel_keeps_a_partial_tree() {
    let t = sample();
    let progress = Progress::new();
    progress.cancel();
    let tree = scan(&t.0, &Options::default(), &progress).unwrap();
    assert!(tree.partial && tree.cancelled);
    assert!(tree.root_node().has(flags::PARTIAL));
    assert_eq!(tree.nodes.len(), 1);
    let snap = progress.snapshot();
    assert!(snap.done && snap.cancelled);
}

#[test]
fn spawn_reports_progress() {
    let t = sample();
    let handle = jard_scan::spawn(t.0.clone(), Options::default());
    let progress = handle.progress().clone();
    let tree = handle.join().unwrap();
    let snap = progress.snapshot();
    assert!(snap.done && !snap.cancelled);
    assert_eq!((snap.files, snap.dirs, snap.denied), (4, 4, 0));
    assert_eq!(snap.bytes, tree.root_node().on_disk);
}

#[test]
fn hard_links_count_once_when_dedup_is_on() {
    let t = TempDir::new();
    let orig = t.file("one/big.bin", 50_000);
    t.dir("two");
    fs::hard_link(&orig, t.0.join("two/big-link.bin")).unwrap();

    let tree = run(&t.0, Options { dedup_hardlinks: true, ..Options::default() });
    let (a, b) = (find(&tree, "big.bin"), find(&tree, "big-link.bin"));
    assert!(a.has(flags::HARDLINK) && b.has(flags::HARDLINK));
    let (kept, dup) = if a.on_disk > 0 { (a, b) } else { (b, a) };
    assert!(kept.on_disk >= 50_000);
    assert_eq!(dup.on_disk, 0);
    assert_eq!(dup.dedup_bytes, kept.on_disk);
    let root = tree.root_node();
    assert_eq!(root.apparent, 100_000, "apparent counts every path");
    assert_eq!(root.on_disk, kept.on_disk);
    assert_eq!(root.dedup_bytes, kept.on_disk);

    let tree = run(&t.0, Options { dedup_hardlinks: false, ..Options::default() });
    assert!(tree.nodes.iter().all(|n| !n.has(flags::HARDLINK)));
    assert_eq!(tree.root_node().dedup_bytes, 0);
}

#[test]
fn arabic_names_survive() {
    let t = TempDir::new();
    t.file("مجلد عربي/ملف الصور.txt", 123);
    let tree = run(&t.0, Options::default());
    let f = find(&tree, "ملف الصور.txt");
    assert_eq!(f.apparent, 123);
    assert!(tree.path(f.id).unwrap().exists());
    assert_eq!(find(&tree, "مجلد عربي").apparent, 123);
}

#[test]
fn paths_longer_than_260_characters() {
    let t = TempDir::new();
    let seg = "a-fairly-long-folder-name-for-testing";
    let rel: Vec<&str> = std::iter::repeat_n(seg, 10).collect();
    let rel = rel.join("/");
    let f = t.file(&format!("{rel}/deep.bin"), 777);
    assert!(f.as_os_str().len() > 300);

    let tree = run(&t.0, Options::default());
    assert!(!tree.partial);
    assert_eq!(tree.root_node().apparent, 777);
    assert_eq!(tree.root_node().dirs, 10);
}

#[test]
fn json_export_uses_contract_field_names() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    let mut buf = Vec::new();
    tree.write_json(&mut buf).unwrap();
    let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
    assert_eq!(v["format"], "jard-scan");
    assert_eq!(v["partial"], false);
    let root = &v["nodes"][0];
    assert!(root["parent"].is_null());
    assert_eq!(root["apparent"], 26_300);
    for key in [
        "id",
        "name",
        "children",
        "ownApparent",
        "ownOnDisk",
        "ownFiles",
        "onDisk",
        "files",
        "dirs",
        "cloudBytes",
        "dedupBytes",
        "denied",
        "flags",
        "isDir",
    ] {
        assert!(root.get(key).is_some(), "missing {key}");
    }
}

#[test]
fn options_and_sort_key_deserialize_from_ui_json() {
    let o: Options = serde_json::from_str(r#"{"threads":3,"maxDepth":2}"#).unwrap();
    assert_eq!((o.threads, o.max_depth), (3, Some(2)));
    assert_eq!(o.dedup_hardlinks, Options::default().dedup_hardlinks);
    let s: SortKey = serde_json::from_str(r#""on_disk""#).unwrap();
    assert_eq!(s, SortKey::OnDisk);
}

#[test]
fn root_must_be_a_folder() {
    let t = TempDir::new();
    let f = t.file("x.txt", 1);
    let err = scan(&f, &Options::default(), &Progress::new()).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert!(scan(t.0.join("missing"), &Options::default(), &Progress::new()).is_err());
}

#[cfg(unix)]
#[test]
fn symlinks_are_not_followed() {
    let t = TempDir::new();
    t.file("real/big.bin", 40_000);
    std::os::unix::fs::symlink(t.0.join("real"), t.0.join("link")).unwrap();
    let tree = run(&t.0, Options::default());
    let link = find(&tree, "link");
    assert!(link.has(flags::REPARSE) && !link.is_dir);
    assert_eq!(tree.root_node().apparent, 40_000 + link.apparent);
}

#[cfg(windows)]
#[test]
fn junctions_are_not_followed() {
    let t = TempDir::new();
    t.file("real/big.bin", 40_000);
    let target = jard_scan::display_path(&t.0.join("real"));
    let link = jard_scan::display_path(&t.0.join("junction"));
    let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J", &link, &target]).output().unwrap();
    assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
    let tree = run(&t.0, Options::default());
    let j = find(&tree, "junction");
    assert!(j.is_dir && j.has(flags::REPARSE) && !j.has(flags::PARTIAL));
    assert!(j.children.is_empty());
    assert_eq!(tree.root_node().apparent, 40_000);
}

#[cfg(windows)]
#[test]
fn ntfs_compressed_file_is_smaller_on_disk() {
    let t = TempDir::new();
    let f = t.file("squeeze.bin", 1 << 20); // 1 MiB of the same byte compresses well
    let shown = jard_scan::display_path(&f);
    let out = std::process::Command::new("compact").args(["/C", &shown]).output().unwrap();
    if !out.status.success() {
        eprintln!("skipping: compact failed (not NTFS?)");
        return;
    }
    let tree = run(&t.0, Options::default());
    let n = find(&tree, "squeeze.bin");
    assert!(n.has(flags::COMPRESSED));
    assert_eq!(n.apparent, 1 << 20);
    assert!(n.on_disk < n.apparent, "on disk {}", n.on_disk);
}

#[cfg(windows)]
#[test]
fn denied_folder_is_flagged_and_scan_continues() {
    let t = TempDir::new();
    t.file("open/ok.bin", 500);
    t.file("locked/secret.bin", 9000);
    let locked = jard_scan::display_path(&t.0.join("locked"));
    // Deny "Everyone" listing the folder. Deny rules apply to administrators too.
    let icacls = |args: &[&str]| std::process::Command::new("icacls").arg(&locked).args(args).output().unwrap();
    let out = icacls(&["/deny", "*S-1-1-0:(RD)"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    // Shells such as Git Bash (MSYS) enable SeBackupPrivilege for admins, and directory
    // listing then ignores the ACL. Nothing to test in that case.
    let still_listable = fs::read_dir(t.0.join("locked")).is_ok();
    let tree = run(&t.0, Options::default());
    icacls(&["/remove:d", "*S-1-1-0"]); // let TempDir delete it
    if still_listable {
        eprintln!(
            "skipping: this process can bypass folder permissions (backup privilege); run from PowerShell or cmd"
        );
        return;
    }

    let l = find(&tree, "locked");
    assert!(l.has(flags::DENIED) && !l.has(flags::PARTIAL), "flags {}", l.flags);
    assert_eq!((l.denied, l.files), (1, 0));
    assert_eq!(tree.root_node().denied, 1);
    assert_eq!(tree.root_node().apparent, 500, "the rest of the scan still counts");
    assert!(!tree.partial, "a denied folder is not an error");
}

#[test]
fn duplicates_are_found_by_content_not_name_or_size() {
    use std::sync::atomic::AtomicBool;
    let t = TempDir::new();
    let body = vec![9u8; 200_000];
    let mut other = body.clone();
    *other.last_mut().unwrap() = 1; // same size and same first 64 KiB, different content
    fs::write(t.file("a/one.bin", 0), &body).unwrap();
    fs::write(t.file("much/deeper/copy.bin", 0), &body).unwrap();
    fs::write(t.file("near-miss.bin", 0), &other).unwrap();
    t.file("small-1.txt", 10);
    t.file("small-2.txt", 10);
    let link_target = t.file("linked/orig.bin", 150_000);
    fs::hard_link(&link_target, t.0.join("linked/also.bin")).unwrap();

    let tree = run(&t.0, Options::default());
    let groups = jard_scan::find_duplicates(&tree, 1000, &AtomicBool::new(false));
    assert_eq!(groups.len(), 1, "{groups:?}");
    assert_eq!(groups[0].size, 200_000);
    assert_eq!(groups[0].reclaimable(), 200_000);
    let names: Vec<&str> = groups[0].files.iter().map(|&i| &*tree.nodes[i as usize].name).collect();
    assert_eq!(names, ["one.bin", "copy.bin"], "the shortest path comes first");

    assert!(jard_scan::find_duplicates(&tree, 1000, &AtomicBool::new(true)).is_empty(), "stop ends it");
}

#[test]
fn large_and_old_files_are_listed() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    let large: Vec<&str> = tree.largest_files(5000, 10).iter().map(|n| &*n.name).collect();
    assert_eq!(large, ["c.bin", "b.bin"]);
    let f = find(&tree, "c.bin");
    assert!(f.modified > 1_600_000_000, "modified {}", f.modified);
    assert!(tree.old_files(f.modified + 86_400, 5000, 10).len() == 2);
    assert!(tree.old_files(f.modified - 86_400, 0, 10).is_empty());

    let tails: &[&[&str]] = &[&["nope", "deep"], &["SUB", "deep"]];
    let hits = tree.folders_ending_with(tails);
    assert_eq!(hits.len(), 1);
    assert_eq!((&*hits[0].0.name, hits[0].1), ("deep", 1));
}

#[test]
fn saved_tree_reads_back_the_same_and_leaves_out_what_left_the_disk() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    let mut buf = Vec::new();
    tree.save(&mut buf).unwrap();
    let back = Tree::load(&buf[..]).unwrap();
    assert_eq!(back.nodes, tree.nodes);
    assert_eq!(back.root, tree.root);
    assert_eq!(back.partial, tree.partial);

    // A saved tree works like a fresh one.
    assert_eq!(names(&back.children(Tree::ROOT, SortKey::Name, 0, None)), ["a.bin", "b.bin", "empty", "sub"]);
    assert!(back.path(find(&back, "d.bin").id).unwrap().exists());

    let mut moved = tree.clone();
    let sub = find(&moved, "sub").id;
    assert!(moved.detach(sub));
    let mut buf = Vec::new();
    moved.save(&mut buf).unwrap();
    let back = Tree::load(&buf[..]).unwrap();
    assert_eq!(back.root_node().apparent, 6000);
    assert_eq!(back.root_node().files, 2);
    assert!(back.nodes.iter().all(|n| &*n.name != "sub" && &*n.name != "c.bin" && &*n.name != "deep"));
    for (i, n) in back.nodes.iter().enumerate() {
        assert_eq!(n.id as usize, i);
        assert!(n.parent.is_none_or(|p| p < n.id));
    }
}

#[test]
fn damaged_scan_files_are_errors_not_panics() {
    let t = sample();
    let tree = run(&t.0, Options::default());
    let mut good = Vec::new();
    tree.save(&mut good).unwrap();

    assert!(Tree::load(&b""[..]).is_err());
    assert!(Tree::load(&b"not a scan file at all"[..]).is_err());
    for cut in [1, 10, 11, good.len() / 2, good.len() - 1] {
        assert!(Tree::load(&good[..cut]).is_err(), "cut at {cut}");
    }
    // Every single-byte change must load or fail cleanly, never panic.
    for i in 10..good.len() {
        let mut bad = good.clone();
        bad[i] ^= 0xFF;
        let _ = Tree::load(&bad[..]);
    }
}

#[test]
fn search_finds_by_name_kind_size_and_emptiness() {
    use jard_scan::{kind_totals, Kind, Query};
    let t = TempDir::new();
    t.file("video/holiday.MP4", 9000);
    t.file("video/notes.txt", 100);
    t.file("Makefile", 50);
    t.file("ملفات/تقرير.pdf", 5000);
    t.dir("empty-one");
    let tree = run(&t.0, Options::default());
    let hit = |q: Query| -> Vec<String> { tree.search(&q, 50).iter().map(|n| n.name.to_string()).collect() };

    assert_eq!(hit(Query { text: "HOLI".into(), ..Query::default() }), ["holiday.MP4"]);
    assert_eq!(hit(Query { text: "تقرير".into(), ..Query::default() }), ["تقرير.pdf"]);
    assert_eq!(hit(Query { kind: Some(Kind::Video), ..Query::default() }), ["holiday.MP4"]);
    assert_eq!(hit(Query { no_extension: true, ..Query::default() }), ["Makefile"]);
    assert_eq!(hit(Query { empty_folders: true, ..Query::default() }), ["empty-one"]);
    assert_eq!(hit(Query { text: "o".into(), min_size: 8000, ..Query::default() }), ["video", "holiday.MP4"]);

    let totals = kind_totals(&tree);
    assert_eq!(totals[0].kind, Kind::Video);
    assert_eq!(totals.iter().map(|k| k.files).sum::<u64>(), 4);
    assert_eq!(totals.iter().map(|k| k.on_disk).sum::<u64>(), tree.root_node().on_disk);
}

#[test]
fn excluded_folder_is_listed_but_not_read() {
    let t = TempDir::new();
    t.file("keep/a.bin", 1000);
    t.file("skip/b.bin", 5000);
    let opts = Options { excluded: vec![t.0.join("skip")], ..Options::default() };
    let tree = run(&t.0, opts);
    let root = tree.root_node();
    assert_eq!(root.apparent, 1000);
    assert_eq!(root.children.len(), 2, "the folder stays visible");
    let skip = tree.nodes.iter().find(|n| &*n.name == "skip").unwrap();
    assert!(skip.has(flags::PARTIAL), "marked as not fully read");
}

#[test]
fn truth_counts_slack_and_names_an_example() {
    let t = TempDir::new();
    t.file("small/a.bin", 10);
    let facts = run(&t.0, Options::default()).truth_facts();
    assert_eq!(facts.apparent, 10);
    assert_eq!(facts.cloud_files, 0);
    assert!(facts.on_disk == facts.apparent + facts.slack_bytes || facts.on_disk <= facts.apparent);
}

#[test]
fn a_paused_scan_reads_nothing_until_resumed() {
    let t = TempDir::new();
    t.file("a/one.bin", 100);
    t.file("b/two.bin", 200);
    let progress = std::sync::Arc::new(Progress::new());
    progress.set_paused(true);
    let (root, p) = (t.0.clone(), std::sync::Arc::clone(&progress));
    let scan = std::thread::spawn(move || scan(&root, &Options::default(), &p).unwrap());
    std::thread::sleep(std::time::Duration::from_millis(300));
    let held = progress.snapshot();
    assert!(!held.done && held.paused);
    assert_eq!(held.dirs, 0, "nothing listed while paused");
    progress.set_paused(false);
    let tree = scan.join().unwrap();
    assert_eq!(tree.root_node().apparent, 300);
}

#[test]
fn cancelling_a_paused_scan_ends_it() {
    let t = TempDir::new();
    t.file("a/one.bin", 100);
    let progress = std::sync::Arc::new(Progress::new());
    progress.set_paused(true);
    let (root, p) = (t.0.clone(), std::sync::Arc::clone(&progress));
    let scan = std::thread::spawn(move || scan(&root, &Options::default(), &p).unwrap());
    std::thread::sleep(std::time::Duration::from_millis(150));
    progress.cancel();
    assert!(scan.join().unwrap().cancelled);
}

#[cfg(windows)]
#[test]
fn ntfs_mft_fast_scan_checks_drive() {
    use std::path::Path;
    assert!(!jard_scan::mft::is_drive_root(Path::new("C:\\Users")));
    assert!(jard_scan::mft::is_drive_root(Path::new("C:\\")));
    assert!(jard_scan::mft::is_drive_root(Path::new("C:")));

    if jard_scan::mft::can_scan_mft(Path::new("C:\\")) {
        let p = Progress::new();
        let opts = Options {
            max_depth: Some(1),
            ..Options::default()
        };
        let tree = jard_scan::mft::scan_mft(Path::new("C:\\"), &opts, &p);
        assert!(tree.is_ok(), "MFT scan on C:\\ must succeed when can_scan_mft is true");
        let t = tree.unwrap();
        assert!(!t.nodes.is_empty());
        assert!(t.root_node().dirs > 0);
    }
}
