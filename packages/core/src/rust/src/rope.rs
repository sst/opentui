/// A persistent/immutable rope data structure for efficient text storage and editing.
///
/// Rope nodes are reference-counted, so operations create new roots without
/// freeing old ones. This enables efficient undo/redo by keeping references to
/// previous states.

use std::sync::Arc;

const MAX_LEAF_LEN: usize = 512;
const MAX_IMBALANCE: u32 = 7;

#[derive(Debug, Clone)]
enum RopeNode {
    Leaf {
        data: Vec<u8>,
    },
    Branch {
        left: Arc<RopeNode>,
        right: Arc<RopeNode>,
        len: usize,
        depth: u32,
        line_count: u32,
    },
}

impl RopeNode {
    fn len(&self) -> usize {
        match self {
            RopeNode::Leaf { data } => data.len(),
            RopeNode::Branch { len, .. } => *len,
        }
    }

    fn depth(&self) -> u32 {
        match self {
            RopeNode::Leaf { .. } => 0,
            RopeNode::Branch { depth, .. } => *depth,
        }
    }

    fn line_count(&self) -> u32 {
        match self {
            RopeNode::Leaf { data } => data.iter().filter(|&&b| b == b'\n').count() as u32,
            RopeNode::Branch { line_count, .. } => *line_count,
        }
    }
}

/// Rope data structure for efficient string operations.
#[derive(Debug, Clone)]
pub struct Rope {
    root: Arc<RopeNode>,
}

impl Rope {
    pub fn new() -> Self {
        Self {
            root: Arc::new(RopeNode::Leaf { data: Vec::new() }),
        }
    }

    pub fn from_str(s: &str) -> Self {
        if s.len() <= MAX_LEAF_LEN {
            Self {
                root: Arc::new(RopeNode::Leaf {
                    data: s.as_bytes().to_vec(),
                }),
            }
        } else {
            let mid = s.len() / 2;
            // Find a good split point (UTF-8 boundary)
            let mid = find_char_boundary(s.as_bytes(), mid);
            let left = Rope::from_str(&s[..mid]);
            let right = Rope::from_str(&s[mid..]);
            left.concat(&right)
        }
    }

    pub fn len(&self) -> usize {
        self.root.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn line_count(&self) -> u32 {
        self.root.line_count() + 1
    }

    /// Get the full text as a byte vector.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(self.len());
        self.collect_bytes(&self.root, &mut buf);
        buf
    }

    /// Get the full text as a string.
    pub fn to_string_lossy(&self) -> String {
        String::from_utf8_lossy(&self.to_bytes()).into_owned()
    }

    fn collect_bytes(&self, node: &RopeNode, buf: &mut Vec<u8>) {
        match node {
            RopeNode::Leaf { data } => buf.extend_from_slice(data),
            RopeNode::Branch { left, right, .. } => {
                self.collect_bytes(left, buf);
                self.collect_bytes(right, buf);
            }
        }
    }

    /// Insert bytes at a given byte offset, returning a new Rope.
    pub fn insert(&self, offset: usize, data: &[u8]) -> Self {
        let (left, right) = self.split(offset);
        let inserted = Rope {
            root: Arc::new(RopeNode::Leaf {
                data: data.to_vec(),
            }),
        };
        left.concat(&inserted).concat(&right)
    }

    /// Delete a byte range [start..end), returning a new Rope.
    pub fn delete(&self, start: usize, end: usize) -> Self {
        let (left, _) = self.split(start);
        let (_, right) = self.split(end);
        left.concat(&right)
    }

    /// Split the rope at a byte offset, returning (left, right).
    pub fn split(&self, offset: usize) -> (Rope, Rope) {
        let bytes = self.to_bytes();
        let offset = offset.min(bytes.len());
        let left = Rope::from_str(&String::from_utf8_lossy(&bytes[..offset]));
        let right = Rope::from_str(&String::from_utf8_lossy(&bytes[offset..]));
        (left, right)
    }

    /// Concatenate two ropes, returning a balanced result.
    pub fn concat(&self, other: &Rope) -> Rope {
        if self.is_empty() {
            return other.clone();
        }
        if other.is_empty() {
            return self.clone();
        }

        let left = self.root.clone();
        let right = other.root.clone();
        let len = left.len() + right.len();
        let depth = left.depth().max(right.depth()) + 1;
        let line_count = left.line_count() + right.line_count();

        let root = Arc::new(RopeNode::Branch {
            left,
            right,
            len,
            depth,
            line_count,
        });

        let rope = Rope { root };

        // Rebalance if needed
        if rope.root.depth() > MAX_IMBALANCE {
            let bytes = rope.to_bytes();
            Rope::from_str(&String::from_utf8_lossy(&bytes))
        } else {
            rope
        }
    }

