// @bun
// examples/child.svelte
import { render as __opentui_render, installDOMShims } from "@opentui/svelte"
import "svelte/internal/disclose-version"
import * as $ from "svelte/internal/client"
installDOMShims()
var root = $.from_tree([["div", null, ["div", null, " "]]])
function Child($$anchor, $$props) {
  let message = $.prop($$props, "message", 3, "Hello from Child!")
  var div = root()
  var div_1 = $.child(div)
  var text = $.child(div_1, true)
  $.reset(div_1)
  $.reset(div)
  $.template_effect(() => $.set_text(text, message()))
  $.append($$anchor, div)
}
if (import.meta.main) {
  __opentui_render(Child)
}
export { Child as default }
