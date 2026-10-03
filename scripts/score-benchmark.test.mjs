import assert from "node:assert/strict";
import { test } from "node:test";
import { MATRIX, scoreBenchmark, template } from "./score-benchmark.mjs";

function filled() {
  const manifest = template();
  Object.assign(manifest, {
    frozenCommit: "test-only",
    device: "Test phone",
    browser: "Test browser",
    inputMethod: "stylus",
    penWidth: 4,
  });
  const samples = new Map();
  let inkX = 0;
  for (const attempt of manifest.attempts) {
    const [expression, expected] = MATRIX[attempt.row - 1];
    const key = `${attempt.session}-${attempt.row}`;
    attempt.sampleFile = `${key}.json`;
    attempt.settledMs = 1000;
    samples.set(attempt.sampleFile, {
      schemaVersion: 1,
      sampleId: key,
      intendedExpression: expression,
      strokes: [{ id: key, width: 4, points: [{ x: ++inkX, y: 1 }] }],
      firstRead: {
        rawText: expression,
        normalizedText: expression,
        result: expected === "Undefined"
          ? { kind: "undefined", reason: "division_by_zero" }
          : { kind: "value", display: expected },
      },
      model: {
        id: "PP-OCRv6_tiny_det+rec",
        detector: {
          id: "PP-OCRv6_tiny_det",
          archiveSha256: "ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d",
        },
        recognizer: {
          id: "PP-OCRv6_tiny_rec",
          archiveSha256: "1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29",
        },
      },
    });
  }
  return { manifest, samples, score: () => scoreBenchmark(manifest, (file) => samples.get(file)) };
}

test("blank template remains incomplete rather than a failed handwriting score", () => {
  const report = scoreBenchmark(template(), () => {
    throw new Error("No file should be read");
  });
  assert.equal(report.completed, 0);
  assert.equal(report.missing.length, 60);
  assert.equal(report.thresholdsMet, false);
  assert.equal(report.warmP95Ms, null);
});

test("scores 60 first reads, categories, and nearest-rank warm p95", () => {
  const { manifest, score } = filled();
  manifest.attempts[56].settledMs = 2999;
  manifest.attempts[57].settledMs = 4000;
  manifest.attempts[58].settledMs = 4000;
  manifest.attempts[59].settledMs = 4000;
  const report = score();
  assert.equal(report.completed, 60);
  assert.equal(report.hits, 60);
  assert.equal(report.knownFailureHits, 12);
  assert.ok(Object.values(report.categories).every((count) => count === 6));
  assert.equal(report.warmP95Ms, 2999);
  assert.equal(report.thresholdsMet, true);
});

test("an alphabetic read cannot be rescued by the correct result", () => {
  const { samples, score } = filled();
  const sample = samples.get("S1-11.json");
  sample.firstRead.rawText = "g=";
  sample.firstRead.normalizedText = null;
  const report = score();
  assert.equal(report.hits, 59);
  assert.equal(report.knownFailureHits, 11);
  assert.deepEqual(report.misses, ["S1-11"]);
  assert.equal(report.thresholdsMet, false);
});

test("a category can fail while the overall count passes", () => {
  const { samples, score } = filled();
  for (const session of ["S1", "S2"]) {
    samples.get(`${session}-4.json`).firstRead.result = { kind: "value", display: "42" };
  }
  const report = score();
  assert.equal(report.hits, 58);
  assert.equal(report.categories.subtraction, 4);
  assert.equal(report.thresholdsMet, false);
});

test("a no-read failure counts as a miss and cannot disappear from timing", () => {
  const { manifest, score } = filled();
  manifest.attempts[0].sampleFile = "";
  manifest.attempts[0].failure = "Recognition timed out";
  manifest.attempts[0].settledMs = null;
  const report = score();
  assert.equal(report.completed, 60);
  assert.equal(report.hits, 59);
  assert.deepEqual(report.missingTimings, ["S1-01"]);
  assert.equal(report.warmP95Ms, null);
  assert.equal(report.thresholdsMet, false);
});

test("an unsafe numeric zero-division answer blocks acceptance despite 59 exact reads", () => {
  const { samples, score } = filled();
  const sample = samples.get("S1-7.json");
  sample.firstRead.rawText = "4/8=";
  sample.firstRead.normalizedText = "4/8=";
  sample.firstRead.result = { kind: "value", display: "0.5" };
  const report = score();
  assert.equal(report.hits, 59);
  assert.deepEqual(report.zeroDivisionUnsafe, ["S1-07"]);
  assert.equal(report.thresholdsMet, false);
  sample.firstRead.result = { kind: "undefined", reason: "non_finite" };
  assert.deepEqual(score().zeroDivisionUnsafe, ["S1-07"]);
});

test("rejects duplicate attempts, reused exports, and mismatched ground truth", () => {
  const { manifest, samples, score } = filled();
  manifest.attempts[1].row = 1;
  assert.throws(score, /Duplicate attempt/);
  manifest.attempts[1].row = 2;
  samples.get("S1-2.json").sampleId = "S1-1";
  assert.throws(score, /reused sampleId/);
  samples.get("S1-2.json").sampleId = "S1-2";
  samples.get("S1-2.json").intendedExpression = "1+1=";
  assert.throws(score, /ground truth/);
});

test("rejects reused stroke geometry even when the export has a new sampleId", () => {
  const { samples, score } = filled();
  samples.get("S1-2.json").strokes = [{
    id: "new-id",
    width: 4,
    points: [{ x: 1, y: 1 }],
  }];
  assert.throws(score, /reused stroke geometry/);
});

test("rejects a different model and a timing for an unreadable answer", () => {
  const { samples, score } = filled();
  const sample = samples.get("S1-1.json");
  sample.model.id = "different-model";
  assert.throws(score, /frozen V1 pins/);
  sample.model.id = "PP-OCRv6_tiny_det+rec";
  sample.firstRead.result = null;
  assert.throws(score, /no answer was shown/);
});
