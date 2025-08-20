# Sprite Animation

OpenTUI provides powerful sprite animation capabilities for creating dynamic and interactive terminal user interfaces.

## Sprite Resource Manager

The `SpriteResourceManager` class is responsible for loading, managing, and releasing sprite resources.

```typescript
import { SpriteResourceManager } from '@opentui/core/3d';
import { Scene } from 'three';

// Create a scene
const scene = new Scene();

// Create a sprite resource manager
const spriteManager = new SpriteResourceManager(scene);

// Create a sprite resource
const spriteResource = await spriteManager.createResource({
  imagePath: 'path/to/sprite.png',
  sheetNumFrames: 8
});

// Clear the cache
spriteManager.clearCache();
```

## Sprite Animator

The `SpriteAnimator` class provides functionality for animating sprites with frame-based animations.

```typescript
import { SpriteAnimator, SpriteDefinition } from '@opentui/core/3d';
import { Scene } from 'three';

// Create a scene
const scene = new Scene();

// Create a sprite animator
const animator = new SpriteAnimator(scene);

// Define a sprite with animations
const spriteDefinition: SpriteDefinition = {
  initialAnimation: 'idle',
  scale: 1.0,
  maxInstances: 100,
  animations: {
    idle: {
      resource: spriteResource,
      animNumFrames: 4,
      animFrameOffset: 0,
      frameDuration: 100,
      loop: true
    },
    run: {
      resource: spriteResource,
      animNumFrames: 6,
      animFrameOffset: 4,
      frameDuration: 80,
      loop: true
    }
  }
};

// Create a sprite instance
const sprite = await animator.createSprite('player', spriteDefinition);

// Play the animation
sprite.play();

// Stop the animation
sprite.stop();

// Go to a specific frame
sprite.goToFrame(2);

// Change animation
await sprite.setAnimation('run');

// Check if animation is playing
const isPlaying = sprite.isPlaying();

// Set animation speed by changing frame duration
sprite.setFrameDuration(50); // faster animation

// Update animations (call in animation loop)
animator.update(deltaTime);
```

## Sprite Animation Component

Here's an example of creating a custom component for sprite animation:

```typescript
import { Renderable, OptimizedBuffer, RGBA } from '@opentui/core';
import { SpriteAnimator, SpriteResourceManager } from '@opentui/core/3d';

interface SpriteRenderableOptions {
  width?: number;
  height?: number;
  spriteSheet: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  frameDuration?: number;
  loop?: boolean;
}

class SpriteRenderable extends Renderable {
  private animator: SpriteAnimator;
  
  constructor(id: string, options: SpriteRenderableOptions) {
    super(id, {
      width: options.width ?? options.frameWidth,
      height: options.height ?? options.frameHeight,
      position: 'absolute',
      ...options
    });
    
    // Load the sprite sheet
    const spriteManager = new SpriteResourceManager();
    spriteManager.loadSprite(options.spriteSheet).then(sprite => {
      // Create the animator
      this.animator = new SpriteAnimator({
        spriteSheet: sprite,
        frameWidth: options.frameWidth,
        frameHeight: options.frameHeight,
        frameCount: options.frameCount,
        frameDuration: options.frameDuration ?? 100,
        loop: options.loop ?? true
      });
      
      // Start the animation
      this.animator.play();
    });
  }
  
  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.animator) return;
    
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
  
  // Control methods
  public play(): void {
    if (this.animator) this.animator.play();
  }
  
  public pause(): void {
    if (this.animator) this.animator.pause();
  }
  
  public stop(): void {
    if (this.animator) this.animator.stop();
  }
  
  public setFrame(frame: number): void {
    if (this.animator) this.animator.setFrame(frame);
  }
  
  public setSpeed(speed: number): void {
    if (this.animator) this.animator.setSpeed(speed);
  }
}
```

## Sprite Particle Effects

OpenTUI provides classes for creating particle effects using sprites.

### Exploding Sprite Effect

The `ExplodingSpriteEffect` class creates an explosion effect from a sprite.

```typescript
import { ExplodingSpriteEffect } from '@opentui/core/3d';

// Create an exploding sprite effect
const explosion = new ExplodingSpriteEffect({
  sprite: sprite,
  position: { x: 50, y: 50 },
  particleCount: 50,
  minSpeed: 10,
  maxSpeed: 30,
  minLifetime: 500,
  maxLifetime: 1500,
  gravity: { x: 0, y: 9.8 },
  fadeOut: true
});

// Start the effect
explosion.start();

// Update the effect
explosion.update(deltaTime);

// Render the effect
explosion.render(buffer);

// Check if the effect is complete
const isComplete = explosion.isComplete();
```

### Physics-Based Exploding Sprite Effect

The `PhysicsExplodingSpriteEffect` class creates a physics-based explosion effect.

```typescript
import { PhysicsExplodingSpriteEffect } from '@opentui/core/3d';
import { PlanckPhysicsAdapter } from '@opentui/core/3d';

// Create a physics adapter
const physics = new PlanckPhysicsAdapter({
  gravity: { x: 0, y: 9.8 },
  scale: 30
});

// Create a physics-based exploding sprite effect
const explosion = new PhysicsExplodingSpriteEffect({
  sprite: sprite,
  position: { x: 50, y: 50 },
  particleCount: 50,
  minImpulse: 1,
  maxImpulse: 5,
  minAngularVelocity: -5,
  maxAngularVelocity: 5,
  minLifetime: 500,
  maxLifetime: 1500,
  physics: physics,
  fadeOut: true
});

// Start the effect
explosion.start();

// Update the effect
explosion.update(deltaTime);

// Render the effect
explosion.render(buffer);

// Check if the effect is complete
const isComplete = explosion.isComplete();
```

