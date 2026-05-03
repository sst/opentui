using OpenTui.Core.Events;

namespace OpenTui.Core.Input;

public class KeyHandler : EventEmitter
{
    public void On(string eventName, Action<KeyEvent> handler)
    {
        On(eventName, (object? data) =>
        {
            if (data is KeyEvent key) handler(key);
        });
    }

    public void On(string eventName, Action<MouseEvent> handler)
    {
        On(eventName, (object? data) =>
        {
            if (data is MouseEvent mouse) handler(mouse);
        });
    }

    public void EmitKey(KeyEvent key) => Emit("keypress", key);
    public void EmitMouse(MouseEvent mouse) => Emit("mouse", mouse);
}
