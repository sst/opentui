using System;
using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

namespace OpenTui.Samples
{
    internal static class StyledTextSample
    {
        public static void Run()
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            var bg = Rgba.FromInts(0, 0, 0);

            using var buf = CellBuffer.Create(60, 12, "styled");
            buf.Clear(bg);
            buf.DrawBox(0, 0, 60, 12, Rgba.FromInts(100, 100, 255), bg, BorderStyle.Double,
                        BorderSides.All, fill: true, title: " Styled Text Demo ");

            buf.DrawText("Normal text",              3, 2, Rgba.FromInts(255, 255, 255), bg);
            buf.DrawText("Bold text",                3, 3, Rgba.FromInts(255, 255, 100), bg, TextAttributes.Bold);
            buf.DrawText("Italic text",              3, 4, Rgba.FromInts(100, 255, 100), bg, TextAttributes.Italic);
            buf.DrawText("Underline text",           3, 5, Rgba.FromInts(255, 100, 100), bg, TextAttributes.Underline);
            buf.DrawText("Bold + Italic",            3, 6, Rgba.FromInts(255, 200,   0), bg, TextAttributes.Bold | TextAttributes.Italic);
            buf.DrawText("Strikethrough",            3, 7, Rgba.FromInts(200, 200, 200), bg, TextAttributes.Strikethrough);
            buf.DrawText("Emoji: 🎨 🚀 ✨ 🌟",      3, 8, Rgba.FromInts(  0, 255, 200), bg);
            buf.DrawText("CJK: 世界 한국 日本語",    3, 9, Rgba.FromInts(255, 200, 100), bg);

            SimpleLayoutSample.PrintBuffer(buf);
            Console.Write(AnsiCodes.Reset);
        }
    }
}
