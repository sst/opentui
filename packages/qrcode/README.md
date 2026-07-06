# @lexwdex-org/qrcode

QR code encoder and renderable for OpenTUI.

```ts
import { createCliRenderer } from "@lexwdex-org/core"
import { QRCodeRenderable } from "@lexwdex-org/qrcode"

const renderer = await createCliRenderer()
renderer.root.add(
  new QRCodeRenderable(renderer, {
    content: "https://opentui.com",
    quietZone: 4,
    scale: 2,
  }),
)
```

React JSX support is registered explicitly:

```tsx
import { registerQRCode } from "@lexwdex-org/qrcode/react"

registerQRCode()
```

Solid JSX support is registered explicitly:

```tsx
import { registerQRCode } from "@lexwdex-org/qrcode/solid"

registerQRCode()
```
