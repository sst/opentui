const std = @import("std");
const Allocator = std.mem.Allocator;

const ansi = @import("ansi.zig");
const buffer = @import("buffer.zig");
const renderer = @import("renderer.zig");
const gp = @import("grapheme.zig");
const text_buffer = @import("text-buffer.zig");
const text_buffer_view = @import("text-buffer-view.zig");
const syntax_style = @import("syntax-style.zig");
const terminal = @import("terminal.zig");
const gwidth = @import("gwidth.zig");
const logger = @import("logger.zig");

pub const OptimizedBuffer = buffer.OptimizedBuffer;
pub const CliRenderer = renderer.CliRenderer;
pub const Terminal = terminal.Terminal;
pub const RGBA = buffer.RGBA;

export fn setLogCallback(callback: ?*const fn (level: u8, msgPtr: [*]const u8, msgLen: usize) callconv(.C) void) void {
    logger.setLogCallback(callback);
}

fn f32PtrToRGBA(ptr: [*]const f32) RGBA {
    return .{ ptr[0], ptr[1], ptr[2], ptr[3] };
}

var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
const globalArena = arena.allocator();

export fn getArenaAllocatedBytes() usize {
    return arena.queryCapacity();
}

export fn createRenderer(width: u32, height: u32, testing: bool) ?*renderer.CliRenderer {
    if (width == 0 or height == 0) {
        logger.warn("Invalid renderer dimensions: {}x{}", .{ width, height });
        return null;
    }

    const pool = gp.initGlobalPool(globalArena);
    const unicode_data = gp.initGlobalUnicodeData(globalArena);

    const graphemes_ptr, const display_width_ptr = unicode_data;
    return renderer.CliRenderer.create(std.heap.page_allocator, width, height, pool, graphemes_ptr, display_width_ptr, testing) catch |err| {
        logger.err("Failed to create renderer: {}", .{err});
        return null;
    };
}

export fn setUseThread(rendererPtr: *renderer.CliRenderer, useThread: bool) void {
    rendererPtr.setUseThread(useThread);
}

export fn destroyRenderer(rendererPtr: *renderer.CliRenderer) void {
    rendererPtr.destroy();
}

export fn setBackgroundColor(rendererPtr: *renderer.CliRenderer, color: [*]const f32) void {
    rendererPtr.setBackgroundColor(f32PtrToRGBA(color));
}

export fn setRenderOffset(rendererPtr: *renderer.CliRenderer, offset: u32) void {
    rendererPtr.setRenderOffset(offset);
}

export fn updateStats(rendererPtr: *renderer.CliRenderer, time: f64, fps: u32, frameCallbackTime: f64) void {
    rendererPtr.updateStats(time, fps, frameCallbackTime);
}

export fn updateMemoryStats(rendererPtr: *renderer.CliRenderer, heapUsed: u32, heapTotal: u32, arrayBuffers: u32) void {
    rendererPtr.updateMemoryStats(heapUsed, heapTotal, arrayBuffers);
}

export fn getNextBuffer(rendererPtr: *renderer.CliRenderer) *buffer.OptimizedBuffer {
    return rendererPtr.getNextBuffer();
}

export fn getCurrentBuffer(rendererPtr: *renderer.CliRenderer) *buffer.OptimizedBuffer {
    return rendererPtr.getCurrentBuffer();
}

export fn getBufferWidth(bufferPtr: *buffer.OptimizedBuffer) u32 {
    return bufferPtr.width;
}

export fn getBufferHeight(bufferPtr: *buffer.OptimizedBuffer) u32 {
    return bufferPtr.height;
}

export fn render(rendererPtr: *renderer.CliRenderer, force: bool) void {
    rendererPtr.render(force);
}

export fn createOptimizedBuffer(width: u32, height: u32, respectAlpha: bool, widthMethod: u8, idPtr: [*]const u8, idLen: usize) ?*buffer.OptimizedBuffer {
    if (width == 0 or height == 0) {
        logger.warn("Invalid buffer dimensions: {}x{}", .{ width, height });
        return null;
    }

    const pool = gp.initGlobalPool(globalArena);
    const wMethod: gwidth.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;
    const id = idPtr[0..idLen];

    const unicode_data = gp.initGlobalUnicodeData(globalArena);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    return buffer.OptimizedBuffer.init(std.heap.page_allocator, width, height, .{
        .respectAlpha = respectAlpha,
        .pool = pool,
        .width_method = wMethod,
        .id = id,
    }, graphemes_ptr, display_width_ptr) catch |err| {
        logger.err("Failed to create optimized buffer: {}", .{err});
        return null;
    };
}

