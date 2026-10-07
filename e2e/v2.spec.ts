import { expect, test, type Page } from "@playwright/test";
import { PAGE_WIDTH } from "../src/canvas/types";
import { createNotebook, reloadNotebook } from "./notebook";

const referenceColors = [
  "#121619", "#84898c", "#d9ddde", "#ffffff",
  "#2186df", "#ed3152", "#2fc477", "#f2c638",
];

async function drawMouseStroke(page: Page): Promise<void> {
  const bounds = await page.locator("#drawing-surface").boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  await page.mouse.move(bounds.x + 80, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 120, bounds.y + 125, { steps: 5 });
  await page.mouse.up();
}

async function activeStoredPage(page: Page): Promise<{
  geometry?: string;
  template?: string;
  strokes: { color?: string; style?: string; points: { x: number; y: number }[] }[];
}> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("calcink");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["meta", "pageRecords"], "readonly");
      const id = await new Promise<string>((resolve, reject) => {
        const request = tx.objectStore("meta").get("activePageId");
        request.onsuccess = () => resolve(request.result as string);
        request.onerror = () => reject(request.error);
      });
      return await new Promise<{
        geometry?: string;
        template?: string;
        strokes: { color?: string; style?: string; points: { x: number; y: number }[] }[];
      }>((resolve, reject) => {
        const request = tx.objectStore("pageRecords").get(id);
        request.onsuccess = () => resolve(request.result.page);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test("A4 sizing, pencil ink, templates, and inserted page order survive reload", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await expect(page.locator("#page-position")).toHaveText("1 / 1");
  const zoomSlider = page.getByRole("slider", { name: "Page zoom" });
  await expect(zoomSlider).toBeEnabled();

  const fitted = await page.locator("#paper").evaluate((paper) => {
    const { width, height } = paper.getBoundingClientRect();
    return { width, height };
  });
  expect(fitted.width / fitted.height).toBeCloseTo(210 / 297, 2);
  const fittedPercent = Math.round(fitted.width / PAGE_WIDTH * 100);
  await expect(zoomSlider).toHaveValue(String(fittedPercent));
  await expect(page.locator("#zoom-value")).toHaveText(`${fittedPercent}%`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("#paper").evaluate(
    (paper) => paper.getBoundingClientRect().width,
  )).toBeLessThanOrEqual(366);
  const narrowWidth = await page.locator("#paper").evaluate(
    (paper) => paper.getBoundingClientRect().width,
  );
  await expect(zoomSlider).toHaveValue(String(Math.round(narrowWidth / PAGE_WIDTH * 100)));
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.locator("#paper").evaluate(
    (paper) => paper.getBoundingClientRect().width,
  )).toBeCloseTo(fitted.width, 0);

  await page.locator("#color-menu-button").click();
  await page.locator("#color-black").click();
  await page.locator("#color-menu-button").click();
  await expect(page.locator("#color-warning")).toBeVisible();
  await page.locator("#color-white").click();
  await page.locator("#color-menu-button").click();
  await expect(page.locator("#color-warning")).toBeHidden();
  await page.locator("#color-blue").click();
  await page.locator("#pencil-tool").click();
  await drawMouseStroke(page);
  await expect(page.locator("#undo-button")).toBeEnabled();
  await page.locator("#paper-template").click();
  await expect(page.locator("#template-menu")).toBeVisible();
  await page.locator("#template-option-grid").click();
  await expect(page.locator("#template-menu")).toBeHidden();
  await expect(page.locator("#paper")).toHaveAttribute("data-template", "grid");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await reloadNotebook(page);
  await expect(page.locator("#paper-template")).toContainText("Grid");
  await page.locator("#paper-template").click();
  await expect(page.locator("#template-option-grid")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#paper")).toHaveAttribute("data-template", "grid");
  expect(await activeStoredPage(page)).toMatchObject({
    geometry: "a4",
    template: "grid",
    strokes: [{ color: "#2186df", style: "pencil" }],
  });

  await expect(page.locator("#corner-reveal")).toHaveCount(0);
  await expect(page.locator("#corner-new-page")).toHaveCount(0);
  await page.locator("#quick-new-page").click();
  await expect(page.locator("#page-position")).toHaveText("2 / 2");
  await expect(page.locator(".notebook-page")).toHaveCount(2);
  await page.locator("#prev-page").click();
  await expect(page.locator("#page-position")).toHaveText("1 / 2");
  await page.locator("#quick-new-page").click();
  await expect(page.locator("#page-position")).toHaveText("2 / 3");
  await page.locator("#next-page").click();
  await expect(page.locator("#page-position")).toHaveText("3 / 3");
  await page.locator("#prev-page").click();
  await expect(page.locator("#page-position")).toHaveText("2 / 3");
  await reloadNotebook(page);
  await expect(page.locator("#page-position")).toHaveText("2 / 3");
});

test("notebook zoom slider supports keyboard input and narrow phones", async ({ page }) => {
  await createNotebook(page);
  const slider = page.getByRole("slider", { name: "Page zoom" });
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("200");
  await expect(page.locator("#zoom-value")).toHaveText("200%");
  await expect.poll(() => page.locator("#paper").evaluate(
    (paper) => paper.getBoundingClientRect().width,
  )).toBeCloseTo(PAGE_WIDTH * 2, 0);

  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("25");
  await expect(page.locator("#zoom-value")).toHaveText("25%");
  await expect.poll(() => page.locator("#paper").evaluate(
    (paper) => paper.getBoundingClientRect().width,
  )).toBeCloseTo(PAGE_WIDTH / 4, 0);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const selector of [".page-stepper", ".zoom-control", "#zoom-slider"]) {
      const bounds = await page.locator(selector).boundingBox();
      if (!bounds) throw new Error(`${selector} is not visible`);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await expect(slider).toHaveValue("25");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#home-button").click();
  await page.getByRole("button", { name: /^Open / }).click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(slider).not.toHaveValue("25");
  const reopenedWidth = await page.locator("#paper").evaluate(
    (paper) => paper.getBoundingClientRect().width,
  );
  await expect(slider).toHaveValue(String(Math.round(reopenedWidth / PAGE_WIDTH * 100)));
});

test("reference color picker selects ink and dismisses predictably", async ({ page }) => {
  await createNotebook(page);
  const trigger = page.locator("#color-menu-button");
  const picker = page.locator("#color-panel");
  await expect(trigger).toBeEnabled();
  await page.locator('[data-tool="stroke-eraser"]').click();
  await trigger.click();
  await expect(picker).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#color-black")).toBeFocused();
  expect(await picker.locator("[data-color]").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-color")))).toEqual(referenceColors);

  const triggerBox = await trigger.boundingBox();
  const pickerBox = await picker.boundingBox();
  if (!triggerBox || !pickerBox) throw new Error("Color controls are not visible");
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
  expect(pickerBox.x).toBeLessThan(triggerBox.x + triggerBox.width);
  expect(pickerBox.x + pickerBox.width).toBeGreaterThan(triggerBox.x);

  await page.locator('#color-panel [data-color="#ed3152"]').click();
  await expect(picker).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute("aria-pressed", "true");
  await trigger.click();
  await expect(page.locator('#color-panel [data-color="#ed3152"]'))
    .toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await page.locator("#page-title").click();
  await expect(picker).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.locator('[data-tool="stroke-eraser"]').click();
  await trigger.click();
  await page.locator("#color-custom-toggle").click();
  await expect(page.locator("#color-custom-panel")).toBeVisible();
  const colorBeforeHue = await page.locator("#color-custom").inputValue();
  const previewBeforeHue = await page.locator("#color-custom-preview").evaluate(
    (preview) => getComputedStyle(preview).backgroundColor,
  );
  await page.locator("#color-hue").focus();
  await page.keyboard.press("ArrowRight");
  const colorAfterHue = await page.locator("#color-custom").inputValue();
  expect(colorAfterHue).toMatch(/^#[0-9a-f]{6}$/i);
  expect(colorAfterHue).not.toBe(colorBeforeHue);
  expect(await page.locator("#color-custom-preview").evaluate(
    (preview) => getComputedStyle(preview).backgroundColor,
  )).not.toBe(previewBeforeHue);
  await page.locator("#color-custom").fill("#nothex");
  await page.locator("#color-custom-apply").click();
  await expect(page.locator("#color-custom-panel")).toBeVisible();
  await expect(page.locator("#color-custom-error")).toBeVisible();
  await page.locator("#color-custom").fill("#7654ab");
  await page.locator("#color-custom-apply").click();
  await expect(picker).toBeHidden();
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute("aria-pressed", "true");
  await drawMouseStroke(page);
  await expect.poll(async () => (await activeStoredPage(page)).strokes[0]?.color)
    .toBe("#7654ab");
});

test("color picker fits narrow phone viewports", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#color-menu-button")).toBeEnabled();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator("#color-menu-button").click();
    const picker = page.locator("#color-panel");
    await expect(picker).toBeVisible();
    const box = await picker.boundingBox();
    if (!box) throw new Error("Color picker is not visible");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(picker.locator("[data-color]").last()).toBeInViewport();
    await page.locator("#color-custom-toggle").click();
    const customPanel = page.locator("#color-custom-panel");
    await expect(customPanel).toBeVisible();
    const customBox = await customPanel.boundingBox();
    if (!customBox) throw new Error("Custom color picker is not visible");
    expect(customBox.x).toBeGreaterThanOrEqual(0);
    expect(customBox.y).toBeGreaterThanOrEqual(0);
    expect(customBox.x + customBox.width).toBeLessThanOrEqual(viewport.width);
    expect(customBox.y + customBox.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator("#color-custom")).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();

    await page.locator("#paper-template").click();
    const templateMenu = page.locator("#template-menu");
    await expect(templateMenu).toBeVisible();
    const templateBox = await templateMenu.boundingBox();
    if (!templateBox) throw new Error("Template menu is not visible");
    expect(templateBox.x).toBeGreaterThanOrEqual(0);
    expect(templateBox.y).toBeGreaterThanOrEqual(0);
    expect(templateBox.x + templateBox.width).toBeLessThanOrEqual(viewport.width);
    expect(templateBox.y + templateBox.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator("#template-option-grid")).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(templateMenu).toBeHidden();
  }
});

test("mobile drawing dock keeps every control on screen", async ({ page }) => {
  await createNotebook(page);
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.locator(".bottom-toolbar").evaluate((dock) => {
      const toolbar = dock.querySelector<HTMLElement>(".toolbar");
      const workspace = document.querySelector<HTMLElement>("#workspace");
      if (!toolbar || !workspace) throw new Error("Missing drawing layout");
      const controls = [...dock.querySelectorAll<HTMLElement>(
        ".tool-button, #pen-width, #color-menu-button, #paper-template",
      )].map((control) => {
        const rect = control.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      const bounds = dock.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
        overflow: toolbar.scrollWidth - toolbar.clientWidth,
        paddingBottom: Number.parseFloat(getComputedStyle(workspace).paddingBottom),
        controls,
        penTop: dock.querySelector<HTMLElement>('[data-tool="pen"]')!.getBoundingClientRect().top,
        templateTop: dock.querySelector<HTMLElement>("#paper-template")!.getBoundingClientRect().top,
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(width);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(844);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.controls.every(({ left, right }) => left >= 0 && right <= width)).toBe(true);
    expect(layout.templateTop).toBeGreaterThan(layout.penTop);
    expect(layout.paddingBottom).toBeGreaterThan(layout.height);
  }
});

test.describe("touchscreen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("pen-only mode routes touch away from ink but keeps mouse drawing", async ({ page }) => {
    await createNotebook(page);
    await expect(page.locator("#save-status")).toHaveText("Saved on this device");
    await page.locator("#more-button").click();
    await page.locator("#pen-only-mode").check();
    const bounds = await page.locator("#drawing-surface").boundingBox();
    if (!bounds) throw new Error("Drawing surface is not visible");
    await page.touchscreen.tap(bounds.x + 80, bounds.y + 100);
    await expect(page.locator("#undo-button")).toBeDisabled();
    await drawMouseStroke(page);
    await expect(page.locator("#undo-button")).toBeEnabled();
    await reloadNotebook(page);
    await page.locator("#more-button").click();
    await expect(page.locator("#pen-only-mode")).toBeChecked();
  });
});

