# Architecture Comparison Checkpoint

INCOMPLETE: the no-regression target is not met. No average is an acceptance claim.

See [architecture and primary sources](layered-paint-grid-architecture.md) and
[compact results with all repeat ranges](layered-paint-grid-architecture-results.json).

Actual main is `202e1e6a`; previous experiment is `60a191fd`. All numbers below
are fresh measurements, not copied historical timings. Negative percentages mean
less time. Latency is mutation plus awaited TestRenderer frame, not live terminal FPS.

## 120x40 Depth 1

7 balanced repeats, 1000 steady frames; initial and mixed costs separate.

Observer-free fresh-process warm means in microseconds, with current ON versus
main and previous ON. All OFF, tail, cold and full ranges are in the JSON.

- unchanged: main 98.53, ON 50.10 us; -49.2% main, +0.3% prior. ON p50 -58.4% main; mixed28 +5.9% main.
- localized-text: main 202.07, ON 152.71 us; -24.4% main, -2.9% prior. ON p50 -26.6% main; mixed28 +23.2% main.
- transparent-outside: main 227.63, ON 84.43 us; -62.9% main, +2.4% prior. ON p50 -69.2% main; mixed28 -28.5% main.
- layout-move: main 236.43, ON 253.47 us; +7.2% main, -3.8% prior. ON p50 +7.6% main; mixed28 +8.1% main.
- all-changed: main 1668.74, ON 1664.44 us; -0.3% main, -0.8% prior. ON p50 -0.1% main; mixed28 +1.8% main.
- generic-request: main 104.23, ON 103.83 us; -0.4% main, -5.2% prior. ON p50 +3.0% main; mixed28 +9.6% main.
- raw-fallback: main 100.45, ON 102.92 us; +2.5% main, -4.6% prior. ON p50 +2.8% main; mixed28 +10.0% main.
- image-fallback: main 103.60, ON 110.83 us; +7.0% main, -1.7% prior. ON p50 +3.3% main; mixed28 +6.0% main.
- scrollbox: main 137.60, ON 147.72 us; +7.4% main, -0.7% prior. ON p50 +7.0% main; mixed28 +22.2% main.

Original same-process driver warm means retain the original ON-only stats/phase
observer. These are not pooled with the fresh-process family:

- unchanged: main 87.09, ON 31.08 us; -64.3% main. Cold ON 0.57 ms (+15.5% main, -34.2% prior); mixed28 -31.8% main.
- localized-text: main 171.41, ON 123.98 us; -27.7% main. Cold ON 0.47 ms (-5.8% main, -42.0% prior); mixed28 -21.1% main.
- transparent-outside: main 208.57, ON 65.36 us; -68.7% main. Cold ON 0.76 ms (-2.5% main, -50.8% prior); mixed28 -40.7% main.
- layout-move: main 225.83, ON 244.23 us; +8.2% main. Cold ON 0.51 ms (-0.0% main, -37.3% prior); mixed28 -7.1% main.
- all-changed: main 1526.67, ON 1546.10 us; +1.3% main. Cold ON 0.48 ms (+0.9% main, -39.3% prior); mixed28 -10.2% main.
- generic-request: main 86.82, ON 90.49 us; +4.2% main. Cold ON 0.50 ms (-2.3% main, -40.5% prior); mixed28 -0.9% main.
- raw-fallback: main 87.90, ON 91.52 us; +4.1% main. Cold ON 0.55 ms (-9.0% main, -36.6% prior); mixed28 +1.6% main.
- image-fallback: main 89.34, ON 90.36 us; +1.1% main. Cold ON 0.56 ms (+6.5% main, -37.4% prior); mixed28 +3.2% main.
- scrollbox: main 120.54, ON 132.33 us; +9.8% main. Cold ON 0.66 ms (+2.7% main, -19.7% prior); mixed28 -0.4% main.

1008 current ON/OFF normal+transition frames exactly equal newly captured main four-channel bytes.

## 240x80 Depth 4

5 balanced repeats, 600 steady frames; initial and mixed costs separate.

Observer-free fresh-process warm means in microseconds, with current ON versus
main and previous ON. All OFF, tail, cold and full ranges are in the JSON.