export fn destroyOptimizedBuffer(bufferPtr: *buffer.OptimizedBuffer) void {
    bufferPtr.deinit();
}

export fn destroyFrameBuffer(frameBufferPtr: *buffer.OptimizedBuffer) void {
    destroyOptimizedBuffer(frameBufferPtr);
}

export fn drawFrameBuffer(targetPtr: *buffer.OptimizedBuffer, destX: i32, destY: i32, frameBuffer: *buffer.OptimizedBuffer, sourceX: u32, sourceY: u32, sourceWidth: u32, sourceHeight: u32) void {
    const srcX = if (sourceX == 0) null else sourceX;
    const srcY = if (sourceY == 0) null else sourceY;
    const srcWidth = if (sourceWidth == 0) null else sourceWidth;
    const srcHeight = if (sourceHeight == 0) null else sourceHeight;

    targetPtr.drawFrameBuffer(destX, destY, frameBuffer, srcX, srcY, srcWidth, srcHeight);
}

export fn setCursorPosition(rendererPtr: *renderer.CliRenderer, x: i32, y: i32, visible: bool) void {
    rendererPtr.terminal.setCursorPosition(@intCast(@max(1, x)), @intCast(@max(1, y)), visible);
}

export fn getTerminalCapabilities(rendererPtr: *renderer.CliRenderer, capsPtr: *terminal.Capabilities) void {
    capsPtr.* = rendererPtr.getTerminalCapabilities();
}

export fn processCapabilityResponse(rendererPtr: *renderer.CliRenderer, responsePtr: [*]const u8, responseLen: usize) void {
    const response = responsePtr[0..responseLen];
    rendererPtr.processCapabilityResponse(response);
}

export fn setCursorStyle(rendererPtr: *renderer.CliRenderer, stylePtr: [*]const u8, styleLen: usize, blinking: bool) void {
    const style = stylePtr[0..styleLen];
    const cursorStyle = std.meta.stringToEnum(terminal.CursorStyle, style) orelse .block;
    rendererPtr.terminal.setCursorStyle(cursorStyle, blinking);
}

export fn setCursorColor(rendererPtr: *renderer.CliRenderer, color: [*]const f32) void {
    rendererPtr.terminal.setCursorColor(f32PtrToRGBA(color));
}

export fn setDebugOverlay(rendererPtr: *renderer.CliRenderer, enabled: bool, corner: u8) void {
    const cornerEnum: renderer.DebugOverlayCorner = switch (corner) {
        0 => .topLeft,
        1 => .topRight,
        2 => .bottomLeft,
        else => .bottomRight,
    };

    rendererPtr.setDebugOverlay(enabled, cornerEnum);
}

export fn clearTerminal(rendererPtr: *renderer.CliRenderer) void {
    rendererPtr.clearTerminal();
}

export fn setTerminalTitle(rendererPtr: *renderer.CliRenderer, titlePtr: [*]const u8, titleLen: usize) void {
    const title = titlePtr[0..titleLen];
    var bufferedWriter = &rendererPtr.stdoutWriter;
    const writer = bufferedWriter.writer();
    rendererPtr.terminal.setTerminalTitle(writer.any(), title);
}

// Buffer functions
export fn bufferClear(bufferPtr: *buffer.OptimizedBuffer, bg: [*]const f32) void {
    bufferPtr.clear(f32PtrToRGBA(bg), null) catch {};
}

export fn bufferGetCharPtr(bufferPtr: *buffer.OptimizedBuffer) [*]u32 {
    return bufferPtr.getCharPtr();
}

export fn bufferGetFgPtr(bufferPtr: *buffer.OptimizedBuffer) [*]RGBA {
    return bufferPtr.getFgPtr();
}

export fn bufferGetBgPtr(bufferPtr: *buffer.OptimizedBuffer) [*]RGBA {
    return bufferPtr.getBgPtr();
}

export fn bufferGetAttributesPtr(bufferPtr: *buffer.OptimizedBuffer) [*]u8 {
    return bufferPtr.getAttributesPtr();
}

