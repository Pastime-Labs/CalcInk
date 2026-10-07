# CalcInk Product V2: Notebook, Black Canvas, and Expressive Ink

Status: **V2 app paths integrated locally; physical-device and release
acceptance pending**, 7 October 2026. V2 is a product version, not an
IndexedDB schema version. The V1 release gates in `IMPLEMENTATION.md`
still apply.

## 1. Product Goal

Make CalcInk feel like a deliberate, portable place to work without changing
its core promise: write an arithmetic expression, see a trustworthy answer
beside the ink, and keep all recognition and writing data on-device. The home
library opens either a vertically scrollable A4 notebook or a black,
unbounded whiteboard-style canvas. V2 also adds expressive tools and a
restrained glass-inspired interface. It does not add cloud services or more
math syntax.

## 2. Approved Scope

| ID | Feature | V2 behavior and acceptance |
| --- | --- | --- |
| V2-01 | Ink colors | Offer the reference design's Black, Gray, Light gray, White, Blue, Red, Green, and Yellow swatches plus a custom color picker. Color belongs to each stroke; changing the selected color never recolors old ink. Warn when a color has poor contrast against the current paper or board. Display old near-black notebook ink as light ink on dark pages without changing its stored color, and explain this adaptation in the picker. |
| V2-02 | Strict A4 pages | New notebook pages are portrait A4 with a fixed 210:297 content ratio. Ink and results cannot silently enlarge the sheet. The page keeps that ratio across phones, desktops, orientation changes, and print. Keep the sheet free of instructional copy and duplicate page titles/counts; those remain in surrounding controls. The black canvas has no paper edge. |
| V2-03 | Responsive pen and pencil | Add a Pencil tool and make Pen width respond smoothly and within bounds to drawing speed. Stylus pressure remains meaningful. Save enough stroke data to redraw each style consistently after reload; do not simulate expensive ink physics. |
| V2-04 | Home library and creation | Open to a library styled after the supplied reference screenshot. Its `+`/New control offers **Notebook** and **Black infinite canvas**. Created items appear in the library and reopen after reload. A Back to library action returns without losing edits. There is no folded-corner page control. |
| V2-05 | Scrollable notebook | Stack A4 pages vertically in stable order inside one scrollable book, like a PDF. Every page can be selected for editing without leaving the book; scrolling alone must not change the saved page or steal a drawing gesture. Keep an explicit Add page action and optional previous/next/position controls for accessibility and quick jumps. Create, switch, rename, and delete remain safe when storage fails. |
| V2-06 | Glass-inspired UI | Apply a coherent translucent material to navigation, toolbars, menus, and panels. Both workspace modes use consistent dark chrome; keep writing surfaces opaque. Provide legible solid fallbacks for unsupported or reduced-transparency environments and reduced-motion alternatives. |
| V2-07 | Supplied icons | Use the four local `ICONS/` assets for Pen, Pencil, Stroke Eraser, and paper/template control after an asset-rights check. Keep or restyle existing icons for actions without supplied assets; do not invent missing user-provided icons. |
| V2-08 | Lasso | Draw a closed selection path, select intersecting whole strokes, move or delete them, and deselect. A committed move/delete is one undoable edit and reruns affected recognition. Resize, rotate, and partial-stroke selection are outside this slice. |
| V2-09 | Automatic fit and view zoom | Fit an A4 notebook page to the available view by default. Provide a 25%-200% page zoom slider instead of separate Fit Page and 100% buttons; keep its value synchronized with touch pinch. Keep drawing, lasso hit-testing, and answers aligned. Zoom changes the view, not stored stroke coordinates or A4 dimensions. The board uses its own camera pan/zoom. Keep browser accessibility zoom available. |
| V2-10 | A4 print/PDF | Print only the selected notebook page at A4 size using the browser print or Save as PDF flow, entirely locally. The printed page includes its visible paper template, colored ink, and settled answers, but excludes controls, inactive page previews, and private diagnostic readback. |
| V2-11 | Pen-only mode | One finger draws by default; two fingers pan or zoom the book or board. An optional local preference prevents touch or palm contacts from making ink/eraser marks while a stylus writes. When enabled, one finger scrolls the book or pans the board; mouse remains usable on desktop. |
| V2-12 | Paper templates | Offer Blank, Ruled, Grid, and Dots per notebook page. The choice survives reload and appears in print, but is never included in OCR input. |
| V2-13 | Black infinite canvas | A separate library item opens an opaque near-black workspace without A4 edges or pagination. Pan a viewport camera over unbounded world coordinates and zoom without moving stored ink. Persist ink and a best-effort view preference across normal reloads. Keep OCR and answers on-device; legible default ink and controls must work against the dark surface. The print/PDF A4 contract applies to notebooks, not this canvas. |

## 3. System Contracts

### Page Geometry and Existing Data

- Define one canonical portrait A4 coordinate space and transform it to the
  displayed size. Pointer input, canvas layers, lasso, result projection,
  and print output must use the same geometry. DPR changes alter only canvas
  backing resolution.
