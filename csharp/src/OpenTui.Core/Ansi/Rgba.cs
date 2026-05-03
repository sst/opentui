using System;

namespace OpenTui.Core.Ansi
{
    /// <summary>
    /// Packed RGBA color. Each ushort component stores an 8-bit channel value in its
    /// low byte and one byte of a 32-bit metadata word in its high byte.
    ///
    /// This layout mirrors the Zig/TypeScript implementation exactly so that color +
    /// intent live in a single 64-bit value and can be compared with integer equality.
    ///
    /// Use the static factory methods (FromValues, FromInts, FromIndex, FromHex, …) to
    /// build values and the accessors (RedByte, GreenByte, …, Intent, Slot) to read them.
    /// </summary>
    public readonly struct Rgba : IEquatable<Rgba>
    {
        public readonly ushort R;
        public readonly ushort G;
        public readonly ushort B;
        public readonly ushort A;

        public Rgba(ushort r, ushort g, ushort b, ushort a)
        {
            R = r; G = g; B = b; A = a;
        }

        // ── channel accessors ──────────────────────────────────────────────────────

        public byte RedByte   => (byte)(R & 0xFF);
        public byte GreenByte => (byte)(G & 0xFF);
        public byte BlueByte  => (byte)(B & 0xFF);
        public byte AlphaByte => (byte)(A & 0xFF);

        public float RedF   => RedByte   / 255f;
        public float GreenF => GreenByte / 255f;
        public float BlueF  => BlueByte  / 255f;
        public float AlphaF => AlphaByte / 255f;

        // ── metadata accessors ────────────────────────────────────────────────────

        public uint Meta =>
            (uint)(R >> 8) |
            ((uint)(G >> 8) <<  8) |
            ((uint)(B >> 8) << 16) |
            ((uint)(A >> 8) << 24);

        public ColorIntent Intent => (ColorIntent)((Meta >> 8) & 0xFF);
        public byte Slot => (byte)(Meta & 0xFF);

        // ── private helpers ───────────────────────────────────────────────────────

        private static byte ToU8(float v) =>
            (byte)Math.Round(Math.Clamp(float.IsFinite(v) ? v : 0f, 0f, 1f) * 255f);

        private static byte Clamp255(int v) =>
            (byte)Math.Clamp(v, 0, 255);

        private static uint PackMeta(ColorIntent intent, byte slot = 0) =>
            (uint)slot | ((uint)intent << 8);

        private static Rgba Pack(byte r, byte g, byte b, byte a, uint meta) => new Rgba(
            (ushort)(r | (((meta >>  0) & 0xFF) << 8)),
            (ushort)(g | (((meta >>  8) & 0xFF) << 8)),
            (ushort)(b | (((meta >> 16) & 0xFF) << 8)),
            (ushort)(a | (((meta >> 24) & 0xFF) << 8))
        );

        // ── factory methods ───────────────────────────────────────────────────────

        /// <summary>Create an RGB color from float channels in [0, 1].</summary>
        public static Rgba FromValues(float r, float g, float b, float a = 1f) =>
            Pack(ToU8(r), ToU8(g), ToU8(b), ToU8(a), PackMeta(ColorIntent.Rgb));

        /// <summary>Create an RGB color from byte channels in [0, 255].</summary>
        public static Rgba FromInts(int r, int g, int b, int a = 255) =>
            Pack(Clamp255(r), Clamp255(g), Clamp255(b), Clamp255(a), PackMeta(ColorIntent.Rgb));

        /// <summary>Create an ANSI 256-indexed color. Emits 38;5;index sequences.</summary>
        public static Rgba FromIndex(int index, Rgba? snapshot = null)
        {
            int idx = Math.Clamp(index, 0, 255);
            var rgb = snapshot ?? Ansi256ToRgb(idx);
            return Pack(rgb.RedByte, rgb.GreenByte, rgb.BlueByte, rgb.AlphaByte,
                        PackMeta(ColorIntent.Indexed, (byte)idx));
        }

        /// <summary>Create a terminal-default foreground. Emits SGR 39.</summary>
        public static Rgba DefaultForeground(Rgba? snapshot = null)
        {
            var rgb = snapshot ?? FromInts(255, 255, 255);
            return Pack(rgb.RedByte, rgb.GreenByte, rgb.BlueByte, rgb.AlphaByte,
                        PackMeta(ColorIntent.Default));
        }

        /// <summary>Create a terminal-default background. Emits SGR 49.</summary>
        public static Rgba DefaultBackground(Rgba? snapshot = null)
        {
            var rgb = snapshot ?? FromInts(0, 0, 0);
            return Pack(rgb.RedByte, rgb.GreenByte, rgb.BlueByte, rgb.AlphaByte,
                        PackMeta(ColorIntent.Default));
        }

        /// <summary>Parse a hex color string (#RGB, #RRGGBB, #RRGGBBAA).</summary>
        public static Rgba FromHex(string hex)
        {
            hex = hex.TrimStart('#');
            if (hex.Length == 3)
                hex = $"{hex[0]}{hex[0]}{hex[1]}{hex[1]}{hex[2]}{hex[2]}";
            else if (hex.Length == 4)
                hex = $"{hex[0]}{hex[0]}{hex[1]}{hex[1]}{hex[2]}{hex[2]}{hex[3]}{hex[3]}";

            if (hex.Length == 6)
                return FromInts(
                    Convert.ToInt32(hex[0..2], 16),
                    Convert.ToInt32(hex[2..4], 16),
                    Convert.ToInt32(hex[4..6], 16));

            if (hex.Length == 8)
                return FromInts(
                    Convert.ToInt32(hex[0..2], 16),
                    Convert.ToInt32(hex[2..4], 16),
                    Convert.ToInt32(hex[4..6], 16),
                    Convert.ToInt32(hex[6..8], 16));

            // Fallback: magenta to signal a parse error
            return FromValues(1f, 0f, 1f);
        }

        /// <summary>Parse a CSS color name or hex string.</summary>
        public static Rgba FromCss(string name) => name.ToLowerInvariant() switch
        {
            "transparent"   => FromValues(0f, 0f, 0f, 0f),
            "black"         => FromHex("#000000"),
            "white"         => FromHex("#FFFFFF"),
            "red"           => FromHex("#FF0000"),
            "green"         => FromHex("#008000"),
            "blue"          => FromHex("#0000FF"),
            "yellow"        => FromHex("#FFFF00"),
            "cyan" or "aqua"=> FromHex("#00FFFF"),
            "magenta" or "fuchsia" => FromHex("#FF00FF"),
            "silver"        => FromHex("#C0C0C0"),
            "gray" or "grey"=> FromHex("#808080"),
            _               => FromHex(name),
        };

        // ── conversion helpers ────────────────────────────────────────────────────

        public (byte R, byte G, byte B, byte A) ToInts() =>
            (RedByte, GreenByte, BlueByte, AlphaByte);

        /// <summary>Source-over alpha compositing: blend this color over dst.</summary>
        public Rgba BlendOver(Rgba dst)
        {
            float sa = AlphaF;
            float da = dst.AlphaF;
            float outA = sa + da * (1f - sa);
            if (outA < 1e-6f) return new Rgba(0, 0, 0, 0);
            float r = (RedF   * sa + dst.RedF   * da * (1f - sa)) / outA;
            float g = (GreenF * sa + dst.GreenF * da * (1f - sa)) / outA;
            float b = (BlueF  * sa + dst.BlueF  * da * (1f - sa)) / outA;
            return FromValues(r, g, b, outA);
        }

        // ── ANSI 256-color palette ────────────────────────────────────────────────

        private static readonly (byte R, byte G, byte B)[] Ansi16 =
        {
            (0,0,0),(128,0,0),(0,128,0),(128,128,0),(0,0,128),(128,0,128),(0,128,128),(192,192,192),
            (128,128,128),(255,0,0),(0,255,0),(255,255,0),(0,0,255),(255,0,255),(0,255,255),(255,255,255),
        };

        private static readonly byte[] CubeLevels = { 0, 95, 135, 175, 215, 255 };

        public static Rgba Ansi256ToRgb(int index)
        {
            if (index < 16)
            {
                var (r, g, b) = Ansi16[index];
                return FromInts(r, g, b);
            }
            if (index < 232)
            {
                int ci = index - 16;
                return FromInts(CubeLevels[(ci / 36) % 6], CubeLevels[(ci / 6) % 6], CubeLevels[ci % 6]);
            }
            byte gray = (byte)(8 + (index - 232) * 10);
            return FromInts(gray, gray, gray);
        }

        // ── equality ──────────────────────────────────────────────────────────────

        public bool Equals(Rgba other) => R == other.R && G == other.G && B == other.B && A == other.A;
        public override bool Equals(object? obj) => obj is Rgba other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(R, G, B, A);
        public static bool operator ==(Rgba a, Rgba b) =>  a.Equals(b);
        public static bool operator !=(Rgba a, Rgba b) => !a.Equals(b);

        public override string ToString() =>
            $"rgba({RedF:F2}, {GreenF:F2}, {BlueF:F2}, {AlphaF:F2})";    }
}
