using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class ScrollBoxRenderable : Renderable
{
    public int ScrollX { get; set; } = 0;
    public int ScrollY { get; set; } = 0;
    public bool StickyScroll { get; set; } = false;
    public bool ShowVerticalScrollbar { get; set; } = true;
    public bool ShowHorizontalScrollbar { get; set; } = false;

    public int ContentWidth { get; set; } = 0;
    public int ContentHeight { get; set; } = 0;

    public ScrollBoxRenderable(CliRenderer? renderer) : base(renderer)
    {
        Focusable = true;
    }

    public override void HandleKey(KeyEvent key)
    {
        int viewH = ComputedHeight - (ShowHorizontalScrollbar ? 1 : 0);
        int viewW = ComputedWidth - (ShowVerticalScrollbar ? 1 : 0);
        int maxScrollY = Math.Max(0, ContentHeight - viewH);
        int maxScrollX = Math.Max(0, ContentWidth - viewW);

        switch (key.Name)
        {
            case "up":
                ScrollY = Math.Max(0, ScrollY - 1);
                RequestRender();
                break;
            case "down":
                ScrollY = maxScrollY > 0 ? Math.Min(maxScrollY, ScrollY + 1) : ScrollY + 1;
                RequestRender();
                break;
            case "left":
                ScrollX = Math.Max(0, ScrollX - 1);
                RequestRender();
                break;
            case "right":
                ScrollX = maxScrollX > 0 ? Math.Min(maxScrollX, ScrollX + 1) : ScrollX + 1;
                RequestRender();
                break;
            case "pageup":
                ScrollY = Math.Max(0, ScrollY - viewH);
                RequestRender();
                break;
            case "pagedown":
                ScrollY = maxScrollY > 0 ? Math.Min(maxScrollY, ScrollY + viewH) : ScrollY + viewH;
                RequestRender();
                break;
            case "home":
                ScrollY = 0;
                ScrollX = 0;
                RequestRender();
                break;
            case "end":
                if (maxScrollY > 0) ScrollY = maxScrollY;
                RequestRender();
                break;
        }
    }

    public override void HandleMouse(MouseEvent mouse)
    {
        int viewH = ComputedHeight - (ShowHorizontalScrollbar ? 1 : 0);
        int viewW = ComputedWidth - (ShowVerticalScrollbar ? 1 : 0);
        int maxScrollY = Math.Max(0, ContentHeight - viewH);

        if (mouse.Button == MouseButton.WheelUp)
        {
            ScrollY = Math.Max(0, ScrollY - 3);
            if (StickyScroll) ScrollY = Math.Max(0, ScrollY);
            RequestRender();
        }
        else if (mouse.Button == MouseButton.WheelDown)
        {
            int next = ScrollY + 3;
            ScrollY = maxScrollY > 0 ? Math.Min(maxScrollY, next) : next;
            RequestRender();
        }
    }

    public override void Render(RenderBuffer buffer, double deltaTime)
    {
        if (!Visible) return;

        ScreenX = (Parent?.ScreenX ?? 0) + X;
        ScreenY = (Parent?.ScreenY ?? 0) + Y;

        RenderSelf(buffer, deltaTime);

        int clipX = ScreenX;
        int clipY = ScreenY;
        int clipW = ComputedWidth - (ShowVerticalScrollbar ? 1 : 0);
        int clipH = ComputedHeight - (ShowHorizontalScrollbar ? 1 : 0);

        buffer.SetClipRegion(clipX, clipY, clipW, clipH);

        // Temporarily offset our own screen coords so children inherit the scroll offset:
        //   child.ScreenX = this.ScreenX + child.X  →  (this.ScreenX - ScrollX) + child.X
        int savedScreenX = ScreenX;
        int savedScreenY = ScreenY;
        ScreenX -= ScrollX;
        ScreenY -= ScrollY;

        var sorted = GetChildren().Where(c => c.Visible).OrderBy(c => c.ZIndex).ToList();
        foreach (var child in sorted)
            child.Render(buffer, deltaTime);

        // Restore before drawing the scrollbar (it uses the true ScreenX/Y)
        ScreenX = savedScreenX;
        ScreenY = savedScreenY;

        buffer.SetClipRegion(null, null, null, null);

        if (ShowVerticalScrollbar)
            RenderVerticalScrollbar(buffer);
    }

    private void RenderVerticalScrollbar(RenderBuffer buffer)
    {
        int sbX = ScreenX + ComputedWidth - 1;
        int h = ComputedHeight;
        if (h <= 0) return;

        var trackFg = Rgba.FromInts(60, 60, 60);
        var trackBg = Rgba.FromInts(20, 20, 20);
        var thumbFg = Rgba.FromInts(160, 160, 160);

        for (int row = 0; row < h; row++)
            buffer.SetCell(sbX, ScreenY + row, '│', trackFg, trackBg);

        int viewH = h - (ShowHorizontalScrollbar ? 1 : 0);
        int totalH = ContentHeight > 0 ? ContentHeight : viewH;
        if (totalH > viewH)
        {
            float ratio = (float)ScrollY / (totalH - viewH);
            int thumbY = (int)(ratio * (viewH - 1));
            buffer.SetCell(sbX, ScreenY + thumbY, '█', thumbFg, trackBg);
        }
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime) { }
}
