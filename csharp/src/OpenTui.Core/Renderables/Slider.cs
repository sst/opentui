using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class SliderRenderable : Renderable
{
    public float Min { get; set; } = 0;
    public float Max { get; set; } = 100;
    public float Value { get; set; } = 50;
    public float Step { get; set; } = 1;
    public string Orientation { get; set; } = "horizontal";
    public string? TrackColor { get; set; }
    public string? ThumbColor { get; set; }
    public string? ValueColor { get; set; }

    public SliderRenderable(CliRenderer? renderer) : base(renderer)
    {
        Focusable = true;
    }

    public void HandleKey(KeyEvent key)
    {
        bool isHorizontal = Orientation == "horizontal";
        switch (key.Name)
        {
            case "left" when isHorizontal:
            case "down" when !isHorizontal:
                Value = Math.Max(Min, Value - Step);
                Emit("valueChanged", Value);
                RequestRender();
                break;
            case "right" when isHorizontal:
            case "up" when !isHorizontal:
                Value = Math.Min(Max, Value + Step);
                Emit("valueChanged", Value);
                RequestRender();
                break;
        }
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var trackFg = TrackColor != null ? Rgba.FromCss(TrackColor) : Rgba.FromInts(80, 80, 80);
        var thumbFg = ThumbColor != null ? Rgba.FromCss(ThumbColor) : Rgba.FromInts(200, 200, 200);
        var trackBg = Rgba.FromInts(20, 20, 20);

        bool isHorizontal = Orientation == "horizontal";
        float ratio = Max > Min ? (Value - Min) / (Max - Min) : 0;

        if (isHorizontal)
        {
            int trackLen = w;
            int thumbPos = (int)(ratio * (trackLen - 1));

            for (int i = 0; i < trackLen; i++)
            {
                bool isThumb = i == thumbPos;
                buffer.SetCell(x + i, y, isThumb ? '●' : '─',
                    isThumb ? thumbFg : trackFg, trackBg);
            }
        }
        else
        {
            int trackLen = h;
            int thumbPos = (int)((1f - ratio) * (trackLen - 1));

            for (int i = 0; i < trackLen; i++)
            {
                bool isThumb = i == thumbPos;
                buffer.SetCell(x, y + i, isThumb ? '●' : '│',
                    isThumb ? thumbFg : trackFg, trackBg);
            }
        }
    }
}
