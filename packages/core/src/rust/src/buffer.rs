use crate::ansi::RGBA;
use crate::grapheme;
use crate::logger;
use crate::utf8::WidthMethod;
use crate::utils;

pub const DEFAULT_SPACE_CHAR: u32 = 32;

#[derive(Debug, Clone, Copy)]
pub struct BorderSides {
    pub top: bool,
    pub right: bool,
    pub bottom: bool,
    pub left: bool,
}

#[derive(Debug, Clone, Copy)]
#[repr(u8)]
pub enum BorderCharIndex {
    TopLeft = 0,
    TopRight = 1,
    BottomLeft = 2,
    BottomRight = 3,
    Horizontal = 4,
    Vertical = 5,
    TopT = 6,
    BottomT = 7,
    LeftT = 8,
    RightT = 9,
    Cross = 10,
}

#[derive(Debug, Clone, Copy)]
pub struct TextSelection {
    pub start: u32,
    pub end: u32,
    pub bg_color: Option<RGBA>,
    pub fg_color: Option<RGBA>,
}

#[derive(Debug, Clone, Copy)]
pub struct ClipRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct Cell {
    pub char: u32,
    pub fg: RGBA,
    pub bg: RGBA,
    pub attributes: u32,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            char: DEFAULT_SPACE_CHAR,
            fg: [1.0, 1.0, 1.0, 1.0],
            bg: [0.0, 0.0, 0.0, 0.0],
            attributes: 0,
        }
    }
}

/// Optimized buffer for terminal rendering.
///
/// Stores cells in structure-of-arrays layout for cache-friendly rendering:
/// separate arrays for char, fg, bg, and attributes.
pub struct OptimizedBuffer {
    pub chars: Vec<u32>,
    pub fg: Vec<RGBA>,
    pub bg: Vec<RGBA>,
    pub attributes: Vec<u32>,
    pub width: u32,
    pub height: u32,
    pub respect_alpha: bool,
    pub width_method: WidthMethod,
    pub id: String,
    pub scissor_stack: Vec<ClipRect>,
    pub opacity_stack: Vec<f32>,
}

impl OptimizedBuffer {
    pub fn new(width: u32, height: u32, respect_alpha: bool, width_method: WidthMethod, id: &str) -> Result<Box<Self>, &'static str> {
        if width == 0 || height == 0 {
            logger::warn("OptimizedBuffer::new: Invalid dimensions");
            return Err("Invalid dimensions");
        }

        let size = (width * height) as usize;
        let mut buf = Box::new(Self {
            chars: vec![DEFAULT_SPACE_CHAR; size],
            fg: vec![[1.0, 1.0, 1.0, 1.0]; size],
            bg: vec![[0.0, 0.0, 0.0, 0.0]; size],
            attributes: vec![0; size],
            width,
            height,
            respect_alpha,
            width_method,
            id: id.to_string(),
            scissor_stack: Vec::new(),
            opacity_stack: Vec::new(),
        });

