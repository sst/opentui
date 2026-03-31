import { type ReactPlugin } from "@opentui/react"
import { ExternalSidebarPanel, ExternalStatusCard } from "./slot-components.tsx"

export type ExternalPluginSlots = {
  statusbar: { label: string }
  sidebar: { section: string }
}

export type ExternalPluginContext = {
  appName: string
  version: string
}

const CAPABILITIES = ["statusbar extension", "sidebar extension", "external jsx components"]

export function loadExternalPlugin(): ReactPlugin<ExternalPluginSlots, ExternalPluginContext> {
  return {
    id: "external-jsx-plugin",
    order: 20,
    slots: {
      statusbar(ctx, props) {
        return <ExternalStatusCard host={ctx.appName} label={props.label} version={ctx.version} />
      },
      sidebar(_ctx, props) {
        return (
          <box flexDirection="column">
            <ExternalSidebarPanel section={props.section} capabilities={CAPABILITIES} />
            <box marginTop={1} border borderStyle="single" borderColor="#334155" flexDirection="column" padding={1}>
              <text fg="#cbd5e1">External plugin UI loaded from disk</text>
              <text fg="#93c5fd">No in-bundle React plugin code required.</text>
            </box>
          </box>
        )
      },
    },
  }
}
