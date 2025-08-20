# Animation API

OpenTUI provides powerful animation capabilities for creating dynamic and interactive terminal user interfaces.

## Timeline

The `Timeline` class is the core of OpenTUI's animation system, allowing you to create and manage animations with precise timing control.

### Creating a Timeline

```typescript
import { Timeline } from '@opentui/core';

// Create a timeline with default options
const timeline = new Timeline();

// Create a timeline with custom options
const customTimeline = new Timeline({
  duration: 1000,       // Duration in milliseconds
  easing: 'easeInOut',  // Easing function
  repeat: 2,            // Number of repetitions (0 = no repeat, -1 = infinite)
  yoyo: true            // Whether to reverse on alternate repetitions
});
```

### Timeline Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `duration` | `number` | `1000` | Duration in milliseconds |
| `easing` | `string \| Function` | `'linear'` | Easing function |
| `repeat` | `number` | `0` | Number of repetitions (0 = no repeat, -1 = infinite) |
| `yoyo` | `boolean` | `false` | Whether to reverse on alternate repetitions |
| `autoPlay` | `boolean` | `false` | Whether to start playing automatically |
| `onComplete` | `Function` | `undefined` | Callback when animation completes |
| `onRepeat` | `Function` | `undefined` | Callback on each repetition |
| `onUpdate` | `Function` | `undefined` | Callback on each update |

### Controlling Animations

```typescript
// Start the animation
timeline.play();

// Pause the animation
timeline.pause();

// Resume the animation
timeline.resume();

// Stop the animation and reset to beginning
timeline.stop();

// Restart the animation from the beginning
timeline.restart();

// Reverse the animation direction
timeline.reverse();

// Check if the animation is playing
const isPlaying = timeline.isPlaying();

// Get the current progress (0-1)
const progress = timeline.getProgress();

// Set the progress manually (0-1)
timeline.setProgress(0.5);

// Get the current time in milliseconds
const time = timeline.getCurrentTime();

// Set the current time in milliseconds
timeline.setCurrentTime(500);
```

### Adding Animations

```typescript
// Animate a property
timeline.to(target, {
  property: 'x',        // Property to animate
  from: 0,              // Starting value
  to: 100,              // Ending value
  duration: 1000,       // Duration in milliseconds
  easing: 'easeInOut',  // Easing function
  onUpdate: (value) => {
    // Custom update logic
    console.log('Current value:', value);
  }
});

// Animate multiple properties
timeline.to(target, {
  properties: {
    x: { from: 0, to: 100 },
    y: { from: 0, to: 50 },
    opacity: { from: 0, to: 1 }
  },
  duration: 1000,
  easing: 'easeInOut'
});

// Add a delay
timeline.delay(500);

// Add a callback
timeline.call(() => {
  console.log('Animation reached this point');
});
```

### Easing Functions

OpenTUI provides various easing functions for animations:

| Easing | Description |
|--------|-------------|
| `'linear'` | Linear easing (no acceleration) |
| `'easeIn'` | Accelerating from zero velocity |
| `'easeOut'` | Decelerating to zero velocity |
| `'easeInOut'` | Acceleration until halfway, then deceleration |
| `'easeInQuad'` | Quadratic easing in |
| `'easeOutQuad'` | Quadratic easing out |
| `'easeInOutQuad'` | Quadratic easing in and out |
| `'easeInCubic'` | Cubic easing in |
| `'easeOutCubic'` | Cubic easing out |
| `'easeInOutCubic'` | Cubic easing in and out |
| `'easeInElastic'` | Elastic easing in |
| `'easeOutElastic'` | Elastic easing out |
| `'easeInOutElastic'` | Elastic easing in and out |
| `'easeInBounce'` | Bouncing easing in |
| `'easeOutBounce'` | Bouncing easing out |
| `'easeInOutBounce'` | Bouncing easing in and out |

You can also provide a custom easing function:

```typescript
// Custom easing function (t: 0-1)
const customEasing = (t: number): number => {
  return t * t * (3 - 2 * t); // Custom smoothstep
};

timeline.to(target, {
  property: 'x',
  from: 0,
  to: 100,
  duration: 1000,
  easing: customEasing
});
```

### Example: Animating a Box

