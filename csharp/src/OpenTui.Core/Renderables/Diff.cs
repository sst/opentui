using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class DiffRenderable : Renderable
{
    public string OldText { get; set; } = "";
    public string NewText { get; set; } = "";
    public bool ShowLineNumbers { get; set; } = true;

    private static readonly Rgba AddedFg = Rgba.FromCss("#98c379");
    private static readonly Rgba RemovedFg = Rgba.FromCss("#e06c75");
    private static readonly Rgba SameFg = Rgba.FromInts(200, 200, 200);
    private static readonly Rgba AddedBg = Rgba.FromInts(0, 40, 0);
    private static readonly Rgba RemovedBg = Rgba.FromInts(40, 0, 0);
    private static readonly Rgba SameBg = Rgba.FromInts(0, 0, 0, 0);
    private static readonly Rgba LineNumFg = Rgba.FromInts(100, 100, 100);

    public DiffRenderable(CliRenderer? renderer) : base(renderer) { }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var oldLines = OldText.Split('\n');
        var newLines = NewText.Split('\n');
        var diff = ComputeDiff(oldLines, newLines);

        int lineNumWidth = ShowLineNumbers ? 6 : 0; // "  123 "
        int contentX = x + lineNumWidth;
        int contentW = w - lineNumWidth;

        int row = 0;
        int oldLine = 1, newLine = 1;

        foreach (var (type, text) in diff)
        {
            if (row >= h) break;

            var (fg, bg) = type switch
            {
                '+' => (AddedFg, AddedBg),
                '-' => (RemovedFg, RemovedBg),
                _ => (SameFg, SameBg),
            };

            if (bg.AlphaByte > 0)
                buffer.FillRect(x, y + row, w, 1, bg);

            if (ShowLineNumbers)
            {
                string numStr = type switch
                {
                    '+' => $"  {newLine,3} ",
                    '-' => $"  {oldLine,3} ",
                    _ => $"  {oldLine,3} ",
                };
                buffer.DrawText(x, y + row, numStr, LineNumFg, bg);
            }

            var prefix = type switch { '+' => "+ ", '-' => "- ", _ => "  " };
            var line = (prefix + text);
            if (line.Length > contentW) line = line[..contentW];
            buffer.DrawText(contentX, y + row, line, fg, bg);

            if (type != '+') oldLine++;
            if (type != '-') newLine++;
            row++;
        }
    }

    private static List<(char Type, string Text)> ComputeDiff(string[] oldLines, string[] newLines)
    {
        // Simple LCS-based diff
        int m = oldLines.Length, n = newLines.Length;
        var lcs = new int[m + 1, n + 1];

        for (int i = 1; i <= m; i++)
            for (int j = 1; j <= n; j++)
                lcs[i, j] = oldLines[i - 1] == newLines[j - 1]
                    ? lcs[i - 1, j - 1] + 1
                    : Math.Max(lcs[i - 1, j], lcs[i, j - 1]);

        var result = new List<(char, string)>();
        int oi = m, ni = n;

        while (oi > 0 || ni > 0)
        {
            if (oi > 0 && ni > 0 && oldLines[oi - 1] == newLines[ni - 1])
            {
                result.Add((' ', oldLines[oi - 1]));
                oi--; ni--;
            }
            else if (ni > 0 && (oi == 0 || lcs[oi, ni - 1] >= lcs[oi - 1, ni]))
            {
                result.Add(('+', newLines[ni - 1]));
                ni--;
            }
            else
            {
                result.Add(('-', oldLines[oi - 1]));
                oi--;
            }
        }

        result.Reverse();
        return result;
    }
}
