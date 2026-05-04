namespace OpenTui.Core.Ansi
{
    /// <summary>
    /// Records how the terminal should emit the color:
    /// literal RGB (38;2;r;g;b), indexed palette (38;5;n), or terminal default (39/49).
    /// </summary>
    public enum ColorIntent : byte
    {
        Rgb = 0,
        Indexed = 1,
        Default = 2,
    }
}
