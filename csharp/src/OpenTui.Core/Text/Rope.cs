using System;
using System.Text;

namespace OpenTui.Core.Text
{
    // ── leaf / branch nodes ───────────────────────────────────────────────────────

    internal abstract class RopeNode
    {
        public abstract int    Length  { get; }
        public abstract string GetText();
        public abstract string Slice(int start, int end);
        /// <summary>Split the node at <paramref name="index"/> into (left, right) leaves.</summary>
        public abstract (RopeNode Left, RopeNode Right) Split(int index);
    }

    internal sealed class RopeLeaf : RopeNode
    {
        private readonly string _v;
        public RopeLeaf(string value) { _v = value; }
        public override int    Length  => _v.Length;
        public override string GetText() => _v;
        public override string Slice(int s, int e) => _v[Math.Max(0, s)..Math.Min(_v.Length, e)];
        public override (RopeNode, RopeNode) Split(int index)
        {
            index = Math.Clamp(index, 0, _v.Length);
            return (new RopeLeaf(_v[..index]), new RopeLeaf(_v[index..]));
        }
    }

    internal sealed class RopeBranch : RopeNode
    {
        private readonly RopeNode _left, _right;
        private readonly int      _len;
        public RopeBranch(RopeNode left, RopeNode right) { _left = left; _right = right; _len = left.Length + right.Length; }
        public override int    Length  => _len;
        public override string GetText() => _left.GetText() + _right.GetText();
        public override string Slice(int s, int e)
        {
            int ll = _left.Length;
            if (e <= ll) return _left.Slice(s, e);
            if (s >= ll) return _right.Slice(s - ll, e - ll);
            return _left.Slice(s, ll) + _right.Slice(0, e - ll);
        }
        public override (RopeNode, RopeNode) Split(int index)
        {
            int ll = _left.Length;
            if (index <= ll)
            {
                var (ll2, lr2) = _left.Split(index);
                return (ll2, new RopeBranch(lr2, _right));
            }
            var (rl2, rr2) = _right.Split(index - ll);
            return (new RopeBranch(_left, rl2), rr2);
        }
    }

    // ── public Rope ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Persistent (copy-on-write) rope for efficient text editing.
    /// Mutating operations return a new Rope without allocating a full string copy.
    /// </summary>
    public sealed class Rope
    {
        private readonly RopeNode _root;

        public int Length => _root.Length;

        public Rope(string text = "") { _root = new RopeLeaf(text); }
        private Rope(RopeNode root)  { _root = root; }

        public string GetText() => _root.GetText();

        public string GetRange(int start, int end)
            => _root.Slice(Math.Clamp(start, 0, _root.Length),
                           Math.Clamp(end,   0, _root.Length));

        public Rope Insert(int index, string text)
        {
            index = Math.Clamp(index, 0, _root.Length);
            var (left, right) = _root.Split(index);
            var insert        = new RopeLeaf(text);
            return new Rope(new RopeBranch(new RopeBranch(left, insert), right));
        }

        public Rope Delete(int start, int end)
        {
            start = Math.Clamp(start, 0, _root.Length);
            end   = Math.Clamp(end,   start, _root.Length);
            var (left, _)     = _root.Split(start);
            var (_, right)    = _root.Split(end);
            return new Rope(new RopeBranch(left, right));
        }

        public Rope Replace(string text) => new Rope(text);
    }
}
