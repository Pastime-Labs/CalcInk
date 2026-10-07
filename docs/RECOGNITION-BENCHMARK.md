# CalcInk V1: Handwriting Recognition Benchmark

Status: **planned, not passed**. This protocol tests the rebuilt V1 with
the selected local PP-OCRv6 tiny detection-plus-recognition pipeline and
experimental `ctc-mask-v2` decoder through the production UI, line grouping,
normalization, parser, and result display.
Fake Worker or parser-only tests cannot supply a handwriting score. See the
[master design](DESIGN.md) and
[recognition evidence deep dive](design/08-recognition-evidence.md).
Prototype comparison exports are development observations, not attempts
in the fresh acceptance set.
The local scoring helper is ready, but no fresh owner attempts have been
recorded or scored.

## Exploratory V1 Replay, 4 October

Before the decoder experiment, six distinct, local `prototype/evidence/`
drawings were replayed once through the production V1 recognition Worker
on a desktop. The normalized raw reads were `6*9=`, `9=`, `6+3=`,
`9+3=`, `9*1=`, and `11+11=`, matching
all six intended strings. The same strokes were then seeded into a local
V1 page: the UI grouped six lines and displayed `54`, `9`, `9`, `12`,
`9`, and `22` without correction. The earlier prototype Paddle lab read
five of those six exactly; its `9=` attempt read `g =`. This is useful
development evidence only: the ink was reused on a desktop, and seeding
the page bypassed fresh pointer capture. It is **not** a fresh handwriting
attempt, phone result, latency gate, or release score.

A separate saved private `4=` development export originally recorded
unrestricted `4二`. An earlier `ctc-mask-v1` replay of the same ink yielded
restricted `4`, unrestricted `二4`, and no answer. This is an incomplete
historical read, not evidence for `ctc-mask-v2`, and is not part of the
fresh acceptance set.

## 1. Two Separate Sets

First collect a **development set** of the 20 expressions below, written
once in each of three sessions by the project owner (60 attempts). Use it
to classify failures and compare one controlled recognition change at a
time. Obtain explicit permission before saving or sharing any other
person's strokes; sample capture is opt-in and local by default.

After implementing and freezing the PaddleOCR pipeline and decoder, collect
a **fresh acceptance set** of the same 20 expressions in three new sessions (60
attempts). Do not reuse a development attempt as acceptance evidence,
redraw a failure quietly, or tune on the acceptance set while still
reporting it as independent. If a fix is made after acceptance failure,
freeze again and collect new attempts.

Use the same named phone/browser for the warm latency test. Record any
desktop or other device attempts separately. Let the model finish loading
before measuring warm pen-up-to-result time; measure first installation
and model load as separate metrics.

## 2. Expression Matrix

Write `×` and `÷` as drawn operators, not alphabetic `x` or slash. Include
the final `=` and clear the page between attempts. Do not exclude an
awkward but intended stroke after seeing a model miss; note visible
legibility before revealing either model's read.

| # | Write by hand | Expected result | Category |
| --- | --- | --- | --- |
| 1 | `12+3=` | `15` | Addition |
| 2 | `18+4×3=` | `30` | Precedence |
| 3 | `72÷8=` | `9` | Division |
| 4 | `90-47=` | `43` | Subtraction |
| 5 | `0.5+1.25=` | `1.75` | Decimals |
| 6 | `-12÷3=` | `-4` | Unary negative |
| 7 | `4÷0=` | `Undefined` | Zero division |
| 8 | `7×6-5=` | `37` | Multiplication/precedence |
| 9 | `10.2÷3=` | `3.4` | Decimals |
| 10 | `99-100=` | `-1` | Subtraction/multi-digit |
| 11 | `9=` | `9` | Known failure |
| 12 | `11+11=` | `22` | Known failure |
| 13 | `6+3=` | `9` | Known failure |
| 14 | `9+3=` | `12` | Known failure |
| 15 | `12.5-7.25=` | `5.25` | Decimal subtraction |
| 16 | `-8+3=` | `-5` | Unary negative |
| 17 | `25×4=` | `100` | Multiplication/multi-digit |
| 18 | `100÷4=` | `25` | Division/multi-digit |
| 19 | `2+3×4-5=` | `9` | Precedence |
| 20 | `0.2+0.03=` | `0.23` | Decimals |

All 20 rows exercise the problem statement's arithmetic scope. Variables,
parentheses, powers, and function notation are out of V1. The exact
intended expression, not its numeric result alone, is the transcription
ground truth.

## 3. Record Each Attempt

