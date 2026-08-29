# Startup Lifecycle Measurements

INCOMPLETE: first-capture and cold/mixed regressions remain; not a no-regression solution

Sourced86dd308, actual main202e1e6a, prior60a191fd. [Architecture](layered-paint-grid-startup.md)
and [all repeats, tails, OFF, mixed frame sequences and counters](layered-paint-grid-startup-results.json).

The updated owner criterion allows one or two1-3% benchmark losses with strong other gains.
Whole-branch complexity was reviewed, redundant owners and identical raw/direct modes removed.
Cold/mixed costs remain explicitly disclosed, not averaged into the selective warm wins.

Median of repeat statistics; rotating main/current/prior, fresh process per workload/mode.
No dropped tails or forced GC. No initialization moved into construction. Setup excluded
identically; all recording work remains in first2/3, mixed28 and total measurements.

## 120x40 Depth 1

7 balanced repeats, 1000 steady frames after28 mixed frames.

- unchanged: mean 49.66 us (-49.5% main); p50 -57.8%, cold +16.2%, first3 +42.5%, mixed28 +8.4%. First eligible capture 0.982 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- localized-text: mean 151.74 us (-22.3% main); p50 -24.9%, cold +12.8%, first3 +27.6%, mixed28 +12.0%. First eligible capture 0.973 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- transparent-outside: mean 70.95 us (-67.9% main); p50 -76.5%, cold -20.9%, first3 -13.3%, mixed28 -37.0%. First eligible capture 1.443 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- layout-move: mean 239.63 us (+2.7% main); p50 -3.6%, cold +12.8%, first3 +37.9%, mixed28 +17.4%. First eligible capture 1.013 ms, frame 1 (zero-based). Mean slower in 4/7 paired repeats.
- all-changed: mean 1676.97 us (+0.6% main); p50 +1.3%, cold -5.2%, first3 +10.0%, mixed28 +2.2%. First eligible capture 0.894 ms, frame 1 (zero-based). Mean slower in 3/7 paired repeats.
- generic-request: mean 87.19 us (-11.1% main); p50 -13.1%, cold +4.3%, first3 +19.7%, mixed28 +7.5%. First eligible capture 1.005 ms, frame 1 (zero-based). Mean slower in 0/7 paired repeats.
- raw-fallback: mean 89.14 us (-12.4% main); p50 -12.5%, cold -8.0%, first3 -10.0%, mixed28 -7.3%. First eligible capture none ms, frame none (zero-based). Mean slower in 0/7 paired repeats.
- image-fallback: mean 89.25 us (-17.8% main); p50 -13.5%, cold +8.5%, first3 +6.3%, mixed28 -1.4%. First eligible capture none ms, frame none (zero-based). Mean slower in 0/7 paired repeats.
- scrollbox: mean 139.76 us (+2.4% main); p50 -6.2%, cold +12.4%, first3 +17.6%, mixed28 -4.0%. First eligible capture 1.058 ms, frame 2 (zero-based). Mean slower in 3/7 paired repeats.

Original driver, separate process family with stats observer and older pinned controls:

- unchanged: mean -65.5% main; mixed -48.0%; calls/frame 0; recorded fallback counter 0/1000; cold/warm native retained 0/94232 bytes.
- localized-text: mean -25.8% main; mixed -37.9%; calls/frame 1; recorded fallback counter 0/1000; cold/warm native retained 0/94244 bytes.
- transparent-outside: mean -77.6% main; mixed -64.8%; calls/frame 1; recorded fallback counter 0/1000; cold/warm native retained 0/173492 bytes.
- layout-move: mean -0.2% main; mixed -31.1%; calls/frame 80; recorded fallback counter 1000/1000; cold/warm native retained 0/94232 bytes.
- all-changed: mean -0.7% main; mixed -26.3%; calls/frame 80; recorded fallback counter 0/1000; cold/warm native retained 0/0 bytes.
- generic-request: mean -16.8% main; mixed -40.4%; calls/frame 80; recorded fallback counter 0/1000; cold/warm native retained 0/0 bytes.
- raw-fallback: mean -11.8% main; mixed -24.4%; calls/frame 81; recorded fallback counter 1000/1000; cold/warm native retained 0/184 bytes.
- image-fallback: mean -12.5% main; mixed -20.8%; calls/frame 81; recorded fallback counter 1000/1000; cold/warm native retained 0/184 bytes.
- scrollbox: mean -8.6% main; mixed -19.6%; calls/frame 40; recorded fallback counter 0/1000; cold/warm native retained 0/0 bytes.

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