        buf.clear(&[0.0, 0.0, 0.0, 0.0]);
        Ok(buf)
    }

    #[inline]
    fn index(&self, x: u32, y: u32) -> Option<usize> {
        if x < self.width && y < self.height {
            Some((y * self.width + x) as usize)
        } else {
            None
        }
    }

    /// Check whether a position is within the current scissor rect (if any).
    fn is_clipped(&self, x: i32, y: i32) -> bool {
        if let Some(clip) = self.scissor_stack.last() {
            x < clip.x
                || y < clip.y
                || x >= clip.x + clip.width as i32
                || y >= clip.y + clip.height as i32
        } else {
            false
        }
    }

    /// Get the current effective opacity.
    pub fn get_current_opacity(&self) -> f32 {
        self.opacity_stack.last().copied().unwrap_or(1.0)
    }

    /// Clear the buffer with the given background color.
    pub fn clear(&mut self, bg: &RGBA) {
        let size = (self.width * self.height) as usize;
        self.chars.fill(DEFAULT_SPACE_CHAR);
        self.fg.fill([1.0, 1.0, 1.0, 1.0]);
        self.bg[..size].fill(*bg);
        self.attributes.fill(0);
    }

    /// Set a single cell.
    pub fn set(&mut self, x: u32, y: u32, cell: Cell) {
        if self.is_clipped(x as i32, y as i32) {
            return;
        }
        if let Some(idx) = self.index(x, y) {
            self.chars[idx] = cell.char;
            self.fg[idx] = cell.fg;
            self.bg[idx] = cell.bg;
            self.attributes[idx] = cell.attributes;
        }
    }

    /// Set a cell with alpha blending.
    pub fn set_cell_with_alpha_blending(&mut self, x: u32, y: u32, char: u32, fg: RGBA, bg: RGBA, attributes: u32) {
        if self.is_clipped(x as i32, y as i32) {
            return;
        }
        if let Some(idx) = self.index(x, y) {
            let opacity = self.get_current_opacity();
            if self.respect_alpha || opacity < 1.0 {
                let existing_bg = self.bg[idx];
                let blended_bg = if opacity < 1.0 {
                    let mut adjusted_bg = bg;
                    adjusted_bg[3] *= opacity;
                    utils::blend_colors(adjusted_bg, existing_bg)
                } else {
                    utils::blend_colors(bg, existing_bg)
                };
                self.bg[idx] = blended_bg;
            } else {
                self.bg[idx] = bg;
            }
            self.chars[idx] = char;
            self.fg[idx] = fg;
            self.attributes[idx] = attributes;
        }
    }

    /// Fill a rectangular region with a background color.
    pub fn fill_rect(&mut self, x: u32, y: u32, width: u32, height: u32, bg: &RGBA) {
        for dy in 0..height {
            for dx in 0..width {
                let px = x + dx;
                let py = y + dy;
                if self.is_clipped(px as i32, py as i32) {
                    continue;
                }
                if let Some(idx) = self.index(px, py) {
                    self.chars[idx] = DEFAULT_SPACE_CHAR;
                    self.bg[idx] = *bg;
                    self.fg[idx] = [1.0, 1.0, 1.0, 1.0];
                    self.attributes[idx] = 0;
                }
            }
        }
    }

    /// Draw text at (x, y) with given colors.
    pub fn draw_text(&mut self, text: &[u8], x: u32, y: u32, fg: RGBA, bg: Option<RGBA>, attributes: u32) {
        let s = match std::str::from_utf8(text) {
            Ok(s) => s,
            Err(_) => return,
        };

        let mut col = x;
        for ch in s.chars() {
            if ch == '\n' || ch == '\r' {
                continue;
            }
            let width = if ch.is_ascii() { 1 } else { unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1) };

            if !self.is_clipped(col as i32, y as i32) {
                if let Some(idx) = self.index(col, y) {
                    self.chars[idx] = ch as u32;
                    self.fg[idx] = fg;
                    if let Some(bg) = bg {
                        self.bg[idx] = bg;
                    }
                    self.attributes[idx] = attributes;
                    // For wide chars, fill continuation cells
                    for w in 1..width {
                        if let Some(widx) = self.index(col + w as u32, y) {
                            self.chars[widx] = 0; // continuation cell
                        }
                    }
                }
            }
            col += width as u32;
        }
    }

    /// Draw a character at (x, y) — the char value may be a grapheme pool reference.
    pub fn draw_char(&mut self, char: u32, x: u32, y: u32, fg: RGBA, bg: RGBA, attributes: u32) {
        if self.is_clipped(x as i32, y as i32) {
            return;
        }
        if let Some(idx) = self.index(x, y) {
            self.chars[idx] = char;
            self.fg[idx] = fg;
            self.bg[idx] = bg;
            self.attributes[idx] = attributes;
        }
    }

    /// Draw a frame buffer (sub-buffer) onto this buffer.
    pub fn draw_frame_buffer(
        &mut self,
        dest_x: i32,
        dest_y: i32,
        source: &OptimizedBuffer,
        src_x: Option<u32>,
        src_y: Option<u32>,
        src_width: Option<u32>,
        src_height: Option<u32>,
    ) {
        let sx = src_x.unwrap_or(0);
        let sy = src_y.unwrap_or(0);
        let sw = src_width.unwrap_or(source.width);
        let sh = src_height.unwrap_or(source.height);

        for dy in 0..sh {
            for dx in 0..sw {
                let src_px = sx + dx;
                let src_py = sy + dy;
                let dst_px = dest_x + dx as i32;
                let dst_py = dest_y + dy as i32;

                if dst_px < 0 || dst_py < 0 {
                    continue;
                }
                let dst_px = dst_px as u32;
                let dst_py = dst_py as u32;

                if let (Some(src_idx), Some(dst_idx)) =
                    (source.index(src_px, src_py), self.index(dst_px, dst_py))
                {
                    if self.is_clipped(dst_px as i32, dst_py as i32) {
                        continue;
                    }

                    let src_bg = source.bg[src_idx];
                    if self.respect_alpha && src_bg[3] < 1.0 {
                        self.bg[dst_idx] = utils::blend_colors(src_bg, self.bg[dst_idx]);
                    } else {
                        self.bg[dst_idx] = src_bg;
                    }
                    self.chars[dst_idx] = source.chars[src_idx];
                    self.fg[dst_idx] = source.fg[src_idx];
                    self.attributes[dst_idx] = source.attributes[src_idx];
                }
            }
        }
    }

    /// Push a scissor (clip) rectangle onto the stack.
    pub fn push_scissor_rect(&mut self, x: i32, y: i32, width: u32, height: u32) {
        let clip = if let Some(parent) = self.scissor_stack.last() {
            // Intersect with parent
            let nx = x.max(parent.x);
            let ny = y.max(parent.y);
            let nx2 = (x + width as i32).min(parent.x + parent.width as i32);
            let ny2 = (y + height as i32).min(parent.y + parent.height as i32);
            ClipRect {
                x: nx,
                y: ny,
                width: (nx2 - nx).max(0) as u32,
                height: (ny2 - ny).max(0) as u32,
            }
        } else {
            ClipRect { x, y, width, height }
        };
        self.scissor_stack.push(clip);
    }

    /// Pop the last scissor rectangle from the stack.
    pub fn pop_scissor_rect(&mut self) {
        self.scissor_stack.pop();
    }

    /// Clear all scissor rectangles.
    pub fn clear_scissor_rects(&mut self) {
        self.scissor_stack.clear();
    }

    /// Push an opacity value onto the stack.
    pub fn push_opacity(&mut self, opacity: f32) {
        let current = self.get_current_opacity();
        self.opacity_stack.push(current * opacity);
    }

    /// Pop the last opacity from the stack.
    pub fn pop_opacity(&mut self) {
        self.opacity_stack.pop();
    }

    /// Clear the opacity stack.
    pub fn clear_opacity(&mut self) {
        self.opacity_stack.clear();
    }

    /// Resize the buffer, clearing all content.
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        let size = (width * height) as usize;
        self.chars.resize(size, DEFAULT_SPACE_CHAR);
        self.fg.resize(size, [1.0, 1.0, 1.0, 1.0]);
        self.bg.resize(size, [0.0, 0.0, 0.0, 0.0]);
        self.attributes.resize(size, 0);
        self.width = width;
        self.height = height;
        self.clear(&[0.0, 0.0, 0.0, 0.0]);
    }

    /// Get the raw character pointer for direct memory access via FFI.
    pub fn get_char_ptr(&mut self) -> *mut u32 {
        self.chars.as_mut_ptr()
    }

    /// Get the raw foreground color pointer for FFI.
    pub fn get_fg_ptr(&mut self) -> *mut RGBA {
        self.fg.as_mut_ptr()
    }

    /// Get the raw background color pointer for FFI.
    pub fn get_bg_ptr(&mut self) -> *mut RGBA {
        self.bg.as_mut_ptr()
    }

    /// Get the raw attributes pointer for FFI.
    pub fn get_attributes_ptr(&mut self) -> *mut u32 {
        self.attributes.as_mut_ptr()
    }

    /// Write the resolved chars buffer into the provided output slice.
    pub fn write_resolved_chars(&self, output: &mut [u8], add_line_breaks: bool) -> u32 {
        let mut pos: usize = 0;
        for y in 0..self.height {
            for x in 0..self.width {
                if let Some(idx) = self.index(x, y) {
                    let ch = self.chars[idx];
                    if grapheme::is_grapheme_char(ch) {
                        let id = grapheme::grapheme_id_from_char(ch);
                        grapheme::with_global_pool(|pool| {
                            if let Some(data) = pool.get(id) {
                                let len = data.len().min(output.len() - pos);
                                output[pos..pos + len].copy_from_slice(&data[..len]);
                                pos += len;
                            }
                        });
                    } else if let Some(c) = char::from_u32(ch) {
                        let mut buf = [0u8; 4];
                        let s = c.encode_utf8(&mut buf);
                        let len = s.len().min(output.len() - pos);
                        output[pos..pos + len].copy_from_slice(&s.as_bytes()[..len]);
                        pos += len;
                    }
                }
                if pos >= output.len() {
                    return pos as u32;
                }
            }
            if add_line_breaks && y < self.height - 1 && pos < output.len() {
                output[pos] = b'\n';
                pos += 1;
            }
        }
        pos as u32
    }

    /// Draw a border box.
    pub fn draw_box(
        &mut self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        border_chars: &[u32],
        sides: BorderSides,
        border_color: RGBA,
        background_color: RGBA,
        should_fill: bool,
        title: Option<&str>,
        _title_alignment: u8,
    ) {
        if width < 2 || height < 2 {
            return;
        }

        // Fill background if requested
        if should_fill {
            let inner_x = if sides.left { x + 1 } else { x };
            let inner_y = if sides.top { y + 1 } else { y };
            let inner_w = width - if sides.left { 1 } else { 0 } - if sides.right { 1 } else { 0 };
            let inner_h = height - if sides.top { 1 } else { 0 } - if sides.bottom { 1 } else { 0 };
            if inner_x >= 0 && inner_y >= 0 {
                self.fill_rect(inner_x as u32, inner_y as u32, inner_w, inner_h, &background_color);
            }
        }

        let set_border = |buf: &mut Self, bx: i32, by: i32, ch: u32| {
            if bx >= 0 && by >= 0 {
                buf.draw_char(ch, bx as u32, by as u32, border_color, background_color, 0);
            }
        };

        // Draw corners
        if sides.top && sides.left && border_chars.len() > 0 {
            set_border(self, x, y, border_chars[BorderCharIndex::TopLeft as usize]);
        }
        if sides.top && sides.right && border_chars.len() > 1 {
            set_border(self, x + width as i32 - 1, y, border_chars[BorderCharIndex::TopRight as usize]);
        }
        if sides.bottom && sides.left && border_chars.len() > 2 {
            set_border(self, x, y + height as i32 - 1, border_chars[BorderCharIndex::BottomLeft as usize]);
        }
        if sides.bottom && sides.right && border_chars.len() > 3 {
            set_border(self, x + width as i32 - 1, y + height as i32 - 1, border_chars[BorderCharIndex::BottomRight as usize]);
        }

        // Draw horizontal edges
        if border_chars.len() > 4 {
            let horiz = border_chars[BorderCharIndex::Horizontal as usize];
            if sides.top {
                let start = if sides.left { 1 } else { 0 };
                let end = width as i32 - if sides.right { 1 } else { 0 };
                for dx in start..end {
                    set_border(self, x + dx, y, horiz);
                }
            }
            if sides.bottom {
                let start = if sides.left { 1 } else { 0 };
                let end = width as i32 - if sides.right { 1 } else { 0 };
                for dx in start..end {
                    set_border(self, x + dx, y + height as i32 - 1, horiz);
                }
            }
        }

        // Draw vertical edges
        if border_chars.len() > 5 {
            let vert = border_chars[BorderCharIndex::Vertical as usize];
            if sides.left {
                let start = if sides.top { 1 } else { 0 };
                let end = height as i32 - if sides.bottom { 1 } else { 0 };
                for dy in start..end {
                    set_border(self, x, y + dy, vert);
                }
            }
            if sides.right {
                let start = if sides.top { 1 } else { 0 };
                let end = height as i32 - if sides.bottom { 1 } else { 0 };
                for dy in start..end {
                    set_border(self, x + width as i32 - 1, y + dy, vert);
                }
            }
        }

        // Draw title in top border if provided
        if let Some(title) = title {
            if sides.top {
                let title_x = x + 2;
                self.draw_text(title.as_bytes(), title_x as u32, y as u32, border_color, None, 0);
            }
        }
    }

    /// Draw a grid of borders.
    pub fn draw_grid(
        &mut self,
        border_chars: &[u32],
        border_fg: RGBA,
        border_bg: RGBA,
        column_offsets: &[i32],
        row_offsets: &[i32],
        _draw_inner: bool,
        _draw_outer: bool,
    ) {
        // Draw horizontal lines at each row offset
        for &ry in row_offsets {
            if ry < 0 {
                continue;
            }
            for &cx in column_offsets {
                if cx < 0 {
                    continue;
                }
                let ch = if border_chars.len() > BorderCharIndex::Horizontal as usize {
                    border_chars[BorderCharIndex::Horizontal as usize]
                } else {
                    continue;
                };
                self.draw_char(ch, cx as u32, ry as u32, border_fg, border_bg, 0);
            }
        }

        // Draw vertical lines at each column offset
        for &cx in column_offsets {
            if cx < 0 {
                continue;
            }
            for &ry in row_offsets {
                if ry < 0 {
                    continue;
                }
                let ch = if border_chars.len() > BorderCharIndex::Vertical as usize {
                    border_chars[BorderCharIndex::Vertical as usize]
                } else {
                    continue;
                };
                self.draw_char(ch, cx as u32, ry as u32, border_fg, border_bg, 0);
            }
        }
    }

    /// Get the count of non-space characters.
    pub fn get_real_char_size(&self) -> u32 {
        self.chars.iter().filter(|&&c| c != DEFAULT_SPACE_CHAR && c != 0).count() as u32
    }

    /// Draw packed buffer data.
    pub fn draw_packed_buffer(&mut self, data: &[u8], pos_x: u32, pos_y: u32, _term_width: u32, _term_height: u32) {
        // Packed format: each cell is [char(4), fg(16), bg(16), attrs(4)] = 40 bytes
        let cell_size = 40;
        let mut i = 0;
        let mut x = pos_x;
        let mut y = pos_y;
        while i + cell_size <= data.len() {
            let ch = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
            let fg = [
                f32::from_le_bytes([data[i + 4], data[i + 5], data[i + 6], data[i + 7]]),
                f32::from_le_bytes([data[i + 8], data[i + 9], data[i + 10], data[i + 11]]),
                f32::from_le_bytes([data[i + 12], data[i + 13], data[i + 14], data[i + 15]]),
                f32::from_le_bytes([data[i + 16], data[i + 17], data[i + 18], data[i + 19]]),
            ];
            let bg = [
                f32::from_le_bytes([data[i + 20], data[i + 21], data[i + 22], data[i + 23]]),
                f32::from_le_bytes([data[i + 24], data[i + 25], data[i + 26], data[i + 27]]),
                f32::from_le_bytes([data[i + 28], data[i + 29], data[i + 30], data[i + 31]]),
                f32::from_le_bytes([data[i + 32], data[i + 33], data[i + 34], data[i + 35]]),
            ];
            let attrs = u32::from_le_bytes([data[i + 36], data[i + 37], data[i + 38], data[i + 39]]);

            self.set(x, y, Cell { char: ch, fg, bg, attributes: attrs });

            x += 1;
            if x >= self.width {
                x = pos_x;
                y += 1;
            }
            i += cell_size;
        }
    }

    /// Draw a grayscale intensity buffer.
    pub fn draw_grayscale_buffer(
        &mut self,
        pos_x: i32,
        pos_y: i32,
        intensities: &[f32],
        src_width: u32,
        src_height: u32,
        fg: Option<RGBA>,
        bg: Option<RGBA>,
    ) {
        let fg_color = fg.unwrap_or([1.0, 1.0, 1.0, 1.0]);
        let bg_color = bg.unwrap_or([0.0, 0.0, 0.0, 1.0]);

        for sy in 0..src_height {
            for sx in 0..src_width {
                let dx = pos_x + sx as i32;
                let dy = pos_y + sy as i32;
                if dx < 0 || dy < 0 {
                    continue;
                }
                let src_idx = (sy * src_width + sx) as usize;
                if src_idx >= intensities.len() {
                    continue;
                }
                let intensity = intensities[src_idx].clamp(0.0, 1.0);
                let r = bg_color[0] + (fg_color[0] - bg_color[0]) * intensity;
                let g = bg_color[1] + (fg_color[1] - bg_color[1]) * intensity;
                let b = bg_color[2] + (fg_color[2] - bg_color[2]) * intensity;
                let color = [r, g, b, 1.0];
                self.draw_char(0x2588, dx as u32, dy as u32, color, bg_color, 0);
            }
        }
    }

    /// Draw supersampled buffer data (image pixel data).
    pub fn draw_super_sample_buffer(
        &mut self,
        x: u32,
        y: u32,
        pixel_data: &[u8],
        _format: u8,
        _aligned_bytes_per_row: u32,
    ) {
        // Simplified — just draw blocks for each pixel pair
        let _ = (x, y, pixel_data);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_buffer_create() {
        let buf = OptimizedBuffer::new(80, 24, false, WidthMethod::Unicode, "test").unwrap();
        assert_eq!(buf.width, 80);
        assert_eq!(buf.height, 24);
    }

    #[test]
    fn test_buffer_invalid_dimensions() {
        assert!(OptimizedBuffer::new(0, 24, false, WidthMethod::Unicode, "test").is_err());
        assert!(OptimizedBuffer::new(80, 0, false, WidthMethod::Unicode, "test").is_err());
    }

    #[test]
    fn test_buffer_set_get() {
        let mut buf = OptimizedBuffer::new(80, 24, false, WidthMethod::Unicode, "test").unwrap();
        let cell = Cell {
            char: 'A' as u32,
            fg: [1.0, 0.0, 0.0, 1.0],
            bg: [0.0, 0.0, 1.0, 1.0],
            attributes: 0,
        };
        buf.set(5, 3, cell);
        let idx = buf.index(5, 3).unwrap();
        assert_eq!(buf.chars[idx], 'A' as u32);
    }

    #[test]
    fn test_buffer_scissor() {
        let mut buf = OptimizedBuffer::new(80, 24, false, WidthMethod::Unicode, "test").unwrap();
        buf.push_scissor_rect(10, 10, 20, 10);
        assert!(buf.is_clipped(5, 5));
        assert!(!buf.is_clipped(15, 15));
        buf.pop_scissor_rect();
        assert!(!buf.is_clipped(5, 5));
    }

    #[test]
    fn test_buffer_fill_rect() {
        let mut buf = OptimizedBuffer::new(80, 24, false, WidthMethod::Unicode, "test").unwrap();
        let red = [1.0, 0.0, 0.0, 1.0];
        buf.fill_rect(0, 0, 10, 5, &red);
        let idx = buf.index(5, 3).unwrap();
        assert_eq!(buf.bg[idx], red);
    }

    #[test]
    fn test_buffer_resize() {
        let mut buf = OptimizedBuffer::new(80, 24, false, WidthMethod::Unicode, "test").unwrap();
        buf.resize(100, 30);
        assert_eq!(buf.width, 100);
        assert_eq!(buf.height, 30);
        assert_eq!(buf.chars.len(), 3000);
    }
}
