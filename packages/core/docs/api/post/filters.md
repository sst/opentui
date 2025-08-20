# Post-Processing Filters

OpenTUI provides a set of post-processing filters that can be applied to the terminal output to create various visual effects.

## Overview

Post-processing filters allow you to modify the appearance of the terminal output after it has been rendered. This can be used to create visual effects like scanlines, grayscale, sepia tone, and more.

## Basic Filters

### Scanlines

Applies a scanline effect by darkening every nth row.

```typescript
import { applyScanlines, createCliRenderer, BoxRenderable } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a component
const box = new BoxRenderable('box', {
  width: 40,
  height: 20,
  borderStyle: 'single',
  borderColor: '#3498db',
  backgroundColor: '#222222'
});

renderer.root.add(box);

// Apply scanlines to the renderer's buffer
renderer.on('afterRender', () => {
  applyScanlines(renderer.buffer, 0.8, 2);
});
```

### Grayscale

Converts the buffer colors to grayscale.

```typescript
import { applyGrayscale, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Apply grayscale to the renderer's buffer
renderer.on('afterRender', () => {
  applyGrayscale(renderer.buffer);
});
```

### Sepia Tone

Applies a sepia tone to the buffer.

```typescript
import { applySepia, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Apply sepia tone to the renderer's buffer
renderer.on('afterRender', () => {
  applySepia(renderer.buffer);
});
```

### Invert Colors

Inverts the colors in the buffer.

```typescript
import { applyInvert, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Apply color inversion to the renderer's buffer
renderer.on('afterRender', () => {
  applyInvert(renderer.buffer);
});
```

### Noise

Adds random noise to the buffer colors.

```typescript
import { applyNoise, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Apply noise to the renderer's buffer
renderer.on('afterRender', () => {
  applyNoise(renderer.buffer, 0.1);
});
```

### Chromatic Aberration

Applies a simplified chromatic aberration effect.

```typescript
import { applyChromaticAberration, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Apply chromatic aberration to the renderer's buffer
renderer.on('afterRender', () => {
  applyChromaticAberration(renderer.buffer, 1);
});
```

### ASCII Art

Converts the buffer to ASCII art based on background brightness.

```typescript
import { applyAsciiArt, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Apply ASCII art effect to the renderer's buffer
renderer.on('afterRender', () => {
  applyAsciiArt(renderer.buffer, " .:-=+*#%@");
});
```

## Advanced Effects

### Distortion Effect

The `DistortionEffect` class provides an animated glitch/distortion effect.

```typescript
import { DistortionEffect, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a distortion effect
const distortion = new DistortionEffect({
  glitchChancePerSecond: 0.5,
  maxGlitchLines: 3,
  minGlitchDuration: 0.05,
  maxGlitchDuration: 0.2,
  maxShiftAmount: 10,
  shiftFlipRatio: 0.6,
  colorGlitchChance: 0.2
});

// Apply the distortion effect in the render loop
renderer.on('afterRender', (context) => {
  distortion.apply(renderer.buffer, context.deltaTime);
});
```

### Vignette Effect

The `VignetteEffect` class adds a vignette (darkened corners) to the buffer.

```typescript
import { VignetteEffect, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a vignette effect
const vignette = new VignetteEffect({
  strength: 0.7,
  size: 0.8,
  smoothness: 0.5
});

// Apply the vignette effect in the render loop
renderer.on('afterRender', () => {
  vignette.apply(renderer.buffer);
});
```

### Brightness Effect

The `BrightnessEffect` class adjusts the brightness of the buffer.

```typescript
import { BrightnessEffect, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a brightness effect
const brightness = new BrightnessEffect({
  value: 1.2 // Values > 1 increase brightness, < 1 decrease brightness
});

// Apply the brightness effect in the render loop
renderer.on('afterRender', () => {
  brightness.apply(renderer.buffer);
});
```

### Blur Effect

