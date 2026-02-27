use std::fmt::Write;

/// RGBA color as 4 f32 components [r, g, b, a] in [0.0, 1.0].
pub type RGBA = [f32; 4];

pub struct ANSI;

impl ANSI {
    pub const RESET: &str = "\x1b[0m";
    pub const CLEAR: &str = "\x1b[2J";
    pub const HOME: &str = "\x1b[H";
    pub const CLEAR_AND_HOME: &str = "\x1b[H\x1b[2J";
    pub const HIDE_CURSOR: &str = "\x1b[?25l";
    pub const SHOW_CURSOR: &str = "\x1b[?25h";
    pub const DEFAULT_CURSOR_STYLE: &str = "\x1b[0 q";
    pub const QUERY_PIXEL_SIZE: &str = "\x1b[14t";
    pub const NEXT_LINE: &str = "\x1b[E";

    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const ITALIC: &str = "\x1b[3m";
    pub const UNDERLINE: &str = "\x1b[4m";
    pub const BLINK: &str = "\x1b[5m";
    pub const INVERSE: &str = "\x1b[7m";
    pub const HIDDEN: &str = "\x1b[8m";
    pub const STRIKETHROUGH: &str = "\x1b[9m";

    pub const CURSOR_BLOCK: &str = "\x1b[2 q";
    pub const CURSOR_BLOCK_BLINK: &str = "\x1b[1 q";
    pub const CURSOR_LINE: &str = "\x1b[6 q";
    pub const CURSOR_LINE_BLINK: &str = "\x1b[5 q";
    pub const CURSOR_UNDERLINE: &str = "\x1b[4 q";
    pub const CURSOR_UNDERLINE_BLINK: &str = "\x1b[3 q";

    pub const RESET_CURSOR_COLOR: &str = "\x1b]112\x07";
    pub const RESET_MOUSE_POINTER: &str = "\x1b]22;\x07";
    pub const SAVE_CURSOR_STATE: &str = "\x1b[s";
    pub const RESTORE_CURSOR_STATE: &str = "\x1b[u";

    pub const SWITCH_TO_ALTERNATE_SCREEN: &str = "\x1b[?1049h";
    pub const SWITCH_TO_MAIN_SCREEN: &str = "\x1b[?1049l";

    pub const ENABLE_MOUSE_TRACKING: &str = "\x1b[?1000h";
    pub const DISABLE_MOUSE_TRACKING: &str = "\x1b[?1000l";
    pub const ENABLE_BUTTON_EVENT_TRACKING: &str = "\x1b[?1002h";
    pub const DISABLE_BUTTON_EVENT_TRACKING: &str = "\x1b[?1002l";
    pub const ENABLE_ANY_EVENT_TRACKING: &str = "\x1b[?1003h";
    pub const DISABLE_ANY_EVENT_TRACKING: &str = "\x1b[?1003l";
    pub const ENABLE_SGR_MOUSE_MODE: &str = "\x1b[?1006h";
    pub const DISABLE_SGR_MOUSE_MODE: &str = "\x1b[?1006l";

    pub const ENABLE_BRACKETED_PASTE: &str = "\x1b[?2004h";
    pub const DISABLE_BRACKETED_PASTE: &str = "\x1b[?2004l";
    pub const ENABLE_FOCUS_TRACKING: &str = "\x1b[?1004h";
    pub const DISABLE_FOCUS_TRACKING: &str = "\x1b[?1004l";

    pub const REVERSE_INDEX: &str = "\x1bM";
    pub const ERASE_BELOW_CURSOR: &str = "\x1b[J";

    pub fn move_to<W: Write>(w: &mut W, x: u32, y: u32) -> std::fmt::Result {
        write!(w, "\x1b[{};{}H", y, x)
    }

    pub fn fg_color<W: Write>(w: &mut W, r: u8, g: u8, b: u8) -> std::fmt::Result {
        write!(w, "\x1b[38;2;{};{};{}m", r, g, b)
    }

    pub fn bg_color<W: Write>(w: &mut W, r: u8, g: u8, b: u8) -> std::fmt::Result {
        write!(w, "\x1b[48;2;{};{};{}m", r, g, b)
    }

    pub fn cursor_color<W: Write>(w: &mut W, r: u8, g: u8, b: u8) -> std::fmt::Result {
        write!(w, "\x1b]12;#{:02x}{:02x}{:02x}\x07", r, g, b)
    }

    pub fn set_mouse_pointer<W: Write>(w: &mut W, shape: &str) -> std::fmt::Result {
        write!(w, "\x1b]22;{}\x07", shape)
    }

    pub fn explicit_width<W: Write>(w: &mut W, width: u32, text: &str) -> std::fmt::Result {
        write!(w, "\x1b]66;w={};{}\x1b\\", width, text)
    }

    pub fn set_kitty_keyboard<W: Write>(w: &mut W, enable: bool, flags: u8) -> std::fmt::Result {
        if enable {
            write!(w, "\x1b[>{}u", flags)
        } else {
            write!(w, "\x1b[<u")
        }
    }
}

/// Text attribute bitfield layout — matches the Zig implementation.
pub struct TextAttributes;

impl TextAttributes {
    pub const BOLD: u32 = 1 << 0;
    pub const DIM: u32 = 1 << 1;
    pub const ITALIC: u32 = 1 << 2;
    pub const UNDERLINE: u32 = 1 << 3;
    pub const BLINK: u32 = 1 << 4;
    pub const INVERSE: u32 = 1 << 5;
    pub const HIDDEN: u32 = 1 << 6;
    pub const STRIKETHROUGH: u32 = 1 << 7;

    // Bits 8..31 reserved for link IDs
    const LINK_ID_SHIFT: u32 = 8;
    const LINK_ID_MASK: u32 = 0xFFFFFF00;

    pub fn set_link_id(base: u32, link_id: u32) -> u32 {
        (base & !Self::LINK_ID_MASK) | ((link_id << Self::LINK_ID_SHIFT) & Self::LINK_ID_MASK)
    }

    pub fn get_link_id(attributes: u32) -> u32 {
        (attributes & Self::LINK_ID_MASK) >> Self::LINK_ID_SHIFT
    }
}

pub fn rgba_component_to_u8(component: f32) -> u8 {
    if !component.is_finite() {
        return 0;
    }
    let clamped = component.clamp(0.0, 1.0);
    (clamped * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rgba_component_conversion() {
        assert_eq!(rgba_component_to_u8(0.0), 0);
        assert_eq!(rgba_component_to_u8(1.0), 255);
        assert_eq!(rgba_component_to_u8(0.5), 128);
        assert_eq!(rgba_component_to_u8(f32::NAN), 0);
        assert_eq!(rgba_component_to_u8(f32::INFINITY), 0);
    }

    #[test]
    fn test_text_attributes_link_id() {
        let base = TextAttributes::BOLD | TextAttributes::ITALIC;
        let with_link = TextAttributes::set_link_id(base, 42);
        assert_eq!(TextAttributes::get_link_id(with_link), 42);
        assert_ne!(with_link & TextAttributes::BOLD, 0);
        assert_ne!(with_link & TextAttributes::ITALIC, 0);
    }
}
