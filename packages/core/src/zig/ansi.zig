const std = @import("std");
const Allocator = std.mem.Allocator;

pub const RGBA = [4]f32;

pub const AnsiError = error{
    InvalidFormat,
    WriteFailed,
};

pub const ANSI = struct {
    pub const reset = "\x1b[0m";
    pub const clear = "\x1b[2J";
    pub const home = "\x1b[H";
    pub const clearAndHome = "\x1b[H\x1b[2J";
    pub const hideCursor = "\x1b[?25l";
    pub const showCursor = "\x1b[?25h";
    pub const defaultCursorStyle = "\x1b[0 q";
    pub const queryPixelSize = "\x1b[14t";
    pub const nextLine = "\x1b[E";

    // Direct writing to any writer - the most efficient option
    pub fn moveToOutput(writer: anytype, x: u32, y: u32) AnsiError!void {
        writer.print("\x1b[{d};{d}H", .{ y, x }) catch return AnsiError.WriteFailed;
    }

    pub fn fgColorOutput(writer: anytype, r: u8, g: u8, b: u8) AnsiError!void {
        writer.print("\x1b[38;2;{d};{d};{d}m", .{ r, g, b }) catch return AnsiError.WriteFailed;
    }

    pub fn bgColorOutput(writer: anytype, r: u8, g: u8, b: u8) AnsiError!void {
        writer.print("\x1b[48;2;{d};{d};{d}m", .{ r, g, b }) catch return AnsiError.WriteFailed;
    }

    // 256-color mode output functions (for terminals without truecolor support)
    pub fn fgColor256Output(writer: anytype, index: u8) AnsiError!void {
        std.fmt.format(writer, "\x1b[38;5;{d}m", .{index}) catch return AnsiError.WriteFailed;
    }

    pub fn bgColor256Output(writer: anytype, index: u8) AnsiError!void {
        std.fmt.format(writer, "\x1b[48;5;{d}m", .{index}) catch return AnsiError.WriteFailed;
    }

    // Text attribute constants
    pub const bold = "\x1b[1m";
    pub const dim = "\x1b[2m";
    pub const italic = "\x1b[3m";
    pub const underline = "\x1b[4m";
    pub const blink = "\x1b[5m";
    pub const inverse = "\x1b[7m";
    pub const hidden = "\x1b[8m";
    pub const strikethrough = "\x1b[9m";

    // Cursor styles
    pub const cursorBlock = "\x1b[2 q";
    pub const cursorBlockBlink = "\x1b[1 q";
    pub const cursorLine = "\x1b[6 q";
    pub const cursorLineBlink = "\x1b[5 q";
    pub const cursorUnderline = "\x1b[4 q";
    pub const cursorUnderlineBlink = "\x1b[3 q";

    pub fn cursorColorOutputWriter(writer: anytype, r: u8, g: u8, b: u8) AnsiError!void {
        writer.print("\x1b]12;#{x:0>2}{x:0>2}{x:0>2}\x07", .{ r, g, b }) catch return AnsiError.WriteFailed;
    }

    pub fn explicitWidthOutput(writer: anytype, width: u32, text: []const u8) AnsiError!void {
        writer.print("\x1b]66;w={d};{s}\x1b\\", .{ width, text }) catch return AnsiError.WriteFailed;
    }

    pub const resetCursorColor = "\x1b]112\x07";
    pub const resetCursorColorFallback = "\x1b]12;default\x07";
    pub const resetMousePointer = "\x1b]22;\x07";
    pub const saveCursorState = "\x1b[s";
    pub const restoreCursorState = "\x1b[u";

    pub fn setMousePointerOutput(writer: anytype, shape: []const u8) AnsiError!void {
        writer.print("\x1b]22;{s}\x07", .{ shape }) catch return AnsiError.WriteFailed;
    }

    pub const switchToAlternateScreen = "\x1b[?1049h";
    pub const switchToMainScreen = "\x1b[?1049l";

    pub const enableMouseTracking = "\x1b[?1000h";
    pub const disableMouseTracking = "\x1b[?1000l";
    pub const enableButtonEventTracking = "\x1b[?1002h";
    pub const disableButtonEventTracking = "\x1b[?1002l";
    pub const enableAnyEventTracking = "\x1b[?1003h";
    pub const disableAnyEventTracking = "\x1b[?1003l";
    pub const enableSGRMouseMode = "\x1b[?1006h";
    pub const disableSGRMouseMode = "\x1b[?1006l";
    pub const mouseSetPixels = "\x1b[?1002;1003;1004;1016h";

    // Terminal capability queries
    pub const primaryDeviceAttrs = "\x1b[c";
    pub const tertiaryDeviceAttrs = "\x1b[=c";
    pub const deviceStatusReport = "\x1b[5n";
    pub const xtversion = "\x1b[>0q";
    pub const decrqmFocus = "\x1b[?1004$p";
    pub const decrqmSgrPixels = "\x1b[?1016$p";
    pub const decrqmBracketedPaste = "\x1b[?2004$p";
    pub const decrqmSync = "\x1b[?2026$p";
    pub const decrqmUnicode = "\x1b[?2027$p";
    pub const decrqmColorScheme = "\x1b[?2031$p";
    pub const csiUQuery = "\x1b[?u";
    pub const kittyGraphicsQuery = "\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c";

    pub const capabilityQueriesBase = decrqmSgrPixels ++
        decrqmUnicode ++
        decrqmColorScheme ++
        decrqmFocus ++
        decrqmBracketedPaste ++
        decrqmSync;

    pub const capabilityQueries = capabilityQueriesBase ++ csiUQuery;

    // tmux DCS passthrough wrapper (ESC chars doubled)
    pub const tmuxDcsStart = "\x1bPtmux;";
    pub const tmuxDcsEnd = "\x1b\\";

    // GNU Screen DCS passthrough wrapper (no tmux prefix)
    pub const screenDcsStart = "\x1bP";
    pub const screenDcsEnd = "\x1b\\";

    pub fn wrapForTmux(comptime seq: []const u8) []const u8 {
        comptime {
            var result: []const u8 = tmuxDcsStart;
            for (seq) |c| {
                if (c == '\x1b') {
                    result = result ++ "\x1b\x1b";
                } else {
                    result = result ++ &[_]u8{c};
                }
            }
            return result ++ tmuxDcsEnd;
        }
    }

    pub const kittyGraphicsQueryTmux = wrapForTmux(kittyGraphicsQuery);
    pub const capabilityQueriesTmux = wrapForTmux(capabilityQueriesBase) ++ csiUQuery;
    pub const sixelGeometryQuery = "\x1b[?2;1;0S";
    pub const cursorPositionRequest = "\x1b[6n";
    pub const explicitWidthQuery = "\x1b]66;w=1; \x1b\\";
    pub const scaledTextQuery = "\x1b]66;s=2; \x1b\\";

    // Focus tracking
    pub const focusSet = "\x1b[?1004h";
    pub const focusReset = "\x1b[?1004l";

    // Sync
    pub const syncSet = "\x1b[?2026h";
    pub const syncReset = "\x1b[?2026l";

    // Unicode
    pub const unicodeSet = "\x1b[?2027h";
    pub const unicodeReset = "\x1b[?2027l";

    // Bracketed paste
    pub const bracketedPasteSet = "\x1b[?2004h";
    pub const bracketedPasteReset = "\x1b[?2004l";

    // Color scheme
    pub const colorSchemeRequest = "\x1b[?996n";
    pub const colorSchemeSet = "\x1b[?2031h";
    pub const colorSchemeReset = "\x1b[?2031l";

    // Key encoding
    pub const csiUPush = "\x1b[>{d}u";
    pub const csiUPop = "\x1b[<u";

    // modifyOtherKeys mode
    pub const modifyOtherKeysSet = "\x1b[>4;1m";
    pub const modifyOtherKeysReset = "\x1b[>4;0m";

    // Movement and erase
    pub const reverseIndex = "\x1bM";
    pub const eraseBelowCursor = "\x1b[J";

    // OSC 0 - Set window title
    pub const setTerminalTitle = "\x1b]0;{s}\x07";

    pub fn setTerminalTitleOutput(writer: anytype, title: []const u8) AnsiError!void {
        writer.print(setTerminalTitle, .{title}) catch return AnsiError.WriteFailed;
    }

    pub fn makeRoomForRendererOutput(writer: anytype, height: u32) AnsiError!void {
        if (height > 1) {
            var i: u32 = 0;
            while (i < height - 1) : (i += 1) {
                writer.writeByte('\n') catch return AnsiError.WriteFailed;
            }
        }
    }
};

