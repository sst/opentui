using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Layout;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class TabSelectRenderable : Renderable
{
    public List<string> Tabs { get; set; } = new();
    public int SelectedIndex { get; set; } = 0;
    public string? ActiveFg { get; set; }
    public string? ActiveBg { get; set; }
    public string? InactiveFg { get; set; }
    public string? InactiveBg { get; set; }

    public TabSelectRenderable(CliRenderer? renderer) : base(renderer)
    {
        Focusable = true;
        LayoutNode.Height = LayoutDimension.Fixed(1);
    }

    public void HandleKey(KeyEvent key)
    {
        switch (key.Name)
        {
            case "left":
                if (SelectedIndex > 0)
                {
                    SelectedIndex--;
                    Emit("tabChanged", SelectedIndex);
                    RequestRender();
                }
                break;
            case "right":
                if (SelectedIndex < Tabs.Count - 1)
                {
                    SelectedIndex++;
                    Emit("tabChanged", SelectedIndex);
                    RequestRender();
                }
                break;
        }
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY;

        var activeFg = ActiveFg != null ? Rgba.FromCss(ActiveFg) : Rgba.FromInts(255, 255, 255);
        var activeBg = ActiveBg != null ? Rgba.FromCss(ActiveBg) : Rgba.FromInts(0, 85, 170);
        var inactiveFg = InactiveFg != null ? Rgba.FromCss(InactiveFg) : Rgba.FromInts(180, 180, 180);
        var inactiveBg = InactiveBg != null ? Rgba.FromCss(InactiveBg) : Rgba.FromInts(40, 40, 40);

        int col = x;
        for (int i = 0; i < Tabs.Count; i++)
        {
            bool active = i == SelectedIndex;
            var fg = active ? activeFg : inactiveFg;
            var bg = active ? activeBg : inactiveBg;
            var label = " " + Tabs[i] + " ";
            buffer.FillRect(col, y, label.Length, 1, bg);
            buffer.DrawText(col, y, label, fg, bg);
            col += label.Length;
        }
    }
}
