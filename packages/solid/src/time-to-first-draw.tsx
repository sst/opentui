import { TimeToFirstDrawRenderable } from "@lexwdex-org/core"
import { extend } from "./elements/index.js"
import type { ExtendedComponentProps } from "./types/elements.js"

declare module "@lexwdex-org/solid" {
  interface OpenTUIComponents {
    time_to_first_draw: typeof TimeToFirstDrawRenderable
  }
}

extend({ time_to_first_draw: TimeToFirstDrawRenderable })

export type TimeToFirstDrawProps = ExtendedComponentProps<typeof TimeToFirstDrawRenderable>

export const TimeToFirstDraw = (props: TimeToFirstDrawProps) => {
  return <time_to_first_draw {...props} />
}
