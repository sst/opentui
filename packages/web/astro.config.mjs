import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"

const copyButtonTransformer = {
  name: "copy-button",
  pre(node) {
    node.properties["data-code"] = this.source
    if (this.options?.lang) node.properties["data-language"] = this.options.lang
  },
}

export default defineConfig({
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname
        return path !== "/404/" && !path.startsWith("/lab/")
      },
    }),
  ],
  site: "https://opentui.com",
  vite: {
    server: {
      allowedHosts: true,
    },
  },
  redirects: {
    "/docs/getting-started": "/docs",
    "/docs/core-concepts/constructs": "/docs/core-concepts/renderables",
    "/docs/core-concepts/renderables-vs-constructs": "/docs/core-concepts/renderables",
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: "min-light",
        dark: "github-dark",
      },
      transformers: [copyButtonTransformer],
    },
  },
})
