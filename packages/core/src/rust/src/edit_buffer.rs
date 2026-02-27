use crate::text_buffer::TextBuffer;
use crate::utf8::WidthMethod;

/// Cursor position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cursor {
    pub row: u32,
    pub col: u32,
}

/// Logical cursor with row, col, and byte offset.
#[derive(Debug, Clone, Copy)]
pub struct LogicalCursor {
    pub row: u32,
    pub col: u32,
    pub offset: u32,
}

/// A history entry for undo/redo.
#[derive(Debug, Clone)]
struct HistoryEntry {
    text: Vec<u8>,
    cursor: Cursor,
    metadata: Vec<u8>,
}

/// Editable text buffer with cursor, undo/redo, and text manipulation.
pub struct EditBuffer {
    pub tb: TextBuffer,
    cursor: Cursor,
    history: Vec<HistoryEntry>,
    undo_pos: usize,
    id: u16,
}

static mut NEXT_EDIT_BUFFER_ID: u16 = 0;

impl EditBuffer {
    pub fn new(width_method: WidthMethod) -> Self {
        let id = unsafe {
            let id = NEXT_EDIT_BUFFER_ID;
            NEXT_EDIT_BUFFER_ID += 1;
            id
        };
        Self {
            tb: TextBuffer::new(width_method),
            cursor: Cursor { row: 0, col: 0 },
            history: Vec::new(),
            undo_pos: 0,
            id,
        }
    }

    pub fn get_text_buffer(&mut self) -> &mut TextBuffer {
        &mut self.tb
    }

    pub fn get_id(&self) -> u16 {
        self.id
    }

    pub fn get_primary_cursor(&self) -> Cursor {
        self.cursor
    }

    pub fn set_cursor(&mut self, row: u32, col: u32) {
        self.cursor = Cursor { row, col };
    }

    pub fn set_cursor_by_offset(&mut self, offset: u32) {
        if let Some((row, col)) = self.tb.rope().offset_to_coords(offset as usize) {
            self.cursor = Cursor { row, col };
        }
    }

    /// Insert text at the current cursor position.
    pub fn insert_text(&mut self, text: &[u8]) {
        self.save_history();
        let offset = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, self.cursor.col)
            .unwrap_or(self.tb.rope().len());
        let new_rope = self.tb.rope().insert(offset, text);
        *self.tb.rope_mut() = new_rope;
        self.tb.mark_all_views_dirty();