export fn bufferGetRespectAlpha(bufferPtr: *buffer.OptimizedBuffer) bool {
    return bufferPtr.getRespectAlpha();
}

export fn bufferSetRespectAlpha(bufferPtr: *buffer.OptimizedBuffer, respectAlpha: bool) void {
    bufferPtr.setRespectAlpha(respectAlpha);
}

export fn bufferGetId(bufferPtr: *buffer.OptimizedBuffer, outPtr: [*]u8, maxLen: usize) usize {
    const id = bufferPtr.getId();
    const copyLen = @min(id.len, maxLen);
    @memcpy(outPtr[0..copyLen], id[0..copyLen]);
    return copyLen;
}

export fn bufferGetRealCharSize(bufferPtr: *buffer.OptimizedBuffer) u32 {
    return bufferPtr.getRealCharSize();
}

export fn bufferWriteResolvedChars(bufferPtr: *buffer.OptimizedBuffer, outputPtr: [*]u8, outputLen: usize, addLineBreaks: bool) u32 {
    const output_slice = outputPtr[0..outputLen];
    return bufferPtr.writeResolvedChars(output_slice, addLineBreaks) catch 0;
}

export fn bufferDrawText(bufferPtr: *buffer.OptimizedBuffer, text: [*]const u8, textLen: usize, x: u32, y: u32, fg: [*]const f32, bg: ?[*]const f32, attributes: u8) void {
    const rgbaFg = f32PtrToRGBA(fg);
    const rgbaBg = if (bg) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    bufferPtr.drawText(text[0..textLen], x, y, rgbaFg, rgbaBg, attributes) catch {};
}

export fn bufferSetCellWithAlphaBlending(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attributes: u8) void {
    const rgbaFg = f32PtrToRGBA(fg);
    const rgbaBg = f32PtrToRGBA(bg);
    bufferPtr.setCellWithAlphaBlending(x, y, char, rgbaFg, rgbaBg, attributes) catch {};
}

export fn bufferSetCell(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attributes: u8) void {
    const rgbaFg = f32PtrToRGBA(fg);
    const rgbaBg = f32PtrToRGBA(bg);
    const cell = buffer.Cell{
        .char = char,
        .fg = rgbaFg,
        .bg = rgbaBg,
        .attributes = attributes,
    };
    bufferPtr.set(x, y, cell);
}

export fn bufferFillRect(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, width: u32, height: u32, bg: [*]const f32) void {
    const rgbaBg = f32PtrToRGBA(bg);
    bufferPtr.fillRect(x, y, width, height, rgbaBg) catch {};
}

export fn bufferDrawPackedBuffer(bufferPtr: *buffer.OptimizedBuffer, data: [*]const u8, dataLen: usize, posX: u32, posY: u32, terminalWidthCells: u32, terminalHeightCells: u32) void {
    bufferPtr.drawPackedBuffer(data, dataLen, posX, posY, terminalWidthCells, terminalHeightCells);
}

export fn bufferPushScissorRect(bufferPtr: *buffer.OptimizedBuffer, x: i32, y: i32, width: u32, height: u32) void {
    bufferPtr.pushScissorRect(x, y, width, height) catch {};
}

export fn bufferPopScissorRect(bufferPtr: *buffer.OptimizedBuffer) void {
    bufferPtr.popScissorRect();
}

export fn bufferClearScissorRects(bufferPtr: *buffer.OptimizedBuffer) void {
    bufferPtr.clearScissorRects();
}

export fn bufferDrawSuperSampleBuffer(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, pixelData: [*]const u8, len: usize, format: u8, alignedBytesPerRow: u32) void {
    bufferPtr.drawSuperSampleBuffer(x, y, pixelData, len, format, alignedBytesPerRow) catch {};
}

export fn bufferDrawBox(
    bufferPtr: *buffer.OptimizedBuffer,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    borderChars: [*]const u32,
    packedOptions: u32,
    borderColor: [*]const f32,
    backgroundColor: [*]const f32,
    title: ?[*]const u8,
    titleLen: u32,
) void {
    const borderSides = buffer.BorderSides{
        .top = (packedOptions & 0b1000) != 0,
        .right = (packedOptions & 0b0100) != 0,
        .bottom = (packedOptions & 0b0010) != 0,
        .left = (packedOptions & 0b0001) != 0,
    };

    const shouldFill = ((packedOptions >> 4) & 1) != 0;
    const titleAlignment = @as(u8, @intCast((packedOptions >> 5) & 0b11));

    const titleSlice = if (title) |t| t[0..titleLen] else null;

    bufferPtr.drawBox(
        x,
        y,
        width,
        height,
        borderChars,
        borderSides,
        f32PtrToRGBA(borderColor),
        f32PtrToRGBA(backgroundColor),
        shouldFill,
        titleSlice,
        titleAlignment,
    ) catch {};
}

