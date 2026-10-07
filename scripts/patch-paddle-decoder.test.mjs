import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCTCSample } from "./patch-paddle-decoder.mjs";

const dictionary = [..."0123456789+-*/.=", "二", "g", " "];
const classes = dictionary.length + 1;

function frame(values) {
  const result = new Float32Array(classes).fill(0.01);
  for (const [character, probability] of Object.entries(values)) {
    const index = character === "blank" ? 0 : dictionary.indexOf(character) + 1;
    if (index < 0 || (index === 0 && character !== "blank")) {
      throw new Error(`Unknown test character: ${character}`);
    }
    result[index] = probability;
  }
  return result;
}

function decode(...frames) {
  const data = new Float32Array(frames.length * classes);
  frames.forEach((values, index) => data.set(frame(values), index * classes));
  return decodeCTCSample(data, 0, frames.length, classes, dictionary);
}

test("masks an unsupported top class before CTC decoding", () => {
  const result = decode(
    { "4": 0.9 },
    { blank: 0.9 },
    { g: 0.95, "=": 0.7 },
  );
  assert.equal(result.unmaskedText, "4g");
  assert.equal(result.text, "4=");
  assert.ok(Math.abs(result.unmaskedScore - 0.925) < 1e-6);
  assert.ok(Math.abs(result.score - 0.8) < 1e-6);
});

test("keeps allowed reads and CTC repeat/blank behavior", () => {
  assert.equal(decode({ "1": 0.9 }, { "1": 0.8 }).text, "1");
  const repeated = decode({ "1": 0.9 }, { blank: 0.9 }, { "1": 0.8 });
  assert.equal(repeated.text, "11");
  assert.equal(repeated.unmaskedText, "11");
  assert.equal(decode({ "4": 0.9 }).text, "4");
});

test("retains 二 for normalization instead of substituting another class", () => {
  const result = decode({ "4": 0.9 }, { "二": 0.9, "2": 0.6, "=": 0.4 });
  assert.equal(result.unmaskedText, "4二");
  assert.equal(result.text, "4二");
});

test("keeps CTC repeat and blank behavior for 二", () => {
  assert.equal(decode({ "二": 0.9 }, { "二": 0.8 }).text, "二");
  assert.equal(decode({ "二": 0.9 }, { blank: 0.9 }, { "二": 0.8 }).text, "二二");
});

test("rejects a decoder/model dictionary mismatch", () => {
  assert.throws(
    () => decodeCTCSample(new Float32Array(8), 0, 1, 8, dictionary),
    /dictionary does not match/,
  );
});
