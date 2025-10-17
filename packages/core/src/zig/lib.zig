const std = @import("std");
const Allocator = std.mem.Allocator;

const ansi = @import("ansi.zig");
const buffer = @import("buffer.zig");
const renderer = @import("renderer.zig");
const gp = @import("grapheme.zig");
const text_buffer = @import("text-buffer.zig");
const text_buffer_view = @import("text-buffer-view.zig");
const edit_buffer_mod = @import("edit-buffer.zig");
const editor_view = @import("editor-view.zig");
const syntax_style = @import("syntax-style.zig");
const terminal = @import("terminal.zig");
const gwidth = @import("gwidth.zig");
const logger = @import("logger.zig");
const utils = @import("utils.zig");

pub const OptimizedBuffer = buffer.OptimizedBuffer;
pub const CliRenderer = renderer.CliRenderer;
pub const Terminal = terminal.Terminal;
pub const RGBA = buffer.RGBA;

export fn setLogCallback(callback: ?*const fn (level: u8, msgPtr: [*]const u8, msgLen: usize) callconv(.C) void) void {
    logger.setLogCallback(callback);
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
    rendererPtr.setBackgroundColor(utils.f32PtrToRGBA(color));
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
    rendererPtr.terminal.setCursorColor(utils.f32PtrToRGBA(color));
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
    bufferPtr.clear(utils.f32PtrToRGBA(bg), null) catch {};
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
    const rgbaFg = utils.f32PtrToRGBA(fg);
    const rgbaBg = if (bg) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    bufferPtr.drawText(text[0..textLen], x, y, rgbaFg, rgbaBg, attributes) catch {};
}

export fn bufferSetCellWithAlphaBlending(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attributes: u8) void {
    const rgbaFg = utils.f32PtrToRGBA(fg);
    const rgbaBg = utils.f32PtrToRGBA(bg);
    bufferPtr.setCellWithAlphaBlending(x, y, char, rgbaFg, rgbaBg, attributes) catch {};
}

export fn bufferSetCell(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attributes: u8) void {
    const rgbaFg = utils.f32PtrToRGBA(fg);
    const rgbaBg = utils.f32PtrToRGBA(bg);
    const cell = buffer.Cell{
        .char = char,
        .fg = rgbaFg,
        .bg = rgbaBg,
        .attributes = attributes,
    };
    bufferPtr.set(x, y, cell);
}

