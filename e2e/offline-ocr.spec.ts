import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { RecognitionResponse } from "../src/worker/protocol";
import { createNotebook, reloadNotebook } from "./notebook";

async function openReadback(page: Page): Promise<void> {
  await page.locator("#more-button").click();
  await page.locator("#readback-button").click();
}

async function savedPageRecords(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const opening = indexedDB.open("calcink");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction("pageRecords", "readonly").objectStore("pageRecords").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(JSON.stringify(request.result)); };
    };
  }));
}

async function drawPath(page: Page, points: Array<[number, number]>): Promise<void> {
  const surface = page.locator("#drawing-surface");
  await surface.scrollIntoViewIfNeeded();
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  await page.mouse.move(bounds.x + points[0][0], bounds.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    await page.mouse.move(bounds.x + x, bounds.y + y, { steps: 4 });
  }
  await page.mouse.up();
}

test("cached model runs a fresh OCR request after offline reload", async ({ page, context }) => {
  const offlineAssets: Array<{ url: string; status: number; fromServiceWorker: boolean }> = [];
  page.on("response", (response) => {
    if (/models\/paddle|paddle-ort|recognition\.worker|worker-entry/.test(response.url())) {
      offlineAssets.push({
        url: response.url(),
        status: response.status(),
        fromServiceWorker: response.fromServiceWorker(),
      });
    }
  });

  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", { timeout: 90_000 });
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready", { timeout: 90_000 });

  const workerUrl = page.workers().find((worker) => /recognition\.worker-.*\.js/.test(worker.url()))?.url();
  expect(workerUrl, "production app Worker is loaded").toBeTruthy();

  const cachedModels = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cacheName = cacheNames.find((name) => name.startsWith("workbox-precache"));
    if (!cacheName) return [];
    const cache = await caches.open(cacheName);
    const files = [
      "PP-OCRv6_tiny_det_onnx_infer.tar?v=ff6ab415",
      "PP-OCRv6_tiny_rec_onnx_infer.tar?v=1e13b227",
    ];
    return Promise.all(files.map(async (file) => {
      const url = new URL(`/models/paddle/${file}`, location.href).href;
      const response = await cache.match(url);
      return { url, status: response?.status, bytes: response ? (await response.arrayBuffer()).byteLength : 0 };
    }));
  });
  expect(cachedModels).toHaveLength(2);
  for (const model of cachedModels) {
    expect(model.status, model.url).toBe(200);
    expect(model.bytes, model.url).toBeGreaterThan(0);
  }

  offlineAssets.length = 0;
  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready", { timeout: 90_000 });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const responses = await page.evaluate(async (url): Promise<RecognitionResponse[]> => {
    const worker = new Worker(url, { type: "module" });
    const messages: RecognitionResponse[] = [];
    const receive = (requestId: number) => new Promise<RecognitionResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OCR Worker did not respond")), 60_000);
      worker.onmessage = (event: MessageEvent<RecognitionResponse>) => {
        messages.push(event.data);
        if (event.data.requestId !== requestId) return;
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message));
      };
    });
    try {
      const ready = receive(1);
      worker.postMessage({ type: "init", requestId: 1 });
      if ((await ready).type !== "ready") return messages;

      const result = receive(2);
      worker.postMessage({
        type: "recognize",
        requestId: 2,
        pageId: "offline-page",
        lineId: "synthetic-line",
        canvasRevisionId: 7,
        // A square tests the actual pipeline, not recognition accuracy.
        strokes: [{
          id: "square",
          width: 4,
          points: [
            { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 30, y: 40 },
            { x: 30, y: 10 }, { x: 10, y: 10 },
          ],
        }],
      });
      await result;
      return messages;
    } finally {
      worker.terminate();
    }
  }, workerUrl!);

  expect(responses[0]).toMatchObject({ type: "ready", requestId: 1 });
  expect(responses[1]).toMatchObject({
    type: "result",
    requestId: 2,
    pageId: "offline-page",
    lineId: "synthetic-line",
    canvasRevisionId: 7,
  });
  if (responses[1]?.type === "result") {
    expect(Array.isArray(responses[1].boxes)).toBe(true);
    expect(Number.isFinite(responses[1].elapsedMs)).toBe(true);
    expect(responses[1].raster.width).toBeGreaterThan(0);
  }

  for (const asset of offlineAssets) {
    expect(asset.status, asset.url).toBe(200);
    expect(asset.fromServiceWorker, asset.url).toBe(true);
  }
  expect(offlineAssets.some((asset) => asset.url.includes("PP-OCRv6_tiny_det"))).toBe(true);
  expect(offlineAssets.some((asset) => asset.url.includes("PP-OCRv6_tiny_rec"))).toBe(true);
  expect(offlineAssets.some((asset) => asset.url.includes("ort-wasm-simd-threaded.jsep.wasm"))).toBe(true);
});

