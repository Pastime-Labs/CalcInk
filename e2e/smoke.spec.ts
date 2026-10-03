import { expect, test } from "@playwright/test";

async function drawStroke(page: import("@playwright/test").Page, x: number, y: number) {
  const surface = page.locator("#drawing-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  await page.mouse.move(bounds.x + x, bounds.y + y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + x + 36, bounds.y + y + 28, { steps: 6 });
  await page.mouse.up();
}

test("draw, correct, save, and reload a local equation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await expect(page.getByRole("button", { name: "Pen" })).toBeEnabled();

  await drawStroke(page, 120, 140);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Readback" }).click();
  await expect(page.locator(".line-choice")).toHaveCount(1);
  await page.locator("#correction-input").fill("11+11=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("22");
  await expect(page.locator("#line-result")).toContainText("corrected");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.reload();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await page.getByRole("button", { name: "Readback" }).click();
  await expect(page.locator("#line-result")).toContainText("22");
  await page.locator("#correction-input").fill("4/0=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("Undefined");
  await expect(page.locator("#line-message")).toContainText("Division by zero");
  expect(errors).toEqual([]);
});

test("pages keep independent ink and support rename and delete", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await drawStroke(page, 120, 140);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.getByRole("button", { name: /Pages/ }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await drawStroke(page, 240, 240);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.getByRole("button", { name: /Pages/ }).click();
  await expect(page.locator(".page-row")).toHaveCount(2);
  const currentRow = page.locator('.page-row[data-active="true"]');
  await currentRow.getByRole("button", { name: "Rename" }).click();
  await page.locator(".page-rename").fill("Second page");
  await page.locator(".page-rename").press("Enter");
  await expect(page.locator("#page-title")).toHaveText("Second page");
  await page.locator('.page-row[data-active="false"] .page-switch').click();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.getByRole("button", { name: /Pages/ }).click();
  const secondRow = page.locator(".page-row").filter({ hasText: "Second page" });
  await secondRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".page-row")).toHaveCount(2);
  await secondRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete page" }).click();
  await expect(page.locator(".page-row")).toHaveCount(1);
});

test("complete install reloads the notebook offline", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await expect(page.locator("#offline-status")).toContainText("Ready offline", { timeout: 90_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  await drawStroke(page, 120, 140);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
});

test("temporary storage failure can recover the unsaved page", async ({ page }) => {
  await page.addInitScript(() => {
    const original = indexedDB.open;
    Object.defineProperty(indexedDB, "open", {
      value: (...args: unknown[]) => {
        if (sessionStorage.getItem("blocked-storage-once") !== "yes") {
          sessionStorage.setItem("blocked-storage-once", "yes");
          throw new Error("temporary storage interruption");
        }
        return Reflect.apply(original, indexedDB, args);
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#page-title")).toHaveText("Unsaved page");
  await expect(page.locator("#save-status")).toHaveText("Not saved");
  await drawStroke(page, 120, 140);
  await page.getByRole("button", { name: "Retry local storage" }).click();
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expect(page.locator("#page-title")).toHaveText("Unsaved page");
  await expect(page.getByRole("button", { name: "Clear page" })).toBeEnabled();
});

test("narrow mobile layout keeps controls and panels in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(page.locator("#pages-button")).toBeEnabled();
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(320);

  await page.locator("#pages-button").click();
  await expect(page.locator("#pages-dialog")).toBeVisible();
  expect(await page.locator("#pages-dialog").evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);
  await page.locator("#close-pages").click();

  await page.locator("#readback-button").click();
  await expect(page.locator("#readback-panel")).toBeVisible();
  expect(await page.locator("#readback-panel").evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);
  await page.locator("#close-readback").click();
  await drawStroke(page, 120, 140);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});
