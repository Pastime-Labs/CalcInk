import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = new URL("../node_modules/@paddleocr/paddleocr-js/", import.meta.url);
const workerFile = new URL("dist/assets/worker-entry-C9UNuyOJ.js", packageRoot);
const packageFile = new URL("package.json", packageRoot);
const unpatchedSha256 = "477db3f009c118823a5f9ebe15f1e96c1c464165715ba28a9884290f61addf52";
const patchedSha256 = "f3929e5f7b3083bfcf895119f8a60ebe46b0b2b7e589c938c059e9756fd5a61a";
const decoderStart = "function decodeCTCSample(data, offset, timeSteps, classes, charDict) {";
const decoderEnd = "\nfunction postprocess(output, charDict) {";
const oldRecMap = "return decoded.map(({ text, score }) => ({ text, score }));";
const newRecMap = "return decoded.map(({ text, score, unmaskedText, unmaskedScore }) => ({ text, score, unmaskedText, unmaskedScore }));";
const oldItem = "                  text: rec.text,\n                  score: rec.score";
const newItem = "                  text: rec.text,\n                  score: rec.score,\n                  unmaskedText: rec.unmaskedText,\n                  unmaskedScore: rec.unmaskedScore";
const oldFilter = "if (rec.text && rec.score >= resolved.pipeline.scoreThresh) {";
const newFilter = "if ((rec.text || rec.unmaskedText) && Math.max(rec.score, rec.unmaskedScore) >= resolved.pipeline.scoreThresh) {";

// This function is inserted into the pinned SDK's nested Worker, not run on
// the canvas thread. Keep the original dictionary indices and CTC blank.
export function decodeCTCSample(data, offset, timeSteps, classes, charDict) {
  if (classes !== charDict.length + 1 || offset < 0 ||
      offset + timeSteps * classes > data.length) {
    throw new Error("CalcInk CTC mask: model dictionary does not match output");
  }
  const CALCINK_CTC_MASK_V1 = new Set("0123456789+-*/.=\u00d7\u00f7\u2212 ");
  for (const required of "0123456789+-*/.=") {
    if (!charDict.includes(required)) {
      throw new Error(`CalcInk CTC mask: missing ${required} in model dictionary`);
    }
  }
  const allowed = new Uint8Array(classes);
  allowed[0] = 1;
  for (let index = 0; index < charDict.length; index += 1) {
    if (CALCINK_CTC_MASK_V1.has(charDict[index])) allowed[index + 1] = 1;
  }

  let previous = -1;
  let unmaskedPrevious = -1;
  let text = "";
  let unmaskedText = "";
  const scores = [];
  const unmaskedScores = [];
  for (let step = 0; step < timeSteps; step += 1) {
    let best = 0;
    let bestValue = -Infinity;
    let unmaskedBest = 0;
    let unmaskedValue = -Infinity;
    const start = offset + step * classes;
    for (let cls = 0; cls < classes; cls += 1) {
      const value = data[start + cls];
      if (value > unmaskedValue) {
        unmaskedValue = value;
        unmaskedBest = cls;
      }
      if (allowed[cls] && value > bestValue) {
        bestValue = value;
        best = cls;
      }
    }
    if (best > 0 && best !== previous) {
      text += charDict[best - 1];
      scores.push(bestValue);
    }
    if (unmaskedBest > 0 && unmaskedBest !== unmaskedPrevious) {
      unmaskedText += charDict[unmaskedBest - 1];
      unmaskedScores.push(unmaskedValue);
    }
    previous = best;
    unmaskedPrevious = unmaskedBest;
  }
  return {
    text,
    score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    unmaskedText,
    unmaskedScore: unmaskedScores.length
      ? unmaskedScores.reduce((a, b) => a + b, 0) / unmaskedScores.length : 0,
  };
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error("PaddleOCR Worker layout changed; refusing to patch");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

async function main() {
  const checkOnly = process.argv[2] === "--check";
  if (process.argv.length > (checkOnly ? 3 : 2)) {
    throw new Error("Usage: node scripts/patch-paddle-decoder.mjs [--check]");
  }
  const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
  if (packageJson.version !== "0.4.2") {
    throw new Error("PaddleOCR.js version changed; review the CTC mask patch");
  }
  let source = await readFile(workerFile, "utf8");
  if (source.includes("CALCINK_CTC_MASK_V1")) {
    if (!source.includes(newRecMap) || !source.includes(newItem)) {
      throw new Error("PaddleOCR CTC mask is incomplete");
    }
    if (!source.includes(newFilter)) {
      if (checkOnly) throw new Error("PaddleOCR CTC mask diagnostics are not installed");
      source = replaceOnce(source, oldFilter, newFilter);
      await writeFile(workerFile, source);
    }
    if (createHash("sha256").update(source).digest("hex") !== patchedSha256) {
      throw new Error("PaddleOCR CTC mask bytes changed; review the decoder patch");
    }
    return;
  }
  if (checkOnly) throw new Error("PaddleOCR CTC mask is not installed; run npm install");
  const sha256 = createHash("sha256").update(source).digest("hex");
  if (sha256 !== unpatchedSha256) {
    throw new Error("PaddleOCR Worker bytes changed; review the CTC mask patch");
  }
  const start = source.indexOf(decoderStart);
  const end = source.indexOf(decoderEnd, start);
  if (start < 0 || end < 0 || source.indexOf(decoderStart, start + 1) >= 0) {
    throw new Error("PaddleOCR CTC decoder location changed");
  }
  source = source.slice(0, start) + decodeCTCSample.toString() + source.slice(end);
  source = replaceOnce(source, oldRecMap, newRecMap);
  source = replaceOnce(source, oldItem, newItem);
  source = replaceOnce(source, oldFilter, newFilter);
  if (createHash("sha256").update(source).digest("hex") !== patchedSha256) {
    throw new Error("Generated PaddleOCR CTC mask differs from the pinned patch");
  }
  await writeFile(workerFile, source);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
