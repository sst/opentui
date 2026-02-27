//! C ABI exports matching the original Zig `lib.zig` interface.
//!
//! Every `#[no_mangle] pub unsafe extern "C"` function here corresponds to an
//! `export fn` in Zig, keeping the symbol table identical so that the existing
//! TypeScript FFI bindings (`zig.ts`) work without modification.
//!
//! For Deno integration, load the compiled `.so` / `.dylib` / `.dll` with:
//!
//! ```ts
//! const lib = Deno.dlopen("libopentui.so", { /* symbol definitions */ });
//! ```

use crate::ansi::{TextAttributes, RGBA};
use crate::buffer::{BorderSides, Cell, OptimizedBuffer};
use crate::edit_buffer::EditBuffer;
use crate::editor_view::EditorView;
use crate::event_bus;
use crate::link;
use crate::logger;
use crate::renderer::{CliRenderer, DebugOverlayCorner};
use crate::syntax_style::SyntaxStyle;
use crate::terminal::{ClipboardTarget, CursorStyle};
use crate::text_buffer::{StyledChunk, TextBuffer, WrapMode};
use crate::text_buffer_view::{TextBufferView, Viewport};
use crate::utf8::WidthMethod;
use crate::utils;

use std::slice;

// ═══════════════════════════════════════════════════════════════════════════
//  Global callbacks
// ═══════════════════════════════════════════════════════════════════════════

type LogCallback = unsafe extern "C" fn(level: u8, msg_ptr: *const u8, msg_len: usize);
type EventCallback = unsafe extern "C" fn(
    name_ptr: *const u8,
    name_len: usize,
    data_ptr: *const u8,
    data_len: usize,
);

#[no_mangle]
pub unsafe extern "C" fn setLogCallback(callback: Option<LogCallback>) {
    logger::set_log_callback(callback);
}

