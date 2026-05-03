using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class FrameBufferSample
{
    public static void Run()
    {
        var config = new CliRendererConfig { ExitOnCtrlC = true, TargetFps = 30 };
        var renderer = new CliRenderer(config);

        var root = renderer.Root;

        var box = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "single",
            BorderColor = "#888888",
            Title = " FrameBuffer Demo ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var fb = new FrameBufferRenderable(renderer, 120, 40);
        fb.SetWidth("100%");
        fb.SetHeight(20);
        box.Add(fb);

        float time = 0;

        renderer.Resize += (_, args) => { };

        // Animate
        var timer = new System.Threading.Timer(_ =>
        {
            time += 0.05f;
            fb.Clear(Rgba.FromInts(0, 0, 20));

            // Draw animated circle
            int cx = (int)(60 + 40 * MathF.Cos(time));
            int cy = (int)(20 + 15 * MathF.Sin(time));
            fb.DrawCircle(cx, cy, 8, Rgba.FromCss("#00aaff"));
            fb.DrawCircle(60, 20, 15, Rgba.FromCss("#ff4488"));
            fb.DrawLine(0, 0, 120, 40, Rgba.FromCss("#88ff00"));

            renderer.RequestRender();
        }, null, 0, 50);

        var hint = new TextRenderable(renderer, new TextOptions
        {
            Content = "Press q or Escape to quit",
            Fg = "#888888"
        });
        box.Add(hint);

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "q" || key.Name == "escape") { timer.Dispose(); renderer.Destroy(); }
        });

        renderer.Start();
        timer.Dispose();
    }
}
