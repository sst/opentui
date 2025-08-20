import tgpu from "typegpu"
import * as d from "typegpu/data"
import { add, dot, select, textureLoad } from "typegpu/std"

export const SuperSamplingParams = d.struct({
  /** Canvas width in pixels */
  width: d.u32,
  /** Canvas height in pixels */
  height: d.u32,
  /** 0 = standard 2x2, 1 = pre-squeezed horizontal blend */
  sampleAlgo: d.size(8, d.u32),
  //               ^ Padding for 16-byte alignment
})

const CellResult = d.struct({
  /** Background RGBA (16 bytes) */
  bg: d.vec4f,
  /** Foreground RGBA (16 bytes) */
  fg: d.vec4f,
  /** Unicode character code (4 bytes) */
  char: d.size(16, d.u32),
  //         ^ Padding so that the total size is 48
})

const CellBuffer = (n: number) =>
  d.struct({
    cells: d.arrayOf(CellResult, n),
  })

export const layout = tgpu.bindGroupLayout({
  inputTexture: { texture: "float", viewDimension: "2d" },
  output: { storage: CellBuffer, access: "mutable" },
  params: { uniform: SuperSamplingParams },
})

const colorDistance = tgpu.fn(
  [d.vec4f, d.vec4f],
  d.f32,
)((a, b) => {
  const diff = a.sub(b).xyz
  return dot(diff, diff)
})

const luminance = tgpu.fn([d.vec4f], d.f32)((color) => 0.2126 * color.x + 0.7152 * color.y + 0.0722 * color.z)

const closestColorIndex = tgpu.fn(
  [d.vec4f, d.vec4f, d.vec4f],
  d.u32,
)((pixel, candA, candB) => {
  return select(d.u32(1), d.u32(0), colorDistance(pixel, candA) <= colorDistance(pixel, candB))
})

const getPixelColor = tgpu.fn(
  [d.u32, d.u32],
  d.vec4f,
)((pixelX, pixelY) => {
  if (pixelX >= layout.$.params.width || pixelY >= layout.$.params.height) {
    return d.vec4f(0, 0, 0, 1) // Black for out-of-bounds
  }

  // textureLoad automatically handles format conversion to RGBA
  return textureLoad(layout.$.inputTexture, d.vec2i(pixelX, pixelY), 0)
})

const blendColors = tgpu.fn(
  [d.vec4f, d.vec4f],
  d.vec4f,
)((color1, color2) => {
  const a1 = color1.w
  const a2 = color2.w

  if (a1 === 0 && a2 === 0) {
    return d.vec4f()
  }

  const outAlpha = a1 + a2 - a1 * a2
  if (outAlpha === 0) {
    return d.vec4f()
  }

  const rgb = add(color1.xyz.mul(a1), color2.xyz.mul(a2 * (1 - a1))).div(outAlpha)

  return d.vec4f(rgb, outAlpha)
})

const averageColorsWithAlpha = tgpu.fn(
  [d.arrayOf(d.vec4f, 4)],
  d.vec4f,
)((pixels) => {
  const blend1 = blendColors(pixels[0], pixels[1])
  const blend2 = blendColors(pixels[2], pixels[3])

  return blendColors(blend1, blend2)
})

// Quadrant character lookup table (same as Zig implementation)
const quadrantChars = tgpu["~unstable"].const(d.arrayOf(d.u32, 16), [
  32, // ' '  - 0000
  0x2597, // ▗   - 0001 BR
  0x2596, // ▖   - 0010 BL
  0x2584, // ▄   - 0011 Lower Half Block
  0x259d, // ▝   - 0100 TR
  0x2590, // ▐   - 0101 Right Half Block
  0x259e, // ▞   - 0110 TR+BL
  0x259f, // ▟   - 0111 TR+BL+BR
  0x2598, // ▘   - 1000 TL
  0x259a, // ▚   - 1001 TL+BR
  0x258c, // ▌   - 1010 Left Half Block
  0x2599, // ▙   - 1011 TL+BL+BR
  0x2580, // ▀   - 1100 Upper Half Block
  0x259c, // ▜   - 1101 TL+TR+BR
  0x259b, // ▛   - 1110 TL+TR+BL
  0x2588, // █   - 1111 Full Block
])