export fn bufferResize(bufferPtr: *buffer.OptimizedBuffer, width: u32, height: u32) void {
    bufferPtr.resize(width, height) catch {};
}

export fn resizeRenderer(rendererPtr: *renderer.CliRenderer, width: u32, height: u32) void {
    rendererPtr.resize(width, height) catch {};
}

export fn addToHitGrid(rendererPtr: *renderer.CliRenderer, x: i32, y: i32, width: u32, height: u32, id: u32) void {
    rendererPtr.addToHitGrid(x, y, width, height, id);
}

export fn checkHit(rendererPtr: *renderer.CliRenderer, x: u32, y: u32) u32 {
    return rendererPtr.checkHit(x, y);
}

export fn dumpHitGrid(rendererPtr: *renderer.CliRenderer) void {
    rendererPtr.dumpHitGrid();
}

export fn dumpBuffers(rendererPtr: *renderer.CliRenderer, timestamp: i64) void {
    rendererPtr.dumpBuffers(timestamp);
}

export fn dumpStdoutBuffer(rendererPtr: *renderer.CliRenderer, timestamp: i64) void {
    rendererPtr.dumpStdoutBuffer(timestamp);
}

export fn enableMouse(rendererPtr: *renderer.CliRenderer, enableMovement: bool) void {
    rendererPtr.enableMouse(enableMovement);
}

export fn disableMouse(rendererPtr: *renderer.CliRenderer) void {
    rendererPtr.disableMouse();
}

export fn queryPixelResolution(rendererPtr: *renderer.CliRenderer) void {
    rendererPtr.queryPixelResolution();
}

export fn enableKittyKeyboard(rendererPtr: *renderer.CliRenderer, flags: u8) void {
    rendererPtr.enableKittyKeyboard(flags);
}

export fn disableKittyKeyboard(rendererPtr: *renderer.CliRenderer) void {
    rendererPtr.disableKittyKeyboard();
}

export fn setupTerminal(rendererPtr: *renderer.CliRenderer, useAlternateScreen: bool) void {
    rendererPtr.setupTerminal(useAlternateScreen);
}

export fn createTextBuffer(widthMethod: u8) ?*text_buffer.TextBuffer {
    const pool = gp.initGlobalPool(globalArena);
    const wMethod: gwidth.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;

    const unicode_data = gp.initGlobalUnicodeData(globalArena);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    const tb = text_buffer.TextBuffer.init(std.heap.page_allocator, pool, wMethod, graphemes_ptr, display_width_ptr) catch {
        return null;
    };

    return tb;
}

export fn destroyTextBuffer(tb: *text_buffer.TextBuffer) void {
    tb.deinit();
}

export fn textBufferGetLength(tb: *text_buffer.TextBuffer) u32 {
    return tb.getLength();
}

export fn textBufferGetByteSize(tb: *text_buffer.TextBuffer) u32 {
    return tb.getByteSize();
}

export fn textBufferReset(tb: *text_buffer.TextBuffer) void {
    tb.reset();
}

export fn textBufferSetDefaultFg(tb: *text_buffer.TextBuffer, fg: ?[*]const f32) void {
    const fgColor = if (fg) |fgPtr| f32PtrToRGBA(fgPtr) else null;
    tb.setDefaultFg(fgColor);
}

export fn textBufferSetDefaultBg(tb: *text_buffer.TextBuffer, bg: ?[*]const f32) void {
    const bgColor = if (bg) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    tb.setDefaultBg(bgColor);
}

export fn textBufferSetDefaultAttributes(tb: *text_buffer.TextBuffer, attr: ?[*]const u8) void {
    const attributes = if (attr) |a| a[0] else null;
    tb.setDefaultAttributes(attributes);
}

export fn textBufferResetDefaults(tb: *text_buffer.TextBuffer) void {
    tb.resetDefaults();
}

export fn textBufferSetText(tb: *text_buffer.TextBuffer, textPtr: [*]const u8, textLen: usize) void {
    const text = textPtr[0..textLen];
    tb.setText(text) catch {};
}

