using System;
using System.Collections.Generic;
using System.Linq;
using OpenTui.Core.Ansi;

namespace OpenTui.Core.Text
{
    /// <summary>
    /// Read-only styled text store — C# port of the TS/Zig <c>TextBuffer</c>.
    /// Holds a sequence of <see cref="StyledChunk"/>s and exposes plain-text queries.
    /// </summary>
    public sealed class TextBuffer : IDisposable
    {
        private readonly List<StyledChunk> _chunks = new();
        private bool _disposed;

        public Rgba?          DefaultFg         { get; set; }
        public Rgba?          DefaultBg         { get; set; }
        public TextAttributes? DefaultAttributes { get; set; }

        private string PlainText => string.Concat(_chunks.Select(c => c.Text));

        /// <summary>Number of non-newline characters.</summary>
        public int Length   => PlainText.Replace("\n", "").Length;
        public int ByteSize => System.Text.Encoding.UTF8.GetByteCount(PlainText);

        public static TextBuffer Create() => new TextBuffer();

        public void SetText(string text)
        {
            Guard();
            _chunks.Clear();
            _chunks.Add(new StyledChunk(text, DefaultFg, DefaultBg,
                                        DefaultAttributes ?? TextAttributes.None));
        }

        public void SetStyledText(StyledText text)
        {
            Guard();
            _chunks.Clear();
            _chunks.AddRange(text.Chunks);
        }

        public string GetPlainText() { Guard(); return PlainText; }

        public List<StyledChunk> GetChunks() { Guard(); return new List<StyledChunk>(_chunks); }

        public void SetDefaultFg(Rgba? fg)                   { Guard(); DefaultFg         = fg; }
        public void SetDefaultBg(Rgba? bg)                   { Guard(); DefaultBg         = bg; }
        public void SetDefaultAttributes(TextAttributes? a)  { Guard(); DefaultAttributes = a;  }

        private void Guard()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(TextBuffer));
        }

        public void Dispose() { _disposed = true; }
    }
}
