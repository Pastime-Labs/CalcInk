import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareRead, validateSample } from "./replay-fixture.mjs";

export const MATRIX = [
  ["12+3=", "15"], ["18+4*3=", "30"], ["72/8=", "9"], ["90-47=", "43"],
  ["0.5+1.25=", "1.75"], ["-12/3=", "-4"], ["4/0=", "Undefined"],
  ["7*6-5=", "37"], ["10.2/3=", "3.4"], ["99-100=", "-1"],
  ["9=", "9"], ["11+11=", "22"], ["6+3=", "9"], ["9+3=", "12"],
  ["12.5-7.25=", "5.25"], ["-8+3=", "-5"], ["25*4=", "100"],
  ["100/4=", "25"], ["2+3*4-5=", "9"], ["0.2+0.03=", "0.23"],
];

const CATEGORIES = {
  addition: [1, 12],
  subtraction: [4, 10],
  multiplication: [8, 17],
  division: [3, 18],
  decimals: [5, 20],
  unaryNegative: [6, 16],
  precedence: [2, 19],
};
const SESSIONS = ["S1", "S2", "S3"];
const MODEL = {
  id: "PP-OCRv6_tiny_det+rec",
  decoder: "ctc-mask-v2",
  detector: {
    id: "PP-OCRv6_tiny_det",
    archiveSha256: "ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d",
  },
  recognizer: {
    id: "PP-OCRv6_tiny_rec",
    archiveSha256: "1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29",
  },
};

export function template() {
  return {
    setType: "acceptance",
    frozenCommit: "",
    device: "",
    browser: "",
    inputMethod: "",
    penWidth: null,
    attempts: SESSIONS.flatMap((session) => MATRIX.map((_, index) => ({
      session,
      row: index + 1,
      sampleFile: "",
      failure: "",
      settledMs: null,
      notes: "",
    }))),
  };
}

function resultMatches(result, expected) {
  if (expected === "Undefined") {
    return result?.kind === "undefined" && result.reason === "division_by_zero";
  }
  return result?.kind === "value" && result.display === expected;
}

