import type { Renderable, CliRenderer } from "@opentui/core"
import { RGBA, rgbToHex, Yoga, TextRenderable, BoxRenderable, SelectRenderable } from "@opentui/core"
import { TAG_COLORS } from "./theme"
import { CommentNode, WhiteSpaceNode } from "../nodes"
import { GhostTextRenderable } from "../noOps"

const { Edge } = Yoga

const isTextRenderable = (r: Renderable): r is TextRenderable => r instanceof TextRenderable

const isBoxRenderable = (r: Renderable): r is BoxRenderable => r instanceof BoxRenderable

const isSelectRenderable = (r: Renderable): r is SelectRenderable => r instanceof SelectRenderable

interface CustomInspectorNode {
  id: string
  label: string
  children?: CustomInspectorNode[]
  tags?: InspectorNodeTag[]
}

interface InspectorNodeTag {
  label: string
  textColor: number
  backgroundColor: number
  tooltip?: string
}

interface StateField {
  key: string
  value: unknown
  editable?: boolean
}

export interface CustomInspectorState {
  [section: string]: StateField[]
}

function getDisplayName(renderable: Renderable): string {
  const name = renderable.constructor.name
  const baseName = name.endsWith("Renderable") ? name.slice(0, -10) : name
  return baseName.toLowerCase()
}

function matchesFilter(renderable: Renderable, filter: string): boolean {
  const lowerFilter = filter.toLowerCase()
  const displayName = getDisplayName(renderable).toLowerCase()
  const id = renderable.id.toLowerCase()
  return displayName.includes(lowerFilter) || id.includes(lowerFilter)
}

function getFlexDirectionString(renderable: Renderable): string {
  const yogaNode = renderable.getLayoutNode()
  const direction = yogaNode.getFlexDirection()

  const FLEX_DIRECTION_MAP: Record<number, string> = {
    0: "column",
    1: "column-reverse",
    2: "row",
    3: "row-reverse",
  }

  return FLEX_DIRECTION_MAP[direction] ?? "column"
}

function formatColor(color: RGBA | undefined): string {
  if (!color) return "transparent"
  if (color.a === 0) return "transparent"
  return rgbToHex(color)
}

function formatPadding(renderable: Renderable): string {
  const yogaNode = renderable.getLayoutNode()
  const top = yogaNode.getComputedPadding(Edge.Top)
  const right = yogaNode.getComputedPadding(Edge.Right)
  const bottom = yogaNode.getComputedPadding(Edge.Bottom)
  const left = yogaNode.getComputedPadding(Edge.Left)

  if (top === right && right === bottom && bottom === left) {
    return String(top)
  }
  return `${top} ${right} ${bottom} ${left}`
}

function formatMargin(renderable: Renderable): string {
  const yogaNode = renderable.getLayoutNode()
  const top = yogaNode.getComputedMargin(Edge.Top)
  const right = yogaNode.getComputedMargin(Edge.Right)
  const bottom = yogaNode.getComputedMargin(Edge.Bottom)
  const left = yogaNode.getComputedMargin(Edge.Left)

  if (top === right && right === bottom && bottom === left) {
    return String(top)
  }
  return `${top} ${right} ${bottom} ${left}`
}

function formatBorder(renderable: Renderable): string {
  const yogaNode = renderable.getLayoutNode()
  const top = yogaNode.getComputedBorder(Edge.Top)
  const right = yogaNode.getComputedBorder(Edge.Right)
  const bottom = yogaNode.getComputedBorder(Edge.Bottom)
  const left = yogaNode.getComputedBorder(Edge.Left)

  if (top === right && right === bottom && bottom === left) {
    return String(top)
  }
  return `${top} ${right} ${bottom} ${left}`
}

const isInternalNode = (r: Renderable): boolean =>
  r instanceof CommentNode || r instanceof WhiteSpaceNode || r instanceof GhostTextRenderable

