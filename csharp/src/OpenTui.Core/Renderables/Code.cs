using System.Text.RegularExpressions;
using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class CodeRenderable : Renderable
{
    public string Content { get; set; } = "";
    public string Language { get; set; } = "";
    public bool ShowLineNumbers { get; set; } = true;

    private static readonly Rgba KeywordColor = Rgba.FromCss("#569cd6");
    private static readonly Rgba StringColor = Rgba.FromCss("#ce9178");
    private static readonly Rgba CommentColor = Rgba.FromCss("#6a9955");
    private static readonly Rgba NumberColor = Rgba.FromCss("#b5cea8");
    private static readonly Rgba DefaultFg = Rgba.FromInts(212, 212, 212);
    private static readonly Rgba LineNumFg = Rgba.FromInts(100, 100, 100);
    private static readonly Rgba BgColor = Rgba.FromInts(30, 30, 30);

    private static readonly string[] Keywords = {
        "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char",
        "checked", "class", "const", "continue", "decimal", "default", "delegate",
        "do", "double", "else", "enum", "event", "explicit", "extern", "false",
        "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit",
        "in", "int", "interface", "internal", "is", "lock", "long", "namespace",
        "new", "null", "object", "operator", "out", "override", "params", "private",
        "protected", "public", "readonly", "ref", "return", "sbyte", "sealed",
        "short", "sizeof", "stackalloc", "static", "string", "struct", "switch",
        "this", "throw", "true", "try", "typeof", "uint", "ulong", "unchecked",
        "unsafe", "ushort", "using", "var", "virtual", "void", "volatile", "while",
        // JS/TS
        "function", "let", "const", "import", "export", "from", "require",
        "async", "await", "type", "interface", "extends", "implements",
    };

    public CodeRenderable(CliRenderer? renderer) : base(renderer) { }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        buffer.FillRect(x, y, w, h, BgColor);

        var lines = Content.Split('\n');
        int lineNumWidth = ShowLineNumbers ? (lines.Length.ToString().Length + 1) : 0;
        int codeX = x + lineNumWidth;
        int codeW = w - lineNumWidth;

        for (int row = 0; row < h && row < lines.Length; row++)
        {
            var line = lines[row];
            int lineNum = row + 1;

            if (ShowLineNumbers)
            {
                var numStr = lineNum.ToString().PadLeft(lineNumWidth - 1);
                buffer.DrawText(x, y + row, numStr + " ", LineNumFg, BgColor);
            }

            RenderCodeLine(buffer, codeX, y + row, line, codeW);
        }
    }

    private void RenderCodeLine(RenderBuffer buffer, int x, int y, string line, int maxWidth)
    {
        if (line.Length == 0) return;
        var tokens = Tokenize(line);
        int col = 0;
        foreach (var (text, color) in tokens)
        {
            if (col >= maxWidth) break;
            var visible = text.Length > maxWidth - col ? text[..(maxWidth - col)] : text;
            buffer.DrawText(x + col, y, visible, color, BgColor);
            col += visible.Length;
        }
    }

    private List<(string Text, Rgba Color)> Tokenize(string line)
    {
        var result = new List<(string, Rgba)>();
        int i = 0;

        while (i < line.Length)
        {
            // Single-line comment
            if (i + 1 < line.Length && line[i] == '/' && line[i + 1] == '/')
            {
                result.Add((line[i..], CommentColor));
                break;
            }

            // String literal
            if (line[i] == '"' || line[i] == '\'' || line[i] == '`')
            {
                char quote = line[i];
                int j = i + 1;
                while (j < line.Length && line[j] != quote)
                {
                    if (line[j] == '\\') j++;
                    j++;
                }
                if (j < line.Length) j++;
                result.Add((line[i..j], StringColor));
                i = j;
                continue;
            }

            // Number
            if (char.IsDigit(line[i]) || (line[i] == '-' && i + 1 < line.Length && char.IsDigit(line[i + 1])))
            {
                int j = i;
                if (line[j] == '-') j++;
                while (j < line.Length && (char.IsDigit(line[j]) || line[j] == '.' || line[j] == 'x' || line[j] == 'X'))
                    j++;
                result.Add((line[i..j], NumberColor));
                i = j;
                continue;
            }

            // Identifier / keyword
            if (char.IsLetter(line[i]) || line[i] == '_')
            {
                int j = i;
                while (j < line.Length && (char.IsLetterOrDigit(line[j]) || line[j] == '_'))
                    j++;
                var word = line[i..j];
                var color = Array.IndexOf(Keywords, word) >= 0 ? KeywordColor : DefaultFg;
                result.Add((word, color));
                i = j;
                continue;
            }

            result.Add((line[i].ToString(), DefaultFg));
            i++;
        }

        return result;
    }
}
