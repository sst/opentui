// Declaration-build shim: tsconfig.build maps @lexwdex-org/solid here so keymap
// can emit d.ts for its Solid entrypoint without importing framework sources.
import type { CliRenderer } from "@lexwdex-org/core"

export function useRenderer(): CliRenderer
