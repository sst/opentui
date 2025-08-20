# Physics Integration

OpenTUI provides physics integration through adapters for popular physics engines, allowing you to create realistic physics simulations in your terminal applications.

## Physics Interface

The physics integration is built around a common interface that allows different physics engines to be used interchangeably.

```typescript
import { PhysicsInterface } from '@opentui/core/3d';

// The physics interface defines common methods for working with physics engines
interface PhysicsInterface {
  createWorld(options?: PhysicsWorldOptions): PhysicsWorld;
  createStaticBody(options: BodyOptions): PhysicsBody;
  createDynamicBody(options: BodyOptions): PhysicsBody;
  createKinematicBody(options: BodyOptions): PhysicsBody;
  update(deltaTime: number): void;
  // ... other methods
}
```

## Physics Adapters

OpenTUI provides adapters for two popular physics engines:

### Planck.js Adapter

[Planck.js](https://github.com/shakiba/planck.js/) is a JavaScript rewrite of the Box2D physics engine.

```typescript
import { PlanckPhysicsAdapter } from '@opentui/core/3d';

// Create a Planck.js physics adapter
const physics = new PlanckPhysicsAdapter({
  gravity: { x: 0, y: 10 },
  scale: 30 // Pixels per meter
});

// Create a world
const world = physics.createWorld();

// Create a static ground body
const ground = physics.createStaticBody({
  position: { x: 50, y: 80 },
  shape: {
    type: 'box',
    width: 100,
    height: 5
  }
});

// Create a dynamic box body
const box = physics.createDynamicBody({
  position: { x: 50, y: 10 },
  shape: {
    type: 'box',
    width: 5,
    height: 5
  },
  restitution: 0.5, // Bounciness
  friction: 0.2
});

// Update the physics simulation
function update(deltaTime: number) {
  physics.update(deltaTime);
  
  // Get the new position of the box
  const position = box.getPosition();
  
  // Update your renderable with the new position
  boxRenderable.x = position.x - boxRenderable.width / 2;
  boxRenderable.y = position.y - boxRenderable.height / 2;
}
```

### Rapier Adapter

[Rapier](https://rapier.rs/) is a high-performance physics engine written in Rust with WebAssembly bindings.

```typescript
import { RapierPhysicsAdapter } from '@opentui/core/3d';

// Create a Rapier physics adapter
const physics = new RapierPhysicsAdapter({
  gravity: { x: 0, y: 9.81 },
  scale: 30 // Pixels per meter
});

// Create a world
const world = physics.createWorld();

// Create a static ground body
const ground = physics.createStaticBody({
  position: { x: 50, y: 80 },
  shape: {
    type: 'box',
    width: 100,
    height: 5
  }
});

// Create a dynamic circle body
const circle = physics.createDynamicBody({
  position: { x: 50, y: 10 },
  shape: {
    type: 'circle',
    radius: 3
  },
  restitution: 0.7, // Bounciness
  friction: 0.1
});

// Update the physics simulation
function update(deltaTime: number) {
  physics.update(deltaTime);
  
  // Get the new position of the circle
  const position = circle.getPosition();
  
  // Update your renderable with the new position
  circleRenderable.x = position.x - circleRenderable.width / 2;
  circleRenderable.y = position.y - circleRenderable.height / 2;
}
```

## Physics Bodies

Physics bodies represent physical objects in the simulation. There are three types of bodies:

- **Static Bodies**: Don't move and are not affected by forces
- **Dynamic Bodies**: Move and are affected by forces
- **Kinematic Bodies**: Move but are not affected by forces (controlled programmatically)

```typescript
// Create a static body (e.g., ground, walls)
const ground = physics.createStaticBody({
  position: { x: 50, y: 80 },
  shape: {
    type: 'box',
    width: 100,
    height: 5
  }
});

// Create a dynamic body (e.g., player, objects)
const box = physics.createDynamicBody({
  position: { x: 50, y: 10 },
  shape: {
    type: 'box',
    width: 5,
    height: 5
  },
  restitution: 0.5,
  friction: 0.2
});

// Create a kinematic body (e.g., moving platforms)
const platform = physics.createKinematicBody({
  position: { x: 30, y: 40 },
  shape: {
    type: 'box',
    width: 20,
    height: 2
  }
});

// Move a kinematic body programmatically
platform.setLinearVelocity({ x: 1, y: 0 });
```

## Shapes

Physics bodies can have different shapes:

- **Box**: Rectangular shape
- **Circle**: Circular shape
- **Polygon**: Custom polygon shape
- **Compound**: Multiple shapes combined

```typescript
// Box shape
const box = physics.createDynamicBody({
  position: { x: 50, y: 10 },
  shape: {
    type: 'box',
    width: 5,
    height: 5
  }
});

// Circle shape
const circle = physics.createDynamicBody({
  position: { x: 60, y: 10 },
  shape: {
    type: 'circle',
    radius: 3
  }
});

// Polygon shape
const polygon = physics.createDynamicBody({
  position: { x: 70, y: 10 },
  shape: {
    type: 'polygon',
    vertices: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 2.5, y: 5 }
    ]
  }
});
```

## Joints

Joints connect bodies together and constrain their movement:

- **Distance Joint**: Keeps bodies at a fixed distance
- **Revolute Joint**: Allows rotation around a point
- **Prismatic Joint**: Allows movement along an axis
- **Pulley Joint**: Connects bodies with a pulley system
- **Gear Joint**: Connects bodies with a gear ratio

```typescript
// Create a revolute joint (hinge)
const joint = physics.createRevoluteJoint({
  bodyA: box1,
  bodyB: box2,
  anchorPoint: { x: 55, y: 10 },
  collideConnected: false
});

// Create a distance joint (spring)
const spring = physics.createDistanceJoint({
  bodyA: box1,
  bodyB: box3,
  length: 10,
  frequency: 5, // Oscillation frequency
  damping: 0.5, // Damping ratio
  collideConnected: true
});
```

## Collision Detection

You can detect and respond to collisions between bodies:

```typescript
// Set up collision callbacks
physics.onBeginContact((bodyA, bodyB) => {
  console.log(`Collision started between ${bodyA.id} and ${bodyB.id}`);
});

physics.onEndContact((bodyA, bodyB) => {
  console.log(`Collision ended between ${bodyA.id} and ${bodyB.id}`);
});

// Check if two bodies are in contact
const inContact = physics.areInContact(bodyA, bodyB);
```

## Example: Simple Physics Simulation

Here's a complete example of a simple physics simulation:

```typescript
import { createCliRenderer, BoxRenderable } from '@opentui/core';
import { PlanckPhysicsAdapter } from '@opentui/core/3d';

async function createPhysicsDemo() {
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
  
  // Create the physics adapter
  const physics = new PlanckPhysicsAdapter({
    gravity: { x: 0, y: 10 },
    scale: 30
  });
  
  // Create a world
  const world = physics.createWorld();
  
  // Create a ground body
  const ground = physics.createStaticBody({
    position: { x: renderer.width / 2, y: renderer.height - 5 },
    shape: {
      type: 'box',
      width: renderer.width - 10,
      height: 2
    }
  });
  
  // Create walls
  const leftWall = physics.createStaticBody({
    position: { x: 2, y: renderer.height / 2 },
    shape: {
      type: 'box',
      width: 2,
      height: renderer.height - 10
    }
  });
  
  const rightWall = physics.createStaticBody({
    position: { x: renderer.width - 2, y: renderer.height / 2 },
    shape: {
      type: 'box',
      width: 2,
      height: renderer.height - 10
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
      borderColor: '#e74c3c',
      backgroundColor: 'transparent'
    });
    
    renderables.push(renderable);
    container.add(renderable);
  }
  
  // Create a renderable for the ground
  const groundRenderable = new BoxRenderable('ground', {
    width: renderer.width - 10,
    height: 2,
    position: 'absolute',
    x: 5,
    y: renderer.height - 5,
    borderStyle: 'single',
    borderColor: '#2ecc71',
    backgroundColor: 'transparent'
  });
  
  container.add(groundRenderable);
  
  // Set up the update loop
  renderer.setFrameCallback((deltaTime) => {
    // Update physics
    physics.update(deltaTime / 1000); // Convert to seconds
    
    // Update renderables
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const renderable = renderables[i];
      const position = body.getPosition();
      const angle = body.getAngle();
      
      renderable.x = position.x - renderable.width / 2;
      renderable.y = position.y - renderable.height / 2;
      
      // TODO: Handle rotation when supported
    }
  });
  
  // Start the renderer
  renderer.start();
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === ' ') {
      // Add a new body on spacebar
      const body = physics.createDynamicBody({
        position: {
          x: 10 + Math.random() * (renderer.width - 20),
          y: 5
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
      
      const isBox = body.getShapeType() === 'box';
      const size = isBox ? body.getSize() : { width: body.getRadius() * 2, height: body.getRadius() * 2 };
      
      const renderable = new BoxRenderable(`body${bodies.length}`, {
        width: size.width,
        height: size.height,
        position: 'absolute',
        x: body.getPosition().x - size.width / 2,
        y: body.getPosition().y - size.height / 2,
        borderStyle: isBox ? 'single' : 'rounded',
        borderColor: '#e74c3c',
        backgroundColor: 'transparent'
      });
      
      renderables.push(renderable);
      container.add(renderable);
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      renderer.destroy();
      process.exit(0);
    }
  });
  
  return renderer;
}

// Create and run the physics demo
createPhysicsDemo().catch(console.error);
```
