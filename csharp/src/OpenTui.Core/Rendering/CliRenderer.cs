using System.Runtime.InteropServices;
using System.Text;
using OpenTui.Core.Ansi;
using OpenTui.Core.Input;
using OpenTui.Core.Layout;
using OpenTui.Core.Renderables;
using SysConsole = System.Console;
using SysEncoding = System.Text.Encoding;

namespace OpenTui.Core.Rendering;

public class CliRendererConfig
{
    public bool ExitOnCtrlC { get; set; } = true;
    public int TargetFps { get; set; } = 30;
    public bool Testing { get; set; } = false;
    public string? BackgroundColor { get; set; }
}

public class ResizeEventArgs : EventArgs
{
    public int Width { get; }
    public int Height { get; }
    public ResizeEventArgs(int w, int h) { Width = w; Height = h; }
}

public class CliRenderer : IDisposable
{
    public int TerminalWidth { get; private set; }
    public int TerminalHeight { get; private set; }
    public RootRenderable Root { get; private set; }
    public KeyHandler KeyInput { get; } = new();

    public event EventHandler<ResizeEventArgs>? Resize;

    private readonly CliRendererConfig _config;
    private RenderBuffer? _prevBuffer;
    private bool _running;
    private bool _disposed;
    private volatile bool _renderRequested;
    private Rgba _backgroundColor;
    private Thread? _stdinThread;
    private Thread? _renderThread;
    private readonly AutoResetEvent _renderSignal = new(false);
    private readonly object _renderLock = new();
    private DateTime _lastFrame = DateTime.UtcNow;
    private IDisposable? _sigwinchReg;

    public CliRenderer(CliRendererConfig? config = null)
    {
        _config = config ?? new CliRendererConfig();
        _backgroundColor = _config.BackgroundColor != null
            ? Rgba.FromCss(_config.BackgroundColor)
            : Rgba.FromInts(0, 0, 0);

        TerminalWidth = _config.Testing ? 80 : Math.Max(1, SysConsole.WindowWidth);
        TerminalHeight = _config.Testing ? 24 : Math.Max(1, SysConsole.WindowHeight);

        Root = new RootRenderable(this);
    }

    public Renderable? CurrentFocus { get; private set; }

    internal void OnRenderableFocused(Renderable r)
    {
        if (CurrentFocus != null && CurrentFocus != r)
        {
            var prev = CurrentFocus;
            CurrentFocus = null; // prevent re-entry before Blur emits
            prev.Blur();
        }
        CurrentFocus = r;
    }

    internal void OnRenderableBlurred(Renderable r)
    {
        if (CurrentFocus == r)
            CurrentFocus = null;
    }

    public void SetBackgroundColor(string color)
    {
        _backgroundColor = Rgba.FromCss(color);
    }

    public void RequestRender()
    {
        _renderRequested = true;
        _renderSignal.Set();

        if (_running && !_disposed && !_config.Testing)
        {
            _renderRequested = false;
            DoRender();
        }
    }

    internal void RegisterRenderable(Renderable r)
    {
        // Called when renderables register themselves
    }

