# 08. Recognition Evidence

Status: Opt-in first-read export, real-Worker fixture replay, and a private
benchmark score helper are implemented locally. The active `ctc-mask-v2`
decoder is experimental; the fresh handwriting benchmark is **not executed**
and PP-OCRv6 tiny is **not an accepted release result**.
The prototype has known first-read failures, including `9=`, `11+11=`,
`6+3=`, and `9+3=`. A user correction is a safety fallback, not a
recognition success.

## Purpose and privacy

Supports master requirement **P-04**. Make recognition decisions from
reproducible handwriting, not a model name or a polished demonstration.
Evidence distinguishes grouping, preprocessing, model decoding,
normalization, parsing, and latency failures.
This is a local-only diagnostic workflow; no telemetry or server upload is
part of V1. See [orchestration](07-equation-orchestration.md),
[preprocessing](09-ml-preprocessing.md), and
[inference](10-model-inference.md).

Diagnostic capture is **off by default**. The owner explicitly starts a
sample, enters the intended expression, and consents to retain its vector
ink. A sample can be discarded. If outside handwriting is ever collected,
get permission before retaining or publishing strokes; use pseudonymous
writer IDs and do not record names. Do not silently put handwriting or
screenshots into the repository.

## Sample and result contract

An opt-in local export is a diagnostic artifact, not the P1 notebook
export/import feature. The versioned V1 JSON sample contains:

| Field | Meaning |
| --- | --- |
| `sampleId`, `schemaVersion` | Opaque export identifier and format version. |
| `intendedExpression`, `firstRead.rawText`, `firstRead.unmaskedRawText`, `firstRead.normalizedText` | Ground truth, first restricted read, unrestricted diagnostic read, and normalized restricted read before correction/retry. |
| `firstRead.result`, `firstRead.boxes` | First calculated result, if any, and per-box restricted/unrestricted texts, scores, and detector polygons. |
| `firstRead.detectedBoxes`, `firstRead.recognizedCount` | Detector and recognizer item counts for locating missed marks. |
| `strokes` | The sampled line's ordered vector strokes only, retained with consent. |
| `environment` | Browser user agent/language, DPR, online state, and export time. |
| `model`, `firstRead.raster` | Model and decoder IDs, pinned archive hashes, and raster version/size. |
| `firstRead.elapsedMs`, `firstRead.detMs`, `firstRead.recMs` | Worker wall time and detector/recognizer timing. |

The owner records pseudonymous writer/session IDs, input method,
pen-up-to-result timing, failure class, and notes in the benchmark log;
these are **not** inferred by the current JSON export. Score the initial
outcome against `intendedExpression`, not a later correction or replay.
Diagnostic exports can record an unfinished expression without `=` exactly
as drawn; acceptance attempts still require a final `=`.
If first inference fails, a later Retry result cannot be exported as the
first read; record that attempt as a failure in the private worksheet.
The runner validates version and ink bounds before invoking the actual
production Worker. The ordinary saved notebook is not altered by export
or replay. A real sample may become a retained fixture only with explicit
permission.

`ctc-mask-v2` chooses among the original CTC model classes before decoding,
including `二`, which normalization maps to `=`. It does not rewrite a
wrong character after recognition. Keep the
unrestricted read visible for diagnosis (with `二` displayed as `=`);
exported raw fields retain the original glyph. Score the restricted read
actually used for the answer. Restriction can also force a plausible but
wrong arithmetic character; allowing `二` can also create a false `=`.
One saved private `4=` export originally recorded unrestricted `4二`;
an earlier `ctc-mask-v1` replay of its ink yielded
unrestricted `二4` and restricted `4`. The missing `=` left the line
incomplete, so this is **not** a successful fix, a v2 result, or an acceptance attempt.

## Build and decision sequence

1. Add an owner-facing opt-in capture path that snapshots the line's
   committed strokes at first inference and records PaddleOCR's raw box
   texts, scores, assembled read, and timing before normalization or
   correction. Keep it disabled in ordinary use.
2. Build a deterministic fixture runner that can feed saved line strokes
   through the same rasterizer and worker-backed PaddleOCR path as the
   production app and record raw read, timing, and asset hashes. Mocked
   responses do not count for recognition acceptance.
3. Collect the **development set** defined in
   [Recognition Benchmark](../RECOGNITION-BENCHMARK.md): fresh arithmetic-only
   handwriting with every digit, required operator, decimal and negative
   forms, and the four known failures. Parentheses, powers, and alphabetic
   variables are deferred beyond V1.
4. Classify every failure by the earliest broken boundary. A correct restricted
   read with a wrong answer is a parser defect; a missing or split line is
   grouping; a wrong read with intact grouping is rasterization, detection,
   or decoding. Record both reads exactly as emitted; never silently map
   `g` to `9` or count a forced valid character without checking ground
   truth. Save only consented failing fixtures.
5. Use PaddleOCR as the V1 implementation candidate and retain `htt-mini`
   only as a measured prototype baseline. Change one variable at a time
   (grouping, rasterization, box ordering, model, or notation-only
   normalization) against the fixed development set. Record accuracy and
   named-device latency; do not present repeated inference on the same
   strokes as new handwriting samples.
6. Freeze code, both Paddle model hashes, decoder patch, dictionary,
   rasterization, normalization, and benchmark protocol before gathering
   **fresh acceptance ink**. Acceptance samples are not tuning data. Any
   post-freeze change requires fresh attempts for the affected gate.

## Acceptance protocol

The canonical arithmetic-only expression matrix, sample counts, and **all
numeric release thresholds** live in
[`docs/RECOGNITION-BENCHMARK.md`](../RECOGNITION-BENCHMARK.md). Score the
first restricted automatic read and first result before correction. Retain
the unrestricted model read as diagnostic evidence and apply only
documented notation normalization:
remove spacing and map `×`/`÷`/Unicode `−` to canonical `*`/`/`/`-`.
The handwriting scope is digits `0`-`9`, `+`, `-`, `×`, `÷`, `.`, and
terminal `=`. After normalization, validate only canonical digits, `+`,
`-`, `*`, `/`, `.`, and terminal `=`; an invalid read gets no automatic
answer. Never convert letters such as `g` to digits or accept old
HTT-specific LaTeX words such as `\times`. Track transcription and
arithmetic accuracy separately. Measure warm pen-up-to-settled-result
time on the named phone and cold model load separately. Include failed
or timed-out attempts in the denominator.

These are internal release gates, not evidence of population-wide
generalization. The owner-only sessions do **not** validate cross-writer
accuracy. If no outside writers are available, disclose that limitation
prominently. A failed gate means fix and retest with fresh ink, or label the
submission a prototype rather than claiming V1 passed.

## Tests and done gate

- Unit-test schema validation, first-read immutability, opt-in default,
  and fixture replay identity; browser-test that capture sends no network
  request and does not modify the notebook.
- Keep a failure ledger linking each reproduced defect to its fix and
  regression fixture. Report sample count, exact reads, parser-correct
  results, per-category results, latency distribution, device/browser, and
  both Paddle model hashes without smoothing or cherry-picking.
- This subsystem is done when the frozen runner and protocol produce a
  reproducible pass/fail report and consented samples can be deleted.
