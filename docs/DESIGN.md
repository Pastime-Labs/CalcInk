# CalcInk V1: Master Product and Engineering Design

Status: **V1 design contract with core Phase 1-4 paths implemented locally**,
updated 4 October 2026. Release acceptance remains open; see the
[implementation snapshot](IMPLEMENTATION.md#execution-snapshot-4-october).
The archived app under [`prototype/`](../prototype/README.md) is not the
V1 implementation. Preserve a private snapshot before changing the archive.
Use its failures and tests as evidence, not as V1 acceptance.

This is the single source of truth for V1 scope and cross-system contracts.
The numbered documents below own implementation detail. If a detail conflicts,
resolve it here first, then update its owner document and the relevant test.

## 1. Product Promise

CalcInk is an offline-first handwritten arithmetic scratchpad. A student opens
a page, writes a numerical expression ending in `=`, sees an answer beside the
ink, edits the handwriting, and sees the old answer disappear before a fresh
one is shown. All handwriting recognition and arithmetic run locally in the
browser. No account, server, camera, or network inference is required after
the first complete installation.

V1 supports several **simple local pages**: create, rename, switch, and delete
pages. It is not yet the fully organized multi-page notebook envisioned for
V2. Folders, search, sync, and general mathematical problem solving are not
part of V1.

The primary session is:

1. Open the last active page or a new blank page.
2. Draw `18+4×3=` with a mouse, finger, or stylus.
3. See the exact model readback and the computed `30` beside the ink.
4. Erase the `4`, write `5`, and immediately lose the stale `30`.
5. See `33` only after the changed line is recognized and parsed again.
6. Correct a model misread in Readback without changing the original ink.
7. Switch pages, reload, then repeat an equation and edit while offline.

Readback correction is a safety fallback. It does **not** count as a correct
first automatic recognition.

## 2. V1 Requirements and Boundaries

| ID | Required behavior | Owning deep dive |
| --- | --- | --- |
| P-01 | Create, rename, switch, and delete local pages; retain at least one blank page. | [03](design/03-page-management.md), [13](design/13-persistence.md) |
| P-02 | Smooth pen input, pressure where available, pen width, stroke/pixel erasers, undo, redo, and undoable clear. | [04](design/04-pointer-input.md), [05](design/05-ink-document.md) |
| P-03 | Crisp, correctly positioned vector ink and inline answers across resize and DPR 1/2. | [06](design/06-canvas-rendering.md) |
| P-04 | Recognize digits, decimal point, `+`, `-`, `×`, `÷`, and final `=` from handwriting using local PP-OCRv6 tiny detection and recognition. | [08](design/08-recognition-evidence.md)-[10](design/10-model-inference.md) |
| P-05 | Parse multi-digit numbers, decimals, unary signs, operator precedence, zero division, and malformed input without executing source text. | [11](design/11-arithmetic-engine.md) |
| P-06 | Show an answer or controlled error per recognized line; invalidate changed lines immediately; provide persistent per-line Readback correction. | [07](design/07-equation-orchestration.md), [12](design/12-results-and-correction.md) |
| P-07 | Start saving completed edits promptly, confirm only durable saves, and recover safely from corrupt or legacy data. | [13](design/13-persistence.md) |
| P-08 | Load once online, then reload, draw, recognize, edit, and switch pages offline. | [14](design/14-offline-pwa.md) |
| P-09 | Usable desktop/phone controls, keyboard-accessible actions, visible status, and DOM-announced results. | [02](design/02-frontend-shell.md), [15](design/15-accessibility-and-devices.md) |
| P-10 | Measure drawing smoothness, model latency, memory, and real-device behavior before release. | [17](design/17-quality-and-performance.md) |

### Problem-statement traceability

The locally supplied source brief (`Software Dev Bootcamp.pdf`) is one tall PDF page
(p. 1). This table maps its **required** outcomes to our internal P-IDs and
build documents; the P-IDs above are not quotations from the brief.

| Source brief, p. 1 | CalcInk coverage and release evidence |
| --- | --- |
| Responsive digital notebook and continuous handwriting with mouse, stylus, or touch. | P-02/P-09; [input](design/04-pointer-input.md), [device checks](design/15-accessibility-and-devices.md). |
| Low-latency smooth ink; pen width, stroke and pixel erasers, undo, redo, clear, and device-pixel-ratio handling. | P-02/P-03/P-10; [ink](design/05-ink-document.md), [rendering](design/06-canvas-rendering.md), [frame evidence](design/17-quality-and-performance.md). |
| Recognize handwritten `0`-`9`, `+`, `-`, `×`, `÷`, decimal point, and terminal `=` using an existing open-source pretrained model bundled in the client. | P-04; [evidence](design/08-recognition-evidence.md), [preprocessing](design/09-ml-preprocessing.md), [model choice](design/10-model-inference.md). |
| Evaluate multi-digit, floating-point, and negative-number arithmetic with deterministic BODMAS. | P-05; [arithmetic engine](design/11-arithmetic-engine.md) and parser tests. |
| Draw the answer on the canvas immediately adjacent to the final `=`; erase/replace ink and recalculate without retaining a stale answer. | P-03/P-06; [rendering](design/06-canvas-rendering.md), [orchestration](design/07-equation-orchestration.md), [results](design/12-results-and-correction.md). |
| Keep capture, preprocessing, inference, and calculation entirely in the browser; use no remote vision/math API; remain fully usable offline after assets load. | P-04/P-08; [runtime](design/01-runtime-foundation.md), [Worker](design/10-model-inference.md), [offline](design/14-offline-pwa.md). |
| Keep heavy image parsing and inference off the drawing thread and drawing fluid at 60 FPS during recognition, without perceptible pen lag. | P-10; [Worker](design/10-model-inference.md), [rendering](design/06-canvas-rendering.md), [measured go/no-go](design/17-quality-and-performance.md). |
| Do not use unsanitized `eval`; handle division by zero as `Undefined` and malformed syntax without an unhandled exception. | P-05/P-06; [bounded parser](design/11-arithmetic-engine.md), [error states](design/12-results-and-correction.md). |
| Submit a public modular/documented GitHub or GitLab repository, README with quick start and model source link/license/architecture, and a public hosted demo. | [implementation](IMPLEMENTATION.md) and [release checklist](design/18-release-and-bug-bash.md); these remain unfulfilled until published and checked. |
| Team size is up to three; submission deadline is "7th October" without a year, cutoff hour, or timezone. | [Solo ownership and dated internal gates](IMPLEMENTATION.md). The 2026 date is our planning assumption, not extra wording in the brief. |

The brief's evaluation rubric is distinct from the required-feature list:

| Scored area, p. 1 | Weight | Design/evidence owner |
| --- | --- | --- |
| Feature implementation and test suites: canvas, recognition, arithmetic, edge and coordinate tests. | 25% | [Ink](design/05-ink-document.md), [recognition](design/08-recognition-evidence.md), [arithmetic](design/11-arithmetic-engine.md), [quality](design/17-quality-and-performance.md). |
| Idea and architecture: model size/speed/accuracy/alternatives, raw-stroke-to-tensor pipeline, and design clarity. | 20% | [Runtime](design/01-runtime-foundation.md), [preprocessing](design/09-ml-preprocessing.md), [model choice](design/10-model-inference.md). |
| Performance and runtime: 60 FPS while recognizing, non-blocking work, complete offline use, and memory stability. | 20% | [Worker](design/10-model-inference.md), [offline](design/14-offline-pwa.md), [quality](design/17-quality-and-performance.md). |
| Teamwork and engineering: meaningful commits, modular source, clean docs, reproducible setup, and review trail. | 15% | [Solo implementation](IMPLEMENTATION.md), [release](design/18-release-and-bug-bash.md). |
| Creativity and UX: visual clarity, natural paper feel, micro-interactions, and thoughtful extensions. | 20% | [Frontend](design/02-frontend-shell.md), [visual pass](design/16-visual-design-pass.md). |

With one human contributor, any PR/review evidence must be described
honestly; AI review is not a second human review. Sound, haptics, scratch
erasing, variables, and plotting are rubric examples, not mandatory
features.

Simple local pages, persistent Readback correction, and the later bug bash
are **CalcInk additions**, not source-brief mandates. Parentheses and powers
are deferred to V2 so the brief's arithmetic, adjacent answer, offline,
60 FPS, and submission gates receive the available time.
The brief sets no numeric recognition-accuracy or answer-latency threshold:
the linked benchmark's thresholds are internal.

The required written grammar is **numeric arithmetic**, not general math:
digits `0`-`9`, decimal point `.`, unary `+`/`-`, binary `+`/`-`/`×`/`÷`,
and one terminal `=`. The parser uses canonical `*` and `/` internally
for the two drawn operators. V1 applies multiplication/division before
addition/subtraction and never silently guesses a digit from context.
Letters, including `x` as a variable, are not accepted expressions.

Unsupported V1 notation includes parentheses, powers, stacked fractions,
square roots, variables, algebra, free-form LaTeX, and equation solving.
Notebook export/import, folders, search, accounts, cloud sync,
collaboration, and cosmetic sound/haptics are deferred. They may be
reconsidered for V2 only after V1 works. V1's opt-in diagnostic sample
export and emergency corrupt-record
download are recovery/test tools, not general notebook portability. No
external telemetry or upload of ink is part of V1. The diagnostic keeps
data local until a person deliberately shares it.

## 3. User Interface and States

The first functional build has a paper workspace, page switcher, labeled
tools, model/save/offline status, and Readback. It must work at phone and
desktop sizes. Do **not** spend the structural build on a final visual theme:
after the core works, run the separate [visual-design pass](design/16-visual-design-pass.md)
with external references or skills. The functional build still needs readable
contrast, visible focus, touch-sized controls, and clear error feedback.

| State | Required user-visible response |
| --- | --- |
| Loading model | Drawing and page navigation remain available; no invented answer. |
| No terminal `=` | Preserve ink; do not project a numeric answer. |
| Recognition queued/running | Remove any old answer for the changed line and show `Reading...`. |
| Valid result | Show the answer beside the source line and expose the exact automatic readback. |
| Divide by zero or non-finite result | Show `Undefined`, not a crash or `Infinity`/`NaN`. |
| Unreadable or invalid expression | Show a fix/check prompt; never silently evaluate a guessed expression. |
| Offline-ready | Drawing, recognition, editing, page switching, and saving still work after reload. |
| Model/storage failure | Keep ink editable; explain which capability is unavailable or unsaved. |

Canvas is a pointing-device surface. Keyboard users can operate controls and
Readback, and results have a DOM announcement. V1 does not claim keyboard
handwriting or an equivalent typed-expression authoring flow.

## 4. Architecture and Shared Contracts

The [system architecture](ARCHITECTURE.md) owns the complete component
map and offline asset boundary. These are the shared contracts the deep
dives must preserve.

Use Vite + TypeScript, native Canvas 2D and Pointer Events, a local
PP-OCRv6 tiny detection-plus-recognition pipeline with a Worker and ONNX
Runtime Web, IndexedDB, and a static PWA service worker. Keep
the build deployable as static HTTPS assets. A UI framework or backend is not
needed for this V1 scope. The app must not fetch model assets from a CDN at
runtime or call JavaScript `eval`.

```text
Pointer Events -> vector ink document -> ink/draft canvases
                         |                      |
                         +-> page repository    +-> answer canvas
                         |
                         v
                 equation line grouping
                         |
                         v
             revision-aware equation session
                         |
                         v
          stroke-to-raster -> PaddleOCR Worker
                         |
                         v
          raw read -> normalization -> safe parser
                         |
                         v
           revision-checked result + Readback
```

The shared ink contract is `Point {x,y,pressure?,t?}`,
`Stroke {id,points,width}`, and
`Page {schemaVersion:2,id,title,createdAt,updatedAt,strokes}`. Coordinates
and widths are CSS-pixel world units. Page `createdAt`/`updatedAt` are
numeric epoch milliseconds; point `t` is page-local elapsed milliseconds.
Page-specific corrections live in a stored
`SavedPage {page, corrections}` wrapper, not in canvas pixels. Undo/redo
history is session-only and may survive page switches until deletion.

The recognition request contains `requestId`, `pageId`, `lineId`, `canvasRevisionId`,
and the changed line's strokes. It returns the same identifiers plus raw
recognized text, elapsed time, or a typed error. It does **not** calculate the
answer. The equation session invalidates a changed line before scheduling
recognition and ignores a response unless every identifier and revision still
matches. The model keeps its original output dictionary; normalization
accepts only the V1 arithmetic alphabet and rejects other characters
without repairing them into plausible digits.

The arithmetic engine accepts only normalized text ending in `=` and returns
a tagged `value`, `undefined`, or `syntax` result. Unary signs and
multiplication/division precedence are deterministic; all tokens must be
consumed. Corrections are tied to the exact ink-line signature and disappear
on that line's edit.

The multi-page repository exposes `listPages`, `getPage`, `savePage`,
`deletePage`, `getActivePageId`, and `setActivePageId`. The new versioned
IndexedDB records live apart from the prototype's legacy `working-page`
record; migration copies before switching the active-page pointer and never
destroys the original on failure.

## 5. Build Order and Deep Dives

The [phase-by-phase implementation plan](IMPLEMENTATION.md#2-implementation-phases)
is the single index for all 18 numbered elementary deep dives, including
work that starts in one phase and finishes in another. Each deep dive
defines behavior, interfaces, build steps, failures, tests, and its exit
gate. Build in dependency order, not filename order. Accessibility, privacy,
and regression checks apply throughout rather than being deferred to the
hardening phase.

The [solo workflow](WORKFLOW.md) defines the
repeatable execution and Git protocol. The
[recognition benchmark](RECOGNITION-BENCHMARK.md) defines repeatable
handwritten attempts. Do not duplicate their detailed logs here.

## 6. Acceptance and Risk Rules

The first target demonstration uses only brief-required notation: write
`11+11=`, see a correct first automatic answer immediately beside `=`,
edit its ink, see the old answer vanish, then repeat after an offline
reload on a phone. Separately demonstrate the added page workflow.
Corrected answers demonstrate the fallback, not model accuracy.

The owner-only submission benchmark uses 20 expressions in three fresh
sessions after a separate development set. Exact readback is compared
after notation-only normalization; raw model text is retained, and no
digit repair or parser guess counts. The exact score and category gates
belong to the [recognition benchmark](RECOGNITION-BENCHMARK.md). Measure
warm pen-up-to-answer on the owner's phone and initial installation
separately. The brief itself requires fluid 60 FPS drawing during active
recognition; a verified V1 needs measured evidence of that behavior
without visible pen lag or dropped drawing frames. The benchmark's
numeric thresholds are internal product gates, not claims from the
problem statement.

No outside handwriting writers are currently available. Repeated attempts
by one person can test that person's workflow but cannot establish
cross-writer accuracy. Publish that limitation even if the owner-only gate
passes. A public model bundle also requires documented redistribution
rights; an unresolved rights review is a release blocker, not a footnote.

The internal targets are code-complete by 5 October, device/release checks on
6 October, and submission by 7 October 2026; the exact organizer cutoff time
is still unknown. If a critical behavior fails, report it as an incomplete
submission rather than claiming a verified V1. Bugs found during development
are fixed immediately. A separate bug bash starts only after release and
counts only reproducible reports with verified fixes.
