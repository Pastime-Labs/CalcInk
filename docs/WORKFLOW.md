# CalcInk Solo Engineering Workflow

Status: current working agreement for V2 and release preparation.
The [V2 design](V2-DESIGN.md) defines scope; the
[V2 implementation plan](V2-IMPLEMENTATION.md) defines delivery gates;
the [benchmark](RECOGNITION-BENCHMARK.md) and
[phone runbook](PHONE-ACCEPTANCE.md) define acceptance evidence.

## 1. Ownership

The project leader is the only human contributor and owns scope, review,
device testing, release decisions, and publication. AI assistance may help
with research, code, and tests, but it is not independent human review.
Disclose its use where required; never invent contributors, reviews,
test results, or development history.

Keep CalcInk browser-only and on-device. Document material scope or
architecture changes before code; a short rationale suffices for notation,
model rights, storage migration, or offline behavior.

## 2. One-Outcome Loop

1. Define one observable user outcome, its design link, failure case,
   and acceptance steps. Note dependencies and what is out of scope.
2. Inspect the existing path and choose the smallest compatible change.
   Preserve ink, corrections, revision guards, offline behavior, and
   accessibility at the affected boundary.
3. Add a regression check that would fail on the original defect or
   missing behavior. Do not alter a test merely to accept a wrong result.
4. Run relevant unit and browser checks, then inspect the complete diff.
   Check touch, keyboard, narrow screens, reload, and offline behavior
   wherever the change can affect them.
5. Record actual commands, build/commit, device/browser, result, and
   limitations. Report the verified outcome, next gate, and blocker.

Use one issue per outcome, not per file. Mocked OCR does not establish
handwriting accuracy.

## 3. Verification and Release Evidence

Use `npm test` and `npm run build` for code changes, and relevant
`npm run test:e2e` flows for UI or cross-module behavior. Browser tests
require Playwright Chromium. Run a production preview for release smoke
checks. A passing local suite is not a phone, hosted CI, or public-demo
result.

Acceptance still needs fresh handwriting scores, actual phone drawing
traces during OCR, touch/stylus observations where hardware permits,
offline reload, real print/PDF inspection, and rights review for model
and icon assets. Record failures and skipped checks. Do not publish
private ink, secrets, or model weights without permission.

## 4. Git, Review, and AI-Assistance Protocol

- Work on a short-lived `feat/...` or `fix/...` branch from buildable
  `main`; do not commit unverified changes directly to `main`.
- Before every commit, run `npx tsc --noEmit` with zero errors. Review
  `git status`, `git diff --cached`, and `git diff --cached --check`;
  stage only one logical change with no private assets or unrelated work.
- Use the repository's existing Git identity. Do not override author or
  committer names, emails, or dates.
- Commit as `<type>(<scope>): <imperative lowercase summary>`, under
  50 characters with no trailing period. Types: `feat`, `fix`, `perf`,
  `test`, `refactor`, `chore`, `docs`. Scopes: `canvas`, `parser`, `ocr`,
  `worker`, `db`, `pwa`, `ui`, `setup`, `readme`, `ci`.
- Keep commits atomic. Squash trial commits only when they are your own,
  unpushed commits on the isolated branch; do not rewrite shared history
  or reset unrelated changes. Re-run checks before the replacement commit.
- Merge through a GitHub PR with design link, actual checks, limitations,
  and relevant screenshots or device evidence. Require green checks and a
  buildable `main`. Solo self-review is not a second-person approval.

## 5. Stop Rules

Do not claim a release gate passed with lost ink, stale or wrong answers,
unsafe arithmetic, broken offline use, unresolved distribution rights,
or unmeasured drawing performance during active OCR. Fix or disclose
the limitation before release. After release, use the
[bug-bash protocol](design/18-release-and-bug-bash.md#bug-bash-after-release)
for real reports; call it a paid bounty only if funding and rules exist.