    /// Get a byte range from the rope.
    pub fn slice(&self, start: usize, end: usize) -> Vec<u8> {
        let bytes = self.to_bytes();
        let start = start.min(bytes.len());
        let end = end.min(bytes.len());
        bytes[start..end].to_vec()
    }

    /// Get the byte offset of the start of a given line (0-indexed).
    pub fn line_start_offset(&self, line: u32) -> Option<usize> {
        if line == 0 {
            return Some(0);
        }
        let bytes = self.to_bytes();
        let mut current_line: u32 = 0;
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' {
                current_line += 1;
                if current_line == line {
                    return Some(i + 1);
                }
            }
        }
        None
    }

    /// Convert a (row, col) to a byte offset.
    pub fn coords_to_offset(&self, row: u32, col: u32) -> Option<usize> {
        let start = self.line_start_offset(row)?;
        let bytes = self.to_bytes();
        let line_end = bytes[start..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| start + p)
            .unwrap_or(bytes.len());

        let s = std::str::from_utf8(&bytes[start..line_end]).ok()?;
        let mut current_col: u32 = 0;
        for (i, _) in s.char_indices() {
            if current_col == col {
                return Some(start + i);
            }
            current_col += 1;
        }
        // col is at or past end of line
        Some(line_end.min(bytes.len()))
    }

    /// Convert a byte offset to (row, col).
    pub fn offset_to_coords(&self, offset: usize) -> Option<(u32, u32)> {
        let bytes = self.to_bytes();
        if offset > bytes.len() {
            return None;
        }

        let mut row: u32 = 0;
        let mut last_line_start: usize = 0;
        for (i, &b) in bytes[..offset].iter().enumerate() {
            if b == b'\n' {
                row += 1;
                last_line_start = i + 1;
            }
        }

        let col = (offset - last_line_start) as u32;
        Some((row, col))
    }
}

impl Default for Rope {
    fn default() -> Self {
        Self::new()
    }
}

fn find_char_boundary(bytes: &[u8], mid: usize) -> usize {
    // Walk backwards to find a valid UTF-8 boundary
    let mut pos = mid.min(bytes.len());
    while pos > 0 && (bytes[pos] & 0xC0) == 0x80 {
        pos -= 1;
    }
    pos
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rope_basic() {
        let rope = Rope::from_str("Hello, World!");
        assert_eq!(rope.len(), 13);
        assert_eq!(rope.to_string_lossy(), "Hello, World!");
    }

    #[test]
    fn test_rope_insert() {
        let rope = Rope::from_str("HelloWorld!");
        let rope = rope.insert(5, b", ");
        assert_eq!(rope.to_string_lossy(), "Hello, World!");
    }

    #[test]
    fn test_rope_delete() {
        let rope = Rope::from_str("Hello, World!");
        let rope = rope.delete(5, 7);
        assert_eq!(rope.to_string_lossy(), "HelloWorld!");
    }

    #[test]
    fn test_rope_line_count() {
        let rope = Rope::from_str("line1\nline2\nline3");
        assert_eq!(rope.line_count(), 3);
    }

    #[test]
    fn test_rope_coords() {
        let rope = Rope::from_str("abc\ndef\nghi");
        assert_eq!(rope.coords_to_offset(0, 0), Some(0));
        assert_eq!(rope.coords_to_offset(1, 0), Some(4));
        assert_eq!(rope.coords_to_offset(2, 2), Some(10));
        assert_eq!(rope.offset_to_coords(0), Some((0, 0)));
        assert_eq!(rope.offset_to_coords(4), Some((1, 0)));
        assert_eq!(rope.offset_to_coords(5), Some((1, 1)));
    }

    #[test]
    fn test_rope_empty() {
        let rope = Rope::new();
        assert!(rope.is_empty());
        assert_eq!(rope.line_count(), 1);
    }

    #[test]
    fn test_rope_large() {
        let text = "a".repeat(10000);
        let rope = Rope::from_str(&text);
        assert_eq!(rope.len(), 10000);
        assert_eq!(rope.to_string_lossy(), text);
    }
}