// Styled text chunk data passed from TypeScript
pub const StyledChunk = extern struct {
    text_ptr: [*]const u8,
    text_len: usize,
    fg_ptr: ?[*]const f32, // null or pointer to 4 f32s
    bg_ptr: ?[*]const f32, // null or pointer to 4 f32s
    attributes: u8,
};

export fn textBufferSetStyledText(
    tb: *text_buffer.TextBuffer,
    chunksPtr: [*]const StyledChunk,
    chunkCount: usize,
) void {
    if (chunkCount == 0) return;

    const chunks = chunksPtr[0..chunkCount];

    // First, concatenate all chunk texts to get the full text
    var total_len: usize = 0;
    for (chunks) |chunk| {
        total_len += chunk.text_len;
    }

    const full_text = globalArena.alloc(u8, total_len) catch return;
    defer globalArena.free(full_text);

    var offset: usize = 0;
    for (chunks) |chunk| {
        const chunk_text = chunk.text_ptr[0..chunk.text_len];
        @memcpy(full_text[offset .. offset + chunk.text_len], chunk_text);
        offset += chunk.text_len;
    }

    // Set the full text
    tb.setText(full_text) catch return;

    // Clear all highlights
    tb.clearAllHighlights();

    if (tb.syntax_style) |style| {
        var char_pos: u32 = 0;
        for (chunks, 0..) |chunk, i| {
            const chunk_len = tb.measureText(chunk.text_ptr[0..chunk.text_len]);

            if (chunk_len > 0) {
                // Register style for this chunk
                const fg = if (chunk.fg_ptr) |fgPtr| f32PtrToRGBA(fgPtr) else null;
                const bg = if (chunk.bg_ptr) |bgPtr| f32PtrToRGBA(bgPtr) else null;

                const style_name = std.fmt.allocPrint(globalArena, "chunk{d}", .{i}) catch continue;
                const style_id = (@constCast(style)).registerStyle(style_name, fg, bg, chunk.attributes) catch continue;

                // Add highlight for this chunk's range
                tb.addHighlightByCharRange(char_pos, char_pos + chunk_len, style_id, 1, null) catch {};
            }

            char_pos += chunk_len;
        }
    }
}

export fn textBufferGetLineCount(tb: *text_buffer.TextBuffer) u32 {
    return tb.getLineCount();
}

export fn textBufferGetPlainText(tb: *text_buffer.TextBuffer, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return tb.getPlainTextIntoBuffer(outBuffer);
}

// TextBufferView functions
export fn createTextBufferView(tb: *text_buffer.TextBuffer) ?*text_buffer_view.TextBufferView {
    const view = text_buffer_view.TextBufferView.init(std.heap.page_allocator, tb) catch {
        return null;
    };
    return view;
}

export fn destroyTextBufferView(view: *text_buffer_view.TextBufferView) void {
    view.deinit();
}

