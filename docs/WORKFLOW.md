# CalcInk Solo Engineering Workflow

Status: operating procedure for the V1 build and remaining release work.
This document says **how** the project leader and AI assistant work. The
[master design](DESIGN.md) says **what** to build, the numbered deep dives
define subsystem contracts, the [implementation plan](IMPLEMENTATION.md)
owns phases and dependencies,
and the [benchmark](RECOGNITION-BENCHMARK.md) owns recognition evidence. The README
describes only behavior that has actually been verified. The `htt-mini`
notebook is prototype-only; local PP-OCRv6 tiny detection and
recognition is the selected V1 rebuild path, not yet a verified release.

## 1. Ownership and Decision Rules

The leader is the only human contributor. The AI assistant may research,
propose designs, write code, run checks, and challenge assumptions. The leader
chooses scope, reviews changes, supplies real handwriting/device evidence,
accepts each gate, and controls publication. AI review is not a second human
review. If a competition or repository policy requires AI-use disclosure,
follow it; never invent teammates, reviews, test results, or development
history.

Use this order when instructions conflict: problem statement, master design,
relevant deep dive, implementation phase gate, outcome record, then code. Fix
the higher-level contract and its tests before accepting a behavior change.
Record a short decision note only for consequential choices: model and rights,
accepted notation, storage migration, offline strategy, or a scope cut. Include
the options, evidence, decision, and consequence; do not write ceremonial
design documents for trivial UI edits.

The project is a static, browser-only Vite/TypeScript app with Canvas,
local PP-OCRv6 tiny detection and recognition in a Web Worker, and IndexedDB.
It needs no backend, auth, server database, payments, Docker stack, tenant
isolation, or server staging environment.

## 2. Project Phases

The phases below are an execution method, **not** a new eight-week schedule.
Use the ordered outcomes in the [implementation plan](IMPLEMENTATION.md).

| Phase | Work | Evidence needed to leave it |
| --- | --- | --- |
| 1. Scope and journey | Reconfirm the brief, target student, and primary action: write `11+11=` and see a trustworthy answer beside `=`. Limit V1 written expressions to digits, decimal point, `+`, `-`, `×`, `÷`, and terminal `=`; defer parentheses, powers, and algebra. Sketch the paper, tools, Pages, and Readback at phone and desktop sizes, including wrong-read and offline states. | Approved scope/out-of-scope in the master design, brief-to-design map, and annotated low-fidelity layouts. No dashboard or long onboarding is needed. |
| 2. Architecture review | Review Canvas coordinates/history, line identity and stale Worker replies, stroke-to-raster input, strict arithmetic validation, IndexedDB migration, complete offline Paddle assets, and model redistribution rights. Challenge data-loss, wrong-answer, latency, and recovery paths. | Agreed deep-dive contracts and explicit open risks. The selected model is not release-approved merely because it loads. |
| 3. Baseline and tasks | Archive the current prototype under `prototype/` before replacing the root app. Keep any unapproved model weights out of history that may become public. Verify a clean install/build. Turn implementation phases into small outcome records in dependency order; identify the next user-visible slice, not a list of files. | Retrievable prototype archive, exact setup commands, and one ready outcome with acceptance steps and dependency. No unreviewed public model binaries or personal files. |
| 4. Minimal automation | Run `npm test`, `npm run build`, and relevant `npm run test:e2e` checks. Once a clean checkout works, add one CI job mirroring install, unit tests, and build; add browser E2E only with an installed compatible Chrome. Use a production preview build for browser smoke checks. | Actual command outputs and a passing clean-checkout path. CI is not "green" if a required test was skipped. No staging database or tooling added for ceremony. |
| 5. Vertical implementation | Build the brief-required ink-to-answer flow first: smooth input/tools, PaddleOCR line recognition in a Worker, deterministic arithmetic, answer adjacent to `=`, immediate invalidation on edit, then persistence/offline. Add simple pages and polish within their approved gates; parentheses and powers are V2. | Each outcome works through the browser, has a regression check, and passes its deep-dive exit gate. Source existing is not proof of behavior. |
| 6. Hardening and acceptance | Run real-model owner handwriting attempts without tuning on the acceptance set; measure active-recognition 60 FPS drawing, latency, memory, device layout, airplane-mode lifecycle, malformed input, stale replies, corrupt storage, and model/asset failures. | Recorded [quality matrix](design/17-quality-and-performance.md) with device/commit, raw results, failures, and limits. Resolve blockers or label the build incomplete. |
| 7. Release | Clear rights for the exact model weights; verify a fresh checkout and hosted static build. Complete README setup, model source/license/architecture, limitations, and public repo/demo links. Have the leader repeat the core flow on the deployed version. | Evidence in the [release checklist](design/18-release-and-bug-bash.md). A public URL alone is not a verified V1. |
| 8. Feedback and bug bash | After release, invite scoped reports for this app only. Reproduce, classify severity, find root cause, add a regression check, fix, retest, and publish the outcome. Feed recurring problems back into design decisions. | Genuine issue and fix records. Call this a bug bash unless funded bounty rules actually exist; never manufacture a bug count. |

Low-fidelity sketches in phase 1 settle workflow and placement only. The
[visual-design pass](design/16-visual-design-pass.md) chooses the final
visual language after functional structure works. Model evidence can be
collected while independent UI/ink work proceeds, but only one integration
outcome should be in progress at a time.

## 3. One-Outcome Working Loop

For each outcome in the implementation plan:

1. **Define:** State the visible result, linked P-ID/deep dive, dependency,
   and a failure example. Write acceptance steps before code.
