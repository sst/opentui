using System.Text;

namespace OpenTui.Core.Input;

public class StdinParser
{
    private readonly List<byte> _buf = new();

    public IEnumerable<object> Feed(byte[] data)
    {
        _buf.AddRange(data);
        var events = new List<object>();

        while (_buf.Count > 0)
        {
            var evt = TryParse(events);
            if (!evt) break;
        }

        // If only ESC remains after parsing the complete read chunk, treat it as
        // a standalone escape key press.  Terminals always send full escape
        // sequences atomically in a single read(), so a lone ESC that survives to
        // this point was not the start of a sequence.
        if (_buf.Count == 1 && _buf[0] == 0x1b)
        {
            events.Add(new KeyEvent { Name = "escape", Key = "escape" });
            _buf.Clear();
        }

        return events;
    }

    private bool TryParse(List<object> events)
    {
        if (_buf.Count == 0) return false;

        byte b = _buf[0];

        // ESC sequences
        if (b == 0x1b)
        {
            if (_buf.Count < 2)
                return false; // wait for more data

            if (_buf[1] == '[')
            {
                // CSI sequence
                if (_buf.Count < 3) return false;

                // Mouse: ESC [ < ...
                if (_buf[2] == '<')
                {
                    int end = FindMouseEnd();
                    if (end < 0) return false;
                    var mouse = ParseSgrMouse(end);
                    if (mouse != null) events.Add(mouse);
                    _buf.RemoveRange(0, end + 1);
                    return true;
                }

                // Find end of CSI sequence
                int seqEnd = FindCsiEnd(2);
                if (seqEnd < 0) return false;

                var key = ParseCsi(seqEnd);
                if (key != null) events.Add(key);
                _buf.RemoveRange(0, seqEnd + 1);
                return true;
            }
            else if (_buf[1] == 'O')
            {
                // SS3 sequences (F1-F4 on some terminals)
                if (_buf.Count < 3) return false;
                var key = ParseSs3(_buf[2]);
                if (key != null) events.Add(key);
                _buf.RemoveRange(0, 3);
                return true;
            }
            else if (_buf[1] == 0x1b)
            {
                // Double ESC = escape key
                events.Add(new KeyEvent { Name = "escape", Key = "escape" });
                _buf.RemoveAt(0);
                return true;
            }
            else
            {
                // Alt + something
                var inner = ParseSingleByte(_buf[1]);
                if (inner != null)
                {
                    events.Add(new KeyEvent
                    {
                        Name = "alt+" + inner.Name,
                        Key = inner.Key,
                        Alt = true,
                        Ctrl = inner.Ctrl,
                        Char = inner.Char
                    });
                }
                else
                {
                    events.Add(new KeyEvent { Name = "escape", Key = "escape" });
                    _buf.RemoveAt(0);
                    return true;
                }
                _buf.RemoveRange(0, 2);
                return true;
            }
        }

        // Single byte
        var singleKey = ParseSingleByte(b);
        if (singleKey != null)
        {
            events.Add(singleKey);
            _buf.RemoveAt(0);
            return true;
        }

        // Multi-byte UTF-8
        int charLen = Utf8CharLength(b);
        if (_buf.Count < charLen) return false;

        var utf8 = _buf.GetRange(0, charLen).ToArray();
        string ch = Encoding.UTF8.GetString(utf8);
        if (ch.Length > 0)
        {
            events.Add(new KeyEvent
            {
                Name = ch,
                Key = ch,
                Char = ch[0]
            });
        }
        _buf.RemoveRange(0, charLen);
        return true;
    }

    private KeyEvent? ParseSingleByte(byte b)
    {
        // Printable ASCII
        if (b >= 0x20 && b < 0x7f)
        {
            char c = (char)b;
            return new KeyEvent { Name = c.ToString(), Key = c.ToString(), Char = c };
        }

        // Special chars
        return b switch
        {
            0x7f => new KeyEvent { Name = "backspace", Key = "backspace" },
            0x08 => new KeyEvent { Name = "backspace", Key = "backspace" },
            0x0d or 0x0a => new KeyEvent { Name = "return", Key = "return" },
            0x09 => new KeyEvent { Name = "tab", Key = "tab" },
            0x1b => new KeyEvent { Name = "escape", Key = "escape" },
            0x00 => new KeyEvent { Name = "ctrl+space", Key = "ctrl+space", Ctrl = true },
            >= 0x01 and <= 0x1a => MakeCtrl(b),
            _ => null
        };
    }

    private static KeyEvent MakeCtrl(byte b)
    {
        char letter = (char)('a' + b - 1);
        return new KeyEvent
        {
            Name = $"ctrl+{letter}",
            Key = $"ctrl+{letter}",
            Ctrl = true,
            Char = letter
        };
    }

    private int FindCsiEnd(int start)
    {
        for (int i = start; i < _buf.Count; i++)
        {
            byte c = _buf[i];
            if (c >= 0x40 && c <= 0x7e)
                return i;
        }
        return -1;
    }

