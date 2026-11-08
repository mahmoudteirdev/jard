//! What kind of file something is, from its extension, and how a tree splits by kind.

use serde::{Deserialize, Serialize};

use crate::node::{flags, Node};
use crate::tree::Tree;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Video,
    Image,
    Audio,
    Document,
    Archive,
    DiskImage,
    VirtualMachine,
    Installer,
    Program,
    Other,
}

impl Kind {
    pub const ALL: [Kind; 10] = [
        Kind::Video,
        Kind::Image,
        Kind::Audio,
        Kind::Document,
        Kind::Archive,
        Kind::DiskImage,
        Kind::VirtualMachine,
        Kind::Installer,
        Kind::Program,
        Kind::Other,
    ];

    pub fn of(name: &str) -> Kind {
        let Some((_, ext)) = name.rsplit_once('.') else { return Kind::Other };
        let ext = ext.to_ascii_lowercase();
        match ext.as_str() {
            "mp4" | "mkv" | "mov" | "avi" | "wmv" | "webm" | "m4v" | "flv" | "mpg" | "mpeg" => Kind::Video,
            "jpg" | "jpeg" | "png" | "gif" | "heic" | "webp" | "bmp" | "raw" | "cr2" | "nef" | "arw" | "psd"
            | "tif" | "tiff" | "svg" => Kind::Image,
            "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" => Kind::Audio,
            "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "odt" | "ods" | "rtf" | "csv" | "md"
            | "epub" => Kind::Document,
            "zip" | "rar" | "7z" | "tar" | "gz" | "xz" | "bz2" | "zst" | "tgz" | "cab" => Kind::Archive,
            "iso" | "img" | "wim" | "esd" => Kind::DiskImage,
            "vdi" | "vmdk" | "vhd" | "vhdx" | "qcow2" | "ova" => Kind::VirtualMachine,
            "exe" | "msi" | "msix" | "appx" | "apk" | "dmg" | "deb" | "rpm" => Kind::Installer,
            "dll" | "sys" | "so" | "dylib" | "pak" | "dat" | "bin" | "jar" | "node" | "ocx" => Kind::Program,
            _ => Kind::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindTotal {
    pub kind: Kind,
    pub on_disk: u64,
    pub files: u64,
}

/// On-disk totals per kind for the whole tree, largest first. Empty kinds are left out.
pub fn kind_totals(tree: &Tree) -> Vec<KindTotal> {
    let mut totals = Kind::ALL.map(|kind| KindTotal { kind, on_disk: 0, files: 0 });
    for n in tree.live_files() {
        let i = Kind::ALL.iter().position(|k| *k == Kind::of(&n.name)).unwrap_or(Kind::ALL.len() - 1);
        totals[i].on_disk += n.on_disk;
        totals[i].files += 1;
    }
    let mut out: Vec<KindTotal> = totals.into_iter().filter(|t| t.files > 0).collect();
    out.sort_by_key(|t| std::cmp::Reverse(t.on_disk));
    out
}

/// What [`Tree::search`] looks for. Empty text matches every name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    pub text: String,
    pub kind: Option<Kind>,
    pub min_size: u64,
    /// Files last written before this time, seconds since 1970.
    pub older_than: Option<u64>,
    pub no_extension: bool,
    /// Folders with nothing inside, instead of files.
    pub empty_folders: bool,
}

impl Tree {
    /// Finds nodes by name and filters, largest on disk first.
    pub fn search(&self, q: &Query, limit: usize) -> Vec<&Node> {
        let text = q.text.trim().to_lowercase();
        let mut found: Vec<&Node> = self
            .nodes
            .iter()
            .filter(|n| {
                if n.parent.is_none() || !self.is_attached(n) {
                    return false;
                }
                if q.empty_folders {
                    return n.is_dir
                        && n.children.is_empty()
                        && !n.has(flags::DENIED | flags::REPARSE | flags::PARTIAL);
                }
                if n.on_disk < q.min_size {
                    return false;
                }
                if (q.kind.is_some() || q.older_than.is_some() || q.no_extension) && n.is_dir {
                    return false;
                }
                if q.kind.is_some_and(|k| k != Kind::of(&n.name)) {
                    return false;
                }
                if q.older_than.is_some_and(|t| n.modified == 0 || n.modified >= t) {
                    return false;
                }
                if q.no_extension && n.name.trim_start_matches('.').contains('.') {
                    return false;
                }
                text.is_empty() || n.name.to_lowercase().contains(&text)
            })
            .collect();
        found.sort_by_key(|n| std::cmp::Reverse(n.on_disk));
        found.truncate(limit);
        found
    }
}
