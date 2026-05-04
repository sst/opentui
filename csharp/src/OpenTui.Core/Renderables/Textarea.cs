using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Text;

namespace OpenTui.Core.Renderables;

public class TextareaRenderable : Renderable
{
    private readonly EditBuffer _editBuffer = new();
    private int _scrollY = 0;

    public string Value
    {
        get => _editBuffer.GetText();
        set { _editBuffer.SetText(value); RequestRender(); }
    }

    public string? Placeholder { get; set; }
    public string WrapMode { get; set; } = "word";
    public string? Fg { get; set; }
    public string? Bg { get; set; }

    public TextareaRenderable(CliRenderer? renderer) : base(renderer)
    {
        Focusable = true;
        On("focused", _ => RequestRender());
        On("blurred", _ => RequestRender());
    }

    public override void HandleKey(KeyEvent key)
    {
        switch (key.Name)
        {
            case "up":
                _editBuffer.MoveCursorUp();
                EnsureVisible();
                RequestRender();
                break;
            case "down":
                _editBuffer.MoveCursorDown();
                EnsureVisible();
                RequestRender();
                break;
            case "left":
                _editBuffer.MoveCursorLeft();
                RequestRender();
                break;
            case "right":
                _editBuffer.MoveCursorRight();
                RequestRender();
                break;
            case "return":
                _editBuffer.InsertChar("\n");
                EnsureVisible();
                Emit("input", Value);
                RequestRender();
                break;
            case "backspace":
                _editBuffer.DeleteCharBackward();
                EnsureVisible();
                Emit("input", Value);
                RequestRender();
                break;
            case "delete":
                _editBuffer.DeleteChar();
                Emit("input", Value);
                RequestRender();
                break;
            default:
                if (key.Char.HasValue && !key.Ctrl && !key.Alt)
                {
                    _editBuffer.InsertChar(key.Char.Value.ToString());
                    EnsureVisible();
                    Emit("input", Value);
                    RequestRender();
                }
                break;
        }
    }

    private void EnsureVisible()
    {
        var cursor = _editBuffer.GetCursorPosition();
        int row = cursor.Row;
        int h = ComputedHeight;
        if (row < _scrollY) _scrollY = row;
        if (row >= _scrollY + h) _scrollY = row - h + 1;
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var fg = Fg != null ? Rgba.FromCss(Fg) : Rgba.FromInts(255, 255, 255);
        var bg = Bg != null ? Rgba.FromCss(Bg) : Rgba.FromInts(30, 30, 30);

        buffer.FillRect(x, y, w, h, bg);

        var text = Value;
        var lines = text.Split('\n');

        if (lines.Length == 0 && Placeholder != null)
        {
            buffer.DrawText(x, y, Placeholder, Rgba.FromInts(100, 100, 100), bg);
            return;
        }

        var cursor = _editBuffer.GetCursorPosition();
        int cursorRow = cursor.Row;
        int cursorCol = cursor.Col;

        for (int row = 0; row < h; row++)
        {
            int lineIdx = row + _scrollY;
            if (lineIdx >= lines.Length) break;

            var line = lines[lineIdx];
            var visible = line.Length > w ? line[..w] : line;
            buffer.DrawText(x, y + row, visible, fg, bg);

            if (Focused && lineIdx == cursorRow)
            {
                int cx = Math.Min(cursorCol, w - 1);
                char cc = cursorCol < line.Length ? line[cursorCol] : ' ';
                buffer.SetCell(x + cx, y + row, cc, bg, Rgba.FromInts(255, 255, 255));
            }
        }
    }
}
