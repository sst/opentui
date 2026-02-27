use std::collections::HashMap;
use std::sync::Mutex;

/// Pool for storing hyperlink URLs, referenced by integer IDs.
pub struct LinkPool {
    urls: Vec<Option<String>>,
    free_list: Vec<u32>,
    intern_map: HashMap<String, u32>,
}

impl LinkPool {
    pub fn new() -> Self {
        // Reserve ID 0 as "no link"
        Self {
            urls: vec![None],
            free_list: Vec::new(),
            intern_map: HashMap::new(),
        }
    }

    /// Allocate or intern a URL, returning its link ID.
    pub fn alloc(&mut self, url: &str) -> Option<u32> {
        if let Some(&id) = self.intern_map.get(url) {
            return Some(id);
        }

        let id = if let Some(free_id) = self.free_list.pop() {
            free_id
        } else {
            let id = self.urls.len() as u32;
            self.urls.push(None);
            id
        };

        self.urls[id as usize] = Some(url.to_string());
        self.intern_map.insert(url.to_string(), id);
        Some(id)
    }

    /// Get the URL for a link ID.
    pub fn get(&self, id: u32) -> Option<&str> {
        self.urls
            .get(id as usize)
            .and_then(|s| s.as_deref())
    }

    /// Clear all links.
    pub fn clear(&mut self) {
        self.urls.clear();
        self.urls.push(None); // reserve 0
        self.free_list.clear();
        self.intern_map.clear();
    }
}

impl Default for LinkPool {
    fn default() -> Self {
        Self::new()
    }
}

static GLOBAL_LINK_POOL: Mutex<Option<LinkPool>> = Mutex::new(None);

pub fn init_global_link_pool() -> &'static Mutex<Option<LinkPool>> {
    {
        let mut pool = GLOBAL_LINK_POOL.lock().unwrap();
        if pool.is_none() {
            *pool = Some(LinkPool::new());
        }
    }
    &GLOBAL_LINK_POOL
}

pub fn with_global_link_pool<F, R>(f: F) -> R
where
    F: FnOnce(&mut LinkPool) -> R,
{
    init_global_link_pool();
    let mut pool = GLOBAL_LINK_POOL.lock().unwrap();
    f(pool.as_mut().unwrap())
}

pub fn deinit_global_link_pool() {
    let mut pool = GLOBAL_LINK_POOL.lock().unwrap();
    if let Some(ref mut p) = *pool {
        p.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_link_pool() {
        let mut pool = LinkPool::new();
        let id = pool.alloc("https://example.com").unwrap();
        assert!(id > 0);
        assert_eq!(pool.get(id), Some("https://example.com"));
        assert_eq!(pool.get(0), None);
    }

    #[test]
    fn test_link_pool_intern() {
        let mut pool = LinkPool::new();
        let id1 = pool.alloc("https://example.com").unwrap();
        let id2 = pool.alloc("https://example.com").unwrap();
        assert_eq!(id1, id2);
    }
}
