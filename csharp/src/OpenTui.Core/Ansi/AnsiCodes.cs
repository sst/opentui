using System.IO;

namespace OpenTui.Core.Ansi
{
    /// <summary>ANSI escape sequence constants and TextWriter helpers.</summary>
    public static class AnsiCodes
    {
        // ── cursor / screen control ───────────────────────────────────────────────
        public const string Reset             = "\x1b[0m";
        public const string Clear             = "\x1b[2J";
        public const string Home              = "\x1b[H";
        public const string ClearAndHome      = "\x1b[H\x1b[2J";
        public const string EraseToEndOfLine  = "\x1b[K";
        public const string HideCursor        = "\x1b[?25l";
        public const string ShowCursor        = "\x1b[?25h";
        public const string DefaultCursorStyle= "\x1b[0 q";
        public const string SwitchToAlternate = "\x1b[?1049h";
        public const string SwitchToMain      = "\x1b[?1049l";
        public const string SaveCursor        = "\x1b[s";
        public const string RestoreCursor     = "\x1b[u";
        public const string ResetCursorColor  = "\x1b]112\x07";
        public const string ResetTerminalBg   = "\x1b]111\x07";

        // ── text attributes ───────────────────────────────────────────────────────
        public const string Bold          = "\x1b[1m";
        public const string Dim           = "\x1b[2m";
        public const string Italic        = "\x1b[3m";
        public const string Underline     = "\x1b[4m";
        public const string Blink         = "\x1b[5m";
        public const string Inverse       = "\x1b[7m";
        public const string Hidden        = "\x1b[8m";
        public const string Strikethrough = "\x1b[9m";

        // ── cursor styles ─────────────────────────────────────────────────────────
        public const string CursorBlock         = "\x1b[2 q";
        public const string CursorBlockBlink    = "\x1b[1 q";
        public const string CursorLine          = "\x1b[6 q";
        public const string CursorLineBlink     = "\x1b[5 q";
        public const string CursorUnderline     = "\x1b[4 q";
        public const string CursorUnderlineBlink= "\x1b[3 q";

        // ── positioning ───────────────────────────────────────────────────────────
        /// <summary>Move cursor to 1-based column, row.</summary>
        public static string MoveTo(int col, int row) => $"\x1b[{row};{col}H";

        // ── color sequences ───────────────────────────────────────────────────────
        public static string FgColor(byte r, byte g, byte b) => $"\x1b[38;2;{r};{g};{b}m";
        public static string FgIndexed(byte index)           => $"\x1b[38;5;{index}m";
        public const  string FgDefault                        = "\x1b[39m";
        public static string BgColor(byte r, byte g, byte b) => $"\x1b[48;2;{r};{g};{b}m";
        public static string BgIndexed(byte index)           => $"\x1b[48;5;{index}m";
        public const  string BgDefault                        = "\x1b[49m";
        public static string CursorColor(byte r, byte g, byte b) => $"\x1b]12;#{r:x2}{g:x2}{b:x2}\x07";
        public static string SetTerminalBg(byte r, byte g, byte b) => $"\x1b]11;rgb:{r:x2}/{g:x2}/{b:x2}\x07";
        public static string SetMousePointer(string shape) => $"\x1b]22;{shape}\x07";

        // ── writer helpers ────────────────────────────────────────────────────────

        public static void WriteFgColor(TextWriter w, Rgba color)
        {
            switch (color.Intent)
            {
                case ColorIntent.Indexed: w.Write(FgIndexed(color.Slot)); break;
                case ColorIntent.Default: w.Write(FgDefault); break;
                default: w.Write(FgColor(color.RedByte, color.GreenByte, color.BlueByte)); break;
            }
        }

        public static void WriteBgColor(TextWriter w, Rgba color)
        {
            switch (color.Intent)
            {
                case ColorIntent.Indexed: w.Write(BgIndexed(color.Slot)); break;
                case ColorIntent.Default: w.Write(BgDefault); break;
                default: w.Write(BgColor(color.RedByte, color.GreenByte, color.BlueByte)); break;
            }
        }

        public static void WriteAttributes(TextWriter w, TextAttributes attrs)
        {
            if (attrs == TextAttributes.None) return;
            if ((attrs & TextAttributes.Bold)          != 0) w.Write(Bold);
            if ((attrs & TextAttributes.Dim)           != 0) w.Write(Dim);
            if ((attrs & TextAttributes.Italic)        != 0) w.Write(Italic);
            if ((attrs & TextAttributes.Underline)     != 0) w.Write(Underline);
            if ((attrs & TextAttributes.Blink)         != 0) w.Write(Blink);
            if ((attrs & TextAttributes.Inverse)       != 0) w.Write(Inverse);
            if ((attrs & TextAttributes.Hidden)        != 0) w.Write(Hidden);
            if ((attrs & TextAttributes.Strikethrough) != 0) w.Write(Strikethrough);
        }
    }
}
