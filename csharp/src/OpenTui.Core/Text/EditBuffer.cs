using System;
using System.Collections.Generic;
using OpenTui.Core.Ansi;

namespace OpenTui.Core.Text
{
    /// <summary>Logical cursor position inside an <see cref="EditBuffer"/>.</summary>
    public sealed class LogicalCursor
    {
        public int Row    { get; set; }
        public int Col    { get; set; }
        public int Offset { get; set; }

        public LogicalCursor() { }
        public LogicalCursor(int row, int col, int offset) { Row = row; Col = col; Offset = offset; }

        public LogicalCursor Clone() => new LogicalCursor(Row, Col, Offset);
    }

    /// <summary>
    /// Rope-backed text editor with cursor tracking, undo/redo, insert/delete,
    /// line operations, and range queries. C# port of the Zig/TS <c>EditBuffer</c>.
    /// </summary>
    public sealed class EditBuffer : IDisposable
    {
        private static int _idSeq;

        public int Id { get; } = System.Threading.Interlocked.Increment(ref _idSeq);

        private Rope          _rope;
        private LogicalCursor _cursor = new();
        private bool          _disposed;

        private readonly Stack<(Rope Rope, LogicalCursor Cursor)> _undoStack = new();
        private readonly Stack<(Rope Rope, LogicalCursor Cursor)> _redoStack = new();

        public Rgba?          DefaultFg         { get; set; }
        public Rgba?          DefaultBg         { get; set; }
        public TextAttributes? DefaultAttributes { get; set; }

        /// <summary>Fired after every mutation with the new full text.</summary>
        public event EventHandler<string>? TextChanged;

        public EditBuffer() { _rope = new Rope(""); }

        public static EditBuffer Create() => new EditBuffer();

        // ── guard ─────────────────────────────────────────────────────────────────

