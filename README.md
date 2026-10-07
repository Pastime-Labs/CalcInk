# CalcInk

CalcInk is a local-first handwriting workspace built for the Inter IIT
Bootcamp Software problem statement. Write an arithmetic expression ending
in `=`; the app reads the ink and places a calculated result beside it.
Recognition, evaluation, and storage run in the browser, without an account
or cloud API.

The home library offers two workspaces: a scrollable A4 notebook and an
unbounded black canvas. Both support pen and pencil, colors, erasers,
undo/redo, and lasso selection. Notebook pages also offer paper templates,
25%-200% zoom, and local print/PDF for the selected page. One finger writes;
two fingers move the view. Pen-only mode reserves writing for a stylus.
Readback, under the three-dot menu, shows the recognized expression and lets
you correct a misread without changing the ink.

Supported notation is digits, decimal points, `+`, `-`, `×`, `÷`, and a
terminal `=`. Variables, algebra, parentheses, and powers are not supported.
If an answer cannot fit beside the ink on an A4 sheet, it appears in
Readback rather than expanding the page. Existing pre-A4 pages retain their
original geometry.

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

`npm test` runs unit tests; `npm run test:e2e` builds and runs browser tests.
Install Playwright's Chromium once with `npx playwright install chromium`.
Stop any running Vite/preview process before `npm ci` on Windows:
the native Rolldown binary may otherwise be locked (`EPERM`).

`prepare:assets` checks the hashes of the two PP-OCRv6 tiny model archives,
using matching copies in `local-assets/` or downloading them if absent. The
archives are not committed. A clean checkout therefore needs a network
connection for installation and model download. The build repeats asset
verification and checks the pinned decoder patch installed by `npm ci`.

## Model and Distribution

CalcInk uses PaddlePaddle's [PP-OCRv6 tiny detector](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx)
and [recognizer](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx).
The detector uses LCNetV4 and RepLKFPN; the recognizer uses LCNetV4 and
CTC+NRTR. Ink rasterization and PaddleOCR.js inference run in Workers using
ONNX Runtime Web. A patched `ctc-mask-v2` decoder limits output to arithmetic
characters while retaining the unrestricted read for diagnostics. This
decoder has not passed a fresh handwriting accuracy benchmark. See the
[model design](docs/design/10-model-inference.md) and
[benchmark protocol](docs/RECOGNITION-BENCHMARK.md).

The model cards identify the weights as Apache-2.0, and the
[PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js)
and [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/blob/v1.26.0/LICENSE)
sources publish their license terms. A public model-containing build still
needs the exact notice bundle and redistribution review documented in the
[asset provenance checklist](docs/design/10-model-inference.md#asset-provenance-and-release-condition).

## Recognition Diagnostics

Open **More options → Readback → Export sample** to download a diagnostic
JSON file containing the ink and model reads. Nothing is uploaded. Keep
exports private: they contain handwriting and browser details. For a
recorded benchmark, confirm the export reports
`model.decoder: "ctc-mask-v2"`; an older service worker may otherwise serve a
prior build.

To replay an export through the production Worker, build the app and start
a preview:

```powershell
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

In another terminal, run
`npm run replay:fixture -- "C:\path\to\calcink-sample.json"`.
Replay is a diagnostic, not a new handwriting attempt.

## Verification Status

The local V2 build passed 166 Vitest, 21 Node, and 41 Playwright tests on
7 October 2026. These automated checks include offline OCR, storage
recovery, both workspaces, input gestures, and print layout. They do not
establish handwriting accuracy or phone frame pacing. A fresh owner
handwriting benchmark, physical-phone Performance trace, real print preview,
hosted CI run, and asset-rights review remain open. See
[phone acceptance](docs/PHONE-ACCEPTANCE.md) and the
[V2 release plan](docs/V2-IMPLEMENTATION.md).

Pages and offline assets live in browser storage. Clearing site data deletes
them.

## Project Documents

The [V2 product design](docs/V2-DESIGN.md) and
[implementation plan](docs/V2-IMPLEMENTATION.md) describe the current
scope and open gates. [Architecture](docs/ARCHITECTURE.md),
[recognition benchmark](docs/RECOGNITION-BENCHMARK.md), and
[development bug log](docs/BUG-LOG.md) record the technical decisions and
evidence. Earlier V1 contracts remain in [docs/DESIGN.md](docs/DESIGN.md)
and [docs/design/](docs/design/01-runtime-foundation.md).

CalcInk is maintained by Pastime_Labs as a solo project with AI-assisted
development. Product decisions and release verification remain the owner's
responsibility.
