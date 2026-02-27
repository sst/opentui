use crate::ansi;
use crate::ansi::{RGBA, ANSI};
use crate::buffer::{ClipRect, OptimizedBuffer};
use crate::grapheme;
use crate::terminal::{ClipboardTarget, MousePointerStyle, Terminal, Options as TerminalOptions};
use crate::utf8::WidthMethod;

use std::io::Write;

const OUTPUT_BUFFER_SIZE: usize = 1024 * 1024 * 2; // 2MB

/// Debug overlay corner position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DebugOverlayCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Render statistics.
#[derive(Debug, Clone, Default)]
pub struct RenderStats {
    pub last_frame_time: f64,
    pub average_frame_time: f64,
    pub frame_count: u64,
    pub fps: u32,
    pub cells_updated: u32,
    pub render_time: Option<f64>,
    pub overall_frame_time: Option<f64>,
    pub buffer_reset_time: Option<f64>,
    pub stdout_write_time: Option<f64>,
    pub heap_used: u32,
    pub heap_total: u32,
    pub array_buffers: u32,
    pub frame_callback_time: Option<f64>,
}

/// The main terminal renderer.
///
/// Manages double-buffered rendering, hit grids for mouse event dispatch,
/// and terminal state.
pub struct CliRenderer {
    pub width: u32,
    pub height: u32,
    current_buffer: Box<OptimizedBuffer>,
    next_buffer: Box<OptimizedBuffer>,
    pub terminal: Terminal,
    pub background_color: RGBA,
    pub render_offset: u32,
    pub testing: bool,
    pub use_alternate_screen: bool,
    pub terminal_setup: bool,

    render_stats: RenderStats,
    _last_render_time: i64,

    // Hit grid for mouse event dispatch
    current_hit_grid: Vec<u32>,
    next_hit_grid: Vec<u32>,
    hit_grid_width: u32,
    hit_grid_height: u32,
    hit_scissor_stack: Vec<ClipRect>,
    hit_grid_dirty: bool,

    // Output buffer
    output_buffer: Vec<u8>,
    last_output: Vec<u8>,

    use_thread: bool,

    _last_cursor_style_tag: Option<u8>,
    _last_cursor_blinking: Option<bool>,
    _last_cursor_color_rgb: Option<[u8; 3]>,
    _last_mouse_pointer_style: MousePointerStyle,

    debug_overlay_enabled: bool,
    debug_overlay_corner: DebugOverlayCorner,
}

impl CliRenderer {
    pub fn new(width: u32, height: u32, testing: bool, remote: bool) -> Result<Box<Self>, &'static str> {
        let current_buffer =
            OptimizedBuffer::new(width, height, false, WidthMethod::Unicode, "current buffer")?;
        let next_buffer =
            OptimizedBuffer::new(width, height, false, WidthMethod::Unicode, "next buffer")?;

        let grid_size = (width * height) as usize;

