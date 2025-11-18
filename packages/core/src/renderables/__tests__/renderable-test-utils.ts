import { TextareaRenderable } from "../Textarea"
import { type TestRenderer } from "../../testing/test-renderer"
import { type TextareaOptions } from "../Textarea"

export async function createTextareaRenderable(
  renderer: TestRenderer,
  renderOnce: () => Promise<void>,
  options: TextareaOptions,
): Promise<{ textarea: TextareaRenderable; root: any }> {
  const textareaRenderable = new TextareaRenderable(renderer, { left: 0, top: 0, ...options })
  renderer.root.add(textareaRenderable)
  await renderOnce()

  return { textarea: textareaRenderable, root: renderer.root }
}
