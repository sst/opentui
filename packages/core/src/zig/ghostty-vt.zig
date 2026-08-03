pub const c = @cImport({
    @cDefine("GHOSTTY_STATIC", "1");
    @cInclude("ghostty/vt.h");
});

pub const expected_version = "0.1.0-dev+74d0c72f";

pub fn buildVersion() ?[]const u8 {
    var value: c.GhosttyString = undefined;
    if (c.ghostty_build_info(c.GHOSTTY_BUILD_INFO_VERSION_STRING, &value) != c.GHOSTTY_SUCCESS) return null;
    if (value.ptr == null) return if (value.len == 0) "" else null;
    return value.ptr[0..value.len];
}

pub fn isExpectedBuild() bool {
    const version = buildVersion() orelse return false;
    if (!std.mem.eql(u8, version, expected_version)) return false;

    var simd = true;
    if (c.ghostty_build_info(c.GHOSTTY_BUILD_INFO_SIMD, &simd) != c.GHOSTTY_SUCCESS) return false;
    return !simd;
}

pub fn smokeTest() bool {
    var terminal: c.GhosttyTerminal = null;
    if (c.ghostty_terminal_new(null, &terminal, .{
        .cols = 16,
        .rows = 4,
        .max_scrollback = 100,
    }) != c.GHOSTTY_SUCCESS) return false;
    defer c.ghostty_terminal_free(terminal);

    const input = "\x1b[31mhello\x1b[0m";
    c.ghostty_terminal_vt_write(terminal, input, input.len);

    var options = std.mem.zeroes(c.GhosttyFormatterTerminalOptions);
    options.size = @sizeOf(c.GhosttyFormatterTerminalOptions);
    options.emit = c.GHOSTTY_FORMATTER_FORMAT_PLAIN;
    options.trim = true;
    options.extra.size = @sizeOf(c.GhosttyFormatterTerminalExtra);
    options.extra.screen.size = @sizeOf(c.GhosttyFormatterScreenExtra);

    var formatter: c.GhosttyFormatter = null;
    if (c.ghostty_formatter_terminal_new(null, &formatter, terminal, options) != c.GHOSTTY_SUCCESS) return false;
    defer c.ghostty_formatter_free(formatter);

    var output: [256]u8 = undefined;
    var written: usize = 0;
    if (c.ghostty_formatter_format_buf(formatter, &output, output.len, &written) != c.GHOSTTY_SUCCESS) return false;
    return std.mem.indexOf(u8, output[0..written], "hello") != null;
}

const std = @import("std");
