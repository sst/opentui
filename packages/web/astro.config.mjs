import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"

const copyButtonTransformer = {
  name: "copy-button",
  pre(node) {
    node.properties["data-code"] = this.source
  },
}

// Monochrome highlighting: identifiers plain, keywords bold, literals gray,
// comments fainter gray italic. Structure through weight and shade, not hue.
function grayscaleTheme({ name, type, foreground, background, literal, comment }) {
  return {
    name,
    type,
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
    },
    settings: [
      { settings: { foreground, background } },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: comment, fontStyle: "italic" },
      },
      {
        scope: ["string", "constant.numeric", "constant.language", "constant.character.escape"],
        settings: { foreground: literal },
      },
      {
        scope: ["keyword.control", "keyword.other", "keyword.declaration", "storage.type", "storage.modifier"],
        settings: { fontStyle: "bold" },
      },
    ],
  }
}

const codeLight = grayscaleTheme({
  name: "opentui-light",
  type: "light",
  foreground: "#000000",
  background: "#ffffff",
  literal: "#4a4a4a",
  comment: "#767676",
})

const codeDark = grayscaleTheme({
  name: "opentui-dark",
  type: "dark",
  foreground: "#ededed",
  background: "#000000",
  literal: "#b0b0b0",
  comment: "#8a8a8a",
})

// Blue tint: the grayscale ramp shifted onto the ink hue.
const codeBlue = grayscaleTheme({
  name: "opentui-blue",
  type: "light",
  foreground: "#1131e9",
  background: "#ffffff",
  literal: "#475ac2",
  comment: "#7783c5",
})

export default defineConfig({
  integrations: [mdx()],
  site: "https://opentui.com",
  redirects: {
    "/docs": "/docs/getting-started",
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: codeLight,
        dark: codeDark,
        blue: codeBlue,
      },
      transformers: [copyButtonTransformer],
    },
  },
})
