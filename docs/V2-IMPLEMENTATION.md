# CalcInk V2: Implementation Plan

Status: **V2 app paths integrated locally; physical-device and release
acceptance gates remain open**, 7 October 2026. The
[V2 design](V2-DESIGN.md) owns product scope. The
[V1 plan](IMPLEMENTATION.md) and its unfinished release gates still apply.
V2 refers to the product release, not the IndexedDB schema version. New A4
records use schema 3; existing schema-2 pages retain legacy geometry.

## Verification Snapshot

The latest local verification on 7 October 2026 passed `npm test`
(166 Vitest and 21 Node tests), `npm run build` (including offline precache
verification), and `npx playwright test --workers=1` (41 browser journeys).
This dated snapshot is not physical-device or hosted-release evidence.

Remaining release gates: a fresh phone drawing trace during OCR,
stylus/finger checks where hardware permits, real print/PDF inspection,
the V1 handwriting benchmark, and model/icon redistribution rights.
An edge-conflicted answer currently blocks printing; the final fallback
remains an open product decision in [the design](V2-DESIGN.md#5-resolved-and-open-decisions).

## Delivery Order

| Phase | Owner modules | Deliverable | Exit check |
| --- | --- | --- | --- |
| 0. Baseline | `docs/`, existing V1 app and tests | Close dependent V1 gates; capture a multi-page/corrected fixture, phone drawing trace, and offline baseline. | Existing data reloads and OCR answers correctly before V2 changes; record browser/device and commands. |
| 1. A4 geometry and zoom | `src/canvas/types.ts`, `render.ts`, `input.ts`, `src/ui/app.ts`, `src/style.css` | Canonical 210:297 page coordinates for new pages, one shared screen/world transform, fixed sheet bounds, automatic view fit, a 25%-200% page zoom slider synchronized with touch pinch, and no separate Fit Page or 100% buttons; retain legacy rendering for old pages. | New sheet keeps its ratio on phone, desktop, resize, and DPR change; ink, lasso-ready hit coordinates, and answers align at automatic fit, after slider changes, and after gesture zoom; old pages remain readable and unchanged. |
| 2. Storage and ordered pages | `src/db/`, `src/canvas/document.ts`, `src/ui/app.ts`, `shell.tsx` | Versioned page geometry/order/template metadata, deterministic migration, stable insert-after-current order, and accessible page actions. | Titles, ink, corrections, active page, and order survive reload/offline; failed create/rename/delete never reports success or loses the current page; keyboard and touch can create and navigate. |
| 3. Expressive ink | `src/canvas/types.ts`, `document.ts`, `input.ts`, `render.ts`, `src/worker/raster.ts`, `src/ui/` | Per-stroke color/style, bounded speed-responsive Pen, Pencil, local Pen-only preference, and Blank/Ruled/Grid/Dots per-notebook-page templates. | Eraser splits and undo/redo retain style; reload and print redraw it; stylus draws while fingers pan in Pen-only mode; OCR sees geometry-only black ink on white and unchanged arithmetic behavior. |
| 4. Lasso | `src/canvas/document.ts`, `input.ts`, `render.ts`, `src/ui/app.ts`, `equations.ts` | Closed-path whole-stroke selection, preview, move/delete, deselect, and one-command undo/redo. | Preview causes no save/OCR; a commit updates only selected strokes, rejects moves beyond notebook A4 edges, invalidates stale answers/corrections, and reruns affected lines. Boards have no A4 edge. |
| 5. Interface | `src/ui/shell.tsx`, `src/ui/figma-shell.css`, `src/style.css`, `ICONS/` | Supplied tool icons after rights clearance; selected/focus states; restrained translucent dark notebook chrome and sheets with solid fallback; clean sheets without instructional copy; reduced-motion support. | Controls have names and visible focus, work by mouse/touch/keyboard, keep the sheet opaque and free of duplicate labels, and remain legible without blur or animation. Previously saved black notebook ink stays visible without changing stored colors. |
| 6. A4 print and acceptance | Print stylesheet/export path in `src/ui/` and `src/style.css`; all affected tests | Current-page browser print/Save as PDF at A4 with template, colored ink, and settled answers, excluding controls/readback. | Print preview and PDF preserve ratio and content without clipping; migrated/new pages pass reload, storage-failure, offline, phone OCR, pan/zoom, and drawing-frame checks. |
| 7. Home, scrollable book, and black canvas | `src/ui/home.tsx`, `src/ui/notebook-stack.ts`, `src/ui/app.ts`, `src/db/`, `src/canvas/`, tests | Home library matching the supplied screenshot; New menu chooses Notebook or Black infinite canvas. Remove the folded-corner control. Stack A4 pages in one vertical scroll area; select any page to edit. Keep explicit Add page. Give the black canvas a viewport camera over unbounded world-space ink. | Existing data opens safely; both library kinds persist/reopen offline; all notebook pages remain reachable by scroll and selection; pan/zoom never changes board ink coordinates; drawing/OCR/answers remain aligned; no A4 edge or corner control appears on the board. |

## Verification Targets

- Unit tests: coordinate round trips, A4 bounds, zoom invariance, style
  cloning/eraser/history, lasso selection and atomic edits, page ordering,
  validation/migration/recovery, and OCR raster independence from display
  color, pencil texture, and templates.
- Browser tests: create/open both library kinds after reload, scroll/select
  nonadjacent A4 pages, explicit Add page and keyboard fallback, board
  pan/zoom with unchanged stored ink, pointer alignment after automatic
  fit, slider and gesture zoom, and camera moves, Pen-only routing, answer conflict
  handling, offline reload, and current-page notebook print styling.
- Manual evidence: physical-phone stylus/finger gestures where supported,
  continuous book scrolling without accidental ink, black-board pan/zoom,
  print preview/PDF on target browsers, contrast/reduced-motion checks,
  and frame traces while OCR runs. Record failures rather than treating a
  clean build as a release pass.
