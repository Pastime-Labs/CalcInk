# 10. Model Inference

Status: Implemented locally in Phase 3; **not yet an accepted release model**.
PP-OCRv6 tiny detection plus recognition via `@paddleocr/paddleocr-js`
is the chosen V1 path. `htt-mini` remains a prototype comparison
baseline, not the production fallback.

## Purpose and ownership

Implements master requirement **P-04**. Load locally bundled PaddleOCR
detector and recognizer assets with their original dictionary and
worker-backed browser/ONNX runtime, infer the **raw** transcription of one
rasterized equation line, and return timing. The inference adapter does not
normalize arithmetic, calculate answers, project UI, save ink, or call an
online API. V1 rasterizes in its dedicated application Worker, then uses
the SDK's nested Worker for inference because the SDK's direct path
requires DOM canvas access. Drawing responsiveness still needs phone
measurement.
See [preprocessing](09-ml-preprocessing.md), [orchestration](07-equation-orchestration.md),
and [evidence](08-recognition-evidence.md).

## Asset provenance and release condition

`scripts/prepare-assets.mjs` pins SHA-256 for the official detector and
recognizer archives. Their ONNX and YAML members were compared by hash with
PaddlePaddle's published [detector](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx)
and [recognizer](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx)
files. Both official model cards label the artifacts Apache-2.0. This
establishes asset provenance, not handwriting accuracy or legal sign-off.
Before public distribution, include the applicable third-party license
texts and notices for the models, SDK, and runtime, then record the owner's
redistribution decision. Model archives remain Git-ignored until then.

## Worker contract

The following discriminated messages are the authoritative **application
adapter** interface for V1, implemented by the application Worker. Each `init` or
`recognize` job gets a unique, increasing `requestId` during an app
session; `cancel.requestId` references an existing job. `canvasRevisionId`
increases for each committed edit. The adapter echoes all four identity
fields in recognition responses.

```ts
type Init = { type: "init"; requestId: number };
type Recognize = {
  type: "recognize";
  requestId: number;
  pageId: string;
  lineId: string;
  canvasRevisionId: number;
  strokes: Stroke[];
};
type Cancel = { type: "cancel"; requestId: number };
type Request = Init | Recognize | Cancel;

type Ready = {
  type: "ready";
  requestId: number;
  modelId: string;
  elapsedMs: number;
};
type InitFailure = {
  type: "init_error";
  requestId: number;
  code: "model_load_failed";
  elapsedMs: number;
};
type Result = {
  type: "result";
  requestId: number;
  pageId: string;
  lineId: string;
  canvasRevisionId: number;
  rawText: string;
  boxes: Array<{ text: string; score: number }>;
  detMs: number;
  recMs: number;
  elapsedMs: number;
  raster: { width: number; height: number; version: string };
};
type Failure = {
  type: "error";
  requestId: number;
  pageId: string;
  lineId: string;
  canvasRevisionId: number;
  code: "model_load_failed" | "invalid_ink" | "inference_failed";
  elapsedMs: number;
};
type Response = Ready | InitFailure | Result | Failure;
```

`cancel.requestId` names the request to obsolete. Cancellation is
best-effort because an ONNX call already executing may not be interruptible.
The adapter must not emit a cancelled result if it can avoid doing so, but
the UI must still reject any late result using all four identity fields.
Only one job is active; newer revisions coalesce pending work.
`elapsedMs` is adapter wall time from receipt to response. The page measures
pen-up-to-settled-result separately.

## Build sequence

1. Implement with the official PP-OCRv6 tiny detector and recognizer
   archives used in the
   [prototype trial](../../prototype/docs/PADDLEOCR-TRIAL.md), archived
   under `prototype/public/models/paddle/`. Record source URLs, both
   SHA-256 hashes, architecture, on-disk size, SDK and ONNX Runtime
   versions, original dictionary, and the evidence behind choosing
   Paddle over the measured `htt-mini` baseline. The six unique owner
   drawings are exploratory, not an acceptance score.
2. Before public hosting, complete the third-party notice bundle and
   owner review of model, SDK, runtime, and relevant training-data terms.
   Record provenance and the decision in the release README.
   Do not bundle `htt-mini` in production if its separate rights remain
   unresolved. If Paddle rights cannot be established, do not publicly
   ship those weights; choose a clear-rights model or label the build a
   private prototype.
3. Bundle model, vocabulary, ONNX Runtime WASM, and Worker code as versioned
   local assets. No runtime CDN or remote inference is allowed. Load once
   per OCR session, report `ready` only after assets and sessions are usable,
   and give the UI a retryable error if loading fails.
4. Pass the validated [line raster](09-ml-preprocessing.md) to the SDK's
   worker-backed detection-plus-recognition call. Preserve individual
   detected box texts/scores and their order; assemble the line read
   deterministically and test multi-box cases. Do not silently discard a
   box, invent a digit, or substitute an unsupported symbol. Cleanly close
   sessions on replacement and allow retry after a failed load or inference.
5. Return the unmodified raw transcription and detection/recognition timing.
   Notation normalization, V1 arithmetic grammar validation, and manual
   correction happen outside the adapter. Handwriting scope is digits
   `0`-`9`, `+`, `-`, `×`, `÷`, `.`, and terminal `=`; normalization may remove
   spacing and map `×`/`÷`/Unicode `−` to internal `*`/`/`/`-`.
   Parentheses, powers, and variables are V2.
   Paddle's pretrained output dictionary stays intact: an alphabetic raw
   read is retained and rejected, **not** deleted or mapped to a digit.
   Old HTT-specific LaTeX words such as `\times` are not V1 Paddle aliases.
   Replacing the dictionary without retraining or a decoder that preserves
   model class indices is unsafe.
   Map internal exceptions to typed codes; do not display stack traces or
   treat failures as recognized text.
6. Verify the complete equation/edit/reload flow with the network disabled
   **after** the app reports offline readiness. A cached shell that cannot
   load model/WASM assets does not pass.

## Failure handling and tests

- Model assets absent, corrupt, mismatched, or blocked: drawing and local
  storage continue; recognition shows a visible unavailable state and
  retry. No previous answer is reused for changed ink.
- Invalid input: return `invalid_ink` for that request; the Worker remains
  available for the next valid line.
- Slow inference: never freeze pointer drawing. Queue/coalesce work; measure
  rather than hide a timeout from acceptance data.
- Cancellation and page switch: stale OCR output cannot reach results or
  persistence, even if cancellation races with a completed ONNX call.

Unit tests use a fake inference adapter for protocol/cancellation and a
real-raster fixture for serialization. Browser tests load the actual
bundled models in the production build, recognize a line, edit it, reload
offline, and repeat while checking drawing fluidity. The chosen model
passes only with the [fresh acceptance matrix](../RECOGNITION-BENCHMARK.md),
named-device performance and offline gates, and documented distribution
rights.
