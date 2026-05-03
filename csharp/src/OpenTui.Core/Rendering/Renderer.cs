using System;
using System.IO;
using System.Text;
using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

namespace OpenTui.Core.Rendering
{
    public enum CursorStyle { Block, Line, Underline, Default }

    /// <summary>
    /// Diff-based ANSI terminal renderer.
    /// Maintains a current and next <see cref="CellBuffer"/>; <see cref="Render"/> emits
    /// only the cells that changed since the last frame.
    /// </summary>
    public sealed class Renderer : IDisposable
    {
        public int   Width           { get; private set; }
        public int   Height          { get; private set; }
        public Rgba  BackgroundColor { get; set; } = Rgba.FromInts(0, 0, 0);
        public bool  UseAlternateScreen { get; set; } = true;
        public bool  Testing         { get; set; }

        private CellBuffer  _current;
        private CellBuffer  _next;
        private readonly TextWriter _out;
        private bool _initialized;
        private bool _disposed;
        private (int X, int Y, bool Visible) _cursor = (0, 0, false);

        public event EventHandler<(int Width, int Height)>? Resized;

        public Renderer(int width, int height, TextWriter? output = null, bool testing = false)
        {
            Width   = width;
            Height  = height;
            Testing = testing;
            _out    = output ?? (testing ? TextWriter.Null : Console.Out);
            _current = new CellBuffer(width, height, "renderer-current");
            _next    = new CellBuffer(width, height, "renderer-next");
        }

        public void Initialize()
        {
            if (_initialized || Testing) return;
            _initialized = true;
            if (UseAlternateScreen) _out.Write(AnsiCodes.SwitchToAlternate);
            _out.Write(AnsiCodes.HideCursor);
            _out.Write(AnsiCodes.ClearAndHome);
        }

        public void Shutdown()
        {
            if (!_initialized || Testing) return;
            _out.Write(AnsiCodes.ShowCursor);
            if (UseAlternateScreen) _out.Write(AnsiCodes.SwitchToMain);
            _out.Write(AnsiCodes.Reset);
        }

        /// <summary>Returns the writable next-frame buffer for callers to draw into.</summary>
        public CellBuffer GetFrameBuffer() => _next;

        public void SetCursorPosition(int x, int y, bool visible = true)
            => _cursor = (x, y, visible);

        public void Resize(int width, int height)
        {
            if (Width == width && Height == height) return;
            Width  = width;
            Height = height;
            _current.Resize(width, height);
            _next.Resize(width, height);
            Resized?.Invoke(this, (width, height));
        }

        /// <summary>
        /// Render the next frame to the terminal, emitting only diff cells.
        /// Call <see cref="GetFrameBuffer"/> to draw into the next frame first.
        /// </summary>
        public void Render()
        {
            if (Testing) return;

            var sb = new StringBuilder(Width * Height * 10);

            Rgba?           lastFg    = null;
            Rgba?           lastBg    = null;
            TextAttributes? lastAttrs = null; // null forces emit on first dirty cell

            for (int y = 0; y < Height; y++)
            {
                for (int x = 0; x < Width; x++)
                {
                    var next = _next.GetCell(x, y)    ?? Cell.Empty(BackgroundColor);
                    var curr = _current.GetCell(x, y) ?? Cell.Empty(BackgroundColor);

                    if (next.Codepoint == curr.Codepoint &&
                        next.Fg        == curr.Fg        &&
                        next.Bg        == curr.Bg        &&
                        next.Attributes== curr.Attributes)
                        continue;

                    sb.Append(AnsiCodes.MoveTo(x + 1, y + 1));

                    if (lastAttrs == null || next.Attributes != lastAttrs.Value)
                    {
                        sb.Append(AnsiCodes.Reset);
                        var sw = new StringWriter(sb);
                        AnsiCodes.WriteAttributes(sw, next.Attributes);
                        lastFg = null; lastBg = null;
                        lastAttrs = next.Attributes;
                    }

                    if (lastFg == null || next.Fg != lastFg.Value)
                    {
                        AnsiCodes.WriteFgColor(new StringWriter(sb), next.Fg);
                        lastFg = next.Fg;
                    }

                    if (lastBg == null || next.Bg != lastBg.Value)
                    {
                        AnsiCodes.WriteBgColor(new StringWriter(sb), next.Bg);
                        lastBg = next.Bg;
                    }

                    sb.Append(next.Codepoint == 0 ? ' ' : char.ConvertFromUtf32(next.Codepoint));
                }
            }

            // Snapshot current frame
            _current.DrawFrameBuffer(0, 0, _next);

            // Position the cursor
            if (_cursor.Visible)
                sb.Append(AnsiCodes.MoveTo(_cursor.X + 1, _cursor.Y + 1));
            else
                sb.Append(AnsiCodes.HideCursor);

            _out.Write(sb.ToString());
            _out.Flush();
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Shutdown();
            _current.Dispose();
            _next.Dispose();
        }
    }
}
