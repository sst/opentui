# bun-ffi-structs 0.3.1 Performance

This report compares `bun-ffi-structs` 0.3.0 with 0.3.1 plus OpenTUI reusable-storage callsites. Each version ran the
default 37-scenario suite for 9 independent process rounds using Bun 1.3.14 arm64 and Node 26.4.0 x86-64 on the same
machine. Values are median nanoseconds per target operation; negative changes are faster.

## Applied Changes

- `SpanInfoStruct.unpackList` uses 0.3.1 reducer-aware specialization automatically.
- Logical cursor, visual cursor, measure result, and audio stream stats decode through cached buffers and `unpackInto`.
- Existing public result-returning APIs still return fresh objects.
- Editor rendering, extmarks, table measurement, and audio polling use caller-owned targets.
- `GridDrawOptionsStruct` uses one cached packet and `packInto`.
- Styled chunks and line-info array decoding remain unchanged.
- OpenTUI has no `ImageDrawOptions` schema, so no image options cache was added.

## Targeted Results

| Target                              |       Bun |       Node | Result                       |
| ----------------------------------- | --------: | ---------: | ---------------------------- |
| Span list, 256 records: 0.3.0       | 5078.7 ns | 48047.3 ns | Baseline                     |
| Span list, 256 records: 0.3.1       | 1085.6 ns |  7919.8 ns | 4.7x / 6.1x faster           |
| Logical cursor, fresh public result |   19.5 ns |   398.8 ns | Identity-safe public path    |
| Logical cursor, caller-owned target |   20.2 ns |   336.2 ns | Node 15.7% faster            |
| Visual cursor, fresh public result  |   76.8 ns |   503.4 ns | Identity-safe public path    |
| Visual cursor, caller-owned target  |   67.6 ns |   423.8 ns | Bun 12.0%, Node 15.8% faster |
| Measure result, fresh public result |   27.6 ns |   519.2 ns | Identity-safe public path    |
| Measure result, caller-owned target |   26.3 ns |   474.3 ns | Bun 4.7%, Node 8.6% faster   |
| Audio stats, fresh public result    |   64.4 ns |   529.3 ns | Identity-safe public path    |
| Audio stats, caller-owned target    |   51.7 ns |   443.2 ns | Bun 19.7%, Node 16.3% faster |

## Overall

| Runtime | Faster point estimates | Median change | Significant improvements | Significant regressions |
| ------- | ---------------------: | ------------: | -----------------------: | ----------------------: |
| Bun     |                  35/37 |         -2.8% |                        7 |                       0 |
| Node    |                  28/37 |         -3.2% |                        3 |                       0 |

The directly affected default scenarios are grid draws. Small-grid drawing improved 44.5% on Bun and 23.4% on Node;
large-grid drawing improved 9.4% on Bun. Other default-suite movement should be treated as run variance unless tied to an
applied reusable-storage path.

## All Default Scenarios

