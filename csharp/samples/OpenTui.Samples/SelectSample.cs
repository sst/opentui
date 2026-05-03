using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class SelectSample
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
            Title = " Select Component ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var hint = new TextRenderable(renderer, new TextOptions
        {
            Content = "Use ↑↓ to navigate, Enter to select, q to quit",
            Fg = "#888888"
        });
        box.Add(hint);

        var select = new SelectRenderable(renderer)
        {
            Options = Enumerable.Range(1, 20).Select(i => new SelectOption
            {
                Name = $"Option {i}",
                Description = $"Description for option {i}",
                Value = i
            }).ToList(),
            SelectedBg = "#0055aa",
            Fg = "#ffffff"
        };
        select.SetWidth("100%");
        select.FlexGrow = 1;
        box.Add(select);

        var status = new TextRenderable(renderer, new TextOptions
        {
            Content = "Nothing selected yet",
            Fg = "#ffaa00"
        });
        box.Add(status);

        select.On("itemSelected", (object? data) =>
        {
            if (data is SelectOption opt)
            {
                status.Content = $"Selected: {opt.Name} (value={opt.Value})";
                renderer.RequestRender();
            }
        });

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "q" || key.Name == "escape") renderer.Destroy();
        });

        select.Focus();
        renderer.Start();
    }
}
