using OpenTui.Core.Ansi;

namespace OpenTui.Core.Buffer
{
    /// <summary>A single terminal cell: codepoint + foreground/background colors + attributes.</summary>
    public struct Cell
    {
        public int Codepoint;
        public Rgba Fg;
        public Rgba Bg;
        public TextAttributes Attributes;

        public static Cell Empty(Rgba bg) => new Cell
        {
            Codepoint  = ' ',
            Fg         = Rgba.FromInts(255, 255, 255),
            Bg         = bg,
            Attributes = TextAttributes.None,
        };
    }
}