```typescript
import { createCliRenderer, BoxRenderable, Timeline } from '@opentui/core';

async function animateBox() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a box
  const box = new BoxRenderable('box', {
    width: 10,
    height: 5,
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    position: 'absolute',
    x: 0,
    y: 10
  });
  
  root.add(box);
  
  // Create a timeline
  const timeline = new Timeline({
    repeat: -1,  // Infinite repeat
    yoyo: true,  // Reverse on alternate repetitions
    autoPlay: true
  });
  
  // Animate the box horizontally
  timeline.to(box, {
    property: 'x',
    from: 0,
    to: renderer.width - box.width,
    duration: 3000,
    easing: 'easeInOutQuad'
  });
  
  // Add a color animation
  timeline.to(box, {
    property: 'borderColor',
    from: '#3498db',
    to: '#e74c3c',
    duration: 1500,
    easing: 'linear'
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the animation
animateBox().catch(console.error);
```

### Chaining Animations

You can chain animations to create complex sequences:

```typescript
// Create a sequence of animations
timeline
  .to(box, {
    property: 'x',
    from: 0,
    to: 100,
    duration: 1000
  })
  .delay(500)
  .to(box, {
    property: 'y',
    from: 0,
    to: 50,
    duration: 1000
  })
  .call(() => {
    console.log('Horizontal and vertical movement complete');
  })
  .to(box, {
    property: 'borderColor',
    from: '#3498db',
    to: '#e74c3c',
    duration: 500
  });
```

### Parallel Animations

You can run multiple animations in parallel:

```typescript
// Create parallel animations
const timeline = new Timeline();

// Add multiple animations that will run simultaneously
timeline.to(box1, {
  property: 'x',
  from: 0,
  to: 100,
  duration: 1000
});

timeline.to(box2, {
  property: 'y',
  from: 0,
  to: 50,
  duration: 1000
});

// Start all animations
timeline.play();
```

## Sprite Animation

OpenTUI provides sprite animation capabilities for creating animated characters and effects.

### SpriteAnimator

The `SpriteAnimator` class allows you to create frame-based animations from sprite sheets.

```typescript
import { SpriteAnimator } from '@opentui/core/3d';
import Jimp from 'jimp';

// Load a sprite sheet
const spriteSheet = await Jimp.read('path/to/sprite_sheet.png');

// Create a sprite animator
const animator = new SpriteAnimator({
  image: spriteSheet,
  frameWidth: 32,    // Width of each frame
  frameHeight: 32,   // Height of each frame
  frameCount: 8,     // Total number of frames
  frameDuration: 100 // Duration of each frame in milliseconds
});

// Start the animation
animator.play();

// Pause the animation
animator.pause();

// Set the current frame
animator.setFrame(3);

// Get the current frame
const currentFrame = animator.getCurrentFrame();

// Update the animation (call in render loop)
animator.update(deltaTime);
```

### Example: Creating an Animated Character

```typescript
import { createCliRenderer, BoxRenderable, RGBA } from '@opentui/core';
import { SpriteAnimator } from '@opentui/core/3d';
import Jimp from 'jimp';

async function createAnimatedCharacter() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    border: false,
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Load character sprite sheet
  const spriteSheet = await Jimp.read('path/to/character_run.png');
  
  // Create a sprite animator
  const characterAnimator = new SpriteAnimator({
    image: spriteSheet,
    frameWidth: 32,
    frameHeight: 32,
    frameCount: 8,
    frameDuration: 100
  });
  
  // Create a custom renderable for the character
  class CharacterRenderable extends BoxRenderable {
    private animator: SpriteAnimator;
    
    constructor(id: string, animator: SpriteAnimator, options = {}) {
      super(id, {
        width: 16,
        height: 8,
        border: false,
        position: 'absolute',
        x: 10,
        y: 10,
        ...options
      });
      
      this.animator = animator;
      this.animator.play();
    }
    
    protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
      // Update the animation
      this.animator.update(deltaTime);
      
      // Get the current frame
      const frame = this.animator.getCurrentFrame();
      
      // Render the sprite with proper scaling
      if (frame) {
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            // Sample the sprite pixel with bilinear interpolation for smoother scaling
            const pixelX = Math.floor(x * (frame.width / this.width));
            const pixelY = Math.floor(y * (frame.height / this.height));
            
            // Get pixel color from the sprite frame
            const idx = (pixelY * frame.width + pixelX) * 4;
            const r = frame.data[idx] / 255;
            const g = frame.data[idx + 1] / 255;
            const b = frame.data[idx + 2] / 255;
            const a = frame.data[idx + 3] / 255;
            
            if (a > 0.5) {
              // Draw the pixel
              buffer.setCell(
                this.x + x,
                this.y + y,
                ' ',
                RGBA.fromValues(0, 0, 0, 0),
                RGBA.fromValues(r, g, b, a)
              );
            }
          }
        }
      }
    }
  }
  
  // Create the character
  const character = new CharacterRenderable('character', characterAnimator);
  container.add(character);
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the animation
createAnimatedCharacter().catch(console.error);
```