pub const TextAttributes = struct {
    pub const NONE: u8 = 0;
    pub const BOLD: u8 = 1 << 0;
    pub const DIM: u8 = 1 << 1;
    pub const ITALIC: u8 = 1 << 2;
    pub const UNDERLINE: u8 = 1 << 3;
    pub const BLINK: u8 = 1 << 4;
    pub const INVERSE: u8 = 1 << 5;
    pub const HIDDEN: u8 = 1 << 6;
    pub const STRIKETHROUGH: u8 = 1 << 7;

    // Constants for attribute bit packing
    pub const ATTRIBUTE_BASE_BITS: u5 = 8;
    pub const ATTRIBUTE_BASE_MASK: u32 = 0xFF;

    // Constants for link_id packing (bits 8-31)
    pub const LINK_ID_BITS: u8 = 24;
    pub const LINK_ID_SHIFT: u5 = ATTRIBUTE_BASE_BITS;
    pub const LINK_ID_PAYLOAD_MASK: u32 = ((@as(u32, 1) << LINK_ID_BITS) - 1);
    pub const LINK_ID_MASK: u32 = LINK_ID_PAYLOAD_MASK << LINK_ID_SHIFT;

    /// Extract the base 8 bits of attributes from a u32 attribute value
    pub fn getBaseAttributes(attr: u32) u8 {
        return @intCast(attr & ATTRIBUTE_BASE_MASK);
    }

    /// Extract the link_id from bits 8-31 of attributes
    pub fn getLinkId(attr: u32) u32 {
        return (attr & LINK_ID_MASK) >> LINK_ID_SHIFT;
    }

    /// Set the link_id in an attribute value, preserving base attributes
    pub fn setLinkId(attr: u32, link_id: u32) u32 {
        const base = attr & ATTRIBUTE_BASE_MASK;
        const link_bits = (link_id & LINK_ID_PAYLOAD_MASK) << LINK_ID_SHIFT;
        return base | link_bits;
    }

    /// Check if an attribute value has a link
    pub fn hasLink(attr: u32) bool {
        return getLinkId(attr) != 0;
    }

    pub fn applyAttributesOutputWriter(writer: anytype, attributes: u32) AnsiError!void {
        const base_attr = getBaseAttributes(attributes);
        if (base_attr & BOLD != 0) writer.writeAll(ANSI.bold) catch return AnsiError.WriteFailed;
        if (base_attr & DIM != 0) writer.writeAll(ANSI.dim) catch return AnsiError.WriteFailed;
        if (base_attr & ITALIC != 0) writer.writeAll(ANSI.italic) catch return AnsiError.WriteFailed;
        if (base_attr & UNDERLINE != 0) writer.writeAll(ANSI.underline) catch return AnsiError.WriteFailed;
        if (base_attr & BLINK != 0) writer.writeAll(ANSI.blink) catch return AnsiError.WriteFailed;
        if (base_attr & INVERSE != 0) writer.writeAll(ANSI.inverse) catch return AnsiError.WriteFailed;
        if (base_attr & HIDDEN != 0) writer.writeAll(ANSI.hidden) catch return AnsiError.WriteFailed;
        if (base_attr & STRIKETHROUGH != 0) writer.writeAll(ANSI.strikethrough) catch return AnsiError.WriteFailed;
    }
};

