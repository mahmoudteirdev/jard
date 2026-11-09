//! Finds photos that look nearly the same but aren't identical: bursts, re-saves, resized copies.
//!
//! Each photo is reduced to a 64-bit difference hash: shrink to 9×8 grey, then one bit per
//! neighbouring pair saying which is brighter. Two photos of the same shot differ in a few bits.
//! Nothing here moves or deletes anything: the person picks, and it goes through quarantine.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use image::{GenericImageView, ImageReader};

use crate::node::{flags, NodeId};
use crate::tree::Tree;

/// Hashes this close count as the same shot. 64 bits in all; about 8% may differ.
const MAX_DISTANCE: u32 = 5;
/// Icons and thumbnails aren't what fills a drive.
const MIN_SIZE: u64 = 20 * 1024;
/// Largest photos first, up to this many. Comparing is quadratic and decoding is slow.
const MAX_PHOTOS: usize = 20_000;
/// Widths or heights that differ by more than this are different pictures, cropped or not.
const MAX_ASPECT_GAP: f32 = 0.05;
/// A thumbnail for choosing between photos, long side in pixels.
const THUMB: u32 = 160;

const EXTENSIONS: [&str; 5] = ["jpg", "jpeg", "png", "webp", "bmp"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimilarPhoto {
    pub id: NodeId,
    pub width: u32,
    pub height: u32,
    /// How many of the 64 bits differ from the group's first photo.
    pub distance: u32,
    /// A small JPEG, for showing. Empty if it could not be made.
    pub thumbnail: Vec<u8>,
}

/// Photos of the same shot. The first has the most pixels, so it's the one to suggest keeping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimilarGroup {
    pub photos: Vec<SimilarPhoto>,
}

#[derive(Debug, Clone, Copy)]
struct Hashed {
    id: NodeId,
    hash: u64,
    width: u32,
    height: u32,
}

/// The hash of an opened image, or None for one too plain to compare (blank, one flat colour).
fn dhash(img: &image::DynamicImage) -> Option<u64> {
    let small = img.thumbnail_exact(9, 8).to_luma8();
    let mut hash = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            hash <<= 1;
            if small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0] {
                hash |= 1;
            }
        }
    }
    // Almost no edges: every plain picture hashes alike, and they aren't the same shot.
    (4..=60).contains(&hash.count_ones()).then_some(hash)
}

fn open(path: &Path) -> Option<image::DynamicImage> {
    ImageReader::open(path).ok()?.with_guessed_format().ok()?.decode().ok()
}

fn hash_file(tree: &Tree, id: NodeId) -> Option<Hashed> {
    let img = open(&tree.path(id)?)?;
    let (width, height) = img.dimensions();
    Some(Hashed { id, hash: dhash(&img)?, width, height })
}

fn is_photo(name: &str) -> bool {
    let Some((_, ext)) = name.rsplit_once('.') else { return false };
    EXTENSIONS.iter().any(|e| ext.eq_ignore_ascii_case(e))
}

fn same_shape(a: &Hashed, b: &Hashed) -> bool {
    let ratio = |x: &Hashed| x.width as f32 / x.height.max(1) as f32;
    (ratio(a) - ratio(b)).abs() <= MAX_ASPECT_GAP
}

fn thumbnail(tree: &Tree, id: NodeId) -> Vec<u8> {
    let mut out = Vec::new();
    if let Some(img) = tree.path(id).as_deref().and_then(open) {
        let rgb = image::DynamicImage::ImageRgb8(img.thumbnail(THUMB, THUMB).to_rgb8());
        let _ = rgb.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Jpeg);
    }
    out
}

fn find(parents: &mut [u32], mut i: u32) -> u32 {
    while parents[i as usize] != i {
        parents[i as usize] = parents[parents[i as usize] as usize];
        i = parents[i as usize];
    }
    i
}

/// Groups photos of the same shot, biggest possible saving first. Cloud photos stay unread, so
/// nothing gets downloaded. Setting `stop` ends it early with no groups.
pub fn find_similar(tree: &Tree, stop: &AtomicBool) -> Vec<SimilarGroup> {
    let mut photos: Vec<NodeId> = tree
        .nodes
        .iter()
        .filter(|n| !n.is_dir && n.flags & flags::CLOUD == 0 && n.apparent >= MIN_SIZE && is_photo(&n.name) && tree.is_attached(n))
        .map(|n| n.id)
        .collect();
    photos.sort_by_key(|&id| std::cmp::Reverse(tree.get(id).map_or(0, |n| n.on_disk)));
    photos.truncate(MAX_PHOTOS);

    // Decoding is the slow part, so it runs on every core.
    let next = AtomicUsize::new(0);
    let hashed = Mutex::new(Vec::with_capacity(photos.len()));
    let workers = std::thread::available_parallelism().map_or(2, |n| n.get()).clamp(1, 8);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                let Some(&id) = photos.get(next.fetch_add(1, Ordering::Relaxed)) else { return };
                if let Some(h) = hash_file(tree, id) {
                    hashed.lock().unwrap_or_else(|e| e.into_inner()).push(h);
                }
            });
        }
    });
    if stop.load(Ordering::Relaxed) {
        return Vec::new();
    }
    let mut hashed = hashed.into_inner().unwrap_or_else(|e| e.into_inner());
    hashed.sort_by_key(|h| h.id); // the same answer every run, whatever order the threads finished

    let mut parents: Vec<u32> = (0..hashed.len() as u32).collect();
    for i in 0..hashed.len() {
        for j in i + 1..hashed.len() {
            if (hashed[i].hash ^ hashed[j].hash).count_ones() <= MAX_DISTANCE && same_shape(&hashed[i], &hashed[j]) {
                let (a, b) = (find(&mut parents, i as u32), find(&mut parents, j as u32));
                parents[a as usize] = b;
            }
        }
    }

    let mut by_root: std::collections::HashMap<u32, Vec<Hashed>> = std::collections::HashMap::new();
    for (i, h) in hashed.iter().enumerate() {
        by_root.entry(find(&mut parents, i as u32)).or_default().push(*h);
    }
    let on_disk = |id: NodeId| tree.get(id).map_or(0, |n| n.on_disk);
    let mut groups: Vec<Vec<Hashed>> = by_root.into_values().filter(|g| g.len() > 1).collect();
    for g in &mut groups {
        g.sort_by_key(|h| (std::cmp::Reverse(h.width as u64 * h.height as u64), std::cmp::Reverse(on_disk(h.id)), h.id));
    }
    groups.sort_by_key(|g| (std::cmp::Reverse(g[1..].iter().map(|h| on_disk(h.id)).sum::<u64>()), g[0].id));
    groups
        .into_iter()
        .map(|g| {
            let first = g[0].hash;
            SimilarGroup {
                photos: g
                    .iter()
                    .map(|h| SimilarPhoto {
                        id: h.id,
                        width: h.width,
                        height: h.height,
                        distance: (first ^ h.hash).count_ones(),
                        thumbnail: thumbnail(tree, h.id),
                    })
                    .collect(),
            }
        })
        .collect()
}
