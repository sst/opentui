# WebGPU Shaders

OpenTUI provides WebGPU integration for high-performance graphics rendering, including support for custom shaders.

## WebGPU Renderer

The `WGPURenderer` class provides a WebGPU rendering context for OpenTUI.

```typescript
import { WGPURenderer } from '@opentui/core/3d';

// Create a WebGPU renderer
const gpuRenderer = new WGPURenderer({
  width: 800,
  height: 600
});

// Initialize the renderer
await gpuRenderer.initialize();

// Create a render pipeline
const pipeline = await gpuRenderer.createRenderPipeline({
  vertex: {
    module: gpuRenderer.device.createShaderModule({
      code: vertexShaderCode
    }),
    entryPoint: 'main'
  },
  fragment: {
    module: gpuRenderer.device.createShaderModule({
      code: fragmentShaderCode
    }),
    entryPoint: 'main',
    targets: [{ format: gpuRenderer.format }]
  },
  primitive: {
    topology: 'triangle-list'
  }
});

// Render a frame
gpuRenderer.beginFrame();
// ... rendering commands ...
gpuRenderer.endFrame();

// Destroy the renderer
gpuRenderer.destroy();
```

## WGSL Shaders

WebGPU uses the WebGPU Shading Language (WGSL) for writing shaders. Here's an example of a simple vertex and fragment shader:

### Vertex Shader

```wgsl
@vertex
fn main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>(0.5, -0.5)
  );
  return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
}
```

### Fragment Shader

```wgsl
@fragment
fn main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
```

## Supersampling Shader

OpenTUI includes a supersampling shader for improving the quality of rendered graphics:

```wgsl
// supersampling.wgsl

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
  width: u32,
  height: u32,
  sampleCount: u32,
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }
  
  var color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let sampleSize = 1.0 / f32(params.sampleCount);
  
  for (var i = 0u; i < params.sampleCount; i = i + 1u) {
    for (var j = 0u; j < params.sampleCount; j = j + 1u) {
      let offsetX = (f32(i) + 0.5) * sampleSize;
      let offsetY = (f32(j) + 0.5) * sampleSize;
      let sampleX = f32(x) + offsetX;
      let sampleY = f32(y) + offsetY;
      
      color = color + textureLoad(inputTexture, vec2<i32>(sampleX, sampleY), 0);
    }
  }
  
  color = color / f32(params.sampleCount * params.sampleCount);
  textureStore(outputTexture, vec2<i32>(x, y), color);
}
```

## Example: Fractal Shader

Here's an example of creating a fractal shader with WebGPU:

```typescript
import { createCliRenderer, BoxRenderable, OptimizedBuffer, RGBA } from '@opentui/core';
import { WGPURenderer } from '@opentui/core/3d';

// Vertex shader
const vertexShaderCode = `
@vertex
fn main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );
  return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
}
`;

// Fragment shader (Mandelbrot set)
const fragmentShaderCode = `
@group(0) @binding(0) var<uniform> params: Params;