    public void Start()
    {
        if (_disposed) return;
        _running = true;

        if (!_config.Testing)
        {
            SysConsole.OutputEncoding = Encoding.UTF8;
            SetRawMode(true);
            SysConsole.Write(AnsiCodes.SwitchToAlternate);
            SysConsole.Write(AnsiCodes.HideCursor);
            SysConsole.Write(AnsiCodes.ClearAndHome);
            // Enable mouse
            SysConsole.Write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
            SysConsole.Out.Flush();

            // SIGWINCH
            try
            {
                _sigwinchReg = PosixSignalRegistration.Create(PosixSignal.SIGWINCH, _ =>
                {
                    CheckResize();
                    _renderRequested = true;
                });
            }
            catch { /* not on Unix, ignore */ }

            _renderThread = new Thread(RenderLoop) { IsBackground = true, Name = "opentui-render" };
            _renderThread.Start();

            // Stdin reader thread
            _stdinThread = new Thread(StdinLoop) { IsBackground = true, Name = "opentui-stdin" };
            _stdinThread.Start();
        }

        KeyInput.On("keypress", (object? data) =>
        {
            if (_config.ExitOnCtrlC && data is KeyEvent k && k.Name == "ctrl+c")
                Destroy();
            if (data is KeyEvent key)
            {
                if (!key.DefaultPrevented)
                    CurrentFocus?.HandleKey(key);
            }
        });

        KeyInput.On("mouse", (object? data) =>
        {
            if (data is not MouseEvent mouse) return;

            if (mouse.Button is MouseButton.WheelUp or MouseButton.WheelDown)
            {
                // Scroll goes to the renderable under the cursor (like the original),
                // falling back to the focused renderable when there is no hit.
                var scrollTarget = HitTest(mouse.X, mouse.Y) ?? CurrentFocus;
                scrollTarget?.HandleMouse(mouse);
            }
            else if (mouse.Pressed && mouse.Button == MouseButton.Left)
            {
                var target = HitTest(mouse.X, mouse.Y);
                if (target != null)
                {
                    // Walk up the parent chain to focus the nearest focusable ancestor
                    // (mirrors the original TypeScript autoFocus behaviour).
                    var focusTarget = target;
                    while (focusTarget != null && !focusTarget.Focusable)
                        focusTarget = focusTarget.Parent;
                    focusTarget?.Focus();
                    target.HandleMouse(mouse);
                }
                else
                {
                    // Click on nothing — blur current focus
                    CurrentFocus?.Blur();
                }
            }
            else if (mouse.Button == MouseButton.Left)
            {
                CurrentFocus?.HandleMouse(mouse);
            }
            else
            {
                CurrentFocus?.HandleMouse(mouse);
            }
        });

        RequestRender();

        // Block until stopped
        while (_running && !_disposed)
            Thread.Sleep(50);
    }

    public void Stop()
    {
        _running = false;
    }

    public void Destroy()
    {
        if (_disposed) return;
        _disposed = true;
        _running = false;

        _renderSignal.Set();
        _sigwinchReg?.Dispose();

        if (!_config.Testing)
        {
            // Disable mouse
            SysConsole.Write("\x1b[?1000l\x1b[?1002l\x1b[?1006l");
            SysConsole.Write(AnsiCodes.ShowCursor);
            SysConsole.Write(AnsiCodes.SwitchToMain);
            SysConsole.Write(AnsiCodes.Reset);
            SysConsole.Out.Flush();
            SetRawMode(false);
        }
    }

    public void Dispose() => Destroy();

    private void DoRender()
    {
        lock (_renderLock)
        {
            try
            {
                if (_config.Testing) return;
                CheckResize();

                var now = DateTime.UtcNow;
                double deltaTime = (now - _lastFrame).TotalSeconds;
                _lastFrame = now;

                var buffer = new RenderBuffer(TerminalWidth, TerminalHeight);
                buffer.Clear(_backgroundColor);

                FlexLayout.Calculate(Root.LayoutNode, TerminalWidth, TerminalHeight);
                Root.Render(buffer, deltaTime);

                EmitDiff(buffer);
                _prevBuffer = buffer;
            }
            catch { /* ignore render errors */ }
        }
    }

    private void RenderLoop()
    {
        int intervalMs = Math.Max(1, 1000 / _config.TargetFps);

        while (_running && !_disposed)
        {
            _renderSignal.WaitOne(intervalMs);

            if (_disposed || !_running)
                break;

            if (_renderRequested || !_config.Testing)
            {
                _renderRequested = false;
                DoRender();
            }
        }
    }

