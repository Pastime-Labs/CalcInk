# 06. Canvas Rendering

Status: Implemented locally in Phase 2; physical-device 60 FPS and memory
gates remain open. The prototype is reference only.

Owns requirement P-03: crisp, responsive rendering of vector ink, live
preview, and inline automatic results. It consumes snapshots from
[05. Ink Document](05-ink-document.md) and projections from
[12. Results and Correction](12-results-and-correction.md). It never
calculates arithmetic or changes stored strokes.

## Layers and coordinate contract

The paper is a DOM element inside a scrollable workspace; the paper itself
does not apply an internal scroll transform. Use three aligned transparent
Canvas 2D layers over a CSS paper surface:

1. **Ink:** committed `Page.strokes` only.
2. **Answers:** derived results, errors, and their exact readback/review
   labels. This layer is never fed back to recognition or touched by erasers.
3. **Draft:** the active uncommitted pen gesture and temporary tool cursor.

The input surface sits above these layers; answer and draft canvases do not
intercept pointer events. All layers use the same CSS-pixel world origin at
the paper's top-left. On every resize or device-pixel-ratio change, set each
backing dimension to `round(cssSize * DPR)`, set the context transform to
the DPR scale, and repaint vectors. Changing a canvas's `width` or `height`
resets its state, so reapply the transform after each size change. DPR must
never alter `Page` coordinates or stroke width.

## Rendering behavior

1. Render a one-point stroke as a round dot. Render other strokes from
   coalesced samples with round joins/caps, keeping saved point order and
   corners such as `=` legible. Check curved digits for visible faceting
   on the target devices; if needed, use display-only local curve
   interpolation without changing stored points or recognition input.
   Use the saved base width when pressure is absent; with pressure, use
   a bounded width modulation that does not make zero-pressure strokes
   invisible.
2. On pointer movement, paint only the new draft segment when possible.
   On completed gesture, clear draft, update the vector document, then
   repaint committed ink. On erase, undo, redo, page switch, or resize,
   repaint the committed layer from the page snapshot.
3. Redraw the answer layer from the current, revision-checked projection
   list whenever results change. A changed equation removes its old answer
   immediately; a late Worker result must be rejected before rendering.
4. Anchor each answer immediately to the right of its line's terminal `=`
   in paper coordinates. Measure its text bounds and extend the paper's
   horizontal extent when needed; the workspace scrolls horizontally
   instead of moving the answer below the equation or clipping it.
   Recheck placement after a font load. Never cover handwriting: if ink
   already occupies the adjacent answer footprint, show a visible
   placement conflict and the result in Readback until the ink changes.
   Keep readback/error text visually associated with its answer.
5. The DOM Readback panel and live result announcement are separate
   accessibility outputs. Canvas text alone is not accessible text; see
   [15. Accessibility and Devices](15-accessibility-and-devices.md).
6. The paper extends to include stored stroke bounds, result bounds, and
   a small drawing margin. Horizontal and vertical overflow scroll rather
   than clipping or rescaling old ink. Recompute extent after edits and
   font readiness, not on every pointer sample.
7. Use `ResizeObserver` for paper/layout changes and a DPR check on window
   resize. Handle canvas context loss with a visible warning and repaint
   all layers from vectors after restoration. Never persist canvas pixels.

## Performance path

Start with one full-paper canvas per layer, because it is the smallest
correct renderer for a short arithmetic page. Use `requestAnimationFrame`
to batch repeated draft and result paints; do not redraw all committed ink
on every raw pointer sample. Measure long-page drawing time and memory on
the named target phone as required by
[17. Quality and Performance](17-quality-and-performance.md).

If that gate fails because full-paper backing stores grow too large, replace
them before release with 512-by-512-CSS-pixel world tiles. Mount and repaint
only tiles intersecting the visible scroll window; each tile applies its
world-origin translation after the DPR transform. Keep the same public
rendering contract and vector source of truth. An unbounded full-page canvas
is not an acceptable release workaround for a failed memory gate.

## Build order and tests

1. Implement backing-size and world-to-canvas helpers; test DPR 1, 1.5,
   and 2, including resize without coordinate drift.
2. Render pen dots, multi-segment strokes, curved `3`/`9` shapes, sharp
   operators, pressure and no-pressure paths. Check smoothness and shape
   preservation on mouse, touch, and stylus where available. Compare
   post-resize output to a fresh draw from the same vector data.
3. Add draft rendering and clear it on commit/cancel/page switch. Add answer
   rendering separately, with value, undefined, syntax, incomplete, and
   unreadable states supplied by equation/results logic.
4. Test a right-edge answer extends paper width and remains beside `=`
   while horizontally scrolled, including after a font load. Test
   adjacent ink triggers the placement conflict rather than overlap, and
   confirm projections never enter recognition input or eraser geometry.
5. Browser-test scroll and resize with ink at the far right/bottom, context
   restoration, and no ghost draft after cancellation. Record frame time
   and memory evidence on a real device before this gate is marked passed.

Done means the same vector page renders crisply and without clipped or
stale marks at supported sizes, with results visually separate from ink.
