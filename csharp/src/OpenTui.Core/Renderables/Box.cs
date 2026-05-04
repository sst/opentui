using OpenTui.Core.Ansi;
using OpenTui.Core.Layout;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class BoxOptions
{
    public object? Width { get; set; }
    public object? Height { get; set; }
    public string BackgroundColor { get; set; } = "transparent";
    public bool Border { get; set; } = false;
    public string BorderStyle { get; set; } = "single";
    public string BorderColor { get; set; } = "#ffffff";
    public string? FocusedBorderColor { get; set; }
    public bool ShouldFill { get; set; } = true;
    public string? Title { get; set; }
    public string TitleAlignment { get; set; } = "left";
    public string? BottomTitle { get; set; }
    public string BottomTitleAlignment { get; set; } = "left";
    public FlexDirection FlexDirection { get; set; } = FlexDirection.Column;
    public AlignItems AlignItems { get; set; } = AlignItems.FlexStart;
    public JustifyContent JustifyContent { get; set; } = JustifyContent.FlexStart;
    public float FlexGrow { get; set; } = 0;
    public int PaddingTop { get; set; }
    public int PaddingRight { get; set; }
    public int PaddingBottom { get; set; }
    public int PaddingLeft { get; set; }
}

public class BoxRenderable : Renderable
{
    public string BackgroundColor { get; set; }
    public bool Border { get; set; }
    public string BorderStyle { get; set; }
    public string BorderColor { get; set; }
    public string? FocusedBorderColor { get; set; }
    public bool ShouldFill { get; set; }
    public string? Title { get; set; }
    public string TitleAlignment { get; set; }
    public string? BottomTitle { get; set; }
    public string BottomTitleAlignment { get; set; }

    public BoxRenderable(CliRenderer? renderer, BoxOptions? options = null) : base(renderer)
    {
        var opts = options ?? new BoxOptions();
        BackgroundColor = opts.BackgroundColor;
        Border = opts.Border;
        BorderStyle = opts.BorderStyle;
        BorderColor = opts.BorderColor;
        FocusedBorderColor = opts.FocusedBorderColor;
        ShouldFill = opts.ShouldFill;
        Title = opts.Title;
        TitleAlignment = opts.TitleAlignment;
        BottomTitle = opts.BottomTitle;
        BottomTitleAlignment = opts.BottomTitleAlignment;

        LayoutNode.FlexDirection = opts.FlexDirection;
        LayoutNode.AlignItems = opts.AlignItems;
        LayoutNode.JustifyContent = opts.JustifyContent;
        LayoutNode.FlexGrow = opts.FlexGrow;
        LayoutNode.PaddingTop = opts.PaddingTop;
        LayoutNode.PaddingRight = opts.PaddingRight;
        LayoutNode.PaddingBottom = opts.PaddingBottom;
        LayoutNode.PaddingLeft = opts.PaddingLeft;

        if (opts.Width != null) SetWidth(opts.Width);
        if (opts.Height != null) SetHeight(opts.Height);

        if (Border)
        {
            LayoutNode.PaddingTop = Math.Max(1, LayoutNode.PaddingTop);
            LayoutNode.PaddingRight = Math.Max(1, LayoutNode.PaddingRight);
            LayoutNode.PaddingBottom = Math.Max(1, LayoutNode.PaddingBottom);
            LayoutNode.PaddingLeft = Math.Max(1, LayoutNode.PaddingLeft);
        }

        Focusable = FocusedBorderColor != null;
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var bg = ParseColor(BackgroundColor);

        if (ShouldFill && bg.AlphaByte > 0)
            buffer.FillRect(x, y, w, h, bg);

        if (Border)
        {
            var borderRgba = ParseBorderColor();
            buffer.DrawBorderWithTitles(x, y, w, h, BorderStyle, borderRgba, bg,
                Title, TitleAlignment, BottomTitle, BottomTitleAlignment);
        }
    }

    private Rgba ParseColor(string color)
    {
        if (string.IsNullOrEmpty(color) || color == "transparent")
            return Rgba.FromValues(0, 0, 0, 0);
        return Rgba.FromCss(color);
    }

    private Rgba ParseBorderColor()
    {
        var colorStr = (Focused && FocusedBorderColor != null) ? FocusedBorderColor : BorderColor;
        return ParseColor(colorStr);
    }
}
