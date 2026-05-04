using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class InputOptions
{
    public string? Placeholder { get; set; }
    public string? PlaceholderColor { get; set; }
    public string? CursorColor { get; set; }
    public string? Fg { get; set; }
    public string? Bg { get; set; }
    public int? MaxLength { get; set; }
    public object? Width { get; set; }
    public object? Height { get; set; }
    public string? Value { get; set; }
}

public class InputRenderable : Renderable
{
    private string _value = "";
    public string Value
    {
        get => _value;
        set
        {
            _value = MaxLength.HasValue && value.Length > MaxLength.Value ? value[..MaxLength.Value] : value;
            _cursorPos = Math.Min(_cursorPos, _value.Length);
            _scrollOffset = Math.Min(_scrollOffset, _value.Length);
            RequestRender();
        }
    }
    public string? Placeholder { get; set; }
    public string? PlaceholderColor { get; set; }
    public string? CursorColor { get; set; }
    public string? Fg { get; set; }
    public string? Bg { get; set; }
    public int? MaxLength { get; set; }

    private int _cursorPos = 0;
    private int _scrollOffset = 0;

    public InputRenderable(CliRenderer? renderer, InputOptions? options = null) : base(renderer)
    {
        var opts = options ?? new InputOptions();
        Placeholder = opts.Placeholder;
        PlaceholderColor = opts.PlaceholderColor;
        CursorColor = opts.CursorColor;
        Fg = opts.Fg;
        Bg = opts.Bg;
        MaxLength = opts.MaxLength;
        Focusable = true;
        if (opts.Width != null) SetWidth(opts.Width);
        if (opts.Height != null) SetHeight(opts.Height);
        if (opts.Value != null)
        {
            _value = MaxLength.HasValue && opts.Value.Length > MaxLength.Value ? opts.Value[..MaxLength.Value] : opts.Value;
            _cursorPos = _value.Length;
        }

        On("focused", _ => RequestRender());
        On("blurred", _ =>
        {
            Emit("change", Value);
            RequestRender();
        });
    }

    public override void HandleKey(KeyEvent key)
    {
        switch (key.Name)
        {
            case "return":
                Emit("enter", Value);
                Emit("change", Value);
                RequestRender();
                break;
            case "backspace":
                if (_cursorPos > 0)
                {
                    _value = Value[..(_cursorPos - 1)] + Value[_cursorPos..];
                    _cursorPos--;
                    Emit("input", Value);
                    RequestRender();
                }
                break;
            case "delete":
                if (_cursorPos < Value.Length)
                {
                    _value = Value[.._cursorPos] + Value[(_cursorPos + 1)..];
                    Emit("input", Value);
                    RequestRender();
                }
                break;
            case "left":
                if (_cursorPos > 0) { _cursorPos--; RequestRender(); }
                break;
            case "right":
                if (_cursorPos < Value.Length) { _cursorPos++; RequestRender(); }
                break;
            case "home":
                _cursorPos = 0; RequestRender();
                break;
            case "end":
                _cursorPos = Value.Length; RequestRender();
                break;
            default:
                if (key.Char.HasValue && !key.Ctrl && !key.Alt)
                {
                    if (MaxLength == null || Value.Length < MaxLength.Value)
                    {
                        _value = Value[.._cursorPos] + key.Char.Value + Value[_cursorPos..];
                        _cursorPos++;
                        Emit("input", Value);
                        RequestRender();
                    }
                }
                break;
        }
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = Math.Max(1, ComputedHeight);
        if (w <= 0 || h <= 0) return;

        var fg = Fg != null ? Rgba.FromCss(Fg) : Rgba.FromInts(255, 255, 255);
        var bg = Bg != null ? Rgba.FromCss(Bg) : Rgba.FromInts(30, 30, 30);

        buffer.FillRect(x, y, w, h, bg);

        if (Value.Length == 0 && Placeholder != null)
        {
            var phColor = PlaceholderColor != null ? Rgba.FromCss(PlaceholderColor) : Rgba.FromInts(100, 100, 100);
            var ph = Placeholder.Length > w ? Placeholder[..w] : Placeholder;
            buffer.DrawText(x, y, ph, phColor, bg);
        }
        else
        {
            // Scroll the view so cursor is visible
            if (_cursorPos - _scrollOffset >= w) _scrollOffset = _cursorPos - w + 1;
            if (_cursorPos < _scrollOffset) _scrollOffset = _cursorPos;

            var visible = Value.Length > _scrollOffset ? Value[_scrollOffset..] : "";
            if (visible.Length > w) visible = visible[..w];
            buffer.DrawText(x, y, visible, fg, bg);

            // Draw cursor
            if (Focused)
            {
                int cursorScreenX = x + _cursorPos - _scrollOffset;
                if (cursorScreenX >= x && cursorScreenX < x + w)
                {
                    var cursorBg = CursorColor != null ? Rgba.FromCss(CursorColor) : Rgba.FromInts(255, 255, 255);
                    char cursorChar = _cursorPos < Value.Length ? Value[_cursorPos] : ' ';
                    buffer.SetCell(cursorScreenX, y, cursorChar, bg, cursorBg);
                }
            }
        }
    }
}
