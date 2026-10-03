# CalcInk V1: System Architecture

Status: **Core V1 local implementation through Phase 4; exit gates open**,
4 October 2026. The runnable HTT notebook
and PaddleOCR comparison lab are archived in [`prototype/`](../prototype/README.md);
they are not the V1 implementation. The [master design](DESIGN.md) owns product
scope, the [implementation phases](IMPLEMENTATION.md) own execution order,
and the numbered deep dives own detailed contracts.

## 1. Boundaries

CalcInk V1 is a static, offline-first browser app. It has no account,
backend, remote inference, or network math API. Vite and TypeScript produce
the client bundle; Canvas 2D and Pointer Events capture and display ink;
IndexedDB retains local pages; a service worker provides complete offline
reload. All model archives and ONNX Runtime files are served from the same
origin after the first installation.

The accepted handwritten language is the PS arithmetic set: digits
`0`-`9`, `.`, `+`, `-`, `×`, `÷`, and a final `=`. Parentheses, powers,
variables, and symbolic algebra are V2 scope. The parser internally uses
`*` and `/` for the two drawn operators. The recognizer keeps its original
pretrained dictionary; application validation rejects unsupported output
rather than changing a model class mapping or guessing a digit.

## 2. Data Flow

```text
Pointer Events
    -> versioned vector ink document -> ink and answer canvases
    -> equation line grouping -> revision-aware equation session
    -> bounded stroke-to-white-raster adapter (app Worker / OffscreenCanvas)
    -> local PP-OCRv6 tiny detector + recognizer (PaddleOCR.js nested Worker / ONNX)
    -> raw readback -> notation-only normalization + alphabet validation
    -> deterministic arithmetic parser -> revision-checked inline answer

Vector ink + explicit corrections -> versioned IndexedDB pages
App shell + model archives + Worker/WASM -> service-worker offline install
```

The V1 choice is the locally bundled, unmodified PP-OCRv6 tiny detection
and recognition pair. The [prototype trial](../prototype/docs/PADDLEOCR-TRIAL.md)
motivated this implementation choice but is not release proof. It contains
six distinct saved drawings, a small owner-only sample; fresh acceptance,
phone latency, drawing smoothness, full offline use, and redistribution
rights remain gates.

## 3. Module Contracts

| Boundary | Responsibility | Invariant |
| --- | --- | --- |
| Ink and rendering | Capture ordered vector strokes and draw them at stable world coordinates. | A pen lift never joins strokes; viewport resize does not change saved geometry. |
| Line orchestration | Group strokes, assign line/page revisions, schedule recognition, invalidate changed answers. | A late response cannot restore an answer for changed ink or another page. |
| Raster and OCR | Validate and crop one line, rasterize it without clipping small marks, run local Paddle detection/recognition. | Return the raw transcription and timing; do not calculate or silently alter characters. |
| Normalization and arithmetic | Map notation-only glyph aliases, reject unsupported text, parse bounded numeric grammar. | An OCR letter such as `g` is not converted to `9`; malformed input never executes as JavaScript. |
| Storage and offline | Save page and correction records transactionally; cache all V1 assets after online install. | "Saved" means durable; "Ready offline" means model inference works after reload without network. |
| UI and accessibility | Put an answer or controlled error beside `=`, expose Readback, loading, correction, and save state. | A wrong or uncertain read is visible, not presented as a verified answer. |

The V1 app rasterizes with `OffscreenCanvas` inside its own Worker, then
uses PaddleOCR.js's nested Worker for model execution. That isolates
heavy work from pointer capture, but does **not** by itself prove the
PS's 60 FPS requirement. The [preprocessing](design/09-ml-preprocessing.md),
[inference](design/10-model-inference.md), and
[quality](design/17-quality-and-performance.md) documents specify
implementation and measurement.

## 4. Failure and Release Rules

- Model asset/load failure leaves ink editable and shows a retryable
  recognition error. No old answer is reused for changed ink.
- Unsupported OCR text or incomplete/malformed arithmetic shows a
  review/fix state. Manual correction is stored separately from raw
  first-read evidence.
- Division by zero displays `Undefined`; no `eval`, guessed digits,
  `Infinity`, or `NaN` reach the answer canvas.
- An offline-ready state requires the app, both Paddle model archives,
  Worker code, and matching JSEP ONNX Runtime assets. The prototype's
  lab-on-demand cache does not satisfy this V1 contract.
- Release claims require the fresh [recognition benchmark](RECOGNITION-BENCHMARK.md),
  device/performance checks, asset-rights review, and the
  [release gate](design/18-release-and-bug-bash.md).
