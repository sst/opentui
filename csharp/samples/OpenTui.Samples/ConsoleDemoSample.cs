using OpenTui.Core.Console;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class ConsoleDemoSample
{
    public static void Run()
    {
        var config = new CliRendererConfig { ExitOnCtrlC = true, TargetFps = 30 };
        var renderer = new CliRenderer(config);

        var root = renderer.Root;

        var overlay = new ConsoleOverlay(renderer);
        root.Add(overlay);

        var box = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "double",
            BorderColor = "#ff8800",
            Title = " Console Overlay Demo ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var text = new TextRenderable(renderer, new TextOptions
        {
            Content = "Press L to log a message, E for error, W for warning\nPress C to clear, q to quit",
            Fg = "#aaaaaa",
            FlexGrow = 1
        });
        box.Add(text);

        int counter = 0;
        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            switch (key.Name)
            {
                case "q":
                case "escape":
                    renderer.Destroy();
                    break;
                case "l":
                    overlay.Log($"Message #{++counter} logged at {DateTime.Now:HH:mm:ss}");
                    renderer.RequestRender();
                    break;
                case "e":
                    overlay.Error($"Error #{++counter} at {DateTime.Now:HH:mm:ss}");
                    renderer.RequestRender();
                    break;
                case "w":
                    overlay.Warn($"Warning #{++counter} at {DateTime.Now:HH:mm:ss}");
                    renderer.RequestRender();
                    break;
                case "c":
                    overlay.Clear();
                    renderer.RequestRender();
                    break;
            }
        });

        renderer.Start();
    }
}