struct Params {
  width: f32,
  height: f32,
  time: f32,
  zoom: f32,
  offsetX: f32,
  offsetY: f32,
}

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let aspect = params.width / params.height;
  let uv = vec2<f32>(fragCoord.xy / vec2<f32>(params.width, params.height));
  
  // Map to complex plane
  let c = vec2<f32>(
    (uv.x * 2.0 - 1.0) * aspect * params.zoom + params.offsetX,
    (uv.y * 2.0 - 1.0) * params.zoom + params.offsetY
  );
  
  // Mandelbrot iteration
  let maxIter = 100.0;
  var z = vec2<f32>(0.0, 0.0);
  var iter = 0.0;
  
  for (var i = 0.0; i < maxIter; i += 1.0) {
    // z = z^2 + c
    let real = z.x * z.x - z.y * z.y + c.x;
    let imag = 2.0 * z.x * z.y + c.y;
    z = vec2<f32>(real, imag);
    
    if (dot(z, z) > 4.0) {
      iter = i;
      break;
    }
  }
  
  // Coloring
  if (iter >= maxIter) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  
  let t = iter / maxIter;
  let hue = 360.0 * (0.5 + sin(params.time * 0.1) * 0.5) * t;
  
  // HSV to RGB conversion
  let h = hue / 60.0;
  let i = floor(h);
  let f = h - i;
  let p = 1.0 - t;
  let q = 1.0 - (t * f);
  let r = 1.0 - (t * (1.0 - f));
  
  var rgb: vec3<f32>;
  
  if (i == 0.0) {
    rgb = vec3<f32>(t, r, p);
  } else if (i == 1.0) {
    rgb = vec3<f32>(q, t, p);
  } else if (i == 2.0) {
    rgb = vec3<f32>(p, t, r);
  } else if (i == 3.0) {
    rgb = vec3<f32>(p, q, t);
  } else if (i == 4.0) {
    rgb = vec3<f32>(r, p, t);
  } else {
    rgb = vec3<f32>(t, p, q);
  }
  
  return vec4<f32>(rgb, 1.0);
}
`;

class FractalRenderable extends BoxRenderable {
  private gpuRenderer: WGPURenderer;
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private uniformBuffer: GPUBuffer;
  private params: {
    width: number;
    height: number;
    time: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
  };
  
  constructor(id: string, options = {}) {
    super(id, {
      width: '100%',
      height: '100%',
      border: false,
      ...options
    });
    
    this.params = {
      width: 0,
      height: 0,
      time: 0,
      zoom: 1.5,
      offsetX: -0.5,
      offsetY: 0.0
    };
    
    this.initWebGPU();
  }
  
  private async initWebGPU() {
    // Create a WebGPU renderer
    this.gpuRenderer = new WGPURenderer({
      width: this.width * 2,  // Double resolution for better quality
      height: this.height * 2
    });
    
    // Initialize the renderer
    await this.gpuRenderer.initialize();
    
    // Update params
    this.params.width = this.gpuRenderer.width;
    this.params.height = this.gpuRenderer.height;
    
    // Create a uniform buffer
    this.uniformBuffer = this.gpuRenderer.device.createBuffer({
      size: 6 * 4,  // 6 floats (width, height, time, zoom, offsetX, offsetY)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Create a bind group layout
    const bindGroupLayout = this.gpuRenderer.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });
    
    // Create a pipeline layout
    const pipelineLayout = this.gpuRenderer.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });
    
    // Create a render pipeline
    this.pipeline = this.gpuRenderer.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.gpuRenderer.device.createShaderModule({
          code: vertexShaderCode
        }),
        entryPoint: 'main'
      },
      fragment: {
        module: this.gpuRenderer.device.createShaderModule({
          code: fragmentShaderCode
        }),
        entryPoint: 'main',
        targets: [{ format: this.gpuRenderer.format }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
    
    // Create a bind group
    this.bindGroup = this.gpuRenderer.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        }
      ]
    });
  }
  
  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.gpuRenderer || !this.pipeline || !this.bindGroup) return;
    
    // Update time
    this.params.time += deltaTime;
    
    // Update uniform buffer
    this.gpuRenderer.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        this.params.width,
        this.params.height,
        this.params.time,
        this.params.zoom,
        this.params.offsetX,
        this.params.offsetY
      ])
    );
    
    // Begin frame
    this.gpuRenderer.beginFrame();
    
    // Get command encoder
    const commandEncoder = this.gpuRenderer.device.createCommandEncoder();
    
    // Begin render pass
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpuRenderer.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }
        }
      ]
    });
    
    // Set pipeline and bind group
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    
    // Draw
    renderPass.draw(6);
    
    // End render pass
    renderPass.end();
    
    // Submit commands
    this.gpuRenderer.device.queue.submit([commandEncoder.finish()]);
    
    // End frame
    this.gpuRenderer.endFrame();
    
    // Get the rendered image
    const imageData = this.gpuRenderer.getImageData();
    
    // Render to terminal
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Sample the WebGL output with proper scaling
        const glX = Math.floor(x * (this.gpuRenderer.width / this.width));
        const glY = Math.floor(y * (this.gpuRenderer.height / this.height));
        
        const idx = (glY * this.gpuRenderer.width + glX) * 4;
        const r = imageData.data[idx] / 255;
        const g = imageData.data[idx + 1] / 255;
        const b = imageData.data[idx + 2] / 255;
        const a = imageData.data[idx + 3] / 255;
        
        // Apply brightness-based character selection for better visibility
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        const character = brightness > 0.8 ? '█' : 
                         brightness > 0.6 ? '▓' : 
                         brightness > 0.4 ? '▒' : 
                         brightness > 0.2 ? '░' : ' ';
        
        // Draw the pixel with appropriate character and color
        buffer.setCell(
          this.x + x,
          this.y + y,
          character,
          RGBA.fromValues(r, g, b, a),
          RGBA.fromValues(0, 0, 0, 1)
        );
      }
    }
  }
  
  // Control methods
  public setZoom(zoom: number): void {
    this.params.zoom = zoom;
  }
  
  public setOffset(x: number, y: number): void {
    this.params.offsetX = x;
    this.params.offsetY = y;
  }
  
  public destroy(): void {
    if (this.gpuRenderer) {
      this.gpuRenderer.destroy();
    }
  }
}

async function createFractalDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Create a fractal renderable
  const fractal = new FractalRenderable('fractal');
  container.add(fractal);
  
  // Add instructions
  const instructions = new TextRenderable('instructions', {
    content: 'Arrow keys: Move | +/-: Zoom | Q: Quit',
    fg: '#ffffff',
    position: 'absolute',
    x: 2,
    y: 1
  });
  
  container.add(instructions);
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'ArrowRight') {
      fractal.setOffset(fractal.params.offsetX + 0.1 * fractal.params.zoom, fractal.params.offsetY);
    } else if (keyStr === 'ArrowLeft') {
      fractal.setOffset(fractal.params.offsetX - 0.1 * fractal.params.zoom, fractal.params.offsetY);
    } else if (keyStr === 'ArrowUp') {
      fractal.setOffset(fractal.params.offsetX, fractal.params.offsetY - 0.1 * fractal.params.zoom);
    } else if (keyStr === 'ArrowDown') {
      fractal.setOffset(fractal.params.offsetX, fractal.params.offsetY + 0.1 * fractal.params.zoom);
    } else if (keyStr === '+') {
      fractal.setZoom(fractal.params.zoom * 0.8);
    } else if (keyStr === '-') {
      fractal.setZoom(fractal.params.zoom * 1.25);
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      fractal.destroy();
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the fractal demo
createFractalDemo().catch(console.error);
```

