using Xunit;
using OpenTui.Core.Plugins;

namespace OpenTui.Tests
{
    public class PluginRegistryTests
    {
        private sealed class DemoPlugin : IPlugin
        {
            public string Name => "demo";
            public bool Registered   { get; private set; }
            public bool Unregistered { get; private set; }
            public void Register(PluginRegistry r)   => Registered   = true;
            public void Unregister(PluginRegistry r) => Unregistered = true;
        }

        [Fact]
        public void Register_CallsPluginRegister()
        {
            var reg = new PluginRegistry();
            var p   = new DemoPlugin();
            reg.Register(p);
            Assert.True(p.Registered);
        }

        [Fact]
        public void Has_AfterRegister_True()
        {
            var reg = new PluginRegistry();
            reg.Register(new DemoPlugin());
            Assert.True(reg.Has("demo"));
        }

        [Fact]
        public void Get_ReturnsPlugin()
        {
            var reg = new PluginRegistry();
            var p   = new DemoPlugin();
            reg.Register(p);
            Assert.Same(p, reg.Get("demo"));
        }

        [Fact]
        public void Register_Duplicate_Throws()
        {
            var reg = new PluginRegistry();
            reg.Register(new DemoPlugin());
            Assert.Throws<System.InvalidOperationException>(() => reg.Register(new DemoPlugin()));
        }

        [Fact]
        public void Unregister_CallsPluginUnregister()
        {
            var reg = new PluginRegistry();
            var p   = new DemoPlugin();
            reg.Register(p);
            reg.Unregister("demo");
            Assert.True(p.Unregistered);
        }

        [Fact]
        public void Unregister_Has_False()
        {
            var reg = new PluginRegistry();
            reg.Register(new DemoPlugin());
            reg.Unregister("demo");
            Assert.False(reg.Has("demo"));
        }

        [Fact]
        public void All_ReturnsRegisteredPlugins()
        {
            var reg = new PluginRegistry();
            reg.Register(new DemoPlugin());
            Assert.Single(reg.All);
        }
    }
}
