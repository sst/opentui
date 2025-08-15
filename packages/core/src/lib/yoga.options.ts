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

export type AlignString = "auto" | "flex-start" | "center" | "flex-end" | "stretch" | "baseline" | "space-between" | "space-around" | "space-evenly"
export type BoxSizingString = "border-box" | "content-box"
export type DimensionString = "width" | "height"
export type DirectionString = "inherit" | "ltr" | "rtl"
export type DisplayString = "flex" | "none" | "contents"
export type EdgeString = "left" | "top" | "right" | "bottom" | "start" | "end" | "horizontal" | "vertical" | "all"
export type FlexDirectionString = "column" | "column-reverse" | "row" | "row-reverse"
export type GutterString = "column" | "row" | "all"
export type JustifyString = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly"
export type LogLevelString = "error" | "warn" | "info" | "debug" | "verbose" | "fatal"
export type MeasureModeString = "undefined" | "exactly" | "at-most"
export type NodeTypeString = "default" | "text"
export type OverflowString = "visible" | "hidden" | "scroll"
export type PositionTypeString = "static" | "relative" | "absolute"
export type UnitString = "undefined" | "point" | "percent" | "auto"
export type WrapString = "no-wrap" | "wrap" | "wrap-reverse"

export function parseAlign(value: AlignString): Align {
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

export function parseBoxSizing(value: BoxSizingString): BoxSizing {
  switch (value.toLowerCase()) {
    case "border-box":
      return BoxSizing.BorderBox
    case "content-box":
      return BoxSizing.ContentBox
    default:
      throw new Error(`Unknown BoxSizing value: ${value}`)
  }
}

export function parseDimension(value: DimensionString): Dimension {
  switch (value.toLowerCase()) {
    case "width":
      return Dimension.Width
    case "height":
      return Dimension.Height
    default:
      throw new Error(`Unknown Dimension value: ${value}`)
  }
}

export function parseDirection(value: DirectionString): Direction {
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

export function parseDisplay(value: DisplayString): Display {
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

export function parseEdge(value: EdgeString): Edge {
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

export function parseFlexDirection(value: FlexDirectionString): FlexDirection {
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

export function parseGutter(value: GutterString): Gutter {
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

export function parseJustify(value: JustifyString): Justify {
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

export function parseLogLevel(value: LogLevelString): LogLevel {
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

export function parseMeasureMode(value: MeasureModeString): MeasureMode {
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

export function parseNodeType(value: NodeTypeString): NodeType {
  switch (value.toLowerCase()) {
    case "default":
      return NodeType.Default
    case "text":
      return NodeType.Text
    default:
      throw new Error(`Unknown NodeType value: ${value}`)
  }
}

export function parseOverflow(value: OverflowString): Overflow {
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

export function parsePositionType(value: PositionTypeString): PositionType {
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

export function parseUnit(value: UnitString): Unit {
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

export function parseWrap(value: WrapString): Wrap {
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