    private void EmitDiff(RenderBuffer next)
    {
        var sb = new StringBuilder(TerminalWidth * TerminalHeight * 10);

        Rgba? lastFg = null;
        Rgba? lastBg = null;
        TextAttributes? lastAttrs = null;

        for (int y = 0; y < TerminalHeight; y++)
        {
            for (int x = 0; x < TerminalWidth; x++)
            {
                var n = next.GetCell(x, y);
                if (n == null) continue;
                var nc = n.Value;

                if (_prevBuffer != null)
                {
                    var p = _prevBuffer.GetCell(x, y);
                    if (p != null)
                    {
                        var pc = p.Value;
                        if (nc.Codepoint == pc.Codepoint && nc.Fg == pc.Fg &&
                            nc.Bg == pc.Bg && nc.Attributes == pc.Attributes)
                            continue;
                    }
                }

                sb.Append(AnsiCodes.MoveTo(x + 1, y + 1));

                if (lastAttrs == null || nc.Attributes != lastAttrs.Value)
                {
                    sb.Append(AnsiCodes.Reset);
                    var sw = new StringWriter(sb);
                    AnsiCodes.WriteAttributes(sw, nc.Attributes);
                    lastFg = null; lastBg = null;
                    lastAttrs = nc.Attributes;
                }

                if (lastFg == null || nc.Fg != lastFg.Value)
                {
                    AnsiCodes.WriteFgColor(new StringWriter(sb), nc.Fg);
                    lastFg = nc.Fg;
                }

                if (lastBg == null || nc.Bg != lastBg.Value)
                {
                    AnsiCodes.WriteBgColor(new StringWriter(sb), nc.Bg);
                    lastBg = nc.Bg;
                }

                sb.Append(nc.Codepoint == 0 ? ' ' : char.ConvertFromUtf32(nc.Codepoint));
            }
        }

        if (sb.Length > 0)
        {
            SysConsole.Write(sb.ToString());
            SysConsole.Out.Flush();
        }
    }

