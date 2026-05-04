using System;
using System.Collections.Generic;

namespace OpenTui.Core.Plugins
{
    /// <summary>Manages plugin registration lifecycle.</summary>
    public sealed class PluginRegistry
    {
        private readonly Dictionary<string, IPlugin> _plugins =
            new(StringComparer.OrdinalIgnoreCase);

        public void Register(IPlugin plugin)
        {
            if (_plugins.ContainsKey(plugin.Name))
                throw new InvalidOperationException($"Plugin '{plugin.Name}' is already registered.");
            _plugins[plugin.Name] = plugin;
            plugin.Register(this);
        }

        public void Unregister(string name)
        {
            if (_plugins.TryGetValue(name, out var plugin))
            {
                plugin.Unregister(this);
                _plugins.Remove(name);
            }
        }

        public IPlugin? Get(string name)        => _plugins.TryGetValue(name, out var p) ? p : null;
        public bool     Has(string name)        => _plugins.ContainsKey(name);
        public IEnumerable<IPlugin> All         => _plugins.Values;
    }
}
