//! The photo comparison, on pictures drawn here: a shot, the same shot re-saved smaller, and another.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use image::{ImageBuffer, ImageFormat, Rgb};
use jard_scan::{find_similar, scan, Options, Progress};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("jard-similar-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Noise on top of the pattern keeps the files above the size that counts as a photo.
fn picture(w: u32, h: u32, f: impl Fn(f32, f32) -> f32) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
    let mut seed = 12345u32;
    ImageBuffer::from_fn(w, h, |x, y| {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let v = f(x as f32 / w as f32, y as f32 / h as f32) * 215.0 + (seed >> 24) as f32 * 40.0 / 255.0;
        Rgb([v as u8, v as u8, v as u8])
    })
}

fn save(dir: &Path, name: &str, img: &ImageBuffer<Rgb<u8>, Vec<u8>>, format: ImageFormat) {
    img.save_with_format(dir.join(name), format).unwrap();
}

#[test]
fn finds_the_same_shot_and_keeps_the_biggest() {
    let t = Temp::new();
    let shot = |x: f32, y: f32| ((x * 7.0).sin() * (y * 5.0).cos() + 1.0) / 2.0;
    let other = |x: f32, y: f32| (((1.0 - x) * 19.0).cos() * (y * 23.0).sin() + 1.0) / 2.0;
    let big = picture(900, 600, shot);
    save(&t.0, "big.png", &big, ImageFormat::Png);
    // The same picture, smaller and re-compressed: what a messaging app does to a photo.
    let small = image::imageops::resize(&big, 600, 400, image::imageops::FilterType::Triangle);
    save(&t.0, "small.jpg", &small, ImageFormat::Jpeg);
    save(&t.0, "other.png", &picture(900, 600, other), ImageFormat::Png);
    // Not a photo by name: must be left alone.
    save(&t.0, "same.tiff.txt", &picture(450, 300, shot), ImageFormat::Png);

    let tree = scan(&t.0, &Options::default(), &Progress::new()).unwrap();
    let groups = find_similar(&tree, &AtomicBool::new(false));
    assert_eq!(groups.len(), 1, "one group: {groups:?}");
    let names: Vec<_> = groups[0].photos.iter().map(|p| tree.get(p.id).unwrap().name.to_string()).collect();
    assert_eq!(names, ["big.png", "small.jpg"]);
    assert_eq!((groups[0].photos[0].width, groups[0].photos[0].height), (900, 600));
    assert!(!groups[0].photos[1].thumbnail.is_empty());
}

#[test]
fn stopping_returns_nothing() {
    let t = Temp::new();
    let tree = scan(&t.0, &Options::default(), &Progress::new()).unwrap();
    assert!(find_similar(&tree, &AtomicBool::new(true)).is_empty());
}