export fn bufferFillRect(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, width: u32, height: u32, bg: [*]const f32) void {
    const rgbaBg = utils.f32PtrToRGBA(bg);
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
        utils.f32PtrToRGBA(borderColor),
        utils.f32PtrToRGBA(backgroundColor),
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

export fn createTextBuffer(widthMethod: u8) ?*text_buffer.TextBufferArray {
    const pool = gp.initGlobalPool(globalArena);
    const wMethod: gwidth.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;

    const unicode_data = gp.initGlobalUnicodeData(globalArena);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    const tb = text_buffer.TextBufferArray.init(std.heap.page_allocator, pool, wMethod, graphemes_ptr, display_width_ptr) catch {
        return null;
    };

    return tb;
}

export fn destroyTextBuffer(tb: *text_buffer.TextBufferArray) void {
    tb.deinit();
}

export fn textBufferGetLength(tb: *text_buffer.TextBufferArray) u32 {
    return tb.getLength();
}

export fn textBufferGetByteSize(tb: *text_buffer.TextBufferArray) u32 {
    return tb.getByteSize();
}

export fn textBufferReset(tb: *text_buffer.TextBufferArray) void {
    tb.reset();
}

export fn textBufferSetDefaultFg(tb: *text_buffer.TextBufferArray, fg: ?[*]const f32) void {
    const fgColor = if (fg) |fgPtr| utils.f32PtrToRGBA(fgPtr) else null;
    tb.setDefaultFg(fgColor);
}

export fn textBufferSetDefaultBg(tb: *text_buffer.TextBufferArray, bg: ?[*]const f32) void {
    const bgColor = if (bg) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    tb.setDefaultBg(bgColor);
}

export fn textBufferSetDefaultAttributes(tb: *text_buffer.TextBufferArray, attr: ?[*]const u8) void {
    const attributes = if (attr) |a| a[0] else null;
    tb.setDefaultAttributes(attributes);
}

export fn textBufferResetDefaults(tb: *text_buffer.TextBufferArray) void {
    tb.resetDefaults();
}

export fn textBufferSetText(tb: *text_buffer.TextBufferArray, textPtr: [*]const u8, textLen: usize) void {
    const text = textPtr[0..textLen];
    tb.setText(text) catch {};
}

export fn textBufferLoadFile(tb: *text_buffer.TextBufferArray, pathPtr: [*]const u8, pathLen: usize) bool {
    const path = pathPtr[0..pathLen];
    tb.loadFile(path) catch return false;
    return true;
}

export fn textBufferSetStyledText(
    tb: *text_buffer.TextBufferArray,
    chunksPtr: [*]const text_buffer.StyledChunk,
    chunkCount: usize,
) void {
    if (chunkCount == 0) return;
    const chunks = chunksPtr[0..chunkCount];
    tb.setStyledText(chunks) catch {};
}

export fn textBufferGetLineCount(tb: *text_buffer.TextBufferArray) u32 {
    return tb.getLineCount();
}

export fn textBufferGetPlainText(tb: *text_buffer.TextBufferArray, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return tb.getPlainTextIntoBuffer(outBuffer);
}

// TextBufferView functions (Array-based for backward compatibility)
export fn createTextBufferView(tb: *text_buffer.TextBufferArray) ?*text_buffer_view.TextBufferViewArray {
    const view = text_buffer_view.TextBufferViewArray.init(std.heap.page_allocator, tb) catch {
        return null;
    };
    return view;
}

export fn destroyTextBufferView(view: *text_buffer_view.TextBufferViewArray) void {
    view.deinit();
}

export fn textBufferViewSetSelection(view: *text_buffer_view.TextBufferViewArray, start: u32, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void {
    const bg = if (bgColor) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| utils.f32PtrToRGBA(fgPtr) else null;
    view.setSelection(start, end, bg, fg);
}

export fn textBufferViewResetSelection(view: *text_buffer_view.TextBufferViewArray) void {
    view.resetSelection();
}

export fn textBufferViewGetSelectionInfo(view: *text_buffer_view.TextBufferViewArray) u64 {
    return view.packSelectionInfo();
}

export fn textBufferViewSetLocalSelection(view: *text_buffer_view.TextBufferViewArray, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) bool {
    const bg = if (bgColor) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| utils.f32PtrToRGBA(fgPtr) else null;
    return view.setLocalSelection(anchorX, anchorY, focusX, focusY, bg, fg);
}

export fn textBufferViewResetLocalSelection(view: *text_buffer_view.TextBufferViewArray) void {
    view.resetLocalSelection();
}

export fn textBufferViewSetWrapWidth(view: *text_buffer_view.TextBufferViewArray, width: u32) void {
    view.setWrapWidth(if (width == 0) null else width);
}

export fn textBufferViewSetWrapMode(view: *text_buffer_view.TextBufferViewArray, mode: u8) void {
    const wrapMode: text_buffer.WrapMode = switch (mode) {
        0 => .none,
        1 => .char,
        2 => .word,
        else => .none,
    };
    view.setWrapMode(wrapMode);
}

export fn textBufferViewGetVirtualLineCount(view: *text_buffer_view.TextBufferViewArray) u32 {
    return view.getVirtualLineCount();
}

export fn textBufferViewGetLineInfoDirect(view: *text_buffer_view.TextBufferViewArray, lineStartsPtr: [*]u32, lineWidthsPtr: [*]u32) u32 {
    const line_info = view.getCachedLineInfo();

    @memcpy(lineStartsPtr[0..line_info.starts.len], line_info.starts);
    @memcpy(lineWidthsPtr[0..line_info.widths.len], line_info.widths);

    return line_info.max_width;
}

export fn textBufferViewGetSelectedText(view: *text_buffer_view.TextBufferViewArray, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return view.getSelectedTextIntoBuffer(outBuffer);
}

export fn textBufferViewGetPlainText(view: *text_buffer_view.TextBufferViewArray, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return view.getPlainTextIntoBuffer(outBuffer);
}

// ===== EditBuffer Exports =====

export fn createEditBuffer(widthMethod: u8) ?*edit_buffer_mod.EditBuffer {
    const pool = gp.initGlobalPool(globalArena);
    const wMethod: gwidth.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;
    const unicode_data = gp.initGlobalUnicodeData(globalArena);
    const graphemes_ptr, const display_width_ptr = unicode_data;

    return edit_buffer_mod.EditBuffer.init(
        std.heap.page_allocator,
        pool,
        wMethod,
        graphemes_ptr,
        display_width_ptr,
    ) catch null;
}

export fn destroyEditBuffer(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.deinit();
}

export fn editBufferGetTextBuffer(edit_buffer: *edit_buffer_mod.EditBuffer) *text_buffer.TextBufferRope {
    return edit_buffer.getTextBuffer();
}

export fn editBufferInsertText(edit_buffer: *edit_buffer_mod.EditBuffer, textPtr: [*]const u8, textLen: usize) void {
    const text = textPtr[0..textLen];
    edit_buffer.insertText(text) catch {};
}

export fn editBufferDeleteRange(edit_buffer: *edit_buffer_mod.EditBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32) void {
    const start = edit_buffer_mod.Cursor{ .row = start_row, .col = start_col };
    const end = edit_buffer_mod.Cursor{ .row = end_row, .col = end_col };
    edit_buffer.deleteRange(start, end) catch {};
}

export fn editBufferDeleteCharBackward(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.backspace() catch {};
}

export fn editBufferDeleteChar(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.deleteForward() catch {};
}

export fn editBufferMoveCursorLeft(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.moveLeft();
}

export fn editBufferMoveCursorRight(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.moveRight();
}

export fn editBufferMoveCursorUp(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.moveUp();
}

export fn editBufferMoveCursorDown(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.moveDown();
}

export fn editBufferGetCursor(edit_buffer: *edit_buffer_mod.EditBuffer, outRow: *u32, outCol: *u32) void {
    const cursor = edit_buffer.getPrimaryCursor();
    outRow.* = cursor.row;
    outCol.* = cursor.col;
}

export fn editBufferSetCursor(edit_buffer: *edit_buffer_mod.EditBuffer, row: u32, col: u32) void {
    edit_buffer.setCursor(row, col) catch {};
}

export fn editBufferSetCursorToLineCol(edit_buffer: *edit_buffer_mod.EditBuffer, row: u32, col: u32) void {
    edit_buffer.setCursor(row, col) catch {};
}

export fn editBufferSetText(edit_buffer: *edit_buffer_mod.EditBuffer, textPtr: [*]const u8, textLen: usize) void {
    const text = textPtr[0..textLen];
    edit_buffer.setText(text) catch {};
}

export fn editBufferGetText(edit_buffer: *edit_buffer_mod.EditBuffer, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return edit_buffer.getText(outBuffer);
}

export fn editBufferInsertChar(edit_buffer: *edit_buffer_mod.EditBuffer, charPtr: [*]const u8, charLen: usize) void {
    const text = charPtr[0..charLen];
    edit_buffer.insertText(text) catch {};
}

export fn editBufferNewLine(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.insertText("\n") catch {};
}

export fn editBufferDeleteLine(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.deleteLine() catch {};
}

export fn editBufferGotoLine(edit_buffer: *edit_buffer_mod.EditBuffer, line: u32) void {
    edit_buffer.gotoLine(line) catch {};
}

export fn editBufferGetCursorPosition(edit_buffer: *edit_buffer_mod.EditBuffer, outLine: *u32, outVisualCol: *u32) void {
    const pos = edit_buffer.getCursorPosition();
    outLine.* = pos.line;
    outVisualCol.* = pos.visual_col;
}

export fn editBufferDebugLogRope(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.debugLogRope();
}

export fn editBufferUndo(edit_buffer: *edit_buffer_mod.EditBuffer, outPtr: [*]u8, maxLen: usize) usize {
    const prev_meta = edit_buffer.undo() catch return 0;
    const copyLen = @min(prev_meta.len, maxLen);
    @memcpy(outPtr[0..copyLen], prev_meta[0..copyLen]);
    return copyLen;
}

export fn editBufferRedo(edit_buffer: *edit_buffer_mod.EditBuffer, outPtr: [*]u8, maxLen: usize) usize {
    const next_meta = edit_buffer.redo() catch return 0;
    const copyLen = @min(next_meta.len, maxLen);
    @memcpy(outPtr[0..copyLen], next_meta[0..copyLen]);
    return copyLen;
}

export fn editBufferCanUndo(edit_buffer: *edit_buffer_mod.EditBuffer) bool {
    return edit_buffer.canUndo();
}

export fn editBufferCanRedo(edit_buffer: *edit_buffer_mod.EditBuffer) bool {
    return edit_buffer.canRedo();
}

export fn editBufferClearHistory(edit_buffer: *edit_buffer_mod.EditBuffer) void {
    edit_buffer.clearHistory();
}

// ===== EditorView Exports =====

export fn createEditorView(edit_buffer: *edit_buffer_mod.EditBuffer, viewport_width: u32, viewport_height: u32) ?*editor_view.EditorView {
    return editor_view.EditorView.init(globalArena, edit_buffer, viewport_width, viewport_height) catch null;
}

export fn destroyEditorView(view: *editor_view.EditorView) void {
    view.deinit();
}

export fn editorViewSetViewport(view: *editor_view.EditorView, x: u32, y: u32, width: u32, height: u32) void {
    view.setViewport(text_buffer_view.Viewport{ .x = x, .y = y, .width = width, .height = height });
}

export fn editorViewClearViewport(view: *editor_view.EditorView) void {
    view.setViewport(null);
}

export fn editorViewGetViewport(view: *editor_view.EditorView, outX: *u32, outY: *u32, outWidth: *u32, outHeight: *u32) bool {
    view.updateBeforeRender();

    if (view.getViewport()) |vp| {
        outX.* = vp.x;
        outY.* = vp.y;
        outWidth.* = vp.width;
        outHeight.* = vp.height;
        return true;
    }
    return false;
}

export fn editorViewSetScrollMargin(view: *editor_view.EditorView, margin: f32) void {
    view.setScrollMargin(margin);
}

export fn editorViewEnsureCursorVisible(view: *editor_view.EditorView, cursor_line: u32) void {
    view.ensureCursorVisible(cursor_line);
}

export fn editorViewGetVirtualLineCount(view: *editor_view.EditorView) u32 {
    // TODO: There is a getter for that directly, no?
    return @intCast(view.getVirtualLines().len);
}

export fn editorViewGetTotalVirtualLineCount(view: *editor_view.EditorView) u32 {
    return view.getTotalVirtualLineCount();
}

export fn editorViewGetLineInfoDirect(view: *editor_view.EditorView, lineStartsPtr: [*]u32, lineWidthsPtr: [*]u32) u32 {
    const line_info = view.getCachedLineInfo();
    for (line_info.starts, 0..) |start, i| {
        lineStartsPtr[i] = start;
    }
    for (line_info.widths, 0..) |width, i| {
        lineWidthsPtr[i] = width;
    }
    return line_info.max_width;
}

export fn editorViewGetTextBufferView(view: *editor_view.EditorView) *text_buffer_view.TextBufferViewRope {
    return view.getTextBufferView();
}

export fn editorViewSetViewportSize(view: *editor_view.EditorView, width: u32, height: u32) void {
    view.setViewportSize(width, height);
}

export fn editorViewSetWrapMode(view: *editor_view.EditorView, mode: u8) void {
    const wrapMode: text_buffer.WrapMode = switch (mode) {
        0 => .none,
        1 => .char,
        2 => .word,
        else => .none,
    };
    view.setWrapMode(wrapMode);
}

// EditorView selection methods - delegate to TextBufferView
export fn editorViewSetSelection(view: *editor_view.EditorView, start: u32, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void {
    const bg = if (bgColor) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| utils.f32PtrToRGBA(fgPtr) else null;
    view.text_buffer_view.setSelection(start, end, bg, fg);
}

export fn editorViewResetSelection(view: *editor_view.EditorView) void {
    view.text_buffer_view.resetSelection();
}

export fn editorViewGetSelection(view: *editor_view.EditorView) u64 {
    return view.text_buffer_view.packSelectionInfo();
}

export fn editorViewSetLocalSelection(view: *editor_view.EditorView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) bool {
    const bg = if (bgColor) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| utils.f32PtrToRGBA(fgPtr) else null;
    return view.text_buffer_view.setLocalSelection(anchorX, anchorY, focusX, focusY, bg, fg);
}

export fn editorViewResetLocalSelection(view: *editor_view.EditorView) void {
    view.text_buffer_view.resetLocalSelection();
}

export fn editorViewGetSelectedTextBytes(view: *editor_view.EditorView, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return view.text_buffer_view.getSelectedTextIntoBuffer(outBuffer);
}

// EditorView cursor and text methods
export fn editorViewGetCursor(view: *editor_view.EditorView, outRow: *u32, outCol: *u32) void {
    const cursor = view.getPrimaryCursor();
    outRow.* = cursor.row;
    outCol.* = cursor.col;
}

export fn editorViewGetText(view: *editor_view.EditorView, outPtr: [*]u8, maxLen: usize) usize {
    const outBuffer = outPtr[0..maxLen];
    return view.getText(outBuffer);
}

// ===== EditorView VisualCursor Exports =====

export fn editorViewGetVisualCursor(
    view: *editor_view.EditorView,
    outVisualRow: *u32,
    outVisualCol: *u32,
    outLogicalRow: *u32,
    outLogicalCol: *u32,
) bool {
    if (view.getVisualCursor()) |vcursor| {
        outVisualRow.* = vcursor.visual_row;
        outVisualCol.* = vcursor.visual_col;
        outLogicalRow.* = vcursor.logical_row;
        outLogicalCol.* = vcursor.logical_col;
        return true;
    }
    return false;
}

export fn editorViewLogicalToVisualCursor(
    view: *editor_view.EditorView,
    logical_row: u32,
    logical_col: u32,
    outVisualRow: *u32,
    outVisualCol: *u32,
) bool {
    if (view.logicalToVisualCursor(logical_row, logical_col)) |vcursor| {
        outVisualRow.* = vcursor.visual_row;
        outVisualCol.* = vcursor.visual_col;
        return true;
    }
    return false;
}

export fn editorViewVisualToLogicalCursor(
    view: *editor_view.EditorView,
    visual_row: u32,
    visual_col: u32,
    outLogicalRow: *u32,
    outLogicalCol: *u32,
) bool {
    if (view.visualToLogicalCursor(visual_row, visual_col)) |vcursor| {
        outLogicalRow.* = vcursor.logical_row;
        outLogicalCol.* = vcursor.logical_col;
        return true;
    }
    return false;
}

export fn editorViewMoveUpVisual(view: *editor_view.EditorView) void {
    view.moveUpVisual();
}

export fn editorViewMoveDownVisual(view: *editor_view.EditorView) void {
    view.moveDownVisual();
}

export fn editorViewDeleteSelectedText(view: *editor_view.EditorView) void {
    view.deleteSelectedText() catch {};
}

export fn bufferDrawEditorView(
    bufferPtr: *buffer.OptimizedBuffer,
    viewPtr: *editor_view.EditorView,
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

    bufferPtr.drawEditorView(viewPtr, x, y, clip_rect) catch {};
}

export fn bufferDrawTextBufferView(
    bufferPtr: *buffer.OptimizedBuffer,
    viewPtr: *text_buffer_view.TextBufferViewArray,
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
    tb: *text_buffer.TextBufferArray,
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
    tb: *text_buffer.TextBufferArray,
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

export fn textBufferRemoveHighlightsByRef(tb: *text_buffer.TextBufferArray, hl_ref: u16) void {
    tb.removeHighlightsByRef(hl_ref);
}

export fn textBufferClearLineHighlights(tb: *text_buffer.TextBufferArray, line_idx: u32) void {
    tb.clearLineHighlights(line_idx);
}

export fn textBufferClearAllHighlights(tb: *text_buffer.TextBufferArray) void {
    tb.clearAllHighlights();
}

export fn textBufferSetSyntaxStyle(tb: *text_buffer.TextBufferArray, style: ?*syntax_style.SyntaxStyle) void {
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
    const fgColor = if (fg) |fgPtr| utils.f32PtrToRGBA(fgPtr) else null;
    const bgColor = if (bg) |bgPtr| utils.f32PtrToRGBA(bgPtr) else null;
    return style.registerStyle(name, fgColor, bgColor, attributes) catch 0;
}

export fn syntaxStyleResolveByName(style: *syntax_style.SyntaxStyle, namePtr: [*]const u8, nameLen: usize) u32 {
    const name = namePtr[0..nameLen];
    return style.resolveByName(name) orelse 0;
}

export fn syntaxStyleGetStyleCount(style: *syntax_style.SyntaxStyle) usize {
    return style.getStyleCount();
}
