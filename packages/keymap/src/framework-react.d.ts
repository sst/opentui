// Declaration-build shim: tsconfig.build maps @lexwdex-org/react here so keymap
// can emit d.ts for its React entrypoint without importing framework sources.
import type { CliRenderer } from "@lexwdex-org/core"

export function useRenderer(): CliRenderer
