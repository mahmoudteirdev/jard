//! Every test works in its own temp folder. Protected-path tests only ask `check`: they move nothing.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use jard_clean::{protect, EffectKind, Failure, LogKind, OnConflict, Protected, Reason, Request, Store};

struct Temp(PathBuf);

impl Temp {
    fn new() -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!(
            "jard-clean-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        Temp(fs::canonicalize(&p).unwrap())
    }
    fn file(&self, rel: &str, len: usize) -> PathBuf {
        let p = self.0.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, vec![3u8; len]).unwrap();
        p
    }
    /// A store with its data in here, nothing protected but itself.
    fn store(&self) -> Store {
        Store::with_protected(self.0.join("data"), Protected::default()).unwrap()
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn req(path: &Path, size: u64) -> Request {
    Request { path: path.to_path_buf(), is_dir: path.is_dir(), apparent: size, on_disk: size, files: 1 }
}

#[test]
fn file_moves_out_and_comes_back_byte_for_byte() {
    let t = Temp::new();
    let f = t.file("docs/report.pdf", 5000);
    let s = t.store();
    let out = s.quarantine(&[req(&f, 5000)]);
    let item = out[0].item.clone().expect("moved");
    assert!(out[0].failure.is_none());
    assert!(!f.exists(), "gone from where it was");
    assert_eq!(s.list(), vec![item.clone()]);
    assert_eq!(item.expires_at - item.moved_at, 30 * 86_400);

    let back = s.restore(&item.id, OnConflict::Fail).unwrap();
    assert!(f.exists());
    assert_eq!(fs::read(&f).unwrap(), vec![3u8; 5000]);
    assert!(!back.starts_with(r"\\?\"), "{back}");
    assert!(s.list().is_empty());
}

#[test]
fn folder_moves_whole_and_restores_to_a_missing_parent() {
    let t = Temp::new();
    t.file("project/a/b/c.bin", 100);
    t.file("project/top.txt", 7);
    let dir = t.0.join("project");
    let s = t.store();
    let id = s.quarantine(&[req(&dir, 107)])[0].item.clone().unwrap().id;
    assert!(!dir.exists());

    // the parent of the original is gone too by the time of the restore
    let nested = t.file("gone/deep/thing.txt", 1);
    let id2 = s.quarantine(&[req(&nested, 1)])[0].item.clone().unwrap().id;
    fs::remove_dir_all(t.0.join("gone")).unwrap();
    s.restore(&id2, OnConflict::Fail).unwrap();
    assert!(nested.exists());

    s.restore(&id, OnConflict::Fail).unwrap();
    assert_eq!(fs::read(dir.join("a/b/c.bin")).unwrap().len(), 100);
    assert_eq!(fs::read(dir.join("top.txt")).unwrap().len(), 7);
}

#[test]
fn restore_never_overwrites() {
    let t = Temp::new();
    let f = t.file("note.txt", 10);
    let s = t.store();
    let id = s.quarantine(&[req(&f, 10)])[0].item.clone().unwrap().id;
    fs::write(&f, b"newer").unwrap();

    assert_eq!(s.restore(&id, OnConflict::Fail), Err(Failure::Conflict));
    assert_eq!(fs::read(&f).unwrap(), b"newer", "the newer file is untouched");
    assert_eq!(s.list().len(), 1, "still in quarantine");

    let back = s.restore(&id, OnConflict::KeepBoth).unwrap();
    assert!(back.ends_with("note (restored).txt"), "{back}");
    assert_eq!(fs::read(&f).unwrap(), b"newer");
    assert_eq!(fs::read(t.0.join("note (restored).txt")).unwrap().len(), 10);
}

#[test]
fn one_failure_does_not_stop_the_rest() {
    let t = Temp::new();
    let good = t.file("good.bin", 10);
    let also = t.file("also.bin", 20);
    let s = t.store();
    let out = s.quarantine(&[req(&good, 10), req(&t.0.join("missing.bin"), 1), req(&also, 20)]);
    assert!(out[0].item.is_some() && out[2].item.is_some());
    assert_eq!(out[1].failure, Some(Failure::Missing));
    assert_eq!(s.list().len(), 2);
    assert_eq!(fs::read_dir(t.0.join("data/quarantine")).unwrap().count(), 2, "no leftover folder");
}

#[test]
fn delete_frees_it_for_good_and_expiry_waits_30_days() {
    let t = Temp::new();
    let keep = t.file("keep.bin", 1);
    let del = t.file("del.bin", 2);
    let s = t.store();
    let a = s.quarantine(&[req(&keep, 1)])[0].item.clone().unwrap();
    let b = s.quarantine(&[req(&del, 2)])[0].item.clone().unwrap();
    s.delete(&b.id).unwrap();
    assert_eq!(s.list(), vec![a.clone()]);
    assert_eq!(s.restore(&b.id, OnConflict::Fail), Err(Failure::Missing));

    assert!(s.purge_expired().is_empty(), "too soon");
    assert!(s.purge_expired_at(a.expires_at - 1).is_empty(), "one second early");
    assert_eq!(s.purge_expired_at(a.expires_at), vec![a]);
    assert!(s.list().is_empty());
    assert!(!keep.exists());
}

#[test]
fn deleting_read_only_contents_works() {
    let t = Temp::new();
    let f = t.file("ro/locked.bin", 3);
    let mut perm = fs::metadata(&f).unwrap().permissions();
    perm.set_readonly(true);
    fs::set_permissions(&f, perm).unwrap();
    let s = t.store();
    let item = s.quarantine(&[req(&t.0.join("ro"), 3)])[0].item.clone().unwrap();
    s.delete(&item.id).unwrap();
    assert!(s.list().is_empty());
}

#[test]
fn ids_cannot_escape_the_quarantine() {
    let t = Temp::new();
    let outside = t.file("outside/item.json", 2);
    let s = t.store();
    for id in ["..\\..\\outside", "../../outside", "", ".", "..", "C:\\x"] {
        assert_eq!(s.delete(id), Err(Failure::Missing), "{id:?}");
        assert_eq!(s.restore(id, OnConflict::KeepBoth), Err(Failure::Missing), "{id:?}");
    }
    assert!(outside.exists());
}

#[test]
fn unfinished_move_is_tidied_and_loses_nothing() {
    let t = Temp::new();
    let f = t.file("x.bin", 5);
    let s = t.store();
    let item = s.quarantine(&[req(&f, 5)])[0].item.clone().unwrap();
    s.restore(&item.id, OnConflict::Fail).unwrap();
    // As if the app died after writing item.json, before the rename.
    let ghost = t.0.join("data/quarantine/123-1-1");
    fs::create_dir_all(&ghost).unwrap();
    let json = serde_json::to_vec(&item).unwrap();
    fs::write(ghost.join("item.json"), json).unwrap();
    assert!(s.list().is_empty());
    assert!(!ghost.exists());
    assert!(f.exists(), "the real file never moved");
}

#[test]
fn long_paths_and_arabic_names_round_trip() {
    let t = Temp::new();
    let seg = "a-fairly-long-folder-name-for-testing";
    let rel = std::iter::repeat_n(seg, 10).collect::<Vec<_>>().join("/");
    let f = t.file(&format!("{rel}/ملف عربي.bin"), 9);
    assert!(f.as_os_str().len() > 300);
    let s = t.store();
    let item = s.quarantine(&[req(&f, 9)])[0].item.clone().expect("long path moved");
    assert!(!f.exists());
    // Same drive as the data folder, so it belongs in the main quarantine, not at the top of the drive.
    assert_eq!(fs::read_dir(t.0.join("data/quarantine")).unwrap().count(), 1);
    s.restore(&item.id, OnConflict::Fail).unwrap();
    assert_eq!(fs::read(&f).unwrap().len(), 9);
}

#[test]
fn history_keeps_counts_but_no_names() {
    let t = Temp::new();
    let f = t.file("very-private-name.bin", 8);
    let s = t.store();
    let id = s.quarantine(&[req(&f, 8)])[0].item.clone().unwrap().id;
    s.restore(&id, OnConflict::Fail).unwrap();
    let log = s.log(10);
    assert_eq!(log.iter().map(|l| l.kind).collect::<Vec<_>>(), [LogKind::Restored, LogKind::Quarantined]);
    assert_eq!((log[1].count, log[1].bytes), (1, 8));
    let raw = fs::read_to_string(t.0.join("data/log.jsonl")).unwrap();
    assert!(!raw.contains("very-private-name"), "{raw}");
}

#[test]
fn preview_moves_nothing_and_names_side_effects() {
    let t = Temp::new();
    let plain = t.file("plain.bin", 10);
    let synced = t.file("OneDrive/doc.docx", 20);
    let npm = t.file("AppData/Local/npm-cache/x.tgz", 30);
    let locked = t.file("locked/keep.sys", 40);
    let mut p = Protected::default();
    p.add_deep(&t.0.join("locked"), Reason::System);
    let s = Store::with_protected(t.0.join("data"), p).unwrap();

    let v = s.preview(&[req(&plain, 10), req(&synced, 20), req(&npm, 30), req(&locked, 40)]);
    assert_eq!(v.movable.len(), 3);
    assert_eq!((v.on_disk, v.files), (60, 3), "the refused file isn't counted");
    assert_eq!(v.refused.len(), 1);
    assert_eq!(v.refused[0].reason, Reason::System);
    let kinds: Vec<EffectKind> = v.effects.iter().map(|e| e.kind).collect();
    assert_eq!(kinds, [EffectKind::Synced, EffectKind::PackageCache]);
    assert!(plain.exists() && synced.exists() && npm.exists() && locked.exists());
}

#[test]
fn protected_paths_are_refused_when_moving_not_only_in_preview() {
    let t = Temp::new();
    let locked = t.file("locked/keep.sys", 40);
    let mut p = Protected::default();
    p.add_deep(&t.0.join("locked"), Reason::System);
    let s = Store::with_protected(t.0.join("data"), p).unwrap();

    let out = s.quarantine(&[req(&locked, 40), req(&t.0.join("locked"), 40)]);
    assert_eq!(out[0].failure, Some(Failure::Protected { reason: Reason::System }));
    assert_eq!(out[1].failure, Some(Failure::Protected { reason: Reason::System }));
    // The folder holding it can't go either: that would take the protected folder along.
    assert_eq!(s.check(&t.0), Some(Reason::ContainsProtected));
    let out = s.quarantine(&[req(&t.0, 40)]);
    assert_eq!(out[0].failure, Some(Failure::Protected { reason: Reason::ContainsProtected }));
    assert!(locked.exists());
}

#[test]
fn jard_cannot_quarantine_itself() {
    let t = Temp::new();
    let s = t.store();
    let inside = t.file("data/log.jsonl", 1);
    assert_eq!(s.check(&inside), Some(Reason::Jard));
    assert_eq!(s.check(&t.0.join("data")), Some(Reason::Jard));
    assert_eq!(s.check(&t.0.join("G/.jard-quarantine/123/payload")), Some(Reason::Jard));
}

#[test]
fn normalize_ignores_case_prefix_and_separators() {
    assert_eq!(protect::normalize(Path::new(r"\\?\C:\Windows\")), r"c:\windows");
    assert_eq!(protect::normalize(Path::new("C:/WINDOWS/System32")), r"c:\windows\system32");
}

#[cfg(windows)]
mod windows_system {
    use super::*;

    fn real() -> Protected {
        Protected::for_this_system(&[])
    }

    #[test]
    fn this_machines_system_paths_are_protected() {
        let p = real();
        let win = std::env::var("SystemRoot").unwrap();
        let drive = &win[..2]; // "C:"
        let home = std::env::var("USERPROFILE").unwrap();
        let cases: &[(String, Reason)] = &[
            (format!(r"{drive}\"), Reason::Container),
            (win.clone(), Reason::System),
            (format!(r"{win}\System32\kernel32.dll"), Reason::System),
            (format!(r"{win}\WinSxS"), Reason::System),
            (win.to_lowercase(), Reason::System),
            (format!(r"\\?\{win}\System32"), Reason::System),
            (format!(r"{drive}\pagefile.sys"), Reason::SystemFile),
            (format!(r"{drive}\HIBERFIL.SYS"), Reason::SystemFile),
            (format!(r"{drive}\$Recycle.Bin"), Reason::SystemArea),
            (format!(r"{drive}\$Recycle.Bin\S-1-5-21\x.txt"), Reason::SystemArea),
            (format!(r"{drive}\System Volume Information"), Reason::SystemArea),
            (format!(r"{drive}\Documents and Settings"), Reason::SystemArea),
            (format!(r"{drive}\DumpStack.log.tmp"), Reason::SystemFile),
            (r"F:\pagefile.sys".to_string(), Reason::SystemFile),
            (std::env::var("ProgramFiles").unwrap(), Reason::Container),
            (std::env::var("ProgramData").unwrap(), Reason::Container),
            (home.clone(), Reason::UserFolder),
            (format!(r"{home}\Documents"), Reason::UserFolder),
            (format!(r"{home}\AppData\Local"), Reason::UserFolder),
        ];
        for (path, want) in cases {
            assert_eq!(p.check(Path::new(path)), Some(*want), "{path}");
        }
    }

    #[test]
    fn folders_holding_protected_things_are_refused_and_their_contents_are_not() {
        let p = real();
        let home = std::env::var("USERPROFILE").unwrap();
        let users = Path::new(&home).parent().unwrap();
        assert!(p.check(users).is_some(), "the Users folder");
        // What people actually clean stays possible.
        for ok in [
            format!(r"{home}\Downloads\old.iso"),
            format!(r"{home}\Videos\raw"),
            format!(r"{home}\AppData\Local\Temp\old-installer"),
            format!(r"{}\Adobe", std::env::var("ProgramData").unwrap()),
            r"G:\Backups\project.zip".to_string(),
        ] {
            assert_eq!(p.check(Path::new(&ok)), None, "{ok}");
        }
    }

    #[test]
    fn junction_is_moved_and_its_target_stays() {
        let t = Temp::new();
        let target = t.file("real/precious.bin", 50);
        let link = t.0.join("shortcut");
        let (l, r) = (jard_scan::display_path(&link), jard_scan::display_path(&t.0.join("real")));
        let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J", &l, &r]).output().unwrap();
        assert!(ok.status.success());

        let s = t.store();
        let item = s.quarantine(&[req(&link, 0)])[0].item.clone().expect("junction moved");
        assert!(link.symlink_metadata().is_err());
        assert!(target.exists(), "the junction's target is untouched");

        s.delete(&item.id).unwrap();
        assert!(target.exists(), "deleting the junction leaves its target");
        assert_eq!(fs::read(&target).unwrap().len(), 50);
    }

    #[test]
    fn deleting_a_folder_with_a_junction_inside_leaves_the_target() {
        let t = Temp::new();
        let target = t.file("real/precious.bin", 50);
        t.file("trash/junk.bin", 1);
        let (l, r) = (jard_scan::display_path(&t.0.join("trash/link")), jard_scan::display_path(&t.0.join("real")));
        let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J", &l, &r]).output().unwrap();
        assert!(ok.status.success());

        let s = t.store();
        let item = s.quarantine(&[req(&t.0.join("trash"), 1)])[0].item.clone().expect("moved");
        s.delete(&item.id).unwrap();
        assert!(!t.0.join("trash").exists());
        assert_eq!(fs::read(&target).unwrap().len(), 50, "the target survives");
    }

    #[test]
    fn file_open_elsewhere_stays_and_says_why() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = Temp::new();
        let f = t.file("open.bin", 4);
        let held = fs::OpenOptions::new().read(true).share_mode(0).open(&f).unwrap();
        let s = t.store();
        let out = s.quarantine(&[req(&f, 4)]);
        assert_eq!(out[0].failure, Some(Failure::InUse));
        assert!(s.list().is_empty());
        drop(held);
        assert!(f.exists());
        assert_eq!(fs::read_dir(t.0.join("data/quarantine")).unwrap().count(), 0, "no leftover folder");
        assert!(s.quarantine(&[req(&f, 4)])[0].item.is_some(), "retry works once it's closed");
    }

    /// Second drive: set JARD_TEST_OTHER_DRIVE to a folder on a drive other than the temp folder's.
    #[test]
    #[ignore = "needs a second drive"]
    fn other_drive_uses_its_own_hidden_quarantine_and_leaves_no_trace() {
        let base = PathBuf::from(std::env::var("JARD_TEST_OTHER_DRIVE").unwrap());
        let dir = base.join(format!("jard-clean-drive-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("big.bin");
        fs::write(&f, b"hello").unwrap();
        let f = fs::canonicalize(&f).unwrap();

        let t = Temp::new();
        let s = t.store();
        let item = s.quarantine(&[req(&f, 5)])[0].item.clone().expect("moved");
        let drive_root = PathBuf::from(format!(r"{}\", &jard_scan::display_path(&f)[..2]));
        let q = drive_root.join(".jard-quarantine");
        assert!(q.is_dir());
        assert!(q.join(&item.id).join("payload").exists());
        assert_eq!(s.list().len(), 1);
        s.restore(&item.id, OnConflict::Fail).unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"hello");
        assert!(!q.exists(), "the empty quarantine folder is removed");
        fs::remove_dir_all(&dir).unwrap();
    }
}

#[test]
fn secure_delete_overwrites_and_removes_only_plain_files() {
    let t = Temp::new();
    let s = t.store();
    let f = t.file("secret.txt", 3_000_000);
    assert_eq!(s.secure_delete(&f), Ok(3_000_000));
    assert!(!f.exists());

    assert!(matches!(s.secure_delete(&t.0.join("gone.txt")), Err(Failure::Missing)));
    t.file("dir/x.txt", 5);
    assert!(matches!(s.secure_delete(&t.0.join("dir")), Err(Failure::Other { .. })));
    assert!(t.0.join("dir/x.txt").exists(), "a folder is refused whole");

    let a = t.file("linked.bin", 10);
    let b = t.0.join("linked-2.bin");
    fs::hard_link(&a, &b).unwrap();
    assert!(matches!(s.secure_delete(&a), Err(Failure::Other { .. })));
    assert_eq!(fs::read(&b).unwrap(), vec![3u8; 10], "the other name still has its data");

    let mut p = Protected::default();
    p.add_deep(&t.0.join("dir"), Reason::System);
    let guarded = Store::with_protected(t.0.join("data2"), p).unwrap();
    assert_eq!(guarded.secure_delete(&t.0.join("dir/x.txt")), Err(Failure::Protected { reason: Reason::System }));
    assert!(t.0.join("dir/x.txt").exists());
}
