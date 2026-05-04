using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class CodeSample
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
            BorderColor = "#569cd6",
            Title = " Syntax Highlighted Code ",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            FlexGrow = 1
        });
        box.SetWidth("100%");
        box.SetHeight("100%");
        root.Add(box);

        var code = new CodeRenderable(renderer)
        {
            Content = """
using System;
using System.Collections.Generic;

namespace OpenTui.Core.Layout;

public class FlexNode
{
    public FlexDirection FlexDirection { get; set; } = FlexDirection.Row;
    public float FlexGrow { get; set; } = 0f;
    public List<FlexNode> Children { get; } = new();

    public void AddChild(FlexNode child) => Children.Add(child);
}

// Main entry point
var node = new FlexNode { FlexGrow = 1.0f };
Console.WriteLine($"Node has {node.Children.Count} children");
""",
            Language = "csharp",
            ShowLineNumbers = true
        };
        code.SetWidth("100%");
        code.FlexGrow = 1;
        box.Add(code);

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