export fn textBufferViewSetSelection(view: *text_buffer_view.TextBufferView, start: u32, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void {
    const bg = if (bgColor) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| f32PtrToRGBA(fgPtr) else null;
    view.setSelection(start, end, bg, fg);
}

export fn textBufferViewResetSelection(view: *text_buffer_view.TextBufferView) void {
    view.resetSelection();
}

export fn textBufferViewGetSelectionInfo(view: *text_buffer_view.TextBufferView) u64 {
    return view.packSelectionInfo();
}

export fn textBufferViewSetLocalSelection(view: *text_buffer_view.TextBufferView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) bool {
    const bg = if (bgColor) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| f32PtrToRGBA(fgPtr) else null;
    return view.setLocalSelection(anchorX, anchorY, focusX, focusY, bg, fg);
}

export fn textBufferViewResetLocalSelection(view: *text_buffer_view.TextBufferView) void {
    view.resetLocalSelection();
}

export fn textBufferViewSetWrapWidth(view: *text_buffer_view.TextBufferView, width: u32) void {
    view.setWrapWidth(if (width == 0) null else width);
}

export fn textBufferViewSetWrapMode(view: *text_buffer_view.TextBufferView, mode: u8) void {
    const wrapMode: text_buffer.WrapMode = switch (mode) {
        0 => .char,
        1 => .word,
        else => .char,
    };
    view.setWrapMode(wrapMode);
}

export fn textBufferViewGetVirtualLineCount(view: *text_buffer_view.TextBufferView) u32 {
    return view.getVirtualLineCount();
}

export fn textBufferViewGetLineInfoDirect(view: *text_buffer_view.TextBufferView, lineStartsPtr: [*]u32, lineWidthsPtr: [*]u32) u32 {
    const line_info = view.getCachedLineInfo();

    @memcpy(lineStartsPtr[0..line_info.starts.len], line_info.starts);
    @memcpy(lineWidthsPtr[0..line_info.widths.len], line_info.widths);

    return line_info.max_width;
}

export fn textBufferViewGetSelectedText(view: *text_buffer_view.TextBufferView, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return view.getSelectedTextIntoBuffer(outBuffer);
}

export fn textBufferViewGetPlainText(view: *text_buffer_view.TextBufferView, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return view.getPlainTextIntoBuffer(outBuffer);
}

export fn bufferDrawTextBufferView(
    bufferPtr: *buffer.OptimizedBuffer,
    viewPtr: *text_buffer_view.TextBufferView,
    x: i32,
    y: i32,
    clipX: i32,
    clipY: i32,
    clipWidth: u32,
    clipHeight: u32,
    hasClipRect: bool,
) void {
    const clip_rect = if (hasClipRect) buffer.ClipRect{
        .x = clipX,
        .y = clipY,
        .width = clipWidth,
        .height = clipHeight,
    } else null;

    bufferPtr.drawTextBuffer(viewPtr, x, y, clip_rect) catch {};
}

export fn textBufferAddHighlightByCharRange(
    tb: *text_buffer.TextBuffer,
    char_start: u32,
    char_end: u32,
    style_id: u32,
    priority: u8,
    hl_ref: u32,
) void {
    const ref: ?u16 = if (hl_ref == 0xFFFFFFFF) null else @intCast(hl_ref);
    tb.addHighlightByCharRange(char_start, char_end, style_id, priority, ref) catch {};
}

export fn textBufferAddHighlight(
    tb: *text_buffer.TextBuffer,
    line_idx: u32,
    col_start: u32,
    col_end: u32,
    style_id: u32,
    priority: u8,
    hl_ref: u32,
) void {
    const ref: ?u16 = if (hl_ref == 0xFFFFFFFF) null else @intCast(hl_ref);
    tb.addHighlight(line_idx, col_start, col_end, style_id, priority, ref) catch {};
}

export fn textBufferRemoveHighlightsByRef(tb: *text_buffer.TextBuffer, hl_ref: u16) void {
    tb.removeHighlightsByRef(hl_ref);
}

export fn textBufferClearLineHighlights(tb: *text_buffer.TextBuffer, line_idx: u32) void {
    tb.clearLineHighlights(line_idx);
}

export fn textBufferClearAllHighlights(tb: *text_buffer.TextBuffer) void {
    tb.clearAllHighlights();
}

export fn textBufferSetSyntaxStyle(tb: *text_buffer.TextBuffer, style: ?*syntax_style.SyntaxStyle) void {
    tb.setSyntaxStyle(style);
}

// SyntaxStyle functions
export fn createSyntaxStyle() ?*syntax_style.SyntaxStyle {
    return syntax_style.SyntaxStyle.init(std.heap.page_allocator) catch |err| {
        logger.err("Failed to create SyntaxStyle: {}", .{err});
        return null;
    };
}

export fn destroySyntaxStyle(style: *syntax_style.SyntaxStyle) void {
    style.deinit();
}

export fn syntaxStyleRegister(style: *syntax_style.SyntaxStyle, namePtr: [*]const u8, nameLen: usize, fg: ?[*]const f32, bg: ?[*]const f32, attributes: u8) u32 {
    const name = namePtr[0..nameLen];
    const fgColor = if (fg) |fgPtr| f32PtrToRGBA(fgPtr) else null;
    const bgColor = if (bg) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    return style.registerStyle(name, fgColor, bgColor, attributes) catch 0;
}

export fn syntaxStyleResolveByName(style: *syntax_style.SyntaxStyle, namePtr: [*]const u8, nameLen: usize) u32 {
    const name = namePtr[0..nameLen];
    return style.resolveByName(name) orelse 0;
}

export fn syntaxStyleGetStyleCount(style: *syntax_style.SyntaxStyle) usize {
    return style.getStyleCount();
}
