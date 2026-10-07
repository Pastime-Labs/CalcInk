# 07. Equation Orchestration

Status: Implemented locally in Phase 3; handwriting and phone acceptance
remain open. The archived
`prototype/src/equations.ts` and `prototype/src/lines/` are references,
not proof that this contract passes.

## Purpose and boundaries

Implements master requirement **P-06**. Turn an editable page of vector
strokes into independent equation-line jobs. This subsystem decides
**which ink to read and when**, not what the ink means or what the arithmetic
answer is. It owns line grouping, scheduling, and stale-work rejection.
See [ink data](05-ink-document.md),
[inference](10-model-inference.md), [arithmetic](11-arithmetic-engine.md), and
[results](12-results-and-correction.md).

An edit means any committed pen stroke, erasure, undo, redo, or clear. Page
switching also invalidates work for the page no longer visible. A draft stroke
does not enter recognition until committed, but the displayed answer for ink
being erased must disappear when the edit is committed, before inference.

## Contract

- Input: the active `Page` with immutable `Stroke[]`, a monotonically
  increasing `canvasRevisionId`, and the affected edit. Stroke order is drawing
  order; coordinates are page/world coordinates, not CSS or device pixels.
- Output: ordered `EquationLine[]` with `lineId`, ordered strokes, world-space
  bounds, an answer anchor, and a signature of the ordered stroke IDs. A
  replacement stroke created by an eraser gets a new ID. If an implementation
  ever mutates stroke geometry in place, the signature must include a content
  revision as well.
- Runtime state per line: `queued | reading | incomplete | complete |
  unreadable`, latest raw read, normalized read, typed arithmetic result,
  correction flag, and request metadata. Only the active page is scheduled.
- The [Worker message contract](10-model-inference.md#worker-contract) is the
  single authority for `pageId`, `lineId`, `canvasRevisionId`, and `requestId`.
  These four values must match the active request before any response changes
  the UI.

The line ID is an ephemeral UI identity, not a durable database key. A
split/merge may give new IDs. Persisted corrections are keyed by the line's
stroke signature within its page, as specified in
[results](12-results-and-correction.md).

## Build sequence

1. **Group visible rows.** Ignore empty strokes, compute padded world-space
   bounds, cluster large character strokes into writing rows using vertical
   overlap/proximity, then attach small marks such as decimal points, minus
   bars, division dots, and equals bars to the nearest plausible row.
   Preserve original stroke order inside each row.
   Ambiguous marks remain with the nearest line only when geometry supports
   it; fixtures decide thresholds.
2. **Create line identities and signatures.** Use deterministic ordering by
   top position, then left position. Preserve a line's cached result only
   when its ordered stroke signature is unchanged. Recompute grouping after
   every edit because a deletion can split or merge lines.
3. **Invalidate synchronously.** Remove affected automatic projections as
   soon as edited ink commits. Delete affected corrections, mark changed
   lines queued, and cancel any active request from an older revision. Reuse
   unaffected line results only when their signatures still match.
4. **Schedule conservatively.** Detect two recent horizontal bars as a
   possible terminal `=` and debounce that line for 80 ms after pen-up.
   Otherwise wait 750 ms of idle time to show a partial readback. This
   geometry is only a speed hint: the recognized, normalized text must still
   end in exactly one `=` before arithmetic runs. Coalesce repeated edits;
   prioritize the currently edited line, then remaining queued lines.
5. **Run one inference at a time.** Send only one line's strokes to the
   recognition adapter. A newer edit cancels/obsoletes the old job; a
   completed response cannot overwrite the current page. On completion,
   retain the untouched raw OCR read, then normalize and parse on the
   main thread, publish a snapshot, and pump the next queued line.
6. **Keep drawing independent.** Model loading, inference failure, or an
   offline-cache miss must not block pen events, erasing, undo, or local save.
   A model failure becomes an explicit unreadable state with a retry path.

## State and failure rules

| Condition | Required behavior |
| --- | --- |
| No line or no terminal `=` | Keep ink; no numeric answer. Partial read says no final `=` was recognized, without assuming the user omitted it. |
| Model still loading | Drawing/editing work; show loading status, not an old or guessed answer. |
| Group split/merge | Invalidate affected line signatures and all in-flight work for the old revision. |
| Response for old page, line, request, or revision | Ignore without changing UI or storage. |
| Worker error | Show "Could not read" and enable retry/manual correction; do not pass the error string to the parser. |
| Correction submitted while reading | Cancel current job and apply the correction only if its expected signature/revision still match. |

The prototype line grouping and terminal detector are starting points. Their
numeric thresholds are not correctness claims; tune only against recorded
development fixtures, never the fresh acceptance set.

## Tests and done gate

- Unit fixtures cover two rows, nearby rows, decimal/division dots,
  two-bar `=`, erased fragments, multi-stroke digits, and a line
  split/merge. Every stroke belongs to at most one line.
- With a controllable fake Worker, edit after request A, send A's response
  after request B, switch pages, and submit a correction mid-read. No stale
  answer or correction may reappear.
- A browser test writes two equations, edits one, and verifies the other
  remains while the edited result disappears immediately and is recomputed.
- Record pen-up-to-projection latency and queue delay separately. The
  warm-phone end-to-end p95 gate is in
  [recognition evidence](08-recognition-evidence.md); a fast terminal
  heuristic never substitutes for an exact model read.
