using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class ASCIIFontRenderable : Renderable
{
    public string Text { get; set; } = "";
    public string Font { get; set; } = "normal";
    public string? Color { get; set; }

    // 5x3 character patterns: each char is 3 rows of 5 chars
    private static readonly Dictionary<char, string[]> Font5x3 = new()
    {
        ['A'] = new[] { " ▄▄▄ ", "█▀▀▀█", "█   █" },
        ['B'] = new[] { "█▀▀▄ ", "█▀▀▄ ", "█▄▄▀ " },
        ['C'] = new[] { " ▄▄▄▄", "█    ", " ▀▀▀▀" },
        ['D'] = new[] { "█▀▀▄ ", "█   █", "█▄▄▀ " },
        ['E'] = new[] { "█▀▀▀▀", "█▀▀  ", "█▄▄▄▄" },
        ['F'] = new[] { "█▀▀▀▀", "█▀▀  ", "█    " },
        ['G'] = new[] { " ▄▄▄▄", "█  ▄▄", " ▀▀▀█" },
        ['H'] = new[] { "█   █", "█▀▀▀█", "█   █" },
        ['I'] = new[] { "▀█▀", " █ ", "▄█▄" },
        ['J'] = new[] { "  ▄▄█", "   █ ", "▀▄▄▀ " },
        ['K'] = new[] { "█  ▄▀", "█▀▀▄ ", "█  ▀▄" },
        ['L'] = new[] { "█    ", "█    ", "█▄▄▄▄" },
        ['M'] = new[] { "█▄ ▄█", "█ ▀ █", "█   █" },
        ['N'] = new[] { "█▄  █", "█ ▀ █", "█  ▀█" },
        ['O'] = new[] { " ▄▄▄ ", "█   █", " ▀▀▀ " },
        ['P'] = new[] { "█▀▀▄ ", "█▄▄▀ ", "█    " },
        ['Q'] = new[] { " ▄▄▄ ", "█   █", " ▀▀▀█" },
        ['R'] = new[] { "█▀▀▄ ", "█▀▄  ", "█  ▀▄" },
        ['S'] = new[] { " ▄▄▄▄", " ▀▀▄▄", "▄▄▄▀ " },
        ['T'] = new[] { "▀█▀▀▀", " █   ", " █   " },
        ['U'] = new[] { "█   █", "█   █", " ▀▀▀ " },
        ['V'] = new[] { "█   █", "▀▄ ▄▀", "  ▀  " },
        ['W'] = new[] { "█   █", "█ ▄ █", "▀▄▀▄▀" },
        ['X'] = new[] { "▀▄ ▄▀", " ▀▀▀ ", "▄▀ ▀▄" },
        ['Y'] = new[] { "▀▄ ▄▀", " ▀▀  ", " █   " },
        ['Z'] = new[] { "▄▄▄▀▀", "  ▄▀ ", "▀▄▄▄▄" },
        ['0'] = new[] { " ▄▄▄ ", "█ ▄ █", " ▀▀▀ " },
        ['1'] = new[] { " ▄█ ", "  █ ", "  █ " },
        ['2'] = new[] { " ▄▄▄ ", "  ▄▄▀", "▄▄▄▄ " },
        ['3'] = new[] { "▄▄▄▄ ", "  ▀▄ ", "▄▄▄▀ " },
        ['4'] = new[] { "█  █ ", "▀▀▀█ ", "   █ " },
        ['5'] = new[] { "▄▄▄▄▄", "▀▀▀▄ ", "▄▄▄▀ " },
        ['6'] = new[] { " ▄▄▄ ", "█▀▀▄ ", " ▀▀▀ " },
        ['7'] = new[] { "▄▄▄▄▄", "  ▄▀ ", " ▀   " },
        ['8'] = new[] { " ▄▄▄ ", " ▄▄▄ ", " ▀▀▀ " },
        ['9'] = new[] { " ▄▄▄ ", " ▀▀▄█", " ▀▀▀ " },
        [' '] = new[] { "   ", "   ", "   " },
        ['!'] = new[] { " █ ", " █ ", " ▄ " },
        ['?'] = new[] { " ▄▄ ", "  ▀▀", "  ▄ " },
        ['.'] = new[] { "  ", "  ", " ▄" },
        [','] = new[] { "  ", "  ", " ▄" },
        [':'] = new[] { " ▄", "  ", " ▄" },
        ['-'] = new[] { "   ", "▄▄▄", "   " },
        ['/'] = new[] { "  ▄▀", " ▄▀ ", "▄▀  " },
    };

    public ASCIIFontRenderable(CliRenderer? renderer) : base(renderer) { }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var fg = Color != null ? Rgba.FromCss(Color) : Rgba.FromInts(255, 255, 255);
        var bg = Rgba.FromInts(0, 0, 0, 0);

        int col = x;
        foreach (char c in Text.ToUpper())
        {
            if (!Font5x3.TryGetValue(c, out var pattern))
                pattern = Font5x3[' '];

            int charWidth = pattern[0].Length + 1; // +1 for spacing
            if (col + charWidth > x + w) break;

            for (int row = 0; row < 3 && row < h; row++)
            {
                var rowStr = row < pattern.Length ? pattern[row] : "";
                buffer.DrawText(col, y + row, rowStr, fg, bg);
            }

            col += charWidth;
        }
    }
}
