using System;

Console.OutputEncoding = System.Text.Encoding.UTF8;

var sample = args.Length > 0 ? args[0].ToLowerInvariant() : "layout";

switch (sample)
{
    case "layout":
        OpenTui.Samples.SimpleLayoutSample.Run();
        break;
    case "styled":
        OpenTui.Samples.StyledTextSample.Run();
        break;
    case "editor":
        OpenTui.Samples.EditorSample.Run();
        break;
    case "scroll":
        OpenTui.Samples.ScrollSample.Run();
        break;
    case "input":
        OpenTui.Samples.InputSample.Run();
        break;
    case "keypress":
        OpenTui.Samples.KeypressDebugSample.Run();
        break;
    case "ascii":
        OpenTui.Samples.AsciFontSample.Run();
        break;
    case "framebuffer":
        OpenTui.Samples.FrameBufferSample.Run();
        break;
    case "code":
        OpenTui.Samples.CodeSample.Run();
        break;
    case "markdown":
        OpenTui.Samples.MarkdownSample.Run();
        break;
    case "diff":
        OpenTui.Samples.DiffSample.Run();
        break;
    case "select":
        OpenTui.Samples.SelectSample.Run();
        break;
    case "slider":
        OpenTui.Samples.SliderSample.Run();
        break;
    case "tabs":
        OpenTui.Samples.TabSelectSample.Run();
        break;
    case "console":
        OpenTui.Samples.ConsoleDemoSample.Run();
        break;
    default:
        Console.WriteLine($"Unknown sample: '{sample}'");
        Console.WriteLine("Available samples: layout, styled, editor, scroll, input, keypress, ascii, framebuffer, code, markdown, diff, select, slider, tabs, console");
        Environment.Exit(1);
        break;
}
