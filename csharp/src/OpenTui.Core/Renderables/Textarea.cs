using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Text;

namespace OpenTui.Core.Renderables;

public class TextareaOptions
{
    public string? InitialValue { get; set; }
    public string? Placeholder { get; set; }
    public string WrapMode { get; set; } = "word";
    public string? Fg { get; set; }
    public string? Bg { get; set; }
    public object? Width { get; set; }
    public object? Height { get; set; }
}

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
    public bool ShowCursor { get; set; } = true;
    public string? CursorColor { get; set; }
    public int ScrollY => _scrollY;
    public int LineCount => Value.Split('\n').Length;
    public LogicalCursor LogicalCursor => _editBuffer.GetCursorPosition().Clone();

    public TextareaRenderable(CliRenderer? renderer, TextareaOptions? options = null) : base(renderer)
    {
        var opts = options ?? new TextareaOptions();
        Placeholder = opts.Placeholder;
        WrapMode = opts.WrapMode;
        Fg = opts.Fg;
        Bg = opts.Bg;
        if (opts.Width != null) SetWidth(opts.Width);
        if (opts.Height != null) SetHeight(opts.Height);
        if (opts.InitialValue != null) _editBuffer.SetText(opts.InitialValue);

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
                EnsureVisible();
                RequestRender();
                break;
            case "right":
                _editBuffer.MoveCursorRight();
                EnsureVisible();
                RequestRender();
                break;
            case "home":
                _editBuffer.SetCursor(_editBuffer.GetCursorPosition().Row, 0);
                EnsureVisible();
                RequestRender();
                break;
            case "end":
                var eol = _editBuffer.GetEol();
                _editBuffer.SetCursor(eol.Row, eol.Col);
                EnsureVisible();
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
            case "ctrl+z":
                _editBuffer.Undo();
                EnsureVisible();
                Emit("input", Value);
                RequestRender();
                break;
            case "ctrl+y":
                _editBuffer.Redo();
                EnsureVisible();
                Emit("input", Value);
                RequestRender();
                break;
            case "ctrl+a":
                _editBuffer.SetCursor(_editBuffer.GetCursorPosition().Row, 0);
                RequestRender();
                break;
            case "ctrl+e":
                var lineEnd = _editBuffer.GetEol();
                _editBuffer.SetCursor(lineEnd.Row, lineEnd.Col);
                RequestRender();
                break;
            case "ctrl+d":
                _editBuffer.DeleteChar();
                Emit("input", Value);
                RequestRender();
                break;
            case "ctrl+k":
                var cursor = _editBuffer.GetCursorPosition();
                var end = _editBuffer.GetEol();
                _editBuffer.DeleteRange(cursor.Row, cursor.Col, end.Row, end.Col);
                Emit("input", Value);
                RequestRender();
                break;
            case "ctrl+u":
                var current = _editBuffer.GetCursorPosition();
                _editBuffer.DeleteRange(current.Row, 0, current.Row, current.Col);
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
        int h = Math.Max(1, ComputedHeight);
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

        if (Value.Length == 0 && Placeholder != null)
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

            if (ShowCursor && Focused && lineIdx == cursorRow)
            {
                int cx = Math.Min(cursorCol, w - 1);
                char cc = cursorCol < line.Length ? line[cursorCol] : ' ';
                var cursorBg = CursorColor != null ? Rgba.FromCss(CursorColor) : Rgba.FromInts(255, 255, 255);
                buffer.SetCell(x + cx, y + row, cc, bg, cursorBg);
            }
        }
    }
}
