using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

namespace OpenTui.Core.Rendering;

public class RenderBuffer
{
    public int Width { get; }
    public int Height { get; }

    private readonly Cell[] _cells;
    private int? _clipX, _clipY, _clipW, _clipH;

    public RenderBuffer(int width, int height)
    {
        Width = width;
        Height = height;
        _cells = new Cell[width * height];
        var empty = Cell.Empty(Rgba.FromInts(0, 0, 0));
        for (int i = 0; i < _cells.Length; i++) _cells[i] = empty;
    }

    public void SetClipRegion(int? x, int? y, int? width, int? height)
    {
        _clipX = x; _clipY = y; _clipW = width; _clipH = height;
    }

    private bool InClip(int x, int y)
    {
        if (_clipX == null) return true;
        return x >= _clipX.Value && y >= _clipY!.Value &&
               x < _clipX.Value + _clipW!.Value &&
               y < _clipY.Value + _clipH!.Value;
    }

    private bool InBounds(int x, int y) => (uint)x < (uint)Width && (uint)y < (uint)Height;

    public void SetCell(int x, int y, char ch, Rgba fg, Rgba bg, TextAttributes attrs = 0)
        => SetCell(x, y, (int)ch, fg, bg, attrs);

    public void SetCell(int x, int y, int codepoint, Rgba fg, Rgba bg, TextAttributes attrs = 0)
    {
        if (!InBounds(x, y) || !InClip(x, y)) return;
        _cells[y * Width + x] = new Cell { Codepoint = codepoint, Fg = fg, Bg = bg, Attributes = (TextAttributes)attrs };
    }

    public void DrawText(int x, int y, string text, Rgba fg, Rgba bg, TextAttributes attrs = 0)
    {
        int col = x;
        foreach (var rune in text.EnumerateRunes())
        {
            if (col >= Width) break;
            int w = CellBuffer.RuneWidth(rune);
            SetCell(col, y, rune.Value, fg, bg, attrs);
            if (w == 2 && col + 1 < Width)
                SetCell(col + 1, y, 0, fg, bg, attrs);
            col += w;
        }
    }

    public void FillRect(int x, int y, int width, int height, Rgba bg)
    {
        for (int fy = y; fy < y + height; fy++)
            for (int fx = x; fx < x + width; fx++)
                SetCell(fx, fy, ' ', Rgba.FromInts(255, 255, 255), bg);
    }

    public void DrawBorder(int x, int y, int width, int height, string style, Rgba color, Rgba bg)
    {
        if (width <= 0 || height <= 0) return;
        var chars = GetBorderChars(style);

        // Corners
        SetCell(x, y, chars[0], color, bg);
        if (width > 1) SetCell(x + width - 1, y, chars[1], color, bg);
        if (height > 1) SetCell(x, y + height - 1, chars[2], color, bg);
        if (width > 1 && height > 1) SetCell(x + width - 1, y + height - 1, chars[3], color, bg);

        // Top and bottom edges
        for (int fx = x + 1; fx < x + width - 1; fx++)
        {
            SetCell(fx, y, chars[4], color, bg);
            if (height > 1) SetCell(fx, y + height - 1, chars[4], color, bg);
        }

        // Left and right edges
        for (int fy = y + 1; fy < y + height - 1; fy++)
        {
            SetCell(x, fy, chars[5], color, bg);
            if (width > 1) SetCell(x + width - 1, fy, chars[5], color, bg);
        }
    }

    public void DrawBorderWithTitles(int x, int y, int width, int height, string style,
        Rgba color, Rgba bg, string? title, string titleAlign,
        string? bottomTitle, string bottomTitleAlign)
    {
        DrawBorder(x, y, width, height, style, color, bg);

        if (title != null && width > 4)
        {
            var t = title.Length > width - 4 ? title[..(width - 4)] : title;
            int tx = titleAlign switch
            {
                "center" => x + (width - t.Length) / 2,
                "right" => x + width - t.Length - 2,
                _ => x + 2
            };
            DrawText(tx, y, t, color, bg);
        }

        if (bottomTitle != null && width > 4 && height > 1)
        {
            var t = bottomTitle.Length > width - 4 ? bottomTitle[..(width - 4)] : bottomTitle;
            int tx = bottomTitleAlign switch
            {
                "center" => x + (width - t.Length) / 2,
                "right" => x + width - t.Length - 2,
                _ => x + 2
            };
            DrawText(tx, y + height - 1, t, color, bg);
        }
    }

    public Cell? GetCell(int x, int y)
    {
        if (!InBounds(x, y)) return null;
        return _cells[y * Width + x];
    }

    public void Clear(Rgba bg)
    {
        var empty = Cell.Empty(bg);
        for (int i = 0; i < _cells.Length; i++) _cells[i] = empty;
    }

    private static int[] GetBorderChars(string style) => style.ToLowerInvariant() switch
    {
        "double" => new[] { '╔', '╗', '╚', '╝', '═', '║' }.Select(c => (int)c).ToArray(),
        "rounded" => new[] { '╭', '╮', '╰', '╯', '─', '│' }.Select(c => (int)c).ToArray(),
        "thick" or "heavy" => new[] { '┏', '┓', '┗', '┛', '━', '┃' }.Select(c => (int)c).ToArray(),
        "dashed" => new[] { '┌', '┐', '└', '┘', '╌', '╎' }.Select(c => (int)c).ToArray(),
        "ascii" => new[] { '+', '+', '+', '+', '-', '|' }.Select(c => (int)c).ToArray(),
        _ => new[] { '┌', '┐', '└', '┘', '─', '│' }.Select(c => (int)c).ToArray(), // single
    };
}
