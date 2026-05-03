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
    default:
        Console.WriteLine($"Unknown sample: '{sample}'");
        Console.WriteLine("Available samples: layout, styled, editor, scroll, input");
        Environment.Exit(1);
        break;
}
