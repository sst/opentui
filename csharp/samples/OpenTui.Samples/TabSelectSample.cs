using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class TabSelectSample
{
    public static void Run()
    {
        var config = new CliRendererConfig { ExitOnCtrlC = true, TargetFps = 30 };
        var renderer = new CliRenderer(config);

        var root = renderer.Root;

        var outerBox = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "rounded",
            BorderColor = "#00ffaa",
            Title = " Tab Select ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        outerBox.SetWidth("100%");
        outerBox.SetHeight("100%");
        root.Add(outerBox);

        var tabs = new TabSelectRenderable(renderer)
        {
            Tabs = new List<string> { "Home", "Settings", "About", "Help" },
            ActiveFg = "#000000",
            ActiveBg = "#00aaff",
            InactiveFg = "#888888",
            InactiveBg = "#333333"
        };
        tabs.SetWidth("100%");
        outerBox.Add(tabs);

        var content = new TextRenderable(renderer, new TextOptions
        {
            Content = "Home content - Welcome to OpenTUI!",
            Fg = "#ffffff",
            FlexGrow = 1
        });
        content.SetWidth("100%");
        outerBox.Add(content);

        var hint = new TextRenderable(renderer, new TextOptions
        {
            Content = "←→ to switch tabs, q to quit",
            Fg = "#888888"
        });
        outerBox.Add(hint);

        var tabContents = new[] {
            "Home content - Welcome to OpenTUI!",
            "Settings - Configure your terminal experience",
            "About - OpenTUI v1.0 for .NET 9",
            "Help - Press ←→ to navigate tabs"
        };

        tabs.On("tabChanged", (object? data) =>
        {
            if (data is int idx && idx < tabContents.Length)
            {
                content.Content = tabContents[idx];
                renderer.RequestRender();
            }
        });

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "q" || key.Name == "escape") renderer.Destroy();
        });

        tabs.Focus();
        renderer.Start();
    }
}
