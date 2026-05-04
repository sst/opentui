using System;
using System.Collections.Generic;
using System.Text;
using OpenTui.Core.Ansi;

namespace OpenTui.Core.Buffer
{
    /// <summary>
    /// A 2D grid of terminal cells. Pure C# port of the Zig <c>OptimizedBuffer</c>.
    ///
    /// Supports drawing text (ASCII + Unicode graphemes), box borders, alpha blending,
    /// frame-buffer blitting and resize — enough to drive a full TUI layout.
    /// </summary>
    public sealed class CellBuffer : IDisposable
    {
        private static int _idSeq;

        public string Id { get; }
        public int Width  { get; private set; }
        public int Height { get; private set; }
        public bool RespectAlpha { get; set; }

        private Cell[] _cells;
        private bool   _disposed;

        public CellBuffer(int width, int height, string? id = null, bool respectAlpha = false)
        {
            if (width  <= 0) throw new ArgumentOutOfRangeException(nameof(width));
            if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
            Id           = id ?? $"fb_{System.Threading.Interlocked.Increment(ref _idSeq)}";
            Width        = width;
            Height       = height;
            RespectAlpha = respectAlpha;
            _cells       = new Cell[width * height];
            FillAll(Rgba.FromInts(0, 0, 0));
        }

        public static CellBuffer Create(int width, int height, string? id = null, bool respectAlpha = false)
            => new CellBuffer(width, height, id, respectAlpha);

        // ── guard ─────────────────────────────────────────────────────────────────

        private void Guard()
        {
            if (_disposed) throw new ObjectDisposedException(Id);
        }

        // ── fill ──────────────────────────────────────────────────────────────────

        private void FillAll(Rgba bg)
        {
            var empty = Cell.Empty(bg);
            for (int i = 0; i < _cells.Length; i++) _cells[i] = empty;
        }

        public void Clear(Rgba? bg = null)
        {
            Guard();
            FillAll(bg ?? Rgba.FromInts(0, 0, 0));
        }

        // ── bounds ────────────────────────────────────────────────────────────────

        private bool InBounds(int x, int y) => (uint)x < (uint)Width && (uint)y < (uint)Height;

        // ── cell access ───────────────────────────────────────────────────────────

        public Cell? GetCell(int x, int y)
        {
            Guard();
            if (!InBounds(x, y)) return null;
            return _cells[y * Width + x];
        }

        public void SetCell(int x, int y, int codepoint, Rgba fg, Rgba bg,
                            TextAttributes attrs = TextAttributes.None)
        {
            Guard();
            if (!InBounds(x, y)) return;
            _cells[y * Width + x] = new Cell { Codepoint = codepoint, Fg = fg, Bg = bg, Attributes = attrs };
        }

        // ── draw text ─────────────────────────────────────────────────────────────

        public void DrawText(string text, int x, int y, Rgba fg, Rgba? bg = null,
                             TextAttributes attrs = TextAttributes.None)
        {
            Guard();
            var bgColor = bg ?? Rgba.FromInts(0, 0, 0, 0);
            int col = x;
            foreach (var rune in text.EnumerateRunes())
            {
                if (col >= Width) break;
                int w = RuneWidth(rune);
                SetCell(col, y, rune.Value, fg, bgColor, attrs);
                if (w == 2 && col + 1 < Width)
                    SetCell(col + 1, y, 0, fg, bgColor, attrs); // continuation cell
                col += w;
            }
        }

        // ── draw box ──────────────────────────────────────────────────────────────

        public void DrawBox(int x, int y, int width, int height,
                            Rgba borderColor, Rgba bg,
                            BorderStyle style   = BorderStyle.Single,
                            BorderSides sides   = BorderSides.All,
                            bool fill           = false,
                            string? title       = null,
                            string? bottomTitle = null,
                            TextAlignment titleAlign       = TextAlignment.Left,
                            TextAlignment bottomTitleAlign = TextAlignment.Left)
        {
            Guard();
            var chars = BorderChars.GetChars(style);

            if (fill)
                for (int fy = y + 1; fy < y + height - 1; fy++)
                    for (int fx = x + 1; fx < x + width - 1; fx++)
                        SetCell(fx, fy, ' ', borderColor, bg);

            bool top = (sides & BorderSides.Top)    != 0;
            bool bot = (sides & BorderSides.Bottom) != 0;
            bool lft = (sides & BorderSides.Left)   != 0;
            bool rgt = (sides & BorderSides.Right)  != 0;

            if (top && lft) SetCell(x,             y,            chars[0], borderColor, bg);
            if (top && rgt) SetCell(x + width - 1, y,            chars[1], borderColor, bg);
            if (bot && lft) SetCell(x,             y + height-1, chars[2], borderColor, bg);
            if (bot && rgt) SetCell(x + width - 1, y + height-1, chars[3], borderColor, bg);

            for (int fx = x + 1; fx < x + width - 1; fx++)
            {
                if (top) SetCell(fx, y,            chars[4], borderColor, bg);
                if (bot) SetCell(fx, y + height-1, chars[4], borderColor, bg);
            }

            for (int fy = y + 1; fy < y + height - 1; fy++)
            {
                if (lft) SetCell(x,             fy, chars[5], borderColor, bg);
                if (rgt) SetCell(x + width - 1, fy, chars[5], borderColor, bg);
            }

            if (title != null && top && width > 4)
            {
                var t = title.Length > width - 4 ? title[..(width - 4)] : title;
                int tx = titleAlign switch
                {
                    TextAlignment.Center => x + (width - t.Length) / 2,
                    TextAlignment.Right  => x + width - t.Length - 2,
                    _                    => x + 2,
                };
                DrawText(t, tx, y, borderColor, bg);
            }

            if (bottomTitle != null && bot && width > 4)
            {
                var t = bottomTitle.Length > width - 4 ? bottomTitle[..(width - 4)] : bottomTitle;
                int tx = bottomTitleAlign switch
                {
                    TextAlignment.Center => x + (width - t.Length) / 2,
                    TextAlignment.Right  => x + width - t.Length - 2,
                    _                    => x + 2,
                };
                DrawText(t, tx, y + height - 1, borderColor, bg);
            }
        }

