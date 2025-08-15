const std = @import("std");
const log = std.log;
const Allocator = std.mem.Allocator;

const ansi = @import("ansi.zig");
const buffer = @import("buffer.zig");
const renderer = @import("renderer.zig");

pub const OptimizedBuffer = buffer.OptimizedBuffer;
pub const CliRenderer = renderer.CliRenderer;
pub const RGBA = buffer.RGBA;

fn f32PtrToRGBA(ptr: [*]const f32) RGBA {
    return .{ ptr[0], ptr[1], ptr[2], ptr[3] };
}

var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
const allocator = arena.allocator();

export fn createRenderer(width: u32, height: u32) ?*renderer.CliRenderer {
    if (width == 0 or height == 0) {
        log.warn("Invalid renderer dimensions: {}x{}", .{ width, height });
        return null;
    }

    return renderer.CliRenderer.create(allocator, width, height) catch |err| {
        log.err("Failed to create renderer: {}", .{err});
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

export fn createOptimizedBuffer(width: u32, height: u32, respectAlpha: bool) ?*buffer.OptimizedBuffer {
    if (width == 0 or height == 0) {
        log.warn("Invalid buffer dimensions: {}x{}", .{ width, height });
        return null;
    }

    return buffer.OptimizedBuffer.init(allocator, width, height, .{
        .respectAlpha = respectAlpha,
    }) catch |err| {
        log.err("Failed to create optimized buffer: {}", .{err});
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

export fn setCursorPosition(x: i32, y: i32, visible: bool) void {
    renderer.setCursorPositionGlobal(x, y, visible);
}

export fn setCursorStyle(stylePtr: [*]const u8, styleLen: usize, blinking: bool) void {
    const style = stylePtr[0..styleLen];
    renderer.setCursorStyleGlobal(style, blinking);
}

export fn setCursorColor(color: [*]const f32) void {
    renderer.setCursorColorGlobal(f32PtrToRGBA(color));
}

export fn setDebugOverlay(rendererPtr: *renderer.CliRenderer, enabled: bool, corner: u8) void {
    // Convert the u8 value to the proper enum value
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

export fn bufferFillRect(bufferPtr: *buffer.OptimizedBuffer, x: u32, y: u32, width: u32, height: u32, bg: [*]const f32) void {
    const rgbaBg = f32PtrToRGBA(bg);
    bufferPtr.fillRect(x, y, width, height, rgbaBg) catch {};
}

export fn bufferDrawPackedBuffer(bufferPtr: *buffer.OptimizedBuffer, data: [*]const u8, dataLen: usize, posX: u32, posY: u32, terminalWidthCells: u32, terminalHeightCells: u32) void {
    bufferPtr.drawPackedBuffer(data, dataLen, posX, posY, terminalWidthCells, terminalHeightCells);
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

// ====== TextBuffer exports ======
const text_buffer = @import("text-buffer.zig");

export fn createTextBuffer(length: u32) ?*text_buffer.TextBuffer {
    const tb = text_buffer.TextBuffer.init(allocator, length) catch return null;
    return tb;
}

export fn destroyTextBuffer(tb: *text_buffer.TextBuffer) void {
    tb.deinit();
}

export fn textBufferGetCharPtr(tb: *text_buffer.TextBuffer) [*]u32 {
    return tb.getCharPtr();
}

export fn textBufferGetFgPtr(tb: *text_buffer.TextBuffer) [*]RGBA {
    return tb.getFgPtr();
}

export fn textBufferGetBgPtr(tb: *text_buffer.TextBuffer) [*]RGBA {
    return tb.getBgPtr();
}

export fn textBufferGetAttributesPtr(tb: *text_buffer.TextBuffer) [*]u16 {
    return tb.getAttributesPtr();
}

export fn textBufferGetLength(tb: *text_buffer.TextBuffer) u32 {
    return tb.getLength();
}

export fn textBufferSetCell(tb: *text_buffer.TextBuffer, index: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attr: u16) void {
    tb.setCell(index, char, f32PtrToRGBA(fg), f32PtrToRGBA(bg), attr) catch {};
}

export fn textBufferConcat(tb1: *text_buffer.TextBuffer, tb2: *text_buffer.TextBuffer) ?*text_buffer.TextBuffer {
    const result = tb1.concat(tb2) catch return null;
    return result;
}

export fn textBufferResize(tb: *text_buffer.TextBuffer, newLength: u32) void {
    tb.resize(newLength) catch {};
}

export fn textBufferReset(tb: *text_buffer.TextBuffer) void {
    tb.reset();
}

export fn textBufferSetSelection(tb: *text_buffer.TextBuffer, start: u32, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void {
    const bg = if (bgColor) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    const fg = if (fgColor) |fgPtr| f32PtrToRGBA(fgPtr) else null;
    tb.setSelection(start, end, bg, fg);
}

export fn textBufferResetSelection(tb: *text_buffer.TextBuffer) void {
    tb.resetSelection();
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
    const attrValue = if (attr) |a| a[0] else null;
    tb.setDefaultAttributes(attrValue);
}

export fn textBufferResetDefaults(tb: *text_buffer.TextBuffer) void {
    tb.resetDefaults();
}

export fn textBufferWriteChunk(tb: *text_buffer.TextBuffer, textBytes: [*]const u8, textLen: u32, fg: ?[*]const f32, bg: ?[*]const f32, attr: ?[*]const u8) u32 {
    const textSlice = textBytes[0..textLen];
    const fgColor = if (fg) |fgPtr| f32PtrToRGBA(fgPtr) else null;
    const bgColor = if (bg) |bgPtr| f32PtrToRGBA(bgPtr) else null;
    const attrValue = if (attr) |a| a[0] else null;

    return tb.writeChunk(textSlice, fgColor, bgColor, attrValue) catch 0;
}

export fn textBufferGetCapacity(tb: *text_buffer.TextBuffer) u32 {
    return tb.getCapacity();
}

export fn textBufferFinalizeLineInfo(tb: *text_buffer.TextBuffer) void {
    tb.finalizeLineInfo();
}

export fn textBufferGetLineStartsPtr(tb: *text_buffer.TextBuffer) [*]const u32 {
    return tb.getLineStarts().ptr;
}

export fn textBufferGetLineWidthsPtr(tb: *text_buffer.TextBuffer) [*]const u32 {
    return tb.getLineWidths().ptr;
}

export fn textBufferGetLineCount(tb: *text_buffer.TextBuffer) u32 {
    return tb.getLineCount();
}

export fn bufferDrawTextBuffer(
    bufferPtr: *buffer.OptimizedBuffer,
    textBufferPtr: *text_buffer.TextBuffer,
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

    bufferPtr.drawTextBuffer(textBufferPtr, x, y, clip_rect) catch {};
}
