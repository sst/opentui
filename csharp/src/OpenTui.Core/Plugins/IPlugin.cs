namespace OpenTui.Core.Plugins
{
    public interface IPlugin
    {
        string Name { get; }
        void Register(PluginRegistry registry);
        void Unregister(PluginRegistry registry);
    }
}
