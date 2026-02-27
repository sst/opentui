use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// The method to use when calculating the width of a grapheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WidthMethod {
    Wcwidth,
    Unicode,
    NoZwj,
}

impl WidthMethod {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Wcwidth,
            2 => Self::NoZwj,
            _ => Self::Unicode,
        }
    }
}

/// Line-break kinds matching the Zig implementation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineBreakKind {
    LF,
    CR,
    CRLF,
}

/// A detected line break position.
#[derive(Debug, Clone)]
pub struct LineBreak {
    pub pos: usize,
    pub kind: LineBreakKind,
}

/// Information about a grapheme within text.
#[derive(Debug, Clone)]
pub struct GraphemeInfo {
    pub byte_offset: u32,
    pub byte_len: u32,
    pub col_offset: u32,
    pub width: u8,
}

/// Word-wrap break opportunity.
#[derive(Debug, Clone)]
pub struct WrapBreak {
    pub byte_offset: usize,
    pub col: u32,
}

/// Check if a byte slice contains only printable ASCII (32..=126).
pub fn is_ascii_only(text: &[u8]) -> bool {
    if text.is_empty() {
        return false;
    }
    text.iter().all(|&b| (32..=126).contains(&b))
}

/// Get the display width of a single character at a byte position.
pub fn get_width_at(text: &[u8], byte_offset: usize, tab_width: u8, method: WidthMethod) -> u8 {
    if byte_offset >= text.len() {
        return 0;
    }
    let b = text[byte_offset];
    if b == b'\t' {
        return tab_width;
    }
    if b < 32 || b == 127 {
        return 0;
    }
    if b < 128 {
        return 1;
    }

    // Decode UTF-8 grapheme starting at byte_offset
    let remaining = &text[byte_offset..];
    let s = match std::str::from_utf8(remaining) {
        Ok(s) => s,
        Err(e) => {
            let valid_len = e.valid_up_to();
            if valid_len == 0 {
                return 1;
            }
            // Safety: valid_up_to guarantees this prefix is valid UTF-8
            unsafe { std::str::from_utf8_unchecked(&remaining[..valid_len]) }
        }
    };

    let grapheme = s.graphemes(true).next().unwrap_or("");
    grapheme_width(grapheme, method) as u8
}

/// Calculate display width of a grapheme cluster.
pub fn grapheme_width(grapheme: &str, method: WidthMethod) -> usize {
    if grapheme.is_empty() {
        return 0;
    }
    match method {
        WidthMethod::Wcwidth | WidthMethod::Unicode => UnicodeWidthStr::width(grapheme),
        WidthMethod::NoZwj => {
            // Remove ZWJ characters and measure
            let without_zwj: String = grapheme.chars().filter(|&c| c != '\u{200D}').collect();
            UnicodeWidthStr::width(without_zwj.as_str())
        }
    }
}

/// Find grapheme info in a text slice.
pub fn find_grapheme_info(
    text: &[u8],
    tab_width: u8,
    _is_ascii_only: bool,
    method: WidthMethod,
) -> Vec<GraphemeInfo> {
    let s = match std::str::from_utf8(text) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut result = Vec::new();
    let mut col: u32 = 0;

    for (byte_offset, grapheme) in s.grapheme_indices(true) {
        let byte_len = grapheme.len() as u32;
        let width = if grapheme == "\t" {
            tab_width as usize
        } else if grapheme.as_bytes()[0] < 32 {
            0
        } else if byte_len > 1 || grapheme.as_bytes()[0] > 126 {
            grapheme_width(grapheme, method)
        } else {
            1
        };

        // Only record non-trivial (multi-byte or special) graphemes
        if byte_len > 1 || width != 1 || grapheme.as_bytes()[0] > 126 || grapheme.as_bytes()[0] < 32
        {
            result.push(GraphemeInfo {
                byte_offset: byte_offset as u32,
                byte_len,
                col_offset: col,
                width: width as u8,
            });
        }

        col += width as u32;
    }

    result
}

/// Find line breaks in text.
pub fn find_line_breaks(text: &[u8]) -> Vec<LineBreak> {
    let mut breaks = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if text[i] == b'\r' {
            if i + 1 < text.len() && text[i + 1] == b'\n' {
                breaks.push(LineBreak {
                    pos: i,
                    kind: LineBreakKind::CRLF,
                });
                i += 2;
            } else {
                breaks.push(LineBreak {
                    pos: i,
                    kind: LineBreakKind::CR,
                });
                i += 1;
            }
        } else if text[i] == b'\n' {
            breaks.push(LineBreak {
                pos: i,
                kind: LineBreakKind::LF,
            });
            i += 1;
        } else {
            i += 1;
        }
    }
    breaks
}

/// Calculate the display width of a text string.
pub fn text_width(text: &str, tab_width: u8, method: WidthMethod) -> u32 {
    let mut width: u32 = 0;
    for grapheme in text.graphemes(true) {
        if grapheme == "\t" {
            width += tab_width as u32;
        } else if grapheme == "\n" || grapheme == "\r" {
            // line breaks don't add width
        } else {
            width += grapheme_width(grapheme, method) as u32;
        }
    }
    width
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_ascii_only() {
        assert!(is_ascii_only(b"Hello World"));
        assert!(!is_ascii_only(b"Hello\nWorld"));
        assert!(!is_ascii_only(b""));
        assert!(!is_ascii_only("Hello 🌍".as_bytes()));
    }

    #[test]
    fn test_find_line_breaks() {
        let text = b"line1\nline2\r\nline3\rline4";
        let breaks = find_line_breaks(text);
        assert_eq!(breaks.len(), 3);
        assert_eq!(breaks[0].kind, LineBreakKind::LF);
        assert_eq!(breaks[1].kind, LineBreakKind::CRLF);
        assert_eq!(breaks[2].kind, LineBreakKind::CR);
    }

    #[test]
    fn test_text_width() {
        assert_eq!(text_width("hello", 2, WidthMethod::Unicode), 5);
        assert_eq!(text_width("\t", 4, WidthMethod::Unicode), 4);
    }
}
