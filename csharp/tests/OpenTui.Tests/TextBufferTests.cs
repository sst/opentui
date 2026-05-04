using Xunit;
using OpenTui.Core.Text;
using OpenTui.Core.Ansi;

namespace OpenTui.Tests
{
    public class TextBufferTests
    {
        [Fact]
        public void SetText_StoresContent()
        {
            using var buf = TextBuffer.Create();
            buf.SetText("Hello World");
            Assert.Equal(11, buf.Length);
        }

        [Fact]
        public void SetText_EmptyString_LengthZero()
        {
            using var buf = TextBuffer.Create();
            buf.SetText("");
            Assert.Equal(0, buf.Length);
        }

        [Fact]
        public void SetText_WithNewlines_NewlinesExcludedFromLength()
        {
            using var buf = TextBuffer.Create();
            buf.SetText("Line 1\nLine 2\nLine 3");
            Assert.Equal(18, buf.Length); // 6+6+6 chars, newlines not counted
        }

        [Fact]
        public void GetPlainText_ReturnsRawText()
        {
            using var buf = TextBuffer.Create();
            buf.SetText("Hello World");
            Assert.Equal("Hello World", buf.GetPlainText());
        }

        [Fact]
        public void GetPlainText_Empty()
        {
            using var buf = TextBuffer.Create();
            buf.SetStyledText(StyledText.FromString(""));
            Assert.Equal("", buf.GetPlainText());
        }

        [Fact]
        public void GetPlainText_WithNewlines()
        {
            using var buf = TextBuffer.Create();
            buf.SetStyledText(StyledText.FromString("Line 1\nLine 2\nLine 3"));
            Assert.Equal("Line 1\nLine 2\nLine 3", buf.GetPlainText());
        }

        [Fact]
        public void GetPlainText_Unicode()
        {
            using var buf = TextBuffer.Create();
            buf.SetStyledText(StyledText.FromString("Hello 世界 🌟"));
            Assert.Equal("Hello 世界 🌟", buf.GetPlainText());
        }

        [Fact]
        public void SetStyledText_LengthMatchesPlainText()
        {
            using var buf = TextBuffer.Create();
            buf.SetStyledText(StyledText.FromString("Hello World"));
            Assert.Equal(11, buf.Length);
        }

        [Fact]
        public void ByteSize_IsPositiveForNonEmpty()
        {
            using var buf = TextBuffer.Create();
            buf.SetText("ABC");
            Assert.True(buf.ByteSize > 0);
        }

        [Fact]
        public void Dispose_ThrowsOnAccess()
        {
            var buf = TextBuffer.Create();
            buf.Dispose();
            Assert.Throws<System.ObjectDisposedException>(() => buf.GetPlainText());
        }
    }
}