// 256-color palette conversion
// The 256-color palette is structured as:
// - 0-15: Standard colors (system colors, not predictable)
// - 16-231: 6x6x6 color cube (216 colors)
// - 232-255: Grayscale ramp (24 shades)

// The 6x6x6 color cube levels: 0, 95, 135, 175, 215, 255
const color_cube_levels = [6]u8{ 0, 95, 135, 175, 215, 255 };

/// Convert an 8-bit RGB component to the nearest 6x6x6 cube index (0-5)
fn rgbTo6Level(value: u8) u8 {
    // Find the nearest level in the color cube
    if (value < 48) return 0; // 0
    if (value < 115) return 1; // 95
    if (value < 155) return 2; // 135
    if (value < 195) return 3; // 175
    if (value < 235) return 4; // 215
    return 5; // 255
}

/// Convert an 8-bit grayscale value to the nearest grayscale index (232-255)
fn grayTo24Level(value: u8) u8 {
    // Grayscale ramp: 232-255 represents 24 shades
    // Values are: 8, 18, 28, ..., 238 (step of 10)
    // We map 0-255 to 0-23, then add 232
    if (value < 4) return 232; // Closest to black
    if (value > 243) return 255; // Closest to white
    // Linear interpolation: (value - 8) / 10 + 232
    return @as(u8, @intCast((@as(u16, value) - 8) / 10 + 232));
}