- The current app stores ink in viewport CSS-pixel coordinates and expands
  paper to fit ink and answers. Saved V1 pages do not record their original
  viewport size, so an exact automatic A4 conversion is impossible.
  **Safe policy:** new pages use A4; existing pages remain readable in
  legacy geometry until the owner chooses a previewed, non-destructive
  Fit to A4 conversion. Do not silently convert old pages.
- Fixed A4 paper also removes V1's right-edge expansion. Reserve space for
  inline answers where possible; never cover ink or clip an answer. The
  current fallback moves the answer to Readback when `=` is too close to
  the edge. Its final UX and print behavior remain release decisions.
- Give pages a durable order independent of last-edit time. The explicit
  Add page action inserts immediately after the current page. The book is
  one vertical scroll container: inactive pages may use lightweight previews,
  but selecting one must expose its actual editable strokes and answers at
  the same position. Migration must preserve existing titles, ink,
  corrections, active page, and recovery behavior.
- Inactive previews show saved ink for browsing, not computed answers. The
  current print/PDF action must render only the selected editable A4 page;
  whole-book print would silently omit answers and is out of scope.
- Give every library item a durable kind and identity. Existing saved pages
  must remain accessible as a notebook rather than being silently converted
  to a black canvas. A board stores strokes in world coordinates; its
  viewport camera moves independently of those coordinates, so panning or
  zooming cannot rewrite ink or invalidate OCR. Persist camera pan/zoom as
  a view preference separately from IndexedDB ink; an abrupt tab crash may
  lose the latest camera motion but must not lose saved strokes.

### Ink, Recognition, and Storage

- Keep color and brush style on each stroke, with safe defaults for old
  strokes. Update document cloning, eraser splits, undo/redo, storage
  validation, and export together so metadata is not lost.
- Timestamped points and optional stylus pressure already exist. Use a
  bounded, smoothed speed response; never make a fast stroke disappear or
  let widths explode after a delayed event. Define a deterministic fallback
  for missing or repeated timestamps.
- Pencil texture is a display/print style, not noise fed to OCR. The OCR
  Worker continues to rasterize visible stroke geometry as high-contrast
  ink on white, independent of user color or paper template. Recognition
  remains off the main thread.
- Lasso selection previews do not mutate the page or launch OCR. A committed
  move/delete changes stroke coordinates, invalidates stale results and
  correction associations as needed, advances the canvas revision, and
  recomputes affected lines. No moved stroke may be silently clipped by A4.
- Version stored records and test migration/recovery. Never replace a
  corrupt or future-version page with an empty page. Page and preference
  changes remain local; there is no account or network sync.
- On a black canvas, recognition crops and answer placement must use world
  coordinates and remain consistent after pan/zoom. Do not add arbitrary
  board bounds to reuse A4 clipping rules. A dark surface changes display
  colors, not the Worker's high-contrast OCR raster.

### Interaction and Visual Rules

- The home `+` is a real focusable control with touch-sized choices for
  Notebook and Black infinite canvas. Its menu dismisses by Escape and
  outside tap; no action depends on hover. In a notebook, Add page remains
  visible or otherwise discoverable without a corner gesture.
- Two-finger vertical swiping browses the notebook. Black-canvas pan/zoom
  gestures move its camera without moving stored ink. Drawing, scrolling,
  selection, and browser navigation must not compete for the same pointer.
- Make paper or board the opaque content layer and glass the functional layer.
  Avoid full-page blur or stacked glass over glass: they reduce legibility
  and can cost drawing frames.
- Every icon-only control has a visible selected/focus state and an
  accessible name. User-supplied PNGs are presentation assets, not the
  entire icon system.
- Low-contrast colors on the dark notebook or board can become nearly
  invisible. Show the actual displayed color and a contrast warning.
  Adapt the old near-black notebook display only; never silently change
  stored stroke colors, and explain the adaptation in the color picker.

## 4. Exit Gates and Non-Goals

V2 is not accepted until new and migrated pages survive reload, undo,
switching, storage failure, and offline use without data loss; ink and
answers remain aligned at automatic fit, after slider changes, and after
gesture zoom; page printing does not clip content; the library reopens both
kinds; the notebook scrolls continuously; board ink survives camera moves;
touch and keyboard can reach all page actions; and physical-phone drawing
remains responsive during OCR. Record actual
device/browser and trace evidence rather than inferring 60 FPS from
appearance. Do not silently replace the existing recognizer or relax the
stale-Worker-response guard.

Out of scope unless approved separately: variables/algebra, folders,
search, cloud sync, collaboration, all-pages PDF generation, black-board
PDF export, direct PDF libraries, lasso resize/rotate, and native iOS
material rendering.

## 5. Resolved and Open Decisions

1. **Resolved:** old V1 pages remain in legacy geometry until an explicit,
   previewed conversion exists. No automatic best-effort fitting.
2. **Open:** decide the final on-page/readback and print behavior when an
   A4 sheet has no room immediately right of `=`.
3. **Open:** confirm redistribution rights for the four supplied PNGs.
