namespace OpenTui.Core.Layout;

public enum FlexDirection { Row, Column, RowReverse, ColumnReverse }
public enum AlignItems { FlexStart, FlexEnd, Center, Stretch, Baseline }
public enum JustifyContent { FlexStart, FlexEnd, Center, SpaceBetween, SpaceAround, SpaceEvenly }

public class FlexNode
{
    public LayoutDimension Width { get; set; } = LayoutDimension.Auto;
    public LayoutDimension Height { get; set; } = LayoutDimension.Auto;
    public LayoutDimension MinWidth { get; set; } = LayoutDimension.Fixed(0);
    public LayoutDimension MaxWidth { get; set; } = LayoutDimension.Auto;
    public LayoutDimension MinHeight { get; set; } = LayoutDimension.Fixed(0);
    public LayoutDimension MaxHeight { get; set; } = LayoutDimension.Auto;
    public FlexDirection FlexDirection { get; set; } = FlexDirection.Row;
    public AlignItems AlignItems { get; set; } = AlignItems.FlexStart;
    public JustifyContent JustifyContent { get; set; } = JustifyContent.FlexStart;
    public float FlexGrow { get; set; } = 0f;
    public float FlexShrink { get; set; } = 1f;
    public LayoutDimension FlexBasis { get; set; } = LayoutDimension.Auto;
    public string Position { get; set; } = "relative";
    public int? Top { get; set; }
    public int? Left { get; set; }
    public int? Right { get; set; }
    public int? Bottom { get; set; }
    public int PaddingTop { get; set; }
    public int PaddingRight { get; set; }
    public int PaddingBottom { get; set; }
    public int PaddingLeft { get; set; }
    public int MarginTop { get; set; }
    public int MarginRight { get; set; }
    public int MarginBottom { get; set; }
    public int MarginLeft { get; set; }
    public string Overflow { get; set; } = "visible";

    public int ComputedX { get; internal set; }
    public int ComputedY { get; internal set; }
    public int ComputedWidth { get; internal set; }
    public int ComputedHeight { get; internal set; }

    public List<FlexNode> Children { get; } = new();

    public void AddChild(FlexNode child) => Children.Add(child);
    public void RemoveChild(FlexNode child) => Children.Remove(child);

    public void SetPadding(int all) { PaddingTop = PaddingRight = PaddingBottom = PaddingLeft = all; }
    public void SetMargin(int all) { MarginTop = MarginRight = MarginBottom = MarginLeft = all; }
}