#[no_mangle]
pub unsafe extern "C" fn setEventCallback(callback: Option<EventCallback>) {
    event_bus::set_event_callback(callback);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Build/allocator stats  (ABI-compatible extern structs)
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct ExternalBuildOptions {
    gpa_safe_stats: bool,
    gpa_memory_limit_tracking: bool,
}

#[repr(C)]
pub struct ExternalAllocatorStats {
    total_requested_bytes: u64,
    active_allocations: u64,
    small_allocations: u64,
    large_allocations: u64,
    requested_bytes_valid: bool,
}

#[no_mangle]
pub unsafe extern "C" fn getBuildOptions(out: *mut ExternalBuildOptions) {
    (*out).gpa_safe_stats = false;
    (*out).gpa_memory_limit_tracking = false;
}

#[no_mangle]
pub unsafe extern "C" fn getAllocatorStats(out: *mut ExternalAllocatorStats) {
    (*out).total_requested_bytes = 0;
    (*out).active_allocations = 0;
    (*out).small_allocations = 0;
    (*out).large_allocations = 0;
    (*out).requested_bytes_valid = false;
}

#[no_mangle]
pub unsafe extern "C" fn getArenaAllocatedBytes() -> usize {
    0
}

// ═══════════════════════════════════════════════════════════════════════════
//  Renderer
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createRenderer(
    width: u32,
    height: u32,
    testing: bool,
    remote: bool,
) -> *mut CliRenderer {
    if width == 0 || height == 0 {
        return std::ptr::null_mut();
    }
    match CliRenderer::new(width, height, testing, remote) {
        Ok(r) => Box::into_raw(r),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn destroyRenderer(ptr: *mut CliRenderer) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn setTerminalEnvVar(
    ptr: *mut CliRenderer,
    key_ptr: *const u8,
    key_len: usize,
    value_ptr: *const u8,
    value_len: usize,
) -> bool {
    let r = &mut *ptr;
    let key = std::str::from_utf8_unchecked(slice::from_raw_parts(key_ptr, key_len));
    let value = std::str::from_utf8_unchecked(slice::from_raw_parts(value_ptr, value_len));
    r.set_terminal_env_var(key, value)
}

#[no_mangle]
pub unsafe extern "C" fn setUseThread(ptr: *mut CliRenderer, use_thread: bool) {
    (*ptr).set_use_thread(use_thread);
}

#[no_mangle]
pub unsafe extern "C" fn setBackgroundColor(ptr: *mut CliRenderer, color: *const f32) {
    (*ptr).set_background_color(utils::f32_ptr_to_rgba(color));
}

#[no_mangle]
pub unsafe extern "C" fn setRenderOffset(ptr: *mut CliRenderer, offset: u32) {
    (*ptr).set_render_offset(offset);
}

#[no_mangle]
pub unsafe extern "C" fn updateStats(ptr: *mut CliRenderer, time: f64, fps: u32, frame_callback_time: f64) {
    (*ptr).update_stats(time, fps, frame_callback_time);
}

#[no_mangle]
pub unsafe extern "C" fn updateMemoryStats(ptr: *mut CliRenderer, heap_used: u32, heap_total: u32, array_buffers: u32) {
    (*ptr).update_memory_stats(heap_used, heap_total, array_buffers);
}

#[no_mangle]
pub unsafe extern "C" fn getNextBuffer(ptr: *mut CliRenderer) -> *mut OptimizedBuffer {
    (*ptr).get_next_buffer() as *mut _
}

#[no_mangle]
pub unsafe extern "C" fn getCurrentBuffer(ptr: *mut CliRenderer) -> *mut OptimizedBuffer {
    (*ptr).get_current_buffer() as *mut _
}

#[repr(C)]
pub struct OutputSlice {
    ptr: *const u8,
    len: usize,
}

#[no_mangle]
pub unsafe extern "C" fn getLastOutputForTest(ptr: *mut CliRenderer, out: *mut OutputSlice) {
    let output = (*ptr).get_last_output_for_test();
    (*out).ptr = output.as_ptr();
    (*out).len = output.len();
}

#[no_mangle]
pub unsafe extern "C" fn setHyperlinksCapability(ptr: *mut CliRenderer, enabled: bool) {
    (*ptr).terminal.caps.hyperlinks = enabled;
}

#[no_mangle]
pub unsafe extern "C" fn clearGlobalLinkPool() {
    link::deinit_global_link_pool();
}

#[no_mangle]
pub unsafe extern "C" fn render(ptr: *mut CliRenderer, force: bool) {
    (*ptr).render(force);
}

#[no_mangle]
pub unsafe extern "C" fn resizeRenderer(ptr: *mut CliRenderer, width: u32, height: u32) {
    (*ptr).resize(width, height);
}

#[no_mangle]
pub unsafe extern "C" fn setCursorPosition(ptr: *mut CliRenderer, x: i32, y: i32, visible: bool) {
    (*ptr).terminal.set_cursor_position(x.max(1) as u32, y.max(1) as u32, visible);
}

#[no_mangle]
pub unsafe extern "C" fn setCursorColor(ptr: *mut CliRenderer, color: *const f32) {
    (*ptr).terminal.set_cursor_color(utils::f32_ptr_to_rgba(color));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Terminal capabilities
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct ExternalCapabilities {
    kitty_keyboard: bool,
    kitty_graphics: bool,
    rgb: bool,
    unicode: u8,
    sgr_pixels: bool,
    color_scheme_updates: bool,
    explicit_width: bool,
    scaled_text: bool,
    sixel: bool,
    focus_tracking: bool,
    sync: bool,
    bracketed_paste: bool,
    hyperlinks: bool,
    osc52: bool,
    explicit_cursor_positioning: bool,
    term_name_ptr: *const u8,
    term_name_len: usize,
    term_version_ptr: *const u8,
    term_version_len: usize,
    term_from_xtversion: bool,
}

#[no_mangle]
pub unsafe extern "C" fn getTerminalCapabilities(ptr: *mut CliRenderer, caps_out: *mut ExternalCapabilities) {
    let r = &*ptr;
    let caps = r.get_terminal_capabilities();
    let ti = &r.terminal.term_info;
    (*caps_out) = ExternalCapabilities {
        kitty_keyboard: caps.kitty_keyboard,
        kitty_graphics: caps.kitty_graphics,
        rgb: caps.rgb,
        unicode: if caps.unicode == WidthMethod::Wcwidth { 0 } else { 1 },
        sgr_pixels: caps.sgr_pixels,
        color_scheme_updates: caps.color_scheme_updates,
        explicit_width: caps.explicit_width,
        scaled_text: caps.scaled_text,
        sixel: caps.sixel,
        focus_tracking: caps.focus_tracking,
        sync: caps.sync,
        bracketed_paste: caps.bracketed_paste,
        hyperlinks: caps.hyperlinks,
        osc52: caps.osc52,
        explicit_cursor_positioning: caps.explicit_cursor_positioning,
        term_name_ptr: ti.name.as_ptr(),
        term_name_len: ti.name.len(),
        term_version_ptr: ti.version.as_ptr(),
        term_version_len: ti.version.len(),
        term_from_xtversion: ti.from_xtversion,
    };
}

#[no_mangle]
pub unsafe extern "C" fn processCapabilityResponse(ptr: *mut CliRenderer, response_ptr: *const u8, response_len: usize) {
    let response = std::str::from_utf8_unchecked(slice::from_raw_parts(response_ptr, response_len));
    (*ptr).process_capability_response(response);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Cursor style options
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct CursorStyleOptions {
    style: u8,
    blinking: u8,
    color: *const f32,
    cursor: u8,
}

#[no_mangle]
pub unsafe extern "C" fn setCursorStyleOptions(ptr: *mut CliRenderer, options: *const CursorStyleOptions) {
    let opts = &*options;
    let r = &mut *ptr;
    if opts.style <= 2 {
        r.terminal.set_cursor_style(CursorStyle::from_u8(opts.style), opts.blinking == 1);
    }
    if !opts.color.is_null() {
        r.terminal.set_cursor_color(utils::f32_ptr_to_rgba(opts.color));
    }
    if opts.cursor <= 5 {
        r.terminal.set_mouse_pointer_style(crate::terminal::MousePointerStyle::from_u8(opts.cursor));
    }
}

#[repr(C)]
pub struct ExternalCursorState {
    x: u32,
    y: u32,
    visible: bool,
    style: u8,
    blinking: bool,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
}

#[no_mangle]
pub unsafe extern "C" fn getCursorState(ptr: *mut CliRenderer, out: *mut ExternalCursorState) {
    let r = &*ptr;
    let pos = r.terminal.get_cursor_position();
    let (style, blinking) = r.terminal.get_cursor_style();
    let color = r.terminal.get_cursor_color();
    (*out) = ExternalCursorState {
        x: pos.x,
        y: pos.y,
        visible: pos.visible,
        style: style as u8,
        blinking,
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3],
    };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Renderer terminal controls
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn setDebugOverlay(ptr: *mut CliRenderer, enabled: bool, corner: u8) {
    let c = match corner {
        0 => DebugOverlayCorner::TopLeft,
        1 => DebugOverlayCorner::TopRight,
        2 => DebugOverlayCorner::BottomLeft,
        _ => DebugOverlayCorner::BottomRight,
    };
    (*ptr).set_debug_overlay(enabled, c);
}

#[no_mangle]
pub unsafe extern "C" fn clearTerminal(ptr: *mut CliRenderer) {
    (*ptr).clear_terminal();
}

#[no_mangle]
pub unsafe extern "C" fn setTerminalTitle(ptr: *mut CliRenderer, title_ptr: *const u8, title_len: usize) {
    let title = std::str::from_utf8_unchecked(slice::from_raw_parts(title_ptr, title_len));
    (*ptr).set_terminal_title(title);
}

#[no_mangle]
pub unsafe extern "C" fn copyToClipboardOSC52(ptr: *mut CliRenderer, target: u8, payload_ptr: *const u8, payload_len: usize) -> bool {
    let payload = std::str::from_utf8_unchecked(slice::from_raw_parts(payload_ptr, payload_len));
    (*ptr).copy_to_clipboard_osc52(ClipboardTarget::from_u8(target), payload)
}

#[no_mangle]
pub unsafe extern "C" fn clearClipboardOSC52(ptr: *mut CliRenderer, target: u8) -> bool {
    (*ptr).clear_clipboard_osc52(ClipboardTarget::from_u8(target))
}

#[no_mangle]
pub unsafe extern "C" fn restoreTerminalModes(ptr: *mut CliRenderer) {
    (*ptr).restore_terminal_modes();
}

#[no_mangle]
pub unsafe extern "C" fn enableMouse(ptr: *mut CliRenderer, enable_movement: bool) {
    (*ptr).enable_mouse(enable_movement);
}

#[no_mangle]
pub unsafe extern "C" fn disableMouse(ptr: *mut CliRenderer) {
    (*ptr).disable_mouse();
}

#[no_mangle]
pub unsafe extern "C" fn queryPixelResolution(ptr: *mut CliRenderer) {
    (*ptr).query_pixel_resolution();
}

#[no_mangle]
pub unsafe extern "C" fn enableKittyKeyboard(ptr: *mut CliRenderer, flags: u8) {
    (*ptr).enable_kitty_keyboard(flags);
}

#[no_mangle]
pub unsafe extern "C" fn disableKittyKeyboard(ptr: *mut CliRenderer) {
    (*ptr).disable_kitty_keyboard();
}

#[no_mangle]
pub unsafe extern "C" fn setKittyKeyboardFlags(ptr: *mut CliRenderer, flags: u8) {
    (*ptr).set_kitty_keyboard_flags(flags);
}

#[no_mangle]
pub unsafe extern "C" fn getKittyKeyboardFlags(ptr: *mut CliRenderer) -> u8 {
    (*ptr).get_kitty_keyboard_flags()
}

#[no_mangle]
pub unsafe extern "C" fn setupTerminal(ptr: *mut CliRenderer, use_alternate_screen: bool) {
    (*ptr).setup_terminal(use_alternate_screen);
}

#[no_mangle]
pub unsafe extern "C" fn suspendRenderer(ptr: *mut CliRenderer) {
    (*ptr).suspend_renderer();
}

#[no_mangle]
pub unsafe extern "C" fn resumeRenderer(ptr: *mut CliRenderer) {
    (*ptr).resume_renderer();
}

#[no_mangle]
pub unsafe extern "C" fn writeOut(ptr: *mut CliRenderer, data_ptr: *const u8, data_len: usize) {
    if data_len == 0 {
        return;
    }
    let data = slice::from_raw_parts(data_ptr, data_len);
    (*ptr).write_out(data);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Hit grid
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn addToHitGrid(ptr: *mut CliRenderer, x: i32, y: i32, width: u32, height: u32, id: u32) {
    (*ptr).add_to_hit_grid(x, y, width, height, id);
}

#[no_mangle]
pub unsafe extern "C" fn clearCurrentHitGrid(ptr: *mut CliRenderer) {
    (*ptr).clear_current_hit_grid();
}

#[no_mangle]
pub unsafe extern "C" fn hitGridPushScissorRect(ptr: *mut CliRenderer, x: i32, y: i32, width: u32, height: u32) {
    (*ptr).hit_grid_push_scissor_rect(x, y, width, height);
}

#[no_mangle]
pub unsafe extern "C" fn hitGridPopScissorRect(ptr: *mut CliRenderer) {
    (*ptr).hit_grid_pop_scissor_rect();
}

#[no_mangle]
pub unsafe extern "C" fn hitGridClearScissorRects(ptr: *mut CliRenderer) {
    (*ptr).hit_grid_clear_scissor_rects();
}

#[no_mangle]
pub unsafe extern "C" fn addToCurrentHitGridClipped(ptr: *mut CliRenderer, x: i32, y: i32, width: u32, height: u32, id: u32) {
    (*ptr).add_to_current_hit_grid_clipped(x, y, width, height, id);
}

#[no_mangle]
pub unsafe extern "C" fn checkHit(ptr: *mut CliRenderer, x: u32, y: u32) -> u32 {
    (*ptr).check_hit(x, y)
}

#[no_mangle]
pub unsafe extern "C" fn getHitGridDirty(ptr: *mut CliRenderer) -> bool {
    (*ptr).get_hit_grid_dirty()
}

#[no_mangle]
pub unsafe extern "C" fn dumpHitGrid(ptr: *mut CliRenderer) {
    (*ptr).dump_hit_grid();
}

#[no_mangle]
pub unsafe extern "C" fn dumpBuffers(ptr: *mut CliRenderer, timestamp: i64) {
    (*ptr).dump_buffers(timestamp);
}

#[no_mangle]
pub unsafe extern "C" fn dumpStdoutBuffer(ptr: *mut CliRenderer, timestamp: i64) {
    (*ptr).dump_stdout_buffer(timestamp);
}

// ═══════════════════════════════════════════════════════════════════════════
//  OptimizedBuffer
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createOptimizedBuffer(
    width: u32,
    height: u32,
    respect_alpha: bool,
    width_method: u8,
    id_ptr: *const u8,
    id_len: usize,
) -> *mut OptimizedBuffer {
    if width == 0 || height == 0 {
        return std::ptr::null_mut();
    }
    let id = std::str::from_utf8_unchecked(slice::from_raw_parts(id_ptr, id_len));
    let wm = WidthMethod::from_u8(width_method);
    match OptimizedBuffer::new(width, height, respect_alpha, wm, id) {
        Ok(buf) => Box::into_raw(buf),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn destroyOptimizedBuffer(ptr: *mut OptimizedBuffer) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn destroyFrameBuffer(ptr: *mut OptimizedBuffer) {
    destroyOptimizedBuffer(ptr);
}

#[no_mangle]
pub unsafe extern "C" fn getBufferWidth(ptr: *mut OptimizedBuffer) -> u32 {
    (*ptr).width
}

#[no_mangle]
pub unsafe extern "C" fn getBufferHeight(ptr: *mut OptimizedBuffer) -> u32 {
    (*ptr).height
}

#[no_mangle]
pub unsafe extern "C" fn bufferClear(ptr: *mut OptimizedBuffer, bg: *const f32) {
    (*ptr).clear(&utils::f32_ptr_to_rgba(bg));
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetCharPtr(ptr: *mut OptimizedBuffer) -> *mut u32 {
    (*ptr).get_char_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetFgPtr(ptr: *mut OptimizedBuffer) -> *mut RGBA {
    (*ptr).get_fg_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetBgPtr(ptr: *mut OptimizedBuffer) -> *mut RGBA {
    (*ptr).get_bg_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetAttributesPtr(ptr: *mut OptimizedBuffer) -> *mut u32 {
    (*ptr).get_attributes_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetRespectAlpha(ptr: *mut OptimizedBuffer) -> bool {
    (*ptr).respect_alpha
}

#[no_mangle]
pub unsafe extern "C" fn bufferSetRespectAlpha(ptr: *mut OptimizedBuffer, respect_alpha: bool) {
    (*ptr).respect_alpha = respect_alpha;
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetId(ptr: *mut OptimizedBuffer, out_ptr: *mut u8, max_len: usize) -> usize {
    let id = (*ptr).id.as_bytes();
    let copy_len = id.len().min(max_len);
    std::ptr::copy_nonoverlapping(id.as_ptr(), out_ptr, copy_len);
    copy_len
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetRealCharSize(ptr: *mut OptimizedBuffer) -> u32 {
    (*ptr).get_real_char_size()
}

#[no_mangle]
pub unsafe extern "C" fn bufferWriteResolvedChars(ptr: *mut OptimizedBuffer, output_ptr: *mut u8, output_len: usize, add_line_breaks: bool) -> u32 {
    let output = slice::from_raw_parts_mut(output_ptr, output_len);
    (*ptr).write_resolved_chars(output, add_line_breaks)
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawText(
    ptr: *mut OptimizedBuffer,
    text: *const u8,
    text_len: usize,
    x: u32,
    y: u32,
    fg: *const f32,
    bg: *const f32,
    attributes: u32,
) {
    let text_slice = slice::from_raw_parts(text, text_len);
    let fg_rgba = utils::f32_ptr_to_rgba(fg);
    let bg_rgba = if bg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(bg)) };
    (*ptr).draw_text(text_slice, x, y, fg_rgba, bg_rgba, attributes);
}

#[no_mangle]
pub unsafe extern "C" fn bufferSetCellWithAlphaBlending(
    ptr: *mut OptimizedBuffer,
    x: u32,
    y: u32,
    char: u32,
    fg: *const f32,
    bg: *const f32,
    attributes: u32,
) {
    (*ptr).set_cell_with_alpha_blending(
        x, y, char,
        utils::f32_ptr_to_rgba(fg),
        utils::f32_ptr_to_rgba(bg),
        attributes,
    );
}

#[no_mangle]
pub unsafe extern "C" fn bufferSetCell(
    ptr: *mut OptimizedBuffer,
    x: u32,
    y: u32,
    char: u32,
    fg: *const f32,
    bg: *const f32,
    attributes: u32,
) {
    (*ptr).set(x, y, Cell {
        char,
        fg: utils::f32_ptr_to_rgba(fg),
        bg: utils::f32_ptr_to_rgba(bg),
        attributes,
    });
}

#[no_mangle]
pub unsafe extern "C" fn bufferFillRect(ptr: *mut OptimizedBuffer, x: u32, y: u32, width: u32, height: u32, bg: *const f32) {
    (*ptr).fill_rect(x, y, width, height, &utils::f32_ptr_to_rgba(bg));
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawPackedBuffer(ptr: *mut OptimizedBuffer, data: *const u8, data_len: usize, pos_x: u32, pos_y: u32, term_width: u32, term_height: u32) {
    let data_slice = slice::from_raw_parts(data, data_len);
    (*ptr).draw_packed_buffer(data_slice, pos_x, pos_y, term_width, term_height);
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawGrayscaleBuffer(ptr: *mut OptimizedBuffer, pos_x: i32, pos_y: i32, intensities: *const f32, src_width: u32, src_height: u32, fg: *const f32, bg: *const f32) {
    let count = (src_width * src_height) as usize;
    let intensities_slice = slice::from_raw_parts(intensities, count);
    let fg_rgba = if fg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(fg)) };
    let bg_rgba = if bg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(bg)) };
    (*ptr).draw_grayscale_buffer(pos_x, pos_y, intensities_slice, src_width, src_height, fg_rgba, bg_rgba);
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawGrayscaleBufferSupersampled(ptr: *mut OptimizedBuffer, pos_x: i32, pos_y: i32, intensities: *const f32, src_width: u32, src_height: u32, fg: *const f32, bg: *const f32) {
    // Delegate to regular grayscale draw (supersampled impl can be added later)
    bufferDrawGrayscaleBuffer(ptr, pos_x, pos_y, intensities, src_width, src_height, fg, bg);
}

#[no_mangle]
pub unsafe extern "C" fn bufferPushScissorRect(ptr: *mut OptimizedBuffer, x: i32, y: i32, width: u32, height: u32) {
    (*ptr).push_scissor_rect(x, y, width, height);
}

#[no_mangle]
pub unsafe extern "C" fn bufferPopScissorRect(ptr: *mut OptimizedBuffer) {
    (*ptr).pop_scissor_rect();
}

#[no_mangle]
pub unsafe extern "C" fn bufferClearScissorRects(ptr: *mut OptimizedBuffer) {
    (*ptr).clear_scissor_rects();
}

#[no_mangle]
pub unsafe extern "C" fn bufferPushOpacity(ptr: *mut OptimizedBuffer, opacity: f32) {
    (*ptr).push_opacity(opacity);
}

#[no_mangle]
pub unsafe extern "C" fn bufferPopOpacity(ptr: *mut OptimizedBuffer) {
    (*ptr).pop_opacity();
}

#[no_mangle]
pub unsafe extern "C" fn bufferGetCurrentOpacity(ptr: *mut OptimizedBuffer) -> f32 {
    (*ptr).get_current_opacity()
}

#[no_mangle]
pub unsafe extern "C" fn bufferClearOpacity(ptr: *mut OptimizedBuffer) {
    (*ptr).clear_opacity();
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawSuperSampleBuffer(ptr: *mut OptimizedBuffer, x: u32, y: u32, pixel_data: *const u8, len: usize, format: u8, aligned_bytes_per_row: u32) {
    let data = slice::from_raw_parts(pixel_data, len);
    (*ptr).draw_super_sample_buffer(x, y, data, format, aligned_bytes_per_row);
}

#[no_mangle]
pub unsafe extern "C" fn bufferResize(ptr: *mut OptimizedBuffer, width: u32, height: u32) {
    (*ptr).resize(width, height);
}

#[no_mangle]
pub unsafe extern "C" fn drawFrameBuffer(
    target_ptr: *mut OptimizedBuffer,
    dest_x: i32,
    dest_y: i32,
    frame_buffer: *mut OptimizedBuffer,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
) {
    let src_x = if source_x == 0 { None } else { Some(source_x) };
    let src_y = if source_y == 0 { None } else { Some(source_y) };
    let src_w = if source_width == 0 { None } else { Some(source_width) };
    let src_h = if source_height == 0 { None } else { Some(source_height) };
    (*target_ptr).draw_frame_buffer(dest_x, dest_y, &*frame_buffer, src_x, src_y, src_w, src_h);
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawChar(ptr: *mut OptimizedBuffer, char: u32, x: u32, y: u32, fg: *const f32, bg: *const f32, attributes: u32) {
    (*ptr).draw_char(char, x, y, utils::f32_ptr_to_rgba(fg), utils::f32_ptr_to_rgba(bg), attributes);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Grid / Box drawing
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct ExternalGridDrawOptions {
    draw_inner: bool,
    draw_outer: bool,
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawGrid(
    ptr: *mut OptimizedBuffer,
    border_chars: *const u32,
    border_fg: *const f32,
    border_bg: *const f32,
    column_offsets: *const i32,
    column_count: u32,
    row_offsets: *const i32,
    row_count: u32,
    options: *const ExternalGridDrawOptions,
) {
    let chars = slice::from_raw_parts(border_chars, 11);
    let cols = slice::from_raw_parts(column_offsets, column_count as usize);
    let rows = slice::from_raw_parts(row_offsets, row_count as usize);
    (*ptr).draw_grid(
        chars,
        utils::f32_ptr_to_rgba(border_fg),
        utils::f32_ptr_to_rgba(border_bg),
        cols,
        rows,
        (*options).draw_inner,
        (*options).draw_outer,
    );
}

#[no_mangle]
pub unsafe extern "C" fn bufferDrawBox(
    ptr: *mut OptimizedBuffer,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    border_chars: *const u32,
    packed_options: u32,
    border_color: *const f32,
    background_color: *const f32,
    title: *const u8,
    title_len: u32,
) {
    let sides = BorderSides {
        top: (packed_options & 0b1000) != 0,
        right: (packed_options & 0b0100) != 0,
        bottom: (packed_options & 0b0010) != 0,
        left: (packed_options & 0b0001) != 0,
    };
    let should_fill = ((packed_options >> 4) & 1) != 0;
    let title_alignment = ((packed_options >> 5) & 0b11) as u8;
    let title_str = if !title.is_null() && title_len > 0 {
        Some(std::str::from_utf8_unchecked(slice::from_raw_parts(title, title_len as usize)))
    } else {
        None
    };
    let chars = slice::from_raw_parts(border_chars, 11);

    (*ptr).draw_box(
        x, y, width, height, chars, sides,
        utils::f32_ptr_to_rgba(border_color),
        utils::f32_ptr_to_rgba(background_color),
        should_fill,
        title_str,
        title_alignment,
    );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Link management
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn linkAlloc(url_ptr: *const u8, url_len: usize) -> u32 {
    let url = std::str::from_utf8_unchecked(slice::from_raw_parts(url_ptr, url_len));
    link::with_global_link_pool(|pool| pool.alloc(url).unwrap_or(0))
}

#[no_mangle]
pub unsafe extern "C" fn linkGetUrl(id: u32, out_ptr: *mut u8, max_len: usize) -> usize {
    link::with_global_link_pool(|pool| {
        if let Some(url) = pool.get(id) {
            let copy_len = url.len().min(max_len);
            std::ptr::copy_nonoverlapping(url.as_ptr(), out_ptr, copy_len);
            copy_len
        } else {
            0
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn attributesWithLink(base: u32, link_id: u32) -> u32 {
    TextAttributes::set_link_id(base, link_id)
}

#[no_mangle]
pub unsafe extern "C" fn attributesGetLinkId(attributes: u32) -> u32 {
    TextAttributes::get_link_id(attributes)
}

// ═══════════════════════════════════════════════════════════════════════════
//  TextBuffer
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createTextBuffer(width_method: u8) -> *mut TextBuffer {
    let wm = WidthMethod::from_u8(width_method);
    Box::into_raw(Box::new(TextBuffer::new(wm)))
}

#[no_mangle]
pub unsafe extern "C" fn destroyTextBuffer(ptr: *mut TextBuffer) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetLength(ptr: *mut TextBuffer) -> u32 {
    (*ptr).get_length()
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetByteSize(ptr: *mut TextBuffer) -> u32 {
    (*ptr).get_byte_size()
}

#[no_mangle]
pub unsafe extern "C" fn textBufferReset(ptr: *mut TextBuffer) {
    (*ptr).reset();
}

#[no_mangle]
pub unsafe extern "C" fn textBufferClear(ptr: *mut TextBuffer) {
    (*ptr).clear();
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetDefaultFg(ptr: *mut TextBuffer, fg: *const f32) {
    let color = if fg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(fg)) };
    (*ptr).set_default_fg(color);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetDefaultBg(ptr: *mut TextBuffer, bg: *const f32) {
    let color = if bg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(bg)) };
    (*ptr).set_default_bg(color);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetDefaultAttributes(ptr: *mut TextBuffer, attr: *const u32) {
    let a = if attr.is_null() { None } else { Some(*attr) };
    (*ptr).set_default_attributes(a);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferResetDefaults(ptr: *mut TextBuffer) {
    (*ptr).reset_defaults();
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetTabWidth(ptr: *mut TextBuffer) -> u8 {
    (*ptr).tab_width
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetTabWidth(ptr: *mut TextBuffer, width: u8) {
    (*ptr).set_tab_width(width);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferRegisterMemBuffer(ptr: *mut TextBuffer, data_ptr: *const u8, data_len: usize, _owned: bool) -> u16 {
    let data = slice::from_raw_parts(data_ptr, data_len);
    match (*ptr).register_mem_buffer(data) {
        Some(id) => id as u16,
        None => 0xFFFF,
    }
}

#[no_mangle]
pub unsafe extern "C" fn textBufferReplaceMemBuffer(ptr: *mut TextBuffer, id: u8, data_ptr: *const u8, data_len: usize, _owned: bool) -> bool {
    let data = slice::from_raw_parts(data_ptr, data_len);
    (*ptr).replace_mem_buffer(id, data)
}

#[no_mangle]
pub unsafe extern "C" fn textBufferClearMemRegistry(ptr: *mut TextBuffer) {
    (*ptr).clear_mem_registry();
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetTextFromMem(ptr: *mut TextBuffer, id: u8) {
    (*ptr).set_text_from_mem_id(id);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferAppend(ptr: *mut TextBuffer, data_ptr: *const u8, data_len: usize) {
    let data = slice::from_raw_parts(data_ptr, data_len);
    (*ptr).append(data);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferAppendFromMemId(ptr: *mut TextBuffer, id: u8) {
    (*ptr).append_from_mem_id(id);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferLoadFile(ptr: *mut TextBuffer, path_ptr: *const u8, path_len: usize) -> bool {
    let path = std::str::from_utf8_unchecked(slice::from_raw_parts(path_ptr, path_len));
    (*ptr).load_file(path).is_ok()
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetStyledText(ptr: *mut TextBuffer, chunks_ptr: *const StyledChunk, chunk_count: usize) {
    if chunk_count == 0 {
        return;
    }
    let chunks = slice::from_raw_parts(chunks_ptr, chunk_count);
    (*ptr).set_styled_text(chunks);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetLineCount(ptr: *mut TextBuffer) -> u32 {
    (*ptr).get_line_count()
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetPlainText(ptr: *mut TextBuffer, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_plain_text_into_buffer(output)
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetTextRange(ptr: *mut TextBuffer, start: u32, end: u32, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_text_range(start, end, output)
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetTextRangeByCoords(ptr: *mut TextBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_text_range_by_coords(start_row, start_col, end_row, end_col, output)
}

// ═══════════════════════════════════════════════════════════════════════════
//  TextBuffer highlights
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct ExternalHighlight {
    start: u32,
    end: u32,
    style_id: u32,
    priority: u8,
    hl_ref: u16,
}

#[no_mangle]
pub unsafe extern "C" fn textBufferAddHighlightByCharRange(ptr: *mut TextBuffer, hl_ptr: *const ExternalHighlight) {
    let hl = &*hl_ptr;
    (*ptr).add_highlight_by_char_range(hl.start, hl.end, hl.style_id, hl.priority, hl.hl_ref);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferAddHighlight(ptr: *mut TextBuffer, line_idx: u32, hl_ptr: *const ExternalHighlight) {
    let hl = &*hl_ptr;
    (*ptr).add_highlight(line_idx, hl.start, hl.end, hl.style_id, hl.priority, hl.hl_ref);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferRemoveHighlightsByRef(ptr: *mut TextBuffer, hl_ref: u16) {
    (*ptr).remove_highlights_by_ref(hl_ref);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferClearLineHighlights(ptr: *mut TextBuffer, line_idx: u32) {
    (*ptr).clear_line_highlights(line_idx);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferClearAllHighlights(ptr: *mut TextBuffer) {
    (*ptr).clear_all_highlights();
}

#[no_mangle]
pub unsafe extern "C" fn textBufferGetHighlightCount(ptr: *mut TextBuffer) -> u32 {
    (*ptr).get_highlight_count()
}

#[no_mangle]
pub unsafe extern "C" fn textBufferSetSyntaxStyle(ptr: *mut TextBuffer, style: *const SyntaxStyle) {
    let s = if style.is_null() { None } else { Some(style) };
    (*ptr).set_syntax_style(s);
}

// ═══════════════════════════════════════════════════════════════════════════
//  TextBufferView
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createTextBufferView(tb: *mut TextBuffer) -> *mut TextBufferView {
    Box::into_raw(Box::new(TextBufferView::new(tb)))
}

#[no_mangle]
pub unsafe extern "C" fn destroyTextBufferView(ptr: *mut TextBufferView) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewSetSelection(ptr: *mut TextBufferView, start: u32, end: u32, bg: *const f32, fg: *const f32) {
    let bg_color = if bg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(bg)) };
    let fg_color = if fg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(fg)) };
    (*ptr).set_selection(start, end, bg_color, fg_color);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewResetSelection(ptr: *mut TextBufferView) {
    (*ptr).reset_selection();
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewGetSelectionInfo(ptr: *mut TextBufferView) -> u64 {
    (*ptr).pack_selection_info()
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewSetWrapWidth(ptr: *mut TextBufferView, width: u32) {
    (*ptr).set_wrap_width(if width == 0 { None } else { Some(width) });
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewSetWrapMode(ptr: *mut TextBufferView, mode: u8) {
    (*ptr).set_wrap_mode(WrapMode::from_u8(mode));
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewSetViewportSize(ptr: *mut TextBufferView, width: u32, height: u32) {
    (*ptr).set_viewport_size(width, height);
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewSetViewport(ptr: *mut TextBufferView, x: u32, y: u32, width: u32, height: u32) {
    (*ptr).set_viewport(Viewport { x, y, width, height });
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewGetVirtualLineCount(ptr: *mut TextBufferView) -> u32 {
    (*ptr).get_virtual_line_count()
}

#[repr(C)]
pub struct ExternalLineInfo {
    starts_ptr: *const u32,
    starts_len: u32,
    widths_ptr: *const u32,
    widths_len: u32,
    sources_ptr: *const u32,
    sources_len: u32,
    wraps_ptr: *const u32,
    wraps_len: u32,
    max_width: u32,
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewGetLineInfoDirect(ptr: *mut TextBufferView, out: *mut ExternalLineInfo) {
    let info = (*ptr).get_cached_line_info();
    (*out) = ExternalLineInfo {
        starts_ptr: info.starts.as_ptr(),
        starts_len: info.starts.len() as u32,
        widths_ptr: info.widths.as_ptr(),
        widths_len: info.widths.len() as u32,
        sources_ptr: info.sources.as_ptr(),
        sources_len: info.sources.len() as u32,
        wraps_ptr: info.wraps.as_ptr(),
        wraps_len: info.wraps.len() as u32,
        max_width: info.max_width,
    };
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewSetTruncate(ptr: *mut TextBufferView, truncate: bool) {
    (*ptr).set_truncate(truncate);
}

#[repr(C)]
pub struct ExternalMeasureResult {
    line_count: u32,
    max_width: u32,
}

#[no_mangle]
pub unsafe extern "C" fn textBufferViewMeasureForDimensions(ptr: *mut TextBufferView, width: u32, height: u32, out: *mut ExternalMeasureResult) -> bool {
    if let Some(result) = (*ptr).measure_for_dimensions(width, height) {
        (*out) = ExternalMeasureResult {
            line_count: result.line_count,
            max_width: result.max_width,
        };
        true
    } else {
        false
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EditBuffer
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createEditBuffer(width_method: u8) -> *mut EditBuffer {
    let wm = WidthMethod::from_u8(width_method);
    Box::into_raw(Box::new(EditBuffer::new(wm)))
}

#[no_mangle]
pub unsafe extern "C" fn destroyEditBuffer(ptr: *mut EditBuffer) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetTextBuffer(ptr: *mut EditBuffer) -> *mut TextBuffer {
    (*ptr).get_text_buffer() as *mut _
}

#[no_mangle]
pub unsafe extern "C" fn editBufferInsertText(ptr: *mut EditBuffer, text_ptr: *const u8, text_len: usize) {
    let text = slice::from_raw_parts(text_ptr, text_len);
    (*ptr).insert_text(text);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferDeleteRange(ptr: *mut EditBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32) {
    let start = crate::edit_buffer::Cursor { row: start_row, col: start_col };
    let end = crate::edit_buffer::Cursor { row: end_row, col: end_col };
    (*ptr).delete_range(start, end);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferDeleteCharBackward(ptr: *mut EditBuffer) {
    (*ptr).backspace();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferDeleteChar(ptr: *mut EditBuffer) {
    (*ptr).delete_forward();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferMoveCursorLeft(ptr: *mut EditBuffer) {
    (*ptr).move_left();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferMoveCursorRight(ptr: *mut EditBuffer) {
    (*ptr).move_right();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferMoveCursorUp(ptr: *mut EditBuffer) {
    (*ptr).move_up();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferMoveCursorDown(ptr: *mut EditBuffer) {
    (*ptr).move_down();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetCursor(ptr: *mut EditBuffer, out_row: *mut u32, out_col: *mut u32) {
    let cursor = (*ptr).get_primary_cursor();
    *out_row = cursor.row;
    *out_col = cursor.col;
}

#[no_mangle]
pub unsafe extern "C" fn editBufferSetCursor(ptr: *mut EditBuffer, row: u32, col: u32) {
    (*ptr).set_cursor(row, col);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferSetCursorToLineCol(ptr: *mut EditBuffer, row: u32, col: u32) {
    (*ptr).set_cursor(row, col);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferSetCursorByOffset(ptr: *mut EditBuffer, offset: u32) {
    (*ptr).set_cursor_by_offset(offset);
}

#[repr(C)]
pub struct ExternalLogicalCursor {
    row: u32,
    col: u32,
    offset: u32,
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetNextWordBoundary(ptr: *mut EditBuffer, out: *mut ExternalLogicalCursor) {
    let c = (*ptr).get_next_word_boundary();
    (*out) = ExternalLogicalCursor { row: c.row, col: c.col, offset: c.offset };
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetPrevWordBoundary(ptr: *mut EditBuffer, out: *mut ExternalLogicalCursor) {
    let c = (*ptr).get_prev_word_boundary();
    (*out) = ExternalLogicalCursor { row: c.row, col: c.col, offset: c.offset };
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetEOL(ptr: *mut EditBuffer, out: *mut ExternalLogicalCursor) {
    let c = (*ptr).get_eol();
    (*out) = ExternalLogicalCursor { row: c.row, col: c.col, offset: c.offset };
}

#[no_mangle]
pub unsafe extern "C" fn editBufferOffsetToPosition(ptr: *mut EditBuffer, offset: u32, out: *mut ExternalLogicalCursor) -> bool {
    if let Some((row, col)) = (*ptr).tb.rope().offset_to_coords(offset as usize) {
        (*out) = ExternalLogicalCursor { row, col, offset };
        true
    } else {
        false
    }
}

#[no_mangle]
pub unsafe extern "C" fn editBufferPositionToOffset(ptr: *mut EditBuffer, row: u32, col: u32) -> u32 {
    (*ptr).tb.rope().coords_to_offset(row, col).unwrap_or(0) as u32
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetLineStartOffset(ptr: *mut EditBuffer, row: u32) -> u32 {
    (*ptr).tb.rope().coords_to_offset(row, 0).unwrap_or(0) as u32
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetTextRange(ptr: *mut EditBuffer, start: u32, end: u32, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_text_range(start, end, output)
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetTextRangeByCoords(ptr: *mut EditBuffer, sr: u32, sc: u32, er: u32, ec: u32, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_text_range_by_coords(sr, sc, er, ec, output)
}

#[no_mangle]
pub unsafe extern "C" fn editBufferSetText(ptr: *mut EditBuffer, text_ptr: *const u8, text_len: usize) {
    let text = slice::from_raw_parts(text_ptr, text_len);
    (*ptr).set_text(text);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferSetTextFromMem(ptr: *mut EditBuffer, mem_id: u8) {
    (*ptr).set_text_from_mem_id(mem_id);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferReplaceText(ptr: *mut EditBuffer, text_ptr: *const u8, text_len: usize) {
    let text = slice::from_raw_parts(text_ptr, text_len);
    (*ptr).replace_text(text);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferReplaceTextFromMem(ptr: *mut EditBuffer, mem_id: u8) {
    (*ptr).replace_text_from_mem_id(mem_id);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetText(ptr: *mut EditBuffer, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_text(output)
}

#[no_mangle]
pub unsafe extern "C" fn editBufferInsertChar(ptr: *mut EditBuffer, char_ptr: *const u8, char_len: usize) {
    let text = slice::from_raw_parts(char_ptr, char_len);
    (*ptr).insert_text(text);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferNewLine(ptr: *mut EditBuffer) {
    (*ptr).insert_text(b"\n");
}

#[no_mangle]
pub unsafe extern "C" fn editBufferDeleteLine(ptr: *mut EditBuffer) {
    (*ptr).delete_line();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGotoLine(ptr: *mut EditBuffer, line: u32) {
    (*ptr).goto_line(line);
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetCursorPosition(ptr: *mut EditBuffer, out: *mut ExternalLogicalCursor) {
    let pos = (*ptr).get_cursor_position();
    (*out) = ExternalLogicalCursor { row: pos.row, col: pos.col, offset: pos.offset };
}

#[no_mangle]
pub unsafe extern "C" fn editBufferGetId(ptr: *mut EditBuffer) -> u16 {
    (*ptr).get_id()
}

#[no_mangle]
pub unsafe extern "C" fn editBufferDebugLogRope(ptr: *mut EditBuffer) {
    (*ptr).debug_log_rope();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferUndo(ptr: *mut EditBuffer, out_ptr: *mut u8, max_len: usize) -> usize {
    if let Some(meta) = (*ptr).undo() {
        let copy_len = meta.len().min(max_len);
        std::ptr::copy_nonoverlapping(meta.as_ptr(), out_ptr, copy_len);
        copy_len
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn editBufferRedo(ptr: *mut EditBuffer, out_ptr: *mut u8, max_len: usize) -> usize {
    if let Some(meta) = (*ptr).redo() {
        let copy_len = meta.len().min(max_len);
        std::ptr::copy_nonoverlapping(meta.as_ptr(), out_ptr, copy_len);
        copy_len
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn editBufferCanUndo(ptr: *mut EditBuffer) -> bool {
    (*ptr).can_undo()
}

#[no_mangle]
pub unsafe extern "C" fn editBufferCanRedo(ptr: *mut EditBuffer) -> bool {
    (*ptr).can_redo()
}

#[no_mangle]
pub unsafe extern "C" fn editBufferClearHistory(ptr: *mut EditBuffer) {
    (*ptr).clear_history();
}

#[no_mangle]
pub unsafe extern "C" fn editBufferClear(ptr: *mut EditBuffer) {
    (*ptr).clear();
}

// ═══════════════════════════════════════════════════════════════════════════
//  EditorView
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createEditorView(edit_buffer: *mut EditBuffer, vp_width: u32, vp_height: u32) -> *mut EditorView {
    Box::into_raw(Box::new(EditorView::new(edit_buffer, vp_width, vp_height)))
}

#[no_mangle]
pub unsafe extern "C" fn destroyEditorView(ptr: *mut EditorView) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn editorViewSetViewport(ptr: *mut EditorView, x: u32, y: u32, width: u32, height: u32, move_cursor: bool) {
    (*ptr).set_viewport(Some(Viewport { x, y, width, height }), move_cursor);
}

#[no_mangle]
pub unsafe extern "C" fn editorViewClearViewport(ptr: *mut EditorView) {
    (*ptr).set_viewport(None, false);
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetViewport(ptr: *mut EditorView, out_x: *mut u32, out_y: *mut u32, out_w: *mut u32, out_h: *mut u32) -> bool {
    if let Some(vp) = (*ptr).get_viewport() {
        *out_x = vp.x;
        *out_y = vp.y;
        *out_w = vp.width;
        *out_h = vp.height;
        true
    } else {
        false
    }
}

#[no_mangle]
pub unsafe extern "C" fn editorViewSetScrollMargin(ptr: *mut EditorView, margin: f32) {
    (*ptr).set_scroll_margin(margin);
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetVirtualLineCount(ptr: *mut EditorView) -> u32 {
    (*ptr).get_virtual_lines().len() as u32
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetTotalVirtualLineCount(ptr: *mut EditorView) -> u32 {
    (*ptr).get_total_virtual_line_count()
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetTextBufferView(ptr: *mut EditorView) -> *mut TextBufferView {
    (*ptr).get_text_buffer_view() as *mut _
}

#[no_mangle]
pub unsafe extern "C" fn editorViewSetViewportSize(ptr: *mut EditorView, width: u32, height: u32) {
    (*ptr).set_viewport_size(width, height);
}

#[no_mangle]
pub unsafe extern "C" fn editorViewSetWrapMode(ptr: *mut EditorView, mode: u8) {
    (*ptr).set_wrap_mode(WrapMode::from_u8(mode));
}

#[repr(C)]
pub struct ExternalVisualCursor {
    visual_row: u32,
    visual_col: u32,
    logical_row: u32,
    logical_col: u32,
    offset: u32,
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetVisualCursor(ptr: *mut EditorView, out: *mut ExternalVisualCursor) {
    let vc = (*ptr).get_visual_cursor();
    (*out) = ExternalVisualCursor {
        visual_row: vc.visual_row,
        visual_col: vc.visual_col,
        logical_row: vc.logical_row,
        logical_col: vc.logical_col,
        offset: vc.offset,
    };
}

#[no_mangle]
pub unsafe extern "C" fn editorViewMoveUpVisual(ptr: *mut EditorView) {
    (*ptr).move_up_visual();
}

#[no_mangle]
pub unsafe extern "C" fn editorViewMoveDownVisual(ptr: *mut EditorView) {
    (*ptr).move_down_visual();
}

#[no_mangle]
pub unsafe extern "C" fn editorViewDeleteSelectedText(ptr: *mut EditorView) {
    (*ptr).delete_selected_text();
}

#[no_mangle]
pub unsafe extern "C" fn editorViewSetCursorByOffset(ptr: *mut EditorView, offset: u32) {
    (*ptr).set_cursor_by_offset(offset);
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetCursor(ptr: *mut EditorView, out_row: *mut u32, out_col: *mut u32) {
    let cursor = (*ptr).get_primary_cursor();
    *out_row = cursor.row;
    *out_col = cursor.col;
}

#[no_mangle]
pub unsafe extern "C" fn editorViewGetText(ptr: *mut EditorView, out_ptr: *mut u8, max_len: usize) -> usize {
    let output = slice::from_raw_parts_mut(out_ptr, max_len);
    (*ptr).get_text(output)
}

// ═══════════════════════════════════════════════════════════════════════════
//  SyntaxStyle
// ═══════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub unsafe extern "C" fn createSyntaxStyle() -> *mut SyntaxStyle {
    Box::into_raw(Box::new(SyntaxStyle::new()))
}

#[no_mangle]
pub unsafe extern "C" fn destroySyntaxStyle(ptr: *mut SyntaxStyle) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn syntaxStyleRegister(ptr: *mut SyntaxStyle, name_ptr: *const u8, name_len: usize, fg: *const f32, bg: *const f32, attributes: u32) -> u32 {
    let name = std::str::from_utf8_unchecked(slice::from_raw_parts(name_ptr, name_len));
    let fg_color = if fg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(fg)) };
    let bg_color = if bg.is_null() { None } else { Some(utils::f32_ptr_to_rgba(bg)) };
    (*ptr).register_style(name, fg_color, bg_color, attributes)
}

#[no_mangle]
pub unsafe extern "C" fn syntaxStyleResolveByName(ptr: *mut SyntaxStyle, name_ptr: *const u8, name_len: usize) -> u32 {
    let name = std::str::from_utf8_unchecked(slice::from_raw_parts(name_ptr, name_len));
    (*ptr).resolve_by_name(name).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn syntaxStyleGetStyleCount(ptr: *mut SyntaxStyle) -> usize {
    (*ptr).get_style_count()
}

// ═══════════════════════════════════════════════════════════════════════════
//  Unicode encoding API
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct EncodedChar {
    width: u8,
    char: u32,
}

#[no_mangle]
pub unsafe extern "C" fn encodeUnicode(
    text_ptr: *const u8,
    text_len: usize,
    out_ptr: *mut *mut EncodedChar,
    out_len_ptr: *mut usize,
    width_method: u8,
) -> bool {
    let text = slice::from_raw_parts(text_ptr, text_len);
    let s = match std::str::from_utf8(text) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _wm = WidthMethod::from_u8(width_method);

    let mut result: Vec<EncodedChar> = Vec::new();

    for ch in s.chars() {
        if ch == '\n' || ch == '\r' {
            continue;
        }
        let width = if ch.is_ascii() && (ch as u32) >= 32 {
            1u8
        } else {
            unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0) as u8
        };
        if width == 0 {
            continue;
        }
        result.push(EncodedChar {
            width,
            char: ch as u32,
        });
    }

    let len = result.len();
    let boxed = result.into_boxed_slice();
    let ptr = Box::into_raw(boxed) as *mut EncodedChar;
    *out_ptr = ptr;
    *out_len_ptr = len;
    true
}

#[no_mangle]
pub unsafe extern "C" fn freeUnicode(chars_ptr: *mut EncodedChar, chars_len: usize) {
    if !chars_ptr.is_null() && chars_len > 0 {
        let _ = Box::from_raw(slice::from_raw_parts_mut(chars_ptr, chars_len) as *mut [EncodedChar]);
    }
}
