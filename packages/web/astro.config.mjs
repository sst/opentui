import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"

const copyButtonTransformer = {
  name: "copy-button",
  pre(node) {
    node.properties["data-code"] = this.source
  },
}

export default defineConfig({
  integrations: [mdx()],
  site: "https://opentui.com",
  markdown: {
    shikiConfig: {
      theme: "min-light",
      transformers: [copyButtonTransformer],
    },
  },
})