The `BlurEffect` class applies a blur effect to the buffer.

```typescript
import { BlurEffect, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a blur effect
const blur = new BlurEffect({
  radius: 1,
  passes: 2
});

// Apply the blur effect in the render loop
renderer.on('afterRender', () => {
  blur.apply(renderer.buffer);
});
```

### Bloom Effect

The `BloomEffect` class applies a bloom effect to bright areas of the buffer.

```typescript
import { BloomEffect, createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a bloom effect
const bloom = new BloomEffect({
  threshold: 0.7,
  intensity: 0.5,
  radius: 1
});

// Apply the bloom effect in the render loop
renderer.on('afterRender', () => {
  bloom.apply(renderer.buffer);
});
```

## Combining Effects

You can combine multiple effects to create more complex visual styles.

```typescript
import { 
  applyGrayscale, 
  applyScanlines, 
  VignetteEffect, 
  createCliRenderer 
} from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a vignette effect
const vignette = new VignetteEffect({
  strength: 0.7,
  size: 0.8,
  smoothness: 0.5
});

// Apply multiple effects in the render loop
renderer.on('afterRender', () => {
  // Apply effects in sequence
  applyGrayscale(renderer.buffer);
  applyScanlines(renderer.buffer, 0.8, 2);
  vignette.apply(renderer.buffer);
});
```

## Example: Creating a Retro Terminal Effect

```typescript
import { 
  createCliRenderer, 
  BoxRenderable, 
  TextRenderable,
  applyGrayscale,
  applyScanlines,
  applyNoise,
  VignetteEffect
} from '@opentui/core';

async function createRetroTerminal() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'single',
    borderColor: '#00ff00',
    backgroundColor: '#001100'
  });
  
  // Create a text element
  const text = new TextRenderable('text', {
    content: 'TERMINAL READY\n\n> _',
    fg: '#00ff00',
    padding: 1,
    flexGrow: 1
  });
  
  // Build the component tree
  container.add(text);
  root.add(container);
  
  // Create a vignette effect
  const vignette = new VignetteEffect({
    strength: 0.6,
    size: 0.75,
    smoothness: 0.3
  });
  
  // Apply retro effects
  renderer.on('afterRender', (context) => {
    // Apply green monochrome effect
    applyGrayscale(renderer.buffer);
    
    // Apply scanlines
    applyScanlines(renderer.buffer, 0.7, 2);
    
    // Add some noise
    applyNoise(renderer.buffer, 0.05);
    
    // Add vignette
    vignette.apply(renderer.buffer);
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the retro terminal
createRetroTerminal().catch(console.error);
```

## Example: Creating a Glitch Effect

```typescript
import { 
  createCliRenderer, 
  BoxRenderable, 
  TextRenderable,
  DistortionEffect,
  applyChromaticAberration
} from '@opentui/core';

async function createGlitchEffect() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'double',
    borderColor: '#ff00ff',
    backgroundColor: '#110022'
  });
  
  // Create a text element
  const text = new TextRenderable('text', {
    content: 'SYSTEM ERROR\nCORRUPTION DETECTED\nATTEMPTING RECOVERY...',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  // Build the component tree
  container.add(text);
  root.add(container);
  
  // Create a distortion effect
  const distortion = new DistortionEffect({
    glitchChancePerSecond: 0.8,
    maxGlitchLines: 5,
    minGlitchDuration: 0.1,
    maxGlitchDuration: 0.3,
    maxShiftAmount: 15,
    shiftFlipRatio: 0.7,
    colorGlitchChance: 0.3
  });
  
  // Apply glitch effects
  renderer.on('afterRender', (context) => {
    // Apply chromatic aberration
    applyChromaticAberration(renderer.buffer, 2);
    
    // Apply distortion
    distortion.apply(renderer.buffer, context.deltaTime);
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the glitch effect
createGlitchEffect().catch(console.error);
```
