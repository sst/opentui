using System.Text.RegularExpressions;
using OpenTui.Core.Input;
using OpenTui.Core.Rendering;
using OpenTui.Core.Renderables;

namespace OpenTui.Samples;

internal static partial class InputSample
{
    private static readonly List<InputRenderable> Inputs = new();
    private static int _activeInputIndex;
    private static string _lastActionText = "Welcome to InputRenderable demo! Use Tab to navigate between fields.";
    private static string _lastActionColor = "#FFCC00";

    public static void Run()
    {
        Inputs.Clear();
        _activeInputIndex = 0;
        _lastActionText = "Welcome to InputRenderable demo! Use Tab to navigate between fields.";
        _lastActionColor = "#FFCC00";

        var renderer = new CliRenderer(new CliRendererConfig
        {
            ExitOnCtrlC = false,
            TargetFps = 60,
            BackgroundColor = "#001122"
        });

        var parent = new BoxRenderable(renderer, new BoxOptions
        {
            BackgroundColor = "#001122"
        });
        parent.SetWidth("100%");
        parent.SetHeight("100%");
        renderer.Root.Add(parent);

        var nameInput = CreateInput(renderer, 5, 2, 40, "Enter your name...", 50);
        var emailInput = CreateInput(renderer, 5, 6, 40, "Enter your email...", 100);
        var passwordInput = CreateInput(renderer, 5, 10, 40, "Enter password...", 50);
        var commentInput = CreateInput(renderer, 5, 14, 60, "Enter a comment...", 200);

        Inputs.AddRange([nameInput, emailInput, passwordInput, commentInput]);
        foreach (var input in Inputs)
            renderer.Root.Add(input);

        var keyLegend = new TextRenderable(renderer, new TextOptions
        {
            Fg = "#AAAAAA",
            Bg = "#001122",
            Wrap = false,
            Height = 12
        });
        keyLegend.SetWidth(58);
        keyLegend.Position = "absolute";
        keyLegend.Left = 50;
        keyLegend.Top = 2;
        parent.Add(keyLegend);

        var status = new TextRenderable(renderer, new TextOptions
        {
            Fg = "#DDDDDD",
            Bg = "#001122",
            Wrap = false,
            Height = 18
        });
        status.SetWidth(92);
        status.Position = "absolute";
        status.Left = 5;
        status.Top = 19;
        parent.Add(status);

        string GetInputName(InputRenderable? input)
        {
            if (input == nameInput) return "Name";
            if (input == emailInput) return "Email";
            if (input == passwordInput) return "Password";
            if (input == commentInput) return "Comment";
            return "Unknown";
        }

        InputRenderable? GetActiveInput() => _activeInputIndex >= 0 && _activeInputIndex < Inputs.Count ? Inputs[_activeInputIndex] : null;

        void UpdateDisplays()
        {
            keyLegend.Content = """
Key Controls:
Tab/Shift+Tab: Navigate between inputs
Left/Right: Move cursor within input
Home/End: Move to start/end of input
Backspace/Delete: Remove characters
Enter: Submit current input
Ctrl+F: Toggle focus on active input
Ctrl+C: Clear active input
Ctrl+R: Reset all inputs to defaults
Esc: Exit demo
Type: Enter text in focused field
""";

            var active = GetActiveInput();
            var passwordMasked = new string('*', passwordInput.Value.Length);
            status.Content =
                $"""
Input Values:
Name: "{nameInput.Value}" ({FocusStatus(nameInput)})
Email: "{emailInput.Value}" ({FocusStatus(emailInput)})
Password: "{passwordMasked}" ({FocusStatus(passwordInput)})
Comment: "{commentInput.Value}" ({FocusStatus(commentInput)})

Active Input: {GetInputName(active)}

Validation:
Name: {(ValidateName(nameInput.Value) ? "OK Valid" : "X Invalid (min 2 chars)")}
Email: {(ValidateEmail(emailInput.Value) ? "OK Valid" : "X Invalid format")}
Password: {(ValidatePassword(passwordInput.Value) ? "OK Valid" : "X Invalid (min 6 chars)")}

{_lastActionText}
""";
            status.Fg = _lastActionColor;
            renderer.RequestRender();
        }

        void NavigateToInput(int index)
        {
            GetActiveInput()?.Blur();
            _activeInputIndex = Math.Clamp(index, 0, Inputs.Count - 1);
            var next = GetActiveInput();
            next?.Focus();
            _lastActionText = $"Switched to {GetInputName(next)} input";
            _lastActionColor = "#FFCC00";
            UpdateDisplays();
        }

        void ResetInputs()
        {
            foreach (var input in Inputs)
                input.Value = "";

            _lastActionText = "All inputs reset to empty values";
            _lastActionColor = "#FF00FF";
            UpdateDisplays();
        }

        foreach (var input in Inputs)
        {
            input.On("input", data =>
            {
                _lastActionText = $"{GetInputName(input)} input: \"{data}\"";
                _lastActionColor = "#00FFFF";
                UpdateDisplays();
            });

            input.On("change", data =>
            {
                _lastActionText = $"*** {GetInputName(input)} CHANGED: \"{data}\" ***";
                _lastActionColor = "#FF00FF";
                UpdateDisplays();
            });

            input.On("enter", data =>
            {
                var value = data?.ToString() ?? "";
                var inputName = GetInputName(input);
                var isValid = inputName switch
                {
                    "Name" => ValidateName(value),
                    "Email" => ValidateEmail(value),
                    "Password" => ValidatePassword(value),
                    _ => true
                };

                _lastActionText = $"*** {inputName} SUBMITTED: \"{value}\" {(isValid ? "(Valid)" : "(Invalid)")} ***";
                _lastActionColor = isValid ? "#00FF00" : "#FF0000";
                UpdateDisplays();
            });

            input.On("focused", _ => UpdateDisplays());
            input.On("blurred", _ => UpdateDisplays());
        }

        renderer.KeyInput.On("keypress", (KeyEvent key) =>
        {
            if (key.Name == "escape")
            {
                key.PreventDefault();
                renderer.Destroy();
                return;
            }

            if (key.Name == "tab" || key.Name == "shift+tab")
            {
                key.PreventDefault();
                NavigateToInput(key.Shift || key.Name == "shift+tab" ? _activeInputIndex - 1 : _activeInputIndex + 1);
                return;
            }

            if (key.Ctrl && key.Name == "ctrl+f")
            {
                key.PreventDefault();
                var active = GetActiveInput();
                if (active?.Focused == true)
                {
                    active.Blur();
                    _lastActionText = $"Focus removed from {GetInputName(active)} input";
                }
                else
                {
                    active?.Focus();
                    _lastActionText = $"{GetInputName(active)} input focused";
                }
                _lastActionColor = "#FFCC00";
                UpdateDisplays();
                return;
            }

            if (key.Ctrl && key.Name == "ctrl+c")
            {
                key.PreventDefault();
                var active = GetActiveInput();
                if (active != null)
                {
                    active.Value = "";
                    _lastActionText = $"{GetInputName(active)} input cleared";
                    _lastActionColor = "#FFAA00";
                    UpdateDisplays();
                }
                return;
            }

            if (key.Ctrl && key.Name == "ctrl+r")
            {
                key.PreventDefault();
                ResetInputs();
            }
        });

        nameInput.Focus();
        UpdateDisplays();
        renderer.Start();
    }

    private static InputRenderable CreateInput(CliRenderer renderer, int left, int top, int width, string placeholder, int maxLength)
    {
        var input = new InputRenderable(renderer, new InputOptions
        {
            Placeholder = placeholder,
            PlaceholderColor = "#666666",
            CursorColor = "#FFFF00",
            Fg = "#FFFFFF",
            Bg = "#001122",
            MaxLength = maxLength,
            Width = width,
            Height = 3,
            Value = ""
        });
        input.Position = "absolute";
        input.Left = left;
        input.Top = top;
        input.ZIndex = 100;
        return input;
    }

    private static string FocusStatus(InputRenderable input) => input.Focused ? "FOCUSED" : "BLURRED";

    private static bool ValidateName(string value) => value.Length >= 2;

    private static bool ValidateEmail(string value) => EmailRegex().IsMatch(value);

    private static bool ValidatePassword(string value) => value.Length >= 6;

    [GeneratedRegex(@"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
    private static partial Regex EmailRegex();
}