Record session ID, expression number, exact intended notation, device,
browser, online/offline state, input method, pen width, first uncorrected
restricted Worker readback, unrestricted diagnostic readback, first
normalized canonical readback, first result, final pen-up-to-settled-result
time, and whether marks were split into different lines or clipped. Score
the restricted read used for the answer against the intended canonical
expression after **notation-only** normalization
(for example drawn `×` to canonical `*`); do not repair a digit from
context or use the parser to guess missing tokens. An unrestricted read
such as `g=` is not itself a correct `9=`; only the restricted first read
and first result can satisfy the score. Keep the unrestricted read to
detect when masking forced a plausible but wrong arithmetic character;
it cannot replace the scored read.
Re-running the same saved strokes is a latency repeat, not a new
handwriting attempt. Record a later manual correction and its result
**separately**. An automatic answer is not correct merely
because a wrong read happened to produce the same number.

Classify a failure at the first responsible boundary: stroke capture,
line grouping, preprocessing, decoder, token normalization, parser,
stale-response logic, or projection. Attach an opt-in local stroke
fixture or screenshot where useful. For non-consenting samples, keep only
aggregate counts and do not add raw ink to the repository.

## 4. Decide Pass or Fail

The **owner-only submission gate** is all of:

- At least 51/60 exact first automatic readbacks **and** correct first
  results, with no correction counted.
- All 12 attempts for rows 11-14 have exact first readback and result.
- At least 5/6 exact first readbacks **and** correct results for each
  designated two-expression pair across the three sessions: addition
  (rows 1, 12), subtraction (4, 10), multiplication (8, 17),
  division (3, 18), decimals (5, 20), unary negative (6, 16), and
  precedence (2, 19). A strong result in one operator cannot hide
  a weak result in another.
- `4÷0=` must never produce a numeric or non-finite automatic answer;
  an unreadable prompt is safe but still counts as a missed read.
- Warm pen-up-to-settled-answer p95 at or below 3 seconds on the named
  phone; the separate 60 FPS drawing-during-recognition gate in
  [quality and performance](design/17-quality-and-performance.md) must pass.
- At least one successful equation, ink edit, page switch, and reload
  repeated after going offline following a complete initial install.

These are internal targets, not numbers asserted by the problem statement.
Because no outside handwriting writers are currently available, a pass
supports only the owner's observed workflow, **not cross-writer
generalization**. A later independent-writer validation repeats the frozen
20-expression set with three different consenting writers. Until then,
release notes must say that cross-writer accuracy is unverified.

Keep the score numerator, denominator, raw first reads, device identity,
latency distribution, failed examples, and limitations in the release
evidence. A visible Readback correction is a safety feature and never
raises the automatic-recognition score.

## 5. Private scoring worksheet

After freezing the build, generate the 60-row manifest once:

```powershell
node scripts/score-benchmark.mjs --template local-assets/benchmark/attempts.json
```

`local-assets/` is Git-ignored. Freeze the exact decoder patch along with
the build; the scorer requires `model.decoder` to match `ctc-mask-v2`.
An older service worker may serve baseline code until its update is
accepted and the page reloads. Verify this decoder ID in each export
before recording it. Fill `frozenCommit`, named `device`, `browser`,
`inputMethod`, and `penWidth`; note any per-attempt variation in
`notes`. For each fresh attempt, export its first read from the app's
**Readback > Export sample** control before correction, ink edit, page
switch, or reload. Put that JSON next to `attempts.json` and set the row's
`sampleFile` to its filename. An export contains private stroke geometry
and browser details; do not commit or share it without consent.

If no first read/export exists, leave `sampleFile` empty and enter a
specific `failure` instead. Never omit the row. Record `settledMs` from
final pen-up until the visible answer settles with the model already warm;
use `null` if no answer appears. Record clipping, split lines, input method
changes, and corrections in `notes`, not as automatic successes. The
export's Worker `elapsedMs` is **not** pen-up-to-answer latency.
If recognition errors and Retry later succeeds, the retry is not a first
read and cannot replace the failed attempt in this worksheet. A detected
box emptied by masking also counts as a miss, even if the remaining boxes
spell a valid equation.

```powershell
node scripts/score-benchmark.mjs local-assets/benchmark/attempts.json
```

The helper checks 60 unique row/session attempts, exact first read **and**
result, the four known-failure rows, each two-row category, model identity
consistency, duplicate stroke geometry, the zero-division safety rule, and
nearest-rank warm p95. It reports missing attempts and timings rather than
removing them from the denominator. `thresholdsMet`
means only the **recorded numeric gates** pass; the owner must still verify
fresh ink, device/timing provenance, active-inference frame traces, memory,
offline behavior, and distribution rights before any release claim.
