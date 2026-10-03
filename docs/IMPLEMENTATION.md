# CalcInk V1: Phased Implementation Plan

Status: **Core Phase 1-4 paths implemented locally; phase exit gates remain open**, updated
4 October 2026. The project leader is
the only human contributor and owns product choices, review, acceptance,
and submission. AI assistance can write, test, research, and challenge
implementation; it is not independent human peer review. The
[master design](DESIGN.md) defines product scope, the
[architecture](ARCHITECTURE.md) defines subsystem boundaries, and the
numbered [deep dives](design/01-runtime-foundation.md) define implementation
contracts. The [benchmark](RECOGNITION-BENCHMARK.md) defines handwriting
evidence. The [solo workflow](WORKFLOW.md) defines the repeatable issue,
review, Git, and verification protocol without duplicating this dated plan.

## 1. Implementation Rule

Build one testable vertical outcome at a time. Do not call a component
finished because its source exists or a unit test is green: demonstrate it
through the actual browser flow at its boundary. Correctness, data safety,
offline behavior, model rights, and measurable recognition are release
gates. Visual polish follows a working structural app rather than
substituting for one.

Protect the brief-required vertical slice first: digits and arithmetic
symbols, a reactive answer immediately beside `=`, all-browser offline
execution, specified ink controls, and fluid 60 FPS drawing during
recognition. Parentheses, powers, variables, and general algebra are
outside V1. Simple local pages remain a scoped CalcInk addition.

The previous app, lab, and comparison exports are preserved under
[`prototype/`](../prototype/README.md). Its source snapshot does not include
ignored model files or private handwriting evidence; make a **private,
reproducible snapshot** before changing the archive. The first V1 commit is
an audited bootstrap snapshot, not reconstructed phase-by-phase history.
Implement the new V1 modules cleanly rather than copying the prototype
wholesale. Do not publish bundled model weights or private handwriting
evidence without rights and consent review.

## 2. Implementation Phases

The problem statement names 7 October but does not specify a cutoff
hour/timezone. Treat 7 October 2026 as the hard date and complete
submission preparation earlier. The dates below are internal targets,
not a guarantee that an unverified feature is done.

Each phase ends in a browser-visible or reproducible gate. A phase may
overlap independent evidence collection, but no later phase turns a
failed earlier gate into a pass.

| Phase | Target | Work | Exit evidence |
| --- | --- | --- | --- |
| 0. Scope and baseline | 3 Oct | Freeze arithmetic-only V1 scope, PaddleOCR implementation choice, deep-dive contracts, private prototype snapshot, and start model-rights review. | Requirement map, decision evidence, preserved archive, and reproducible prototype commands. |
| 1. New runtime foundation | 3-4 Oct | Create a clean V1 root app, strict TypeScript/build checks, static asset layout, and minimal CI. | Clean checkout installs and builds; no prototype source is silently treated as V1. |
| 2. Ink and arithmetic | 3-4 Oct | Build the shell, page repository/migration core, page controls, pointer ink/tools, vector rendering/history, and safe numeric parser. | Draw/edit/undo on two pages, save and reload them safely; parser checks cover the PS arithmetic grammar and invalid reads. |
| 3. Paddle recognition and answers | 4-5 Oct | Integrate bounded stroke-to-raster preprocessing, local PP-OCRv6 tiny detection/recognition, line grouping, revision checks, Readback, correction, and adjacent answers. | Real model end-to-end examples, no stale answer after edits, explicit invalid-read state, and measured phone timing. |
| 4. Durability and offline | By 5 Oct | Harden the existing versioned repository, save/recovery behavior, and correction durability; complete the local Paddle/WASM cache and update states. | Every acknowledged edit survives reload; full equation/edit/page flow works after an offline reload. |
| 5. Hardening and acceptance | 6 Oct | Check touch, keyboard, accessible announcements, active-recognition 60 FPS, memory, fresh handwriting acceptance, and finish model redistribution review. | No known release blocker; measurements, failures, rights decision, and limitations recorded. |
| 6. Submission | 7 Oct | Host the static app, publish source/attribution only where permitted, and verify a clean reviewer path. | Public URL and repo work from a fresh browser/checkout; README states model source, license, architecture, and honest status. |
| 7. Post-release bug bash | After phase 6 | Invite scoped testing, triage, fix, add regression checks, and retest. | Each claimed fix has a genuine report and verified outcome. |

### Execution snapshot, 4 October

- **Phase 0:** The scope, subsystem contracts, and benchmark protocol are
  documented. Local model members match PaddlePaddle's published
  Apache-2.0-labeled artifacts by hash. The required private,
  reproducible prototype snapshot, third-party notice bundle, and
  owner redistribution decision have not been evidenced here.
