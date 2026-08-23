# Text run model follow-ups

`TextRenderable` now stores one ordered `_entries` sequence of child renderables and text runs. Native transaction behavior
is intentionally unchanged. The next operation-log simplification can build on these remaining seams:

- `_pendingDocumentRoots`, `_pendingStyleRoots`, `_pendingRemovedRangeIds`, and `_pendingNativeMoves` are still independent
  dirty collections. Replace them together, not piecemeal, with one ordered document operation log.
- `prepareTextDocumentFlush` still reconstructs replacement ownership and move subsumption from those collections. Entry
  mutations can eventually append typed operations directly, leaving the planner responsible only for coalescing.
- Cross-document mutation still snapshots both owners before `applyTwoDocumentOperations`. A shared operation-log
  transaction must preserve this all-or-nothing preparation and rollback boundary.
- Payload-only text replacement and changed-run style publication remain planner fast paths. Keep their stable native range
  identity and exact frame hashes when moving them into the operation log.
- Compatibility nodes created by `add(StyledText)` remain explicitly parent-owned because public child snapshots expose
  them. They can be removed only with a deliberate public API compatibility decision.
