using System.Text;
using Xunit;
using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

namespace OpenTui.Tests
{
    public class CellBufferTests
    {
        private static Rgba White => Rgba.FromValues(1f, 1f, 1f);
        private static Rgba Black => Rgba.FromValues(0f, 0f, 0f);

        // ── create / dimensions ───────────────────────────────────────────────────

        [Fact]
        public void Create_SetsWidthAndHeight()
        {
            using var buf = CellBuffer.Create(20, 5, "test-buf");
            Assert.Equal(20, buf.Width);
            Assert.Equal(5,  buf.Height);
        }

        [Fact]
        public void Create_NegativeWidth_Throws()
            => Assert.Throws<System.ArgumentOutOfRangeException>(() => CellBuffer.Create(-1, 5));

        // ── EncodeUnicode ─────────────────────────────────────────────────────────

        [Fact]
        public void EncodeUnicode_Ascii_OneColumnPerChar()
        {
            using var buf = CellBuffer.Create(20, 5);
            var e = buf.EncodeUnicode("Hello");
            Assert.Equal(5, e.Count);
            Assert.Equal((1, (int)'H'), e[0]);
            Assert.Equal((1, (int)'e'), e[1]);
        }

        [Fact]
        public void EncodeUnicode_Emoji_TwoColumns()
        {
            using var buf = CellBuffer.Create(20, 5);
            var e = buf.EncodeUnicode("👋");
            Assert.Single(e);
            Assert.Equal(2, e[0].Width);
        }

        [Fact]
        public void EncodeUnicode_Empty_ReturnsEmpty()
        {
            using var buf = CellBuffer.Create(20, 5);
            Assert.Empty(buf.EncodeUnicode(""));
        }

        [Fact]
        public void EncodeUnicode_Mixed_CorrectWidths()
        {
            using var buf = CellBuffer.Create(20, 5);
            var e = buf.EncodeUnicode("Hi 👋 World"); // H,i, ,👋, ,W,o,r,l,d => 10
            Assert.Equal(10, e.Count);
            Assert.Equal(1, e[0].Width);  // H
            Assert.Equal(2, e[3].Width);  // emoji
        }

        // ── DrawText ──────────────────────────────────────────────────────────────

        [Fact]
        public void DrawText_Ascii_Roundtrip()
        {
            using var buf = CellBuffer.Create(20, 5);
            buf.Clear(Black);
            buf.DrawText("Hello", 0, 0, White, Black);
            var text = Encoding.UTF8.GetString(buf.GetRealCharBytes(false));
            Assert.Contains("Hello", text);
        }

        [Fact]
        public void DrawText_Emoji_Roundtrip()
        {
            using var buf = CellBuffer.Create(20, 5);
            buf.DrawText("👋", 0, 0, White, Black);
            var text = Encoding.UTF8.GetString(buf.GetRealCharBytes(false));
            Assert.Contains("👋", text);
        }

        [Fact]
        public void DrawText_Unicode_CJK_Roundtrip()
        {
            using var buf = CellBuffer.Create(20, 5);
            buf.DrawText("世界", 0, 0, White, Black);
            var text = Encoding.UTF8.GetString(buf.GetRealCharBytes(false));
            Assert.Contains("世界", text);
        }

        // ── SetCell / GetCell ─────────────────────────────────────────────────────

        [Fact]
        public void SetCell_StoresCodepoint()
        {
            using var buf = CellBuffer.Create(20, 5);
            buf.SetCell(3, 1, 'Z', White, Black);
            Assert.Equal('Z', buf.GetCell(3, 1)!.Value.Codepoint);
        }

        [Fact]
        public void GetCell_OutOfBounds_ReturnsNull()
        {
            using var buf = CellBuffer.Create(5, 5);
            Assert.Null(buf.GetCell(10, 10));
        }

        // ── Clear ────────────────────────────────────────────────────────────────

        [Fact]
        public void Clear_FillsBackground()
        {
            using var buf = CellBuffer.Create(5, 5);
            var red = Rgba.FromInts(255, 0, 0);
            buf.Clear(red);
            Assert.Equal(red, buf.GetCell(0, 0)!.Value.Bg);
        }

        // ── DrawFrameBuffer ───────────────────────────────────────────────────────

        [Fact]
        public void DrawFrameBuffer_BlitsChildContent()
        {
            using var parent = CellBuffer.Create(20, 5);
            using var child  = CellBuffer.Create(10, 3);
            child.DrawText("Hi!", 0, 0, White, Black);
            parent.DrawFrameBuffer(0, 0, child);
            var text = Encoding.UTF8.GetString(parent.GetRealCharBytes(false));
            Assert.Contains("Hi!", text);
        }

        [Fact]
        public void DrawFrameBuffer_AlphaBlend_WhenRespectAlpha()
        {
            using var parent = CellBuffer.Create(5, 5);
            using var child  = CellBuffer.Create(5, 5, respectAlpha: true);
            var transparent = Rgba.FromInts(255, 0, 0, 0);
            child.Clear(transparent);
            child.DrawText("A", 0, 0, White, transparent);
            // parent keeps its own background when child bg is transparent
            var origBg = Rgba.FromInts(0, 0, 200, 255);
            parent.Clear(origBg);
            parent.DrawFrameBuffer(0, 0, child);
            // The background should have been alpha-blended, not fully replaced
            var resultBg = parent.GetCell(0, 0)!.Value.Bg;
            Assert.NotEqual(origBg, resultBg); // some blending occurred
        }

