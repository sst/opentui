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
    private bool _renderRequested;
    private Rgba _backgroundColor;
    private Thread? _stdinThread;
    private System.Threading.Timer? _renderTimer;
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

    public void SetBackgroundColor(string color)
    {
        _backgroundColor = Rgba.FromCss(color);
    }

    public void RequestRender()
    {
        _renderRequested = true;
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
            SysConsole.Write("\x1b[?1000h\x1b[?1006h");
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

            // Stdin reader thread
            _stdinThread = new Thread(StdinLoop) { IsBackground = true, Name = "opentui-stdin" };
            _stdinThread.Start();
        }

        KeyInput.On("keypress", (object? data) =>
        {
            if (_config.ExitOnCtrlC && data is KeyEvent k && k.Name == "ctrl+c")
                Destroy();
        });

        int intervalMs = Math.Max(1, 1000 / _config.TargetFps);
        _renderTimer = new System.Threading.Timer(_ =>
        {
            if (_renderRequested || !_config.Testing)
            {
                _renderRequested = false;
                DoRender();
            }
        }, null, 0, intervalMs);

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

        _renderTimer?.Dispose();
        _sigwinchReg?.Dispose();

        if (!_config.Testing)
        {
            // Disable mouse
            SysConsole.Write("\x1b[?1000l\x1b[?1006l");
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

    // ── raw mode (Unix) ───────────────────────────────────────────────────────

    private static void SetRawMode(bool enable)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            SetRawModeUnix(enable);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Termios
    {
        public uint c_iflag, c_oflag, c_cflag, c_lflag;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 20)]
        public byte[] c_cc;
        public uint c_ispeed, c_ospeed;
    }

    [DllImport("libc", EntryPoint = "tcgetattr", SetLastError = true)]
    private static extern int TcGetAttr(int fd, out Termios termios);

    [DllImport("libc", EntryPoint = "tcsetattr", SetLastError = true)]
    private static extern int TcSetAttr(int fd, int action, ref Termios termios);

    private static Termios _savedTermios;
    private static bool _termiosSaved;

    private static void SetRawModeUnix(bool enable)
    {
        try
        {
            if (enable)
            {
                if (TcGetAttr(0, out _savedTermios) == 0)
                {
                    _termiosSaved = true;
                    var raw = _savedTermios;
                    // Disable ECHO, ICANON, ISIG, IEXTEN
                    raw.c_lflag &= ~(uint)(0x8 | 0x2 | 0x1 | 0x8000); // ECHO|ICANON|ISIG|IEXTEN
                    // Disable IXON, ICRNL
                    raw.c_iflag &= ~(uint)(0x400 | 0x2); // IXON|ICRNL
                    raw.c_cc[6] = 1;  // VMIN
                    raw.c_cc[5] = 0;  // VTIME
                    TcSetAttr(0, 0, ref raw); // TCSANOW = 0
                }
            }
            else
            {
                if (_termiosSaved)
                    TcSetAttr(0, 0, ref _savedTermios);
            }
        }
        catch { /* ignore in non-tty */ }
    }
}
