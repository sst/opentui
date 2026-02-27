use crate::ansi::RGBA;
use crate::rope::Rope;
use crate::syntax_style::SyntaxStyle;
use crate::utf8::WidthMethod;

/// Wrap mode for text display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapMode {
    None,
    Char,
    Word,
}

impl WrapMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::None,
            1 => Self::Char,
            2 => Self::Word,
            _ => Self::None,
        }
    }
}

/// A highlight span on a single line.
#[derive(Debug, Clone)]
pub struct Highlight {
    pub col_start: u32,
    pub col_end: u32,
    pub style_id: u32,
    pub priority: u8,
    pub hl_ref: u16,
}

/// A styled text chunk for the setStyledText FFI.
#[repr(C)]
pub struct StyledChunk {
    pub text_ptr: *const u8,
    pub text_len: usize,
    pub fg_ptr: *const f32,
    pub bg_ptr: *const f32,
    pub attributes: u32,
    pub link_ptr: *const u8,
    pub link_len: usize,
}

/// Memory buffer registry for reusing large byte slices.
pub struct MemRegistry {
    buffers: Vec<Option<Vec<u8>>>,
}

impl MemRegistry {
    pub fn new() -> Self {
        Self {
            buffers: Vec::new(),
        }
    }

    pub fn register(&mut self, data: &[u8]) -> Option<u8> {
        let id = self.buffers.len();
        if id > 255 {
            return None;
        }
        self.buffers.push(Some(data.to_vec()));
        Some(id as u8)
    }

    pub fn replace(&mut self, id: u8, data: &[u8]) -> bool {
        let id = id as usize;
        if id < self.buffers.len() {
            self.buffers[id] = Some(data.to_vec());
            true
        } else {
            false
        }
    }

    pub fn get(&self, id: u8) -> Option<&[u8]> {
        self.buffers
            .get(id as usize)
            .and_then(|b| b.as_deref())
    }

    pub fn clear(&mut self) {
        self.buffers.clear();
    }
}

impl Default for MemRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Unified text buffer backed by a rope.
pub struct TextBuffer {
    rope: Rope,
    pub mem_registry: MemRegistry,
    pub default_fg: Option<RGBA>,
    pub default_bg: Option<RGBA>,
    pub default_attributes: Option<u32>,
    pub width_method: WidthMethod,
    pub tab_width: u8,
    syntax_style: Option<*const SyntaxStyle>,

    // Per-line highlights
    line_highlights: Vec<Vec<Highlight>>,
    content_epoch: u64,
    view_dirty_flags: Vec<bool>,
    next_view_id: u32,
}

// The raw pointer to SyntaxStyle is only accessed from the same thread.
unsafe impl Send for TextBuffer {}

impl TextBuffer {
    pub fn new(width_method: WidthMethod) -> Self {
        Self {
            rope: Rope::new(),
            mem_registry: MemRegistry::new(),
            default_fg: None,
            default_bg: None,
            default_attributes: None,
            width_method,
            tab_width: 2,
            syntax_style: None,
            line_highlights: Vec::new(),
            content_epoch: 0,
            view_dirty_flags: Vec::new(),
            next_view_id: 0,
        }
    }

    pub fn get_length(&self) -> u32 {
        self.rope.len() as u32
    }

    pub fn get_byte_size(&self) -> u32 {
        self.rope.len() as u32
    }

    pub fn get_line_count(&self) -> u32 {
        self.rope.line_count()
    }

    /// Reset to empty state.
    pub fn reset(&mut self) {
        self.rope = Rope::new();
        self.line_highlights.clear();
        self.content_epoch += 1;
        self.mark_all_views_dirty();
    }

    /// Clear content but keep settings.
    pub fn clear(&mut self) {
        self.rope = Rope::new();
        self.line_highlights.clear();
        self.content_epoch += 1;
        self.mark_all_views_dirty();
    }

    /// Set the full text content.
    pub fn set_text(&mut self, text: &[u8]) {
        self.rope = Rope::from_str(&String::from_utf8_lossy(text));
        self.line_highlights.clear();
        self.content_epoch += 1;
        self.mark_all_views_dirty();
    }

    /// Append text to the buffer.
    pub fn append(&mut self, data: &[u8]) {
        let text = String::from_utf8_lossy(data);
        let appended = Rope::from_str(&text);
        self.rope = self.rope.concat(&appended);
        self.content_epoch += 1;
        self.mark_all_views_dirty();
    }

