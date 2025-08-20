# WebGPU Integration

OpenTUI provides powerful 3D rendering capabilities through WebGPU integration, allowing you to create rich visual experiences in the terminal.

## Overview

The WebGPU integration consists of:

1. **ThreeCliRenderer**: A renderer that integrates Three.js with WebGPU
2. **CLICanvas**: A canvas implementation for rendering to the terminal
3. **Supersampling**: Techniques for improving rendering quality
4. **Shaders**: Custom WebGPU shaders for visual effects

## ThreeCliRenderer API

The `ThreeCliRenderer` class provides a bridge between Three.js and the terminal:

```typescript
import { 
  ThreeCliRenderer, 
  ThreeCliRendererOptions, 
  SuperSampleType,
  createCliRenderer,
  Scene,
  PerspectiveCamera,
  OrthographicCamera,
  RGBA
} from '@opentui/core';

// Create a CLI renderer
const renderer = await createCliRenderer();

// Create a Three.js scene
const scene = new Scene();

// Create a ThreeCliRenderer
const threeRenderer = new ThreeCliRenderer(renderer, {
  width: 80,
  height: 40,
  focalLength: 50,
  backgroundColor: RGBA.fromHex('#000000'),
  superSample: SuperSampleType.GPU,
  alpha: false,
  autoResize: true
});

// Initialize the renderer
await threeRenderer.init();

// Set the active camera
const camera = new PerspectiveCamera(75, threeRenderer.aspectRatio, 0.1, 1000);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);
threeRenderer.setActiveCamera(camera);

// Draw the scene
renderer.on('update', async (context) => {
  await threeRenderer.drawScene(scene, renderer.buffer, context.deltaTime);
});

// Start the renderer
renderer.start();
```

### Renderer Options

The `ThreeCliRenderer` constructor accepts the following options:

```typescript
interface ThreeCliRendererOptions {
  width: number;                      // Output width in characters
  height: number;                     // Output height in characters
  focalLength?: number;               // Camera focal length
  backgroundColor?: RGBA;             // Background color
  superSample?: SuperSampleType;      // Supersampling type
  alpha?: boolean;                    // Enable alpha blending
  autoResize?: boolean;               // Automatically resize on terminal resize
  libPath?: string;                   // Path to WebGPU library
}
```

### Supersampling

The renderer supports three supersampling modes to improve rendering quality:

```typescript
enum SuperSampleType {
  NONE = "none",    // No supersampling
  GPU = "gpu",      // GPU-based supersampling
  CPU = "cpu"       // CPU-based supersampling
}
```

You can toggle between supersampling modes:

```typescript
// Toggle between supersampling modes
threeRenderer.toggleSuperSampling();

// Set a specific supersampling algorithm
threeRenderer.setSuperSampleAlgorithm(SuperSampleAlgorithm.PRE_SQUEEZED);
```

### Camera Control

You can set and get the active camera:

```typescript
// Set the active camera
threeRenderer.setActiveCamera(camera);

// Get the active camera
const activeCamera = threeRenderer.getActiveCamera();
```

### Resizing

You can resize the renderer:

```typescript
// Resize the renderer
threeRenderer.setSize(100, 50);
```

### Saving to File

You can save the rendered scene to a file:

```typescript
// Save the current frame to a file
await threeRenderer.saveToFile('screenshot.png');
```

### Cleanup

When you're done with the renderer, you should destroy it to free resources:

```typescript
// Destroy the renderer
threeRenderer.destroy();
```

## CLICanvas API

The `CLICanvas` class provides a canvas implementation for rendering to the terminal:

```typescript
import { CLICanvas, SuperSampleAlgorithm, SuperSampleType } from '@opentui/core';

// Create a canvas (typically done by ThreeCliRenderer)
const canvas = new CLICanvas(
  device,           // WebGPU device
  width,            // Canvas width
  height,           // Canvas height
  SuperSampleType.GPU,
  SuperSampleAlgorithm.STANDARD
);

// Set the canvas size
canvas.setSize(width, height);

// Set the supersampling mode
canvas.setSuperSample(SuperSampleType.GPU);

// Set the supersampling algorithm
canvas.setSuperSampleAlgorithm(SuperSampleAlgorithm.PRE_SQUEEZED);

// Read pixels into a buffer
await canvas.readPixelsIntoBuffer(buffer);

// Save the canvas to a file
await canvas.saveToFile('screenshot.png');
```

## Supersampling Algorithms

OpenTUI supports two supersampling algorithms:

```typescript
enum SuperSampleAlgorithm {
  STANDARD = 0,     // Standard supersampling
  PRE_SQUEEZED = 1  // Pre-squeezed supersampling (better for text)
}
```

## Integration with Three.js

The WebGPU integration works with Three.js to provide a familiar API for 3D rendering:

```typescript
import { 
  Scene, 
  Mesh, 
  BoxGeometry, 
  MeshPhongNodeMaterial, 
  DirectionalLight,
  Color
} from '@opentui/core';

// Create a scene
const scene = new Scene();

// Add a light
const light = new DirectionalLight(0xffffff, 1);
light.position.set(1, 1, 1);
scene.add(light);

// Create a mesh
const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshPhongNodeMaterial({
  color: new Color(0x3498db),
  emissive: new Color(0x000000),
  specular: new Color(0x111111),
  shininess: 30
});
const cube = new Mesh(geometry, material);
scene.add(cube);

// Animate the cube
renderer.on('update', (context) => {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
});
```

## WebGPU Shaders

