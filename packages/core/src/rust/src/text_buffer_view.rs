use crate::ansi::RGBA;
use crate::text_buffer::{TextBuffer, WrapMode};

/// Viewport rectangle.
#[derive(Debug, Clone, Copy)]
pub struct Viewport {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Cached line info — offsets, widths, source lines, and wrap info.
#[derive(Debug, Clone, Default)]
pub struct LineInfo {
    pub starts: Vec<u32>,
    pub widths: Vec<u32>,
    pub sources: Vec<u32>,
    pub wraps: Vec<u32>,
    pub max_width: u32,
}

/// Selection state.
#[derive(Debug, Clone)]
pub struct Selection {
    pub start: u32,
    pub end: u32,
    pub bg_color: Option<RGBA>,
    pub fg_color: Option<RGBA>,
}

/// Local (visual) selection state.
#[derive(Debug, Clone)]
pub struct LocalSelection {
    pub anchor_x: i32,
    pub anchor_y: i32,
    pub focus_x: i32,
    pub focus_y: i32,
    pub bg_color: Option<RGBA>,
    pub fg_color: Option<RGBA>,
}

/// Measurement result for dimension queries.
#[derive(Debug, Clone, Copy)]
pub struct MeasureResult {
    pub line_count: u32,
    pub max_width: u32,
}

/// A view into a TextBuffer with viewport, wrapping, and selection support.
pub struct TextBufferView {
    tb: *mut TextBuffer,
    _view_id: u32,
    viewport: Viewport,
    wrap_mode: WrapMode,
    wrap_width: Option<u32>,
    selection: Option<Selection>,
    local_selection: Option<LocalSelection>,
    truncate: bool,
    tab_indicator: Option<u32>,
    tab_indicator_color: Option<RGBA>,

    // Cached line info
    cached_line_info: LineInfo,
    cached_logical_line_info: LineInfo,
    cache_epoch: u64,
}

unsafe impl Send for TextBufferView {}

impl TextBufferView {
    /// # Safety
    /// Caller must ensure `tb` lives at least as long as this view.
    pub unsafe fn new(tb: *mut TextBuffer) -> Self {
        let _view_id = (*tb).register_view();
        Self {
            tb,
            _view_id,
            viewport: Viewport {
                x: 0,
                y: 0,
                width: 80,
                height: 24,
            },
            wrap_mode: WrapMode::None,
            wrap_width: None,
            selection: None,
            local_selection: None,
            truncate: false,
            tab_indicator: None,
            tab_indicator_color: None,
            cached_line_info: LineInfo::default(),
            cached_logical_line_info: LineInfo::default(),
            cache_epoch: 0,
        }
    }

    fn tb(&self) -> &TextBuffer {
        unsafe { &*self.tb }
    }

    fn _tb_mut(&mut self) -> &mut TextBuffer {
        unsafe { &mut *self.tb }
    }

    // --- Selection ---

    pub fn set_selection(&mut self, start: u32, end: u32, bg: Option<RGBA>, fg: Option<RGBA>) {
        self.selection = Some(Selection {
            start,
            end,
            bg_color: bg,
            fg_color: fg,
        });
    }

    pub fn reset_selection(&mut self) {
        self.selection = None;
    }

    pub fn pack_selection_info(&self) -> u64 {
        if let Some(ref sel) = self.selection {
            ((sel.start as u64) << 32) | (sel.end as u64)
        } else {
            0
        }
    }

    pub fn update_selection(&mut self, end: u32, bg: Option<RGBA>, fg: Option<RGBA>) {
        if let Some(ref mut sel) = self.selection {
            sel.end = end;
            if bg.is_some() {
                sel.bg_color = bg;
            }
            if fg.is_some() {
                sel.fg_color = fg;
            }
        }
    }

    pub fn set_local_selection(
        &mut self,
        anchor_x: i32,
        anchor_y: i32,
        focus_x: i32,
        focus_y: i32,
        bg: Option<RGBA>,
        fg: Option<RGBA>,
    ) -> bool {
        self.local_selection = Some(LocalSelection {
            anchor_x,
            anchor_y,
            focus_x,
            focus_y,
            bg_color: bg,
            fg_color: fg,
        });
        true
    }

    pub fn update_local_selection(
        &mut self,
        anchor_x: i32,
        anchor_y: i32,
        focus_x: i32,
        focus_y: i32,
        bg: Option<RGBA>,
        fg: Option<RGBA>,
    ) -> bool {
        self.set_local_selection(anchor_x, anchor_y, focus_x, focus_y, bg, fg)
    }

