# 18. Release and Post-Release Bug Bash

Status: **planned V1**. The project leader is the sole human owner. AI may
help implement, inspect, and test, but is not another teammate or independent
human reviewer. This document separates development bug fixing, the release
decision, and a later public bug bash.

## Release candidate

The internal schedule assumes code complete on **5 October 2026**, device
and release checks on **6 October**, and submission on **7 October**. The
organizer's exact cutoff time and timezone remain unconfirmed; verify them
before treating these dates as a safe buffer. If the schedule compresses,
remove deferred polish or V2 work, not correctness, rights, or evidence.

Before tagging a release candidate:

1. Freeze V1 to the problem statement's written arithmetic vocabulary:
   digits, decimal point, `+`, `-`, `×`, `÷`, and terminal `=`. Reject
   unsupported model reads rather than guessing digits or operators;
   parentheses, powers, and variable algebra are V2.
2. Complete the P-01 through P-10 acceptance matrix in
   [quality and performance](17-quality-and-performance.md), including
   owner-only recognition scores, latency distribution, real-device notes,
   accessibility limitations, and complete offline evidence. Resolve every
   release-blocking defect; retain failures and retest evidence.
3. Review permission to **redistribute the exact PaddleOCR detection and
   recognition model archives and runtime assets** in a public repo/hosted
   demo, including upstream licenses, training data terms, notices, and any
   attribution obligations. Record source URLs, license texts, and the
   conclusion. An unresolved right to distribute the model blocks public V1
   release; do not hide it behind a README footnote.
4. From a clean checkout of the PR-merged, buildable `main`, run the
   documented install, `npx tsc --noEmit`, test, build, and production
   preview commands. Audit generated assets and network requests.
   Publish modular, documented source and build configuration in a
   public GitHub repository at a specific commit, plus a
   public static HTTPS demo from that build. The README must give local
   quick-start commands and the chosen pretrained model's source URL,
   license, and architecture, and link the model comparison and
   stroke-to-raster pipeline evidence. Include model and
   third-party notices; use no runtime CDN. Publish the model bundle only
   after the rights review in step 3 passes.
5. Have the leader repeat the key demo on the hosted build: fresh visit,
   a brief-core handwritten expression such as `11+11=` with its automatic
   answer beside `=`, wrong-read correction, ink edit invalidating the old
   answer, then the added multiple-page flow. After complete installation,
   use airplane mode on the named phone for reload and another
   equation/edit. Record the commit, build URL, device/browser, date, and
   outcome.

The root README must describe the current local implementation accurately;
it may say "verified V1" only after these gates pass. If a critical gate
fails by the cutoff, publish an **honestly labeled prototype/incomplete
submission** with working and non-working behavior listed. Do not claim
the owner-only benchmark measures other writers. A reproducible public
build is preferable to a polished
recording that cannot be run, but public hosting still requires model
redistribution clearance.

## Evidence snapshot, 4 October 2026

This is a local release-readiness snapshot, **not** Phase 5 or 6 sign-off.
Created with `git clone --no-local . <temporary-directory>` from committed
`4f1833c0977353824fd4284a3a6188f5a03edc09`, without copied assets
or `node_modules`, on Windows with Node `v24.19.0`, npm `11.17.0`,
Playwright `1.63.0`, and installed Chrome `154.0.8037.93`:

| Gate | Observed result | Remaining work |
| --- | --- | --- |
| Clean-clone automated checks | `npm ci`, `npm run build` (including `tsc --noEmit`), `npm test` (189 app and 6 replay tests), and `npm run test:e2e` (11 browser tests) passed. Both model archives downloaded from the official host and passed pinned SHA-256 verification. These tests used the then-committed Playwright `channel: "chrome"` config. | Repeat on the final candidate and in hosted CI with the pinned Playwright Chromium configuration; test a public checkout. |
| Generated assets and offline | The build emitted a service worker with 24 precache entries; the browser suite exercised local production preview, including offline real-Worker inference. | Inventory final published assets and network requests; repeat full offline flow on a named physical phone and hosted HTTPS origin. |
| Recognition, devices, and accessibility | Automated behavior checks passed on desktop Chrome. | Fresh 60-attempt owner benchmark, warm answer p95, drawing frames during active OCR, memory, touch/stylus, keyboard, and screen-reader evidence remain open. |
| Distribution and submission | Model binaries and private ink are absent from tracked Git files. No Git remote, hosted URL, or public PR/CI result exists. | Complete rights/notice decision below, then publish and smoke-test the exact public commit and demo. |

