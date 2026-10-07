# 12. Results and Correction

Status: Implemented locally in Phase 3 with correction/reload tests. The prototype Readback form is a
reference, not evidence that V1 model reads or corrections are reliable.

## Purpose and boundaries

Implements master requirement **P-06**. Show the evaluated result beside
the ink while making the model's actual read visible and repairable. A
correction is a user assertion about one line's transcription, not a
hidden change to the model or training data.
Results never become ink strokes and are never fed back into recognition.
See [orchestration](07-equation-orchestration.md),
[arithmetic](11-arithmetic-engine.md), [rendering](06-canvas-rendering.md),
and [persistence](13-persistence.md).

## State and storage contract

For each line retain `rawRead`, `normalizedRead`, `result`, `phase`, and
`source: "automatic" | "corrected"` in runtime state. The answer layer
receives a projection with the line signature, world-space anchor, display
text, readback label, and source. Only corrected canonical text is
persisted: `SavedPage` contains `{ page: Page, corrections:
Record<string, string> }`, keyed by ordered stroke signature. Do not
persist raw model results as authoritative answers; recompute them from
current ink on reload. The storage schema and migration are specified in
[persistence](13-persistence.md).

| State | Canvas result | Readback panel |
| --- | --- | --- |
| Loading/queued/reading | No answer for changed ink; small status only. | "Loading recognition" or "Reading this line". |
| Incomplete | No number. | Exact available read and notice that no final `=` was recognized. |
| Valid automatic read | Numeric result, marked "Review read". | Exact raw model read, normalized equation, result, correction action. |
| Corrected read | Numeric result, visibly marked "Corrected". | User's canonical correction and result. |
| Division by zero | `Undefined`, not a crash. | Read plus typed reason in plain language. |
| Unsupported/malformed/unreadable | `Check expression` or `Fix in Readback`, never a guessed number. | Raw read if available and a repair action. |

Do not invent or display a confidence percentage without calibration data.
An automatic answer is visibly attributable to the model read. The result
text and source marker must be legible without relying on color alone.
Anchor the canvas result immediately to the right of its terminal `=`.
Right-edge space is handled by widening the paper and horizontal scrolling,
not by moving the result below the line. If existing ink occupies that
adjacent footprint, keep the result in Readback and show a visible placement
conflict rather than covering ink.

## Build sequence

1. Render projected results on a separate transparent answer layer using
   the same world-to-screen transform as ink. Never draw results into the
   stored ink canvas or include them in erasing, export samples, or Worker
   input. The DOM Readback panel lists all lines and permits selecting one.
2. Publish state changes as immutable snapshots from orchestration. On
   committed ink edit, remove the old answer immediately and show a
   transient reading state; do not leave a stale value until the model
   returns.
3. Pre-fill the correction form from the currently selected line's
   normalized read when possible, but show the raw read separately.
   Require a terminal `=`. Run correction through the same normalizer and
   parser as automatic reads; reject unsupported/syntax input with a
   specific form error. Do not alter ink.
4. Submit with the expected page ID, page revision, line ID, and stroke
   signature captured when the form opened. If any changed, reject with
   "The ink changed; review this line again." Cancel an in-flight read,
   then store the valid canonical correction and render its result.
5. On any edit to that line, remove its correction from runtime and saved
   map before a new read. Unrelated lines keep their corrections. An undo
   of the ink edit does not silently resurrect a deleted correction from
   storage. Page deletion removes that page's corrections.
6. Expose result changes through a DOM live region, announcing the
   selected line's recognized/corrected equation and result once per
   settled change, not on every canvas frame. Keyboard users can reach
   the line list, correction input, submit action, and visible error.

## Failure and interaction tests

- Correct `11+11=` after a wrong automatic read, verify `22` and the
  "Corrected" marker, reload, and verify the correction is restored only
  for the identical ink signature.
- Edit or erase that line and verify the correction and old result vanish
  immediately; late Worker output and undo cannot resurrect them.
- Switch pages or lines while a correction form is open and verify submit
  cannot modify the wrong equation.
- Try missing `=`, unsupported letters, extra `=`, parser error, and
  division by zero. Never show a plausible numeric value for rejected
  input. Render all readback as text, not HTML.
- Check that right-edge results remain adjacent to `=` as paper width grows
  on narrow viewports and at zoom/DPR changes. Check adjacent-ink conflicts,
  keyboard navigation, focus, and one screen-reader announcement per
  settled result.

The done gate is a witnessed equation-edit-correct-reload flow on desktop
and phone, plus automated stale-response/correction tests and the complete
offline equation-edit flow. Corrections do not count toward first-pass
recognition acceptance.
