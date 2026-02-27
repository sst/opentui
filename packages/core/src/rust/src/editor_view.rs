use crate::ansi::RGBA;
use crate::edit_buffer::EditBuffer;
use crate::text_buffer::WrapMode;
use crate::text_buffer_view::{LineInfo, TextBufferView, Viewport};

/// Visual cursor with both logical and visual coordinates.
#[derive(Debug, Clone, Copy)]
pub struct VisualCursor {
    pub visual_row: u32,
    pub visual_col: u32,
    pub logical_row: u32,
    pub logical_col: u32,
    pub offset: u32,
}

/// Editor view — wraps an EditBuffer with viewport, wrapping, and visual cursor support.
pub struct EditorView {
    edit_buffer: *mut EditBuffer,
    pub text_buffer_view: TextBufferView,
    viewport: Option<Viewport>,
    scroll_margin: f32,
    selection_follow_cursor: bool,
}

unsafe impl Send for EditorView {}

impl EditorView {
    /// # Safety
    /// Caller must ensure `edit_buffer` lives at least as long as this view.
    pub unsafe fn new(edit_buffer: *mut EditBuffer, viewport_width: u32, viewport_height: u32) -> Self {
        let tb = &mut (*edit_buffer).tb;
        let tbv = TextBufferView::new(tb);
        Self {
            edit_buffer,
            text_buffer_view: tbv,
            viewport: Some(Viewport {
                x: 0,
                y: 0,
                width: viewport_width,
                height: viewport_height,
            }),
            scroll_margin: 0.0,
            selection_follow_cursor: false,
        }
    }

    fn eb(&self) -> &EditBuffer {
        unsafe { &*self.edit_buffer }
    }

    fn eb_mut(&mut self) -> &mut EditBuffer {
        unsafe { &mut *self.edit_buffer }
    }

    // --- Viewport ---

    pub fn set_viewport(&mut self, vp: Option<Viewport>, _move_cursor: bool) {
        self.viewport = vp;
        if let Some(vp) = vp {
            self.text_buffer_view.set_viewport(vp);
        }
    }

    pub fn get_viewport(&self) -> Option<Viewport> {
        self.viewport
    }

    pub fn set_viewport_size(&mut self, width: u32, height: u32) {
        if let Some(ref mut vp) = self.viewport {
            vp.width = width;
            vp.height = height;
        }
        self.text_buffer_view.set_viewport_size(width, height);
    }

    pub fn set_scroll_margin(&mut self, margin: f32) {
        self.scroll_margin = margin;
    }

    pub fn set_wrap_mode(&mut self, mode: WrapMode) {
        self.text_buffer_view.set_wrap_mode(mode);
    }

    pub fn set_selection_follow_cursor(&mut self, follow: bool) {
        self.selection_follow_cursor = follow;
    }

    // --- Line info ---

    pub fn get_virtual_lines(&self) -> Vec<u32> {
        // Return virtual line indices visible in the viewport
        let line_count = self.eb().tb.get_line_count();
        (0..line_count).collect()
    }

    pub fn get_total_virtual_line_count(&self) -> u32 {
        self.eb().tb.get_line_count()
    }

    pub fn get_cached_line_info(&mut self) -> &LineInfo {
        self.text_buffer_view.get_cached_line_info()
    }

    pub fn get_logical_line_info(&mut self) -> &LineInfo {
        self.text_buffer_view.get_logical_line_info()
    }

    pub fn get_text_buffer_view(&mut self) -> &mut TextBufferView {
        &mut self.text_buffer_view
    }

    // --- Cursor ---

    pub fn get_primary_cursor(&self) -> crate::edit_buffer::Cursor {
        self.eb().get_primary_cursor()
    }

    pub fn get_visual_cursor(&self) -> VisualCursor {
        let pos = self.eb().get_cursor_position();
        VisualCursor {
            visual_row: pos.row,
            visual_col: pos.col,
            logical_row: pos.row,
            logical_col: pos.col,
            offset: pos.offset,
        }
    }

    pub fn move_up_visual(&mut self) {
        self.eb_mut().move_up();
    }

    pub fn move_down_visual(&mut self) {
        self.eb_mut().move_down();
    }

    pub fn set_cursor_by_offset(&mut self, offset: u32) {
        self.eb_mut().set_cursor_by_offset(offset);
    }

    pub fn get_next_word_boundary(&self) -> VisualCursor {
        let lc = self.eb().get_next_word_boundary();
        VisualCursor {
            visual_row: lc.row,
            visual_col: lc.col,
            logical_row: lc.row,
            logical_col: lc.col,
            offset: lc.offset,
        }
    }

    pub fn get_prev_word_boundary(&self) -> VisualCursor {
        let lc = self.eb().get_prev_word_boundary();
        VisualCursor {
            visual_row: lc.row,
            visual_col: lc.col,
            logical_row: lc.row,
            logical_col: lc.col,
            offset: lc.offset,
        }
    }

    pub fn get_eol(&self) -> VisualCursor {
        let lc = self.eb().get_eol();
        VisualCursor {
            visual_row: lc.row,
            visual_col: lc.col,
            logical_row: lc.row,
            logical_col: lc.col,
            offset: lc.offset,
        }
    }

    pub fn get_visual_sol(&self) -> VisualCursor {
        let cursor = self.eb().get_primary_cursor();
        let offset = self.eb().tb.rope().coords_to_offset(cursor.row, 0).unwrap_or(0);
        VisualCursor {
            visual_row: cursor.row,
            visual_col: 0,
            logical_row: cursor.row,
            logical_col: 0,
            offset: offset as u32,
        }
    }

    pub fn get_visual_eol(&self) -> VisualCursor {
        self.get_eol()
    }

    // --- Selection ---

    pub fn set_local_selection(
        &mut self,
        anchor_x: i32,
        anchor_y: i32,
        focus_x: i32,
        focus_y: i32,
        bg: Option<RGBA>,
        fg: Option<RGBA>,
        _update_cursor: bool,
    ) -> bool {
        self.text_buffer_view
            .set_local_selection(anchor_x, anchor_y, focus_x, focus_y, bg, fg)
    }

    pub fn update_selection(&mut self, end: u32, bg: Option<RGBA>, fg: Option<RGBA>) {
        self.text_buffer_view.update_selection(end, bg, fg);
    }

    pub fn update_local_selection(
        &mut self,
        anchor_x: i32,
        anchor_y: i32,
        focus_x: i32,
        focus_y: i32,
        bg: Option<RGBA>,
        fg: Option<RGBA>,
        _update_cursor: bool,
    ) -> bool {
        self.text_buffer_view
            .update_local_selection(anchor_x, anchor_y, focus_x, focus_y, bg, fg)
    }

    pub fn delete_selected_text(&mut self) {
        // Simplified: just clear selection
        self.text_buffer_view.reset_selection();
    }

    // --- Text access ---

    pub fn get_text(&self, output: &mut [u8]) -> usize {
        self.eb().get_text(output)
    }

    // --- Placeholders & indicators ---

    pub fn set_placeholder_styled_text(&mut self, _chunks: &[crate::text_buffer::StyledChunk]) {
        // Store placeholder text for display when buffer is empty
    }

    pub fn set_tab_indicator(&mut self, indicator: u32) {
        self.text_buffer_view.set_tab_indicator(indicator);
    }

    pub fn set_tab_indicator_color(&mut self, color: RGBA) {
        self.text_buffer_view.set_tab_indicator_color(color);
    }
}
