using Xunit;
using OpenTui.Core.Events;

namespace OpenTui.Tests
{
    public class EventEmitterTests
    {
        [Fact]
        public void On_Emit_HandlerCalled()
        {
            var e = new EventEmitter();
            int count = 0;
            e.On("click", _ => count++);
            e.Emit("click");
            Assert.Equal(1, count);
        }

        [Fact]
        public void Emit_UnknownEvent_NoOp()
        {
            var e = new EventEmitter();
            e.Emit("nothing"); // no exception
        }

        [Fact]
        public void Off_RemovesHandler()
        {
            var e = new EventEmitter();
            int count = 0;
            System.Action<object?> h = _ => count++;
            e.On("x", h);
            e.Off("x", h);
            e.Emit("x");
            Assert.Equal(0, count);
        }

        [Fact]
        public void Once_FiredOnce()
        {
            var e = new EventEmitter();
            int count = 0;
            e.Once("x", _ => count++);
            e.Emit("x");
            e.Emit("x");
            Assert.Equal(1, count);
        }

        [Fact]
        public void Emit_PassesData()
        {
            var e = new EventEmitter();
            object? received = null;
            e.On("data", d => received = d);
            e.Emit("data", 42);
            Assert.Equal(42, received);
        }

        [Fact]
        public void RemoveAllListeners_ClearsAll()
        {
            var e = new EventEmitter();
            int count = 0;
            e.On("a", _ => count++);
            e.On("b", _ => count++);
            e.RemoveAllListeners();
            e.Emit("a");
            e.Emit("b");
            Assert.Equal(0, count);
        }

        [Fact]
        public void RemoveAllListeners_ForEvent_OnlyRemovesThat()
        {
            var e = new EventEmitter();
            int a = 0, b = 0;
            e.On("a", _ => a++);
            e.On("b", _ => b++);
            e.RemoveAllListeners("a");
            e.Emit("a");
            e.Emit("b");
            Assert.Equal(0, a);
            Assert.Equal(1, b);
        }
    }
}