const renderQuadrantBlock = tgpu.fn(
  [d.arrayOf(d.vec4f, 4)],
  CellResult,
)((pixels) => {
  let maxDist = colorDistance(pixels[0], pixels[1])
  let pIdxA = d.u32(0)
  let pIdxB = d.u32(1)

  for (let i = d.u32(0); i < 4; i++) {
    for (let j = d.u32(i + 1); j < 4; j++) {
      const dist = colorDistance(pixels[i], pixels[j])
      if (dist > maxDist) {
        pIdxA = i
        pIdxB = j
        maxDist = dist
      }
    }
  }

  const pCandA = pixels[pIdxA]
  const pCandB = pixels[pIdxB]

  let chosenDarkColor = d.vec4f()
  let chosenLightColor = d.vec4f()

  if (luminance(pCandA) <= luminance(pCandB)) {
    chosenDarkColor = pCandA
    chosenLightColor = pCandB
  } else {
    chosenDarkColor = pCandB
    chosenLightColor = pCandA
  }

  let quadrantBits = d.u32(0)
  const bitValues = [d.u32(8), d.u32(4), d.u32(2), d.u32(1)] // TL, TR, BL, BR

  for (let i = d.u32(0); i < 4; i++) {
    if (closestColorIndex(pixels[i], chosenDarkColor, chosenLightColor) === 0) {
      quadrantBits |= bitValues[i]
    }
  }

  // Construct result
  const result = CellResult()

  if (quadrantBits === 0) {
    // All light
    result.char = 32 // Space character
    result.fg = chosenDarkColor
    result.bg = averageColorsWithAlpha(pixels)
  } else if (quadrantBits === 15) {
    // All dark
    result.char = quadrantChars.$[15] // Full block
    result.fg = averageColorsWithAlpha(pixels)
    result.bg = chosenLightColor
  } else {
    // Mixed pattern
    result.char = quadrantChars.$[quadrantBits]
    result.fg = chosenDarkColor
    result.bg = chosenLightColor
  }

  return result
})

export const createSuperSamplingComputeShader = (WORKGROUP_SIZE: number) => {
  const main = tgpu["~unstable"].computeFn({
    workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
    in: { id: d.builtin.globalInvocationId },
  })((input) => {
    const cellX = input.id.x
    const cellY = input.id.y
    const bufferWidthCells = d.u32((layout.$.params.width + 1) / 2)
    const bufferHeightCells = d.u32((layout.$.params.height + 1) / 2)

    if (cellX >= bufferWidthCells || cellY >= bufferHeightCells) {
      return
    }

    const renderX = cellX * 2
    const renderY = cellY * 2

    const pixelsRgba = [d.vec4f(), d.vec4f(), d.vec4f(), d.vec4f()]

    if (layout.$.params.sampleAlgo === 1) {
      const topColor = getPixelColor(renderX, renderY)
      const topColor2 = getPixelColor(renderX + 1, renderY)

      const blendedTop = blendColors(topColor, topColor2)

      const bottomColor = getPixelColor(renderX, renderY + 1)
      const bottomColor2 = getPixelColor(renderX + 1, renderY + 1)
      const blendedBottom = blendColors(bottomColor, bottomColor2)

      pixelsRgba[0] = blendedTop // TL
      pixelsRgba[1] = blendedTop // TR
      pixelsRgba[2] = blendedBottom // BL
      pixelsRgba[3] = blendedBottom // BR
    } else {
      pixelsRgba[0] = getPixelColor(renderX, renderY) // TL
      pixelsRgba[1] = getPixelColor(renderX + 1, renderY) // TR
      pixelsRgba[2] = getPixelColor(renderX, renderY + 1) // BL
      pixelsRgba[3] = getPixelColor(renderX + 1, renderY + 1) // BR
    }

    const cellResult = renderQuadrantBlock(pixelsRgba)

    const outputIndex = cellY * bufferWidthCells + cellX
    layout.$.output.cells[outputIndex] = cellResult
  })

  return main
}