    private void StdinLoop()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            StdinLoopWindows();
            return;
        }

        var parser = new StdinParser();
        var stream = SysConsole.OpenStandardInput();
        var buf = new byte[256];

        while (_running && !_disposed)
        {
            try
            {
                int n = stream.Read(buf, 0, buf.Length);
                if (n <= 0) { Thread.Sleep(1); continue; }

                var events = parser.Feed(buf[..n]);
                foreach (var evt in events)
                {
                    if (evt is KeyEvent key)
                        KeyInput.EmitKey(key);
                    else if (evt is MouseEvent mouse)
                        KeyInput.EmitMouse(mouse);
                }
            }
            catch { Thread.Sleep(10); }
        }
    }

    private void StdinLoopWindows()
    {
        var input = GetStdHandle(StdInputHandle);
        if (IsValidConsoleHandle(input) && GetConsoleMode(input, out _))
        {
            StdinLoopWindowsConsoleInput(input);
            return;
        }

        while (_running && !_disposed)
        {
            try
            {
                if (!SysConsole.KeyAvailable)
                {
                    Thread.Sleep(5);
                    continue;
                }

                var keyInfo = SysConsole.ReadKey(intercept: true);
                var key = ParseWindowsKey(keyInfo);
                if (key != null)
                    KeyInput.EmitKey(key);
            }
            catch { Thread.Sleep(10); }
        }
    }

    private void StdinLoopWindowsConsoleInput(IntPtr input)
    {
        var records = new InputRecord[16];

        while (_running && !_disposed)
        {
            try
            {
                if (!ReadConsoleInput(input, records, (uint)records.Length, out var read) || read == 0)
                {
                    Thread.Sleep(5);
                    continue;
                }

                for (int i = 0; i < read; i++)
                {
                    var record = records[i];
                    switch (record.EventType)
                    {
                        case KeyEventRecordType:
                            var key = ParseWindowsKeyRecord(record.KeyEvent);
                            if (key != null)
                                KeyInput.EmitKey(key);
                            break;
                        case MouseEventRecordType:
                            var mouse = ParseWindowsMouseRecord(record.MouseEvent);
                            if (mouse != null)
                                KeyInput.EmitMouse(mouse);
                            break;
                    }
                }
            }
            catch { Thread.Sleep(10); }
        }
    }

    internal static KeyEvent? ParseWindowsKey(ConsoleKeyInfo keyInfo)
    {
        bool ctrl = (keyInfo.Modifiers & ConsoleModifiers.Control) != 0;
        bool alt = (keyInfo.Modifiers & ConsoleModifiers.Alt) != 0;
        bool shift = (keyInfo.Modifiers & ConsoleModifiers.Shift) != 0;

        string? name = keyInfo.Key switch
        {
            ConsoleKey.Backspace => "backspace",
            ConsoleKey.Enter => "return",
            ConsoleKey.Escape => "escape",
            ConsoleKey.Tab => shift ? "shift+tab" : "tab",
            ConsoleKey.LeftArrow => "left",
            ConsoleKey.RightArrow => "right",
            ConsoleKey.UpArrow => "up",
            ConsoleKey.DownArrow => "down",
            ConsoleKey.Home => "home",
            ConsoleKey.End => "end",
            ConsoleKey.Delete => "delete",
            ConsoleKey.Insert => "insert",
            ConsoleKey.PageUp => "pageup",
            ConsoleKey.PageDown => "pagedown",
            >= ConsoleKey.F1 and <= ConsoleKey.F12 => $"f{keyInfo.Key - ConsoleKey.F1 + 1}",
            _ => null
        };

        char? ch = keyInfo.KeyChar == '\0' ? null : keyInfo.KeyChar;

        if (name == null && ch.HasValue && !char.IsControl(ch.Value))
            name = char.ToLowerInvariant(ch.Value).ToString();

        if (name == null && ctrl && keyInfo.Key >= ConsoleKey.A && keyInfo.Key <= ConsoleKey.Z)
            name = $"ctrl+{char.ToLowerInvariant((char)keyInfo.Key)}";

        if (name == null)
            return null;

        if (ctrl && ch.HasValue && char.IsLetter(ch.Value))
            name = $"ctrl+{char.ToLowerInvariant(ch.Value)}";
        else if (alt)
            name = $"alt+{name}";

        return new KeyEvent
        {
            Name = name,
            Key = name,
            Ctrl = ctrl,
            Alt = alt,
            Meta = alt,
            Shift = shift,
            Char = ch
        };
    }

    private static KeyEvent? ParseWindowsKeyRecord(KeyEventRecord record)
    {
        if (!record.KeyDown)
            return null;

        var key = (ConsoleKey)record.VirtualKeyCode;
        var keyChar = record.UnicodeChar;
        bool shift = (record.ControlKeyState & ShiftPressed) != 0;
        bool alt = (record.ControlKeyState & (LeftAltPressed | RightAltPressed)) != 0;
        bool ctrl = (record.ControlKeyState & (LeftCtrlPressed | RightCtrlPressed)) != 0;

        return ParseWindowsKey(new ConsoleKeyInfo(keyChar, key, shift, alt, ctrl));
    }

    private static MouseEvent? ParseWindowsMouseRecord(MouseEventRecord record)
    {
        const int wheelDelta = 120;

        if ((record.EventFlags & MouseWheeled) != 0)
        {
            int delta = unchecked((short)((record.ButtonState >> 16) & 0xffff));
            if (delta == 0) return null;

            return new MouseEvent
            {
                X = record.MousePosition.X,
                Y = record.MousePosition.Y,
                Button = delta / wheelDelta > 0 ? MouseButton.WheelUp : MouseButton.WheelDown,
                Pressed = true,
                Ctrl = (record.ControlKeyState & (LeftCtrlPressed | RightCtrlPressed)) != 0,
                Alt = (record.ControlKeyState & (LeftAltPressed | RightAltPressed)) != 0,
                Shift = (record.ControlKeyState & ShiftPressed) != 0
            };
        }

        if ((record.ButtonState & FromLeft1stButtonPressed) != 0)
        {
            return new MouseEvent
            {
                X = record.MousePosition.X,
                Y = record.MousePosition.Y,
                Button = MouseButton.Left,
                Pressed = true,
                Ctrl = (record.ControlKeyState & (LeftCtrlPressed | RightCtrlPressed)) != 0,
                Alt = (record.ControlKeyState & (LeftAltPressed | RightAltPressed)) != 0,
                Shift = (record.ControlKeyState & ShiftPressed) != 0
            };
        }

        if ((record.EventFlags & MouseMoved) != 0)
            return null;

        return new MouseEvent
        {
            X = record.MousePosition.X,
            Y = record.MousePosition.Y,
            Button = MouseButton.Left,
            Pressed = false,
            Ctrl = (record.ControlKeyState & (LeftCtrlPressed | RightCtrlPressed)) != 0,
            Alt = (record.ControlKeyState & (LeftAltPressed | RightAltPressed)) != 0,
            Shift = (record.ControlKeyState & ShiftPressed) != 0
        };
    }

    private void CheckResize()
    {
        try
        {
            int w = Math.Max(1, SysConsole.WindowWidth);
            int h = Math.Max(1, SysConsole.WindowHeight);
            if (w != TerminalWidth || h != TerminalHeight)
            {
                TerminalWidth = w;
                TerminalHeight = h;
                Root.UpdateSize(w, h);
                Resize?.Invoke(this, new ResizeEventArgs(w, h));
            }
        }
        catch { /* may fail in non-tty environments */ }
    }

    private Renderable? HitTest(int x, int y) => HitTestNode(Root, x, y);

    private static Renderable? HitTestNode(Renderable node, int x, int y)
    {
        if (!node.Visible) return null;

        int nx = node.ScreenX, ny = node.ScreenY;
        int nw = node.ComputedWidth, nh = node.ComputedHeight;
        if (nw <= 0 || nh <= 0) return null;
        if (x < nx || x >= nx + nw || y < ny || y >= ny + nh) return null;

        // Check children in reverse z-order (topmost first)
        foreach (var child in node.GetChildren().OrderByDescending(c => c.ZIndex))
        {
            var hit = HitTestNode(child, x, y);
            if (hit != null) return hit;
        }

        return node.Focusable ? node : null;
    }

    // ── raw mode (Unix) ───────────────────────────────────────────────────────

    private static void SetRawMode(bool enable)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            SetRawModeWindows(enable);
        else
            SetRawModeUnix(enable);
    }

    // -- raw mode (Windows) ---------------------------------------------------

    private static readonly IntPtr InvalidHandleValue = new(-1);

    private const int StdInputHandle = -10;
    private const int StdOutputHandle = -11;

    private const uint EnableProcessedInput = 0x0001;
    private const uint EnableLineInput = 0x0002;
    private const uint EnableEchoInput = 0x0004;
    private const uint EnableWindowInput = 0x0008;
    private const uint EnableMouseInput = 0x0010;
    private const uint EnableQuickEditMode = 0x0040;
    private const uint EnableExtendedFlags = 0x0080;
    private const uint EnableProcessedOutput = 0x0001;
    private const uint EnableVirtualTerminalProcessing = 0x0004;

    private static uint _savedWindowsInputMode;
    private static uint _savedWindowsOutputMode;
    private static bool _windowsInputModeSaved;
    private static bool _windowsOutputModeSaved;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ReadConsoleInput(
        IntPtr hConsoleInput,
        [Out] InputRecord[] lpBuffer,
        uint nLength,
        out uint lpNumberOfEventsRead);

    private const ushort KeyEventRecordType = 0x0001;
    private const ushort MouseEventRecordType = 0x0002;

    private const uint FromLeft1stButtonPressed = 0x0001;
    private const uint MouseMoved = 0x0001;
    private const uint MouseWheeled = 0x0004;

    private const uint RightAltPressed = 0x0001;
    private const uint LeftAltPressed = 0x0002;
    private const uint RightCtrlPressed = 0x0004;
    private const uint LeftCtrlPressed = 0x0008;
    private const uint ShiftPressed = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct Coord
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    private struct InputRecord
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KeyEventRecord KeyEvent;
        [FieldOffset(4)] public MouseEventRecord MouseEvent;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    private struct KeyEventRecord
    {
        [FieldOffset(0)] public bool KeyDown;
        [FieldOffset(4)] public ushort RepeatCount;
        [FieldOffset(6)] public ushort VirtualKeyCode;
        [FieldOffset(8)] public ushort VirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint ControlKeyState;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseEventRecord
    {
        public Coord MousePosition;
        public uint ButtonState;
        public uint ControlKeyState;
        public uint EventFlags;
    }

    private static void SetRawModeWindows(bool enable)
    {
        try
        {
            var input = GetStdHandle(StdInputHandle);
            var output = GetStdHandle(StdOutputHandle);

            if (enable)
            {
                if (IsValidConsoleHandle(input) && GetConsoleMode(input, out var inputMode))
                {
                    if (!_windowsInputModeSaved)
                    {
                        _savedWindowsInputMode = inputMode;
                        _windowsInputModeSaved = true;
                    }

                    SetConsoleMode(input, BuildWindowsRawInputMode(inputMode));
                }

                if (IsValidConsoleHandle(output) && GetConsoleMode(output, out var outputMode))
                {
                    if (!_windowsOutputModeSaved)
                    {
                        _savedWindowsOutputMode = outputMode;
                        _windowsOutputModeSaved = true;
                    }

                    SetConsoleMode(output, BuildWindowsRawOutputMode(outputMode));
                }
            }
            else
            {
                if (_windowsInputModeSaved && IsValidConsoleHandle(input))
                    SetConsoleMode(input, _savedWindowsInputMode);

                if (_windowsOutputModeSaved && IsValidConsoleHandle(output))
                    SetConsoleMode(output, _savedWindowsOutputMode);
            }
        }
        catch { /* ignore in non-console hosts */ }
    }

    private static bool IsValidConsoleHandle(IntPtr handle)
        => handle != IntPtr.Zero && handle != InvalidHandleValue;

    internal static uint BuildWindowsRawInputMode(uint mode)
    {
        mode &= ~(EnableEchoInput | EnableLineInput | EnableProcessedInput | EnableQuickEditMode);
        mode |= EnableExtendedFlags | EnableMouseInput | EnableWindowInput;
        return mode;
    }

    internal static uint BuildWindowsRawOutputMode(uint mode)
    {
        mode |= EnableProcessedOutput | EnableVirtualTerminalProcessing;
        return mode;
    }

    // Use raw IntPtr so we control the exact native buffer size for both
    // Linux (struct termios = 60 bytes: c_line + c_cc[32]) and
    // macOS (struct termios = 44 bytes: c_cc[20], no c_line).
    [DllImport("libc", EntryPoint = "tcgetattr", SetLastError = true)]
    private static extern int TcGetAttrPtr(int fd, IntPtr termios);

    [DllImport("libc", EntryPoint = "tcsetattr", SetLastError = true)]
    private static extern int TcSetAttrPtr(int fd, int action, IntPtr termios);

    // Large enough for Linux (60 B) and macOS (44 B) termios structs.
    private const int TermiosBufSize = 64;

    // Byte offsets into the native termios struct (same on both platforms).
    private const int TermiosIflagOffset = 0;
    private const int TermiosLflagOffset = 12;

    // c_lflag bits — ECHO is 0x8 on both; the rest differ between platforms.
    private const uint ECHO    = 0x8;
    private const uint ICANON_LINUX = 0x2;    private const uint ISIG_LINUX   = 0x1;    private const uint IEXTEN_LINUX = 0x8000;
    private const uint ICANON_MAC   = 0x100;  private const uint ISIG_MAC     = 0x80;   private const uint IEXTEN_MAC   = 0x400;

    // c_iflag bits — ICRNL is 0x100 on both; IXON differs.
    private const uint ICRNL       = 0x100;
    private const uint IXON_LINUX  = 0x400;
    private const uint IXON_MAC    = 0x200;

    // c_cc array: starting byte offset in the native struct, and VMIN/VTIME indices.
    // macOS: c_cc at offset 16, VMIN=16, VTIME=17
    // Linux: c_cc at offset 17 (c_line byte sits at offset 16), VMIN=6, VTIME=5
    private const int CcStartMac   = 16; private const int VminIdxMac  = 16; private const int VtimeIdxMac = 17;
    private const int CcStartLinux = 17; private const int VminIdxLinux = 6; private const int VtimeIdxLinux = 5;

    private static byte[]? _savedTermiosBytes;
    private static bool _termiosSaved;

    private static void SetRawModeUnix(bool enable)
    {
        try
        {
            bool isMac = RuntimeInformation.IsOSPlatform(OSPlatform.OSX);

            if (enable)
            {
                var buf = Marshal.AllocHGlobal(TermiosBufSize);
                try
                {
                    // Zero-initialise so any padding bytes are deterministic.
                    for (int i = 0; i < TermiosBufSize; i++)
                        Marshal.WriteByte(buf, i, 0);

                    if (TcGetAttrPtr(0, buf) != 0) return;

                    // Persist original settings for restore on exit.
                    _savedTermiosBytes = new byte[TermiosBufSize];
                    Marshal.Copy(buf, _savedTermiosBytes, 0, TermiosBufSize);
                    _termiosSaved = true;

                    // Clear raw-mode flags in c_lflag (offset 12, same on both platforms).
                    uint c_lflag = (uint)Marshal.ReadInt32(buf, TermiosLflagOffset);
                    c_lflag &= isMac
                        ? ~(ECHO | ICANON_MAC | ISIG_MAC | IEXTEN_MAC)
                        : ~(ECHO | ICANON_LINUX | ISIG_LINUX | IEXTEN_LINUX);
                    Marshal.WriteInt32(buf, TermiosLflagOffset, (int)c_lflag);

                    // Clear flow-control flags in c_iflag (offset 0, same on both platforms).
                    uint c_iflag = (uint)Marshal.ReadInt32(buf, TermiosIflagOffset);
                    c_iflag &= isMac
                        ? ~(IXON_MAC  | ICRNL)
                        : ~(IXON_LINUX | ICRNL);
                    Marshal.WriteInt32(buf, TermiosIflagOffset, (int)c_iflag);

                    // Set VMIN=1 (block until 1 byte available) and VTIME=0 (no timeout).
                    int ccStart = isMac ? CcStartMac   : CcStartLinux;
                    int vminIdx = isMac ? VminIdxMac   : VminIdxLinux;
                    int vtimeIdx = isMac ? VtimeIdxMac : VtimeIdxLinux;
                    Marshal.WriteByte(buf, ccStart + vminIdx,  1); // VMIN
                    Marshal.WriteByte(buf, ccStart + vtimeIdx, 0); // VTIME

                    TcSetAttrPtr(0, 0, buf); // TCSANOW = 0
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
            else
            {
                if (_termiosSaved && _savedTermiosBytes != null)
                {
                    var buf = Marshal.AllocHGlobal(TermiosBufSize);
                    try
                    {
                        Marshal.Copy(_savedTermiosBytes, 0, buf, TermiosBufSize);
                        TcSetAttrPtr(0, 0, buf);
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(buf);
                    }
                }
            }
        }
        catch { /* ignore in non-tty */ }
    }
}