## Particle Effects

OpenTUI provides particle system capabilities for creating visual effects.

### SpriteParticleGenerator

The `SpriteParticleGenerator` class allows you to create particle effects.

```typescript
import { SpriteParticleGenerator } from '@opentui/core/3d';
import Jimp from 'jimp';

// Load a particle texture
const particleTexture = await Jimp.read('path/to/particle.png');

// Create a particle generator
const particles = new SpriteParticleGenerator({
  texture: particleTexture,
  maxParticles: 100,
  emissionRate: 10,    // Particles per second
  particleLifetime: {
    min: 1000,         // Minimum lifetime in milliseconds
    max: 3000          // Maximum lifetime in milliseconds
  },
  position: { x: 40, y: 20 },
  positionVariance: { x: 5, y: 0 },
  velocity: { x: 0, y: -0.05 },
  velocityVariance: { x: 0.02, y: 0.01 },
  acceleration: { x: 0, y: 0.0001 },
  startScale: { min: 0.5, max: 1.0 },
  endScale: { min: 0, max: 0.2 },
  startColor: RGBA.fromHex('#ffff00'),
  endColor: RGBA.fromHex('#ff0000'),
  startAlpha: 1.0,
  endAlpha: 0.0,
  rotationSpeed: { min: -0.1, max: 0.1 }
});

// Start emitting particles
particles.start();

// Stop emitting particles
particles.stop();

// Update the particle system (call in render loop)
particles.update(deltaTime);

// Render the particles (call in render method)
particles.render(buffer, x, y);
```

### Example: Creating a Fire Effect

```typescript
import { createCliRenderer, BoxRenderable, RGBA } from '@opentui/core';
import { SpriteParticleGenerator } from '@opentui/core/3d';
import Jimp from 'jimp';

async function createFireEffect() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    border: false,
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Load particle texture
  const particleTexture = await Jimp.read('path/to/particle.png');
  
  // Create a fire particle effect
  const fireEffect = new SpriteParticleGenerator({
    texture: particleTexture,
    maxParticles: 200,
    emissionRate: 50,
    particleLifetime: {
      min: 500,
      max: 1500
    },
    position: { x: renderer.width / 2, y: renderer.height - 5 },
    positionVariance: { x: 3, y: 0 },
    velocity: { x: 0, y: -0.08 },
    velocityVariance: { x: 0.03, y: 0.02 },
    acceleration: { x: 0, y: -0.0001 },
    startScale: { min: 0.8, max: 1.2 },
    endScale: { min: 0.1, max: 0.3 },
    startColor: RGBA.fromHex('#ffff00'),
    endColor: RGBA.fromHex('#ff0000'),
    startAlpha: 1.0,
    endAlpha: 0.0,
    rotationSpeed: { min: -0.05, max: 0.05 }
  });
  
  // Create a custom renderable for the fire
  class FireRenderable extends BoxRenderable {
    private particles: SpriteParticleGenerator;
    
    constructor(id: string, particles: SpriteParticleGenerator, options = {}) {
      super(id, {
        width: '100%',
        height: '100%',
        border: false,
        ...options
      });
      
      this.particles = particles;
      this.particles.start();
    }
    
    protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
      // Update the particles
      this.particles.update(deltaTime);
      
      // Render the particles
      this.particles.render(buffer, 0, 0);
    }
  }
  
  // Create the fire effect
  const fire = new FireRenderable('fire', fireEffect);
  container.add(fire);
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the fire effect
createFireEffect().catch(console.error);
```

## Physics-Based Animation

OpenTUI supports physics-based animations through integration with physics engines.

### RapierPhysicsAdapter

The `RapierPhysicsAdapter` class provides integration with the Rapier 2D physics engine.

