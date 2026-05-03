using System;
using System.Collections.Generic;
using OpenTui.Core.Ansi;

namespace OpenTui.Core.Syntax
{
    /// <summary>A single named style entry in a <see cref="SyntaxStyle"/>.</summary>
    public sealed class StyleDefinition
    {
        public string         Name       { get; set; } = "";
        public Rgba?          Fg         { get; set; }
        public Rgba?          Bg         { get; set; }
        public TextAttributes Attributes { get; set; }
        public int            Priority   { get; set; }
    }

    /// <summary>
    /// Registry of named syntax styles. C# port of the Zig/TS <c>SyntaxStyle</c>.
    /// </summary>
    public sealed class SyntaxStyle
    {
        private readonly Dictionary<string, StyleDefinition> _styles =
            new(StringComparer.OrdinalIgnoreCase);

        public static SyntaxStyle Create() => new SyntaxStyle();

        public void RegisterStyle(StyleDefinition definition)
            => _styles[definition.Name] = definition;

        public StyleDefinition? GetStyle(string name)
            => _styles.TryGetValue(name, out var s) ? s : null;

        public IEnumerable<StyleDefinition> AllStyles => _styles.Values;

        /// <summary>
        /// Merge two style definitions: override wins on non-null fields,
        /// attributes are OR-ed, priority takes the maximum.
        /// </summary>
        public static StyleDefinition MergeStyles(StyleDefinition baseStyle,
                                                  StyleDefinition overrideStyle) =>
            new StyleDefinition
            {
                Name       = overrideStyle.Name,
                Fg         = overrideStyle.Fg         ?? baseStyle.Fg,
                Bg         = overrideStyle.Bg         ?? baseStyle.Bg,
                Attributes = overrideStyle.Attributes | baseStyle.Attributes,
                Priority   = Math.Max(baseStyle.Priority, overrideStyle.Priority),
            };
    }
}
