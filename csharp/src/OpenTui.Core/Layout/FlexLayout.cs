namespace OpenTui.Core.Layout;

public static class FlexLayout
{
    public static void Calculate(FlexNode root, int containerWidth, int containerHeight)
    {
        root.ComputedX = 0;
        root.ComputedY = 0;
        root.ComputedWidth = containerWidth;
        root.ComputedHeight = containerHeight;
        LayoutNode(root);
    }

    private static void LayoutNode(FlexNode node)
    {
        if (node.Children.Count == 0) return;

        bool isRow = node.FlexDirection == FlexDirection.Row || node.FlexDirection == FlexDirection.RowReverse;
        bool isReverse = node.FlexDirection == FlexDirection.RowReverse || node.FlexDirection == FlexDirection.ColumnReverse;

        int innerX = node.PaddingLeft;
        int innerY = node.PaddingTop;
        int innerWidth = Math.Max(0, node.ComputedWidth - node.PaddingLeft - node.PaddingRight);
        int innerHeight = Math.Max(0, node.ComputedHeight - node.PaddingTop - node.PaddingBottom);

        var flexItems = new List<FlexNode>();
        var absoluteItems = new List<FlexNode>();

        foreach (var child in node.Children)
        {
            if (child.Position == "absolute")
                absoluteItems.Add(child);
            else
                flexItems.Add(child);
        }

        // Position absolute children
        foreach (var child in absoluteItems)
        {
            int cw = child.Width.Type == LayoutDimension.DimType.Auto
                ? innerWidth
                : (int)child.Width.Resolve(innerWidth);
            int ch = child.Height.Type == LayoutDimension.DimType.Auto
                ? innerHeight
                : (int)child.Height.Resolve(innerHeight);

            if (child.Right.HasValue && !child.Left.HasValue)
                child.ComputedX = node.ComputedWidth - cw - child.Right.Value;
            else
                child.ComputedX = child.Left ?? 0;

            if (child.Bottom.HasValue && !child.Top.HasValue)
                child.ComputedY = node.ComputedHeight - ch - child.Bottom.Value;
            else
                child.ComputedY = child.Top ?? 0;

            child.ComputedWidth = cw;
            child.ComputedHeight = ch;
            LayoutNode(child);
        }

        if (flexItems.Count == 0) return;

        // Compute base sizes for flex items
        var baseSizes = new float[flexItems.Count];
        float totalBase = 0;
        float totalGrow = 0;
        float totalShrink = 0;

        for (int i = 0; i < flexItems.Count; i++)
        {
            var child = flexItems[i];
            float margin = isRow
                ? child.MarginLeft + child.MarginRight
                : child.MarginTop + child.MarginBottom;

            float baseSize;
            if (child.FlexBasis.Type != LayoutDimension.DimType.Auto)
            {
                baseSize = child.FlexBasis.Resolve(isRow ? innerWidth : innerHeight);
            }
            else if (isRow && child.Width.Type != LayoutDimension.DimType.Auto)
            {
                baseSize = child.Width.Resolve(innerWidth);
            }
            else if (!isRow && child.Height.Type != LayoutDimension.DimType.Auto)
            {
                baseSize = child.Height.Resolve(innerHeight);
            }
            else
            {
                baseSize = 0;
            }

            baseSizes[i] = baseSize + margin;
            totalBase += baseSize + margin;
            totalGrow += child.FlexGrow;
            totalShrink += child.FlexShrink;
        }

        float containerMain = isRow ? innerWidth : innerHeight;
        float freeSpace = containerMain - totalBase;

        // Distribute free space
        var finalSizes = new float[flexItems.Count];
        for (int i = 0; i < flexItems.Count; i++)
        {
            var child = flexItems[i];
            float margin = isRow
                ? child.MarginLeft + child.MarginRight
                : child.MarginTop + child.MarginBottom;

            float size = baseSizes[i] - margin;

            if (freeSpace > 0 && totalGrow > 0 && child.FlexGrow > 0)
                size += freeSpace * (child.FlexGrow / totalGrow);
            else if (freeSpace < 0 && totalShrink > 0 && child.FlexShrink > 0)
                size += freeSpace * (child.FlexShrink / totalShrink);

            // Apply min/max constraints
            float minMain = isRow
                ? child.MinWidth.Resolve(innerWidth)
                : child.MinHeight.Resolve(innerHeight);
            float maxMain = isRow
                ? (child.MaxWidth.Type == LayoutDimension.DimType.Auto ? float.MaxValue : child.MaxWidth.Resolve(innerWidth))
                : (child.MaxHeight.Type == LayoutDimension.DimType.Auto ? float.MaxValue : child.MaxHeight.Resolve(innerHeight));

            size = Math.Max(minMain, Math.Min(maxMain, size));
            finalSizes[i] = size;
        }

        // JustifyContent positioning
        float usedSpace = finalSizes.Sum(s => s) +
            flexItems.Select((c, i) => isRow ? c.MarginLeft + c.MarginRight : c.MarginTop + c.MarginBottom).Sum();
        float remaining = containerMain - usedSpace;

        float startOffset = 0;
        float gap = 0;

        switch (node.JustifyContent)
        {
            case JustifyContent.FlexEnd:
                startOffset = remaining;
                break;
            case JustifyContent.Center:
                startOffset = remaining / 2f;
                break;
            case JustifyContent.SpaceBetween:
                if (flexItems.Count > 1) gap = remaining / (flexItems.Count - 1);
                break;
            case JustifyContent.SpaceAround:
                gap = remaining / flexItems.Count;
                startOffset = gap / 2f;
                break;
            case JustifyContent.SpaceEvenly:
                gap = remaining / (flexItems.Count + 1);
                startOffset = gap;
                break;
        }

        float mainPos = (isRow ? innerX : innerY) + startOffset;
        if (isReverse)
            mainPos = (isRow ? innerX + innerWidth : innerY + innerHeight) - startOffset;

        // Position items
        for (int i = 0; i < flexItems.Count; i++)
        {
            var child = flexItems[i];
            float mainSize = finalSizes[i];
            float marginBefore = isRow ? child.MarginLeft : child.MarginTop;
            float marginAfter = isRow ? child.MarginRight : child.MarginBottom;

            // Cross axis size
            float crossSize;
            if (isRow)
            {
                if (child.Height.Type != LayoutDimension.DimType.Auto)
                    crossSize = child.Height.Resolve(innerHeight);
                else if (node.AlignItems == AlignItems.Stretch)
                    crossSize = innerHeight - child.MarginTop - child.MarginBottom;
                else
                    crossSize = innerHeight - child.MarginTop - child.MarginBottom;
            }
            else
            {
                if (child.Width.Type != LayoutDimension.DimType.Auto)
                    crossSize = child.Width.Resolve(innerWidth);
                else if (node.AlignItems == AlignItems.Stretch)
                    crossSize = innerWidth - child.MarginLeft - child.MarginRight;
                else
                    crossSize = innerWidth - child.MarginLeft - child.MarginRight;
            }

            // Cross axis position (AlignItems)
            float crossPos;
            float crossContainer = isRow ? innerHeight : innerWidth;
            float crossMarginBefore = isRow ? child.MarginTop : child.MarginLeft;
            float crossMarginAfter = isRow ? child.MarginBottom : child.MarginRight;

            switch (node.AlignItems)
            {
                case AlignItems.FlexEnd:
                    crossPos = (isRow ? innerY : innerX) + crossContainer - crossSize - crossMarginAfter;
                    break;
                case AlignItems.Center:
                    crossPos = (isRow ? innerY : innerX) + (crossContainer - crossSize) / 2f;
                    break;
                default:
                    crossPos = (isRow ? innerY : innerX) + crossMarginBefore;
                    break;
            }

            if (isReverse)
                mainPos -= mainSize + marginAfter;

            int cx = isRow ? (int)(mainPos + marginBefore) : (int)crossPos;
            int cy = isRow ? (int)crossPos : (int)(mainPos + marginBefore);

            child.ComputedX = cx;
            child.ComputedY = cy;
            child.ComputedWidth = isRow ? (int)mainSize : (int)crossSize;
            child.ComputedHeight = isRow ? (int)crossSize : (int)mainSize;

            if (!isReverse)
                mainPos += mainSize + marginBefore + marginAfter + gap;
            else
                mainPos -= marginBefore + gap;

            LayoutNode(child);
        }
    }
}
