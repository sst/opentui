import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"

export default defineConfig({
  integrations: [mdx()],
  site: "https://opentui.com",
  markdown: {
    shikiConfig: {
      theme: "github-light",
    },
  },
})
