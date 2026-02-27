use crate::ansi::{RGBA, ANSI};
use crate::utf8::WidthMethod;
use std::collections::HashMap;
use std::io::Write;

/// Terminal capability flags.
#[derive(Debug, Clone)]
pub struct Capabilities {
    pub kitty_keyboard: bool,
    pub kitty_graphics: bool,
    pub rgb: bool,
    pub unicode: WidthMethod,
    pub sgr_pixels: bool,
    pub color_scheme_updates: bool,
    pub explicit_width: bool,
    pub scaled_text: bool,
    pub sixel: bool,
    pub focus_tracking: bool,
    pub sync: bool,
    pub bracketed_paste: bool,
    pub hyperlinks: bool,
    pub osc52: bool,
    pub explicit_cursor_positioning: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            kitty_keyboard: false,
            kitty_graphics: false,
            rgb: false,
            unicode: WidthMethod::Unicode,
            sgr_pixels: false,
            color_scheme_updates: false,
            explicit_width: false,
            scaled_text: false,
            sixel: false,
            focus_tracking: false,
            sync: false,
            bracketed_paste: false,
            hyperlinks: false,
            osc52: false,
            explicit_cursor_positioning: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseLevel {
    None,
    Basic,
    Drag,
    Motion,
    Pixels,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CursorStyle {
    Block = 0,
    Line = 1,
    Underline = 2,
}

impl CursorStyle {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Block,
            1 => Self::Line,
            2 => Self::Underline,
            _ => Self::Block,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MousePointerStyle {
    Default = 0,
    Pointer = 1,
    Text = 2,
    Crosshair = 3,
    Move = 4,
    NotAllowed = 5,
}

impl MousePointerStyle {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Default,
            1 => Self::Pointer,
            2 => Self::Text,
            3 => Self::Crosshair,
            4 => Self::Move,
            5 => Self::NotAllowed,
            _ => Self::Default,
        }
    }

    pub fn to_name(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Pointer => "pointer",
            Self::Text => "text",
            Self::Crosshair => "crosshair",
            Self::Move => "move",
            Self::NotAllowed => "not-allowed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ClipboardTarget {
    Clipboard = 0,
    Primary = 1,
    Secondary = 2,
    Query = 3,
}

impl ClipboardTarget {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Clipboard,
            1 => Self::Primary,
            2 => Self::Secondary,
            3 => Self::Query,
            _ => Self::Clipboard,
        }
    }

    pub fn to_char(&self) -> char {
        match self {
            Self::Clipboard => 'c',
            Self::Primary => 'p',
            Self::Secondary => 's',
            Self::Query => 'q',
        }
    }
}

#[derive(Debug, Clone)]
pub struct TerminalInfo {
    pub name: String,
    pub version: String,
    pub from_xtversion: bool,
}

impl Default for TerminalInfo {
    fn default() -> Self {
        Self {
            name: String::new(),
            version: String::new(),
            from_xtversion: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CursorState {
    pub x: u32,
    pub y: u32,
    pub visible: bool,
    pub style: CursorStyle,
    pub blinking: bool,
    pub color: RGBA,
}

impl Default for CursorState {
    fn default() -> Self {
        Self {
            x: 1,
            y: 1,
            visible: true,
            style: CursorStyle::Block,
            blinking: false,
            color: [1.0, 1.0, 1.0, 1.0],
        }
    }
}

#[derive(Debug, Clone)]
pub struct TerminalState {
    pub alt_screen: bool,
    pub kitty_keyboard: bool,
    pub kitty_keyboard_flags: u8,
    pub bracketed_paste: bool,
    pub mouse: bool,
    pub pixel_mouse: bool,
    pub color_scheme_updates: bool,
    pub focus_tracking: bool,
    pub modify_other_keys: bool,
    pub mouse_pointer: MousePointerStyle,
    pub cursor: CursorState,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            alt_screen: false,
            kitty_keyboard: false,
            kitty_keyboard_flags: 0,
            bracketed_paste: false,
            mouse: false,
            pixel_mouse: false,
            color_scheme_updates: false,
            focus_tracking: false,
            modify_other_keys: false,
            mouse_pointer: MousePointerStyle::Default,
            cursor: CursorState::default(),
        }
    }
}

pub struct Options {
    pub kitty_keyboard_flags: u8,
    pub remote: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            kitty_keyboard_flags: 0b00101,
            remote: false,
        }
    }
}

/// Terminal capability detection and management.
pub struct Terminal {
    pub caps: Capabilities,
    pub opts: Options,
    pub state: TerminalState,
    pub term_info: TerminalInfo,
    pub in_tmux: bool,
    host_env: HashMap<String, String>,
}

