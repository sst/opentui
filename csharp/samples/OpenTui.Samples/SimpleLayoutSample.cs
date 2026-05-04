using System;
using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

namespace OpenTui.Samples
{
    internal static class SimpleLayoutSample
    {
        public static void Run()
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            const int W = 60, H = 20;
            var bg     = Rgba.FromInts(0, 0, 0);
            var fg     = Rgba.FromInts(255, 255, 255);
            var accent = Rgba.FromInts(0, 200, 255);

            using var buf = CellBuffer.Create(W, H, "simple-layout");
            buf.Clear(bg);

            buf.DrawBox(0, 0, W, H, accent, bg, BorderStyle.Rounded, BorderSides.All,
                        fill: true, title: " OpenTUI C# ");

            buf.DrawText("Hello from OpenTUI C#!", 4, 3, fg, bg);
            buf.DrawText("A terminal UI library ported from TypeScript/Zig", 4, 4, accent, bg);

            buf.DrawBox(4, 6, 30, 8, Rgba.FromInts(255, 200, 0), bg, BorderStyle.Single,
                        BorderSides.All, title: "Stats");
            buf.DrawText($"Width  : {W}",         6, 8, fg, bg);
            buf.DrawText($"Height : {H}",         6, 9, fg, bg);
            buf.DrawText("Runtime: .NET 9",       6, 10, fg, bg);

            PrintBuffer(buf);
        }

        internal static void PrintBuffer(CellBuffer buf)
        {
            var curFg = Rgba.FromInts(255, 255, 255);
            var curBg = Rgba.FromInts(0,   0,   0);

            for (int y = 0; y < buf.Height; y++)
            {
                for (int x = 0; x < buf.Width; x++)
                {
                    var cell = buf.GetCell(x, y);
                    if (cell == null) { Console.Write(' '); continue; }
                    var c = cell.Value;

                    if (c.Fg != curFg)
                    {
                        Console.Write(AnsiCodes.FgColor(c.Fg.RedByte, c.Fg.GreenByte, c.Fg.BlueByte));
                        curFg = c.Fg;
                    }
                    if (c.Bg != curBg)
                    {
                        Console.Write(AnsiCodes.BgColor(c.Bg.RedByte, c.Bg.GreenByte, c.Bg.BlueByte));
                        curBg = c.Bg;
                    }

                    Console.Write(c.Codepoint == 0 ? ' ' : char.ConvertFromUtf32(c.Codepoint));
                }
                Console.WriteLine(AnsiCodes.Reset);
            }
        }
    }
}