OpenTUI supports custom WebGPU shaders for advanced visual effects:

```typescript
import { 
  Scene, 
  Mesh, 
  BoxGeometry, 
  ShaderMaterial,
  WebGPURenderer
} from '@opentui/core';

// Create a shader material
const material = new ShaderMaterial({
  vertexShader: `
    @vertex
    fn main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
      return vec4<f32>(position, 1.0);
    }
  `,
  fragmentShader: `
    @fragment
    fn main() -> @location(0) vec4<f32> {
      return vec4<f32>(1.0, 0.0, 0.0, 1.0);
    }
  `
});

// Create a mesh with the shader material
const geometry = new BoxGeometry(1, 1, 1);
const cube = new Mesh(geometry, material);
scene.add(cube);
```

## Performance Considerations

The WebGPU integration is designed for performance, but there are some considerations:

- **Supersampling**: Supersampling improves quality but reduces performance
- **Resolution**: Higher resolutions require more GPU memory and processing power
- **Complexity**: Complex scenes with many objects will be slower
- **Shaders**: Custom shaders can be expensive, especially with complex calculations

For best performance:

- Use appropriate resolution for your terminal
- Use supersampling only when needed
- Optimize your Three.js scene (reduce polygon count, use efficient materials)
- Use GPU-based supersampling when possible

## Example: Creating a 3D Cube

```typescript
import { 
  createCliRenderer, 
  ThreeCliRenderer, 
  SuperSampleType,
  Scene, 
  PerspectiveCamera, 
  BoxGeometry, 
  Mesh, 
  MeshPhongNodeMaterial,
  DirectionalLight,
  Color,
  RGBA
} from '@opentui/core';

async function createCubeDemo() {
  // Create a CLI renderer
  const renderer = await createCliRenderer();
  
  // Create a Three.js scene
  const scene = new Scene();
  
  // Create a ThreeCliRenderer
  const threeRenderer = new ThreeCliRenderer(renderer, {
    width: 80,
    height: 40,
    backgroundColor: RGBA.fromHex('#000000'),
    superSample: SuperSampleType.GPU
  });
  
  // Initialize the renderer
  await threeRenderer.init();
  
  // Create a camera
  const camera = new PerspectiveCamera(75, threeRenderer.aspectRatio, 0.1, 1000);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  threeRenderer.setActiveCamera(camera);
  
  // Add a light
  const light = new DirectionalLight(0xffffff, 1);
  light.position.set(1, 1, 1);
  scene.add(light);
  
  // Create a cube
  const geometry = new BoxGeometry(2, 2, 2);
  const material = new MeshPhongNodeMaterial({
    color: new Color(0x3498db),
    emissive: new Color(0x000000),
    specular: new Color(0x111111),
    shininess: 30
  });
  const cube = new Mesh(geometry, material);
  scene.add(cube);
  
  // Animate the cube
  renderer.on('update', async (context) => {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    
    await threeRenderer.drawScene(scene, renderer.buffer, context.deltaTime);
  });
  
  // Handle keyboard input
  renderer.on('key', (data) => {
    const key = data.toString();
    
    if (key === 's') {
      threeRenderer.toggleSuperSampling();
    } else if (key === 'q') {
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

## Example: Creating a Shader Effect

```typescript
import { 
  createCliRenderer, 
  ThreeCliRenderer, 
  SuperSampleType,
  Scene, 
  PerspectiveCamera, 
  PlaneGeometry, 
  Mesh, 
  ShaderMaterial,
  RGBA
} from '@opentui/core';

async function createShaderDemo() {
  // Create a CLI renderer
  const renderer = await createCliRenderer();
  
  // Create a Three.js scene
  const scene = new Scene();
  
  // Create a ThreeCliRenderer
  const threeRenderer = new ThreeCliRenderer(renderer, {
    width: 80,
    height: 40,
    backgroundColor: RGBA.fromHex('#000000'),
    superSample: SuperSampleType.GPU
  });
  
  // Initialize the renderer
  await threeRenderer.init();
  
  // Create a camera
  const camera = new PerspectiveCamera(75, threeRenderer.aspectRatio, 0.1, 1000);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  threeRenderer.setActiveCamera(camera);
  
  // Create a shader material
  const material = new ShaderMaterial({
    vertexShader: `
      @vertex
      fn main(@location(0) position: vec3<f32>,
              @location(1) uv: vec2<f32>) -> @builtin(position) vec4<f32> {
        return vec4<f32>(position, 1.0);
      }
    `,
    fragmentShader: `
      @group(0) @binding(0) var<uniform> time: f32;
      
      @fragment
      fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
        let color = vec3<f32>(
          sin(uv.x * 10.0 + time) * 0.5 + 0.5,
          sin(uv.y * 10.0 + time * 0.5) * 0.5 + 0.5,
          sin((uv.x + uv.y) * 5.0 + time * 0.2) * 0.5 + 0.5
        );
        return vec4<f32>(color, 1.0);
      }
    `,
    uniforms: {
      time: { value: 0 }
    }
  });
  
  // Create a plane with the shader material
  const geometry = new PlaneGeometry(4, 4);
  const plane = new Mesh(geometry, material);
  scene.add(plane);
  
  // Animate the shader
  let time = 0;
  renderer.on('update', async (context) => {
    time += context.deltaTime;
    material.uniforms.time.value = time;
    
    await threeRenderer.drawScene(scene, renderer.buffer, context.deltaTime);
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the shader demo
createShaderDemo().catch(console.error);
```
