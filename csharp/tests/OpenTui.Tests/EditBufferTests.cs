using Xunit;
using OpenTui.Core.Text;

namespace OpenTui.Tests
{
    public class EditBufferTests
    {
        // ── setText / getText ─────────────────────────────────────────────────────

        [Fact]
        public void SetText_GetText_Roundtrip()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello World");
            Assert.Equal("Hello World", buf.GetText());
        }

        [Fact]
        public void SetText_EmptyString()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("");
            Assert.Equal("", buf.GetText());
        }

        [Fact]
        public void SetText_WithNewlines()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Line 1\nLine 2\nLine 3");
            Assert.Equal("Line 1\nLine 2\nLine 3", buf.GetText());
        }

        [Fact]
        public void SetText_Unicode()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello 世界 🌟");
            Assert.Equal("Hello 世界 🌟", buf.GetText());
        }

        // ── cursor starts at beginning ────────────────────────────────────────────

        [Fact]
        public void CursorPosition_StartsAtZero()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello World");
            var c = buf.GetCursorPosition();
            Assert.Equal(0, c.Row);
            Assert.Equal(0, c.Col);
            Assert.Equal(0, c.Offset);
        }

        // ── cursor movement ───────────────────────────────────────────────────────

        [Fact]
        public void MoveCursorRight_IncrementsOffset()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.MoveCursorRight();
            Assert.Equal(1, buf.GetCursorPosition().Col);
            buf.MoveCursorRight();
            Assert.Equal(2, buf.GetCursorPosition().Col);
        }

        [Fact]
        public void MoveCursorLeft_AfterRight_Decrements()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.MoveCursorRight();
            buf.MoveCursorRight();
            buf.MoveCursorLeft();
            Assert.Equal(1, buf.GetCursorPosition().Col);
        }

        [Fact]
        public void MoveCursorLeft_AtStart_NoOp()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hi");
            buf.MoveCursorLeft(); // already at 0
            Assert.Equal(0, buf.GetCursorPosition().Offset);
        }

        [Fact]
        public void MoveCursorRight_AtEnd_NoOp()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hi");
            buf.SetCursor(0, 2);
            buf.MoveCursorRight();
            Assert.Equal(2, buf.GetCursorPosition().Offset);
        }

        [Fact]
        public void MoveCursorDown_ThenUp_Roundtrip()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Line 1\nLine 2\nLine 3");
            buf.MoveCursorDown();
            Assert.Equal(1, buf.GetCursorPosition().Row);
            buf.MoveCursorUp();
            Assert.Equal(0, buf.GetCursorPosition().Row);
        }

        [Fact]
        public void MoveCursorDown_AtLastLine_NoOp()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("single");
            buf.MoveCursorDown();
            Assert.Equal(0, buf.GetCursorPosition().Row);
        }

        // ── insert ────────────────────────────────────────────────────────────────

        [Fact]
        public void InsertChar_AppendsAtCursor()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 5);
            buf.InsertChar("!");
            Assert.Equal("Hello!", buf.GetText());
        }

        [Fact]
        public void InsertText_MultipleChars()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hi");
            buf.SetCursor(0, 2);
            buf.InsertText(" World");
            Assert.Equal("Hi World", buf.GetText());
        }

        [Fact]
        public void NewLine_InsertsNewline()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 5);
            buf.NewLine();
            Assert.Equal("Hello\n", buf.GetText());
        }

        // ── delete ────────────────────────────────────────────────────────────────

        [Fact]
        public void DeleteChar_RemovesAtCursor()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 0);
            buf.DeleteChar();
            Assert.Equal("ello", buf.GetText());
        }

        [Fact]
        public void DeleteCharBackward_RemovesBeforeCursor()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 5);
            buf.DeleteCharBackward();
            Assert.Equal("Hell", buf.GetText());
        }

        [Fact]
        public void DeleteRange_RemovesSpan()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello World");
            buf.DeleteRange(0, 5, 0, 11);
            Assert.Equal("Hello", buf.GetText());
        }

        [Fact]
        public void DeleteLine_RemovesCurrentLine()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Line 1\nLine 2\nLine 3");
            buf.SetCursor(1, 0);
            buf.DeleteLine();
            Assert.DoesNotContain("Line 2", buf.GetText());
        }

        [Fact]
        public void Clear_EmptiesBuffer()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.Clear();
            Assert.Equal("", buf.GetText());
        }

        // ── undo / redo ───────────────────────────────────────────────────────────

        [Fact]
        public void Undo_RevertsMutation()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 5);
            buf.InsertChar("!");
            Assert.Equal("Hello!", buf.GetText());
            buf.Undo();
            Assert.Equal("Hello", buf.GetText());
        }

        [Fact]
        public void Redo_ReappliesUndone()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 5);
            buf.InsertChar("!");
            buf.Undo();
            buf.Redo();
            Assert.Equal("Hello!", buf.GetText());
        }

        [Fact]
        public void CanUndo_FalseAfterClearHistory()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello");
            buf.SetCursor(0, 5);
            buf.InsertChar("!");
            buf.ClearHistory();
            Assert.False(buf.CanUndo());
        }

        [Fact]
        public void CanRedo_FalseInitially()
        {
            using var buf = EditBuffer.Create();
            Assert.False(buf.CanRedo());
        }

        [Fact]
        public void Undo_ReturnsLabel()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("A");
            buf.SetCursor(0, 1);
            buf.InsertChar("B");
            Assert.NotNull(buf.Undo());
        }

        // ── line count / position helpers ─────────────────────────────────────────

        [Fact]
        public void GetLineCount_SingleLine()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello World");
            Assert.Equal(1, buf.GetLineCount());
        }

        [Fact]
        public void GetLineCount_MultipleLines()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Line 1\nLine 2\nLine 3");
            Assert.Equal(3, buf.GetLineCount());
        }

        [Fact]
        public void PositionToOffset_FirstChar()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello\nWorld");
            Assert.Equal(0, buf.PositionToOffset(0, 0));
        }

        [Fact]
        public void PositionToOffset_SecondLine()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello\nWorld");
            Assert.Equal(6, buf.PositionToOffset(1, 0)); // "Hello\n" = 6
        }

        [Fact]
        public void OffsetToPosition_Roundtrip()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello\nWorld");
            var pos = buf.OffsetToPosition(7);
            Assert.NotNull(pos);
            Assert.Equal(1, pos!.Row);
            Assert.Equal(1, pos.Col);
        }

        [Fact]
        public void GetEol_ReturnsEndOfCurrentLine()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("Hello\nWorld");
            buf.SetCursor(0, 0);
            var eol = buf.GetEol();
            Assert.Equal(5, eol.Col); // "Hello".Length == 5
        }

        [Fact]
        public void TextChanged_FiredOnInsert()
        {
            using var buf = EditBuffer.Create();
            buf.SetText("A");
            string? captured = null;
            buf.TextChanged += (_, t) => captured = t;
            buf.SetCursor(0, 1);
            buf.InsertChar("B");
            Assert.Equal("AB", captured);
        }

        // ── dispose ───────────────────────────────────────────────────────────────

        [Fact]
        public void Dispose_ThrowsOnAccess()
        {
            var buf = EditBuffer.Create();
            buf.Dispose();
            Assert.Throws<System.ObjectDisposedException>(() => buf.GetText());
        }
    }
}
