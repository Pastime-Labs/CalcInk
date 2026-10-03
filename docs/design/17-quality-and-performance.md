# 17. Quality, Performance, and Evidence

Status: **planned V1**. Requirement P-10 owns measurement, not a late test
phase that excuses untested earlier work. Each subsystem's own document
defines its local tests; this document integrates them into a release
decision. The existing prototype's green tests are a baseline, not V1 proof.
Recognition acceptance and its numeric thresholds remain pending in the
[benchmark protocol](../RECOGNITION-BENCHMARK.md).

## Test layers and responsibility

| Layer | What it must catch | Evidence |
| --- | --- | --- |
| Pure unit tests | Coordinate transforms, ink commands/history, line grouping, raster input bounds, token normalization, arithmetic-only grammar/formatting, storage validation/migration. | Deterministic fixtures with normal, boundary, and malformed inputs. |
| Browser integration | Pointer gesture to stored ink; edit to immediate answer invalidation; Worker revision rejection; page isolation; correction; focus; save/reload; offline states. | Production or near-production Playwright flows with real DOM and IndexedDB. |
| Real-model end-to-end | First automatic readback and result, changed-line re-read, offline recognition, model/asset failure. | Production build with the local PP-OCRv6 tiny detection and recognition Worker; never a mock or the prototype lab for the recognition score. |
| Physical-device session | Touch/stylus if available, safe areas, screen reader, drawing responsiveness, warm latency, memory. | Named device/browser, date, scenario, trace or screen recording where useful. |
| Clean checkout | Install, typecheck, unit tests, build, browser suite, public asset inventory. | Commands, versions, exit codes, and deployed-build smoke result. |

New fixes require a regression check at the lowest layer that can reproduce
the cause, plus an end-to-end check when the bug crosses module boundaries.
Test data from another person's handwriting requires consent; synthetic and
owner-created fixtures can live in the repository. Do not silently change a
test to match a wrong result.

## Ordered verification

1. Establish a clean-checkout baseline and record Node/npm/browser versions.
   Run `npm ci`, `npm test`, `npm run build`, and `npm run test:e2e` after the
   clean rebuild. In CI, use a pinned browser installation rather than a
   developer's local Chrome; preserve failure traces.
2. As each subsystem lands, add unit and browser checks for its contracts.
   Prioritize data loss, stale answers, unsafe parsing, bad line grouping,
   failed model startup, and missing offline assets over screenshot polish.
3. Inject failure conditions: corrupt and future-version IndexedDB records,
   quota/transaction abort, missing model asset, offline before install,
   superseded Worker reply, pointer cancellation, and interrupted update.
   Verify both user-visible status and absence of data overwrite.
4. Freeze the V1 Paddle pipeline, then follow the separate
   [benchmark protocol](../RECOGNITION-BENCHMARK.md) for fresh, owner-only
   acceptance ink. Record the first automatic readback and result; correction
   never counts. Use that protocol as the sole source for expression
   categories and pass thresholds. If a change follows a failed acceptance
   run, collect a new acceptance set.
5. On the named owner phone, measure warm final-pen-up to settled visible
   answer across the acceptance attempts and apply the benchmark's p95 gate.
   Record first install and first model load separately, as well as failures
   and timeouts; do not remove slow attempts from the denominator.
6. On a named 60 Hz phone and desktop, trace continuous strokes and erasing
   **while actual model recognition is active**, not only before or after
   inference. Record frame intervals, pointer-to-paint delay, dropped
   drawing frames, and any visible pen stutter across repeated runs. The
   brief requires fluid 60 FPS during recognition: do not mark this gate
   passed unless the trace shows drawing within the 16.7 ms frame budget
   with no observed dropped drawing frames or perceptible lag. If the
   device/browser cannot be measured, mark it unverified, not passed.
   Compare memory after equal blocks of draw/erase/undo, recognition, and
   page-switch cycles; sustained growth after idle is a suspected leak
   that blocks the memory claim until explained or fixed.
7. Repeat the core equation-edit-page-switch flow after a complete offline
   install and reload, including airplane mode on the named phone. Run the
   keyboard/available screen-reader checklist, review production network
   requests, and retest after the visual pass.

## Acceptance matrix

The release evidence must link each master requirement P-01 through P-10 to
its automated check, manual demonstration if needed, observed result, and
open defect. A "pass" is not a statement of intent. At minimum:

- P-01/P-07: multiple pages and corrections survive reload; the last
  committed edit is not lost; malformed legacy data remains recoverable.
- P-02/P-03: pen and both erasers, undo/redo/clear, DPR/resize, and real
  touch/mouse behavior preserve vector geometry and answer alignment.
- P-04/P-05/P-06: first-read benchmark passes with the V1 Paddle pipeline;
  the parser rejects letters, parentheses, powers, and malformed input
  rather than guessing, a changed line loses its old answer immediately,
  and wrong model reads remain visibly reviewable.
- P-08/P-09: full offline equation flow works on the target device; controls
  and result states remain usable with keyboard and available assistive
  technology, with pointer-only ink authorship disclosed.
- P-10: phone latency, active-recognition 60 FPS drawing trace, memory
  observation, device identity, and limitations are recorded.

No outside handwriting writers are available for this gate. Three sessions
from the owner measure repeatability for **one writer only**; cross-writer
accuracy remains unverified and must be stated in the submission.

## Go/no-go rule

A failing build, lost committed data, stale/wrong answer after an edit,
unsafe expression evaluation, missing required control, model rights
uncertainty, incomplete offline flow, failed recognition gate, unverified
60 FPS drawing during recognition, or an unresolved memory leak blocks a
"verified V1" claim. Record the failed evidence
and either fix/retest or submit an explicitly limited prototype. Cosmetic
issues may be deferred only when they do not hide the result, status, or
controls.
