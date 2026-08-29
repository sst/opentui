# Bulk Continuation Measurements

Historical c795c7b3 results. See [current startup measurements](layered-paint-grid-startup-results.md).

INCOMPLETE: cold/first-capture/mixed regressions remain despite warm improvements

Source c795c7b3, actual main202e1e6a, prior60a191fd. [Architecture](layered-paint-grid-bulk.md)
and [all repeats, ranges, OFF, tails, counters and memory](layered-paint-grid-bulk-results.json).

Rotating main/current/prior controls, fresh process per workload/mode, alternating
ON/OFF order. Median of repeat statistics below; no dropped tails or forced GC.
All28 startup/recovery frames include first capture. Warm gains include a common
text traversal optimization. No average substitutes for per-workload acceptance.

## 120x40 Depth 1

7 balanced repeats; 1000 steady frames after28 mixed frames.

- unchanged: main 104.45, ON 50.87 us mean; -51.3% main, +4.9% prior. p50 -58.2% main; cold -13.5%; first update 0.810 ms (+79.0%); mixed28 -13.5%. Mean/p50 above paired main in 0/0 of7 repeats.
- localized-text: main 208.91, ON 151.79 us mean; -27.3% main, -3.1% prior. p50 -26.8% main; cold +5.4%; first update 0.821 ms (+114.4%); mixed28 +13.2%. Mean/p50 above paired main in 0/0 of7 repeats.
- transparent-outside: main 230.53, ON 74.61 us mean; -67.6% main, -13.3% prior. p50 -75.4% main; cold +10.8%; first update 1.454 ms (+89.7%); mixed28 -25.6%. Mean/p50 above paired main in 0/0 of7 repeats.
- layout-move: main 236.01, ON 232.98 us mean; -1.3% main, -10.5% prior. p50 -4.0% main; cold +13.9%; first update 0.901 ms (+151.0%); mixed28 +11.4%. Mean/p50 above paired main in 3/0 of7 repeats.
- all-changed: main 1712.20, ON 1667.76 us mean; -2.6% main, -0.1% prior. p50 -0.8% main; cold +39.4%; first update 0.818 ms (+111.0%); mixed28 +1.1%. Mean/p50 above paired main in 2/3 of7 repeats.
- generic-request: main 107.16, ON 89.92 us mean; -16.1% main, -17.3% prior. p50 -13.4% main; cold -2.3%; first update 0.869 ms (+62.9%); mixed28 -11.7%. Mean/p50 above paired main in 2/0 of7 repeats.
- raw-fallback: main 101.09, ON 88.81 us mean; -12.1% main, -20.0% prior. p50 -14.1% main; cold +5.3%; first update 0.369 ms (-4.4%); mixed28 -5.0%. Mean/p50 above paired main in 0/0 of7 repeats.
- image-fallback: main 106.31, ON 92.45 us mean; -13.0% main, -21.0% prior. p50 -12.8% main; cold -9.1%; first update 0.438 ms (-1.4%); mixed28 -0.9%. Mean/p50 above paired main in 1/0 of7 repeats.
- scrollbox: main 145.76, ON 134.67 us mean; -7.6% main, -18.4% prior. p50 -6.0% main; cold +12.1%; first update 0.762 ms (-12.6%); mixed28 +5.5%. Mean/p50 above paired main in 3/0 of7 repeats.

Original same-process driver remains separate, with its stats observer and older
exact-source control timings; these percentages are not paired fresh-process results:

- unchanged: warm mean -64.1% main; cold 0.498 ms (+1.0%); mixed28 -45.9%. Calls/frame 0, full fallback 0/1000, cold/warm retained 192/94240 bytes.
- localized-text: warm mean -28.5% main; cold 0.478 ms (-2.7%); mixed28 -37.3%. Calls/frame 1, full fallback 0/1000, cold/warm retained 192/94252 bytes.
- transparent-outside: warm mean -76.8% main; cold 0.677 ms (-20.8%); mixed28 -63.4%. Calls/frame 1, full fallback 0/1000, cold/warm retained 192/173360 bytes.
- layout-move: warm mean -3.6% main; cold 0.481 ms (-5.1%); mixed28 -31.3%. Calls/frame 80, full fallback 1000/1000, cold/warm retained 192/94240 bytes.
- all-changed: warm mean +0.7% main; cold 0.446 ms (-6.1%); mixed28 -27.4%. Calls/frame 80, full fallback 1000/1000, cold/warm retained 192/192 bytes.
- generic-request: warm mean -12.1% main; cold 0.504 ms (+8.8%); mixed28 -36.1%. Calls/frame 80, full fallback 1000/1000, cold/warm retained 192/192 bytes.
- raw-fallback: warm mean -11.0% main; cold 0.552 ms (-6.4%); mixed28 -21.9%. Calls/frame 81, full fallback 1000/1000, cold/warm retained 192/192 bytes.
- image-fallback: warm mean -11.8% main; cold 0.533 ms (+9.7%); mixed28 -21.3%. Calls/frame 81, full fallback 1000/1000, cold/warm retained 192/192 bytes.
- scrollbox: warm mean -5.7% main; cold 0.639 ms (+0.1%); mixed28 -15.4%. Calls/frame 40, full fallback 1000/1000, cold/warm retained 192/192 bytes.