## Example: Cube Shader

Here's an example of rendering a 3D cube with WebGPU:

```typescript
import { createCliRenderer, BoxRenderable, OptimizedBuffer, RGBA } from '@opentui/core';
import { WGPURenderer } from '@opentui/core/3d';

// Vertex shader
const vertexShaderCode = `
struct Uniforms {
  modelViewProjection: mat4x4<f32>,
  time: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn main(
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>
) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.modelViewProjection * vec4<f32>(position, 1.0);
  output.color = color;
  return output;
}
`;

// Fragment shader
const fragmentShaderCode = `
@fragment
fn main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;

class CubeRenderable extends BoxRenderable {
  private gpuRenderer: WGPURenderer;
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private uniformBuffer: GPUBuffer;
  private vertexBuffer: GPUBuffer;
  private indexBuffer: GPUBuffer;
  private time: number = 0;
  
  constructor(id: string, options = {}) {
    super(id, {
      width: '100%',
      height: '100%',
      border: false,
      ...options
    });
    
    this.initWebGPU();
  }
  
  private async initWebGPU() {
    // Create a WebGPU renderer
    this.gpuRenderer = new WGPURenderer({
      width: this.width * 2,  // Double resolution for better quality
      height: this.height * 2
    });
    
    // Initialize the renderer
    await this.gpuRenderer.initialize();
    
    // Create vertex data for a cube
    const vertices = new Float32Array([
      // Position (xyz), Color (rgba)
      // Front face
      -1.0, -1.0,  1.0,  1.0, 0.0, 0.0, 1.0,
       1.0, -1.0,  1.0,  0.0, 1.0, 0.0, 1.0,
       1.0,  1.0,  1.0,  0.0, 0.0, 1.0, 1.0,
      -1.0,  1.0,  1.0,  1.0, 1.0, 0.0, 1.0,
      
      // Back face
      -1.0, -1.0, -1.0,  0.0, 1.0, 1.0, 1.0,
       1.0, -1.0, -1.0,  1.0, 0.0, 1.0, 1.0,
       1.0,  1.0, -1.0,  1.0, 1.0, 1.0, 1.0,
      -1.0,  1.0, -1.0,  0.0, 0.0, 0.0, 1.0,
    ]);
    
    // Create index data for a cube
    const indices = new Uint16Array([
      // Front face
      0, 1, 2, 0, 2, 3,
      // Back face
      4, 5, 6, 4, 6, 7,
      // Top face
      3, 2, 6, 3, 6, 7,
      // Bottom face
      0, 1, 5, 0, 5, 4,
      // Right face
      1, 2, 6, 1, 6, 5,
      // Left face
      0, 3, 7, 0, 7, 4
    ]);
    
    // Create a vertex buffer
    this.vertexBuffer = this.gpuRenderer.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    
    // Create an index buffer
    this.indexBuffer = this.gpuRenderer.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    
    // Create a uniform buffer
    this.uniformBuffer = this.gpuRenderer.device.createBuffer({
      size: 4 * 16 + 4,  // mat4x4 + float
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Write data to buffers
    this.gpuRenderer.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
    this.gpuRenderer.device.queue.writeBuffer(this.indexBuffer, 0, indices);
    
    // Create a bind group layout
    const bindGroupLayout = this.gpuRenderer.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        }
      ]
    });
    
    // Create a pipeline layout
    const pipelineLayout = this.gpuRenderer.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });
    
    // Create a render pipeline
    this.pipeline = this.gpuRenderer.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.gpuRenderer.device.createShaderModule({
          code: vertexShaderCode
        }),
        entryPoint: 'main',
        buffers: [
          {
            arrayStride: 7 * 4,  // 7 floats per vertex
            attributes: [
              {
                // Position
                shaderLocation: 0,
                offset: 0,
                format: 'float32x3'
              },
              {
                // Color
                shaderLocation: 1,
                offset: 3 * 4,
                format: 'float32x4'
              }
            ]
          }
        ]
      },
      fragment: {
        module: this.gpuRenderer.device.createShaderModule({
          code: fragmentShaderCode
        }),
        entryPoint: 'main',
        targets: [{ format: this.gpuRenderer.format }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
    
    // Create a bind group
    this.bindGroup = this.gpuRenderer.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        }
      ]
    });
  }
  
  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.gpuRenderer || !this.pipeline || !this.bindGroup) return;
    
    // Update time
    this.time += deltaTime;
    
    // Create model-view-projection matrix
    const aspect = this.gpuRenderer.width / this.gpuRenderer.height;
    const projectionMatrix = mat4.perspective(
      mat4.create(),
      Math.PI / 4,
      aspect,
      0.1,
      100.0
    );
    
    const viewMatrix = mat4.lookAt(
      mat4.create(),
      [0, 0, 5],  // Camera position
      [0, 0, 0],  // Look at
      [0, 1, 0]   // Up vector
    );
    
    const modelMatrix = mat4.create();
    mat4.rotateY(modelMatrix, modelMatrix, this.time * 0.001);
    mat4.rotateX(modelMatrix, modelMatrix, this.time * 0.0007);
    
    const modelViewProjection = mat4.create();
    mat4.multiply(modelViewProjection, viewMatrix, modelMatrix);
    mat4.multiply(modelViewProjection, projectionMatrix, modelViewProjection);
    
    // Update uniform buffer
    const uniformData = new Float32Array(16 + 1);
    uniformData.set(modelViewProjection, 0);
    uniformData[16] = this.time;
    
    this.gpuRenderer.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      uniformData
    );
    
    // Begin frame
    this.gpuRenderer.beginFrame();
    
    // Get command encoder
    const commandEncoder = this.gpuRenderer.device.createCommandEncoder();
    
    // Begin render pass
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpuRenderer.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }
        }
      ],
      depthStencilAttachment: {
        view: this.gpuRenderer.depthTextureView,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1.0
      }
    });
    
    // Set pipeline and bind group
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    
    // Set vertex and index buffers
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, 'uint16');
    
    // Draw
    renderPass.drawIndexed(36);
    
    // End render pass
    renderPass.end();
    
    // Submit commands
    this.gpuRenderer.device.queue.submit([commandEncoder.finish()]);
    
    // End frame
    this.gpuRenderer.endFrame();
    
    // Get the rendered image
    const imageData = this.gpuRenderer.getImageData();
    
    // Render to terminal
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Sample the WebGL output with proper scaling
        const glX = Math.floor(x * (this.gpuRenderer.width / this.width));
        const glY = Math.floor(y * (this.gpuRenderer.height / this.height));
        
        const idx = (glY * this.gpuRenderer.width + glX) * 4;
        const r = imageData.data[idx] / 255;
        const g = imageData.data[idx + 1] / 255;
        const b = imageData.data[idx + 2] / 255;
        const a = imageData.data[idx + 3] / 255;
        
        // Apply brightness-based character selection for better visibility
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        const character = brightness > 0.8 ? '█' : 
                         brightness > 0.6 ? '▓' : 
                         brightness > 0.4 ? '▒' : 
                         brightness > 0.2 ? '░' : ' ';
        
        // Draw the pixel with appropriate character and color
        buffer.setCell(
          this.x + x,
          this.y + y,
          character,
          RGBA.fromValues(r, g, b, a),
          RGBA.fromValues(0, 0, 0, 1)
        );
      }
    }
  }
  
  public destroy(): void {
    if (this.gpuRenderer) {
      this.gpuRenderer.destroy();
    }
  }
}

async function createCubeDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Create a cube renderable
  const cube = new CubeRenderable('cube');
  container.add(cube);
  
  // Add instructions
  const instructions = new TextRenderable('instructions', {
    content: 'Q: Quit',
    fg: '#ffffff',
    position: 'absolute',
    x: 2,
    y: 1
  });
  
  container.add(instructions);
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      cube.destroy();
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the cube demo
createCubeDemo().catch(console.error);
```