- unchanged: mean 111.97 us (-55.9% main); p50 -57.2%, cold +19.6%, first3 +29.1%, mixed28 -9.5%. First eligible capture 1.434 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- localized-text: mean 245.91 us (-32.6% main); p50 -34.4%, cold +2.2%, first3 +15.4%, mixed28 +10.6%. First eligible capture 1.566 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- transparent-outside: mean 203.92 us (-75.9% main); p50 -78.2%, cold -6.9%, first3 -7.2%, mixed28 -28.7%. First eligible capture 3.947 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- layout-move: mean 515.70 us (-7.0% main); p50 -3.9%, cold +0.5%, first3 +19.7%, mixed28 -4.3%. First eligible capture 1.588 ms, frame 1 (zero-based). Mean slower in 0/5 paired repeats.
- all-changed: mean 3541.28 us (+2.1% main); p50 +0.4%, cold -13.7%, first3 +0.5%, mixed28 -0.5%. First eligible capture 1.560 ms, frame 1 (zero-based). Mean slower in 4/5 paired repeats.
- generic-request: mean 224.18 us (-5.2% main); p50 -11.6%, cold +7.4%, first3 +23.7%, mixed28 +11.6%. First eligible capture 1.465 ms, frame 1 (zero-based). Mean slower in 1/5 paired repeats.
- raw-fallback: mean 213.54 us (-9.1% main); p50 -11.0%, cold +3.3%, first3 +4.0%, mixed28 -0.5%. First eligible capture none ms, frame none (zero-based). Mean slower in 0/5 paired repeats.
- image-fallback: mean 215.65 us (-12.5% main); p50 -10.8%, cold -2.3%, first3 +0.2%, mixed28 +2.8%. First eligible capture none ms, frame none (zero-based). Mean slower in 0/5 paired repeats.
- scrollbox: mean 319.98 us (-4.5% main); p50 -4.5%, cold +10.6%, first3 +17.4%, mixed28 +1.3%. First eligible capture 1.407 ms, frame 2 (zero-based). Mean slower in 0/5 paired repeats.

Original driver, separate process family with stats observer and older pinned controls:

- unchanged: mean -55.6% main; mixed -37.6%; calls/frame 0; recorded fallback counter 0/600; cold/warm native retained 0/243464 bytes.
- localized-text: mean -28.1% main; mixed -31.0%; calls/frame 1; recorded fallback counter 0/600; cold/warm native retained 0/243476 bytes.
- transparent-outside: mean -76.2% main; mixed -59.0%; calls/frame 1; recorded fallback counter 0/600; cold/warm native retained 0/542084 bytes.
- layout-move: mean -4.0% main; mixed -13.4%; calls/frame 160; recorded fallback counter 600/600; cold/warm native retained 0/243464 bytes.
- all-changed: mean +0.8% main; mixed -6.0%; calls/frame 160; recorded fallback counter 0/600; cold/warm native retained 0/0 bytes.
- generic-request: mean -11.0% main; mixed -20.3%; calls/frame 160; recorded fallback counter 0/600; cold/warm native retained 0/0 bytes.
- raw-fallback: mean -10.0% main; mixed -2.2%; calls/frame 161; recorded fallback counter 600/600; cold/warm native retained 0/184 bytes.
- image-fallback: mean -8.6% main; mixed -6.8%; calls/frame 161; recorded fallback counter 600/600; cold/warm native retained 0/184 bytes.
- scrollbox: mean -5.2% main; mixed -4.6%; calls/frame 80; recorded fallback counter 0/600; cold/warm native retained 0/0 bytes.

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
- Small warm means: layout +2.7%, scroll +2.4%, broad +0.6%. Large broad +2.1%. Layout/scroll p50 improve; broad p50 is +1.3/+0.4%. No all-statistics-win claim.
- Mixed losses include small layout +17.4%, local +12.0%, large local +10.6%, generic +11.6%. Every pause remains included. No inferred GC attribution or subtraction.
- Native scope probe includes timestamps and JS observers; it is diagnostic, not headline CPU. No instrumented binary used for final matrices.
- Initial full rendering now allocates no grid. Its fallback counter is zero because there was no recording transaction, not because the initial frame was skipped.
- Native retained capacity is not RSS or JS allocation traffic. Previous allocation/stress diagnostics remain historical; no new universal primitive-speed claim.
- Final simplified-source Solid271 passed. Earlier6890 first full run crashed in Bun, followed by a passing full rerun. Both logs retained. Final native/Core/Node/packed/React gates passed.