        Ok(Box::new(Self {
            width,
            height,
            current_buffer,
            next_buffer,
            terminal: Terminal::new(TerminalOptions {
                remote,
                ..Default::default()
            }),
            background_color: [0.0, 0.0, 0.0, 1.0],
            render_offset: 0,
            testing,
            use_alternate_screen: true,
            terminal_setup: false,
            render_stats: RenderStats::default(),
            _last_render_time: 0,
            current_hit_grid: vec![0; grid_size],
            next_hit_grid: vec![0; grid_size],
            hit_grid_width: width,
            hit_grid_height: height,
            hit_scissor_stack: Vec::new(),
            hit_grid_dirty: false,
            output_buffer: Vec::with_capacity(OUTPUT_BUFFER_SIZE),
            last_output: Vec::new(),
            use_thread: false,
            _last_cursor_style_tag: None,
            _last_cursor_blinking: None,
            _last_cursor_color_rgb: None,
            _last_mouse_pointer_style: MousePointerStyle::Default,
            debug_overlay_enabled: false,
            debug_overlay_corner: DebugOverlayCorner::BottomRight,
        }))
    }

    pub fn set_background_color(&mut self, color: RGBA) {
        self.background_color = color;
    }

    pub fn set_render_offset(&mut self, offset: u32) {
        self.render_offset = offset;
    }

    pub fn set_use_thread(&mut self, use_thread: bool) {
        self.use_thread = use_thread;
    }

    pub fn set_terminal_env_var(&mut self, key: &str, value: &str) -> bool {
        self.terminal.set_host_env_var(key, value);
        true
    }

    pub fn get_next_buffer(&mut self) -> &mut OptimizedBuffer {
        &mut self.next_buffer
    }

    pub fn get_current_buffer(&mut self) -> &mut OptimizedBuffer {
        &mut self.current_buffer
    }

    pub fn get_terminal_capabilities(&self) -> &crate::terminal::Capabilities {
        &self.terminal.caps
    }

    pub fn process_capability_response(&mut self, response: &str) {
        self.terminal.process_capability_response(response);
    }

    pub fn get_last_output_for_test(&self) -> &[u8] {
        &self.last_output
    }

    pub fn set_debug_overlay(&mut self, enabled: bool, corner: DebugOverlayCorner) {
        self.debug_overlay_enabled = enabled;
        self.debug_overlay_corner = corner;
    }

    pub fn update_stats(&mut self, time: f64, fps: u32, frame_callback_time: f64) {
        self.render_stats.last_frame_time = time;
        self.render_stats.fps = fps;
        self.render_stats.frame_callback_time = Some(frame_callback_time);
        self.render_stats.frame_count += 1;
    }

    pub fn update_memory_stats(&mut self, heap_used: u32, heap_total: u32, array_buffers: u32) {
        self.render_stats.heap_used = heap_used;
        self.render_stats.heap_total = heap_total;
        self.render_stats.array_buffers = array_buffers;
    }

    /// Render: diff current and next buffers, generate ANSI output.
    pub fn render(&mut self, force: bool) {
        self.output_buffer.clear();
        let mut cells_updated: u32 = 0;

        let w = self.width;
        let h = self.height;

        // Synchronized rendering start
        self.output_buffer.extend_from_slice(b"\x1b[?2026h");

        for y in 0..h {
            for x in 0..w {
                let idx = (y * w + x) as usize;
                let next_char = self.next_buffer.chars[idx];
                let next_fg = self.next_buffer.fg[idx];
                let next_bg = self.next_buffer.bg[idx];
                let next_attrs = self.next_buffer.attributes[idx];

                let changed = force
                    || self.current_buffer.chars[idx] != next_char
                    || self.current_buffer.fg[idx] != next_fg
                    || self.current_buffer.bg[idx] != next_bg
                    || self.current_buffer.attributes[idx] != next_attrs;

                if !changed {
                    continue;
                }

                cells_updated += 1;

                // Move cursor
                let _ = write!(
                    self.output_buffer,
                    "\x1b[{};{}H",
                    y + 1 + self.render_offset,
                    x + 1
                );

                // Set background color
                let bg_r = ansi::rgba_component_to_u8(next_bg[0]);
                let bg_g = ansi::rgba_component_to_u8(next_bg[1]);
                let bg_b = ansi::rgba_component_to_u8(next_bg[2]);
                let _ = write!(self.output_buffer, "\x1b[48;2;{};{};{}m", bg_r, bg_g, bg_b);

                // Set foreground color
                let fg_r = ansi::rgba_component_to_u8(next_fg[0]);
                let fg_g = ansi::rgba_component_to_u8(next_fg[1]);
                let fg_b = ansi::rgba_component_to_u8(next_fg[2]);
                let _ = write!(self.output_buffer, "\x1b[38;2;{};{};{}m", fg_r, fg_g, fg_b);

                // Write the character
                if grapheme::is_grapheme_char(next_char) {
                    let id = grapheme::grapheme_id_from_char(next_char);
                    grapheme::with_global_pool(|pool| {
                        if let Some(data) = pool.get(id) {
                            self.output_buffer.extend_from_slice(data);
                        }
                    });
                } else if next_char == 0 {
                    // Continuation cell — skip
                } else if let Some(c) = char::from_u32(next_char) {
                    let mut buf = [0u8; 4];
                    let s = c.encode_utf8(&mut buf);
                    self.output_buffer.extend_from_slice(s.as_bytes());
                } else {
                    self.output_buffer.push(b' ');
                }

                // Update current buffer
                self.current_buffer.chars[idx] = next_char;
                self.current_buffer.fg[idx] = next_fg;
                self.current_buffer.bg[idx] = next_bg;
                self.current_buffer.attributes[idx] = next_attrs;
            }
        }

        // Synchronized rendering end
        self.output_buffer.extend_from_slice(b"\x1b[?2026l");

        // Cursor
        let cursor = &self.terminal.state.cursor;
        if cursor.visible {
            let _ = write!(
                self.output_buffer,
                "\x1b[{};{}H",
                cursor.y, cursor.x
            );
            self.output_buffer
                .extend_from_slice(ANSI::SHOW_CURSOR.as_bytes());
        } else {
            self.output_buffer
                .extend_from_slice(ANSI::HIDE_CURSOR.as_bytes());
        }

        self.render_stats.cells_updated = cells_updated;
        self.last_output = self.output_buffer.clone();

        // Swap hit grids
        std::mem::swap(&mut self.current_hit_grid, &mut self.next_hit_grid);
        self.next_hit_grid.fill(0);
        self.hit_grid_dirty = false;

        // Write to stdout (unless testing)
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(&self.output_buffer);
            let _ = handle.flush();
        }
    }

    /// Resize the renderer and its buffers.
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.width = width;
        self.height = height;
        self.current_buffer.resize(width, height);
        self.next_buffer.resize(width, height);

        let grid_size = (width * height) as usize;
        self.current_hit_grid.resize(grid_size, 0);
        self.next_hit_grid.resize(grid_size, 0);
        self.hit_grid_width = width;
        self.hit_grid_height = height;
    }

    // --- Hit grid ---

    pub fn add_to_hit_grid(&mut self, x: i32, y: i32, width: u32, height: u32, id: u32) {
        for dy in 0..height {
            for dx in 0..width {
                let px = x + dx as i32;
                let py = y + dy as i32;
                if px >= 0 && py >= 0 && (px as u32) < self.hit_grid_width && (py as u32) < self.hit_grid_height {
                    let idx = (py as u32 * self.hit_grid_width + px as u32) as usize;
                    if idx < self.next_hit_grid.len() {
                        self.next_hit_grid[idx] = id;
                    }
                }
            }
        }
    }

    pub fn add_to_current_hit_grid_clipped(&mut self, x: i32, y: i32, width: u32, height: u32, id: u32) {
        for dy in 0..height {
            for dx in 0..width {
                let px = x + dx as i32;
                let py = y + dy as i32;
                if px >= 0 && py >= 0 && (px as u32) < self.hit_grid_width && (py as u32) < self.hit_grid_height {
                    // Check scissor
                    let clipped = self.hit_scissor_stack.last().map_or(false, |clip| {
                        px < clip.x || py < clip.y || px >= clip.x + clip.width as i32 || py >= clip.y + clip.height as i32
                    });
                    if !clipped {
                        let idx = (py as u32 * self.hit_grid_width + px as u32) as usize;
                        if idx < self.current_hit_grid.len() {
                            self.current_hit_grid[idx] = id;
                        }
                    }
                }
            }
        }
        self.hit_grid_dirty = true;
    }

    pub fn clear_current_hit_grid(&mut self) {
        self.current_hit_grid.fill(0);
    }

    pub fn check_hit(&self, x: u32, y: u32) -> u32 {
        if x < self.hit_grid_width && y < self.hit_grid_height {
            let idx = (y * self.hit_grid_width + x) as usize;
            self.current_hit_grid.get(idx).copied().unwrap_or(0)
        } else {
            0
        }
    }

    pub fn get_hit_grid_dirty(&self) -> bool {
        self.hit_grid_dirty
    }

    pub fn hit_grid_push_scissor_rect(&mut self, x: i32, y: i32, width: u32, height: u32) {
        self.hit_scissor_stack.push(ClipRect { x, y, width, height });
    }

    pub fn hit_grid_pop_scissor_rect(&mut self) {
        self.hit_scissor_stack.pop();
    }

    pub fn hit_grid_clear_scissor_rects(&mut self) {
        self.hit_scissor_stack.clear();
    }

    pub fn dump_hit_grid(&self) {
        // Debug: log hit grid contents
    }

    pub fn dump_buffers(&self, _timestamp: i64) {
        // Debug: dump buffer state
    }

    pub fn dump_stdout_buffer(&self, _timestamp: i64) {
        // Debug: dump stdout buffer
    }

    // --- Terminal control pass-throughs ---

    pub fn clear_terminal(&mut self) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(ANSI::CLEAR_AND_HOME.as_bytes());
            let _ = handle.flush();
        }
    }

    pub fn set_terminal_title(&mut self, title: &str) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = write!(handle, "\x1b]0;{}\x07", title);
            let _ = handle.flush();
        }
    }

    pub fn copy_to_clipboard_osc52(&self, target: ClipboardTarget, payload: &str) -> bool {
        if self.testing {
            return true;
        }
        let stdout = std::io::stdout();
        let mut handle = stdout.lock();
        let _ = write!(handle, "\x1b]52;{};{}\x07", target.to_char(), payload);
        let _ = handle.flush();
        true
    }

    pub fn clear_clipboard_osc52(&self, target: ClipboardTarget) -> bool {
        if self.testing {
            return true;
        }
        let stdout = std::io::stdout();
        let mut handle = stdout.lock();
        let _ = write!(handle, "\x1b]52;{};\x07", target.to_char());
        let _ = handle.flush();
        true
    }

    pub fn restore_terminal_modes(&mut self) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = self.terminal.reset(&mut handle);
        }
    }

    pub fn enable_mouse(&mut self, enable_movement: bool) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(ANSI::ENABLE_MOUSE_TRACKING.as_bytes());
            let _ = handle.write_all(ANSI::ENABLE_SGR_MOUSE_MODE.as_bytes());
            if enable_movement {
                let _ = handle.write_all(ANSI::ENABLE_ANY_EVENT_TRACKING.as_bytes());
            } else {
                let _ = handle.write_all(ANSI::ENABLE_BUTTON_EVENT_TRACKING.as_bytes());
            }
            let _ = handle.flush();
        }
        self.terminal.state.mouse = true;
    }

    pub fn disable_mouse(&mut self) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(ANSI::DISABLE_ANY_EVENT_TRACKING.as_bytes());
            let _ = handle.write_all(ANSI::DISABLE_SGR_MOUSE_MODE.as_bytes());
            let _ = handle.write_all(ANSI::DISABLE_MOUSE_TRACKING.as_bytes());
            let _ = handle.flush();
        }
        self.terminal.state.mouse = false;
    }

    pub fn query_pixel_resolution(&self) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(ANSI::QUERY_PIXEL_SIZE.as_bytes());
            let _ = handle.flush();
        }
    }

    pub fn enable_kitty_keyboard(&mut self, flags: u8) {
        self.terminal.state.kitty_keyboard = true;
        self.terminal.state.kitty_keyboard_flags = flags;
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = write!(handle, "\x1b[>{}u", flags);
            let _ = handle.flush();
        }
    }

    pub fn disable_kitty_keyboard(&mut self) {
        self.terminal.state.kitty_keyboard = false;
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(b"\x1b[<u");
            let _ = handle.flush();
        }
    }

    pub fn set_kitty_keyboard_flags(&mut self, flags: u8) {
        self.terminal.opts.kitty_keyboard_flags = flags;
    }

    pub fn get_kitty_keyboard_flags(&self) -> u8 {
        self.terminal.opts.kitty_keyboard_flags
    }

    pub fn setup_terminal(&mut self, use_alternate_screen: bool) {
        self.use_alternate_screen = use_alternate_screen;
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = self.terminal.setup(&mut handle, use_alternate_screen);
        }
        self.terminal_setup = true;
    }

    pub fn suspend_renderer(&mut self) {
        self.restore_terminal_modes();
    }

    pub fn resume_renderer(&mut self) {
        if self.terminal_setup {
            self.setup_terminal(self.use_alternate_screen);
        }
    }

    pub fn write_out(&mut self, data: &[u8]) {
        if !self.testing {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(data);
            let _ = handle.flush();
        }
    }
}
