import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import solid from "babel-preset-solid"
import { defineConfig } from "vitest/config"

const require = createRequire(import.meta.url)

const sourcePath = (path: string): string => {
  const searchIndex = path.indexOf("?")
  const hashIndex = path.indexOf("#")
  const end = [searchIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return end === undefined ? path : path.slice(0, end)
}

const opentuiSolidTransform = () => ({
  name: "opentui-solid-vitest-transform",
  enforce: "pre" as const,
  async transform(code: string, id: string) {
    const path = sourcePath(id)
    if (!/\.(tsx|jsx)(?:[?#].*)?$/.test(id)) {
      return null
    }

    const transformed = await transformAsync(code, {
      filename: path,
      configFile: false,
      babelrc: false,
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
      code: transformed?.code ?? code,
      map: transformed?.map ?? null,
    }
  },
})

export default defineConfig({
  plugins: [opentuiSolidTransform()],
  resolve: {
    alias: [
      {
        find: /^bun:test$/,
        replacement: fileURLToPath(new URL("../core/src/compat/test.ts", import.meta.url)),
      },
      {
        find: /^solid-js\/store$/,
        replacement: require.resolve("solid-js/store/dist/store.js"),
      },
      {
        find: /^solid-js$/,
        replacement: require.resolve("solid-js/dist/solid.js"),
      },
    ],
  },
  ssr: {
    noExternal: ["solid-js", /^solid-js\//],
  },
  test: {
    environment: "node",
    resolveSnapshotPath: (testPath, ext) =>
      join(dirname(testPath), "__snapshots__", `${basename(testPath)}.nodejs${ext}`),
    root: "tests",
  },
})