    pub fn reset_local_selection(&mut self) {
        self.local_selection = None;
    }

    /// Get selected text into output buffer.
    pub fn get_selected_text_into_buffer(&self, output: &mut [u8]) -> usize {
        if let Some(ref sel) = self.selection {
            self.tb().get_text_range(sel.start, sel.end, output)
        } else {
            0
        }
    }

    /// Get plain text into output buffer (delegates to TextBuffer).
    pub fn get_plain_text_into_buffer(&self, output: &mut [u8]) -> usize {
        self.tb().get_plain_text_into_buffer(output)
    }

    // --- Viewport ---

    pub fn set_viewport(&mut self, vp: Viewport) {
        self.viewport = vp;
    }

    pub fn set_viewport_size(&mut self, width: u32, height: u32) {
        self.viewport.width = width;
        self.viewport.height = height;
    }

    pub fn set_wrap_width(&mut self, width: Option<u32>) {
        self.wrap_width = width;
    }

    pub fn set_wrap_mode(&mut self, mode: WrapMode) {
        self.wrap_mode = mode;
    }

    pub fn set_truncate(&mut self, truncate: bool) {
        self.truncate = truncate;
    }

    pub fn set_tab_indicator(&mut self, indicator: u32) {
        self.tab_indicator = Some(indicator);
    }

    pub fn set_tab_indicator_color(&mut self, color: RGBA) {
        self.tab_indicator_color = Some(color);
    }

    /// Get the number of virtual lines (after wrapping).
    pub fn get_virtual_line_count(&self) -> u32 {
        // Simplified: no wrapping means virtual == logical
        self.tb().get_line_count()
    }

    /// Get cached line info.
    pub fn get_cached_line_info(&mut self) -> &LineInfo {
        self.rebuild_line_info_if_needed();
        &self.cached_line_info
    }

    /// Get logical (pre-wrap) line info.
    pub fn get_logical_line_info(&mut self) -> &LineInfo {
        self.rebuild_line_info_if_needed();
        &self.cached_logical_line_info
    }

    fn rebuild_line_info_if_needed(&mut self) {
        let epoch = self.tb().content_epoch();
        if self.cache_epoch == epoch {
            return;
        }
        self.cache_epoch = epoch;

        let tb = self.tb();
        let line_count = tb.get_line_count();
        let mut starts = Vec::with_capacity(line_count as usize);
        let mut widths = Vec::with_capacity(line_count as usize);
        let mut sources = Vec::with_capacity(line_count as usize);
        let mut wraps = Vec::with_capacity(line_count as usize);
        let mut max_width: u32 = 0;

        let bytes = tb.rope().to_bytes();
        let mut offset: u32 = 0;
        let mut line: u32 = 0;

        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' || i == bytes.len() - 1 {
                let end = if b == b'\n' { i as u32 } else { (i + 1) as u32 };
                let w = end - offset;
                starts.push(offset);
                widths.push(w);
                sources.push(line);
                wraps.push(0);
                if w > max_width {
                    max_width = w;
                }
                offset = (i + 1) as u32;
                line += 1;
            }
        }

        if bytes.is_empty() {
            starts.push(0);
            widths.push(0);
            sources.push(0);
            wraps.push(0);
        }

        self.cached_line_info = LineInfo {
            starts: starts.clone(),
            widths: widths.clone(),
            sources: sources.clone(),
            wraps: wraps.clone(),
            max_width,
        };
        self.cached_logical_line_info = LineInfo {
            starts,
            widths,
            sources,
            wraps,
            max_width,
        };
    }

    /// Measure how many lines and what max width text would need at given dimensions.
    pub fn measure_for_dimensions(&mut self, _width: u32, _height: u32) -> Option<MeasureResult> {
        let line_info = self.get_cached_line_info();
        Some(MeasureResult {
            line_count: line_info.starts.len() as u32,
            max_width: line_info.max_width,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_view_basic() {
        let mut tb = TextBuffer::new(crate::utf8::WidthMethod::Unicode);
        tb.set_text(b"line1\nline2\nline3");
        let view = unsafe { TextBufferView::new(&mut tb) };
        assert_eq!(view.get_virtual_line_count(), 3);
    }

    #[test]
    fn test_view_selection() {
        let mut tb = TextBuffer::new(crate::utf8::WidthMethod::Unicode);
        tb.set_text(b"Hello World");
        let mut view = unsafe { TextBufferView::new(&mut tb) };
        view.set_selection(0, 5, None, None);
        let packed = view.pack_selection_info();
        assert_eq!(packed >> 32, 0);
        assert_eq!(packed & 0xFFFFFFFF, 5);
    }
}
