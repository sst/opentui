import tgpu from "typegpu"
import { arrayOf, size, struct, u32, vec4f } from "typegpu/data"

export const SuperSamplingParams = struct({
  /** Canvas width in pixels */
  width: u32,
  /** Canvas height in pixels */
  height: u32,
  /** 0 = standard 2x2, 1 = pre-squeezed horizontal blend */
  sampleAlgo: size(8, u32),
  //               ^ Padding for 16-byte alignment
})

const CellResult = struct({
  /** Background RGBA (16 bytes) */
  bg: vec4f,
  /** Foreground RGBA (16 bytes) */
  fg: vec4f,
  /** Unicode character code (4 bytes) */
  char: size(16, u32),
  //         ^ Padding so that the total size is 48
});

const CellBuffer = (n: number) =>
  struct({
    cells: arrayOf(CellResult, n),
  })

export const layout = tgpu.bindGroupLayout({
  inputTexture: { texture: 'float', viewDimension: '2d' },
  output: { storage: CellBuffer, access: 'mutable' },
  params: { uniform: SuperSamplingParams },
}).$idx(0)

export const createSuperSamplingComputeShader = (WORKGROUP_SIZE: number) => {
  return tgpu.resolve({
    externals: {
      WORKGROUP_SIZE,
      CellResult,
      layout,
    },
    template: /* wgsl */ `

// Quadrant character lookup table (same as Zig implementation)
const quadrantChars = array<u32, 16>(
    32u,      // ' '  - 0000
    0x2597u,  // ▗   - 0001 BR
    0x2596u,  // ▖   - 0010 BL  
    0x2584u,  // ▄   - 0011 Lower Half Block
    0x259Du,  // ▝   - 0100 TR
    0x2590u,  // ▐   - 0101 Right Half Block
    0x259Eu,  // ▞   - 0110 TR+BL
    0x259Fu,  // ▟   - 0111 TR+BL+BR
    0x2598u,  // ▘   - 1000 TL
    0x259Au,  // ▚   - 1001 TL+BR
    0x258Cu,  // ▌   - 1010 Left Half Block
    0x2599u,  // ▙   - 1011 TL+BL+BR
    0x2580u,  // ▀   - 1100 Upper Half Block
    0x259Cu,  // ▜   - 1101 TL+TR+BR
    0x259Bu,  // ▛   - 1110 TL+TR+BL
    0x2588u   // █   - 1111 Full Block
);

const inv_255: f32 = 1.0 / 255.0;

fn getPixelColor(pixelX: u32, pixelY: u32) -> vec4<f32> {
    if (pixelX >= layout.$.params.width || pixelY >= layout.$.params.height) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0); // Black for out-of-bounds
    }
    
    // textureLoad automatically handles format conversion to RGBA
    return textureLoad(layout.$.inputTexture, vec2<i32>(i32(pixelX), i32(pixelY)), 0);
}

fn colorDistance(a: vec4<f32>, b: vec4<f32>) -> f32 {
    let diff = a.rgb - b.rgb;
    return dot(diff, diff);
}

fn luminance(color: vec4<f32>) -> f32 {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

fn closestColorIndex(pixel: vec4<f32>, candA: vec4<f32>, candB: vec4<f32>) -> u32 {
    return select(1u, 0u, colorDistance(pixel, candA) <= colorDistance(pixel, candB));
}

fn averageColor(pixels: array<vec4<f32>, 4>) -> vec4<f32> {
    return (pixels[0] + pixels[1] + pixels[2] + pixels[3]) * 0.25;
}

fn blendColors(color1: vec4<f32>, color2: vec4<f32>) -> vec4<f32> {
    let a1 = color1.a;
    let a2 = color2.a;
    
    if (a1 == 0.0 && a2 == 0.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    
    let outAlpha = a1 + a2 - a1 * a2;
    if (outAlpha == 0.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    
    let rgb = (color1.rgb * a1 + color2.rgb * a2 * (1.0 - a1)) / outAlpha;
    
    return vec4<f32>(rgb, outAlpha);
}

fn averageColorsWithAlpha(pixels: array<vec4<f32>, 4>) -> vec4<f32> {
    let blend1 = blendColors(pixels[0], pixels[1]);
    let blend2 = blendColors(pixels[2], pixels[3]);
    
    return blendColors(blend1, blend2);
}

fn renderQuadrantBlock(pixels: array<vec4<f32>, 4>) -> CellResult {
    var maxDist: f32 = colorDistance(pixels[0], pixels[1]);
    var pIdxA: u32 = 0u;
    var pIdxB: u32 = 1u;
    
    for (var i: u32 = 0u; i < 4u; i++) {
        for (var j: u32 = i + 1u; j < 4u; j++) {
            let dist = colorDistance(pixels[i], pixels[j]);
            if (dist > maxDist) {
                pIdxA = i;
                pIdxB = j;
                maxDist = dist;
            }
        }
    }
    
    let pCandA = pixels[pIdxA];
    let pCandB = pixels[pIdxB];
    
    var chosenDarkColor: vec4<f32>;
    var chosenLightColor: vec4<f32>;
    
    if (luminance(pCandA) <= luminance(pCandB)) {
        chosenDarkColor = pCandA;
        chosenLightColor = pCandB;
    } else {
        chosenDarkColor = pCandB;
        chosenLightColor = pCandA;
    }
    
    var quadrantBits: u32 = 0u;
    let bitValues = array<u32, 4>(8u, 4u, 2u, 1u); // TL, TR, BL, BR
    
    for (var i: u32 = 0u; i < 4u; i++) {
        if (closestColorIndex(pixels[i], chosenDarkColor, chosenLightColor) == 0u) {
            quadrantBits |= bitValues[i];
        }
    }
    
    // Construct result
    var result: CellResult;
    
    if (quadrantBits == 0u) { // All light
        result.char = 32u; // Space character
        result.fg = chosenDarkColor;
        result.bg = averageColorsWithAlpha(pixels);
    } else if (quadrantBits == 15u) { // All dark  
        result.char = quadrantChars[15]; // Full block
        result.fg = averageColorsWithAlpha(pixels);
        result.bg = chosenLightColor;
    } else { // Mixed pattern
        result.char = quadrantChars[quadrantBits];
        result.fg = chosenDarkColor;
        result.bg = chosenLightColor;
    }
    
    return result;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let cellX = id.x;
    let cellY = id.y;
    let bufferWidthCells = (layout.$.params.width + 1u) / 2u;
    let bufferHeightCells = (layout.$.params.height + 1u) / 2u;
    
    if (cellX >= bufferWidthCells || cellY >= bufferHeightCells) {
        return;
    }
    
    let renderX = cellX * 2u;
    let renderY = cellY * 2u;
    
    var pixelsRgba: array<vec4<f32>, 4>;
    
    if (layout.$.params.sampleAlgo == 1u) {
        let topColor = getPixelColor(renderX, renderY);
        let topColor2 = getPixelColor(renderX + 1u, renderY);
        
        let blendedTop = blendColors(topColor, topColor2);
        
        let bottomColor = getPixelColor(renderX, renderY + 1u);
        let bottomColor2 = getPixelColor(renderX + 1u, renderY + 1u);
        let blendedBottom = blendColors(bottomColor, bottomColor2);
        
        pixelsRgba[0] = blendedTop;      // TL
        pixelsRgba[1] = blendedTop;      // TR  
        pixelsRgba[2] = blendedBottom;   // BL
        pixelsRgba[3] = blendedBottom;   // BR
    } else {
        pixelsRgba[0] = getPixelColor(renderX, renderY);         // TL
        pixelsRgba[1] = getPixelColor(renderX + 1u, renderY);   // TR  
        pixelsRgba[2] = getPixelColor(renderX, renderY + 1u);   // BL
        pixelsRgba[3] = getPixelColor(renderX + 1u, renderY + 1u); // BR
    }
    
    let cellResult = renderQuadrantBlock(pixelsRgba);
    
    let outputIndex = cellY * bufferWidthCells + cellX;
    layout.$.output.cells[outputIndex] = cellResult;
}
    `,
  })
}