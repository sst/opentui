import { describe, expect, it } from "bun:test"
import { getComponentCatalogue } from "@lexwdex-org/solid/components"
import { QRCodeRenderable, registerQRCode } from "./solid.js"

describe("@lexwdex-org/qrcode/solid", () => {
  it("registers the qr_code JSX component", () => {
    const catalogue = getComponentCatalogue()
    const hadPrevious = Object.prototype.hasOwnProperty.call(catalogue, "qr_code")
    const previous = catalogue.qr_code

    try {
      delete catalogue.qr_code

      registerQRCode()

      expect(catalogue.qr_code).toBe(QRCodeRenderable)
    } finally {
      if (hadPrevious) {
        catalogue.qr_code = previous!
      } else {
        delete catalogue.qr_code
      }
    }
  })
})
