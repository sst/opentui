using System;

namespace OpenTui.Core.Buffer
{
    public enum BorderStyle { Single, Double, Rounded, Heavy }

    [Flags]
    public enum BorderSides { None = 0, Top = 1, Right = 2, Bottom = 4, Left = 8, All = 15 }

    public enum TextAlignment { Left, Center, Right }

    public static class BorderChars
    {
        // Index layout: 0=topLeft, 1=topRight, 2=bottomLeft, 3=bottomRight,
        //               4=horizontal, 5=vertical, 6=topT, 7=bottomT, 8=leftT, 9=rightT, 10=cross
        public static readonly int[] Single  = { '┌','┐','└','┘','─','│','┬','┴','├','┤','┼' };
        public static readonly int[] Double  = { '╔','╗','╚','╝','═','║','╦','╩','╠','╣','╬' };
        public static readonly int[] Rounded = { '╭','╮','╰','╯','─','│','┬','┴','├','┤','┼' };
        public static readonly int[] Heavy   = { '┏','┓','┗','┛','━','┃','┳','┻','┣','┫','╋' };

        public static int[] GetChars(BorderStyle style) => style switch
        {
            BorderStyle.Double  => Double,
            BorderStyle.Rounded => Rounded,
            BorderStyle.Heavy   => Heavy,
            _                   => Single,
        };
    }
}
