using System;
using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

namespace OpenTui.Samples
{
    internal static class ScrollSample
    {
        public static void Run()
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            const int viewW = 40, viewH = 10, totalLines = 30;

            using var view    = CellBuffer.Create(viewW, viewH,    "scroll-view");
            using var content = CellBuffer.Create(viewW, totalLines, "scroll-content");

            var bg     = Rgba.FromInts(10, 10, 30);
            var fg     = Rgba.FromInts(200, 220, 255);
            var accent = Rgba.FromInts(80,  200, 255);

            content.Clear(bg);
            for (int i = 0; i < totalLines; i++)
                content.DrawText($"  Line {i + 1,3}: {"".PadRight(24, '─')}", 0, i,
                                 i % 3 == 0 ? accent : fg, bg);

            // Show first viewH rows
            view.Clear(bg);
            view.DrawFrameBuffer(0, 0, content, srcHeight: viewH);

            Console.WriteLine("=== Scroll Sample (first 10 of 30 lines) ===");
            Console.WriteLine(System.Text.Encoding.UTF8.GetString(view.GetRealCharBytes(true)));
        }
    }
}
