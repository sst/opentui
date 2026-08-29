# Continuation Measurements

INCOMPLETE: repeatable per-workload regressions remain. No average is acceptance.

Source81b82490, actual main202e1e6a, prior60a191fd. [Architecture](layered-paint-grid-continuation.md)
and [all repeats, ranges, OFF, tails, counters, memory](layered-paint-grid-continuation-results.json).

Observer-free timings rotate main/current/prior order every repeat and alternate
ON/OFF order. Every workload/mode runs in a fresh process. Complete28-frame
startup/burst/full/recovery/quiet totals include first retained capture. Scene
construction is excluded identically. No forced GC, discarded tails, or p50-only
acceptance. Latency is mutation plus awaited test render, not terminal throughput.

## 120x40 Depth 1

7 balanced repeats, 1000 steady frames after28 mixed frames.

- unchanged: main 109.10, ON 50.72 us mean; -53.5% main, +3.0% prior. p50 -57.9% main; mixed28 +7.9% main. Mean/p50 above paired main in 0/0 of7 repeats.
- localized-text: main 209.58, ON 154.81 us mean; -26.1% main, -6.2% prior. p50 -24.8% main; mixed28 +4.8% main. Mean/p50 above paired main in 0/0 of7 repeats.
- transparent-outside: main 235.79, ON 79.96 us mean; -66.1% main, -9.2% prior. p50 -71.8% main; mixed28 -33.5% main. Mean/p50 above paired main in 0/0 of7 repeats.
- layout-move: main 235.44, ON 250.67 us mean; +6.5% main, -4.8% prior. p50 +3.0% main; mixed28 +12.7% main. Mean/p50 above paired main in 5/6 of7 repeats.
- all-changed: main 1661.50, ON 1703.41 us mean; +2.5% main, +1.3% prior. p50 +1.5% main; mixed28 +15.2% main. Mean/p50 above paired main in 3/4 of7 repeats.
- generic-request: main 101.47, ON 104.87 us mean; +3.4% main, -10.5% prior. p50 +3.0% main; mixed28 +20.8% main. Mean/p50 above paired main in 6/6 of7 repeats.
- raw-fallback: main 98.91, ON 106.00 us mean; +7.2% main, -13.0% prior. p50 +3.0% main; mixed28 +6.4% main. Mean/p50 above paired main in 5/7 of7 repeats.
- image-fallback: main 108.09, ON 105.81 us mean; -2.1% main, -2.3% prior. p50 +2.4% main; mixed28 +1.9% main. Mean/p50 above paired main in 2/7 of7 repeats.
- scrollbox: main 138.24, ON 139.75 us mean; +1.1% main, -12.9% prior. p50 +0.0% main; mixed28 +1.9% main. Mean/p50 above paired main in 4/4 of7 repeats.

Original same-process driver is a separate family, retaining the original phase
timers and ON-only statistics observer:

- unchanged: warm mean -64.3% main; cold 0.468 ms (-5.0% main); mixed28 -38.9% main. Painter calls/frame 0; full-fallback frames 0/1000; retained 192/144900 bytes cold/warm.
- localized-text: warm mean -25.1% main; cold 0.459 ms (-6.6% main); mixed28 -29.6% main. Painter calls/frame 1; full-fallback frames 0/1000; retained 192/144900 bytes cold/warm.
- transparent-outside: warm mean -74.0% main; cold 0.695 ms (-18.6% main); mixed28 -56.6% main. Painter calls/frame 1; full-fallback frames 0/1000; retained 192/244936 bytes cold/warm.
- layout-move: warm mean +1.6% main; cold 0.486 ms (-4.3% main); mixed28 -17.3% main. Painter calls/frame 80; full-fallback frames 1000/1000; retained 192/144900 bytes cold/warm.
- all-changed: warm mean -0.4% main; cold 0.471 ms (-0.7% main); mixed28 -22.7% main. Painter calls/frame 80; full-fallback frames 1000/1000; retained 192/192 bytes cold/warm.
- generic-request: warm mean +1.5% main; cold 0.516 ms (+11.4% main); mixed28 -25.4% main. Painter calls/frame 80; full-fallback frames 1000/1000; retained 192/192 bytes cold/warm.
- raw-fallback: warm mean +5.6% main; cold 0.533 ms (-9.6% main); mixed28 -14.4% main. Painter calls/frame 81; full-fallback frames 1000/1000; retained 192/192 bytes cold/warm.
- image-fallback: warm mean +3.9% main; cold 0.497 ms (+2.3% main); mixed28 -8.5% main. Painter calls/frame 81; full-fallback frames 1000/1000; retained 192/192 bytes cold/warm.
- scrollbox: warm mean +2.0% main; cold 0.631 ms (-1.2% main); mixed28 -10.5% main. Painter calls/frame 40; full-fallback frames 1000/1000; retained 192/192 bytes cold/warm.

1008 captured ON/OFF normal and transition frames match fresh main across all four channels.

## 240x80 Depth 4

