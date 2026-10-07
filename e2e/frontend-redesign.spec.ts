import { expect, test, type Page } from "@playwright/test";
import { createNotebook, reloadNotebook } from "./notebook";

async function openReadback(page: Page): Promise<void> {
  await page.locator("#more-button").click();
  await page.locator("#readback-button").click();
}

test("More options owns Readback on desktop and narrow phones", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#pages-button")).toBeEnabled();

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);

    const more = page.locator("#more-button");
    const readbackItem = page.locator("#readback-button");
    await expect(readbackItem).toBeHidden();
    await expect(page.getByRole("button", { name: /^(Open readback|Search|Magnifier)$/i }))
      .toHaveCount(0);
    await expect(page.locator("#color-menu-button")).toBeVisible();
    await expect(page.locator("#color-panel")).toBeHidden();

    for (const selector of [
      "#pages-button",
      "#more-button",
      '[data-tool="pen"]',
      '[data-tool="stroke-eraser"]',
      '[data-tool="pixel-eraser"]',
      "#pen-width",
      "#undo-button",
      "#redo-button",
    ]) {
      const control = page.locator(selector);
      await expect(control).toBeVisible();
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    if (viewport.width > 700) {
      await expect(page.locator("#clear-button")).toBeVisible();
    } else {
      await expect(page.locator("#clear-button")).toBeHidden();
    }

    await page.locator("#pages-button").click();
    await expect(page.locator("#pages-dialog")).toBeVisible();
    await page.locator("#close-pages").click();

    await more.click();
    await expect(readbackItem).toBeVisible();
    await expect(readbackItem).toBeFocused();
    if (viewport.width <= 700) {
      await expect(page.locator("#clear-menu-button")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(readbackItem).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await page.locator("#workspace").click({ position: { x: 5, y: 5 } });
    await expect(readbackItem).toBeHidden();
    await expect(more).toHaveAttribute("aria-expanded", "false");

    await openReadback(page);
    await expect(page.locator("#readback-panel")).toBeVisible();
    await expect(page.locator("#readback-heading")).toBeFocused();
    await expect(page.locator("#readback-empty")).toBeVisible();
    await expect(page.locator(".line-choice")).toHaveCount(0);
    await expect(page.locator("#line-detail")).toBeHidden();
    await page.locator("#close-readback").click();
    await expect(page.locator("#readback-panel")).toBeHidden();
    await expect(more).toBeFocused();
  }
});

test("quick page creation keeps page count and titles in sync", async ({ page }) => {
  const expectActivePageCount = async () => {
    const rows = page.locator(".page-row");
    await expect(rows).toHaveCount(2);
    const activeIndex = await rows.evaluateAll(
      (items) => items.findIndex((item) => item.getAttribute("data-active") === "true"),
    );
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    await expect(page.locator("#page-position")).toHaveText(`${activeIndex + 1} / 2`);
  };

  await createNotebook(page);
  await expect(page.locator("#quick-new-page")).toBeEnabled();
  await expect(page.locator("#page-position")).toHaveText("1 / 1");

  await page.locator("#quick-new-page").click();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");

  await page.locator("#pages-button").click();
  await expectActivePageCount();
  const rename = page.locator('.page-row[data-active="true"] .page-rename-button');
  const remove = page.locator('.page-row[data-active="true"] .page-delete');
  await expect(rename).toContainText("Rename");
  await expect(rename).toHaveAttribute("aria-label", "Rename Untitled page");
  await expect(rename.locator("svg")).toBeVisible();
  await expect(remove).toContainText("Delete");
  await expect(remove).toHaveAttribute("aria-label", "Delete Untitled page");
  await expect(remove.locator("svg")).toBeVisible();
  await expect(page.locator(".pages-panel .panel-intro")).toContainText("Clearing site data removes them.");
  await expect(page.locator(".panel-foot")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(rename).toBeInViewport();
  await expect(remove).toBeInViewport();
  await page.locator('.page-row[data-active="true"] .page-rename-button').click();
  await page.locator(".page-rename").fill("Field notes");
  await page.locator(".page-rename").press("Enter");
  await expect(page.locator("#page-title")).toHaveText("Field notes");
  await expectActivePageCount();

  await page.locator('.page-row[data-active="false"] .page-switch').click();
  await expect(page.locator("#page-title")).toHaveText("Page 1");
  await page.locator("#pages-button").click();
  await expectActivePageCount();
});

test("clear asks first, cancel preserves ink, and undo restores a clear", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#clear-button")).toBeDisabled();
  const bounds = await page.locator("#drawing-surface").boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  await page.mouse.move(bounds.x + 120, bounds.y + 140);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 156, bounds.y + 168, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#clear-button")).toBeEnabled();

  await page.locator("#clear-button").click();
  await expect(page.locator("#clear-dialog")).toBeVisible();
  await page.locator("#cancel-clear").click();
  await expect(page.locator("#clear-dialog")).toBeHidden();
  await expect(page.locator("#clear-button")).toBeEnabled();

  await page.locator("#clear-button").click();
  await page.locator("#confirm-clear").click();
  await expect(page.locator("#clear-dialog")).toBeHidden();
  await expect(page.locator("#clear-button")).toBeDisabled();
  await page.locator("#undo-button").click();
  await expect(page.locator("#clear-button")).toBeEnabled();
});

