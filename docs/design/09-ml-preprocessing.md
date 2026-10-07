# 09. ML Preprocessing

Status: Implemented locally in Phase 3; phone and handwriting acceptance
remain open. PaddleOCR PP-OCRv6 tiny detection plus recognition is the
chosen implementation path. The current
`prototype/src/recognition/features.ts` is specific to the `htt-mini`
prototype and must not be reused as Paddle input.

## Purpose and boundary

Implements master requirement **P-04**. Convert one grouped equation line's
vector strokes into a deterministic, bounded, opaque-white raster for the
locally bundled PaddleOCR pipeline. The adapter does not guess symbols or
evaluate arithmetic. The prototype lab currently draws onto a canvas on
the main thread and runs OCR with the SDK's `worker: true`; do not describe
the prototype pipeline as off-thread. V1 now rasterizes inside a dedicated
application Worker with `OffscreenCanvas`; PaddleOCR inference runs in the
SDK's nested Worker. The 60 FPS device measurement remains open.
See [evidence](08-recognition-evidence.md) and
[inference](10-model-inference.md).

## Input and output contract

Input is a nonempty, ordered, immutable copy of the grouped line's
`Stroke[]` and bounds in world coordinates. Points and stroke widths must
be finite; reject invalid dimensions, an empty line, excessive stroke or
point counts, or a raster that would exceed the configured size/memory
budget with typed `invalid_ink`.
The ink document's validation is not a substitute for this boundary check.

Output is a versioned white-background image source accepted by the SDK,
plus actual pixel width and height for diagnostics. Render each stroke
separately using the same visible ink geometry and width as the notebook;
never connect pen-up gaps, drop small marks, or clip a terminal `=`. The
SDK owns model-specific resizing, color conversion, and numeric tensor
creation. The old 12-column HTT feature tensor is not part of V1.

## Build sequence

1. Freeze a rasterizer version alongside both Paddle model hashes, SDK
   version, and original recognition dictionary. Record padding, maximum
   dimensions, scale rule, ink-rendering rule, and background color.
2. Validate points, widths, stroke/point counts, and bounds before canvas
   allocation. Compute a padded line crop in world coordinates; keep dots,
   minus bars, division marks, and both bars of `=` inside the crop.
   Do not use viewport pixels or device-pixel ratio as model scale.
3. Start with the lab's existing raster policy as a testable baseline:
   padding `max(18, 3 × maximum stroke width)` in world units and scale
   `min(2, 2048 / paddedWidth, 512 / paddedHeight)`. Bound both output
   dimensions and reject pathological input. Tune only against development
   ink, then freeze the resulting policy before acceptance.
4. Render opaque white first, then ordered strokes with the notebook's
   drawing routine. Preserve separate pen lifts and small marks. Do not
   threshold, smooth, deskew, reorder, or reshape the image by intuition;
   each such change needs a versioned A/B test.
5. Compare raster fixtures and real development ink across browser, zoom,
   resize, and DPR settings. Record raster dimensions/version with every
   diagnostic sample. Keep the `OffscreenCanvas` rasterizer in the dedicated
   application Worker and pass an SDK-supported `ImageBitmap`; measure
   drawing fluidity separately on the target device.
6. Check any raster change against the full arithmetic-only benchmark and
   named-phone latency. Keep the previous version for an explicit A/B
   comparison, not a hidden runtime fallback.

## V1 Scope

V1 handwriting supports only digits `0`-`9`, `+`, `-`, `×`, `÷`, `.`, and
terminal `=`. Notation normalization may map `×`/`÷`/Unicode `−` to
internal `*`/`/`/`-`. Parentheses, inline or spatial powers, and
alphabetic variables remain outside the approved V2 scope. This
restriction belongs to expression validation, **not** a replacement of
PaddleOCR's pretrained dictionary or a raster trick that suppresses letters.

## Failure and test matrix

| Case | Expected outcome |
| --- | --- |
| Empty line, NaN/infinite point or width, impossible bounds, excessive stroke/point count | Typed `invalid_ink`; no answer or crash. |
| One-point dot, narrow minus, division dots, two equals bars | Each mark remains visible inside the padded crop. |
| Excessive canvas dimensions or memory budget | Explicit `invalid_ink`; no unbounded allocation or silent symbol clipping. |
| Translate/resize the same ink, change zoom or DPR | Equivalent line raster under the frozen scale policy; no accidental viewport dependence. |
| `9=`, `11+11=`, decimals, `×`, `÷` | Replay saved development fixtures and compare raw reads; any regression is visible. |

Tests cover crop bounds, white background, small-mark visibility,
deterministic dimensions, budget boundaries, and malformed input. The
done gate is a measured contribution to the
[recognition benchmark](../RECOGNITION-BENCHMARK.md) and drawing
fluidity, not merely "the image loads."