    private int FindMouseEnd()
    {
        for (int i = 3; i < _buf.Count; i++)
        {
            byte c = _buf[i];
            if (c == 'M' || c == 'm')
                return i;
        }
        return -1;
    }

    private KeyEvent? ParseCsi(int endIdx)
    {
        byte terminator = _buf[endIdx];
        string param = "";
        if (endIdx > 2)
            param = Encoding.ASCII.GetString(_buf.GetRange(2, endIdx - 2).ToArray());

        return terminator switch
        {
            (byte)'A' => new KeyEvent { Name = "up", Key = "up" },
            (byte)'B' => new KeyEvent { Name = "down", Key = "down" },
            (byte)'C' => new KeyEvent { Name = "right", Key = "right" },
            (byte)'D' => new KeyEvent { Name = "left", Key = "left" },
            (byte)'H' => new KeyEvent { Name = "home", Key = "home" },
            (byte)'F' => new KeyEvent { Name = "end", Key = "end" },
            (byte)'Z' => new KeyEvent { Name = "shift+tab", Key = "shift+tab", Shift = true },
            (byte)'~' => ParseTilde(param),
            _ => null
        };
    }

    private static KeyEvent? ParseTilde(string param)
    {
        return param switch
        {
            "1" or "7" => new KeyEvent { Name = "home", Key = "home" },
            "4" or "8" => new KeyEvent { Name = "end", Key = "end" },
            "2" => new KeyEvent { Name = "insert", Key = "insert" },
            "3" => new KeyEvent { Name = "delete", Key = "delete" },
            "5" => new KeyEvent { Name = "pageup", Key = "pageup" },
            "6" => new KeyEvent { Name = "pagedown", Key = "pagedown" },
            "11" => new KeyEvent { Name = "f1", Key = "f1" },
            "12" => new KeyEvent { Name = "f2", Key = "f2" },
            "13" => new KeyEvent { Name = "f3", Key = "f3" },
            "14" => new KeyEvent { Name = "f4", Key = "f4" },
            "15" => new KeyEvent { Name = "f5", Key = "f5" },
            "17" => new KeyEvent { Name = "f6", Key = "f6" },
            "18" => new KeyEvent { Name = "f7", Key = "f7" },
            "19" => new KeyEvent { Name = "f8", Key = "f8" },
            "20" => new KeyEvent { Name = "f9", Key = "f9" },
            "21" => new KeyEvent { Name = "f10", Key = "f10" },
            "23" => new KeyEvent { Name = "f11", Key = "f11" },
            "24" => new KeyEvent { Name = "f12", Key = "f12" },
            _ => null
        };
    }

    private KeyEvent? ParseSs3(byte c)
    {
        return c switch
        {
            (byte)'P' => new KeyEvent { Name = "f1", Key = "f1" },
            (byte)'Q' => new KeyEvent { Name = "f2", Key = "f2" },
            (byte)'R' => new KeyEvent { Name = "f3", Key = "f3" },
            (byte)'S' => new KeyEvent { Name = "f4", Key = "f4" },
            (byte)'H' => new KeyEvent { Name = "home", Key = "home" },
            (byte)'F' => new KeyEvent { Name = "end", Key = "end" },
            _ => null
        };
    }

    private MouseEvent? ParseSgrMouse(int endIdx)
    {
        byte terminator = _buf[endIdx];
        string param = Encoding.ASCII.GetString(_buf.GetRange(3, endIdx - 3).ToArray());
        var parts = param.Split(';');
        if (parts.Length < 3) return null;

        if (!int.TryParse(parts[0], out int btnCode)) return null;
        if (!int.TryParse(parts[1], out int x)) return null;
        if (!int.TryParse(parts[2], out int y)) return null;

        bool pressed = terminator == 'M';
        bool ctrl = (btnCode & 16) != 0;
        bool alt = (btnCode & 8) != 0;
        bool shift = (btnCode & 4) != 0;
        int btn = btnCode & 3;
        bool wheel = (btnCode & 64) != 0;

        MouseButton button;
        if (wheel)
        {
            button = btn == 0 ? MouseButton.WheelUp : MouseButton.WheelDown;
        }
        else
        {
            button = btn switch
            {
                0 => MouseButton.Left,
                1 => MouseButton.Middle,
                2 => MouseButton.Right,
                _ => MouseButton.None
            };
        }

        return new MouseEvent
        {
            X = x - 1,
            Y = y - 1,
            Button = button,
            Pressed = pressed,
            Ctrl = ctrl,
            Alt = alt,
            Shift = shift
        };
    }

    private static int Utf8CharLength(byte b)
    {
        if ((b & 0x80) == 0) return 1;
        if ((b & 0xe0) == 0xc0) return 2;
        if ((b & 0xf0) == 0xe0) return 3;
        if ((b & 0xf8) == 0xf0) return 4;
        return 1;
    }
}
