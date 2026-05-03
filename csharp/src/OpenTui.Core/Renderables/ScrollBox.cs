using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class ScrollBoxRenderable : Renderable
{
    public int ScrollX { get; set; } = 0;
    public int ScrollY { get; set; } = 0;
    public bool StickyScroll { get; set; } = false;
    public bool ShowVerticalScrollbar { get; set; } = true;
    public bool ShowHorizontalScrollbar { get; set; } = false;

    public ScrollBoxRenderable(CliRenderer? renderer) : base(renderer) { }

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

        var sorted = GetChildren().Where(c => c.Visible).OrderBy(c => c.ZIndex).ToList();
        foreach (var child in sorted)
        {
            // Offset child screen position by scroll
            var savedParentX = ScreenX;
            var savedParentY = ScreenY;
            child.Render(buffer, deltaTime);
        }

        buffer.SetClipRegion(null, null, null, null);
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        // Background fill if needed
    }
}