5 balanced repeats, 600 steady frames after28 mixed frames.

- unchanged: main 239.77, ON 112.31 us mean; -53.2% main, -9.2% prior. p50 -58.0% main; mixed28 +35.8% main. Mean/p50 above paired main in 0/0 of5 repeats.
- localized-text: main 363.05, ON 265.05 us mean; -27.0% main, -1.3% prior. p50 -29.4% main; mixed28 -3.5% main. Mean/p50 above paired main in 0/0 of5 repeats.
- transparent-outside: main 821.35, ON 215.98 us mean; -73.7% main, -12.6% prior. p50 -76.5% main; mixed28 -22.9% main. Mean/p50 above paired main in 0/0 of5 repeats.
- layout-move: main 541.06, ON 566.22 us mean; +4.6% main, -4.2% prior. p50 +4.0% main; mixed28 +13.6% main. Mean/p50 above paired main in 4/5 of5 repeats.
- all-changed: main 3454.72, ON 3535.43 us mean; +2.3% main, +0.5% prior. p50 +1.5% main; mixed28 +1.7% main. Mean/p50 above paired main in 4/2 of5 repeats.
- generic-request: main 241.67, ON 244.91 us mean; +1.3% main, -2.1% prior. p50 +1.8% main; mixed28 -5.8% main. Mean/p50 above paired main in 3/4 of5 repeats.
- raw-fallback: main 238.58, ON 240.61 us mean; +0.8% main, -5.5% prior. p50 +1.9% main; mixed28 +9.9% main. Mean/p50 above paired main in 4/5 of5 repeats.
- image-fallback: main 251.87, ON 247.92 us mean; -1.6% main, -2.3% prior. p50 +1.1% main; mixed28 +28.7% main. Mean/p50 above paired main in 2/3 of5 repeats.
- scrollbox: main 354.89, ON 355.50 us mean; +0.2% main, -13.7% prior. p50 +0.9% main; mixed28 -8.0% main. Mean/p50 above paired main in 3/3 of5 repeats.

Original same-process driver is a separate family, retaining the original phase
timers and ON-only statistics observer:

- unchanged: warm mean -59.3% main; cold 1.098 ms (-14.4% main); mixed28 -31.3% main. Painter calls/frame 0; full-fallback frames 0/600; retained 192/322540 bytes cold/warm.
- localized-text: warm mean -30.7% main; cold 1.155 ms (-4.4% main); mixed28 -19.4% main. Painter calls/frame 1; full-fallback frames 0/600; retained 192/322540 bytes cold/warm.
- transparent-outside: warm mean -74.7% main; cold 2.273 ms (-49.4% main); mixed28 -45.6% main. Painter calls/frame 1; full-fallback frames 0/600; retained 192/702828 bytes cold/warm.
- layout-move: warm mean +2.6% main; cold 1.236 ms (-8.4% main); mixed28 -15.2% main. Painter calls/frame 160; full-fallback frames 600/600; retained 192/322540 bytes cold/warm.
- all-changed: warm mean +3.1% main; cold 1.165 ms (+5.5% main); mixed28 -7.6% main. Painter calls/frame 160; full-fallback frames 600/600; retained 192/192 bytes cold/warm.
- generic-request: warm mean +4.8% main; cold 1.167 ms (-7.5% main); mixed28 -13.8% main. Painter calls/frame 160; full-fallback frames 600/600; retained 192/192 bytes cold/warm.
- raw-fallback: warm mean +1.7% main; cold 1.159 ms (-10.5% main); mixed28 +21.4% main. Painter calls/frame 161; full-fallback frames 600/600; retained 192/192 bytes cold/warm.
- image-fallback: warm mean +0.8% main; cold 1.198 ms (-7.9% main); mixed28 +6.0% main. Painter calls/frame 161; full-fallback frames 600/600; retained 192/192 bytes cold/warm.
- scrollbox: warm mean -1.3% main; cold 1.142 ms (-14.8% main); mixed28 +49.6% main. Painter calls/frame 80; full-fallback frames 600/600; retained 192/192 bytes cold/warm.

1008 captured ON/OFF normal and transition frames match fresh main across all four channels.

## Limits

- Layout, broad invalidation, raw and generic requests still have repeatable losses.
  Image mean wins do not erase slower p50. Some cold/mixed sequences regress.
- Full frames remain full rendering, not selective-grid wins. The selective case
  skips callbacks only under existing dirty/context rules; input hits stay current.
- Payload-arena capacity includes slack. The native fixture uses16 initial backing
  allocations/156900 requested bytes,144900 retained; non-arena spans used170
  allocations/137088 requested bytes,126296 retained. Abort frees payload memory.
- First retained capture is still materially more expensive than a full main frame.
  Shared payload ownership removes allocator calls, not all capture/FFI/JIT work.
- Heap allocation diagnostics are separate from CPU timing and include post-destroy
  GC only for lifetime checks. Native capacity, requested traffic and RSS differ.
- This is a fully tested continuation checkpoint, not a completed performance goal.