- unchanged: main 244.81, ON 119.33 us; -51.3% main, +1.0% prior. ON p50 -57.3% main; mixed28 -18.7% main.
- localized-text: main 374.57, ON 261.15 us; -30.3% main, -0.6% prior. ON p50 -32.4% main; mixed28 -3.2% main.
- transparent-outside: main 829.35, ON 244.12 us; -70.6% main, +4.2% prior. ON p50 -73.9% main; mixed28 -20.5% main.
- layout-move: main 544.87, ON 579.52 us; +6.4% main, -4.8% prior. ON p50 +7.9% main; mixed28 +4.1% main.
- all-changed: main 3422.61, ON 3403.10 us; -0.6% main, -3.0% prior. ON p50 -2.5% main; mixed28 +19.1% main.
- generic-request: main 228.25, ON 246.82 us; +8.1% main, -8.0% prior. ON p50 +3.0% main; mixed28 +12.5% main.
- raw-fallback: main 230.21, ON 246.44 us; +7.1% main, +0.3% prior. ON p50 +3.1% main; mixed28 +15.7% main.
- image-fallback: main 234.69, ON 248.31 us; +5.8% main, -1.5% prior. ON p50 +3.8% main; mixed28 -2.6% main.
- scrollbox: main 343.97, ON 373.15 us; +8.5% main, -5.4% prior. ON p50 +9.9% main; mixed28 +15.2% main.

Original same-process driver warm means retain the original ON-only stats/phase
observer. These are not pooled with the fresh-process family:

- unchanged: main 210.77, ON 75.96 us; -64.0% main. Cold ON 1.20 ms (-2.9% main, -40.5% prior); mixed28 -16.0% main.
- localized-text: main 353.53, ON 237.58 us; -32.8% main. Cold ON 1.16 ms (-9.9% main, -41.3% prior); mixed28 -12.1% main.
- transparent-outside: main 853.36, ON 250.92 us; -70.6% main. Cold ON 2.37 ms (-10.4% main, -59.8% prior); mixed28 -43.4% main.
- layout-move: main 544.23, ON 573.09 us; +5.3% main. Cold ON 1.18 ms (-8.3% main, -41.3% prior); mixed28 +0.9% main.
- all-changed: main 3275.85, ON 3291.07 us; +0.5% main. Cold ON 1.16 ms (+1.4% main, -44.2% prior); mixed28 -7.7% main.
- generic-request: main 214.70, ON 212.06 us; -1.2% main. Cold ON 1.17 ms (-4.5% main, -42.3% prior); mixed28 +1.7% main.
- raw-fallback: main 208.40, ON 213.57 us; +2.5% main. Cold ON 1.20 ms (-13.3% main, -40.8% prior); mixed28 +2.0% main.
- image-fallback: main 205.02, ON 230.23 us; +12.3% main. Cold ON 1.18 ms (-2.7% main, -39.7% prior); mixed28 -6.0% main.
- scrollbox: main 334.74, ON 349.95 us; +4.5% main. Cold ON 1.13 ms (-16.1% main, -35.0% prior); mixed28 -4.1% main.

1008 current ON/OFF normal+transition frames exactly equal newly captured main four-channel bytes.

## Limits

- Layout, fallback, scroll, OFF and transition costs remain visible. Mean overlap
  does not cancel a consistent p50 shift. No per-workload regression is declared acceptable.
- Forced startup avoids eager recording but the first eligible update pays for
  cache construction. Some short mixed sequences therefore still lose.
- Cold scene construction is outside frame timing for every implementation; no
  native cache construction is moved outside the frame clock.
- Natural GC tails remain included. The symmetric driver removes only benchmark
  phase/stat observers, not application allocations or production rendering work.
- Initial full-only recorder capacity is192 bytes. Warm selective scenes still
  retain approximately0.69-1.26 MB at120x40; this candidate does not keep A's
  smaller glyph-span representation. RSS and cumulative allocation are distinct.
- Research alternatives are bounded experiments, not proof that remaining costs
  are fundamental. The campaign requires continuation before claiming success.
