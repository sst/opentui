using Xunit;
using OpenTui.Core.Syntax;
using OpenTui.Core.Ansi;
using System.Linq;

namespace OpenTui.Tests
{
    public class SyntaxStyleTests
    {
        [Fact]
        public void RegisterStyle_CanBeRetrieved()
        {
            var s = SyntaxStyle.Create();
            s.RegisterStyle(new StyleDefinition { Name = "keyword", Fg = Rgba.FromInts(0, 128, 255) });
            var d = s.GetStyle("keyword");
            Assert.NotNull(d);
            Assert.Equal("keyword", d!.Name);
        }

        [Fact]
        public void GetStyle_UnknownName_ReturnsNull()
            => Assert.Null(SyntaxStyle.Create().GetStyle("nope"));

        [Fact]
        public void GetStyle_CaseInsensitive()
        {
            var s = SyntaxStyle.Create();
            s.RegisterStyle(new StyleDefinition { Name = "Keyword" });
            Assert.NotNull(s.GetStyle("keyword"));
            Assert.NotNull(s.GetStyle("KEYWORD"));
        }

        [Fact]
        public void RegisterStyle_OverwritesSameName()
        {
            var s = SyntaxStyle.Create();
            s.RegisterStyle(new StyleDefinition { Name = "kw", Fg = Rgba.FromInts(255, 0, 0) });
            s.RegisterStyle(new StyleDefinition { Name = "kw", Fg = Rgba.FromInts(0, 255, 0) });
            Assert.Equal(Rgba.FromInts(0, 255, 0), s.GetStyle("kw")!.Fg);
        }

        [Fact]
        public void MergeStyles_OverrideWinsOnNonNullFg()
        {
            var red  = Rgba.FromInts(255, 0, 0);
            var blue = Rgba.FromInts(0,   0, 255);
            var b    = new StyleDefinition { Name = "b", Fg = red };
            var o    = new StyleDefinition { Name = "o", Fg = blue };
            var merged = SyntaxStyle.MergeStyles(b, o);
            Assert.Equal(blue, merged.Fg);
        }

        [Fact]
        public void MergeStyles_BaseWinsWhenOverrideFgIsNull()
        {
            var red = Rgba.FromInts(255, 0, 0);
            var b   = new StyleDefinition { Name = "b", Fg = red };
            var o   = new StyleDefinition { Name = "o" };
            var merged = SyntaxStyle.MergeStyles(b, o);
            Assert.Equal(red, merged.Fg);
        }

        [Fact]
        public void MergeStyles_AttributesAreCombined()
        {
            var b = new StyleDefinition { Name = "b", Attributes = TextAttributes.Bold };
            var o = new StyleDefinition { Name = "o", Attributes = TextAttributes.Italic };
            var merged = SyntaxStyle.MergeStyles(b, o);
            Assert.True((merged.Attributes & TextAttributes.Bold)   != 0);
            Assert.True((merged.Attributes & TextAttributes.Italic) != 0);
        }

        [Fact]
        public void MergeStyles_PriorityTakesMax()
        {
            var b = new StyleDefinition { Name = "b", Priority = 5 };
            var o = new StyleDefinition { Name = "o", Priority = 10 };
            Assert.Equal(10, SyntaxStyle.MergeStyles(b, o).Priority);
        }

        [Fact]
        public void AllStyles_ReturnsAllRegistered()
        {
            var s = SyntaxStyle.Create();
            s.RegisterStyle(new StyleDefinition { Name = "keyword" });
            s.RegisterStyle(new StyleDefinition { Name = "string" });
            s.RegisterStyle(new StyleDefinition { Name = "comment" });
            Assert.Equal(3, s.AllStyles.Count());
        }
    }
}