**Rights evidence, not clearance:** PaddlePaddle's official
[detector](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx)
and [recognizer](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx)
cards label the ONNX artifacts Apache-2.0; the pinned archive URLs and
hashes are in `scripts/prepare-assets.mjs`. The official
[PaddleOCR repository license](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)
and [SDK package manifest](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/package.json)
identify Apache-2.0. The versioned [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/v1.26.0/LICENSE)
is MIT, with [third-party notices](https://github.com/microsoft/onnxruntime/blob/v1.26.0/ThirdPartyNotices.txt).
The model cards do not enumerate complete training-data terms. The npm
SDK/runtime packages inspected locally did not include LICENSE or NOTICE
files, so links alone are not the required notice bundle. Inventory all
shipped code, fonts, model assets, and runtime notices; include applicable
texts in the released source/build and record the owner's final
redistribution decision before public hosting.

**Local candidate check, 4 October 2026:** On `feat/masked-ocr`, the
uncommitted working build passed `npx tsc --noEmit`, `npm test` (193 app and
20 Node tests), and `npm run test:e2e` (17 pinned-Chromium tests). The
production browser suite exercised real OCR after offline reload, a failed
first service-worker registration followed by successful Retry, a
future-version IndexedDB record and recovery export, simulated DPR-2
mobile touch cancellation, keyboard focus, and direct app/model/runtime
requests confined to the preview origin. Local phone-width and desktop
screenshots were inspected; owner visual approval is still open. The
final build generated 24 precache entries, about 47.7 MiB. These checks
are not a clean checkout of the candidate commit, hosted CI, fresh
handwriting score, physical-phone trace, or permission to publish models.

The installed production dependency tree has 25 packages, including
OFL-1.1 fonts, Apache-2.0 PaddleOCR.js and OpenCV.js, MIT ONNX Runtime
packages, Boost-licensed `clipper-lib`, and other transitive code. This
tree is not proof that every dependency's bytes ship. The production
bundle contains two large Workers, ONNX Runtime WASM, local font assets,
and both model archives. The locally patched PaddleOCR.js Worker must be
identified as modified in release notices. Applicable full license and
third-party notice texts are not yet bundled, and the owner has not
recorded the redistribution decision.

**Committed clean-clone check:** A new `git clone --no-local` of
`e20e491` without copied assets or `node_modules` passed `npm ci`;
the post-install SDK Worker patch matched SHA-256
`f3929e5f7b3083bfcf895119f8a60ebe46b0b2b7e589c938c059e9756fd5a61a`.
`npm run build` downloaded both official model archives, verified the
pinned hashes, and built the PWA. `npm test` passed 193 app and 20 Node
tests; `npx playwright test` passed all 17 tests against that clone's own
preview on port 43129. The first clean clone exposed a Windows CRLF
decoder-patch failure; `e20e491` includes the verified fix. This is
local reproducibility evidence, not a public checkout, GitHub CI run,
physical-device pass, or distribution clearance.

## Development defect workflow

Fix bugs found during development when discovered. Keep one outcome issue
per reproducible defect with environment, steps, expected/actual behavior,
severity, responsible boundary, fix, and regression test. Use an isolated
`fix/...` branch, the [solo workflow's](../WORKFLOW.md#4-git-review-and-ai-assistance-protocol)
typecheck/verification gate, and a PR before merging the verified fix.
A second human review is
welcome but must not be claimed unless it occurred. A daily note states
last verified outcome, next gate, and blocker. Do not manufacture a large
bug count by splitting one root cause into many tickets.

## Bug bash after release

Only after the released build exists, announce a bounded bug bash for the
CalcInk app and its owned deployment. Publish version/URL, supported
browsers/devices, in-scope behaviors, contact or issue template, and
responsible-disclosure rules. Exclude attacking unrelated services,
other users, or infrastructure. Do not call it a **paid bug bounty** unless
funding, rewards, eligibility, and payment rules really exist. Explain that
volunteer reports may include private ink; ask permission before retaining
or publishing a stroke sample.

For every report, record:

| Field | Required detail |
| --- | --- |
| Reproduction | Build/commit, device/browser, starting state, exact steps, expected vs actual, frequency. |
| Impact | Data loss, wrong/stale answer, parser safety, offline failure, accessibility/device issue, or cosmetic defect; severity and reason. |
| Evidence | Small screenshot, trace, or consented ink fixture; redact personal data. |
| Resolution | Root cause, linked change, regression test, verification device/build, reporter retest if available. |
| State | New, reproduced, duplicate, cannot reproduce, fixed/verified, or deferred with reason. |

Triage data loss, unsafe evaluation, stale or wrong answers, and broken
offline operation first. Reproduce before claiming a fix, and verify the
fix on a new build with the original steps plus a regression test. Publish
counts of **distinct reproduced reports** and **verified fixes** only from
these records; list duplicates and unverified reports separately. This
bug-bash evidence is subsequent work, not proof that V1 was already sound
at submission.