test("blank paper and canvas buffers do not grow while idle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const dimensions = () => page.evaluate(() => {
    const paper = document.querySelector<HTMLElement>("#paper");
    if (!paper) throw new Error("Paper is missing");
    return {
      paperHeight: paper.getBoundingClientRect().height,
      canvases: ["ink-canvas", "answer-canvas", "draft-canvas"].map((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement | null;
        if (!canvas) throw new Error(`${id} is missing`);
        return { width: canvas.width, height: canvas.height };
      }),
    };
  });
  const before = await dimensions();
  await page.waitForTimeout(550);
  expect(await dimensions()).toEqual(before);
});

test("a corrected answer near the edge remains visible on a legacy page", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const initialWidth = await page.locator("#paper").evaluate((paper) => paper.getBoundingClientRect().width);

  await page.evaluate((paperWidth) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("calcink");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("pageRecords", "readwrite");
      const store = tx.objectStore("pageRecords");
      const request = store.getAll();
      request.onsuccess = () => {
        const record = request.result[0];
        if (!record) {
          tx.abort();
          return;
        }
        record.page.schemaVersion = 2;
        delete record.page.geometry;
        delete record.page.template;
        record.page.strokes = [{
          id: "edge-answer-fixture",
          width: 4,
          points: [
            { x: paperWidth - 32, y: 140 },
            { x: paperWidth - 20, y: 165 },
          ],
        }];
        record.page.updatedAt = Date.now();
        record.corrections = { '["edge-answer-fixture"]': "999999999999=" };
        store.put(record, record.page.id);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Could not seed edge answer")); };
    };
  }), initialWidth);

  await reloadNotebook(page);
  await openReadback(page);
  await expect(page.locator("#line-result")).toContainText("999999999999");
  await expect(page.locator("#line-result")).toContainText("corrected");

  const geometry = await page.evaluate(() => {
    const paper = document.querySelector<HTMLElement>("#paper");
    const canvas = document.querySelector<HTMLCanvasElement>("#answer-canvas");
    const workspace = document.querySelector<HTMLElement>("#workspace");
    if (!paper || !canvas || !workspace) throw new Error("Missing paper geometry");
    return {
      paperWidth: paper.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width,
      scrollWidth: workspace.scrollWidth,
      viewportWidth: workspace.clientWidth,
    };
  });
  expect(geometry.paperWidth).toBeGreaterThan(initialWidth + 100);
  expect(Math.abs(geometry.canvasWidth - geometry.paperWidth)).toBeLessThanOrEqual(4);
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.viewportWidth);

  await page.locator("#close-readback").click();
  await expect(page.locator("#reveal-answer")).toBeVisible();
  await page.locator("#reveal-answer").click();
  await expect(page.locator("#reveal-answer")).toBeHidden();
  expect(await page.locator("#workspace").evaluate((workspace) => workspace.scrollLeft))
    .toBeGreaterThan(0);
});
