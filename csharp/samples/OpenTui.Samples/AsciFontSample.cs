using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class AsciFontSample
{
    public static void Run()
    {
        var renderer = new CliRenderer(new CliRendererConfig
        {
            ExitOnCtrlC = true,
            TargetFps = 30,
            BackgroundColor = "#0d1117"
        });

        var allFonts = new List<ASCIIFontRenderable>();
        ASCIIFontRenderable? activeFont = null;
        int selectionStart = 0;
        var dragging = false;

        var main = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "single",
            BorderColor = "#50565d",
            BackgroundColor = "#161b22",
            Title = " ASCII Font Selection Demo ",
            TitleAlignment = "center"
        });
        main.Position = "absolute";
        main.Left = 1;
        main.Top = 1;
        main.SetWidth(95);
        main.SetHeight(30);
        renderer.Root.Add(main);

        var fontGroup = new BoxRenderable(renderer, new BoxOptions
        {
            BackgroundColor = "#161b22",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column
        });
        fontGroup.Position = "absolute";
        fontGroup.Left = 2;
        fontGroup.Top = 2;
        fontGroup.SetWidth(90);
        fontGroup.SetHeight(22);
        main.Add(fontGroup);

        AddFont(fontGroup, allFonts, renderer, "TINY FONT DEMO", "tiny", "#ffff00");
        AddFont(fontGroup, allFonts, renderer, "OPENTUI", "block", "#64ff64");
        AddFont(fontGroup, allFonts, renderer, "SHADE", "shade", "#ffc864");
        AddFont(fontGroup, allFonts, renderer, "SLICK", "slick", "#64ff64");

        var instructions = new TextRenderable(renderer, new TextOptions
        {
            Content = "Click and drag over an ASCII font row to select text. Press C to clear selection. Esc exits.",
            Fg = "#f0f6fc",
            Bg = "#161b22",
            Height = 1
        });
        instructions.Position = "absolute";
        instructions.Left = 2;
        instructions.Top = 26;
        instructions.SetWidth(88);
        main.Add(instructions);

        var statusBox = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "single",
            BorderColor = "#50565d",
            BackgroundColor = "#0d1117",
            Title = " Selection Status ",
            TitleAlignment = "left",
            FlexDirection = OpenTui.Core.Layout.FlexDirection.Column,
            PaddingTop = 1,
            PaddingLeft = 2,
            PaddingRight = 2
        });
        statusBox.Position = "absolute";
        statusBox.Left = 1;
        statusBox.Top = 32;
        statusBox.SetWidth(95);
        statusBox.SetHeight(10);
        renderer.Root.Add(statusBox);

        var statusText = new TextRenderable(renderer, new TextOptions
        {
            Content = "No selection - try selecting across an ASCII font",
            Fg = "#f0f6fc",
            Bg = "#0d1117",
            Height = 1
        });
        statusText.SetWidth("100%");
        statusBox.Add(statusText);

        var selectionStartText = StatusLine(renderer, "#7dd3fc");
        var selectionMiddleText = StatusLine(renderer, "#94a3b8");
        var selectionEndText = StatusLine(renderer, "#7dd3fc");
        var debugText = StatusLine(renderer, "#e6edf3");
        statusBox.Add(selectionStartText);
        statusBox.Add(selectionMiddleText);
        statusBox.Add(selectionEndText);
        statusBox.Add(debugText);

        void ClearSelection()
        {
            foreach (var font in allFonts)
                font.ClearSelection();
            activeFont = null;
            dragging = false;
            statusText.Content = "Selection cleared";
            selectionStartText.Content = "";
            selectionMiddleText.Content = "";
            selectionEndText.Content = "";
            debugText.Content = "";
            renderer.RequestRender();
        }

        void UpdateStatus()
        {
            var selectedText = activeFont?.GetSelectedText() ?? "";
            var selectedCount = allFonts.Count(f => f.HasSelection());
            debugText.Content = $"Selected fonts: {selectedCount}/{allFonts.Count} | Active: {(activeFont?.Text ?? "none")}";

            if (string.IsNullOrEmpty(selectedText))
            {
                statusText.Content = "Empty selection";
                selectionStartText.Content = "";
                selectionMiddleText.Content = "";
                selectionEndText.Content = "";
            }
            else if (selectedText.Length > 60)
            {
                statusText.Content = $"Selected {selectedText.Length} chars:";
                selectionStartText.Content = selectedText[..30];
                selectionMiddleText.Content = "...";
                selectionEndText.Content = selectedText[^30..];
            }
            else
            {
                statusText.Content = $"Selected {selectedText.Length} chars:";
                selectionStartText.Content = $"\"{selectedText}\"";
                selectionMiddleText.Content = "";
                selectionEndText.Content = "";
            }
            renderer.RequestRender();
        }

        renderer.KeyInput.On("mouse", (MouseEvent mouse) =>
        {
            if (mouse.Button != MouseButton.Left) return;

            if (mouse.Pressed)
            {
                if (!dragging)
                {
                    activeFont = allFonts.FirstOrDefault(f => f.ContainsPoint(mouse.X, mouse.Y));
                    if (activeFont == null) return;

                    foreach (var font in allFonts.Where(f => f != activeFont))
                        font.ClearSelection();

                    dragging = true;
                    selectionStart = activeFont.ColumnToTextIndex(mouse.X);
                }

                if (activeFont != null)
                {
                    var current = activeFont.ColumnToTextIndex(mouse.X);
                    activeFont.SetSelection(selectionStart, current);
                    UpdateStatus();
                }
            }
            else
            {
                dragging = false;
            }
        });

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "escape" || key.Name == "q")
            {
                renderer.Destroy();
                return;
            }

            if (key.Name == "c")
            {
                key.PreventDefault();
                ClearSelection();
            }
        });

        renderer.Start();
    }

    private static void AddFont(BoxRenderable parent, List<ASCIIFontRenderable> fonts, CliRenderer renderer, string text, string font, string color)
    {
        var renderable = new ASCIIFontRenderable(renderer)
        {
            Text = text,
            Font = font,
            Color = color,
            BackgroundColor = "#000028",
            SelectionBg = "#4a5568",
            SelectionFg = "#ffffff",
            ZIndex = 20
        };
        renderable.SetWidth(88);
        renderable.SetHeight(4);
        renderable.MarginBottom = 1;
        parent.Add(renderable);
        fonts.Add(renderable);
    }

    private static TextRenderable StatusLine(CliRenderer renderer, string fg)
    {
        var line = new TextRenderable(renderer, new TextOptions
        {
            Content = "",
            Fg = fg,
            Bg = "#0d1117",
            Height = 1
        });
        line.SetWidth("100%");
        return line;
    }
}
