namespace OpenTui.Core.Input;

public class KeyEvent
{
    public string Name { get; init; } = "";
    public string Key { get; init; } = "";
    public bool Ctrl { get; init; }
    public bool Alt { get; init; }
    public bool Shift { get; init; }
    public bool Meta { get; init; }
    public char? Char { get; init; }
}
