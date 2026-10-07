import { expect, test } from "@playwright/test";
import { createNotebook } from "./notebook";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

test("mobile canvas stays DPR-sized and a cancelled touch does not save ink", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stroke eraser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pixel eraser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.locator("#more-button").click();
  await expect(page.locator("#pen-only-mode")).not.toBeChecked();
  await page.locator("#more-button").click();

  const dimensions = await page.locator("#drawing-surface").evaluate((surface) => {
    const paper = surface.closest(".paper");
    if (!paper) throw new Error("Paper is missing");
    return [...paper.querySelectorAll("canvas")].map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      expectedWidth: Math.round(paper.clientWidth * devicePixelRatio),
      expectedHeight: Math.round(paper.clientHeight * devicePixelRatio),
    }));
  });
  expect(dimensions).toHaveLength(3);
  expect(dimensions.every(({ width, height, expectedWidth, expectedHeight }) =>
    width === expectedWidth && height === expectedHeight)).toBe(true);

  const bounds = await page.locator("#drawing-surface").boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  const x = bounds.x + 100;
  const y = bounds.y + 140;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 35, y: y + 35 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.touchscreen.tap(x, y);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
});
