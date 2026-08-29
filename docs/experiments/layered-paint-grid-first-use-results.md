# Focused First-Use Results

TRADEOFF DECISION REQUIRED: retain d86dd308 opt-in; no universal startup-performance acceptance

Source `a8801276`, runtime `d86dd308`, actual main `202e1e6a`. Native `03acd5fa`.
[Decision and architecture](layered-paint-grid-first-use.md); [complete distributions, OFF, frames, profiles, patch and provenance](layered-paint-grid-first-use-results.json).

Two independent five-repeat batches; both sizes depth4. Median of repeat statistics.
Milliseconds for first-use/mixed, microseconds for warm mean/p50. Percentages compare
to actual main, not the corrected full-render reference. No outlier/GC subtraction.

## first-w

- small localized-text: coldMs 3.916 (+24.3%); captureMs 0.964 (+154.4%); first2Ms 4.929 (+40.6%); first3Ms 5.241 (+40.1%); mixed28Ms 10.886 (+0.2%); meanUs 154.852 (-25.9%); p50Us 136.618 (-23.9%). Mixed range current 9.278-13.042 ms, main 9.499-18.264 ms.
- small layout-move: coldMs 3.411 (+4.9%); captureMs 0.941 (+133.9%); first2Ms 4.384 (+19.4%); first3Ms 4.671 (+19.4%); mixed28Ms 10.713 (+1.8%); meanUs 236.817 (-3.9%); p50Us 214.866 (-3.3%). Mixed range current 10.168-13.397 ms, main 9.813-14.972 ms.
- small generic-request: coldMs 3.124 (+3.5%); captureMs 1.160 (+172.6%); first2Ms 4.914 (+42.6%); first3Ms 5.339 (+44.1%); mixed28Ms 11.413 (+32.3%); meanUs 96.543 (-12.7%); p50Us 79.120 (-14.7%). Mixed range current 8.064-15.568 ms, main 8.009-11.008 ms.
- large localized-text: coldMs 5.990 (+36.2%); captureMs 1.404 (+122.5%); first2Ms 7.746 (+53.9%); first3Ms 8.257 (+50.8%); mixed28Ms 17.926 (+3.3%); meanUs 253.880 (-29.8%); p50Us 222.288 (-32.9%). Mixed range current 17.530-18.490 ms, main 16.437-22.709 ms.
- large layout-move: coldMs 4.421 (-9.8%); captureMs 1.344 (+91.1%); first2Ms 5.765 (+2.8%); first3Ms 6.100 (-0.6%); mixed28Ms 17.887 (-4.9%); meanUs 517.634 (-7.1%); p50Us 489.073 (-3.9%). Mixed range current 17.326-24.646 ms, main 18.557-27.246 ms.
- large generic-request: coldMs 4.724 (-11.3%); captureMs 1.674 (+150.8%); first2Ms 6.458 (+4.4%); first3Ms 6.782 (-2.2%); mixed28Ms 15.880 (-8.5%); meanUs 216.954 (-9.4%); p50Us 190.540 (-10.8%). Mixed range current 15.612-16.399 ms, main 15.568-22.009 ms.

## first-w2

- small localized-text: coldMs 3.734 (+22.1%); captureMs 1.201 (+216.9%); first2Ms 4.742 (+37.5%); first3Ms 5.068 (+36.7%); mixed28Ms 10.272 (+4.4%); meanUs 148.757 (-29.6%); p50Us 134.834 (-23.6%). Mixed range current 9.443-12.908 ms, main 9.397-10.510 ms.
- small layout-move: coldMs 3.723 (+17.4%); captureMs 1.059 (+169.8%); first2Ms 4.782 (+34.2%); first3Ms 5.235 (+37.9%); mixed28Ms 11.209 (+7.9%); meanUs 232.987 (-1.9%); p50Us 210.209 (-4.4%). Mixed range current 10.420-16.591 ms, main 9.979-15.312 ms.
- small generic-request: coldMs 3.252 (+9.2%); captureMs 1.034 (+155.6%); first2Ms 4.925 (+41.4%); first3Ms 5.196 (+39.3%); mixed28Ms 10.111 (+21.3%); meanUs 85.711 (-19.7%); p50Us 79.040 (-13.2%). Mixed range current 8.361-12.107 ms, main 7.609-10.340 ms.
- large localized-text: coldMs 4.544 (-34.0%); captureMs 1.451 (+123.3%); first2Ms 5.895 (-25.6%); first3Ms 6.467 (-25.3%); mixed28Ms 16.268 (-27.7%); meanUs 252.129 (-33.3%); p50Us 223.690 (-31.5%). Mixed range current 15.464-26.852 ms, main 16.762-33.468 ms.
- large layout-move: coldMs 4.486 (+2.1%); captureMs 1.393 (+101.5%); first2Ms 5.835 (+15.1%); first3Ms 6.151 (+12.0%); mixed28Ms 17.933 (-6.7%); meanUs 511.945 (-8.9%); p50Us 489.683 (-3.9%). Mixed range current 17.114-27.445 ms, main 17.824-21.150 ms.
- large generic-request: coldMs 4.352 (-26.1%); captureMs 1.284 (+71.2%); first2Ms 5.585 (-19.0%); first3Ms 5.910 (-22.7%); mixed28Ms 14.572 (-11.9%); meanUs 209.429 (-14.7%); p50Us 188.957 (-11.4%). Mixed range current 14.433-18.412 ms, main 15.373-26.721 ms.

## Rejected Direct Binding

Seven alternating W/Y repeats, no native changes. Percentages below compare Y to W,
NOT main. Initial five-repeat Y trial is retained locally and is not paired evidence.

- small localized-text: coldMs +9.4%; captureMs -11.0%; first2Ms +3.5%; first3Ms +3.0%; mixed28Ms -2.1%; meanUs -0.3%; p50Us -0.7%.
- small layout-move: coldMs +7.9%; captureMs -1.6%; first2Ms +6.7%; first3Ms +6.1%; mixed28Ms +6.2%; meanUs +1.3%; p50Us +0.4%.
- small generic-request: coldMs +6.5%; captureMs -6.4%; first2Ms +6.0%; first3Ms +5.7%; mixed28Ms +2.2%; meanUs +1.7%; p50Us -0.9%.
- large localized-text: coldMs +9.6%; captureMs -1.7%; first2Ms +6.5%; first3Ms +6.7%; mixed28Ms +0.1%; meanUs -0.9%; p50Us +0.3%.
- large layout-move: coldMs -2.9%; captureMs -0.9%; first2Ms -5.7%; first3Ms -6.5%; mixed28Ms +5.9%; meanUs -4.7%; p50Us -0.5%.
- large generic-request: coldMs +0.3%; captureMs -3.7%; first2Ms -0.7%; first3Ms -2.1%; mixed28Ms -4.2%; meanUs +0.2%; p50Us +0.2%.

## Interpretation

- First capture remains consistently slower than ordinary main rendering at both sizes. Warm selective gains do not make this cost free.
- Small generic mixed loss repeats (+32.3%, +21.3%). Large mixed results improve in these batches despite losses in the earlier full matrix; all distributions remain visible, not selectively replaced.
- The direct-binding trial reduced some capture timings but did not improve startup/mixed consistently. It was removed, not shipped for fractional warm noise.
- JSC sampling identifies work across Root, scope bindings and native text draw. Large first-capture Root samples are already Baseline; small Root remains LLInt. This does not isolate all residual cost as FFI or compilation.
- Original driver and full-nine warm results are historical, source/binary-identical final simple-\* evidence, linked from the decision. No new complete candidate or green-CI claim.
