import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("production OCR uses only local app, model, and runtime assets", async ({ page, context }) => {
  test.setTimeout(150_000);
  const requests: string[] = [];
  const responses: Array<{ url: URL; status: number; fromServiceWorker: boolean }> = [];
  context.on("request", (request) => requests.push(request.url()));
  context.on("response", (response) => {
    responses.push({
      url: new URL(response.url()),
      status: response.status(),
      fromServiceWorker: response.fromServiceWorker(),
    });
  });

  await page.goto("/");
  const localOrigin = new URL(page.url()).origin;
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready", {
    timeout: 90_000,
  });

  const surface = page.locator("#drawing-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  await page.mouse.move(bounds.x + 120, bounds.y + 140);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 156, bounds.y + 168, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Readback" }).click();
  await expect(page.locator("#export-sample")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready");

  const networkRequests = requests.filter((url) => /^https?:/.test(url));
  expect(networkRequests.length).toBeGreaterThan(0);
  expect(
    networkRequests.filter((url) => new URL(url).origin !== localOrigin),
    "all observed HTTP requests must stay on the preview origin",
  ).toEqual([]);

  const loaded = responses.filter(
    (response) => response.status === 200 && !response.fromServiceWorker,
  );
  const required: Array<[string, (url: URL) => boolean]> = [
    ["app shell", (url) => url.pathname === "/"],
    ["app script", (url) => /^\/assets\/index-[^/]+\.js$/.test(url.pathname)],
    ["app stylesheet", (url) => /^\/assets\/index-[^/]+\.css$/.test(url.pathname)],
    ["app Worker", (url) => /^\/assets\/recognition\.worker-[^/]+\.js$/.test(url.pathname)],
    ["PaddleOCR Worker", (url) => /^\/assets\/worker-entry-[^/]+\.js$/.test(url.pathname)],
    ["detector", (url) => url.pathname.endsWith("/PP-OCRv6_tiny_det_onnx_infer.tar")],
    ["recognizer", (url) => url.pathname.endsWith("/PP-OCRv6_tiny_rec_onnx_infer.tar")],
    ["ONNX Runtime module", (url) => url.pathname.endsWith("/ort-wasm-simd-threaded.jsep.mjs")],
    ["ONNX Runtime WASM", (url) => url.pathname.endsWith("/ort-wasm-simd-threaded.jsep.wasm")],
  ];
  for (const [name, matches] of required) {
    expect(loaded.some(({ url }) => matches(url)), `${name} was not loaded directly`).toBe(true);
  }
});
