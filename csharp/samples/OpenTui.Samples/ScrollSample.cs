using OpenTui.Core.Input;
using OpenTui.Core.Layout;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class ScrollSample
{
    private static int _nextIndex = 100;

    public static void Run()
    {
        var renderer = new CliRenderer(new CliRendererConfig
        {
            ExitOnCtrlC = true,
            TargetFps = 60,
            BackgroundColor = "#1a1b26"
        });

        var main = new BoxRenderable(renderer, new BoxOptions
        {
            BackgroundColor = "#1a1b26",
            FlexDirection = FlexDirection.Column,
            FlexGrow = 1
        });
        main.SetWidth("100%");
        main.SetHeight("100%");
        renderer.Root.Add(main);

        var scrollBox = new ScrollBoxRenderable(renderer)
        {
            BackgroundColor = "#16161e",
            Border = true,
            BorderColor = "#7aa2f7",
            TrackColor = "#414868",
            ThumbColor = "#7aa2f7",
            ShowVerticalScrollbar = true,
            ShowHorizontalScrollbar = true,
            FlexGrow = 1,
            ContentWidth = 180
        };
        scrollBox.SetWidth("100%");
        main.Add(scrollBox);

        var instructions = new BoxRenderable(renderer, new BoxOptions
        {
            BackgroundColor = "#2a2b3a",
            FlexDirection = FlexDirection.Column,
            PaddingLeft = 1,
            PaddingRight = 1,
            PaddingTop = 0,
            PaddingBottom = 0
        });
        instructions.FlexShrink = 0;
        instructions.SetWidth("100%");
        instructions.SetHeight(2);
        main.Add(instructions);

        var controls = new TextRenderable(renderer, new TextOptions
        {
            Content = "Controls: Up/Down/PgUp/PgDn/Home/End | H horizontal scrollbar | V vertical scrollbar | N add child | ESC exit",
            Fg = "#c0caf5",
            Bg = "#2a2b3a",
            Height = 1
        });
        controls.SetWidth("100%");
        instructions.Add(controls);

        var status = new TextRenderable(renderer, new TextOptions
        {
            Content = "",
            Fg = "#7dcfff",
            Bg = "#2a2b3a",
            Height = 1
        });
        status.SetWidth("100%");
        instructions.Add(status);

        var contentHeight = 0;

        void AddBanner(int i)
        {
            var banner = new ASCIIFontRenderable(renderer)
            {
                Text = $"SCROLL DEMO {i}",
                Color = i % 2 == 0 ? "#9ece6a" : "#f7768e",
                ZIndex = 2
            };
            banner.SetWidth(160);
            banner.SetHeight(4);
            banner.MarginBottom = 1;
            scrollBox.Add(banner);
            contentHeight += 5;
        }

        void AddBox(int i)
        {
            var box = new BoxRenderable(renderer, new BoxOptions
            {
                BackgroundColor = i % 2 == 0 ? "#292e42" : "#2f3449",
                FlexDirection = FlexDirection.Column,
                PaddingTop = 1,
                PaddingRight = 1,
                PaddingBottom = 1,
                PaddingLeft = 1
            });
            box.SetWidth(170);
            box.SetHeight(8);
            box.MarginBottom = 1;

            var text = new TextRenderable(renderer, new TextOptions
            {
                Content = MakeMultilineContent(i),
                Fg = Palette(i),
                Bg = box.BackgroundColor,
                Height = 6,
                Wrap = false
            });
            text.SetWidth(168);
            box.Add(text);

            scrollBox.Add(box);
            contentHeight += 9;
        }

        void UpdateStatus()
        {
            scrollBox.ContentHeight = contentHeight;
            status.Content = $"Scroll X:{scrollBox.ScrollX} Y:{scrollBox.ScrollY} | Children:{_nextIndex} | V:{OnOff(scrollBox.ShowVerticalScrollbar)} H:{OnOff(scrollBox.ShowHorizontalScrollbar)}";
            renderer.RequestRender();
        }

        AddBanner(1);
        for (int i = 1; i < _nextIndex; i++)
        {
            if ((i + 1) % 25 == 0)
                AddBanner(i + 1);
            else
                AddBox(i);
        }

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "escape")
            {
                key.PreventDefault();
                renderer.Destroy();
                return;
            }

            if (key.Name == "v")
            {
                key.PreventDefault();
                scrollBox.ShowVerticalScrollbar = !scrollBox.ShowVerticalScrollbar;
                UpdateStatus();
                return;
            }

            if (key.Name == "h")
            {
                key.PreventDefault();
                scrollBox.ShowHorizontalScrollbar = !scrollBox.ShowHorizontalScrollbar;
                UpdateStatus();
                return;
            }

            if (key.Name == "n")
            {
                key.PreventDefault();
                AddBox(_nextIndex++);
                UpdateStatus();
                return;
            }

            ThreadPool.QueueUserWorkItem(_ => UpdateStatus());
        });

        scrollBox.Focus();
        UpdateStatus();
        renderer.Start();
    }

    private static string MakeMultilineContent(int i)
    {
        var id = (i + 1).ToString().PadLeft(4, '0');
        var tag = i % 3 == 0 ? "INFO " : i % 3 == 1 ? "WARN " : "ERROR";
        var barUnits = 10 + (i % 30);
        var filled = (int)(barUnits * 0.6);
        var bar = new string('█', filled).PadRight(barUnits, '░');
        var details = string.Join(' ', Enumerable.Repeat("data", (i % 4) + 2));
        var longTail = "The quick brown fox jumps over the lazy dog while terminal scrolling keeps the content clipped and responsive.";

        return $"""
[{id}] Box {i + 1} | {tag}
Multiline content with mixed lengths for stress testing.
* Title: Lorem ipsum {i}
* Detail A: {details}
* Progress: {bar} {barUnits}
* Long: {longTail}
""";
    }

    private static string Palette(int i) => (i % 6) switch
    {
        0 => "#7aa2f7",
        1 => "#9ece6a",
        2 => "#f7768e",
        3 => "#7dcfff",
        4 => "#bb9af7",
        _ => "#e0af68"
    };

    private static string OnOff(bool value) => value ? "ON" : "OFF";
}
