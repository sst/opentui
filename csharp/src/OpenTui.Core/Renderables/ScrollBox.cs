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
    public bool Border { get; set; } = true;
    public string BorderColor { get; set; } = "#7aa2f7";
    public string BackgroundColor { get; set; } = "#1a1b26";
    public string TrackColor { get; set; } = "#414868";
    public string ThumbColor { get; set; } = "#7aa2f7";

    public int ContentWidth { get; set; } = 0;
    public int ContentHeight { get; set; } = 0;

    private bool _draggingVertical;
    private bool _draggingHorizontal;

    public ScrollBoxRenderable(CliRenderer? renderer) : base(renderer)
    {
        Focusable = true;
    }

    public override void HandleKey(KeyEvent key)
    {
        int viewH = GetViewportHeight();
        int viewW = GetViewportWidth();
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
        int viewH = GetViewportHeight();
        int viewW = GetViewportWidth();
        int maxScrollY = Math.Max(0, ContentHeight - viewH);
        int maxScrollX = Math.Max(0, ContentWidth - viewW);

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
        else if (mouse.Button == MouseButton.Left && mouse.Pressed)
        {
            if (_draggingVertical || IsOnVerticalScrollbar(mouse.X, mouse.Y))
            {
                _draggingVertical = true;
                SetVerticalScrollFromMouse(mouse.Y, maxScrollY, viewH);
                RequestRender();
            }
            else if (_draggingHorizontal || IsOnHorizontalScrollbar(mouse.X, mouse.Y))
            {
                _draggingHorizontal = true;
                SetHorizontalScrollFromMouse(mouse.X, maxScrollX, viewW);
                RequestRender();
            }
        }
        else if (mouse.Button == MouseButton.Left && !mouse.Pressed)
        {
            _draggingVertical = false;
            _draggingHorizontal = false;
        }
    }

    public override void Render(RenderBuffer buffer, double deltaTime)
    {
        if (!Visible) return;

        ScreenX = (Parent?.ScreenX ?? 0) + X;
        ScreenY = (Parent?.ScreenY ?? 0) + Y;

        RenderSelf(buffer, deltaTime);

        int inset = Border ? 1 : 0;
        int clipX = ScreenX + inset;
        int clipY = ScreenY + inset;
        int clipW = GetViewportWidth();
        int clipH = GetViewportHeight();

        buffer.SetClipRegion(clipX, clipY, clipW, clipH);

        // Temporarily offset our own screen coords so children inherit the scroll offset:
        //   child.ScreenX = this.ScreenX + child.X  →  (this.ScreenX - ScrollX) + child.X
        int savedScreenX = ScreenX;
        int savedScreenY = ScreenY;
        ScreenX += inset - ScrollX;
        ScreenY += inset - ScrollY;

        var sorted = GetChildren().Where(c => c.Visible).OrderBy(c => c.ZIndex).ToList();
        foreach (var child in sorted)
            child.Render(buffer, deltaTime);

        // Restore before drawing the scrollbar (it uses the true ScreenX/Y)
        ScreenX = savedScreenX;
        ScreenY = savedScreenY;

        buffer.SetClipRegion(null, null, null, null);

        if (ShowVerticalScrollbar)
            RenderVerticalScrollbar(buffer);

        if (ShowHorizontalScrollbar)
            RenderHorizontalScrollbar(buffer);
    }

    private void RenderVerticalScrollbar(RenderBuffer buffer)
    {
        int inset = Border ? 1 : 0;
        int sbX = ScreenX + ComputedWidth - 1 - inset;
        int h = GetViewportHeight();
        if (h <= 0) return;

        var trackFg = Rgba.FromCss(TrackColor);
        var trackBg = Rgba.FromCss(BackgroundColor);
        var thumbFg = Rgba.FromCss(ThumbColor);

        for (int row = 0; row < h; row++)
            buffer.SetCell(sbX, ScreenY + inset + row, '│', trackFg, trackBg);

        int viewH = h;
        int totalH = ContentHeight > 0 ? ContentHeight : viewH;
        if (totalH > viewH)
        {
            float ratio = (float)ScrollY / (totalH - viewH);
            int thumbY = (int)(ratio * (viewH - 1));
            buffer.SetCell(sbX, ScreenY + inset + thumbY, '█', thumbFg, trackBg);
        }
    }

    private bool IsOnVerticalScrollbar(int x, int y)
    {
        if (!ShowVerticalScrollbar) return false;
        int inset = Border ? 1 : 0;
        int sbX = ScreenX + ComputedWidth - 1 - inset;
        int top = ScreenY + inset;
        int bottom = top + GetViewportHeight();
        return x == sbX && y >= top && y < bottom;
    }

    private bool IsOnHorizontalScrollbar(int x, int y)
    {
        if (!ShowHorizontalScrollbar) return false;
        int inset = Border ? 1 : 0;
        int sbY = ScreenY + ComputedHeight - 1 - inset;
        int left = ScreenX + inset;
        int right = left + GetViewportWidth();
        return y == sbY && x >= left && x < right;
    }

    private void SetVerticalScrollFromMouse(int y, int maxScrollY, int viewH)
    {
        if (maxScrollY <= 0 || viewH <= 1)
        {
            ScrollY = 0;
            return;
        }

        int inset = Border ? 1 : 0;
        int trackTop = ScreenY + inset;
        int pos = Math.Clamp(y - trackTop, 0, viewH - 1);
        ScrollY = (int)Math.Round((double)pos / (viewH - 1) * maxScrollY);
    }

    private void SetHorizontalScrollFromMouse(int x, int maxScrollX, int viewW)
    {
        if (maxScrollX <= 0 || viewW <= 1)
        {
            ScrollX = 0;
            return;
        }

        int inset = Border ? 1 : 0;
        int trackLeft = ScreenX + inset;
        int pos = Math.Clamp(x - trackLeft, 0, viewW - 1);
        ScrollX = (int)Math.Round((double)pos / (viewW - 1) * maxScrollX);
    }

    private void RenderHorizontalScrollbar(RenderBuffer buffer)
    {
        int inset = Border ? 1 : 0;
        int sbY = ScreenY + ComputedHeight - 1 - inset;
        int w = GetViewportWidth();
        if (w <= 0) return;

        var trackFg = Rgba.FromCss(TrackColor);
        var trackBg = Rgba.FromCss(BackgroundColor);
        var thumbFg = Rgba.FromCss(ThumbColor);

        for (int col = 0; col < w; col++)
            buffer.SetCell(ScreenX + inset + col, sbY, '─', trackFg, trackBg);

        int totalW = ContentWidth > 0 ? ContentWidth : w;
        if (totalW > w)
        {
            float ratio = (float)ScrollX / (totalW - w);
            int thumbX = (int)(ratio * (w - 1));
            buffer.SetCell(ScreenX + inset + thumbX, sbY, '█', thumbFg, trackBg);
        }
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int x = ScreenX, y = ScreenY, w = ComputedWidth, h = ComputedHeight;
        if (w <= 0 || h <= 0) return;

        var bg = Rgba.FromCss(BackgroundColor);
        buffer.FillRect(x, y, w, h, bg);

        if (Border)
            buffer.DrawBorder(x, y, w, h, "single", Rgba.FromCss(BorderColor), bg);
    }

    private int GetViewportWidth()
    {
        int inset = Border ? 2 : 0;
        int scrollbar = ShowVerticalScrollbar ? 1 : 0;
        return Math.Max(0, ComputedWidth - inset - scrollbar);
    }

    private int GetViewportHeight()
    {
        int inset = Border ? 2 : 0;
        int scrollbar = ShowHorizontalScrollbar ? 1 : 0;
        return Math.Max(0, ComputedHeight - inset - scrollbar);
    }
}
