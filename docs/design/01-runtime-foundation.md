# 01. Runtime Foundation

Status: Implemented locally in Phase 1; an isolated clone of committed
`4f1833c` downloaded assets and passed install/build/tests on Windows.
The final public checkout and hosted CI remain unverified. The prototype
is reference only.

## Purpose and boundary

Establish a reproducible, browser-only application before rebuilding product
behavior. This section owns the project skeleton, module boundaries, startup
order, and developer commands. It does **not** certify recognition, offline
operation, or a finished interface. The product and requirement IDs live in
[the master design](../DESIGN.md); the release gates live in
[the implementation plan](../IMPLEMENTATION.md).

## Decisions and contracts

- Preserve the archived `prototype/` in a private, retrievable snapshot
  before changing it. Build V1 from clean modules; use prototype code
  and tests as reference material, not as evidence that V1 is complete.
- Keep Vite, strict TypeScript, native DOM/CSS, Canvas 2D, Pointer Events,
  IndexedDB, PaddleOCR.js worker-backed inference/ONNX Runtime Web, Vitest,
  and Playwright. V1 uses a dedicated application Worker for rasterization
  and the SDK's nested Worker for inference; phone drawing responsiveness
  still needs measurement. Do not introduce a UI framework,
  backend, account system, cloud inference, or runtime CDN.
- Keep `src/main.ts` as the entry point and `src/ui/app.ts` as the
  composition root. The app connects the repository, active page, ink
  document, renderer, input controller, and equation session. Pure ink,
  grouping, preprocessing, and arithmetic modules must not import the DOM
  or storage.
  The recognition adapter owns model loading and worker-backed inference;
  UI modules never run tensors.
- Treat a page snapshot as the only durable ink source of truth. Canvas pixels,
  derived equation lines, results, Worker requests, and undo stacks are
  transient. Persistence is specified in
  [13. Persistence](13-persistence.md).
- Build and run from the checked-in lockfile with `npm ci`, `npm run dev`,
  `npm test`, `npm run build`, and `npm run test:e2e`. Production behavior is
  tested with the built app, not just Vite's development server.

The dependency direction is:

```text
DOM shell + pointer adapter -> page controller -> ink document
                                       |                |
                                       v                v
                                  repository      equation session
                                                  /           \
                                                 v             v
                                    recognition adapter    math parser
                                         (raw read)       (after raw read)

ink document + result projections -> canvas renderer
```

The arrows express ownership of calls, not a requirement to add an
application-wide event bus or dependency-injection framework.

## Build sequence

1. Record the prototype baseline and verify a clean checkout installs, tests,
   and builds. If `npm ci` cannot replace a locked native binary on Windows,
   stop running Vite/preview/Node processes using it, then retry; do not
   delete arbitrary workspace paths.
2. Keep the V1 module boundaries in `src/canvas`, `src/parser`,
   `src/worker`, `src/db`, `src/pwa`, and `src/ui`. Keep module
   interfaces small and import direction as above.
3. Configure strict type checking, unit tests for pure modules, and a
   production-build browser smoke test. Reserve local paths for Worker and
   static model assets; Phase 3 loads them and
   [14. Offline PWA](14-offline-pwa.md) defines their full cache contract.
4. In Phase 1, render a loading/error shell with a clearly temporary
   workspace state. Do not call it a saved notebook or an offline-ready app.
5. In Phase 2, open/migrate local storage, resolve or create the active page,
   then attach the renderer and pointer handlers. In Phase 3, start
   recognition asynchronously after the page appears so model loading
   cannot block drawing.
6. In Phase 4, register the service worker only in the production path.
   Distinguish `online`, `cached for offline`, and `offline` states; only
   completed cache installation supports a "Ready offline" claim.
7. Route errors to the shell by subsystem as each subsystem is integrated:
   storage, canvas, recognition, and offline cache. A failed model must not
   disable drawing. A failed storage open may allow an ephemeral page, but
   it must visibly say "Not saved".
8. Add tests at each boundary before filling in later subsystems. No
   placeholder implementation may be counted as satisfying a P0 behavior.

## Startup and failure rules

- Until storage resolution completes, drawing and page mutation controls are
  disabled; no blank page may overwrite a legacy or unreadable record.
- If no saved pages exist, create exactly one blank V1 page and make it
  active. If a saved active ID is missing, select an existing page without
  deleting any record.
- If recognition fails to initialize, ink editing and local saving remain
  usable; result controls show a clear unavailable state, not a fake answer.
- If Canvas 2D is unavailable, show an explicit unsupported-browser error
  instead of accepting invisible strokes.
- The app must never fetch a model, font, WASM file, or icon from a third-party
  host at runtime. Model redistribution rights are a separate release gate.

## Tests and done gate

- A new checkout installs from the lockfile, type-checks, runs unit tests,
  builds, and starts a production preview without undocumented setup.
- A Phase-1 browser smoke test sees the temporary shell load without a crash.
  Later integration checks see loading resolve to a blank or restored page,
  simulated model failure still allow drawing, and simulated storage failure
  give a visible unsaved warning.
- Inspect the Phase-1 production network log: its existing assets use only
  the app host. Repeat after Phase 3 to cover model/Worker assets; no remote
  inference or runtime CDN request is permitted.
- Record the exact commands and outcomes in the delivery evidence. Passing
  the Phase-1 gate means the foundation is ready for later sections, not that
  their storage, model, or offline contracts have passed.
