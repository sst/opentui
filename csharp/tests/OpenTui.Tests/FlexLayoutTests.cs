using OpenTui.Core.Layout;

namespace OpenTui.Tests;

public class FlexLayoutTests
{
    [Fact]
    public void Calculate_NestedPadding_ProducesChildLocalCoordinates()
    {
        var root = new FlexNode
        {
            FlexDirection = FlexDirection.Column,
            PaddingTop = 1,
            PaddingLeft = 1
        };
        var parent = new FlexNode
        {
            FlexDirection = FlexDirection.Row,
            FlexGrow = 1,
            PaddingTop = 1,
            PaddingLeft = 1,
            PaddingBottom = 1,
            PaddingRight = 1
        };
        parent.Width = LayoutDimension.Percent(100);

        var child = new FlexNode
        {
            FlexGrow = 1
        };
        child.Height = LayoutDimension.Percent(100);

        root.AddChild(parent);
        parent.AddChild(child);

        FlexLayout.Calculate(root, 80, 24);

        Assert.Equal(1, parent.ComputedX);
        Assert.Equal(1, parent.ComputedY);
        Assert.Equal(1, child.ComputedX);
        Assert.Equal(1, child.ComputedY);
        Assert.Equal(parent.ComputedHeight - 2, child.ComputedHeight);
    }
}
