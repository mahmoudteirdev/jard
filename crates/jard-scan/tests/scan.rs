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