impl Terminal {
    pub fn new(opts: Options) -> Self {
        let mut term = Self {
            caps: Capabilities::default(),
            opts,
            state: TerminalState::default(),
            term_info: TerminalInfo::default(),
            in_tmux: false,
            host_env: HashMap::new(),
        };
        term.check_environment_overrides();
        term
    }

    pub fn set_host_env_var(&mut self, key: &str, value: &str) {
        self.host_env.insert(key.to_string(), value.to_string());
        self.check_environment_overrides();
    }

    fn check_environment_overrides(&mut self) {
        if let Some(val) = self.host_env.get("OPENTUI_FORCE_WCWIDTH") {
            if val == "1" || val == "true" {
                self.caps.unicode = WidthMethod::Wcwidth;
            }
        }
        if let Some(val) = self.host_env.get("OPENTUI_FORCE_UNICODE") {
            if val == "1" || val == "true" {
                self.caps.unicode = WidthMethod::Unicode;
            }
        }
        if let Some(val) = self.host_env.get("OPENTUI_FORCE_NOZWJ") {
            if val == "1" || val == "true" {
                self.caps.unicode = WidthMethod::NoZwj;
            }
        }
        if let Some(val) = self.host_env.get("TMUX") {
            if !val.is_empty() {
                self.in_tmux = true;
            }
        }
    }

    pub fn set_cursor_position(&mut self, x: u32, y: u32, visible: bool) {
        self.state.cursor.x = x;
        self.state.cursor.y = y;
        self.state.cursor.visible = visible;
    }

    pub fn set_cursor_style(&mut self, style: CursorStyle, blinking: bool) {
        self.state.cursor.style = style;
        self.state.cursor.blinking = blinking;
    }

    pub fn set_cursor_color(&mut self, color: RGBA) {
        self.state.cursor.color = color;
    }

    pub fn set_mouse_pointer_style(&mut self, style: MousePointerStyle) {
        self.state.mouse_pointer = style;
    }

    pub fn get_cursor_position(&self) -> &CursorState {
        &self.state.cursor
    }

    pub fn get_cursor_style(&self) -> (CursorStyle, bool) {
        (self.state.cursor.style, self.state.cursor.blinking)
    }

    pub fn get_cursor_color(&self) -> RGBA {
        self.state.cursor.color
    }

    /// Write the setup escape sequences for the terminal.
    pub fn setup<W: Write>(&mut self, writer: &mut W, use_alternate_screen: bool) -> std::io::Result<()> {
        if use_alternate_screen {
            writer.write_all(ANSI::SWITCH_TO_ALTERNATE_SCREEN.as_bytes())?;
            self.state.alt_screen = true;
        }
        writer.write_all(ANSI::HIDE_CURSOR.as_bytes())?;
        writer.flush()
    }

    /// Write the teardown escape sequences.
    pub fn reset<W: Write>(&mut self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(ANSI::SHOW_CURSOR.as_bytes())?;
        writer.write_all(ANSI::RESET.as_bytes())?;
        writer.write_all(ANSI::RESET_MOUSE_POINTER.as_bytes())?;
        self.state.mouse_pointer = MousePointerStyle::Default;

        if self.state.kitty_keyboard {
            writer.write_all(b"\x1b[<u")?;
            self.state.kitty_keyboard = false;
        }

        if self.state.mouse {
            writer.write_all(ANSI::DISABLE_ANY_EVENT_TRACKING.as_bytes())?;
            writer.write_all(ANSI::DISABLE_SGR_MOUSE_MODE.as_bytes())?;
            self.state.mouse = false;
        }

        if self.state.bracketed_paste {
            writer.write_all(ANSI::DISABLE_BRACKETED_PASTE.as_bytes())?;
            self.state.bracketed_paste = false;
        }

        if self.state.focus_tracking {
            writer.write_all(ANSI::DISABLE_FOCUS_TRACKING.as_bytes())?;
            self.state.focus_tracking = false;
        }

        if self.state.alt_screen {
            writer.write_all(ANSI::SWITCH_TO_MAIN_SCREEN.as_bytes())?;
            self.state.alt_screen = false;
        }

        writer.flush()
    }

    /// Process a terminal capability response string.
    pub fn process_capability_response(&mut self, response: &str) {
        // Parse capability responses (simplified)
        if response.contains("kitty") || response.contains("Kitty") {
            self.caps.kitty_keyboard = true;
            self.caps.kitty_graphics = true;
        }
        if response.contains("WezTerm") {
            self.caps.rgb = true;
            self.caps.hyperlinks = true;
        }
        // Store terminal info from xtversion
        if response.starts_with("\x1bP>|") {
            let info = response
                .trim_start_matches("\x1bP>|")
                .trim_end_matches("\x1b\\");
            self.term_info.name = info.to_string();
            self.term_info.from_xtversion = true;
        }
    }
}

impl Default for Terminal {
    fn default() -> Self {
        Self::new(Options::default())
    }
}