| Scenario                                        | Bun 0.3.0 | Bun 0.3.1 | Bun change | Node 0.3.0 | Node 0.3.1 | Node change |
| ----------------------------------------------- | --------: | --------: | ---------: | ---------: | ---------: | ----------: |
| renderer_set_pending_split_footer_transition    |      22.0 |      22.3 |      +1.5% |      358.7 |      348.6 |       -2.8% |
| renderer_commit_split_footer_snapshot           |     494.6 |     485.7 |      -1.8% |     1175.7 |     1353.6 |      +15.1% |
| buffer_draw_frame_buffer_full                   |      28.7 |      28.6 |      -0.5% |      416.9 |      381.8 |       -8.4% |
| buffer_draw_frame_buffer_region                 |      31.2 |      30.3 |      -3.0% |      429.7 |      429.4 |       -0.1% |
| buffer_draw_text_short                          |      77.0 |      73.3 |      -4.9% |     1330.3 |     1288.4 |       -3.1% |
| buffer_draw_text_long                           |    1298.2 |    1252.6 |      -3.5% |     3283.3 |     2971.1 |       -9.5% |
| buffer_draw_text_unicode                        |    4891.1 |    4613.7 |      -5.7% |     8839.7 |     6653.9 |      -24.7% |
| buffer_set_cell_with_alpha_blending             |      52.4 |      51.2 |      -2.2% |      813.3 |      781.8 |       -3.9% |
| buffer_set_cell                                 |      38.7 |      38.2 |      -1.4% |      875.9 |      713.0 |      -18.6% |
| buffer_draw_char_scalar                         |      38.9 |      37.9 |      -2.6% |      839.2 |      700.1 |      -16.6% |
| buffer_draw_char_packed_grapheme                |      48.0 |      46.6 |      -2.8% |      434.7 |      814.5 |      +87.4% |
| buffer_draw_super_sample_buffer_cell            |      38.1 |      37.4 |      -1.7% |      633.8 |      319.5 |      -49.6% |
| buffer_draw_super_sample_buffer_frame           |   23695.5 |   23110.2 |      -2.5% |    33486.1 |    32083.9 |       -4.2% |
| buffer_draw_packed_buffer_origin                |      29.5 |      28.4 |      -3.7% |      654.5 |      539.0 |      -17.7% |
| buffer_draw_packed_buffer_positioned            |      24.1 |      23.6 |      -2.1% |      611.2 |      275.4 |      -54.9% |
| buffer_draw_packed_buffer_frame                 |   11160.7 |   11049.4 |      -1.0% |    41238.4 |    41103.0 |       -0.3% |
| buffer_draw_grayscale_buffer_cell               |      46.5 |      44.3 |      -4.7% |      828.3 |      859.8 |       +3.8% |
| buffer_draw_grayscale_buffer_frame              |   19873.9 |   19171.8 |      -3.5% |    42226.9 |    40965.8 |       -3.0% |
| buffer_draw_grayscale_buffer_supersampled_cell  |      67.5 |      65.5 |      -2.9% |      549.5 |      488.8 |      -11.0% |
| buffer_draw_grayscale_buffer_supersampled_frame |   23257.9 |   22454.7 |      -3.5% |    50034.2 |    49898.2 |       -0.3% |
| buffer_draw_grid_small                          |     224.2 |     124.5 |     -44.5% |     1927.9 |     1476.7 |      -23.4% |
| buffer_draw_grid_large                          |     979.5 |     887.6 |      -9.4% |     3008.2 |     2894.7 |       -3.8% |
| buffer_draw_box_fill                            |     216.7 |     214.0 |      -1.2% |     1073.4 |     1631.3 |      +52.0% |
| buffer_draw_box_titled                          |     205.7 |     196.8 |      -4.3% |     2499.2 |     2311.2 |       -7.5% |
| buffer_draw_box_frame                           |    1468.3 |    1471.5 |      +0.2% |     4346.7 |     4285.9 |       -1.4% |
| text_buffer_get_text_range_by_coords_short      |     134.5 |     132.8 |      -1.3% |     1089.6 |     1092.7 |       +0.3% |
| text_buffer_get_text_range_by_coords_multiline  |    3859.4 |    3670.4 |      -4.9% |     9574.9 |     9728.8 |       +1.6% |
| edit_buffer_get_text_range_by_coords_short      |     130.6 |     130.2 |      -0.3% |     1013.1 |     1073.5 |       +6.0% |
| edit_buffer_get_text_range_by_coords_multiline  |    3863.2 |    3722.6 |      -3.6% |     9873.0 |     9542.5 |       -3.3% |
| text_buffer_view_set_local_selection_plain      |      31.1 |      30.8 |      -0.9% |      664.3 |      655.5 |       -1.3% |
| text_buffer_view_set_local_selection_styled     |      47.9 |      44.6 |      -7.1% |      843.3 |      885.6 |       +5.0% |
| text_buffer_view_update_local_selection_plain   |      28.3 |      28.2 |      -0.3% |      659.7 |      631.5 |       -4.3% |
| text_buffer_view_update_local_selection_styled  |      43.7 |      41.6 |      -4.8% |      843.3 |      646.9 |      -23.3% |
| editor_view_set_local_selection_plain           |      40.8 |      39.6 |      -3.0% |      693.5 |      689.4 |       -0.6% |
| editor_view_set_local_selection_styled          |      60.6 |      59.0 |      -2.8% |     1085.4 |     1059.5 |       -2.4% |
| editor_view_update_local_selection_plain        |      37.8 |      37.5 |      -0.8% |      661.4 |      716.4 |       +8.3% |
| editor_view_update_local_selection_styled       |      57.1 |      53.1 |      -6.9% |      973.3 |      870.2 |      -10.6% |

No default-suite scenario showed a statistically significant regression. Large Node-only swings outside the directly
affected paths had wide confidence intervals and are not attributed to reusable storage.