### Sprite Particle Generator

The `SpriteParticleGenerator` class provides a more general-purpose particle system.

```typescript
import { SpriteParticleGenerator } from '@opentui/core/3d';

// Create a sprite particle generator
const particleGenerator = new SpriteParticleGenerator({
  sprite: sprite,
  position: { x: 50, y: 50 },
  emissionRate: 10, // particles per second
  minSpeed: 10,
  maxSpeed: 30,
  minDirection: 0,
  maxDirection: Math.PI * 2,
  minLifetime: 500,
  maxLifetime: 1500,
  minScale: 0.5,
  maxScale: 1.5,
  gravity: { x: 0, y: 9.8 },
  fadeOut: true
});

// Start the generator
particleGenerator.start();

// Stop the generator
particleGenerator.stop();

// Update the generator
particleGenerator.update(deltaTime);

// Render the particles
particleGenerator.render(buffer);

// Set the position
particleGenerator.setPosition({ x: 60, y: 40 });

// Set the emission rate
particleGenerator.setEmissionRate(20);
```

## Example: Character Animation

Here's a complete example of a character animation:

```typescript
import { createCliRenderer, BoxRenderable } from '@opentui/core';
import { SpriteAnimator, SpriteResourceManager } from '@opentui/core/3d';

class CharacterRenderable extends BoxRenderable {
  private spriteManager: SpriteResourceManager;
  private idleAnimator: SpriteAnimator;
  private runAnimator: SpriteAnimator;
  private jumpAnimator: SpriteAnimator;
  private currentAnimator: SpriteAnimator;
  private state: 'idle' | 'run' | 'jump' = 'idle';
  
  constructor(id: string, options = {}) {
    super(id, {
      width: 16,
      height: 24,
      position: 'absolute',
      x: 50,
      y: 50,
      border: false,
      ...options
    });
    
    this.spriteManager = new SpriteResourceManager();
    this.loadAnimations();
  }
  
  private async loadAnimations() {
    // Load sprite sheets
    const idleSprite = await this.spriteManager.loadSprite('src/examples/assets/main_char_idle.png');
    const runSprite = await this.spriteManager.loadSprite('src/examples/assets/main_char_run_loop.png');
    const jumpSprite = await this.spriteManager.loadSprite('src/examples/assets/main_char_jump_start.png');
    
    // Create animators
    this.idleAnimator = new SpriteAnimator({
      spriteSheet: idleSprite,
      frameWidth: 16,
      frameHeight: 24,
      frameCount: 4,
      frameDuration: 200,
      loop: true
    });
    
    this.runAnimator = new SpriteAnimator({
      spriteSheet: runSprite,
      frameWidth: 16,
      frameHeight: 24,
      frameCount: 6,
      frameDuration: 100,
      loop: true
    });
    
    this.jumpAnimator = new SpriteAnimator({
      spriteSheet: jumpSprite,
      frameWidth: 16,
      frameHeight: 24,
      frameCount: 3,
      frameDuration: 150,
      loop: false
    });
    
    // Set the current animator to idle
    this.currentAnimator = this.idleAnimator;
    this.currentAnimator.play();
  }
  
  public setState(state: 'idle' | 'run' | 'jump') {
    if (this.state === state) return;
    
    this.state = state;
    
    // Stop the current animator
    if (this.currentAnimator) {
      this.currentAnimator.stop();
    }
    
    // Set the new animator
    switch (state) {
      case 'idle':
        this.currentAnimator = this.idleAnimator;
        break;
      case 'run':
        this.currentAnimator = this.runAnimator;
        break;
      case 'jump':
        this.currentAnimator = this.jumpAnimator;
        break;
    }
    
    // Start the new animator
    if (this.currentAnimator) {
      this.currentAnimator.play();
    }
  }
  
  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.currentAnimator) return;
    
    // Update the animation
    this.currentAnimator.update(deltaTime);
    
    // Get the current frame
    const frame = this.currentAnimator.getCurrentFrame();
    
    // Render the sprite
    if (frame) {
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          // Sample the sprite pixel
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
    
    // If jump animation is complete, go back to idle
    if (this.state === 'jump' && !this.currentAnimator.isPlaying()) {
      this.setState('idle');
    }
  }
}

async function createCharacterAnimationDemo() {
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
  
  // Create a character
  const character = new CharacterRenderable('character');
  container.add(character);
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'ArrowRight' || keyStr === 'ArrowLeft') {
      character.setState('run');
      
      // Move the character
      if (keyStr === 'ArrowRight') {
        character.x += 1;
      } else {
        character.x -= 1;
      }
    } else if (keyStr === 'ArrowUp' || keyStr === ' ') {
      character.setState('jump');
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      renderer.destroy();
      process.exit(0);
    } else {
      character.setState('idle');
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the character animation demo
createCharacterAnimationDemo().catch(console.error);
```
