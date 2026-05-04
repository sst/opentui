using OpenTui.Core.Ansi;
using OpenTui.Core.Rendering;

namespace OpenTui.Core.Renderables;

public class FrameBufferRenderable : Renderable
{
    public int BufferWidth { get; }
    public int BufferHeight { get; }

    private readonly Rgba[] _pixels;

    public FrameBufferRenderable(CliRenderer? renderer, int pixelWidth, int pixelHeight) : base(renderer)
    {
        BufferWidth = pixelWidth;
        BufferHeight = pixelHeight;
        _pixels = new Rgba[pixelWidth * pixelHeight];
        Clear(Rgba.FromInts(0, 0, 0));
    }

    public void SetPixel(int x, int y, Rgba color)
    {
        if (x < 0 || x >= BufferWidth || y < 0 || y >= BufferHeight) return;
        _pixels[y * BufferWidth + x] = color;
    }

    public void Clear(Rgba color)
    {
        for (int i = 0; i < _pixels.Length; i++) _pixels[i] = color;
    }

    public void DrawLine(int x1, int y1, int x2, int y2, Rgba color)
    {
        int dx = Math.Abs(x2 - x1), dy = Math.Abs(y2 - y1);
        int sx = x1 < x2 ? 1 : -1;
        int sy = y1 < y2 ? 1 : -1;
        int err = dx - dy;

        while (true)
        {
            SetPixel(x1, y1, color);
            if (x1 == x2 && y1 == y2) break;
            int e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x1 += sx; }
            if (e2 < dx) { err += dx; y1 += sy; }
        }
    }

    public void FillRect(int px, int py, int pw, int ph, Rgba color)
    {
        for (int y = py; y < py + ph; y++)
            for (int x = px; x < px + pw; x++)
                SetPixel(x, y, color);
    }

    public void DrawCircle(int cx, int cy, int r, Rgba color)
    {
        for (float angle = 0; angle < 2 * MathF.PI; angle += 0.01f)
        {
            int px = (int)(cx + r * MathF.Cos(angle));
            int py = (int)(cy + r * MathF.Sin(angle));
            SetPixel(px, py, color);
        }
    }

    protected override void RenderSelf(RenderBuffer buffer, double deltaTime)
    {
        int sx = ScreenX, sy = ScreenY, w = ComputedWidth, h = ComputedHeight;

        // Each cell is 2 pixel rows (top=fg with ▀, bottom=bg)
        for (int cy = 0; cy < h; cy++)
        {
            for (int cx = 0; cx < w; cx++)
            {
                int px = cx;
                int py1 = cy * 2;
                int py2 = cy * 2 + 1;

                if (px >= BufferWidth) continue;

                var topColor = py1 < BufferHeight ? _pixels[py1 * BufferWidth + px] : Rgba.FromInts(0, 0, 0);
                var botColor = py2 < BufferHeight ? _pixels[py2 * BufferWidth + px] : Rgba.FromInts(0, 0, 0);

                buffer.SetCell(sx + cx, sy + cy, '▀', topColor, botColor);
            }
        }
    }
}
