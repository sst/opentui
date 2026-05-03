using Xunit;
using OpenTui.Core.Ansi;

namespace OpenTui.Tests
{
    public class RgbaTests
    {
        // ── FromValues ────────────────────────────────────────────────────────────

        [Fact]
        public void FromValues_StoresNormalisedChannels()
        {
            var c = Rgba.FromValues(1f, 0f, 0f, 1f);
            Assert.Equal(255, c.RedByte);
            Assert.Equal(0,   c.GreenByte);
            Assert.Equal(0,   c.BlueByte);
            Assert.Equal(255, c.AlphaByte);
        }

        [Fact]
        public void FromValues_ClampsBeyondOne()
        {
            var c = Rgba.FromValues(2f, -1f, 0.5f);
            Assert.Equal(255, c.RedByte);   // clamped to 1.0 → 255
            Assert.Equal(0,   c.GreenByte); // clamped to 0.0 → 0
            Assert.Equal(255, c.AlphaByte); // default alpha 1.0 → 255
        }

        [Fact]
        public void FromValues_DefaultAlphaIsOne()
        {
            var c = Rgba.FromValues(0f, 0f, 0f);
            Assert.Equal(255, c.AlphaByte);
        }

        // ── FromInts ─────────────────────────────────────────────────────────────

        [Fact]
        public void FromInts_StoresByteValues()
        {
            var c = Rgba.FromInts(100, 150, 200, 255);
            Assert.Equal(100, c.RedByte);
            Assert.Equal(150, c.GreenByte);
            Assert.Equal(200, c.BlueByte);
            Assert.Equal(255, c.AlphaByte);
        }

        [Fact]
        public void FromInts_ClampsAbove255()
        {
            var c = Rgba.FromInts(300, 0, 0);
            Assert.Equal(255, c.RedByte);
        }

        // ── equality ─────────────────────────────────────────────────────────────

        [Fact]
        public void Equals_SameValues_True()
        {
            var a = Rgba.FromInts(10, 20, 30, 255);
            var b = Rgba.FromInts(10, 20, 30, 255);
            Assert.Equal(a, b);
            Assert.True(a == b);
        }

        [Fact]
        public void Equals_DifferentChannel_False()
        {
            var a = Rgba.FromInts(10, 20, 30, 255);
            var b = Rgba.FromInts(10, 20, 31, 255);
            Assert.NotEqual(a, b);
            Assert.True(a != b);
        }

        // ── intent ───────────────────────────────────────────────────────────────

        [Fact]
        public void FromValues_IntentIsRgb()
            => Assert.Equal(ColorIntent.Rgb, Rgba.FromValues(0f, 0f, 0f).Intent);

        [Fact]
        public void FromIndex_IntentIsIndexed()
        {
            var c = Rgba.FromIndex(5);
            Assert.Equal(ColorIntent.Indexed, c.Intent);
            Assert.Equal(5, c.Slot);
        }

        [Fact]
        public void DefaultForeground_IntentIsDefault()
            => Assert.Equal(ColorIntent.Default, Rgba.DefaultForeground().Intent);

        [Fact]
        public void DefaultBackground_IntentIsDefault()
            => Assert.Equal(ColorIntent.Default, Rgba.DefaultBackground().Intent);

        // ── FromHex ──────────────────────────────────────────────────────────────

        [Fact]
        public void FromHex_SixDigit()
        {
            var c = Rgba.FromHex("#FF8000");
            Assert.Equal(255, c.RedByte);
            Assert.Equal(128, c.GreenByte);
            Assert.Equal(0,   c.BlueByte);
        }

        [Fact]
        public void FromHex_ThreeDigit_Expands()
        {
            var c = Rgba.FromHex("#F80");
            Assert.Equal(255, c.RedByte);
            Assert.Equal(136, c.GreenByte); // 0x88
            Assert.Equal(0,   c.BlueByte);
        }

        [Fact]
        public void FromHex_EightDigit_HasAlpha()
        {
            var c = Rgba.FromHex("#FF000080");
            Assert.Equal(255, c.RedByte);
            Assert.Equal(0,   c.GreenByte);
            Assert.Equal(128, c.AlphaByte);
        }

        // ── Ansi256ToRgb ─────────────────────────────────────────────────────────

        [Fact]
        public void Ansi256_Index0_IsBlack()
        {
            var c = Rgba.Ansi256ToRgb(0);
            Assert.Equal(0, c.RedByte);
            Assert.Equal(0, c.GreenByte);
            Assert.Equal(0, c.BlueByte);
        }

        [Fact]
        public void Ansi256_Index15_IsWhite()
            => Assert.Equal(255, Rgba.Ansi256ToRgb(15).RedByte);

        [Fact]
        public void Ansi256_GrayscaleRamp_Start()
        {
            var c = Rgba.Ansi256ToRgb(232);
            Assert.Equal(8, c.RedByte);
            Assert.Equal(c.RedByte, c.GreenByte);
            Assert.Equal(c.RedByte, c.BlueByte);
        }

        // ── BlendOver ────────────────────────────────────────────────────────────

        [Fact]
        public void BlendOver_FullOpacity_ReturnsSrc()
        {
            var src = Rgba.FromInts(255, 0, 0, 255);
            var dst = Rgba.FromInts(0,   0, 255, 255);
            var r   = src.BlendOver(dst);
            Assert.Equal(255, r.RedByte);
            Assert.Equal(0,   r.BlueByte);
        }

        [Fact]
        public void BlendOver_ZeroOpacity_ReturnsDst()
        {
            var src = Rgba.FromInts(255, 0, 0, 0);
            var dst = Rgba.FromInts(0,   0, 255, 255);
            var r   = src.BlendOver(dst);
            Assert.Equal(0,   r.RedByte);
            Assert.Equal(255, r.BlueByte);
        }

        [Fact]
        public void BlendOver_HalfOpacity_Interpolates()
        {
            var src = Rgba.FromInts(200, 0, 0, 128);
            var dst = Rgba.FromInts(0,   0, 0, 255);
            var r   = src.BlendOver(dst);
            Assert.True(r.RedByte > 50 && r.RedByte < 200);
        }

        // ── ToString ─────────────────────────────────────────────────────────────

        [Fact]
        public void ToString_ContainsChannels()
        {
            var s = Rgba.FromValues(1f, 0f, 0f, 1f).ToString();
            Assert.Contains("1.00", s);
            Assert.Contains("0.00", s);
        }

        // ── GetHashCode ──────────────────────────────────────────────────────────

        [Fact]
        public void GetHashCode_SameValues_SameHash()
        {
            var a = Rgba.FromInts(1, 2, 3, 4);
            var b = Rgba.FromInts(1, 2, 3, 4);
            Assert.Equal(a.GetHashCode(), b.GetHashCode());
        }
    }
}
