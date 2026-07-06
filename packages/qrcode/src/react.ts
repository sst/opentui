import { extend } from "@lexwdex-org/react"
import { QRCodeRenderable } from "./renderables/QRCode.js"

declare module "@lexwdex-org/react" {
  interface OpenTUIComponents {
    "qr-code": typeof QRCodeRenderable
  }
}

export function registerQRCode(): void {
  extend({ "qr-code": QRCodeRenderable })
}

export * from "./index.js"
