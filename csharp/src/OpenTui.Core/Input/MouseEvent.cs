namespace OpenTui.Core.Input;

public enum MouseButton { None, Left, Middle, Right, WheelUp, WheelDown }

public class MouseEvent
{
    public int X { get; init; }
    public int Y { get; init; }
    public MouseButton Button { get; init; }
    public bool Pressed { get; init; }
    public bool Ctrl { get; init; }
    public bool Alt { get; init; }
    public bool Shift { get; init; }
}
