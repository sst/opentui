# bun-ffi-structs 0.3.0 Performance

This report compares `bun-ffi-structs` 0.2.4 and 0.3.0 with the portable FFI benchmark suite. Each version ran all 37
scenarios for 9 independent process rounds using Bun 1.3.14 arm64 and Node 26.4.0 x86-64 on the same machine. Values are
median nanoseconds per target operation; negative changes are faster.

Most target loops do not call `bun-ffi-structs`. Only the grid scenarios pack `GridDrawOptionsStruct` inside the timed
operation. Changes in other scenarios describe whole-run variance and must not be attributed directly to the dependency.

## Overall

| Runtime | Faster point estimates | Median change | Significant improvements | Significant regressions |
| ------- | ---------------------: | ------------: | -----------------------: | ----------------------: |
| Bun     |                  36/37 |         -3.3% |                       18 |                       0 |
| Node    |                  33/37 |         -5.0% |                        1 |                       0 |

The broad movement in both runtimes indicates favorable run-to-run drift rather than a dependency-wide target-loop
speedup. The directly affected grid scenarios were mixed: small-grid Bun changed by +1.2% and large-grid Bun by -4.5%;
both confidence intervals include no material change.

## All Scenarios

| Scenario                                        | Bun 0.2.4 | Bun 0.3.0 | Bun change | Node 0.2.4 | Node 0.3.0 | Node change |
| ----------------------------------------------- | --------: | --------: | ---------: | ---------: | ---------: | ----------: |
| renderer_set_pending_split_footer_transition    |      23.8 |      20.9 |     -12.2% |      384.8 |      382.1 |       -0.7% |
| renderer_commit_split_footer_snapshot           |     543.4 |     527.6 |      -2.9% |     1471.9 |     1258.5 |      -14.5% |
| buffer_draw_frame_buffer_full                   |      31.1 |      30.6 |      -1.5% |      481.1 |      444.7 |       -7.6% |
| buffer_draw_frame_buffer_region                 |      33.4 |      32.6 |      -2.2% |      511.1 |      462.1 |       -9.6% |
| buffer_draw_text_short                          |      80.7 |      79.6 |      -1.4% |     1406.6 |     1286.3 |       -8.6% |
| buffer_draw_text_long                           |    1405.4 |    1345.0 |      -4.3% |     3589.3 |     3390.8 |       -5.5% |
| buffer_draw_text_unicode                        |    5623.9 |    5551.1 |      -1.3% |    10205.2 |     9969.2 |       -2.3% |
| buffer_set_cell_with_alpha_blending             |      57.3 |      55.1 |      -3.9% |      924.1 |      884.5 |       -4.3% |
| buffer_set_cell                                 |      41.7 |      40.3 |      -3.3% |      868.8 |      861.3 |       -0.9% |
| buffer_draw_char_scalar                         |      41.2 |      40.7 |      -1.2% |      902.0 |      730.1 |      -19.1% |
| buffer_draw_char_packed_grapheme                |      51.2 |      49.2 |      -4.0% |      877.9 |      876.9 |       -0.1% |
| buffer_draw_super_sample_buffer_cell            |      40.2 |      38.0 |      -5.5% |      359.8 |      338.8 |       -5.9% |
| buffer_draw_super_sample_buffer_frame           |   24964.1 |   23917.8 |      -4.2% |    35671.2 |    34530.1 |       -3.2% |
| buffer_draw_packed_buffer_origin                |      31.1 |      30.3 |      -2.5% |      642.9 |      667.4 |       +3.8% |
| buffer_draw_packed_buffer_positioned            |      26.1 |      24.6 |      -5.6% |      629.3 |      603.2 |       -4.2% |
| buffer_draw_packed_buffer_frame                 |   12406.2 |   11524.3 |      -7.1% |    46228.0 |    44393.4 |       -4.0% |
| buffer_draw_grayscale_buffer_cell               |      48.9 |      47.0 |      -3.8% |      952.6 |      850.0 |      -10.8% |
| buffer_draw_grayscale_buffer_frame              |   21099.8 |   20296.7 |      -3.8% |    44491.9 |    43914.8 |       -1.3% |
| buffer_draw_grayscale_buffer_supersampled_cell  |      70.9 |      68.4 |      -3.5% |     1033.4 |      951.6 |       -7.9% |
| buffer_draw_grayscale_buffer_supersampled_frame |   24992.8 |   24166.1 |      -3.3% |    53578.0 |    53867.0 |       +0.5% |
| buffer_draw_grid_small                          |     233.5 |     236.2 |      +1.2% |     2007.3 |     2163.6 |       +7.8% |
| buffer_draw_grid_large                          |    1065.7 |    1018.2 |      -4.5% |     3367.8 |     3243.2 |       -3.7% |
| buffer_draw_box_fill                            |     232.7 |     225.4 |      -3.1% |     1714.6 |     1056.8 |      -38.4% |
| buffer_draw_box_titled                          |     216.9 |     214.8 |      -1.0% |     3027.3 |     2393.1 |      -21.0% |
| buffer_draw_box_frame                           |    1623.5 |    1571.5 |      -3.2% |     5353.1 |     5050.0 |       -5.7% |
| text_buffer_get_text_range_by_coords_short      |     146.3 |     138.8 |      -5.1% |     1258.3 |     1189.1 |       -5.5% |
| text_buffer_get_text_range_by_coords_multiline  |    4224.6 |    4003.3 |      -5.2% |    11092.8 |    11022.7 |       -0.6% |
| edit_buffer_get_text_range_by_coords_short      |     145.3 |     137.9 |      -5.0% |     1273.2 |     1159.0 |       -9.0% |
| edit_buffer_get_text_range_by_coords_multiline  |    4083.4 |    4020.2 |      -1.5% |    11621.6 |    10925.6 |       -6.0% |
| text_buffer_view_set_local_selection_plain      |      34.0 |      32.8 |      -3.4% |      637.0 |      628.3 |       -1.4% |
| text_buffer_view_set_local_selection_styled     |      49.9 |      47.9 |      -3.9% |      956.0 |      883.1 |       -7.6% |
| text_buffer_view_update_local_selection_plain   |      30.4 |      30.2 |      -0.8% |      723.0 |      637.1 |      -11.9% |
| text_buffer_view_update_local_selection_styled  |      46.0 |      44.7 |      -2.8% |      949.7 |      902.4 |       -5.0% |
| editor_view_set_local_selection_plain           |      43.4 |      42.3 |      -2.5% |      738.8 |      730.1 |       -1.2% |
| editor_view_set_local_selection_styled          |      61.8 |      61.0 |      -1.2% |     1028.0 |     1010.7 |       -1.7% |
| editor_view_update_local_selection_plain        |      40.1 |      39.3 |      -2.0% |      835.2 |      726.7 |      -13.0% |
| editor_view_update_local_selection_styled       |      62.9 |      58.5 |      -6.9% |     1045.3 |     1060.6 |       +1.5% |

## Packing Diagnostics

The isolated diagnostics repeat the candidate descriptor shapes without FFI or native work. They show the specific
improvements introduced by 0.3.0, especially direct packing for nested inline structs.

| Shape                                         |    0.2.4 |    0.3.0 | Change |
| --------------------------------------------- | -------: | -------: | -----: |
| Transition primitive descriptor               | 114.9 ns | 101.0 ns | -12.1% |
| Supersample primitive descriptor              | 106.6 ns |  98.6 ns |  -7.5% |
| Selection with two inline RGBA structs        | 459.3 ns | 205.9 ns | -55.2% |
| Existing two-flag grid options                |  98.3 ns | 101.2 ns |  +3.0% |
| Grid descriptor with retained pointers        | 308.2 ns | 296.1 ns |  -3.9% |
| Box descriptor with three inline RGBA structs | 839.0 ns | 392.5 ns | -53.2% |

Version 0.3.0 materially improves nested inline descriptor packing, but primitive packet allocation remains about 100 ns
per call. The upgrade alone therefore does not remove the fixed per-call cost that caused the rejected shared-ABI
candidates to regress Bun hot paths.