        private void Guard()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(EditBuffer));
        }

        // ── undo / redo ───────────────────────────────────────────────────────────

        private void SaveUndo()
        {
            _undoStack.Push((_rope, _cursor.Clone()));
            _redoStack.Clear();
        }

        public bool   CanUndo() { Guard(); return _undoStack.Count > 0; }
        public bool   CanRedo() { Guard(); return _redoStack.Count > 0; }
        public void   ClearHistory() { Guard(); _undoStack.Clear(); _redoStack.Clear(); }

        public string? Undo()
        {
            Guard();
            if (_undoStack.Count == 0) return null;
            _redoStack.Push((_rope, _cursor.Clone()));
            (_rope, _cursor) = _undoStack.Pop();
            TextChanged?.Invoke(this, _rope.GetText());
            return "undo";
        }

        public string? Redo()
        {
            Guard();
            if (_redoStack.Count == 0) return null;
            _undoStack.Push((_rope, _cursor.Clone()));
            (_rope, _cursor) = _redoStack.Pop();
            TextChanged?.Invoke(this, _rope.GetText());
            return "redo";
        }

        // ── text access ───────────────────────────────────────────────────────────

        public void SetText(string text)
        {
            Guard();
            _rope   = new Rope(text);
            _cursor = new LogicalCursor();
            _undoStack.Clear();
            _redoStack.Clear();
            TextChanged?.Invoke(this, text);
        }

        public string GetText()  { Guard(); return _rope.GetText(); }

        public int GetLineCount()
        {
            Guard();
            return _rope.GetText().Split('\n').Length;
        }

        public string GetTextRange(int startOffset, int endOffset)
        {
            Guard();
            return _rope.GetRange(startOffset, endOffset);
        }

        public string GetTextRangeByCoords(int startRow, int startCol, int endRow, int endCol)
        {
            Guard();
            int s = PositionToOffset(startRow, startCol);
            int e = PositionToOffset(endRow,   endCol);
            return _rope.GetRange(s, e);
        }

        // ── position helpers ──────────────────────────────────────────────────────

        public int PositionToOffset(int row, int col)
        {
            var text  = _rope.GetText();
            var lines = text.Split('\n');
            int offset = 0;
            for (int i = 0; i < Math.Min(row, lines.Length - 1); i++)
                offset += lines[i].Length + 1; // +1 for \n
            offset += Math.Min(col, row < lines.Length ? lines[row].Length : 0);
            return offset;
        }

        public LogicalCursor? OffsetToPosition(int offset)
        {
            Guard();
            var text = _rope.GetText();
            if (offset < 0 || offset > text.Length) return null;
            int row = 0, col = 0;
            for (int i = 0; i < offset; i++)
            {
                if (text[i] == '\n') { row++; col = 0; }
                else col++;
            }
            return new LogicalCursor(row, col, offset);
        }

        public int GetLineStartOffset(int row)
        {
            Guard();
            return PositionToOffset(row, 0);
        }

        private void SyncRowCol()
        {
            var text   = _rope.GetText();
            int offset = Math.Clamp(_cursor.Offset, 0, text.Length);
            int row = 0, col = 0;
            for (int i = 0; i < offset && i < text.Length; i++)
            {
                if (text[i] == '\n') { row++; col = 0; }
                else col++;
            }
            _cursor.Row    = row;
            _cursor.Col    = col;
            _cursor.Offset = offset;
        }

        // ── cursor ────────────────────────────────────────────────────────────────

        public LogicalCursor GetCursorPosition() { Guard(); return _cursor; }

        public void SetCursor(int row, int col)
        {
            Guard();
            var lines = _rope.GetText().Split('\n');
            row = Math.Clamp(row, 0, lines.Length - 1);
            col = Math.Clamp(col, 0, lines[row].Length);
            _cursor = new LogicalCursor(row, col, PositionToOffset(row, col));
        }

        public void SetCursorByOffset(int offset)
        {
            Guard();
            _cursor.Offset = Math.Clamp(offset, 0, _rope.Length);
            SyncRowCol();
        }

        public void MoveCursorLeft()
        {
            Guard();
            if (_cursor.Offset == 0) return;
            _cursor.Offset--;
            SyncRowCol();
        }

        public void MoveCursorRight()
        {
            Guard();
            if (_cursor.Offset >= _rope.Length) return;
            _cursor.Offset++;
            SyncRowCol();
        }

        public void MoveCursorUp()
        {
            Guard();
            if (_cursor.Row == 0) return;
            var lines  = _rope.GetText().Split('\n');
            int newRow = _cursor.Row - 1;
            int newCol = Math.Min(_cursor.Col, lines[newRow].Length);
            SetCursor(newRow, newCol);
        }

        public void MoveCursorDown()
        {
            Guard();
            var lines = _rope.GetText().Split('\n');
            if (_cursor.Row >= lines.Length - 1) return;
            int newRow = _cursor.Row + 1;
            int newCol = Math.Min(_cursor.Col, lines[newRow].Length);
            SetCursor(newRow, newCol);
        }

        public void GotoLine(int line) { Guard(); SetCursor(line, 0); }

        public LogicalCursor GetEol()
        {
            Guard();
            var lines = _rope.GetText().Split('\n');
            int col   = _cursor.Row < lines.Length ? lines[_cursor.Row].Length : 0;
            return new LogicalCursor(_cursor.Row, col, PositionToOffset(_cursor.Row, col));
        }

        public LogicalCursor GetNextWordBoundary()
        {
            Guard();
            var text   = _rope.GetText();
            int offset = _cursor.Offset;
            while (offset < text.Length && char.IsWhiteSpace(text[offset])) offset++;
            while (offset < text.Length && !char.IsWhiteSpace(text[offset])) offset++;
            return OffsetToPosition(offset) ?? new LogicalCursor(0, 0, 0);
        }

        public LogicalCursor GetPrevWordBoundary()
        {
            Guard();
            var text   = _rope.GetText();
            int offset = _cursor.Offset;
            if (offset > 0) offset--;
            while (offset > 0 && char.IsWhiteSpace(text[offset])) offset--;
            while (offset > 0 && !char.IsWhiteSpace(text[offset - 1])) offset--;
            return OffsetToPosition(offset) ?? new LogicalCursor(0, 0, 0);
        }

        // ── mutations ─────────────────────────────────────────────────────────────

        public void InsertChar(string ch)
        {
            Guard();
            SaveUndo();
            _rope           = _rope.Insert(_cursor.Offset, ch);
            _cursor.Offset += ch.Length;
            SyncRowCol();
            TextChanged?.Invoke(this, _rope.GetText());
        }

        public void InsertText(string text)
        {
            Guard();
            SaveUndo();
            _rope           = _rope.Insert(_cursor.Offset, text);
            _cursor.Offset += text.Length;
            SyncRowCol();
            TextChanged?.Invoke(this, _rope.GetText());
        }

        public void DeleteChar()
        {
            Guard();
            if (_cursor.Offset >= _rope.Length) return;
            SaveUndo();
            _rope = _rope.Delete(_cursor.Offset, _cursor.Offset + 1);
            TextChanged?.Invoke(this, _rope.GetText());
        }

        public void DeleteCharBackward()
        {
            Guard();
            if (_cursor.Offset == 0) return;
            SaveUndo();
            _rope = _rope.Delete(_cursor.Offset - 1, _cursor.Offset);
            _cursor.Offset--;
            SyncRowCol();
            TextChanged?.Invoke(this, _rope.GetText());
        }

        public void DeleteRange(int startLine, int startCol, int endLine, int endCol)
        {
            Guard();
            int s = PositionToOffset(startLine, startCol);
            int e = PositionToOffset(endLine, endCol);
            if (s >= e) return;
            SaveUndo();
            _rope = _rope.Delete(s, e);
            if (_cursor.Offset > s)
                _cursor.Offset = Math.Max(s, _cursor.Offset - (e - s));
            SyncRowCol();
            TextChanged?.Invoke(this, _rope.GetText());
        }

        public void NewLine() => InsertChar("\n");

        public void DeleteLine()
        {
            Guard();
            var text  = _rope.GetText();
            var lines = text.Split('\n');
            if (lines.Length == 0) return;
            SaveUndo();
            int lineStart = PositionToOffset(_cursor.Row, 0);
            int lineEnd   = lineStart + lines[_cursor.Row].Length;
            if (lineEnd < text.Length) lineEnd++; // include \n
            _rope          = _rope.Delete(lineStart, lineEnd);
            _cursor.Offset = Math.Min(_cursor.Offset, _rope.Length);
            SyncRowCol();
            TextChanged?.Invoke(this, _rope.GetText());
        }

        public void Clear()
        {
            Guard();
            SaveUndo();
            _rope   = new Rope("");
            _cursor = new LogicalCursor();
            TextChanged?.Invoke(this, "");
        }

        public void Dispose() { _disposed = true; }
    }
}
