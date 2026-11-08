//! Saves a tree to disk and reads it back, so results survive closing the app.
//!
//! A compact binary format: a C: drive has millions of nodes, and JSON would take hundreds of MB.
//! Nodes keep their order, so a child still comes after its parent. Detached nodes are left out,
//! so what left the disk after the scan doesn't come back. Anything malformed is an error, never a
//! panic: this reads a file from disk.

use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::node::{Node, NodeId};
use crate::tree::Tree;

const MAGIC: &[u8; 10] = b"JARDSCAN1\n";

fn bad(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("corrupt scan file: {what}"))
}

fn put(w: &mut impl Write, mut v: u64) -> io::Result<()> {
    while v >= 0x80 {
        w.write_all(&[(v as u8) | 0x80])?;
        v >>= 7;
    }
    w.write_all(&[v as u8])
}

fn get(r: &mut impl Read) -> io::Result<u64> {
    let (mut v, mut shift) = (0u64, 0u32);
    loop {
        let mut b = [0u8; 1];
        r.read_exact(&mut b)?;
        if shift >= 64 {
            return Err(bad("number too long"));
        }
        v |= u64::from(b[0] & 0x7F) << shift;
        if b[0] & 0x80 == 0 {
            return Ok(v);
        }
        shift += 7;
    }
}

fn put_text(w: &mut impl Write, s: &str) -> io::Result<()> {
    put(w, s.len() as u64)?;
    w.write_all(s.as_bytes())
}

fn get_text(r: &mut impl Read) -> io::Result<String> {
    let len = get(r)?;
    if len > 1 << 20 {
        return Err(bad("text too long"));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(|_| bad("text is not UTF-8"))
}

impl Tree {
    /// Writes the attached part of the tree.
    pub fn save(&self, out: impl Write) -> io::Result<()> {
        let mut w = BufWriter::new(out);
        w.write_all(MAGIC)?;
        put_text(&mut w, &self.root.to_string_lossy())?;
        put(&mut w, self.elapsed.as_millis() as u64)?;
        w.write_all(&[u8::from(self.partial), u8::from(self.cancelled)])?;

        // New ids skip detached nodes, and stay greater than the parent's because order is kept.
        let mut new_id = vec![NodeId::MAX; self.nodes.len()];
        let mut count = 0u32;
        for n in &self.nodes {
            if self.is_attached(n) {
                new_id[n.id as usize] = count;
                count += 1;
            }
        }
        put(&mut w, u64::from(count))?;
        for n in self.nodes.iter().filter(|n| new_id[n.id as usize] != NodeId::MAX) {
            put(&mut w, n.parent.map_or(0, |p| u64::from(new_id[p as usize]) + 1))?;
            w.write_all(&[u8::from(n.is_dir), n.flags])?;
            put_text(&mut w, &n.name)?;
            put(&mut w, n.apparent)?;
            put(&mut w, n.on_disk)?;
            put(&mut w, n.cloud_bytes)?;
            put(&mut w, n.dedup_bytes)?;
            if n.is_dir {
                put(&mut w, n.own_apparent)?;
                put(&mut w, n.own_on_disk)?;
                put(&mut w, n.own_files)?;
                put(&mut w, n.files)?;
                put(&mut w, n.dirs)?;
                put(&mut w, n.denied)?;
            } else {
                put(&mut w, n.modified)?;
            }
        }
        w.flush()
    }

    /// Reads a tree written by [`Tree::save`].
    pub fn load(input: impl Read) -> io::Result<Tree> {
        let mut r = BufReader::new(input);
        let mut magic = [0u8; 10];
        r.read_exact(&mut magic)?;
        if &magic != MAGIC {
            return Err(bad("not a scan file"));
        }
        let root = PathBuf::from(get_text(&mut r)?);
        let elapsed = Duration::from_millis(get(&mut r)?);
        let mut two = [0u8; 2];
        r.read_exact(&mut two)?;
        let count = get(&mut r)?;
        if count == 0 || count > u64::from(u32::MAX) {
            return Err(bad("node count"));
        }

        // Not reserved up front: `count` comes from the file.
        let mut nodes: Vec<Node> = Vec::new();
        for i in 0..count {
            let raw_parent = get(&mut r)?;
            let parent = match raw_parent {
                0 => None,
                p if p - 1 < i => Some((p - 1) as NodeId),
                _ => return Err(bad("parent after child")),
            };
            if (i == 0) != parent.is_none() {
                return Err(bad("root"));
            }
            let mut head = [0u8; 2];
            r.read_exact(&mut head)?;
            let is_dir = head[0] != 0;
            let mut n = Node::new(i as NodeId, get_text(&mut r)?.into(), parent, is_dir);
            n.flags = head[1];
            n.apparent = get(&mut r)?;
            n.on_disk = get(&mut r)?;
            n.cloud_bytes = get(&mut r)?;
            n.dedup_bytes = get(&mut r)?;
            if is_dir {
                n.own_apparent = get(&mut r)?;
                n.own_on_disk = get(&mut r)?;
                n.own_files = get(&mut r)?;
                n.files = get(&mut r)?;
                n.dirs = get(&mut r)?;
                n.denied = get(&mut r)?;
            } else {
                n.modified = get(&mut r)?;
                n.own_apparent = n.apparent;
                n.own_on_disk = n.on_disk;
                n.own_files = 1;
                n.files = 1;
            }
            if let Some(p) = parent {
                let parent_node = &mut nodes[p as usize];
                if !parent_node.is_dir {
                    return Err(bad("file with children"));
                }
                parent_node.children.push(i as NodeId);
            }
            nodes.push(n);
        }
        Ok(Tree::from_saved(root, nodes, elapsed, two[0] != 0, two[1] != 0))
    }

    /// Saves to a file through a temporary name, so a crash never leaves half a scan.
    pub fn save_to(&self, path: &Path) -> io::Result<()> {
        let tmp = path.with_extension("tmp");
        let result = std::fs::File::create(&tmp).and_then(|f| {
            self.save(&f)?;
            f.sync_all()
        });
        if result.is_ok() {
            std::fs::rename(&tmp, path)
        } else {
            let _ = std::fs::remove_file(&tmp);
            result
        }
    }

    pub fn load_from(path: &Path) -> io::Result<Tree> {
        Tree::load(std::fs::File::open(path)?)
    }
}