1008 ON/OFF normal and transition frames match pinned main across all four channels.

## 240x80 Depth 4

5 balanced repeats; 600 steady frames after28 mixed frames.

- unchanged: main 237.12, ON 123.52 us mean; -47.9% main, +14.1% prior. p50 -57.0% main; cold +8.3%; first update 1.203 ms (+67.0%); mixed28 -12.4%. Mean/p50 above paired main in 0/0 of5 repeats.
- localized-text: main 362.51, ON 261.96 us mean; -27.7% main, +2.3% prior. p50 -34.8% main; cold +2.5%; first update 1.226 ms (+83.5%); mixed28 -10.8%. Mean/p50 above paired main in 0/0 of5 repeats.
- transparent-outside: main 839.52, ON 214.89 us mean; -74.4% main, -9.3% prior. p50 -78.3% main; cold +54.0%; first update 4.650 ms (+80.1%); mixed28 -32.3%. Mean/p50 above paired main in 0/0 of5 repeats.
- layout-move: main 547.57, ON 519.07 us mean; -5.2% main, -13.5% prior. p50 -4.0% main; cold +12.3%; first update 1.344 ms (+98.9%); mixed28 -8.4%. Mean/p50 above paired main in 1/0 of5 repeats.
- all-changed: main 3531.85, ON 3460.97 us mean; -2.0% main, -3.9% prior. p50 -2.9% main; cold +49.2%; first update 1.703 ms (+159.4%); mixed28 +3.9%. Mean/p50 above paired main in 1/1 of5 repeats.
- generic-request: main 236.62, ON 219.34 us mean; -7.3% main, -11.4% prior. p50 -10.4% main; cold +30.5%; first update 1.298 ms (+28.8%); mixed28 +4.5%. Mean/p50 above paired main in 1/0 of5 repeats.
- raw-fallback: main 236.51, ON 211.84 us mean; -10.4% main, -13.0% prior. p50 -12.4% main; cold +6.1%; first update 0.727 ms (+3.2%); mixed28 -2.6%. Mean/p50 above paired main in 0/0 of5 repeats.
- image-fallback: main 236.44, ON 210.40 us mean; -11.0% main, -19.7% prior. p50 -11.1% main; cold +8.2%; first update 0.799 ms (+10.6%); mixed28 +7.9%. Mean/p50 above paired main in 1/0 of5 repeats.
- scrollbox: main 367.21, ON 334.85 us mean; -8.8% main, -12.6% prior. p50 -6.8% main; cold +8.5%; first update 1.112 ms (+0.6%); mixed28 -0.4%. Mean/p50 above paired main in 1/0 of5 repeats.

Original same-process driver remains separate, with its stats observer and older
exact-source control timings; these percentages are not paired fresh-process results:

- unchanged: warm mean -55.9% main; cold 1.142 ms (-11.0%); mixed28 -24.6%. Calls/frame 0, full fallback 0/600, cold/warm retained 192/242914 bytes.
- localized-text: warm mean -27.1% main; cold 1.294 ms (+7.2%); mixed28 -38.3%. Calls/frame 1, full fallback 0/600, cold/warm retained 192/242926 bytes.
- transparent-outside: warm mean -76.2% main; cold 2.662 ms (-40.7%); mixed28 -59.1%. Calls/frame 1, full fallback 0/600, cold/warm retained 192/541796 bytes.
- layout-move: warm mean -1.5% main; cold 1.117 ms (-17.3%); mixed28 -21.3%. Calls/frame 160, full fallback 600/600, cold/warm retained 192/242914 bytes.
- all-changed: warm mean +0.7% main; cold 1.118 ms (+1.3%); mixed28 -9.1%. Calls/frame 160, full fallback 600/600, cold/warm retained 192/192 bytes.
- generic-request: warm mean -13.0% main; cold 1.213 ms (-3.9%); mixed28 -27.3%. Calls/frame 160, full fallback 600/600, cold/warm retained 192/192 bytes.
- raw-fallback: warm mean -12.6% main; cold 1.207 ms (-6.8%); mixed28 -10.1%. Calls/frame 161, full fallback 600/600, cold/warm retained 192/192 bytes.
- image-fallback: warm mean -5.6% main; cold 1.219 ms (-6.3%); mixed28 -11.9%. Calls/frame 161, full fallback 600/600, cold/warm retained 192/192 bytes.
- scrollbox: warm mean -1.4% main; cold 1.169 ms (-12.7%); mixed28 -15.6%. Calls/frame 80, full fallback 600/600, cold/warm retained 192/192 bytes.

1008 ON/OFF normal and transition frames match pinned main across all four channels.

## Limits

- All nine warm mean/p50 medians improve in the final rotating matrices, but not
  every paired repeat wins. First-use and several cold/mixed sequences still lose.
- Wide closure changed from quadratic rescanning to a bounded scan/full replay.
  The adversarial fixture still costs more than ordinary full drawing; the saved
  ReleaseFast comparison is causal evidence of the improvement, not universal parity.
- Small plain retained storage94240B, outside173360B; native allocation fixture
  16 backing allocations/106240 requested bytes. These are not RSS measurements.
- First capture still includes scope/FFI/JIT and ownership work. Native drawing
  diagnostic improved274->64us small, but that does not erase measured startup cost.
- Full validation passes do not satisfy the unfinished performance acceptance goal.
