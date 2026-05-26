import { BoxRenderable, CliRenderer, RGBA, TextAttributes, TextRenderable, createCliRenderer } from "@opentui/core"
import { QRCodeRenderable } from "@opentui/qrcode"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const ROOT_ID = "qrcode-demo-root"
const QR_CONTENT = "opentui.com"

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#0f172a")

  const root = new BoxRenderable(renderer, {
    id: ROOT_ID,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  })
  renderer.root.add(root)

  const card = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-card`,
    width: "100%",
    height: "100%",
    maxWidth: 72,
    maxHeight: 38,
    padding: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: "#38bdf8",
    backgroundColor: RGBA.fromHex("#111827"),
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  })
  root.add(card)

  card.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-title`,
      content: "Scan opentui.com",
      fg: "#f8fafc",
      attributes: TextAttributes.BOLD,
    }),
  )

  card.add(
    new QRCodeRenderable(renderer, {
      id: `${ROOT_ID}-qr`,
      content: QR_CONTENT,
      quietZone: 4,
      scale: 2,
      marginTop: 1,
      foregroundColor: "#000000",
      backgroundColor: "#ffffff",
      fallbackContent: "Resize terminal for QR",
      fallbackColor: "#94a3b8",
    }),
  )
}

export function destroy(renderer: CliRenderer): void {
  renderer.root.remove(ROOT_ID)
  renderer.setCursorPosition(0, 0, false)
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
