namespace OpenTui.Core.Layout;

public readonly struct LayoutDimension
{
    public enum DimType { Fixed, Auto, Percent }

    public DimType Type { get; }
    public float Value { get; }

    private LayoutDimension(DimType type, float value) { Type = type; Value = value; }

    public static LayoutDimension Auto => new(DimType.Auto, 0);
    public static LayoutDimension Fixed(float v) => new(DimType.Fixed, v);
    public static LayoutDimension Percent(float v) => new(DimType.Percent, v);

    public static LayoutDimension Parse(object? value)
    {
        return value switch
        {
            null => Auto,
            int i => Fixed(i),
            float f => Fixed(f),
            double d => Fixed((float)d),
            string s when s.Equals("auto", StringComparison.OrdinalIgnoreCase) => Auto,
            string s when s.EndsWith('%') && float.TryParse(s[..^1], out var pct) => Percent(pct),
            string s when float.TryParse(s, out var n) => Fixed(n),
            _ => Auto,
        };
    }

    public float Resolve(float containerSize)
    {
        return Type switch
        {
            DimType.Fixed => Value,
            DimType.Percent => containerSize * Value / 100f,
            _ => containerSize,
        };
    }
}
