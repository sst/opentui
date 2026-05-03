using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class KeypressDebugSample
{
    public static void Run()
    {
        var config = new CliRendererConfig { ExitOnCtrlC = true, TargetFps = 30 };
        var renderer = new CliRenderer(config);

        var root = renderer.Root;

        var box = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "rounded",
            BorderColor = "#00aaff",
            Title = " Key Debug ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var text = new TextRenderable(renderer, new TextOptions
        {
            Content = "Press any key... (q or Escape to quit)",
            Fg = "#aaaaaa"
        });
        box.Add(text);

        var lastKey = new TextRenderable(renderer, new TextOptions
        {
            Content = "",
            Fg = "#00ff88"
        });
        box.Add(lastKey);

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "q" || key.Name == "escape") { renderer.Destroy(); return; }
            lastKey.Content = $"Name: {key.Name}  Key: {key.Key}  Ctrl: {key.Ctrl}  Alt: {key.Alt}  Char: {key.Char}";
            renderer.RequestRender();
        });

        renderer.Start();
    }
}