test("offline retry repairs a model without losing pages or creating an update loop", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", { timeout: 90_000 });
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const pagesBefore = await savedPageRecords(page);

  const removed = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) => name.startsWith("workbox-precache"));
    if (!cacheName) return false;
    const cache = await caches.open(cacheName);
    const model = (await cache.keys()).find((request) =>
      request.url.includes("PP-OCRv6_tiny_rec_onnx_infer.tar"));
    return model ? cache.delete(model) : false;
  });
  expect(removed).toBe(true);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline setup is incomplete");
  await expect(page.locator("#offline-status")).toBeVisible();
  await expect(page.locator("#retry-offline")).toBeVisible();

  await context.setOffline(true);
  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toContainText("Reconnect before retrying");
  await reloadNotebook(page);
  await expect(page.locator("#page-title")).toHaveText("Page 1");
  expect(await savedPageRecords(page)).toBe(pagesBefore);

  await context.setOffline(false);
  await context.route(/PP-OCRv6_tiny_rec.*repair=/, (route) => route.abort());
  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toContainText("Offline setup failed");
  expect(await savedPageRecords(page)).toBe(pagesBefore);
  await context.unrouteAll();

  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.");
  expect(await savedPageRecords(page)).toBe(pagesBefore);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.");
  await expect(page.locator("#update-button")).toBeHidden();

  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#page-title")).toHaveText("Page 1");
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  await expect(page.locator("#recognition-status")).toContainText("Recognition ready");
  expect(await savedPageRecords(page)).toBe(pagesBefore);
});

test("retry reinstalls a missing revisioned precache key", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", { timeout: 90_000 });
  const pagesBefore = await savedPageRecords(page);
  const removed = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) => name.startsWith("workbox-precache"));
    if (!cacheName) return false;
    const cache = await caches.open(cacheName);
    const icon = (await cache.keys()).find((request) => new URL(request.url).pathname.endsWith("/icon.svg"));
    return icon ? cache.delete(icon) : false;
  });
  expect(removed).toBe(true);

  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline setup is incomplete");
  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });
  expect(await savedPageRecords(page)).toBe(pagesBefore);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("An update is available");
  await page.locator("#update-button").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.");
  await expect(page.locator("#update-button")).toBeHidden();

  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#page-title")).toHaveText("Page 1");
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  expect(await savedPageRecords(page)).toBe(pagesBefore);
});

test("retry reinstalls when the whole precache is missing", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });
  const pagesBefore = await savedPageRecords(page);
  const removed = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) => name.startsWith("workbox-precache"));
    return cacheName ? caches.delete(cacheName) : false;
  });
  expect(removed).toBe(true);

  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline setup is incomplete");
  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });
  expect(await savedPageRecords(page)).toBe(pagesBefore);

  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  await expect(page.locator("#page-title")).toHaveText("Page 1");
  expect(await savedPageRecords(page)).toBe(pagesBefore);
});

test("retry restores a missing offline asset list", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });
  const cacheName = await page.evaluate(async () => {
    const name = (await caches.keys()).find((value) => value.startsWith("workbox-precache"));
    if (!name) return null;
    const cache = await caches.open(name);
    const key = (await cache.keys()).find((request) =>
      new URL(request.url).pathname.endsWith("/offline-assets.json"));
    return key && await cache.delete(key) ? name : null;
  });
  expect(cacheName).not.toBeNull();

  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline setup is incomplete");
  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });

  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
});

test("missing hashed bundle chunk is not masked by another cache and can be repaired", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", { timeout: 90_000 });
  const pagesBefore = await savedPageRecords(page);
  const removed = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) => name.startsWith("workbox-precache"));
    if (!cacheName) return false;
    const cache = await caches.open(cacheName);
    const listResponse = await cache.match(new URL("/offline-assets.json", location.href), {
      ignoreSearch: true,
    });
    if (!listResponse) return false;
    const list = await listResponse.json() as { assets: string[] };
    const font = list.assets.find((asset) => asset.endsWith(".woff2"));
    if (!font) return false;
    const key = (await cache.keys()).find((request) =>
      new URL(request.url).pathname.endsWith(`/${font}`));
    if (!key || !await cache.delete(key)) return false;
    await (await caches.open("calcink-decoy")).put(key, new Response("not an app precache entry"));
    return font;
  });
  expect(removed).toMatch(/\.woff2$/);

  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline setup is incomplete");
  await page.route(/\.woff2\?repair=/, (route) => route.abort());
  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toContainText("Offline setup failed");
  expect(await savedPageRecords(page)).toBe(pagesBefore);
  await page.unrouteAll();

  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.");
  const repaired = await page.evaluate(async (asset) => {
    const cacheName = (await caches.keys()).find((name) => name.startsWith("workbox-precache"));
    if (!cacheName) return false;
    const cache = await caches.open(cacheName);
    const response = await cache.match(new URL(asset, location.href));
    return response?.status === 200;
  }, removed);
  expect(repaired).toBe(true);
  expect(await savedPageRecords(page)).toBe(pagesBefore);
});