export function scoreBenchmark(manifest, loadSample) {
  if (manifest?.setType !== "acceptance" || !Array.isArray(manifest.attempts)) {
    throw new Error("Expected an acceptance manifest with an attempts array");
  }
  if (manifest.attempts.length > 60) throw new Error("More than 60 attempts");
  const missingMetadata = ["frozenCommit", "device", "browser", "inputMethod"]
    .filter((field) => typeof manifest[field] !== "string" || !manifest[field].trim());
  if (typeof manifest.penWidth !== "number" ||
      !Number.isFinite(manifest.penWidth) || manifest.penWidth <= 0) {
    missingMetadata.push("penWidth");
  }

  const seen = new Set();
  const sampleIds = new Set();
  const inkFingerprints = new Set();
  const results = new Map();
  const latencies = [];
  const missingTimings = [];
  const zeroDivisionUnsafe = [];
  for (const attempt of manifest.attempts) {
    const { session, row, sampleFile, failure, settledMs } = attempt;
    if (!SESSIONS.includes(session) || !Number.isInteger(row) || row < 1 || row > 20) {
      throw new Error(`Invalid session or row: ${session}/${row}`);
    }
    const key = `${session}-${String(row).padStart(2, "0")}`;
    if (seen.has(key)) throw new Error(`Duplicate attempt ${key}`);
    seen.add(key);
    if (typeof sampleFile !== "string" || typeof failure !== "string") {
      throw new Error(`${key}: sampleFile and failure must be strings`);
    }
    if ((sampleFile && !sampleFile.trim()) || (failure && !failure.trim())) {
      throw new Error(`${key}: sampleFile or failure cannot be blank whitespace`);
    }
    if (sampleFile && failure) throw new Error(`${key}: choose sampleFile or failure, not both`);
    if (settledMs !== null && settledMs !== undefined &&
        (typeof settledMs !== "number" || !Number.isFinite(settledMs) || settledMs < 0)) {
      throw new Error(`${key}: settledMs must be a nonnegative number or null`);
    }
    if (!sampleFile && !failure && settledMs !== null && settledMs !== undefined) {
      throw new Error(`${key}: timing without an attempt outcome`);
    }
    if (failure && settledMs !== null && settledMs !== undefined) {
      throw new Error(`${key}: a failed read has no settled answer time`);
    }
    if (!sampleFile && !failure) continue;

    let exact = false;
    if (sampleFile) {
      const sample = validateSample(loadSample(sampleFile));
      if (typeof sample.sampleId !== "string" || !sample.sampleId) {
        throw new Error(`${key}: sampleId is missing`);
      }
      if (sampleIds.has(sample.sampleId)) throw new Error(`${key}: reused sampleId`);
      sampleIds.add(sample.sampleId);
      const inkFingerprint = JSON.stringify(sample.strokes.map(({ width, points }) => ({ width, points })));
      if (inkFingerprints.has(inkFingerprint)) throw new Error(`${key}: reused stroke geometry`);
      inkFingerprints.add(inkFingerprint);
      const [expression, expected] = MATRIX[row - 1];
      if (compareRead(sample.intendedExpression, expression).exactRead === false) {
        throw new Error(`${key}: exported ground truth does not match matrix row`);
      }
      const first = sample.firstRead;
      if (!first || typeof first.rawText !== "string") {
        throw new Error(`${key}: exported first read is missing`);
      }
      if (row === 7 && (first.result?.kind === "value" ||
          (first.result?.kind === "undefined" && first.result.reason !== "division_by_zero"))) {
        zeroDivisionUnsafe.push(key);
      }
      if (first.result?.kind !== "value" && first.result?.kind !== "undefined" &&
          settledMs !== null && settledMs !== undefined) {
        throw new Error(`${key}: no answer was shown; settledMs must be null`);
      }
      const read = compareRead(first.rawText, expression);
      const omittedBox = first.boxes?.some((box) =>
        !box.text.trim() && !!box.unmaskedText?.trim()) ?? false;
      exact = !omittedBox && read.exactRead &&
        first.normalizedText === compareRead(expression, expression).normalizedRead &&
        resultMatches(first.result, expected);
      const model = sample.model;
      if (model?.id !== MODEL.id ||
          model.decoder !== MODEL.decoder ||
          model.detector?.id !== MODEL.detector.id ||
          model.detector?.archiveSha256 !== MODEL.detector.archiveSha256 ||
          model.recognizer?.id !== MODEL.recognizer.id ||
          model.recognizer?.archiveSha256 !== MODEL.recognizer.archiveSha256) {
        throw new Error(`${key}: exported model does not match the frozen model/decoder pins`);
      }
    }
    results.set(key, exact);
    if (settledMs === null || settledMs === undefined) missingTimings.push(key);
    else latencies.push(settledMs);
  }
  const missing = SESSIONS.flatMap((session) => MATRIX.map((_, index) =>
    `${session}-${String(index + 1).padStart(2, "0")}`)).filter((key) => !results.has(key));
  const hits = [...results.values()].filter(Boolean).length;
  const misses = [...results].filter(([, exact]) => !exact).map(([key]) => key);
  const knownFailureHits = SESSIONS.flatMap((session) => [11, 12, 13, 14]
    .map((row) => results.get(`${session}-${row}`))).filter(Boolean).length;
  const categories = Object.fromEntries(Object.entries(CATEGORIES).map(([name, rows]) => [
    name,
    SESSIONS.flatMap((session) => rows.map((row) =>
      results.get(`${session}-${String(row).padStart(2, "0")}`))).filter(Boolean).length,
  ]));
  const sorted = latencies.sort((a, b) => a - b);
  const warmP95Ms = sorted.length === 60 ? sorted[Math.ceil(0.95 * sorted.length) - 1] : null;
  return {
    completed: results.size,
    hits,
    knownFailureHits,
    categories,
    warmP95Ms,
    missingTimings,
    missingMetadata,
    zeroDivisionUnsafe,
    missing,
    misses,
    model: sampleIds.size ? MODEL : null,
    thresholdsMet: missingMetadata.length === 0 && results.size === 60 &&
      hits >= 51 && knownFailureHits === 12 &&
      Object.values(categories).every((count) => count >= 5) &&
      warmP95Ms !== null && warmP95Ms <= 3000 && zeroDivisionUnsafe.length === 0,
  };
}

function main() {
  if (process.argv[2] === "--template") {
    if (process.argv.length !== 4) {
      throw new Error("Usage: node scripts/score-benchmark.mjs --template <private-manifest.json>");
    }
    const file = resolve(process.argv[3]);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(template(), null, 2)}\n`, { flag: "wx" });
    console.log(`Created ${file}`);
    return;
  }
  if (process.argv.length !== 3) {
    throw new Error("Usage: node scripts/score-benchmark.mjs <private-manifest.json> | --template <path>");
  }
  const file = resolve(process.argv[2]);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const report = scoreBenchmark(manifest, (sampleFile) =>
    JSON.parse(readFileSync(resolve(dirname(file), sampleFile), "utf8")));
  console.log(JSON.stringify(report, null, 2));
  console.log("Fresh ink, named-device timing, and physical-device gates require separate review.");
  if (!report.thresholdsMet) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
