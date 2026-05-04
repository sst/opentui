using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class DiffSample
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
            Title = " Diff Viewer ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var diff = new DiffRenderable(renderer)
        {
            OldText = """
using System;

namespace MyApp
{
    class Program
    {
        static void Main()
        {
            Console.WriteLine("Hello World");
        }
    }
}
""",
            NewText = """
using System;
using System.Collections.Generic;

namespace MyApp
{
    class Program
    {
        static void Main(string[] args)
        {
            var message = "Hello OpenTUI!";
            Console.WriteLine(message);
            Console.WriteLine($"Args: {args.Length}");
        }
    }
}
""",
            ShowLineNumbers = true
        };
        diff.SetWidth("100%");
        diff.FlexGrow = 1;
        box.Add(diff);

        var hint = new TextRenderable(renderer, new TextOptions
        {
            Content = "Press q or Escape to quit",
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
