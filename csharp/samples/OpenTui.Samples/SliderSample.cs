using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class SliderSample
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
            BorderColor = "#aa00ff",
            Title = " Sliders ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var label1 = new TextRenderable(renderer, new TextOptions { Content = "Volume:", Fg = "#ffffff" });
        box.Add(label1);

        var slider1 = new SliderRenderable(renderer)
        {
            Min = 0, Max = 100, Value = 50, Step = 5,
            TrackColor = "#555555",
            ThumbColor = "#00aaff"
        };
        slider1.SetWidth("80%");
        box.Add(slider1);

        var label2 = new TextRenderable(renderer, new TextOptions { Content = "Brightness:", Fg = "#ffffff" });
        box.Add(label2);

        var slider2 = new SliderRenderable(renderer)
        {
            Min = 0, Max = 255, Value = 128, Step = 1,
            TrackColor = "#555555",
            ThumbColor = "#ffaa00"
        };
        slider2.SetWidth("80%");
        box.Add(slider2);

        var valueText = new TextRenderable(renderer, new TextOptions
        {
            Content = $"Volume: {slider1.Value}  Brightness: {slider2.Value}",
            Fg = "#aaffaa"
        });
        box.Add(valueText);

        var hint = new TextRenderable(renderer, new TextOptions
        {
            Content = "Tab to switch sliders, ←→ to change value, q to quit",
            Fg = "#888888"
        });
        box.Add(hint);

        int focusedSlider = 0;
        slider1.Focus();

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "q" || key.Name == "escape") { renderer.Destroy(); return; }
            if (key.Name == "tab")
            {
                focusedSlider = 1 - focusedSlider;
                if (focusedSlider == 0) { slider1.Focus(); slider2.Blur(); }
                else { slider2.Focus(); slider1.Blur(); }
                renderer.RequestRender();
                return;
            }
            if (focusedSlider == 0) slider1.HandleKey(key);
            else slider2.HandleKey(key);
            valueText.Content = $"Volume: {slider1.Value}  Brightness: {slider2.Value}";
            renderer.RequestRender();
        });

        renderer.Start();
    }
}
