# Startup Lifecycle Measurements

INCOMPLETE: first-capture and cold/mixed regressions remain; not a no-regression solution

Source6890fe68, actual main202e1e6a, prior60a191fd. [Architecture](layered-paint-grid-startup.md)
and [all repeats, tails, OFF, mixed frame sequences and counters](layered-paint-grid-startup-results.json).

Median of repeat statistics; rotating main/current/prior, fresh process per workload/mode.
No dropped tails or forced GC. No initialization moved into construction. Setup excluded
identically; all recording work remains in first2/3, mixed28 and total measurements.

## 120x40 Depth 1

7 balanced repeats, 1000 steady frames after28 mixed frames.

- unchanged: mean 53.37 us (-50.7% main); p50 -56.9%, cold -1.0%, first3 +13.6%, mixed28 +0.4%. First eligible capture 0.961 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- localized-text: mean 157.30 us (-23.9% main); p50 -24.1%, cold +26.9%, first3 +38.2%, mixed28 +10.6%. First eligible capture 1.085 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- transparent-outside: mean 71.41 us (-68.9% main); p50 -76.6%, cold -3.1%, first3 +5.9%, mixed28 -32.3%. First eligible capture 1.485 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- layout-move: mean 225.96 us (-6.0% main); p50 -4.3%, cold +14.2%, first3 +31.5%, mixed28 +9.8%. First eligible capture 1.010 ms, frame 1 (zero-based). Mean slower in 1/7 paired repeats.
- all-changed: mean 1685.44 us (-1.4% main); p50 +0.8%, cold -0.5%, first3 +13.9%, mixed28 +3.2%. First eligible capture 0.931 ms, frame 1 (zero-based). Mean slower in 1/7 paired repeats.
- generic-request: mean 88.68 us (-16.8% main); p50 -12.2%, cold +12.7%, first3 +28.3%, mixed28 +8.0%. First eligible capture 1.011 ms, frame 1 (zero-based). Mean slower in 1/7 paired repeats.
- raw-fallback: mean 94.54 us (-8.8% main); p50 -11.2%, cold +3.5%, first3 +2.1%, mixed28 -6.5%. First eligible capture none ms, frame none (zero-based). Mean slower in 1/7 paired repeats.
- image-fallback: mean 95.96 us (-6.5% main); p50 -11.6%, cold +2.1%, first3 +0.6%, mixed28 -2.8%. First eligible capture none ms, frame none (zero-based). Mean slower in 2/7 paired repeats.
- scrollbox: mean 132.01 us (-6.4% main); p50 -7.2%, cold +2.6%, first3 +16.4%, mixed28 +5.6%. First eligible capture 1.020 ms, frame 2 (zero-based). Mean slower in 1/7 paired repeats.

Original driver, separate process family with stats observer and older pinned controls:

- unchanged: mean -60.4% main; mixed -45.8%; calls/frame 0; recorded fallback counter 0/1000; cold/warm native retained 0/94232 bytes.
- localized-text: mean -26.6% main; mixed -36.0%; calls/frame 1; recorded fallback counter 0/1000; cold/warm native retained 0/94244 bytes.
- transparent-outside: mean -74.2% main; mixed -52.7%; calls/frame 1; recorded fallback counter 0/1000; cold/warm native retained 0/173352 bytes.
- layout-move: mean -3.7% main; mixed -28.8%; calls/frame 80; recorded fallback counter 1000/1000; cold/warm native retained 0/94232 bytes.
- all-changed: mean -2.1% main; mixed -26.5%; calls/frame 80; recorded fallback counter 0/1000; cold/warm native retained 0/0 bytes.
- generic-request: mean -15.2% main; mixed -37.7%; calls/frame 80; recorded fallback counter 0/1000; cold/warm native retained 0/0 bytes.
- raw-fallback: mean -9.6% main; mixed -15.2%; calls/frame 81; recorded fallback counter 1000/1000; cold/warm native retained 0/184 bytes.
- image-fallback: mean -7.3% main; mixed -10.4%; calls/frame 81; recorded fallback counter 1000/1000; cold/warm native retained 0/184 bytes.
- scrollbox: mean -5.1% main; mixed -16.9%; calls/frame 40; recorded fallback counter 0/1000; cold/warm native retained 0/0 bytes.

Separate callback/full-mode diagnostic (not CPU timings):

- unchanged: ordinary full 0/1000, painter callbacks 0.
- localized-text: ordinary full 0/1000, painter callbacks 1000.
- transparent-outside: ordinary full 0/1000, painter callbacks 1000.
- layout-move: ordinary full 999/1000, painter callbacks 79920.
- all-changed: ordinary full 1000/1000, painter callbacks 80000.
- generic-request: ordinary full 1000/1000, painter callbacks 80000.
- raw-fallback: ordinary full 1000/1000, painter callbacks 81000.
- image-fallback: ordinary full 1000/1000, painter callbacks 81000.
- scrollbox: ordinary full 1000/1000, painter callbacks 40000.

1008 ON/OFF normal and transition four-channel frames match pinned main.

## 240x80 Depth 4

5 balanced repeats, 600 steady frames after28 mixed frames.

