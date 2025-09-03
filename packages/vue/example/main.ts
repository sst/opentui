import { render } from "@opentui/vue"
import { extend } from "@opentui/vue"
import { ConsoleButtonRenderable } from "./CustomButtonRenderable"
import App from "./App.vue"

extend({ consoleButtonRenderable: ConsoleButtonRenderable })

render(App)
