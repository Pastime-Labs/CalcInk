import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const DEFAULT_PREVIEW = "http://127.0.0.1:4173";
const MAX_STROKES = 256;
const MAX_POINTS = 20_000;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateSample(sample) {
  if (!object(sample) || sample.schemaVersion !== 1) {
    throw new Error("Sample must have schemaVersion: 1");
  }
  if (typeof sample.intendedExpression !== "string" ||
      !sample.intendedExpression.trim() || sample.intendedExpression.length > 512) {
    throw new Error("Sample needs a nonempty intendedExpression (max 512 characters)");
  }
  if (!Array.isArray(sample.strokes) ||
      sample.strokes.length === 0 || sample.strokes.length > MAX_STROKES) {
    throw new Error(`Sample needs 1-${MAX_STROKES} line strokes`);
  }
  let points = 0;
  const ids = new Set();
  for (const stroke of sample.strokes) {
    if (!object(stroke) || typeof stroke.id !== "string" ||
        !stroke.id || stroke.id.length > 128 || ids.has(stroke.id) ||
        !finite(stroke.width) || stroke.width <= 0 || stroke.width > 128 ||
        !Array.isArray(stroke.points) || stroke.points.length === 0) {
      throw new Error("Sample has an invalid stroke");
    }
    ids.add(stroke.id);
    points += stroke.points.length;
    if (points > MAX_POINTS) throw new Error(`Sample exceeds ${MAX_POINTS} points`);
    for (const point of stroke.points) {
      if (!object(point) || !finite(point.x) || !finite(point.y) ||
          (point.pressure !== undefined &&
            (!finite(point.pressure) || point.pressure < 0 || point.pressure > 1)) ||
          (point.t !== undefined && (!finite(point.t) || point.t < 0))) {
        throw new Error("Sample has an invalid point");
      }
    }
  }
  return sample;
}

function normalizeNotation(text) {
  return text.replaceAll(" ", "").replaceAll("×", "*")
    .replaceAll("÷", "/").replaceAll("−", "-");
}

export function compareRead(rawText, intendedExpression) {
  const normalizedRead = normalizeNotation(rawText);
  return {
    normalizedRead,
    exactRead: normalizedRead === normalizeNotation(intendedExpression),
  };
}

export function previewUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash) {
    throw new Error("Preview URL must be a local HTTP origin, such as http://127.0.0.1:4173");
  }
  return url;
}

async function builtWorkerPath() {
  const directory = new URL("../dist/assets/", import.meta.url);
  let files;
  try {
    files = await readdir(directory);
  } catch {
    throw new Error("Production build missing; run npm run build first");
  }
  const workers = files.filter((file) => /^recognition\.worker-[\w-]+\.js$/.test(file));
  if (workers.length !== 1) {
    throw new Error("Expected exactly one built recognition Worker in dist/assets; rebuild the app");
  }
  return `/assets/${workers[0]}`;
}

async function replay(preview, workerPath, strokes) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== preview.origin) {
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.route(preview.href, (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>CalcInk fixture replay</title>",
    }));
    await page.goto(preview.href);
    return await page.evaluate(async ({ workerPath, strokes }) => {
      const worker = new Worker(workerPath, { type: "module" });
      function exchange(message) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Recognition Worker timed out"));
          }, 180_000);
          const onMessage = (event) => {
            if (event.data.requestId !== message.requestId) return;
            cleanup();
            resolve(event.data);
          };
          const onError = (event) => {
            cleanup();
            reject(new Error(event.message || "Recognition Worker failed"));
          };
          function cleanup() {
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
          }
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.postMessage(message);
        });
      }
      try {
        const ready = await exchange({ type: "init", requestId: 1 });
        if (ready.type !== "ready") {
          throw new Error(`Recognition Worker initialization failed: ${ready.code}`);
        }
        const result = await exchange({
          type: "recognize",
          requestId: 2,
          pageId: "fixture-replay",
          lineId: "fixture-line",
          canvasRevisionId: 1,
          strokes,
        });
        if (result.type !== "result") {
          throw new Error(`Recognition Worker failed: ${result.code}`);
        }
        return {
          modelId: ready.modelId,
          decoderId: ready.decoderId,
          modelLoadMs: ready.elapsedMs,
          result,
        };
      } finally {
        worker.terminate();
      }
    }, { workerPath, strokes });
  } finally {
    await browser.close();
  }
}

async function main() {
  const [file, suppliedUrl, extra] = process.argv.slice(2);
  if (!file || extra) {
    throw new Error("Usage: npm run replay:fixture -- <sample.json> [local-preview-url]");
  }
  const preview = previewUrl(suppliedUrl ?? process.env.CALCINK_PREVIEW_URL ?? DEFAULT_PREVIEW);
  const sample = validateSample(JSON.parse(await readFile(file, "utf8")));
  const workerPath = await builtWorkerPath();
  const { modelId, decoderId, modelLoadMs, result } = await replay(preview, workerPath, sample.strokes);
  const { rawText, unmaskedRawText, boxes, detMs, recMs, elapsedMs, raster } = result;
  const { normalizedRead, exactRead } = compareRead(rawText, sample.intendedExpression);
  console.log(JSON.stringify({
    intendedExpression: sample.intendedExpression,
    rawText,
    unmaskedRawText,
    normalizedRead,
    exactRead,
    boxes,
    detMs,
    recMs,
    elapsedMs,
    modelId,
    decoderId,
    modelLoadMs,
    raster,
  }, null, 2));
  if (!exactRead) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Fixture replay failed: ${error.message}`);
    process.exitCode = 2;
  });
}