/// Calculate the squared distance between two RGB colors
fn colorDistanceSquared(r1: u8, g1: u8, b1: u8, r2: u8, g2: u8, b2: u8) u32 {
    const dr = @as(i32, r1) - @as(i32, r2);
    const dg = @as(i32, g1) - @as(i32, g2);
    const db = @as(i32, b1) - @as(i32, b2);
    return @intCast(dr * dr + dg * dg + db * db);
}

/// Convert RGB (0-255) to the nearest 256-color palette index
/// This chooses between the color cube (16-231) and grayscale ramp (232-255)
pub fn rgbTo256Color(r: u8, g: u8, b: u8) u8 {
    // Get the nearest color cube index
    const cube_r = rgbTo6Level(r);
    const cube_g = rgbTo6Level(g);
    const cube_b = rgbTo6Level(b);
    const cube_index = 16 + 36 * cube_r + 6 * cube_g + cube_b;

    // Get the actual RGB values for this cube color
    const cube_r_val = color_cube_levels[cube_r];
    const cube_g_val = color_cube_levels[cube_g];
    const cube_b_val = color_cube_levels[cube_b];

    // Calculate distance to the cube color
    const cube_dist = colorDistanceSquared(r, g, b, cube_r_val, cube_g_val, cube_b_val);

    // Check if this might be better represented as grayscale
    // Only consider grayscale if the color is relatively neutral
    const max_component = @max(r, @max(g, b));
    const min_component = @min(r, @min(g, b));

    // If the color is fairly neutral (max - min < 32), try grayscale
    if (max_component - min_component < 32) {
        // Use average for grayscale
        const gray = @as(u8, @intCast((@as(u16, r) + @as(u16, g) + @as(u16, b)) / 3));
        const gray_index = grayTo24Level(gray);

        // Calculate the actual grayscale value for this index
        const gray_val: u8 = if (gray_index < 232) 0 else @as(u8, @intCast((gray_index - 232) * 10 + 8));

        // Calculate distance to grayscale
        const gray_dist = colorDistanceSquared(r, g, b, gray_val, gray_val, gray_val);

        // Choose whichever is closer
        if (gray_dist < cube_dist) {
            return gray_index;
        }
    }

    return cube_index;
}

const HSV_SECTOR_COUNT = 6;
const HUE_SECTOR_DEGREES = 60.0;

pub fn hsvToRgb(h: f32, s: f32, v: f32) RGBA {
    const clamped_h = @mod(h, 360.0);
    const clamped_s = std.math.clamp(s, 0.0, 1.0);
    const clamped_v = std.math.clamp(v, 0.0, 1.0);

    const sector = @as(u8, @intFromFloat(@floor(clamped_h / HUE_SECTOR_DEGREES))) % HSV_SECTOR_COUNT;
    const fractional = clamped_h / HUE_SECTOR_DEGREES - @floor(clamped_h / HUE_SECTOR_DEGREES);

    const p = clamped_v * (1.0 - clamped_s);
    const q = clamped_v * (1.0 - fractional * clamped_s);
    const t = clamped_v * (1.0 - (1.0 - fractional) * clamped_s);

    const rgb = switch (sector) {
        0 => .{ clamped_v, t, p },
        1 => .{ q, clamped_v, p },
        2 => .{ p, clamped_v, t },
        3 => .{ p, q, clamped_v },
        4 => .{ t, p, clamped_v },
        5 => .{ clamped_v, p, q },
        else => unreachable,
    };

    return .{ rgb[0], rgb[1], rgb[2], 1.0 };
}
