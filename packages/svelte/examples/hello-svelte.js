// @bun
// examples/hello-svelte.svelte
import { render as __opentui_render2, installDOMShims as installDOMShims2 } from "@opentui/svelte"
import "svelte/internal/disclose-version"
import * as $2 from "svelte/internal/client"

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
if (false) {
}

// examples/hello-svelte.svelte
installDOMShims2()
var root2 = $2.from_tree([
  ["div", null, ["div"], " ", ["div", null, " "], " ", , " ", ["div", null, "Press Ctrl+C to exit"]],
])
function Hello_svelte($$anchor) {
  let name = "World"
  let count = $2.state(0)
  setInterval(() => {
    $2.set(count, $2.get(count) + 1)
  }, 1000)
  var div = root2()
  var div_1 = $2.child(div)
  div_1.textContent = "Hello World!"
  var div_2 = $2.sibling(div_1, 2)
  var text = $2.child(div_2)
  $2.reset(div_2)
  var node = $2.sibling(div_2, 2)
  Child(node, { message: "Child component works!" })
  $2.next(2)
  $2.reset(div)
  $2.template_effect(() => $2.set_text(text, `Count: ${$2.get(count) ?? ""}`))
  $2.append($$anchor, div)
}
if (import.meta.main) {
  __opentui_render2(Hello_svelte)
}
export { Hello_svelte as default }
