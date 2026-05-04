using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Console;

public enum OverlayPosition { TopLeft, TopRight, BottomLeft, BottomRight }

public class ConsoleOverlay : OpenTui.Core.Renderables.Renderable
{
    public new OverlayPosition Position { get; set; } = OverlayPosition.BottomRight;
    public int MaxLines { get; set; } = 10;
    public int MaxWidth { get; set; } = 60;

    private readonly List<string> _lines = new();

    public ConsoleOverlay(OpenTui.Core.Rendering.CliRenderer? renderer) : base(renderer)
    {
        LayoutNode.Position = "absolute";
    }

    public void AddLine(string line)
    {
        _lines.Add(line);
        while (_lines.Count > MaxLines)
            _lines.RemoveAt(0);
        RequestRender();
    }

    public void Log(string message) => AddLine($"[LOG] {message}");
    public void Warn(string message) => AddLine($"[WARN] {message}");
    public void Error(string message) => AddLine($"[ERR] {message}");

    public void Clear()
    {
        _lines.Clear();
        RequestRender();
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        if (_lines.Count == 0) return;

        int h = _lines.Count;
        int w = Math.Min(MaxWidth, _lines.Max(l => l.Length) + 2);
        int termW = buffer.Width;
        int termH = buffer.Height;

        int bx = Position switch
        {
            OverlayPosition.TopLeft or OverlayPosition.BottomLeft => 0,
            _ => termW - w
        };
        int by = Position switch
        {
            OverlayPosition.TopLeft or OverlayPosition.TopRight => 0,
            _ => termH - h
        };

        var bg = Rgba.FromInts(20, 20, 20);
        var fg = Rgba.FromInts(200, 200, 200);

        buffer.FillRect(bx, by, w, h, bg);
        for (int i = 0; i < h; i++)
        {
            var line = _lines[i];
            if (line.Length > w - 1) line = line[..(w - 1)];
            buffer.DrawText(bx + 1, by + i, line, fg, bg);
        }
    }
}
