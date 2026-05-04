using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class LineNumbersRenderable : Renderable
{
    public int LineCount { get; set; } = 0;
    public int StartLine { get; set; } = 1;
    public string? Fg { get; set; } = "#666666";
    public string? Bg { get; set; }

    public LineNumbersRenderable(CliRenderer? renderer) : base(renderer) { }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var fg = Fg != null ? Rgba.FromCss(Fg) : Rgba.FromInts(100, 100, 100);
        var bg = Bg != null ? Rgba.FromCss(Bg) : Rgba.FromInts(0, 0, 0, 0);

        for (int row = 0; row < h && row < LineCount; row++)
        {
            var num = (StartLine + row).ToString().PadLeft(w);
            if (num.Length > w) num = num[..w];
            buffer.DrawText(x, y + row, num, fg, bg);
        }
    }
}
