import { file, type BunPlugin } from "bun"
import { compile } from "svelte/compiler"

const COMPILER_OPTIONS = {
  generate: "client" as const,
  hydratable: false,
  dev: false,
  fragments: "tree" as const,
}

function getComponentName(filename: string): string {
  return (
    filename
      .split("/")
      .pop()
      ?.replace(".svelte", "")
      .split("-")
      .map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join("_") || "Component"
  )
}

function wrapWithRuntime(code: string, componentName: string, isEntryPoint: boolean): string {
  if (isEntryPoint) {
    return `
// Auto-injected by @opentui/svelte compiler
import { render as __opentui_render, installDOMShims } from "@opentui/svelte";

// Install DOM shims (entry point only)
installDOMShims();

${code}

// Auto-render entry point
if (import.meta.main) {
  __opentui_render(${componentName});
}
`.trim()
  } else {
    return `
// Auto-injected by @opentui/svelte compiler
// Imported component - no auto-render

${code}
`.trim()
  }
}

const sveltePlugin: BunPlugin = {
  name: "svelte-loader",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await file(args.path).text()

      try {
        const result = compile(source, { ...COMPILER_OPTIONS, filename: args.path })

        // Detect entry point: no importer means it wasn't imported by another module
        const isEntryPoint = !args.importer

        // Only compute component name for entry points (needed for auto-render)
        const componentName = isEntryPoint ? getComponentName(args.path) : ""

        const injected = wrapWithRuntime(result.js.code, componentName, isEntryPoint)

        return {
          contents: injected,
          loader: "js",
        }
      } catch (error) {
        console.error(`Error compiling ${args.path}:`, error)
        throw error
      }
    })
  },
}

export default sveltePlugin
