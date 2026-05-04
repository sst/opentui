using System;

namespace OpenTui.Core.Ansi
{
    /// <summary>Bit flags for standard ANSI text attributes.</summary>
    [Flags]
    public enum TextAttributes : uint
    {
        None          = 0,
        Bold          = 1 << 0,
        Dim           = 1 << 1,
        Italic        = 1 << 2,
        Underline     = 1 << 3,
        Blink         = 1 << 4,
        Inverse       = 1 << 5,
        Hidden        = 1 << 6,
        Strikethrough = 1 << 7,
    }
}
