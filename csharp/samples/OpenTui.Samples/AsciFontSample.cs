using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class AsciFontSample
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
            BorderColor = "#ff8800",
            Title = " ASCII Font Demo ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var font1 = new ASCIIFontRenderable(renderer)
        {
            Text = "HELLO",
            Color = "#00aaff"
        };
        box.Add(font1);

        var font2 = new ASCIIFontRenderable(renderer)
        {
            Text = "WORLD",
            Color = "#ff4488"
        };
        box.Add(font2);

        var hint = new TextRenderable(renderer, new TextOptions
        {
            Content = "\nPress q or Escape to quit",
            Fg = "#888888"
        });
        box.Add(hint);

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "q" || key.Name == "escape") renderer.Destroy();
        });

        renderer.Start();
    }
}
