import { setupDevtoolsPlugin } from "@vue/devtools-api"
import { CliRenderEvents, LayoutEvents, type CliRenderer } from "@opentui/core"
import type { App } from "vue"
import { buildRenderableTree, getRenderableState, findRenderableById } from "./inspector"
import { setupTimeline } from "./timeline"
import { createHighlightOverlay, type HighlightController } from "./highlight"

const PLUGIN_ID = "dev.opentui.vue"
const INSPECTOR_ID = "opentui:renderables"
const COMPONENT_ATTRS_TYPE = "Element Attrs"
const SKIP_ATTR_KEYS = new Set(["ref", "key"])

function formatAttrValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "function") return "(function)"
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "object") {
    const ctorName = (value as object).constructor?.name
    if (ctorName && (ctorName.endsWith("Renderable") || ctorName === "RGBA")) {
      return `[${ctorName}]`
    }
  }
  return value
}

function isOpenTUIComponent(instance: unknown): boolean {
  const name = ((instance as Record<string, unknown>)?.type as Record<string, unknown>)?.name
  if (typeof name !== "string") return false
  const lowerName = name.toLowerCase()
  return lowerName.endsWith("renderable") || lowerName === "portal"
}

export interface OpenTUIDevtoolsSettings {
  autoRefresh: boolean
  showHiddenNodes: boolean
  highlightOnSelect: boolean
}

const DEFAULT_SETTINGS: OpenTUIDevtoolsSettings = {
  autoRefresh: true,
  showHiddenNodes: true,
  highlightOnSelect: true,
}

interface DevtoolsApi {
  sendInspectorTree(inspectorId: string): void
  sendInspectorState(inspectorId: string): void
  selectInspectorNode(inspectorId: string, nodeId: string): void
  getSettings?(): Record<string, unknown>
}

export async function initializeDevtools() {
  const shouldEnableDevtools = process.env["NODE_ENV"] === "development" || process.env["VUE_DEVTOOLS"] === "true"

  let devtoolsCleanup: (() => void) | null = null
  if (shouldEnableDevtools) {
    try {
      const { connectToDevTools } = await import("./connect")
      const connect = process.env["OPENTUI_DEVTOOLS_DISABLE_SOCKET"] !== "true"
      const host = process.env["OPENTUI_DEVTOOLS_HOST"] || "http://localhost"
      const port = parseInt(process.env["OPENTUI_DEVTOOLS_PORT"] || "8098", 10)
      const waitForConnect = process.env["OPENTUI_DEVTOOLS_WAIT_FOR_CONNECT"] !== "false"
      devtoolsCleanup = await connectToDevTools(host, port, { connect, waitForConnect })
    } catch (e) {
      if (process.env["NODE_ENV"] === "development") {
        console.warn("[OpenTUI] Failed to initialize DevTools hook:", e)
      }
    }
  }

  return { shouldEnableDevtools, devtoolsCleanup }
}

