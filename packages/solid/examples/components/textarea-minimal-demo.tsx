import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useTextareaKeybindings } from "./textarea-keybindings"

export function TextareaMinimalDemo() {
  const bindings = useTextareaKeybindings()
  let textarea: TextareaRenderable | undefined

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg="#E8EDF2">
          Minimal Textarea
        </text>
        <text fg="#8B98A5">esc</text>
      </box>
      <box paddingLeft={1} gap={1}>
        <box>
          <text fg="#E8EDF2">Custom answer</text>
        </box>
        <box>
          <box flexDirection="row">
            <box paddingRight={1}>
              <text fg="#8B98A5">1.</text>
            </box>
            <box>
              <text fg="#E8EDF2">Type your own answer</text>
            </box>
          </box>
          <box paddingLeft={3}>
            <textarea
              ref={(val: TextareaRenderable) => {
                textarea = val
                queueMicrotask(() => {
                  val.focus()
                  val.gotoLineEnd()
                })
              }}
              initialValue=""
              placeholder="Type your own answer"
              textColor="#E8EDF2"
              focusedTextColor="#E8EDF2"
              cursorColor="#86B7FF"
              keyBindings={bindings()}
            />
          </box>
        </box>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <text fg="#E8EDF2">
          enter <span style={{ fg: "#8B98A5" }}>submit</span>
        </text>
      </box>
    </box>
  )
}
