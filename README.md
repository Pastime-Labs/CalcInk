# CalcInk

CalcInk V1 is a local-first handwritten arithmetic notebook for the
Inter IIT Bootcamp Software problem statement.
The root app implements the core Phase 1-4 paths: vector ink, local pages,
arithmetic evaluation, PaddleOCR readback, correction, IndexedDB storage,
and a full-asset offline install path. Phase exit gates remain open. The
earlier HTT notebook and comparison lab remain untouched in
[`prototype/`](prototype/README.md).

Write digits and `+`, `-`, `×`, `÷`, `.`, ending with `=`. A supported
PaddleOCR read is evaluated beside the ink; edit the line and its old
answer is removed immediately. Use Readback to see the exact model read
and correct it without altering the ink. Variables, algebra, parentheses,
and powers are outside V1. All inference and arithmetic run in the browser;
there is no account, backend, cloud OCR, or math API.

## Run Locally

Use Node.js 24 and a current Chrome-family browser. From the repository root:

```powershell
npm ci
npm run prepare:assets
npm run dev
```

Open the local URL printed by Vite. For a production/offline test:

```powershell
npm run build
npm run preview
```

`npm test` runs unit tests; `npm run test:e2e` builds and runs browser
journeys. Install Playwright's Chromium once with
`npx playwright install chromium` before browser tests or fixture replay.
Stop any running Vite/preview process before `npm ci` on Windows:
the native Rolldown binary may otherwise be locked (`EPERM`).

`prepare:assets` verifies SHA-256 hashes for the two official PP-OCRv6 tiny
archives, using matching archives placed in `local-assets/` before
downloading missing copies, and copies the matching pinned
ONNX Runtime JSEP files from `node_modules`. Model binaries are Git-ignored
pending third-party notices and the owner redistribution decision; see the
[asset provenance review](docs/design/10-model-inference.md#asset-provenance-and-release-condition).
`npm run build` repeats asset verification before bundling. A network
connection is required for `npm ci` and for a clean checkout without local
model archives.

## Model and Distribution

V1 uses PaddlePaddle's [PP-OCRv6 tiny detector](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx)
and [recognizer](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx).
Their model cards label the artifacts Apache-2.0. The detector uses an
LCNetV4 backbone and RepLKFPN neck; the recognizer uses LCNetV4, direct
reshape, and a CTC+NRTR decoder. CalcInk rasterizes ink in an application
Worker, then the PaddleOCR.js SDK runs detection and recognition in its
own Worker using ONNX Runtime Web. See the
[prototype model comparison](prototype/docs/PADDLEOCR-TRIAL.md) and
[V1 raster contract](docs/design/09-ml-preprocessing.md) for the evidence
and input path.

The [PaddleOCR.js source](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js)
identifies the SDK as Apache-2.0; [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/blob/v1.26.0/LICENSE)
is MIT and has [upstream third-party notices](https://github.com/microsoft/onnxruntime/blob/v1.26.0/ThirdPartyNotices.txt).
These labels and links do not complete the release review: an exact
third-party notice bundle, any relevant training-data terms, and the
owner's redistribution decision remain open. Do not publicly host the
model-containing build until that review is recorded.

## Recognition Diagnostics

After a line's automatic read settles, open Readback and choose
**Export sample**. Enter the expression actually written and confirm the
local JSON download. The file contains that line's ink and first model
read, even if you later correct it; no sample is uploaded or added to
notebook storage. Keep private handwriting exports outside Git.

To replay an exported sample through the production Worker, run
`npm run build`, then start a local preview with:

```powershell
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

In another terminal, run
`npm run replay:fixture -- "C:\path\to\calcink-sample.json"`.
The command reports the raw read, notation-normalized read, model timing,
and exact-read result. Replaying the same ink is a diagnostic, not a new
handwriting attempt.

## Verification Status

Desktop browser tests cover ink, corrections, page isolation, storage
recovery, an offline reload, and **fresh real Worker inference after the
network is disabled**. The synthetic OCR fixture verifies execution, not
handwriting accuracy. A synthetic-ink offline equation/edit/correction/page
journey also passes. Real-browser storage faults, the frozen owner-handwriting
benchmark, physical-phone 60 FPS and latency checks, final public-checkout
and hosted-CI paths, and the owner redistribution decision are **not yet passed**.
An isolated clone of committed `4f1833c` installed and built after
downloading both official model archives, then passed unit and desktop
browser tests; see the [release evidence snapshot](docs/design/18-release-and-bug-bash.md#evidence-snapshot-4-october-2026).
Do not treat this working build as a public-release acceptance result.
Clearing browser site data also removes local pages and offline assets.

## Project Documents

`src/` is the V1 app, `prototype/` is the preserved earlier build, `docs/`
holds the design and problem statement, and ignored `local-assets/` holds
optional model archives. `node_modules/`, `dist/`, `.npm-cache/`, and
`test-results/` are generated, not source.
The supplied problem-statement PDF is kept locally in `docs/` but excluded
from Git pending redistribution review.

- [Product design](docs/DESIGN.md): scope, user journey, requirements, and acceptance boundaries.
- [Architecture](docs/ARCHITECTURE.md): local components, data flow, and safety invariants.
- [Implementation phases](docs/IMPLEMENTATION.md): solo build order, dates, dependencies, and gates.
- [Recognition benchmark](docs/RECOGNITION-BENCHMARK.md): fresh development and acceptance handwriting protocol.
- [Solo workflow](docs/WORKFLOW.md): review, verification, Git, and honest reporting rules.
- [Subsystem deep dives](docs/design/01-runtime-foundation.md): numbered build contracts.

The `prototype/evidence/` exports contain handwriting strokes and are kept
local pending consent review. Do not publish them or the model weights
without the documented rights review.