export function buildRenderableTree(renderable: Renderable, filter?: string): CustomInspectorNode {
  const displayName = getDisplayName(renderable)
  const children = renderable.getChildren() as Renderable[]

  const tags: CustomInspectorNode["tags"] = [
    {
      label: renderable.id,
      ...TAG_COLORS.id,
    },
    {
      label: `${renderable.width}x${renderable.height}`,
      ...TAG_COLORS.size,
    },
  ]

  if (!renderable.visible) {
    tags.push({
      label: "hidden",
      ...TAG_COLORS.hidden,
    })
  }

  if (renderable.focused) {
    tags.push({
      label: "focused",
      ...TAG_COLORS.focused,
    })
  }

  const filteredChildren: CustomInspectorNode[] = []
  for (const child of children) {
    if (isInternalNode(child)) continue

    const childNode = buildRenderableTree(child, filter)
    const childMatchesFilter = !filter || matchesFilter(child, filter) || (childNode.children?.length ?? 0) > 0
    if (childMatchesFilter) {
      filteredChildren.push(childNode)
    }
  }

  const matchesSelf = !filter || matchesFilter(renderable, filter)
  const hasMatchingChildren = filteredChildren.length > 0

  return {
    id: renderable.id,
    label: displayName,
    tags,
    children: matchesSelf || hasMatchingChildren ? filteredChildren : [],
  }
}

export function getRenderableState(renderable: Renderable): CustomInspectorState {
  const yogaNode = renderable.getLayoutNode()
  const children = renderable.getChildren()

  const state: CustomInspectorState = {
    Layout: [
      { key: "id", value: renderable.id, editable: false },
      { key: "x", value: renderable.x, editable: false },
      { key: "y", value: renderable.y, editable: false },
      { key: "width", value: renderable.width, editable: true },
      { key: "height", value: renderable.height, editable: true },
      { key: "zIndex", value: renderable.zIndex, editable: true },
      { key: "padding", value: formatPadding(renderable), editable: false },
      { key: "margin", value: formatMargin(renderable), editable: false },
      { key: "border", value: formatBorder(renderable), editable: false },
    ],

    Visibility: [
      { key: "visible", value: renderable.visible, editable: true },
      { key: "opacity", value: renderable.opacity, editable: true },
    ],

    "Flex Layout": [
      { key: "flexDirection", value: getFlexDirectionString(renderable), editable: false },
      { key: "flexGrow", value: yogaNode.getFlexGrow(), editable: false },
      { key: "flexShrink", value: yogaNode.getFlexShrink(), editable: false },
    ],

    State: [
      { key: "focused", value: renderable.focused, editable: false },
      { key: "focusable", value: renderable.focusable, editable: false },
      { key: "isDirty", value: renderable.isDirty, editable: false },
      { key: "isDestroyed", value: renderable.isDestroyed, editable: false },
    ],

    Children: [
      { key: "count", value: children.length, editable: false },
      { key: "childIds", value: children.map((child) => child.id), editable: false },
    ],
  }

  if (isTextRenderable(renderable)) {
    state["Content"] = [{ key: "text", value: renderable.plainText, editable: false }]

    state["Text Styles"] = [
      { key: "fg", value: formatColor(renderable.fg), editable: false },
      { key: "bg", value: formatColor(renderable.bg), editable: false },
      { key: "wrapMode", value: renderable.wrapMode, editable: false },
      { key: "lineCount", value: renderable.lineCount, editable: false },
      { key: "selectable", value: renderable.selectable, editable: false },
    ]
  }

  if (isBoxRenderable(renderable)) {
    state["Box Styles"] = [
      { key: "backgroundColor", value: formatColor(renderable.backgroundColor), editable: false },
      { key: "borderStyle", value: renderable.borderStyle, editable: false },
      { key: "borderColor", value: formatColor(renderable.borderColor), editable: false },
      { key: "focusedBorderColor", value: formatColor(renderable.focusedBorderColor), editable: false },
      { key: "title", value: renderable.title ?? "(none)", editable: false },
      { key: "titleAlignment", value: renderable.titleAlignment, editable: false },
    ]
  }

  if (isSelectRenderable(renderable)) {
    const selectedOption = renderable.getSelectedOption()
    state.State!.push(
      { key: "value", value: selectedOption ? selectedOption.name : null, editable: false },
      { key: "selectedIndex", value: renderable.getSelectedIndex(), editable: false },
      { key: "optionData", value: selectedOption ?? null, editable: false },
      { key: "optionsCount", value: renderable.options.length, editable: false },
      { key: "wrapSelection", value: renderable.wrapSelection, editable: false },
      { key: "showDescription", value: renderable.showDescription, editable: false },
      { key: "showScrollIndicator", value: renderable.showScrollIndicator, editable: false },
    )
  }

  return state
}

export function findRenderableById(cliRenderer: CliRenderer, id: string): Renderable | undefined {
  if (cliRenderer.root.id === id) {
    return cliRenderer.root
  }
  return cliRenderer.root.findDescendantById(id)
}
