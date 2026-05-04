using System.Collections.Generic;
using OpenTui.Core.Ansi;

namespace OpenTui.Core.Text
{
    /// <summary>A single styled run of text.</summary>
    public sealed class StyledChunk
    {
        public string         Text       { get; set; }
        public Rgba?          Fg         { get; set; }
        public Rgba?          Bg         { get; set; }
        public TextAttributes Attributes { get; set; }
        public string?        Link       { get; set; }

        public StyledChunk(string text, Rgba? fg = null, Rgba? bg = null,
                           TextAttributes attrs = TextAttributes.None, string? link = null)
        {
            Text = text; Fg = fg; Bg = bg; Attributes = attrs; Link = link;
        }
    }

    /// <summary>A sequence of styled text chunks — the C# equivalent of the TS StyledText type.</summary>
    public sealed class StyledText
    {
        public List<StyledChunk> Chunks { get; } = new();

        public static StyledText FromString(string text) =>
            new StyledText { Chunks = { new StyledChunk(text) } };

        public string ToPlainText()
        {
            var sb = new System.Text.StringBuilder();
            foreach (var c in Chunks) sb.Append(c.Text);
            return sb.ToString();
        }

        public int Length => ToPlainText().Replace("\n", "").Length;
    }
}