test("lasso move and delete are undoable whole-stroke edits", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await drawMouseStroke(page);
  const original = (await activeStoredPage(page)).strokes[0].points[0];
  const bounds = await page.locator("#drawing-surface").boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  const select = async () => {
    await page.mouse.move(bounds.x + 60, bounds.y + 80);
    await page.mouse.down();
    for (const [x, y] of [[145, 80], [145, 155], [60, 155], [60, 80]]) {
      await page.mouse.move(bounds.x + x, bounds.y + y);
    }
    await page.mouse.up();
  };

  await page.locator("#lasso-tool").click();
  await select();
  await expect(page.locator("#lasso-actions")).toBeVisible();
  await page.locator("#lasso-move").click();
  await page.mouse.move(bounds.x + 180, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 210, bounds.y + 240, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await activeStoredPage(page)).strokes[0].points[0].x)
    .toBeGreaterThan(original.x);
  await page.locator("#undo-button").click();
  await expect.poll(async () => (await activeStoredPage(page)).strokes[0].points[0].x)
    .toBe(original.x);

  await select();
  await page.locator("#lasso-delete").click();
  await expect.poll(async () => (await activeStoredPage(page)).strokes.length).toBe(0);
  await page.locator("#undo-button").click();
  await expect.poll(async () => (await activeStoredPage(page)).strokes.length).toBe(1);
});

test("print layout keeps world-sized ink backing on an A4 sheet", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".topbar")).toBeHidden();
  const sheet = await page.locator("#paper").evaluate((paper) => {
    const rect = paper.getBoundingClientRect();
    const canvas = paper.querySelector<HTMLCanvasElement>("#ink-canvas");
    return { width: rect.width, height: rect.height, backingWidth: canvas?.width, backingHeight: canvas?.height };
  });
  expect(sheet.width / sheet.height).toBeCloseTo(210 / 297, 2);
  expect(sheet.backingWidth).toBe(840);
  expect(sheet.backingHeight).toBe(1188);
});