test("offline ink, correction, edit, page switch, and reload persist (not OCR accuracy)", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", { timeout: 90_000 });
  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#recognition-status")).toContainText("Recognition ready");

  const equation: Array<Array<[number, number]>> = [
    [[100, 150], [100, 190]],
    [[130, 150], [130, 190]],
    [[155, 170], [185, 170]],
    [[170, 155], [170, 185]],
    [[210, 150], [210, 190]],
    [[240, 150], [240, 190]],
    [[265, 161], [295, 161]],
    [[265, 179], [295, 179]],
  ];
  for (const path of equation) await drawPath(page, path);
  await openReadback(page);
  await expect(page.locator(".line-choice")).toHaveCount(1);
  await expect(page.locator(".line-choice small")).toHaveText(
    /^(Review read|No final = read|No text recognized|Needs review)$/,
    { timeout: 60_000 },
  );
  await page.locator("#correction-input").fill("11+11=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("22");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.locator("#close-readback").click();
  await drawPath(page, [[241, 190], [258, 190]]);
  await openReadback(page);
  await expect(page.locator("#line-result")).not.toContainText("corrected");
  await page.locator("#correction-input").fill("11+12=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("23");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.locator("#close-readback").click();
  await page.getByRole("button", { name: /Pages/ }).click();
  await page.locator("#new-page").click();
  await expect(page.locator("#drawing-surface")).toHaveCSS("pointer-events", "auto");
  await drawPath(page, [[110, 150], [145, 180]]);
  await openReadback(page);
  await expect(page.locator(".line-choice")).toHaveCount(1);
  await page.locator("#correction-input").fill("2+3=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("5");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.locator("#close-readback").click();
  await page.getByRole("button", { name: /Pages/ }).click();
  await expect(page.locator(".page-row")).toHaveCount(2);
  await page.locator('.page-row[data-active="false"] .page-switch').click();
  await openReadback(page);
  await expect(page.locator("#line-result")).toContainText("23");
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  await openReadback(page);
  await expect(page.locator("#line-result")).toContainText("23");
  await page.locator("#close-readback").click();
  await page.getByRole("button", { name: /Pages/ }).click();
  await page.locator('.page-row[data-active="false"] .page-switch').click();
  await openReadback(page);
  await expect(page.locator("#line-result")).toContainText("5");

  const records = JSON.parse(await savedPageRecords(page)) as Array<{
    page: { strokes: unknown[] };
    corrections: Record<string, string>;
  }>;
  expect(records).toHaveLength(2);
  expect(records.every((record) => record.page.strokes.length > 0)).toBe(true);
  expect(records.some((record) => Object.values(record.corrections).includes("11+12="))).toBe(true);
  expect(records.some((record) => Object.values(record.corrections).includes("2+3="))).toBe(true);
});

test("opt-in sample export preserves the first automatic read after correction", async ({ page }) => {
  test.setTimeout(120_000);
  await createNotebook(page);
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready", { timeout: 90_000 });
  await drawPath(page, [[120, 140], [156, 168]]);
  await openReadback(page);
  await expect(page.locator("#export-sample")).toBeVisible({ timeout: 60_000 });

  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("11+11=");
    else await dialog.accept();
  });
  const exportSample = async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-sample").click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error("Sample download has no local path");
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  };

  const first = await exportSample();
  expect(first).toMatchObject({
    schemaVersion: 1,
    intendedExpression: "11+11=",
    model: { id: "PP-OCRv6_tiny_det+rec", decoder: "ctc-mask-v2" },
  });
  expect(first.strokes).toBeInstanceOf(Array);
  expect((first.strokes as unknown[]).length).toBeGreaterThan(0);
  expect(first.firstRead).toMatchObject({
    rawText: expect.any(String),
    unmaskedRawText: expect.any(String),
  });

  await page.locator("#correction-input").fill("2+3=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("5");
  const second = await exportSample();
  expect(second.firstRead).toEqual(first.firstRead);
});