- unchanged: mean 120.19 us (-50.9% main); p50 -56.4%, cold -6.9%, first3 +5.5%, mixed28 +1.0%. First eligible capture 1.271 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- localized-text: mean 264.57 us (-28.4% main); p50 -30.1%, cold +16.1%, first3 +27.2%, mixed28 -3.6%. First eligible capture 1.500 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- transparent-outside: mean 204.30 us (-75.6% main); p50 -78.3%, cold -6.0%, first3 +7.8%, mixed28 -28.4%. First eligible capture 4.055 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- layout-move: mean 566.33 us (+3.5% main); p50 -2.2%, cold +5.6%, first3 +46.4%, mixed28 +37.9%. First eligible capture 1.654 ms, frame 1 (zero-based). Mean slower in 4/5 paired repeats.
- all-changed: mean 3426.58 us (-0.1% main); p50 +0.8%, cold -1.2%, first3 +14.1%, mixed28 -7.7%. First eligible capture 1.540 ms, frame 1 (zero-based). Mean slower in 3/5 paired repeats.
- generic-request: mean 217.74 us (-13.8% main); p50 -10.2%, cold -25.4%, first3 -14.2%, mixed28 -28.3%. First eligible capture 1.483 ms, frame 1 (zero-based). Mean slower in 1/5 paired repeats.
- raw-fallback: mean 213.22 us (-16.3% main); p50 -10.2%, cold -0.7%, first3 +0.9%, mixed28 -6.6%. First eligible capture none ms, frame none (zero-based). Mean slower in 1/5 paired repeats.
- image-fallback: mean 212.60 us (-16.2% main); p50 -12.2%, cold -6.1%, first3 -4.6%, mixed28 -6.2%. First eligible capture none ms, frame none (zero-based). Mean slower in 0/5 paired repeats.
- scrollbox: mean 329.91 us (-6.8% main); p50 -5.4%, cold +6.1%, first3 +19.2%, mixed28 +34.2%. First eligible capture 1.693 ms, frame 2 (zero-based). Mean slower in 0/5 paired repeats.

Original driver, separate process family with stats observer and older pinned controls:

- unchanged: mean -61.0% main; mixed -40.7%; calls/frame 0; recorded fallback counter 0/600; cold/warm native retained 0/242906 bytes.
- localized-text: mean -29.4% main; mixed -38.6%; calls/frame 1; recorded fallback counter 0/600; cold/warm native retained 0/242918 bytes.
- transparent-outside: mean -78.4% main; mixed -62.0%; calls/frame 1; recorded fallback counter 0/600; cold/warm native retained 0/541788 bytes.
- layout-move: mean -1.3% main; mixed -18.2%; calls/frame 160; recorded fallback counter 600/600; cold/warm native retained 0/242906 bytes.
- all-changed: mean +0.8% main; mixed -9.5%; calls/frame 160; recorded fallback counter 0/600; cold/warm native retained 0/0 bytes.
- generic-request: mean -13.4% main; mixed -29.0%; calls/frame 160; recorded fallback counter 0/600; cold/warm native retained 0/0 bytes.
- raw-fallback: mean -7.9% main; mixed -11.2%; calls/frame 161; recorded fallback counter 600/600; cold/warm native retained 0/184 bytes.
- image-fallback: mean -11.7% main; mixed -16.1%; calls/frame 161; recorded fallback counter 600/600; cold/warm native retained 0/184 bytes.
- scrollbox: mean -6.0% main; mixed -14.0%; calls/frame 80; recorded fallback counter 0/600; cold/warm native retained 0/0 bytes.

Separate callback/full-mode diagnostic (not CPU timings):

- unchanged: ordinary full 0/600, painter callbacks 0.
- localized-text: ordinary full 0/600, painter callbacks 600.
- transparent-outside: ordinary full 0/600, painter callbacks 600.
- layout-move: ordinary full 599/600, painter callbacks 95840.
- all-changed: ordinary full 600/600, painter callbacks 96000.
- generic-request: ordinary full 600/600, painter callbacks 96000.
- raw-fallback: ordinary full 600/600, painter callbacks 96600.
- image-fallback: ordinary full 600/600, painter callbacks 96600.
- scrollbox: ordinary full 600/600, painter callbacks 48000.

1008 ON/OFF normal and transition four-channel frames match pinned main.

## Limits

- First eligible recording remains more expensive than an ordinary full frame. Several cold/mixed sequences still regress.
- Small broad p50 +0.8%; large broad p50 +0.8%, large layout warm mean +3.5% with p50 -2.2%. Do not claim all warm statistics win in this matrix.
- Large layout/scroll mixed totals include substantial pauses; all remain in the report. No inferred GC attribution or subtraction.
- Native scope probe includes timestamps and JS observers; it is diagnostic, not headline CPU. No instrumented binary used for final matrices.
- Initial full rendering now allocates no grid. Its fallback counter is zero because there was no recording transaction, not because the initial frame was skipped.
- Native retained capacity is not RSS or JS allocation traffic. Previous allocation/stress diagnostics remain historical; no new universal primitive-speed claim.
- Solid first full run crashed in Bun; the immediate full rerun passed271. Both logs retained. Other final gates passed.
