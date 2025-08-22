# Animation Timeline

OpenTUI provides a powerful animation system through the `Timeline` class, which allows you to create complex animations with precise timing control.

## Overview

The Timeline system consists of:

1. **Timeline**: The main class for managing animations
2. **Animations**: Individual animations that can be added to the timeline
3. **Easing Functions**: Various easing functions for smooth animations
4. **Callbacks**: Functions that can be called at specific times in the timeline

## Timeline API

```typescript
import { Timeline, TimelineOptions } from '@opentui/core';

// Create a timeline
const timeline = new Timeline({
  duration: 1000,      // Duration in milliseconds
  loop: false,         // Whether to loop the timeline
  autoplay: true,      // Whether to start playing immediately
  onComplete: () => {  // Called when the timeline completes
    console.log('Timeline completed');
  },
  onPause: () => {     // Called when the timeline is paused
    console.log('Timeline paused');
  }
});

// Control the timeline
timeline.play();       // Start or resume playback
timeline.pause();      // Pause playback
timeline.stop();       // Stop playback and reset to beginning
timeline.seek(500);    // Seek to a specific time (in milliseconds)
timeline.reverse();    // Reverse the playback direction

// Get timeline state
const isPlaying = timeline.isPlaying();
const currentTime = timeline.getCurrentTime();
const duration = timeline.getDuration();
const progress = timeline.getProgress(); // 0 to 1
```

## Adding Animations

You can add animations to a timeline with precise timing:

```typescript
import { Timeline, EasingFunctions } from '@opentui/core';

const timeline = new Timeline({ duration: 2000 });

// Add an animation that starts at the beginning
timeline.animate(
  myElement,           // Target element
  {
    x: 100,            // Target property and value
    y: 50,
    opacity: 1
  },
  {
    duration: 500,     // Duration in milliseconds
    ease: 'outQuad',   // Easing function
    onUpdate: (anim) => {
      console.log(`Progress: ${anim.progress}`);
    },
    onComplete: () => {
      console.log('Animation completed');
    }
  }
);

// Add an animation that starts at 500ms
timeline.animate(
  anotherElement,
  {
    scale: 2,
    rotation: 45
  },
  {
    duration: 800,
    ease: 'inOutSine',
    startTime: 500     // Start time in milliseconds
  }
);
```

## Adding Callbacks

You can add callbacks to a timeline at specific times:

```typescript
// Add a callback at 1000ms
timeline.addCallback(1000, () => {
  console.log('Halfway point reached');
});

// Add a callback at the end
timeline.addCallback(timeline.getDuration(), () => {
  console.log('Timeline ended');
});
```

## Nesting Timelines

You can nest timelines for complex animation sequences:

```typescript
const mainTimeline = new Timeline({ duration: 5000 });
const subTimeline = new Timeline({ duration: 2000 });

// Add animations to the sub-timeline
subTimeline.animate(element1, { x: 100 }, { duration: 500 });
subTimeline.animate(element2, { y: 50 }, { duration: 800, startTime: 500 });

// Add the sub-timeline to the main timeline
mainTimeline.addTimeline(subTimeline, 1000); // Start at 1000ms

// Play the main timeline
mainTimeline.play();
```

## Easing Functions

OpenTUI provides various easing functions for smooth animations:

```typescript
import { EasingFunctions } from '@opentui/core';

// Available easing functions:
const easings: EasingFunctions[] = [
  'linear',
  'inQuad',
  'outQuad',
  'inOutQuad',
  'inExpo',
  'outExpo',
  'inOutSine',
  'outBounce',
  'outElastic',
  'inBounce',
  'inCirc',
  'outCirc',
  'inOutCirc'
];

// Use an easing function
timeline.animate(element, { x: 100 }, { 
  duration: 500, 
  ease: 'outBounce' 
});
```

## Animation Options

The `animate` method accepts various options:

