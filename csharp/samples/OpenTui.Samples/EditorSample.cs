using System;
using OpenTui.Core.Text;

namespace OpenTui.Samples
{
    internal static class EditorSample
    {
        public static void Run()
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.WriteLine("=== EditBuffer Demo ===\n");

            using var buf = EditBuffer.Create();
            buf.SetText("Hello, World!\nThis is line 2.\nAnd line 3.");

            Console.WriteLine($"Initial text:\n{buf.GetText()}\n");
            Console.WriteLine($"Line count: {buf.GetLineCount()}");

            buf.SetCursor(0, 7);
            buf.InsertText("beautiful ");
            Console.WriteLine($"\nAfter insert 'beautiful ': {buf.GetText()}");

            buf.Undo();
            Console.WriteLine($"After undo: {buf.GetText()}");

            buf.Redo();
            Console.WriteLine($"After redo: {buf.GetText()}");

            buf.MoveCursorDown();
            var pos = buf.GetCursorPosition();
            Console.WriteLine($"\nCursor at row={pos.Row}, col={pos.Col}, offset={pos.Offset}");

            var eol = buf.GetEol();
            Console.WriteLine($"End of current line at col={eol.Col}");

            Console.WriteLine("\nEditorSample done.");
        }
    }
}