    /// Set text from a registered memory buffer.
    pub fn set_text_from_mem_id(&mut self, id: u8) {
        if let Some(data) = self.mem_registry.get(id) {
            let data = data.to_vec(); // clone to avoid borrow issues
            self.set_text(&data);
        }
    }

    /// Append from a registered memory buffer.
    pub fn append_from_mem_id(&mut self, id: u8) {
        if let Some(data) = self.mem_registry.get(id) {
            let data = data.to_vec();
            self.append(&data);
        }
    }

    /// Load text from a file path.
    pub fn load_file(&mut self, path: &str) -> Result<(), std::io::Error> {
        let data = std::fs::read(path)?;
        self.set_text(&data);
        Ok(())
    }

    /// Get the plain text content into a buffer.
    pub fn get_plain_text_into_buffer(&self, output: &mut [u8]) -> usize {
        let bytes = self.rope.to_bytes();
        let len = bytes.len().min(output.len());
        output[..len].copy_from_slice(&bytes[..len]);
        len
    }

    /// Get a range of text by byte offsets.
    pub fn get_text_range(&self, start: u32, end: u32, output: &mut [u8]) -> usize {
        let bytes = self.rope.slice(start as usize, end as usize);
        let len = bytes.len().min(output.len());
        output[..len].copy_from_slice(&bytes[..len]);
        len
    }

    /// Get a range of text by (row, col) coordinates.
    pub fn get_text_range_by_coords(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        output: &mut [u8],
    ) -> usize {
        let start = self.rope.coords_to_offset(start_row, start_col).unwrap_or(0);
        let end = self.rope.coords_to_offset(end_row, end_col).unwrap_or(self.rope.len());
        self.get_text_range(start as u32, end as u32, output)
    }

    // --- Default style setters ---

    pub fn set_default_fg(&mut self, fg: Option<RGBA>) {
        self.default_fg = fg;
    }

    pub fn set_default_bg(&mut self, bg: Option<RGBA>) {
        self.default_bg = bg;
    }

    pub fn set_default_attributes(&mut self, attr: Option<u32>) {
        self.default_attributes = attr;
    }

    pub fn reset_defaults(&mut self) {
        self.default_fg = None;
        self.default_bg = None;
        self.default_attributes = None;
    }

    pub fn set_tab_width(&mut self, width: u8) {
        self.tab_width = width;
    }

    // --- Memory registry ---

    pub fn register_mem_buffer(&mut self, data: &[u8]) -> Option<u8> {
        self.mem_registry.register(data)
    }

    pub fn replace_mem_buffer(&mut self, id: u8, data: &[u8]) -> bool {
        self.mem_registry.replace(id, data)
    }

    pub fn clear_mem_registry(&mut self) {
        self.mem_registry.clear();
    }

    // --- Syntax style ---

    pub fn set_syntax_style(&mut self, style: Option<*const SyntaxStyle>) {
        self.syntax_style = style;
    }

    // --- Highlight management ---

    pub fn add_highlight(&mut self, line_idx: u32, start: u32, end: u32, style_id: u32, priority: u8, hl_ref: u16) {
        let idx = line_idx as usize;
        while self.line_highlights.len() <= idx {
            self.line_highlights.push(Vec::new());
        }
        self.line_highlights[idx].push(Highlight {
            col_start: start,
            col_end: end,
            style_id,
            priority,
            hl_ref,
        });
    }

    pub fn add_highlight_by_char_range(&mut self, char_start: u32, char_end: u32, style_id: u32, priority: u8, hl_ref: u16) {
        // Convert char offsets to line/col, then add per-line highlights
        let bytes = self.rope.to_bytes();
        let text = String::from_utf8_lossy(&bytes);

        let mut current_line: u32 = 0;
        let mut current_col: u32 = 0;
        let mut char_idx: u32 = 0;
        let mut start_line = 0u32;
        let mut start_col = 0u32;
        let mut found_start = false;

        for ch in text.chars() {
            if char_idx == char_start {
                start_line = current_line;
                start_col = current_col;
                found_start = true;
            }
            if char_idx == char_end && found_start {
                // Add highlight from start to current position
                if current_line == start_line {
                    self.add_highlight(start_line, start_col, current_col, style_id, priority, hl_ref);
                } else {
                    // Multi-line: first line from start to end, middle lines full, last line to col
                    self.add_highlight(start_line, start_col, u32::MAX, style_id, priority, hl_ref);
                    for l in (start_line + 1)..current_line {
                        self.add_highlight(l, 0, u32::MAX, style_id, priority, hl_ref);
                    }
                    self.add_highlight(current_line, 0, current_col, style_id, priority, hl_ref);
                }
                return;
            }

            if ch == '\n' {
                current_line += 1;
                current_col = 0;
            } else {
                current_col += 1;
            }
            char_idx += 1;
        }
    }