        public void FillRect(int x, int y, int w, int h, Rgba bg)
        {
            Guard();
            for (int fy = y; fy < y + h; fy++)
                for (int fx = x; fx < x + w; fx++)
                    SetCell(fx, fy, ' ', Rgba.FromInts(255, 255, 255), bg);
        }

        // ── blit (DrawFrameBuffer) ────────────────────────────────────────────────

        /// <summary>
        /// Blit <paramref name="src"/> onto this buffer at the given destination position.
        /// If <see cref="RespectAlpha"/> is set, semi-transparent source cells are blended.
        /// </summary>
        public void DrawFrameBuffer(int destX, int destY, CellBuffer src,
                                    int srcX = 0, int srcY = 0,
                                    int? srcWidth = null, int? srcHeight = null)
        {
            Guard();
            int sw = srcWidth  ?? src.Width;
            int sh = srcHeight ?? src.Height;
            for (int fy = 0; fy < sh; fy++)
                for (int fx = 0; fx < sw; fx++)
                {
                    int dx = destX + fx, dy = destY + fy;
                    if (!InBounds(dx, dy)) continue;
                    var cell = src.GetCell(srcX + fx, srcY + fy);
                    if (cell == null) continue;
                    var c = cell.Value;
                    if (RespectAlpha && c.Bg.AlphaByte < 255)
                    {
                        var existing = _cells[dy * Width + dx];
                        c.Bg = c.Bg.BlendOver(existing.Bg);
                    }
                    _cells[dy * Width + dx] = c;
                }
        }

        // ── resize ────────────────────────────────────────────────────────────────

        public void Resize(int width, int height)
        {
            Guard();
            if (Width == width && Height == height) return;
            var newCells = new Cell[width * height];
            var empty    = Cell.Empty(Rgba.FromInts(0, 0, 0));
            for (int i = 0; i < newCells.Length; i++) newCells[i] = empty;
            for (int fy = 0; fy < Math.Min(Height, height); fy++)
                for (int fx = 0; fx < Math.Min(Width, width); fx++)
                    newCells[fy * width + fx] = _cells[fy * Width + fx];
            _cells = newCells;
            Width  = width;
            Height = height;
        }

        // ── encode unicode ────────────────────────────────────────────────────────

        /// <summary>
        /// Decompose <paramref name="text"/> into (displayWidth, codepoint) pairs,
        /// mirroring the Zig <c>encodeUnicode</c> / <c>GraphemePool</c> API.
        /// </summary>
        public List<(int Width, int Codepoint)> EncodeUnicode(string text)
        {
            Guard();
            var result = new List<(int, int)>(text.Length);
            foreach (var rune in text.EnumerateRunes())
                result.Add((RuneWidth(rune), rune.Value));
            return result;
        }

        // ── byte snapshot ─────────────────────────────────────────────────────────

        /// <summary>Return UTF-8 bytes for all visible characters in the buffer.</summary>
        public byte[] GetRealCharBytes(bool addLineBreaks = false)
        {
            Guard();
            var sb = new StringBuilder(Width * Height);
            for (int fy = 0; fy < Height; fy++)
            {
                for (int fx = 0; fx < Width; fx++)
                {
                    var cell = _cells[fy * Width + fx];
                    if (cell.Codepoint == 0) continue; // continuation cell
                    sb.Append(char.ConvertFromUtf32(cell.Codepoint));
                }
                if (addLineBreaks && fy < Height - 1) sb.Append('\n');
            }
            return Encoding.UTF8.GetBytes(sb.ToString());
        }

        // ── grapheme width detection ──────────────────────────────────────────────

        /// <summary>
        /// Approximate East Asian / emoji display width (1 or 2 columns).
        /// Mirrors the wcwidth / unicode width modes in the Zig implementation.
        /// </summary>
        public static int RuneWidth(System.Text.Rune rune)
        {
            int v = rune.Value;
            if (v < 0x1100) return 1;
            if (v <= 0x115F  ||    // Hangul Jamo
                v == 0x2329  || v == 0x232A ||
                (v >= 0x2600  && v <= 0x27BF) ||
                (v >= 0x2E80  && v <= 0x303E) ||
                (v >= 0x3040  && v <= 0xA4CF) ||
                (v >= 0xAC00  && v <= 0xD7AF) ||
                (v >= 0xF900  && v <= 0xFAFF) ||
                (v >= 0xFE10  && v <= 0xFE19) ||
                (v >= 0xFE30  && v <= 0xFE4F) ||
                (v >= 0xFF00  && v <= 0xFF60) ||
                (v >= 0xFFE0  && v <= 0xFFE6) ||
                (v >= 0x1F004 && v <= 0x1FFFD) ||   // emoji + misc symbols
                (v >= 0x20000 && v <= 0x2FFFD) ||
                (v >= 0x30000 && v <= 0x3FFFD))
                return 2;
            return 1;
        }

        // ── IDisposable ───────────────────────────────────────────────────────────

        public void Dispose() { _disposed = true; }
    }
}
