import { plugin } from "bun"
import typegpu from "unplugin-typegpu/bun"

plugin(typegpu({ include: /\.ts$/ }))
