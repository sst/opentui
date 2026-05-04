using System;
using System.Collections.Generic;

namespace OpenTui.Core.Events
{
    /// <summary>
    /// Simple on/off/once/emit event bus. C# equivalent of the Node.js EventEmitter
    /// used throughout the TypeScript codebase.
    /// </summary>
    public class EventEmitter
    {
        private readonly Dictionary<string, List<Action<object?>>> _handlers = new();

        public void On(string eventName, Action<object?> handler)
        {
            if (!_handlers.TryGetValue(eventName, out var list))
                _handlers[eventName] = list = new List<Action<object?>>();
            list.Add(handler);
        }

        public void Off(string eventName, Action<object?> handler)
        {
            if (_handlers.TryGetValue(eventName, out var list))
                list.Remove(handler);
        }

        public void Once(string eventName, Action<object?> handler)
        {
            Action<object?>? wrapper = null;
            wrapper = data => { handler(data); Off(eventName, wrapper!); };
            On(eventName, wrapper);
        }

        public void Emit(string eventName, object? data = null)
        {
            if (!_handlers.TryGetValue(eventName, out var list)) return;
            foreach (var h in new List<Action<object?>>(list))
                h(data);
        }

        public void RemoveAllListeners(string? eventName = null)
        {
            if (eventName == null) _handlers.Clear();
            else _handlers.Remove(eventName);
        }
    }
}