- **Phase 1:** Root Vite/strict-TypeScript app, CI checks, and hash-verified
  asset preparation are implemented. A fresh local clone of committed
  `4f1833c` installed and built after downloading both archives from the
  official host; unit and desktop browser suites passed. This does not
  cover the final candidate or a public checkout. No hosted GitHub CI/PR
  run exists yet, so the public reproducibility gate remains open; see the
  [release evidence snapshot](design/18-release-and-bug-bash.md#evidence-snapshot-4-october-2026).
- **Phase 2:** Pointer ink, both erasers, history, DPR-backed rendering,
  pages, IndexedDB migration/recovery, and the numeric parser pass unit and
  desktop browser flows. Physical touch still requires Phase-5 testing.
- **Phase 3:** App-Worker rasterization and nested PaddleOCR Worker
  inference run in development and production browsers. Request/page/line/
  `canvasRevisionId` stale guards and Readback correction have regression
  tests. Opt-in first-read export and local real-Worker fixture replay are
  implemented. Six reused prototype drawings also produced correct reads
  and answers in a desktop V1 page. This is not a fresh-handwriting
  accuracy score; the owner benchmark and phone timing remain open.
- **Phase 4:** A production browser cached the full local pipeline and
  performed a fresh OCR request after offline reload. An earlier empty-204
  model-cache bug and a missing-cache retry bug were found and fixed.
  Browser regressions cover cache repair without page loss and an offline
  synthetic-ink journey through automatic-read settlement, correction,
  edit, page switch, and reload. Unit tests cover failed and aborted
  writes and blocked upgrade. Real-handwriting accuracy, real-browser
  quota/multi-tab faults, physical-phone airplane mode, and the owner
  redistribution decision remain open.
- **Phase 5-6 preparation:** The local `feat/acceptance-release` branch
  has a first-read scorer for private evidence, additional model-failure
  and accessibility checks, more legible mobile controls, and a
  pinned-Chromium browser gate in CI.
  On Windows, `npx tsc --noEmit`, `npm test` (190 app and 15 Node tests),
  and `npm run test:e2e` (12 browser tests) passed. These are not a fresh
  handwriting score, a physical-device frame trace, visual approval,
  a hosted CI result, or release clearance.

The links below give each elementary deep dive its **primary build phase**,
not permission to defer its cross-phase tests. For example, the Phase-2
shell, pointer, ink, and renderer finish their recognition/offline/device
checks in Phases 3-5; model and correction work finishes offline checks in
Phase 4; accessibility and regression checks start with the first UI code.

### Phase 0: Scope and baseline

**Primary documents:** [Master design](DESIGN.md),
[architecture](ARCHITECTURE.md), [recognition benchmark](RECOGNITION-BENCHMARK.md),
[solo workflow](WORKFLOW.md), and the
[archived prototype](../prototype/README.md). No numbered elementary deep
dive is primarily assigned here.

Freeze the problem-statement traceability, V1 arithmetic vocabulary, key
journey, exclusions, local PaddleOCR decision, and objective acceptance
protocol. Keep prototype results as exploratory evidence, not a V1 score.
Make a private, reproducible snapshot of the prototype and its ignored local
assets; record its run commands. Start checking the exact model/runtime archives'
public redistribution terms now; Phase 5 closes that decision. The gate is
an approved scope and evidence baseline, not working new application code.

### Phase 1: New runtime foundation

**Primary deep dive:** [01 Runtime foundation](design/01-runtime-foundation.md).

Start a clean root Vite/strict-TypeScript app with a single composition root,
small subsystem boundaries, local asset paths, test/build commands, a
loading/error shell, and minimal CI. A phase-1 smoke test verifies that the
production build opens and no runtime asset is fetched from a third party.
The temporary shell is not a functioning page notebook; storage startup,
model inference, and offline readiness are integrated at their later phases.
Record a clean-checkout install, typecheck, unit-test, build, and browser
smoke result before adding product behavior.

### Phase 2: Ink, pages, and arithmetic

**Primary deep dives:** [05 Ink document](design/05-ink-document.md),
[11 Arithmetic engine](design/11-arithmetic-engine.md),
[02 Frontend shell](design/02-frontend-shell.md),
[06 Canvas rendering](design/06-canvas-rendering.md),
[04 Pointer input](design/04-pointer-input.md), and
[03 Page management](design/03-page-management.md).
**Required early slice:** [13 Persistence and recovery](design/13-persistence.md)
repository, validation, non-destructive migration, and committed page saves.

Define the vector page/stroke/history schema and the pure, bounded arithmetic
parser first; test both without the browser. Then connect the responsive
shell, DPR-safe canvas layers, Pointer Events, pen/eraser/undo/redo/clear, and
page controls. Build the V2 IndexedDB repository *before* calling pages
complete: create, rename, switch, delete, active-page repair, and legacy
copy must use committed transactions rather than transient UI state. A page
switch must wait for its pending save, and a failed save must keep the ink
visible. Demonstrate separate ink on two pages after a committed save and
reload. A malformed record must show an error/retry without blank overwrite;
Phase 4 adds full recovery export and start-new flows. Test invalid parser
paths. Recognition and answer overlays are not yet required; page tests
involving them run in Phases 3-4.

### Phase 3: Paddle recognition and answers

**Primary deep dives:** [09 ML preprocessing](design/09-ml-preprocessing.md),
[10 Model inference](design/10-model-inference.md),
[07 Equation orchestration](design/07-equation-orchestration.md),
[12 Results and correction](design/12-results-and-correction.md), and
[08 Recognition evidence](design/08-recognition-evidence.md).
**Finishes an earlier deep dive:** [06 Canvas rendering](design/06-canvas-rendering.md)
inline result placement.

Rasterize bounded ink lines, load the unmodified local PP-OCRv6 tiny
detector/recognizer through the worker-backed adapter, and retain exact raw
readback. Group line strokes, cancel or reject stale page/revision responses,
normalize only supported notation, evaluate through the Phase-2 parser, and
place the answer beside the handwritten `=`. Add visible Readback and
user-supplied correction without hiding an automatic wrong read. Persist
corrections through the page record; Phase 4 stress-tests recovery and
durability. Begin consented development examples and failure categories
now, but keep the fresh acceptance set sealed until Phase 5. Prove an actual
model-driven equation/edit/correction flow and record warm phone timing.

### Phase 4: Durability and offline

**Primary deep dives:** [13 Persistence and recovery](design/13-persistence.md)
completion and [14 Offline app and model assets](design/14-offline-pwa.md).

Hard-test the repository started in Phase 2: write ordering, save status,
quota/blocked/aborted transactions, corrupt and future records, recovery
export, and correction isolation. Never overwrite a legacy or unreadable
record with a blank page. Bundle and precache the app shell, exact detector
and recognizer archives, Worker, WASM/JSEP assets, and fonts/icons; show
install, update, failure, and offline-ready states truthfully. Reload the
production build offline on a real device and complete a new equation,
ink edit, correction, and page switch. "Saved" and "Ready offline" are
claims backed by committed storage and completed cache installation.

### Phase 5: Hardening and acceptance

**Primary deep dives:** [15 Accessibility and real devices](design/15-accessibility-and-devices.md),
[16 Visual design pass](design/16-visual-design-pass.md), and
[17 Quality, performance, and evidence](design/17-quality-and-performance.md).
**Completes:** [08 Recognition evidence](design/08-recognition-evidence.md)
fresh acceptance and the rights investigation started in Phase 0.

Check keyboard and screen-reader paths, touch/stylus behavior, safe areas,
loading/error announcements, and visual coherence after the functional
shell exists. Rerun behavior checks after styling. Execute the separate
owner-only 60-attempt fresh recognition set, report exact failures rather
than tuning on that set, measure warm latency and active-inference drawing
frames on named devices, inspect memory, and inject failure conditions.
Close the model/runtime redistribution review with source and license
evidence. The gate is the P-01 through P-10 matrix with no unresolved
release blocker; tests and accessibility basics were required throughout
earlier phases, not introduced here.

### Phase 6: Submission

**Primary deep dive:** [18 Release and post-release bug bash](design/18-release-and-bug-bash.md),
release-candidate and submission sections.

Freeze the verified build, rerun the clean-checkout checks, audit generated
assets/network requests and third-party notices, then publish source and a
static HTTPS demo only if distribution rights are clear. The leader repeats
the main handwritten equation, correction, edit invalidation, multi-page,
and offline flows against the hosted commit in a fresh browser. Give
reviewers working commands, model source/license/architecture, measured
limitations, and a truthful status. If a critical gate misses the deadline,
label the submission incomplete rather than calling it verified V1.

### Phase 7: Post-release bug bash

**Primary deep dive:** [18 Release and post-release bug bash](design/18-release-and-bug-bash.md),
post-release sections.

Only after there is a released build, publish a bounded volunteer test
scope, supported environments, reporting route, and privacy rules for
handwriting samples. Reproduce and prioritize each distinct report, fix
its root cause, add a regression check, retest the released flow, and
record the outcome. Count verified fixes, not speculative reports or
fabricated bounty activity. Feed evidence back into the next scope cycle.

Recognition evidence collection may overlap independent UI/ink work, but
one human still approves each gate. Stop adding P1/V2 features if a P0
gate is at risk. If the automatic core or rights gate fails, submit with
an explicit incomplete status rather than claim a verified V1.

## 3. Outcome Backlog

Use one issue or short task record per **observable outcome**, not per
file. Each record names its deep-dive requirement, dependency, acceptance
steps, automated output, manual device evidence if relevant, and any
limitation. The first implementation records should be:

| ID | Outcome | Dependency |
| --- | --- | --- |
| B-00 | Freeze scope and benchmark, start rights review, and privately snapshot the archived prototype. | Approved docs |
| B-01 | Create clean V1 skeleton and verify clean checkout. | B-00 |
| B-02 | Draw, erase, undo/redo, clear and render vector ink at DPR 1/2. | B-01 |
| B-03 | Safely store, reload, navigate, and manage simple local pages. | B-01, B-02 |
| B-04 | Parse and format the PS arithmetic grammar; reject letters and unsupported notation. | B-01 |
| B-05 | Capture consented ink, classify failures, and integrate the chosen local PaddleOCR path. | B-02 |
| B-06 | Group lines, run revision-aware recognition, show/read/correct answers. | B-02, B-04, B-05 |
| B-07 | Harden save/recovery/correction durability and complete the offline equation-edit flow. | B-03, B-06 |
| B-08 | Validate phone input, accessible results, frame time, memory and recovery. | B-07 |
| B-09 | Run frozen fresh benchmark and model-rights review. | B-06, B-08 |
| B-10 | Publish verified source, hosted demo, setup and limitations. | B-09 |

The deep dives define smaller build steps *inside* each outcome. Keep one
in-progress integration outcome where possible; research and test-fixture
work may run in parallel. Work on a short-lived feature/fix branch, run
`npx tsc --noEmit` with zero errors before every commit, then run the
relevant unit/build/browser checks and review the staged diff. After the
outcome and its phase gate pass, merge through a GitHub PR into buildable
`main`. The only bootstrap exception is the first audited commit, because
this repository has no existing commit for a PR to target. The
[solo workflow](WORKFLOW.md#4-git-review-and-ai-assistance-protocol) owns
commit syntax, safe local squash rules, and PR evidence. A self-reviewed
PR is not independent peer review; do not invent contribution balance or
reviewers for this one-human team.

## 4. Definition of Done and Communication

An outcome is done only when its user behavior works, its integration
contract is exercised, a regression check can catch failure, keyboard/
touch/offline implications are handled or explicitly limited, docs match
the behavior, and the leader has reviewed the result. After the initial
baseline, integration also requires a verified PR and a buildable `main`.
Record any actual external human feedback separately; do not imply it
occurred if it did not. A daily checkpoint records verified progress,
next gate, and blocker.
The design and outcome records are the source of truth; chat is for rapid
coordination.

Release blockers include lost ink, inability to edit or switch pages,
old/wrong answers surviving an edit, unsafe expression execution,
missing required grammar or controls, unusable offline mode after
installation, unapproved public model redistribution, and repeatable
severe pen lag. Readback correction does not close an automatic-recognition
defect. Cosmetic refinements can wait only when they do not obscure
answers or controls.

No outside handwriting writers are committed for this deadline. Run
the owner-only benchmark and disclose the lack of cross-writer evidence;
do not relabel repeated writing by the same person as independent-user
testing. The named phone is the performance/touch target, with warm
pen-up-to-answer p95 at or below 3 seconds. Measure initial download
separately. The brief requires 60 FPS drawing during inference, so record
active-recognition frame traces against a 16.7 ms budget and do not claim
compliance without the measured evidence.

## 5. Post-release Bug Bash

Fix real defects found during development immediately. After release,
publish a narrow scope and responsible-disclosure contact before inviting
outside researchers. Call it a **bug bash** unless paid bounty funding
and rules actually exist. Restrict testing to this app and its deployment.

For each genuine report, retain environment, reproduction steps, expected
and actual result, severity, relevant consented screenshot/ink fixture,
root cause, linked fix, regression check, and retest result. Prioritize
data loss, incorrect arithmetic, stale answers, offline failure, and
unsafe processing above cosmetic issues. Count only distinct verified
reports and fixes in any presentation; do not manufacture a bug count.