        // Advance cursor
        let s = String::from_utf8_lossy(text);
        for ch in s.chars() {
            if ch == '\n' {
                self.cursor.row += 1;
                self.cursor.col = 0;
            } else {
                self.cursor.col += 1;
            }
        }
    }

    /// Set the full text, replacing everything.
    pub fn set_text(&mut self, text: &[u8]) {
        self.save_history();
        self.tb.set_text(text);
        self.cursor = Cursor { row: 0, col: 0 };
    }

    /// Set text from a memory-registered buffer.
    pub fn set_text_from_mem_id(&mut self, mem_id: u8) {
        self.save_history();
        self.tb.set_text_from_mem_id(mem_id);
        self.cursor = Cursor { row: 0, col: 0 };
    }

    /// Replace text at cursor (overwrite mode).
    pub fn replace_text(&mut self, text: &[u8]) {
        self.save_history();
        self.tb.set_text(text);
        // Keep cursor where it is, clamping to valid range
        let line_count = self.tb.get_line_count();
        if self.cursor.row >= line_count {
            self.cursor.row = line_count.saturating_sub(1);
        }
    }

    /// Replace text from a memory-registered buffer.
    pub fn replace_text_from_mem_id(&mut self, mem_id: u8) {
        self.save_history();
        self.tb.set_text_from_mem_id(mem_id);
    }

    /// Delete character backward (backspace).
    pub fn backspace(&mut self) {
        if self.cursor.col > 0 {
            self.save_history();
            let offset = self
                .tb
                .rope()
                .coords_to_offset(self.cursor.row, self.cursor.col)
                .unwrap_or(0);
            if offset > 0 {
                let new_rope = self.tb.rope().delete(offset - 1, offset);
                *self.tb.rope_mut() = new_rope;
                self.tb.mark_all_views_dirty();
                self.cursor.col -= 1;
            }
        } else if self.cursor.row > 0 {
            // Join with previous line
            self.save_history();
            let offset = self
                .tb
                .rope()
                .coords_to_offset(self.cursor.row, 0)
                .unwrap_or(0);
            if offset > 0 {
                // The previous line's width
                let prev_width = self.tb.line_width_at(self.cursor.row - 1);
                let new_rope = self.tb.rope().delete(offset - 1, offset);
                *self.tb.rope_mut() = new_rope;
                self.tb.mark_all_views_dirty();
                self.cursor.row -= 1;
                self.cursor.col = prev_width;
            }
        }
    }

    /// Delete character forward.
    pub fn delete_forward(&mut self) {
        let offset = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, self.cursor.col)
            .unwrap_or(0);
        if offset < self.tb.rope().len() {
            self.save_history();
            let new_rope = self.tb.rope().delete(offset, offset + 1);
            *self.tb.rope_mut() = new_rope;
            self.tb.mark_all_views_dirty();
        }
    }

    /// Delete a range of text by (row, col) coordinates.
    pub fn delete_range(&mut self, start: Cursor, end: Cursor) {
        let start_offset = self
            .tb
            .rope()
            .coords_to_offset(start.row, start.col)
            .unwrap_or(0);
        let end_offset = self
            .tb
            .rope()
            .coords_to_offset(end.row, end.col)
            .unwrap_or(self.tb.rope().len());
        if start_offset < end_offset {
            self.save_history();
            let new_rope = self.tb.rope().delete(start_offset, end_offset);
            *self.tb.rope_mut() = new_rope;
            self.tb.mark_all_views_dirty();
            self.cursor = start;
        }
    }

    /// Delete the current line.
    pub fn delete_line(&mut self) {
        let line_start = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, 0)
            .unwrap_or(0);
        let next_line_start = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row + 1, 0)
            .unwrap_or(self.tb.rope().len());
        if line_start < next_line_start {
            self.save_history();
            let new_rope = self.tb.rope().delete(line_start, next_line_start);
            *self.tb.rope_mut() = new_rope;
            self.tb.mark_all_views_dirty();
            self.cursor.col = 0;
        }
    }

    /// Move cursor to a specific line.
    pub fn goto_line(&mut self, line: u32) {
        let max = self.tb.get_line_count().saturating_sub(1);
        self.cursor.row = line.min(max);
        self.cursor.col = 0;
    }

    // --- Cursor movement ---

    pub fn move_left(&mut self) {
        if self.cursor.col > 0 {
            self.cursor.col -= 1;
        } else if self.cursor.row > 0 {
            self.cursor.row -= 1;
            self.cursor.col = self.tb.line_width_at(self.cursor.row);
        }
    }

    pub fn move_right(&mut self) {
        let line_width = self.tb.line_width_at(self.cursor.row);
        if self.cursor.col < line_width {
            self.cursor.col += 1;
        } else if self.cursor.row + 1 < self.tb.get_line_count() {
            self.cursor.row += 1;
            self.cursor.col = 0;
        }
    }

    pub fn move_up(&mut self) {
        if self.cursor.row > 0 {
            self.cursor.row -= 1;
            let line_width = self.tb.line_width_at(self.cursor.row);
            self.cursor.col = self.cursor.col.min(line_width);
        }
    }

    pub fn move_down(&mut self) {
        if self.cursor.row + 1 < self.tb.get_line_count() {
            self.cursor.row += 1;
            let line_width = self.tb.line_width_at(self.cursor.row);
            self.cursor.col = self.cursor.col.min(line_width);
        }
    }

    /// Get the cursor position as (line, visual_col, byte_offset).
    pub fn get_cursor_position(&self) -> LogicalCursor {
        let offset = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, self.cursor.col)
            .unwrap_or(0);
        LogicalCursor {
            row: self.cursor.row,
            col: self.cursor.col,
            offset: offset as u32,
        }
    }

    /// Get next word boundary from cursor.
    pub fn get_next_word_boundary(&self) -> LogicalCursor {
        let bytes = self.tb.rope().to_bytes();
        let offset = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, self.cursor.col)
            .unwrap_or(0);

        let mut i = offset;
        // Skip non-word characters
        while i < bytes.len() && !bytes[i].is_ascii_alphanumeric() && bytes[i] != b'_' {
            i += 1;
        }
        // Skip word characters
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
            i += 1;
        }

        let (row, col) = self.tb.rope().offset_to_coords(i).unwrap_or((self.cursor.row, self.cursor.col));
        LogicalCursor {
            row,
            col,
            offset: i as u32,
        }
    }

    /// Get previous word boundary from cursor.
    pub fn get_prev_word_boundary(&self) -> LogicalCursor {
        let bytes = self.tb.rope().to_bytes();
        let offset = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, self.cursor.col)
            .unwrap_or(0);

        if offset == 0 {
            return LogicalCursor {
                row: 0,
                col: 0,
                offset: 0,
            };
        }

        let mut i = offset - 1;
        // Skip non-word characters backward
        while i > 0 && !bytes[i].is_ascii_alphanumeric() && bytes[i] != b'_' {
            i -= 1;
        }
        // Skip word characters backward
        while i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_') {
            i -= 1;
        }

        let (row, col) = self.tb.rope().offset_to_coords(i).unwrap_or((0, 0));
        LogicalCursor {
            row,
            col,
            offset: i as u32,
        }
    }

    /// Get end-of-line position.
    pub fn get_eol(&self) -> LogicalCursor {
        let width = self.tb.line_width_at(self.cursor.row);
        let offset = self
            .tb
            .rope()
            .coords_to_offset(self.cursor.row, width)
            .unwrap_or(0);
        LogicalCursor {
            row: self.cursor.row,
            col: width,
            offset: offset as u32,
        }
    }

    /// Get text in the output buffer.
    pub fn get_text(&self, output: &mut [u8]) -> usize {
        self.tb.get_plain_text_into_buffer(output)
    }

    /// Get text range by byte offsets.
    pub fn get_text_range(&self, start: u32, end: u32, output: &mut [u8]) -> usize {
        self.tb.get_text_range(start, end, output)
    }

    /// Get text range by coordinates.
    pub fn get_text_range_by_coords(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        output: &mut [u8],
    ) -> usize {
        self.tb
            .get_text_range_by_coords(start_row, start_col, end_row, end_col, output)
    }

    /// Clear the buffer.
    pub fn clear(&mut self) {
        self.save_history();
        self.tb.clear();
        self.cursor = Cursor { row: 0, col: 0 };
    }

    /// Debug: log the rope structure.
    pub fn debug_log_rope(&self) {
        let text = self.tb.rope().to_string_lossy();
        crate::logger::debug(&format!("EditBuffer[{}] rope: {:?}", self.id, text));
    }

    // --- Undo / Redo ---

    fn save_history(&mut self) {
        // Truncate any redo history
        self.history.truncate(self.undo_pos);
        let bytes = self.tb.rope().to_bytes();
        self.history.push(HistoryEntry {
            text: bytes,
            cursor: self.cursor,
            metadata: Vec::new(),
        });
        self.undo_pos = self.history.len();
    }

    pub fn undo(&mut self) -> Option<&[u8]> {
        if self.undo_pos == 0 {
            return None;
        }
        // Save current state for redo
        let current = self.tb.rope().to_bytes();
        if self.undo_pos == self.history.len() {
            self.history.push(HistoryEntry {
                text: current,
                cursor: self.cursor,
                metadata: Vec::new(),
            });
        }

        self.undo_pos -= 1;
        let entry = &self.history[self.undo_pos];
        self.tb.set_text(&entry.text);
        self.cursor = entry.cursor;
        Some(&entry.metadata)
    }

    pub fn redo(&mut self) -> Option<&[u8]> {
        if self.undo_pos + 1 >= self.history.len() {
            return None;
        }
        self.undo_pos += 1;
        let entry = &self.history[self.undo_pos];
        self.tb.set_text(&entry.text);
        self.cursor = entry.cursor;
        Some(&entry.metadata)
    }

    pub fn can_undo(&self) -> bool {
        self.undo_pos > 0
    }

    pub fn can_redo(&self) -> bool {
        self.undo_pos + 1 < self.history.len()
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
        self.undo_pos = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edit_buffer_insert() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text(b"Hello");
        let mut buf = [0u8; 100];
        let len = eb.get_text(&mut buf);
        assert_eq!(&buf[..len], b"Hello");
        assert_eq!(eb.get_primary_cursor(), Cursor { row: 0, col: 5 });
    }

    #[test]
    fn test_edit_buffer_backspace() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text(b"Hello");
        eb.backspace();
        let mut buf = [0u8; 100];
        let len = eb.get_text(&mut buf);
        assert_eq!(&buf[..len], b"Hell");
    }

    #[test]
    fn test_edit_buffer_undo_redo() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text(b"Hello");
        eb.insert_text(b" World");
        assert!(eb.can_undo());
        eb.undo();
        let mut buf = [0u8; 100];
        let len = eb.get_text(&mut buf);
        assert_eq!(&buf[..len], b"Hello");
        assert!(eb.can_redo());
    }

    #[test]
    fn test_edit_buffer_cursor_movement() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text(b"line1\nline2");
        eb.set_cursor(0, 0);
        eb.move_right();
        assert_eq!(eb.get_primary_cursor(), Cursor { row: 0, col: 1 });
        eb.move_down();
        assert_eq!(eb.get_primary_cursor(), Cursor { row: 1, col: 1 });
    }
}
