using OpenTui.Core.Input;
using OpenTui.Core.Layout;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static class EditorSample
{
    private const string InitialContent = """
Welcome to the TextareaRenderable Demo!

This is an interactive text editor powered by EditBuffer.

    This is a tab
            Multiple tabs

Emojis:
👩🏽‍💻  👨‍👩‍👧‍👦  🏳️‍🌈  🇺🇸  🇩🇪  🇯🇵  🇮🇳

NAVIGATION:
  - Arrow keys to move cursor
  - Ctrl+A/Ctrl+E for line start/end
  - Home/End for line start/end

EDITING:
  - Type any text to insert
  - Backspace/Delete to remove text
  - Enter to create new lines
  - Ctrl+D to delete character forward
  - Ctrl+K to delete to line end
  - Ctrl+U to delete to line start

UNDO/REDO:
  - Ctrl+Z to undo
  - Ctrl+Y to redo

VIEW:
  - Shift+W to toggle wrap mode label
  - Shift+L to toggle line numbers
  - Shift+H to toggle diff highlights
  - Shift+D to toggle diagnostics

FEATURES:
  - Unicode text, emoji, CJK: 世界, 你好世界, 中文, 한글
  - Incremental editing
  - Viewport management
  - Undo/redo support

Press ESC to exit.
""";

    public static void Run()
    {
        var renderer = new CliRenderer(new CliRendererConfig
        {
            ExitOnCtrlC = true,
            TargetFps = 60,
            BackgroundColor = "#0D1117"
        });

        var parent = new BoxRenderable(renderer, new BoxOptions
        {
            BackgroundColor = "#0D1117",
            FlexDirection = FlexDirection.Column,
            FlexGrow = 1,
            PaddingTop = 1,
            PaddingRight = 1,
            PaddingBottom = 1,
            PaddingLeft = 1
        });
        parent.SetWidth("100%");
        parent.SetHeight("100%");
        renderer.Root.Add(parent);

        var editorBox = new BoxRenderable(renderer, new BoxOptions
        {
            Border = true,
            BorderStyle = "single",
            BorderColor = "#6BCF7F",
            BackgroundColor = "#0D1117",
            Title = " Interactive Editor (TextareaRenderable) ",
            TitleAlignment = "left",
            FlexDirection = FlexDirection.Row,
            FlexGrow = 1
        });
        editorBox.SetWidth("100%");
        parent.Add(editorBox);

        var lineNumbers = new LineNumbersRenderable(renderer)
        {
            Fg = "#6b7280",
            Bg = "#161b22",
            LineCount = InitialContent.Split('\n').Length,
            StartLine = 1
        };
        lineNumbers.SetWidth(5);
        lineNumbers.SetHeight("100%");
        editorBox.Add(lineNumbers);

        var editor = new TextareaRenderable(renderer, new TextareaOptions
        {
            InitialValue = InitialContent,
            Fg = "#F0F6FC",
            Bg = "#0D1117",
            WrapMode = "word",
            Placeholder = "Enter text here...",
            Height = "100%"
        })
        {
            CursorColor = "#4ECDC4",
            ShowCursor = true,
            FlexGrow = 1
        };
        editorBox.Add(editor);

        var status = new TextRenderable(renderer, new TextOptions
        {
            Content = "",
            Fg = "#A5D6FF",
            Bg = "#0D1117",
            Height = 1
        });
        status.SetWidth("100%");
        parent.Add(status);

        var lineNumbersEnabled = true;
        var highlightsEnabled = false;
        var diagnosticsEnabled = false;
        var wrapModes = new[] { "word", "char", "none" };
        var wrapIndex = 0;

        void UpdateChrome()
        {
            lineNumbers.Visible = lineNumbersEnabled;
            lineNumbers.LineCount = editor.LineCount;
            lineNumbers.StartLine = editor.ScrollY + 1;

            var cursor = editor.LogicalCursor;
            var wrap = editor.WrapMode != "none" ? "ON" : "OFF";
            var highlights = highlightsEnabled ? "ON" : "OFF";
            var diagnostics = diagnosticsEnabled ? "ON" : "OFF";
            var lines = lineNumbersEnabled ? "ON" : "OFF";
            status.Content = $"Line {cursor.Row + 1}, Col {cursor.Col + 1} | Wrap: {wrap} ({editor.WrapMode}) | Lines: {lines} | Diff: {highlights} | Diag: {diagnostics} | ESC exits";

            editorBox.BorderColor = diagnosticsEnabled ? "#f59e0b" : highlightsEnabled ? "#58A6FF" : "#6BCF7F";
            status.Fg = highlightsEnabled ? "#7EE787" : "#A5D6FF";
            renderer.RequestRender();
        }

        editor.On("input", _ => UpdateChrome());

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "escape")
            {
                key.PreventDefault();
                renderer.Destroy();
                return;
            }

            if (key.Shift && key.Name == "l")
            {
                key.PreventDefault();
                lineNumbersEnabled = !lineNumbersEnabled;
                UpdateChrome();
                return;
            }

            if (key.Shift && key.Name == "w")
            {
                key.PreventDefault();
                wrapIndex = (wrapIndex + 1) % wrapModes.Length;
                editor.WrapMode = wrapModes[wrapIndex];
                UpdateChrome();
                return;
            }

            if (key.Shift && key.Name == "h")
            {
                key.PreventDefault();
                highlightsEnabled = !highlightsEnabled;
                UpdateChrome();
                return;
            }

            if (key.Shift && key.Name == "d")
            {
                key.PreventDefault();
                diagnosticsEnabled = !diagnosticsEnabled;
                UpdateChrome();
                return;
            }

            ThreadPool.QueueUserWorkItem(_ => UpdateChrome());
        });

        editor.Focus();
        UpdateChrome();
        renderer.Start();
    }
}