    pub fn remove_highlights_by_ref(&mut self, hl_ref: u16) {
        for line in &mut self.line_highlights {
            line.retain(|h| h.hl_ref != hl_ref);
        }
    }

    pub fn clear_line_highlights(&mut self, line_idx: u32) {
        if let Some(line) = self.line_highlights.get_mut(line_idx as usize) {
            line.clear();
        }
    }

    pub fn clear_all_highlights(&mut self) {
        self.line_highlights.clear();
    }

    pub fn get_line_highlights(&self, line_idx: u32) -> &[Highlight] {
        self.line_highlights
            .get(line_idx as usize)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    pub fn get_highlight_count(&self) -> u32 {
        self.line_highlights.iter().map(|l| l.len() as u32).sum()
    }

    // --- Styled text ---

    /// Set styled text from chunks (FFI-compatible).
    ///
    /// # Safety
    /// Caller must ensure all pointers in chunks are valid.
    pub unsafe fn set_styled_text(&mut self, chunks: &[StyledChunk]) {
        let mut text = String::new();
        for chunk in chunks {
            let slice = std::slice::from_raw_parts(chunk.text_ptr, chunk.text_len);
            if let Ok(s) = std::str::from_utf8(slice) {
                text.push_str(s);
            }
        }
        self.set_text(text.as_bytes());
    }

    // --- View management ---

    pub fn register_view(&mut self) -> u32 {
        let id = self.next_view_id;
        self.next_view_id += 1;
        self.view_dirty_flags.push(true);
        id
    }

    pub fn mark_all_views_dirty(&mut self) {
        for flag in &mut self.view_dirty_flags {
            *flag = true;
        }
    }

    pub fn is_view_dirty(&self, id: u32) -> bool {
        self.view_dirty_flags.get(id as usize).copied().unwrap_or(true)
    }

    pub fn clear_view_dirty(&mut self, id: u32) {
        if let Some(flag) = self.view_dirty_flags.get_mut(id as usize) {
            *flag = false;
        }
    }

    pub fn content_epoch(&self) -> u64 {
        self.content_epoch
    }

    /// Access the underlying rope.
    pub fn rope(&self) -> &Rope {
        &self.rope
    }

    /// Mutable access to the rope.
    pub fn rope_mut(&mut self) -> &mut Rope {
        &mut self.rope
    }

    /// Get line width at a given row.
    pub fn line_width_at(&self, row: u32) -> u32 {
        let bytes = self.rope.to_bytes();
        let text = String::from_utf8_lossy(&bytes);
        let mut current_line: u32 = 0;
        let mut width: u32 = 0;

        for ch in text.chars() {
            if current_line == row {
                if ch == '\n' {
                    return width;
                }
                width += if ch == '\t' {
                    self.tab_width as u32
                } else {
                    unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0) as u32
                };
            } else if ch == '\n' {
                current_line += 1;
                if current_line > row {
                    return width;
                }
            }
        }
        width
    }
}

impl Default for TextBuffer {
    fn default() -> Self {
        Self::new(WidthMethod::Unicode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_text_buffer_basic() {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        tb.set_text(b"Hello\nWorld");
        assert_eq!(tb.get_length(), 11);
        assert_eq!(tb.get_line_count(), 2);
    }

    #[test]
    fn test_text_buffer_append() {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        tb.set_text(b"Hello");
        tb.append(b" World");
        assert_eq!(tb.get_length(), 11);
    }

    #[test]
    fn test_text_buffer_highlights() {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        tb.set_text(b"Hello World");
        tb.add_highlight(0, 0, 5, 1, 0, 42);
        assert_eq!(tb.get_line_highlights(0).len(), 1);
        assert_eq!(tb.get_highlight_count(), 1);
        tb.remove_highlights_by_ref(42);
        assert_eq!(tb.get_highlight_count(), 0);
    }

    #[test]
    fn test_text_buffer_mem_registry() {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        let id = tb.register_mem_buffer(b"cached data").unwrap();
        tb.set_text_from_mem_id(id);
        assert_eq!(tb.get_length(), 11);
    }
}