        // ── Resize ────────────────────────────────────────────────────────────────

        [Fact]
        public void Resize_UpdatesDimensions()
        {
            using var buf = CellBuffer.Create(10, 5);
            buf.Resize(20, 10);
            Assert.Equal(20, buf.Width);
            Assert.Equal(10, buf.Height);
        }

        [Fact]
        public void Resize_PreservesExistingCell()
        {
            using var buf = CellBuffer.Create(10, 5);
            buf.SetCell(2, 1, 'X', White, Black);
            buf.Resize(20, 10);
            Assert.Equal('X', buf.GetCell(2, 1)!.Value.Codepoint);
        }

        // ── GetRealCharBytes ──────────────────────────────────────────────────────

        [Fact]
        public void GetRealCharBytes_WithLineBreaks_ContainsNewline()
        {
            using var buf = CellBuffer.Create(5, 3);
            buf.DrawText("A", 0, 0, White, Black);
            buf.DrawText("B", 0, 1, White, Black);
            var text = Encoding.UTF8.GetString(buf.GetRealCharBytes(true));
            Assert.Contains("\n", text);
        }

        [Fact]
        public void GetRealCharBytes_WideCharacters_SkipsContinuationCells()
        {
            using var buf = CellBuffer.Create(6, 1);
            buf.DrawText("世", 0, 0, White, Black);
            buf.DrawText("X", 2, 0, White, Black);

            var text = Encoding.UTF8.GetString(buf.GetRealCharBytes(false));

            Assert.StartsWith("世X", text);
        }

        // ── DrawBox ───────────────────────────────────────────────────────────────

        [Fact]
        public void DrawBox_Single_CorrectCorners()
        {
            using var buf = CellBuffer.Create(20, 10);
            buf.DrawBox(0, 0, 10, 5, White, Black);
            Assert.Equal('┌', buf.GetCell(0, 0)!.Value.Codepoint);
            Assert.Equal('┐', buf.GetCell(9, 0)!.Value.Codepoint);
            Assert.Equal('└', buf.GetCell(0, 4)!.Value.Codepoint);
            Assert.Equal('┘', buf.GetCell(9, 4)!.Value.Codepoint);
        }

        [Fact]
        public void DrawBox_Double_CorrectCorners()
        {
            using var buf = CellBuffer.Create(20, 10);
            buf.DrawBox(0, 0, 10, 5, White, Black, BorderStyle.Double);
            Assert.Equal('╔', buf.GetCell(0, 0)!.Value.Codepoint);
            Assert.Equal('╝', buf.GetCell(9, 4)!.Value.Codepoint);
        }

        [Fact]
        public void DrawBox_Rounded_CorrectCorners()
        {
            using var buf = CellBuffer.Create(20, 10);
            buf.DrawBox(0, 0, 10, 5, White, Black, BorderStyle.Rounded);
            Assert.Equal('╭', buf.GetCell(0, 0)!.Value.Codepoint);
            Assert.Equal('╯', buf.GetCell(9, 4)!.Value.Codepoint);
        }

        [Fact]
        public void DrawBox_Heavy_CorrectCorners()
        {
            using var buf = CellBuffer.Create(20, 10);
            buf.DrawBox(0, 0, 10, 5, White, Black, BorderStyle.Heavy);
            Assert.Equal('┏', buf.GetCell(0, 0)!.Value.Codepoint);
            Assert.Equal('┛', buf.GetCell(9, 4)!.Value.Codepoint);
        }

        [Fact]
        public void DrawBox_WithTitle_TitleAppearsInBuffer()
        {
            using var buf = CellBuffer.Create(20, 10);
            buf.DrawBox(0, 0, 15, 5, White, Black, title: "Hello");
            var text = Encoding.UTF8.GetString(buf.GetRealCharBytes(false));
            Assert.Contains("Hello", text);
        }

        // ── IDisposable ───────────────────────────────────────────────────────────

        [Fact]
        public void Dispose_ThrowsOnSubsequentAccess()
        {
            var buf = CellBuffer.Create(5, 5);
            buf.Dispose();
            Assert.Throws<System.ObjectDisposedException>(() => buf.GetCell(0, 0));
        }

        // ── grapheme pool churn (regression from Zig suite) ───────────────────────

        [Fact]
        public void GraphemeChurn_ManyFrames_DoesNotCrash()
        {
            using var parent = CellBuffer.Create(40, 5, "parent");
            using var child  = CellBuffer.Create(40, 5, "child", respectAlpha: true);

            for (int cycle = 0; cycle < 50; cycle++)
            {
                parent.Clear(Black);
                if (cycle % 2 == 0)
                    child.DrawText("╭────────────────────────────────────╮", 0, 0, White, Black);
                else
                    child.DrawText("  Your Name                              ", 0, 0, White, Black);
                parent.DrawFrameBuffer(0, 0, child);
                Assert.True(parent.GetRealCharBytes(true).Length > 0);
            }
        }

        // ── RuneWidth ─────────────────────────────────────────────────────────────

        [Theory]
        [InlineData('A',   1)]
        [InlineData('z',   1)]
        [InlineData('世',  2)]
        [InlineData('界',  2)]
        [InlineData('✨',  2)]
        public void RuneWidth_KnownValues(char ch, int expected)
        {
            Assert.Equal(expected, CellBuffer.RuneWidth(new System.Text.Rune(ch)));
        }
    }
}
