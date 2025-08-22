import { transformAsync } from "@babel/core"
// @ts-expect-error - Types not important.
import ts from "@babel/preset-typescript"
// @ts-expect-error - Types not important.
import solid from "babel-preset-solid"
import { type BunPlugin } from "bun"

const solidTransformPlugin: BunPlugin = {
  name: "bun-plugin-solid",
  setup: (build) => {
    build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises")
      const path = args.path.replace("server.js", "solid.js")
      const file = Bun.file(path);
      const code = await file.text();
      return { contents: code, loader: "js" }
    })
    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises")
      const file = Bun.file(args.path);
      const code = await file.text();
      const transforms = await transformAsync(code, {
        filename: args.path,
        // env: {
        //   development: {
        //     plugins: [["solid-refresh/babel", { "bundler": "esm" }]],
        //   },
        // },
        // plugins: [["solid-refresh/babel", { bundler: "esm" }]],
        presets: [
          [
            solid,
            {
              moduleName: "@opentui/solid/reconciler",
              generate: "universal",
            },
          ],
          [ts],
        ],
      })
      return {
        contents: transforms?.code ?? "",
        loader: "js",
      }
    })
  },
}

export default solidTransformPlugin