```typescript
import { RapierPhysicsAdapter } from '@opentui/core/3d/physics';

// Create a physics world
const physics = new RapierPhysicsAdapter({
  gravity: { x: 0, y: 9.81 }
});

// Create a static ground body
const ground = physics.createStaticBody({
  position: { x: 40, y: 40 },
  shape: {
    type: 'box',
    width: 80,
    height: 2
  }
});

// Create a dynamic box body
const box = physics.createDynamicBody({
  position: { x: 40, y: 10 },
  shape: {
    type: 'box',
    width: 4,
    height: 4
  },
  restitution: 0.5,  // Bounciness
  friction: 0.2      // Friction
});

// Update the physics world (call in render loop)
physics.update(deltaTime);

// Get the position of the box
const position = box.getPosition();
```

### PlanckPhysicsAdapter

The `PlanckPhysicsAdapter` class provides integration with the Planck.js physics engine.

```typescript
import { PlanckPhysicsAdapter } from '@opentui/core/3d/physics';

// Create a physics world
const physics = new PlanckPhysicsAdapter({
  gravity: { x: 0, y: 10 }
});

// Create a static ground body
const ground = physics.createStaticBody({
  position: { x: 40, y: 40 },
  shape: {
    type: 'box',
    width: 80,
    height: 2
  }
});

// Create a dynamic circle body
const ball = physics.createDynamicBody({
  position: { x: 40, y: 10 },
  shape: {
    type: 'circle',
    radius: 2
  },
  restitution: 0.8,  // Bounciness
  friction: 0.1      // Friction
});

// Apply an impulse to the ball
ball.applyLinearImpulse({ x: 5, y: -5 });

// Update the physics world (call in render loop)
physics.update(deltaTime);
```

### Example: Creating a Physics Simulation

```typescript
import { createCliRenderer, BoxRenderable, RGBA } from '@opentui/core';
import { RapierPhysicsAdapter } from '@opentui/core/3d/physics';

async function createPhysicsSimulation() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    border: false,
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Create a physics world
  const physics = new RapierPhysicsAdapter({
    gravity: { x: 0, y: 20 }
  });
  
  // Create a static ground body
  const ground = physics.createStaticBody({
    position: { x: renderer.width / 2, y: renderer.height - 5 },
    shape: {
      type: 'box',
      width: renderer.width,
      height: 2
    }
  });
  
  // Create walls
  const leftWall = physics.createStaticBody({
    position: { x: 2, y: renderer.height / 2 },
    shape: {
      type: 'box',
      width: 2,
      height: renderer.height
    }
  });
  
  const rightWall = physics.createStaticBody({
    position: { x: renderer.width - 2, y: renderer.height / 2 },
    shape: {
      type: 'box',
      width: 2,
      height: renderer.height
    }
  });
  
  // Create some dynamic bodies
  const bodies = [];
  const renderables = [];
  
  for (let i = 0; i < 10; i++) {
    // Create a dynamic body
    const body = physics.createDynamicBody({
      position: {
        x: 10 + Math.random() * (renderer.width - 20),
        y: 5 + Math.random() * 10
      },
      shape: {
        type: Math.random() > 0.5 ? 'box' : 'circle',
        width: 3 + Math.random() * 3,
        height: 3 + Math.random() * 3,
        radius: 2 + Math.random() * 2
      },
      restitution: 0.3 + Math.random() * 0.5,
      friction: 0.1 + Math.random() * 0.3
    });
    
    bodies.push(body);
    
    // Create a renderable for the body
    const isBox = body.getShapeType() === 'box';
    const size = isBox ? body.getSize() : { width: body.getRadius() * 2, height: body.getRadius() * 2 };
    
    const renderable = new BoxRenderable(`body${i}`, {
      width: size.width,
      height: size.height,
      position: 'absolute',
      x: body.getPosition().x - size.width / 2,
      y: body.getPosition().y - size.height / 2,
      borderStyle: isBox ? 'single' : 'rounded',
      borderColor: RGBA.fromHex(
        ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6'][Math.floor(Math.random() * 5)]
      ),
      backgroundColor: 'transparent'
    });
    
    renderables.push(renderable);
    container.add(renderable);
  }
  
  // Create a frame callback to update physics
  renderer.setFrameCallback(async (deltaTime) => {
    // Update physics (with fixed timestep)
    const fixedDelta = Math.min(deltaTime, 33) / 1000; // Cap at 30 FPS, convert to seconds
    physics.update(fixedDelta);
    
    // Update renderables
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const renderable = renderables[i];
      const position = body.getPosition();
      const angle = body.getAngle();
      
      // Update position
      renderable.x = position.x - renderable.width / 2;
      renderable.y = position.y - renderable.height / 2;
      
      // We could update rotation too if OpenTUI supported it
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the physics simulation
createPhysicsSimulation().catch(console.error);
```