2. **Choose:** Inspect existing code and select the smallest compatible
   design. Check browser-native features and installed dependencies before
   adding abstractions or packages.
3. **Implement:** Make a small vertical change with its lowest useful
   regression test. Keep model output, user correction, and stored ink
   separate. Do not silently change a test to accept a wrong result.
4. **Verify:** Run the relevant unit check, type/build check, browser flow,
   and physical-device check when applicable. Record exact commands, device,
   observations, and failures. A mocked Worker never proves handwriting
   accuracy.
5. **Review:** Read the complete diff, inspect staged files, check
   accessibility/offline/data-loss implications, and compare behavior to
   design. Update docs if an implementation decision changed.
6. **Commit and report:** Commit a coherent behavior or root-cause fix,
   update the outcome record, and note what is verified, next, and blocked.

An outcome record can be a GitHub issue or a short Markdown note:

```text
ID / title:
PS or P-ID / design link:
User-visible outcome and out-of-scope:
Depends on:
Acceptance steps (normal, failure, edit/reload if relevant):
Checks and actual results (command, device/browser, date):
Decision or risk:
Commit / status / limitation:
```

Keep the daily checkpoint to three facts: **verified since last checkpoint,
next gate, blocker or decision needed**. Chat is for coordination; the
outcome record and code/tests are the durable trail.

## 4. Git, Review, and AI-Assistance Protocol

- **Bootstrap once:** When no `main` or GitHub remote exists, build and verify
  the first TypeScript baseline on `feat/setup`, then establish a buildable
  `main` from the audited bootstrap snapshot. Record this unavoidable
  initial-commit exception; do not invent a PR for it. All subsequent
  outcomes use branch-to-`main` PRs. Configure the GitHub remote before
  claiming a PR or merge occurred.
- **Before the first public push:** Archive the prototype source under
  `prototype/` and keep any unapproved model weights in a separate private
  archive. A local commit with those weights is **not** safe to push later
  as public history. Do not retroactively split the snapshot into fake
  historical commits. Inspect
  staged files for model weights, license evidence, screenshots, personal
  ink, secrets, generated output, and unrelated files. Never put model
  binaries into public Git history before redistribution rights are
  resolved: deleting them in a later commit does not unpublish them.
- **Isolate every outcome:** Keep `main` buildable and runnable. Start each
  new outcome on a short-lived `feat/...` or `fix/...` branch from the
  current `main`; do not commit implementation or fixes directly to `main`.
  Use focused names such as `feat/canvas-engine`,
  `feat/shunting-yard-parser`, `feat/webworker-ocr`, and
  `feat/indexeddb-persistence`. Do not create a long-lived staging branch.
- **Before every commit:** Run `npx tsc --noEmit` from the root and require
  zero TypeScript errors. Review `git status`, `git diff --cached --stat`,
  `git diff --cached`, and `git diff --cached --check`; check that staged
  files contain no private ink, unapproved weights, secrets, or unrelated
  work. Run `npm test` and `npm run build` for code changes, plus relevant
  `npm run test:e2e` flows for cross-module/UI behavior. E2E requires a
  production build and Playwright's Chromium browser installed with
  `npx playwright install chromium`. Record any skipped non-typecheck
  check and why; never commit while the TypeScript gate fails.
- **Commit atomically:** Use
  `<type>(<scope>): <imperative lowercase summary>` with a header under
  50 characters and no trailing period. Allowed types are `feat`, `fix`,
  `perf`, `test`, `refactor`, `chore`, and `docs`; allowed scopes are
  `canvas`, `parser`, `ocr`, `worker`, `db`, `pwa`, `ui`, `setup`, `readme`,
  and `ci`. For example, `fix(worker): reject stale responses`.
  One commit changes one logical concern; do not mix canvas, parser, and
  database implementation in one commit. Never backdate commits or create
  synthetic churn.
- **Squash local trial commits:** Prefer verifying before each commit. If
  debugging nevertheless produced multiple trial-and-error commits, inspect
  the exact range and staged work, then use `git reset --soft HEAD~N` and
  one verified clean commit **only for your own unpushed commits on the
  isolated branch**. Never rewrite shared/pushed history or someone else's
  commits, and never reset unrelated changes. Re-run the TypeScript and
  relevant behavior checks before the replacement commit.
- **Merge through GitHub PRs:** Open a PR only after the branch's outcome
  and relevant phase gate pass. Include design links, actual checks,
  screenshots/device evidence when relevant, limitations, and a diff
  review. Merge only with green required checks and a buildable resulting
  `main`. The leader's review is self-review, not independent peer review;
  do not fabricate a reviewer or an empty PR for the rubric. A phase closes
  only when its verified outcome PRs are merged.
- **Own AI output:** Treat generated code as an untrusted proposal. The
  leader should understand the feature, challenge tradeoffs, review the
  diff, and verify the app with real handwriting. Follow any applicable
  AI-disclosure rule; never hide assistance by fabricating human work.

This protocol makes the repository reflect genuine product decisions and
verified progress. It does not promise that every code line was handwritten
by a human, nor does it use Git history as camouflage.

## 5. Stop and Escalate

Stop adding extras when a brief-required gate is at risk. Do not merge or
claim completion with lost committed ink, stale/wrong answers, unsafe
evaluation, an unverified offline path, unresolved model rights, failed
core recognition, or unmeasured/failed 60 FPS drawing during inference.
Record the failure, choose a smaller scope or fix, and rerun the relevant
acceptance steps. If a release gate is still open on submission day, submit
an accurately labeled prototype rather than a fictitious finished app.
