import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRead, previewUrl, validateSample } from "./replay-fixture.mjs";

const valid = () => ({
  schemaVersion: 1,
  intendedExpression: "9=",
  strokes: [{
    id: "stroke-1",
    width: 4,
    points: [{ x: 10, y: 20, pressure: 0.5, t: 0 }],
  }],
  firstRead: { rawText: "g=" },
});

test("accepts a captured line without altering its first read", () => {
  const sample = valid();
  assert.equal(validateSample(sample), sample);
  assert.equal(sample.firstRead.rawText, "g=");
});

test("rejects unsupported versions and missing ground truth", () => {
  assert.throws(() => validateSample({ ...valid(), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateSample({ ...valid(), intendedExpression: "" }), /intendedExpression/);
});

test("rejects oversized and malformed ink before launching a browser", () => {
  assert.throws(() => validateSample({ ...valid(), strokes: [] }), /strokes/);
  assert.throws(() => validateSample({
    ...valid(),
    strokes: [{ ...valid().strokes[0], width: 129 }],
  }), /stroke/);
  assert.throws(() => validateSample({
    ...valid(),
    strokes: [{ ...valid().strokes[0], points: [{ x: Infinity, y: 20 }] }],
  }), /point/);
  assert.throws(() => validateSample({
    ...valid(),
    strokes: [{ ...valid().strokes[0], points: Array(20_001).fill({ x: 1, y: 1 }) }],
  }), /20,000|20000/);
});

test("accepts only a local preview origin", () => {
  assert.equal(previewUrl("http://127.0.0.1:4173").origin, "http://127.0.0.1:4173");
  assert.throws(() => previewUrl("https://example.com"), /local HTTP origin/);
  assert.throws(() => previewUrl("http://127.0.0.1:4173/other"), /local HTTP origin/);
});

test("scores notation-only differences as an exact read", () => {
  assert.deepEqual(compareRead("9×1=", "9 * 1 ="), {
    normalizedRead: "9*1=",
    exactRead: true,
  });
  assert.deepEqual(compareRead("9÷3−1=", "9 / 3 - 1 ="), {
    normalizedRead: "9/3-1=",
    exactRead: true,
  });
  assert.deepEqual(compareRead("11+11\u4e8c", "11+11="), {
    normalizedRead: "11+11=",
    exactRead: true,
  });
});

test("never repairs an alphabetic OCR read into a digit", () => {
  assert.deepEqual(compareRead("g=", "9="), {
    normalizedRead: "g=",
    exactRead: false,
  });
});
