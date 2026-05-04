using OpenTui.Core.Events;
using OpenTui.Core.Input;
using OpenTui.Core.Layout;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public abstract class Renderable : EventEmitter
{
    private static int _idSeq;

    public string Id { get; set; }
    public FlexNode LayoutNode { get; } = new();

    public virtual FlexDirection FlexDirection { get => LayoutNode.FlexDirection; set => LayoutNode.FlexDirection = value; }
    public virtual AlignItems AlignItems { get => LayoutNode.AlignItems; set => LayoutNode.AlignItems = value; }
    public virtual JustifyContent JustifyContent { get => LayoutNode.JustifyContent; set => LayoutNode.JustifyContent = value; }
    public virtual float FlexGrow { get => LayoutNode.FlexGrow; set => LayoutNode.FlexGrow = value; }
    public virtual float FlexShrink { get => LayoutNode.FlexShrink; set => LayoutNode.FlexShrink = value; }
    public virtual string Position { get => LayoutNode.Position; set => LayoutNode.Position = value; }
    public virtual int? Top { get => LayoutNode.Top; set => LayoutNode.Top = value; }
    public virtual int? Left { get => LayoutNode.Left; set => LayoutNode.Left = value; }
    public virtual int? Right { get => LayoutNode.Right; set => LayoutNode.Right = value; }
    public virtual int? Bottom { get => LayoutNode.Bottom; set => LayoutNode.Bottom = value; }
    public virtual int PaddingTop { get => LayoutNode.PaddingTop; set => LayoutNode.PaddingTop = value; }
    public virtual int PaddingRight { get => LayoutNode.PaddingRight; set => LayoutNode.PaddingRight = value; }
    public virtual int PaddingBottom { get => LayoutNode.PaddingBottom; set => LayoutNode.PaddingBottom = value; }
    public virtual int PaddingLeft { get => LayoutNode.PaddingLeft; set => LayoutNode.PaddingLeft = value; }
    public virtual int MarginTop { get => LayoutNode.MarginTop; set => LayoutNode.MarginTop = value; }
    public virtual int MarginRight { get => LayoutNode.MarginRight; set => LayoutNode.MarginRight = value; }
    public virtual int MarginBottom { get => LayoutNode.MarginBottom; set => LayoutNode.MarginBottom = value; }
    public virtual int MarginLeft { get => LayoutNode.MarginLeft; set => LayoutNode.MarginLeft = value; }

    public virtual void SetWidth(object? value) => LayoutNode.Width = LayoutDimension.Parse(value);
    public virtual void SetHeight(object? value) => LayoutNode.Height = LayoutDimension.Parse(value);

    public int X => LayoutNode.ComputedX;
    public int Y => LayoutNode.ComputedY;
    public int ComputedWidth => LayoutNode.ComputedWidth;
    public int ComputedHeight => LayoutNode.ComputedHeight;

    public int ScreenX { get; internal set; }
    public int ScreenY { get; internal set; }

    public int ZIndex { get; set; } = 0;
    public bool Visible { get; set; } = true;
    public float Opacity { get; set; } = 1f;
    public bool Focusable { get; set; } = false;
    public bool Focused { get; private set; } = false;

    public Renderable? Parent { get; private set; }
    protected CliRenderer? Renderer { get; private set; }

    private readonly List<Renderable> _children = new();

    protected Renderable(CliRenderer? renderer = null)
    {
        Id = $"renderable_{Interlocked.Increment(ref _idSeq)}";
        Renderer = renderer;
    }

    public void Add(Renderable child)
    {
        child.Parent = this;
        child.Renderer = Renderer;
        _children.Add(child);
        LayoutNode.AddChild(child.LayoutNode);
    }

    public void Remove(string id)
    {
        var child = _children.FirstOrDefault(c => c.Id == id);
        if (child != null)
        {
            child.Parent = null;
            _children.Remove(child);
            LayoutNode.RemoveChild(child.LayoutNode);
        }
    }

    public List<Renderable> GetChildren() => new(_children);

    public void Focus()
    {
        if (Focused) return;
        Renderer?.OnRenderableFocused(this);
        Focused = true;
        Emit("focused");
    }

    public void Blur()
    {
        if (!Focused) return;
        Renderer?.OnRenderableBlurred(this);
        Focused = false;
        Emit("blurred");
    }

    public virtual void HandleKey(KeyEvent key) { }
    public virtual void HandleMouse(MouseEvent mouse) { }
    public void RequestRender() => Renderer?.RequestRender();

    public virtual void Destroy()
    {
        Emit("destroyed");
        foreach (var child in _children) child.Destroy();
        RemoveAllListeners();
    }

    public virtual void Render(RenderBuffer buffer, double deltaTime)
    {
        if (!Visible) return;

        ScreenX = (Parent?.ScreenX ?? 0) + X;
        ScreenY = (Parent?.ScreenY ?? 0) + Y;

        RenderSelf(buffer, deltaTime);

        var sorted = _children.Where(c => c.Visible).OrderBy(c => c.ZIndex).ToList();
        foreach (var child in sorted)
            child.Render(buffer, deltaTime);
    }

    protected abstract void RenderSelf(RenderBuffer buffer, double deltaTime);
}
