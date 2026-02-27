use crate::ansi::RGBA;
use std::collections::HashMap;

/// A registered syntax style entry.
#[derive(Debug, Clone)]
struct StyleEntry {
    _name: String,
    fg: Option<RGBA>,
    bg: Option<RGBA>,
    attributes: u32,
}

/// Registry of syntax highlighting styles.
///
/// Styles are registered by name and assigned a numeric ID for efficient lookup
/// during rendering.
pub struct SyntaxStyle {
    styles: Vec<StyleEntry>,
    name_to_id: HashMap<String, u32>,
}

impl SyntaxStyle {
    pub fn new() -> Self {
        Self {
            styles: Vec::new(),
            name_to_id: HashMap::new(),
        }
    }

    /// Register a new style and return its ID.
    pub fn register_style(
        &mut self,
        name: &str,
        fg: Option<RGBA>,
        bg: Option<RGBA>,
        attributes: u32,
    ) -> u32 {
        if let Some(&id) = self.name_to_id.get(name) {
            // Update existing style
            self.styles[id as usize] = StyleEntry {
                _name: name.to_string(),
                fg,
                bg,
                attributes,
            };
            return id;
        }

        let id = self.styles.len() as u32;
        self.styles.push(StyleEntry {
            _name: name.to_string(),
            fg,
            bg,
            attributes,
        });
        self.name_to_id.insert(name.to_string(), id);
        id
    }

    /// Look up a style ID by name.
    pub fn resolve_by_name(&self, name: &str) -> Option<u32> {
        self.name_to_id.get(name).copied()
    }

    /// Get the foreground color for a style ID.
    pub fn get_fg(&self, id: u32) -> Option<RGBA> {
        self.styles.get(id as usize).and_then(|s| s.fg)
    }

    /// Get the background color for a style ID.
    pub fn get_bg(&self, id: u32) -> Option<RGBA> {
        self.styles.get(id as usize).and_then(|s| s.bg)
    }

    /// Get the attributes for a style ID.
    pub fn get_attributes(&self, id: u32) -> u32 {
        self.styles.get(id as usize).map(|s| s.attributes).unwrap_or(0)
    }

    /// Get the number of registered styles.
    pub fn get_style_count(&self) -> usize {
        self.styles.len()
    }
}

impl Default for SyntaxStyle {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_resolve() {
        let mut ss = SyntaxStyle::new();
        let id = ss.register_style("keyword", Some([0.0, 0.5, 1.0, 1.0]), None, 1);
        assert_eq!(ss.resolve_by_name("keyword"), Some(id));
        assert_eq!(ss.get_fg(id), Some([0.0, 0.5, 1.0, 1.0]));
        assert_eq!(ss.get_bg(id), None);
        assert_eq!(ss.get_attributes(id), 1);
    }

    #[test]
    fn test_style_count() {
        let mut ss = SyntaxStyle::new();
        ss.register_style("a", None, None, 0);
        ss.register_style("b", None, None, 0);
        assert_eq!(ss.get_style_count(), 2);
    }
}
