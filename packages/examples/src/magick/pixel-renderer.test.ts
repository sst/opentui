import { expect, test } from "bun:test"
import { NativeImage } from "@opentui/core"
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from "three"
import { createPixelRenderer, packRgba } from "./pixel-renderer.js"

test("packing handles BGRA, RGBA, row padding, and subarray views", () => {
  for (const format of ["rgba8", "bgra8"] as const) {
    const data = new Uint8Array([99, 1, 2, 3, 4, 99, 99, 99, 99, 5, 6, 7, 8, 99]).subarray(1, 13)
    const output = new Uint8Array(8)
    packRgba({ data, width: 1, height: 2, stride: 8, format }, output)
    expect([...output]).toEqual(format === "rgba8" ? [1, 2, 3, 4, 5, 6, 7, 8] : [3, 2, 1, 4, 7, 6, 5, 8])
  }
})

for (const mapping of ["view", "pointer"] as const) {
  test.skipIf(process.env.GPU_TESTS !== "1")(
    `${mapping} consumer preserves GPU colors and releases failed mappings`,
    async () => {
      const gpu = await createPixelRenderer(65, 33, mapping)
      const scene = new Scene()
      scene.background = new Color("#102030")
      const geometry = new BoxGeometry()
      const material = new MeshBasicMaterial({ color: "red" })
      scene.add(new Mesh(geometry, material))
      const camera = new OrthographicCamera(-2, 2, 1, -1, 0.1, 100)
      camera.position.z = 3
      try {
        await expect(
          gpu.draw(scene, camera, () => {
            throw new Error("consumer failed")
          }),
        ).rejects.toThrow("consumer failed")
        const { value } = await gpu.draw(scene, camera, (frame) => {
          expect(frame.stride).toBe(512)
          const rgba = new Uint8Array(65 * 33 * 4)
          packRgba(frame, rgba)
          expect([...rgba.slice(0, 4)]).toEqual([16, 32, 48, 255])
          expect([...rgba.slice(-4)]).toEqual([16, 32, 48, 255])
          const middle = (16 * 65 + 32) * 4
          expect([...rgba.slice(middle, middle + 4)]).toEqual([255, 0, 0, 255])
          return {
            expected: rgba,
            image: NativeImage.fromPixels(frame.data, frame.width, frame.height, {
              stride: frame.stride,
              format: frame.format,
              alpha: "opaque",
            }),
          }
        })
        try {
          expect(value.image.raw().data).toEqual(value.expected)
        } finally {
          value.image.dispose()
        }
      } finally {
        geometry.dispose()
        material.dispose()
        gpu.dispose()
      }
      await expect(gpu.draw(scene, camera, () => {})).rejects.toThrow("disposed")
    },
  )
}