export function setupOpenTUIDevtools(app: App, cliRenderer: CliRenderer): void {
  setupDevtoolsPlugin(
    {
      id: PLUGIN_ID,
      label: "OpenTUI",
      packageName: "@opentui/vue",
      homepage: "https://github.com/sst/opentui",
      app,
      enableEarlyProxy: true,
      componentStateTypes: ["OpenTUI Renderable", COMPONENT_ATTRS_TYPE],
      settings: {
        autoRefresh: {
          label: "Auto Refresh Tree",
          type: "boolean",
          defaultValue: DEFAULT_SETTINGS.autoRefresh,
          description: "Automatically refresh the tree when layout changes",
        },
        showHiddenNodes: {
          label: "Show Hidden Nodes",
          type: "boolean",
          defaultValue: DEFAULT_SETTINGS.showHiddenNodes,
          description: "Show nodes that are not visible in the tree",
        },
        highlightOnSelect: {
          label: "Highlight on Select",
          type: "boolean",
          defaultValue: DEFAULT_SETTINGS.highlightOnSelect,
          description: "Highlight the selected element in the terminal",
        },
      },
    },
    (api) => {
      const devApi = api as unknown as DevtoolsApi
      const cleanups: (() => void)[] = []
      const addCleanup = (fn: () => void) => cleanups.push(fn)

      const getSettings = (): OpenTUIDevtoolsSettings => {
        const s = devApi.getSettings?.() ?? {}
        return {
          autoRefresh: (s.autoRefresh as boolean) ?? DEFAULT_SETTINGS.autoRefresh,
          showHiddenNodes: (s.showHiddenNodes as boolean) ?? DEFAULT_SETTINGS.showHiddenNodes,
          highlightOnSelect: (s.highlightOnSelect as boolean) ?? DEFAULT_SETTINGS.highlightOnSelect,
        }
      }

      const refresh = () => {
        devApi.sendInspectorTree(INSPECTOR_ID)
        devApi.sendInspectorState(INSPECTOR_ID)
      }

      const refreshIfAutoEnabled = () => {
        if (getSettings().autoRefresh) refresh()
      }

      const highlightController: HighlightController = createHighlightOverlay(cliRenderer)
      addCleanup(() => highlightController.destroy())

      addCleanup(setupTimeline(api, cliRenderer))

      api.addInspector({
        id: INSPECTOR_ID,
        label: "OpenTUI Renderables",
        icon: "account_tree",
        treeFilterPlaceholder: "Search by ID or type...",
        actions: [
          {
            icon: "gps_fixed",
            tooltip: "Pick element in terminal",
            action: () => {
              highlightController.setInspectMode(true)
              const previousHandler = cliRenderer.root.onMouse
              cliRenderer.root.onMouse = (event) => {
                previousHandler?.(event)
                if (event.type === "up" && event.target) {
                  highlightController.setInspectMode(false)
                  highlightController.highlight(event.target)
                  devApi.selectInspectorNode(INSPECTOR_ID, event.target.id)
                  cliRenderer.root.onMouse = previousHandler
                }
              }
            },
          },
          {
            icon: "highlight_off",
            tooltip: "Clear highlight",
            action: () => {
              highlightController.clear()
            },
          },
        ],
        nodeActions: [
          {
            icon: "visibility",
            tooltip: "Toggle visibility",
            action: (nodeId: string) => {
              const node = findRenderableById(cliRenderer, nodeId)
              if (node) {
                node.visible = !node.visible
                refresh()
              }
            },
          },
          {
            icon: "center_focus_strong",
            tooltip: "Focus element",
            action: (nodeId: string) => {
              const node = findRenderableById(cliRenderer, nodeId)
              if (node?.focusable) {
                node.focus()
                refresh()
              }
            },
          },
          {
            icon: "highlight",
            tooltip: "Highlight element",
            action: (nodeId: string) => {
              highlightController.highlight(findRenderableById(cliRenderer, nodeId) ?? null)
            },
          },
        ],
      })

      api.on.getInspectorTree((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID) {
          highlightController.clear()
          return
        }
        if (cliRenderer.root) {
          payload.rootNodes = [buildRenderableTree(cliRenderer.root, payload.filter)]
        }
      })

      api.on.getInspectorState((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID) {
          highlightController.clear()
          return
        }
        const renderable = findRenderableById(cliRenderer, payload.nodeId)
        if (!renderable) {
          highlightController.clear()
          return
        }

        payload.state = getRenderableState(renderable)
        if (getSettings().highlightOnSelect) {
          highlightController.highlight(renderable)
        }
      })

      api.on.editInspectorState((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID || payload.path.length === 0) return
        const renderable = findRenderableById(cliRenderer, payload.nodeId)
        const propName = payload.path[payload.path.length - 1]
        if (renderable && propName && propName in renderable) {
          ;(renderable as unknown as Record<string, unknown>)[propName] = payload.state.value
          refresh()
        }
      })

      const root = cliRenderer.root
      const layoutEvents = [LayoutEvents.LAYOUT_CHANGED, LayoutEvents.ADDED, LayoutEvents.REMOVED]
      layoutEvents.forEach((event) => {
        root.on(event, refreshIfAutoEnabled)
        addCleanup(() => root.off(event, refreshIfAutoEnabled))
      })

      api.on.setPluginSettings?.((payload) => {
        if (payload.pluginId === PLUGIN_ID) refresh()
      })

      api.on.inspectComponent((payload) => {
        const instance = payload.componentInstance
        if (!instance?.attrs || !isOpenTUIComponent(instance)) return

        const attrs = instance.attrs as Record<string, unknown>
        const attrKeys = Object.keys(attrs)
        if (attrKeys.length === 0) return

        for (const key of attrKeys) {
          if (key.startsWith("on") || SKIP_ATTR_KEYS.has(key)) continue

          payload.instanceData.state.push({
            type: COMPONENT_ATTRS_TYPE,
            key,
            value: formatAttrValue(attrs[key]),
            editable: false,
          })
        }
      })

      cliRenderer.once(CliRenderEvents.DESTROY, () => {
        cleanups.forEach((fn) => fn())
        cleanups.length = 0
      })
    },
  )
}

export { buildRenderableTree, getRenderableState, findRenderableById } from "./inspector"
export { createHighlightOverlay, type HighlightController } from "./highlight"
export { TIMELINE_RENDER, TIMELINE_LAYOUT, TIMELINE_EVENTS } from "./timeline"
