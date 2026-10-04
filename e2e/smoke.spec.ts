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
  await page.locator("#correction-input").fill("11+a=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#correction-error")).toBeVisible();
  await expect(page.locator("#correction-input")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#correction-input")).toHaveAttribute("aria-describedby", "correction-error");
  await expect(page.locator("#correction-input")).toBeFocused();
  await page.locator("#correction-input").fill("11+11=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#correction-error")).toBeHidden();
  await expect(page.locator("#correction-input")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#line-result")).toContainText("22");
  await expect(page.locator("#line-result")).toContainText("corrected");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  await page.reload();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await page.getByRole("button", { name: "Readback" }).click();
  await expect(page.locator("#line-result")).toContainText("22");
  await expect(page.locator("#raw-read")).toHaveText("No OCR read retained");
  await expect(page.locator("#normalized-read")).toHaveText("11+11=");
  await page.locator("#correction-input").fill("4/0=");
  await page.getByRole("button", { name: "Use correction" }).click();
  await expect(page.locator("#line-result")).toContainText("Undefined");
  await expect(page.locator("#line-message")).toContainText("Division by zero");
  expect(errors).toEqual([]);
});

test("settled lines announce once even when another line is selected", async ({ page }) => {
  await page.addInitScript(() => {
    class TestWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      onmessageerror = null;

      postMessage(request: {
        type: string;
        requestId: number;
        pageId?: string;
        lineId?: string;
        canvasRevisionId?: number;
      }) {
        if (request.type === "cancel") return;
        const data = request.type === "init"
          ? { type: "ready", requestId: request.requestId, modelId: "test", elapsedMs: 0 }
          : {
              type: "result",
              ...request,
              rawText: "1+1=",
              unmaskedRawText: "I+I=",
              boxes: [],
              detMs: 0,
              recMs: 0,
              elapsedMs: 0,
              raster: { width: 32, height: 32, version: "test" },
            };
        setTimeout(() => this.onmessage?.({ data } as MessageEvent), 0);
      }

      terminate() {}
    }
    Object.defineProperty(window, "Worker", { value: TestWorker });
  });
  await page.goto("/");
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready");
  await expect(page.locator("#offline-status")).toContainText("Ready offline");
  await expect(page.locator("#system-announcement")).toHaveAttribute("role", "status");
  await expect(page.locator("#system-announcement")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#system-announcement")).toHaveText("Ready offline on this device.");
  await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>("#system-announcement")!;
    region.dataset.changes = "0";
    new MutationObserver(() => {
      region.dataset.changes = String(Number(region.dataset.changes) + 1);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });

  await drawStroke(page, 120, 140);
  await expect(page.locator("#live-region")).toHaveText(
    "Line 1, 1+1=: 2. Review read. Restricted OCR changed the model read. Verify this answer.",
  );
  await drawStroke(page, 120, 360);
  await expect(page.locator("#live-region")).toBeEmpty();
  await expect(page.locator(".line-choice")).toHaveCount(2);
  await expect(page.locator(".line-choice").first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#live-region")).toHaveText(
    "Line 2, 1+1=: 2. Review read. Restricted OCR changed the model read. Verify this answer.",
  );
  await expect(page.locator("#system-announcement")).toHaveAttribute("data-changes", "0");

  await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>("#live-region")!;
    region.dataset.changes = "0";
    new MutationObserver(() => {
      region.dataset.changes = String(Number(region.dataset.changes) + 1);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  await page.getByRole("button", { name: "Readback" }).click();
  await expect(page.locator("#unmasked-read")).toHaveText("Unrestricted OCR read: I+I=");
  await expect(page.locator("#line-message")).toContainText("Verify this answer");
  await page.locator(".line-choice").first().click();
  await page.locator(".line-choice").nth(1).click();
  await expect(page.locator("#live-region")).toHaveAttribute("data-changes", "0");
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
  await expect(page.locator('.page-row[data-active="true"] .page-switch')).toBeFocused();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#page-title")).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator("#pages-button")).toBeEnabled();
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await page.locator("#pen-width").boundingBox())?.height).toBeGreaterThanOrEqual(44);

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
