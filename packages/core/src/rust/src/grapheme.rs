use std::collections::HashMap;
use std::sync::Mutex;

/// Bit to indicate a character is a packed grapheme reference rather than a Unicode codepoint.
pub const GRAPHEME_START_BIT: u32 = 0x8000_0000;
/// Mask for extracting the grapheme ID from a packed character.
pub const GRAPHEME_ID_MASK: u32 = 0x00FF_FFFF;
/// Mask for extracting the display width from a packed character.
const GRAPHEME_WIDTH_MASK: u32 = 0x7F00_0000;
const GRAPHEME_WIDTH_SHIFT: u32 = 24;

/// Check if a char value represents a grapheme pool reference.
#[inline]
pub fn is_grapheme_char(c: u32) -> bool {
    c & GRAPHEME_START_BIT != 0
}

/// Extract the grapheme ID from a packed character value.
#[inline]
pub fn grapheme_id_from_char(c: u32) -> u32 {
    c & GRAPHEME_ID_MASK
}

/// Extract the display width from a packed grapheme character.
#[inline]
pub fn grapheme_width_from_char(c: u32) -> u8 {
    ((c & GRAPHEME_WIDTH_MASK) >> GRAPHEME_WIDTH_SHIFT) as u8
}

/// Pack a grapheme ID and display width into a single u32 value.
#[inline]
pub fn pack_grapheme_start(id: u32, width: u8) -> u32 {
    GRAPHEME_START_BIT | ((width as u32) << GRAPHEME_WIDTH_SHIFT) | (id & GRAPHEME_ID_MASK)
}

/// A slot in the grapheme pool.
struct Slot {
    data: Vec<u8>,
    refcount: u32,
    _generation: u32,
}

/// Pool for storing multi-byte grapheme clusters, referenced by ID.
///
/// Grapheme clusters that don't fit in a single u32 codepoint are stored here
/// and referenced via packed IDs in the cell buffer.
pub struct GraphemePool {
    slots: Vec<Option<Slot>>,
    free_list: Vec<u32>,
    intern_map: HashMap<Vec<u8>, u32>,
    generation: u32,
}

impl GraphemePool {
    pub fn new() -> Self {
        Self {
            slots: Vec::with_capacity(256),
            free_list: Vec::new(),
            intern_map: HashMap::new(),
            generation: 0,
        }
    }

    /// Allocate or intern a grapheme cluster, returning its ID.
    pub fn alloc(&mut self, data: &[u8]) -> Option<u32> {
        // Check intern map first
        if let Some(&id) = self.intern_map.get(data) {
            if let Some(Some(slot)) = self.slots.get_mut(id as usize) {
                slot.refcount += 1;
                return Some(id);
            }
        }

        let id = if let Some(free_id) = self.free_list.pop() {
            free_id
        } else {
            let id = self.slots.len() as u32;
            self.slots.push(None);
            id
        };

        self.generation += 1;
        let slot = Slot {
            data: data.to_vec(),
            refcount: 1,
            _generation: self.generation,
        };
        self.intern_map.insert(data.to_vec(), id);
        self.slots[id as usize] = Some(slot);
        Some(id)
    }

    /// Get the bytes of a grapheme by ID.
    pub fn get(&self, id: u32) -> Option<&[u8]> {
        self.slots
            .get(id as usize)
            .and_then(|s| s.as_ref())
            .map(|s| s.data.as_slice())
    }

    /// Increment reference count.
    pub fn incref(&mut self, id: u32) -> bool {
        if let Some(Some(slot)) = self.slots.get_mut(id as usize) {
            slot.refcount += 1;
            true
        } else {
            false
        }
    }

    /// Decrement reference count. Frees the slot when it reaches zero.
    pub fn decref(&mut self, id: u32) -> bool {
        let should_free = if let Some(Some(slot)) = self.slots.get_mut(id as usize) {
            if slot.refcount > 0 {
                slot.refcount -= 1;
            }
            slot.refcount == 0
        } else {
            return false;
        };

        if should_free {
            if let Some(Some(slot)) = self.slots.get(id as usize) {
                self.intern_map.remove(&slot.data);
            }
            self.slots[id as usize] = None;
            self.free_list.push(id);
        }
        true
    }

    /// Resolve a cell character to its displayed string, looking up grapheme pool if needed.
    pub fn resolve_char(&self, c: u32) -> String {
        if is_grapheme_char(c) {
            let id = grapheme_id_from_char(c);
            if let Some(data) = self.get(id) {
                return String::from_utf8_lossy(data).into_owned();
            }
            return String::new();
        }
        if let Some(ch) = char::from_u32(c) {
            let mut s = String::new();
            s.push(ch);
            s
        } else {
            String::new()
        }
    }
}

impl Default for GraphemePool {
    fn default() -> Self {
        Self::new()
    }
}

// Global grapheme pool behind a mutex for FFI safety.
static GLOBAL_POOL: Mutex<Option<GraphemePool>> = Mutex::new(None);

pub fn init_global_pool() -> &'static Mutex<Option<GraphemePool>> {
    {
        let mut pool = GLOBAL_POOL.lock().unwrap();
        if pool.is_none() {
            *pool = Some(GraphemePool::new());
        }
    }
    &GLOBAL_POOL
}

pub fn with_global_pool<F, R>(f: F) -> R
where
    F: FnOnce(&mut GraphemePool) -> R,
{
    init_global_pool();
    let mut pool = GLOBAL_POOL.lock().unwrap();
    f(pool.as_mut().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pack_unpack() {
        let id = 42;
        let width = 2;
        let packed = pack_grapheme_start(id, width);
        assert!(is_grapheme_char(packed));
        assert_eq!(grapheme_id_from_char(packed), 42);
        assert_eq!(grapheme_width_from_char(packed), 2);
    }

    #[test]
    fn test_pool_alloc_get() {
        let mut pool = GraphemePool::new();
        let id = pool.alloc("🌍".as_bytes()).unwrap();
        assert_eq!(pool.get(id).unwrap(), "🌍".as_bytes());
    }

    #[test]
    fn test_pool_intern() {
        let mut pool = GraphemePool::new();
        let id1 = pool.alloc("🌍".as_bytes()).unwrap();
        let id2 = pool.alloc("🌍".as_bytes()).unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_pool_refcount() {
        let mut pool = GraphemePool::new();
        let id = pool.alloc("🌍".as_bytes()).unwrap();
        pool.incref(id);
        pool.decref(id);
        // Still alive (refcount was 2, now 1)
        assert!(pool.get(id).is_some());
        pool.decref(id);
        // Now freed
        assert!(pool.get(id).is_none());
    }
}
