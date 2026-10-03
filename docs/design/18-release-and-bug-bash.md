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
