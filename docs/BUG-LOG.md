# CalcInk Development Bug Log

These are defects found during local development on 4 October 2026, not
post-release bug-bash reports or a paid bounty. A fix is listed only where
the original failure path has a regression check.

| ID | Reproduction and impact | Fix | Regression |
| --- | --- | --- | --- |
| D-01 | A masked OCR box can be empty or space-only while a second box reads `9=`. Normalization drops that box and makes a valid-looking but incomplete answer. | Mark the line unreadable, retain both box reads, and score the attempt as a miss. | `src/ui/equations.test.ts` partial-box cases; `scripts/score-benchmark.test.mjs` omitted-box case. |
| D-02 | Correcting a line replaced `rawRead`, so Readback labeled user text as the restricted OCR read, including after reload. | Preserve the actual OCR read in memory; after reload show that no OCR read was retained, while keeping the correction as the interpreted equation. | `src/ui/equations.test.ts` correction case; `e2e/smoke.spec.ts` reload case. |
| D-03 | An inference error followed by Retry could export the retry result as a first automatic read and inflate the benchmark. | Invalidate first-read export for that ink after an initial failure; the worksheet records the failure. | `src/ui/equations.test.ts` error-then-retry case. |
| D-04 | If initial service-worker registration failed before a cache existed, Retry tried to repair a nonexistent precache and remained failed. | Re-register on Retry when there is no active worker, then verify both activation and cached assets. | `e2e/pwa-retry.spec.ts` failed before the fix and passed after rebuild. |

The private `4=` handwriting sample still lacks `=` under the masked
pipeline. This remains an open recognition miss, not a fixed defect or
an acceptance result. Post-release reports belong to the separate
[bug-bash protocol](design/18-release-and-bug-bash.md#bug-bash-after-release).
