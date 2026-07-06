import { describe, expect, it } from "bun:test"
import { getComponentCatalogue } from "@lexwdex-org/react"
import { QRCodeRenderable, registerQRCode } from "./react.js"

describe("@lexwdex-org/qrcode/react", () => {
  it("registers the qr-code JSX component", () => {
    const catalogue = getComponentCatalogue()
    const hadPrevious = Object.prototype.hasOwnProperty.call(catalogue, "qr-code")
    const previous = catalogue["qr-code"]

    try {
      delete catalogue["qr-code"]

      registerQRCode()

      expect(catalogue["qr-code"]).toBe(QRCodeRenderable)
    } finally {
      if (hadPrevious) {
        catalogue["qr-code"] = previous!
      } else {
        delete catalogue["qr-code"]
      }
    }
  })
})
