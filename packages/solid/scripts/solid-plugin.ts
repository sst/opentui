import { transformAsync } from "@babel/core"
// @ts-expect-error - Types not important.
import ts from "@babel/preset-typescript"
// @ts-expect-error - Types not important.
import solid from "babel-preset-solid"
import { type BunPlugin } from "bun"
import {
  SOLID_SERVER_RUNTIME_FILTER,
  SOLID_STORE_SERVER_RUNTIME_FILTER,
  rewriteSolidServerRuntimePath,
  rewriteSolidStoreServerRuntimePath,
} from "./solid-plugin-paths"

const solidTransformPlugin: BunPlugin = {
  name: "bun-plugin-solid",
  setup: (build) => {
    build.onLoad({ filter: SOLID_SERVER_RUNTIME_FILTER }, async (args) => {
      const path = rewriteSolidServerRuntimePath(args.path)
      const file = Bun.file(path)
      const code = await file.text()
      return { contents: code, loader: "js" }
    })
    build.onLoad({ filter: SOLID_STORE_SERVER_RUNTIME_FILTER }, async (args) => {
      const path = rewriteSolidStoreServerRuntimePath(args.path)
      const file = Bun.file(path)
      const code = await file.text()
      return { contents: code, loader: "js" }
    })
    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const file = Bun.file(args.path)
      const code = await file.text()
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
              moduleName: "@opentui/solid",
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
