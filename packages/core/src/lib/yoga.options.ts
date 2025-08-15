import {
  BoxSizing,
  Align,
  Dimension,
  Direction,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  LogLevel,
  MeasureMode,
  NodeType,
  Overflow,
  PositionType,
  Unit,
  Wrap,
} from "yoga-layout"

export function parseAlign(value: string): Align {
  switch (value.toLowerCase()) {
    case "auto":
      return Align.Auto
    case "flex-start":
      return Align.FlexStart
    case "center":
      return Align.Center
    case "flex-end":
      return Align.FlexEnd
    case "stretch":
      return Align.Stretch
    case "baseline":
      return Align.Baseline
    case "space-between":
      return Align.SpaceBetween
    case "space-around":
      return Align.SpaceAround
    case "space-evenly":
      return Align.SpaceEvenly
    default:
      throw new Error(`Unknown Align value: ${value}`)
  }
}

export function parseBoxSizing(value: string): BoxSizing {
  switch (value.toLowerCase()) {
    case "border-box":
      return BoxSizing.BorderBox
    case "content-box":
      return BoxSizing.ContentBox
    default:
      throw new Error(`Unknown BoxSizing value: ${value}`)
  }
}

export function parseDimension(value: string): Dimension {
  switch (value.toLowerCase()) {
    case "width":
      return Dimension.Width
    case "height":
      return Dimension.Height
    default:
      throw new Error(`Unknown Dimension value: ${value}`)
  }
}

export function parseDirection(value: string): Direction {
  switch (value.toLowerCase()) {
    case "inherit":
      return Direction.Inherit
    case "ltr":
      return Direction.LTR
    case "rtl":
      return Direction.RTL
    default:
      throw new Error(`Unknown Direction value: ${value}`)
  }
}

export function parseDisplay(value: string): Display {
  switch (value.toLowerCase()) {
    case "flex":
      return Display.Flex
    case "none":
      return Display.None
    case "contents":
      return Display.Contents
    default:
      throw new Error(`Unknown Display value: ${value}`)
  }
}

export function parseEdge(value: string): Edge {
  switch (value.toLowerCase()) {
    case "left":
      return Edge.Left
    case "top":
      return Edge.Top
    case "right":
      return Edge.Right
    case "bottom":
      return Edge.Bottom
    case "start":
      return Edge.Start
    case "end":
      return Edge.End
    case "horizontal":
      return Edge.Horizontal
    case "vertical":
      return Edge.Vertical
    case "all":
      return Edge.All
    default:
      throw new Error(`Unknown Edge value: ${value}`)
  }
}

export function parseFlexDirection(value: string): FlexDirection {
  switch (value.toLowerCase()) {
    case "column":
      return FlexDirection.Column
    case "column-reverse":
      return FlexDirection.ColumnReverse
    case "row":
      return FlexDirection.Row
    case "row-reverse":
      return FlexDirection.RowReverse
    default:
      throw new Error(`Unknown FlexDirection value: ${value}`)
  }
}

export function parseGutter(value: string): Gutter {
  switch (value.toLowerCase()) {
    case "column":
      return Gutter.Column
    case "row":
      return Gutter.Row
    case "all":
      return Gutter.All
    default:
      throw new Error(`Unknown Gutter value: ${value}`)
  }
}

export function parseJustify(value: string): Justify {
  switch (value.toLowerCase()) {
    case "flex-start":
      return Justify.FlexStart
    case "center":
      return Justify.Center
    case "flex-end":
      return Justify.FlexEnd
    case "space-between":
      return Justify.SpaceBetween
    case "space-around":
      return Justify.SpaceAround
    case "space-evenly":
      return Justify.SpaceEvenly
    default:
      throw new Error(`Unknown Justify value: ${value}`)
  }
}

export function parseLogLevel(value: string): LogLevel {
  switch (value.toLowerCase()) {
    case "error":
      return LogLevel.Error
    case "warn":
      return LogLevel.Warn
    case "info":
      return LogLevel.Info
    case "debug":
      return LogLevel.Debug
    case "verbose":
      return LogLevel.Verbose
    case "fatal":
      return LogLevel.Fatal
    default:
      throw new Error(`Unknown LogLevel value: ${value}`)
  }
}

export function parseMeasureMode(value: string): MeasureMode {
  switch (value.toLowerCase()) {
    case "undefined":
      return MeasureMode.Undefined
    case "exactly":
      return MeasureMode.Exactly
    case "at-most":
      return MeasureMode.AtMost
    default:
      throw new Error(`Unknown MeasureMode value: ${value}`)
  }
}

export function parseNodeType(value: string): NodeType {
  switch (value.toLowerCase()) {
    case "default":
      return NodeType.Default
    case "text":
      return NodeType.Text
    default:
      throw new Error(`Unknown NodeType value: ${value}`)
  }
}

export function parseOverflow(value: string): Overflow {
  switch (value.toLowerCase()) {
    case "visible":
      return Overflow.Visible
    case "hidden":
      return Overflow.Hidden
    case "scroll":
      return Overflow.Scroll
    default:
      throw new Error(`Unknown Overflow value: ${value}`)
  }
}

export function parsePositionType(value: string): PositionType {
  switch (value.toLowerCase()) {
    case "static":
      return PositionType.Static
    case "relative":
      return PositionType.Relative
    case "absolute":
      return PositionType.Absolute
    default:
      throw new Error(`Unknown PositionType value: ${value}`)
  }
}

export function parseUnit(value: string): Unit {
  switch (value.toLowerCase()) {
    case "undefined":
      return Unit.Undefined
    case "point":
      return Unit.Point
    case "percent":
      return Unit.Percent
    case "auto":
      return Unit.Auto
    default:
      throw new Error(`Unknown Unit value: ${value}`)
  }
}

export function parseWrap(value: string): Wrap {
  switch (value.toLowerCase()) {
    case "no-wrap":
      return Wrap.NoWrap
    case "wrap":
      return Wrap.Wrap
    case "wrap-reverse":
      return Wrap.WrapReverse
    default:
      throw new Error(`Unknown Wrap value: ${value}`)
  }
}