```typescript
timeline.animate(element, { x: 100 }, {
  duration: 500,       // Duration in milliseconds
  ease: 'outQuad',     // Easing function
  startTime: 0,        // Start time in milliseconds (default: 0)
  loop: false,         // Whether to loop this animation
  loopDelay: 0,        // Delay between loops in milliseconds
  alternate: false,    // Whether to alternate direction on loop
  once: false,         // Whether to run only once
  onUpdate: (anim) => {
    // Called on each update
    console.log(`Progress: ${anim.progress}`);
  },
  onComplete: () => {
    // Called when the animation completes
    console.log('Animation completed');
  },
  onStart: () => {
    // Called when the animation starts
    console.log('Animation started');
  },
  onLoop: () => {
    // Called when the animation loops
    console.log('Animation looped');
  }
});
```

## Updating the Timeline

The timeline needs to be updated on each frame:

```typescript
// In your render loop
function update(deltaTime: number) {
  timeline.update(deltaTime);
  
  // Request the next frame
  requestAnimationFrame((time) => {
    const delta = time - lastTime;
    lastTime = time;
    update(delta);
  });
}

let lastTime = performance.now();
update(0);
```

## Example: Creating a Complex Animation

```typescript
import { Timeline, BoxRenderable } from '@opentui/core';

// Create elements
const box1 = new BoxRenderable('box1', {
  width: 10,
  height: 5,
  x: 0,
  y: 0,
  borderStyle: 'single',
  borderColor: '#3498db',
  backgroundColor: '#222222'
});

const box2 = new BoxRenderable('box2', {
  width: 10,
  height: 5,
  x: 0,
  y: 10,
  borderStyle: 'single',
  borderColor: '#e74c3c',
  backgroundColor: '#222222'
});

// Add to the renderer
renderer.root.add(box1);
renderer.root.add(box2);

// Create a timeline
const timeline = new Timeline({
  duration: 5000,
  loop: true,
  autoplay: true
});

// Animate box1
timeline.animate(box1, { x: 50 }, {
  duration: 1000,
  ease: 'outQuad'
});

timeline.animate(box1, { y: 20 }, {
  duration: 1000,
  startTime: 1000,
  ease: 'inOutSine'
});

timeline.animate(box1, { x: 0 }, {
  duration: 1000,
  startTime: 2000,
  ease: 'inQuad'
});

timeline.animate(box1, { y: 0 }, {
  duration: 1000,
  startTime: 3000,
  ease: 'inOutSine'
});

// Animate box2 with a delay
timeline.animate(box2, { x: 50 }, {
  duration: 1000,
  startTime: 500,
  ease: 'outBounce'
});

timeline.animate(box2, { y: 30 }, {
  duration: 1000,
  startTime: 1500,
  ease: 'outElastic'
});

timeline.animate(box2, { x: 0 }, {
  duration: 1000,
  startTime: 2500,
  ease: 'inBounce'
});

timeline.animate(box2, { y: 10 }, {
  duration: 1000,
  startTime: 3500,
  ease: 'inOutCirc'
});

// Add a callback
timeline.addCallback(2000, () => {
  console.log('Halfway point reached');
});

// Update the timeline in the render loop
renderer.on('update', (context) => {
  timeline.update(context.deltaTime);
});
```

## Example: Creating a Typing Animation

```typescript
import { Timeline, TextRenderable } from '@opentui/core';

// Create a text element
const text = new TextRenderable('text', {
  content: '',
  x: 5,
  y: 5,
  fg: '#ffffff'
});

// Add to the renderer
renderer.root.add(text);

// Create a timeline
const timeline = new Timeline({
  duration: 3000,
  autoplay: true
});

// The full text to type
const fullText = 'Hello, world! This is a typing animation.';

// Create a typing animation
for (let i = 1; i <= fullText.length; i++) {
  timeline.addCallback(i * 100, () => {
    text.content = fullText.substring(0, i);
  });
}

// Add a blinking cursor
let cursorVisible = true;
timeline.addCallback(fullText.length * 100 + 500, () => {
  const interval = setInterval(() => {
    cursorVisible = !cursorVisible;
    text.content = fullText + (cursorVisible ? '|' : '');
  }, 500);
  
  // Clean up the interval when the timeline is stopped
  timeline.on('stop', () => {
    clearInterval(interval);
  });
});

// Update the timeline in the render loop
renderer.on('update', (context) => {
  timeline.update(context.deltaTime);
});
```
