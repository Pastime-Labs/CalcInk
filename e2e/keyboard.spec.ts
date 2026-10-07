import { expect, test } from "@playwright/test";
import { createNotebook, reloadNotebook } from "./notebook";

test("keyboard navigation restores focus and keeps correction errors at the field", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  // Ink authorship is pointer-only in V1; seed a line so the keyboard form is available.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("calcink");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction("pageRecords", "readwrite");
      const store = transaction.objectStore("pageRecords");
      const reading = store.getAll();
      reading.onsuccess = () => {
        const record = reading.result[0];
        record.page.strokes = [{
          id: "keyboard-fixture",
          width: 4,
          points: [{ x: 120, y: 140 }, { x: 156, y: 168 }],
        }];
        record.page.updatedAt = Date.now();
        store.put(record, record.page.id);
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
  await reloadNotebook(page);
  await expect(page.locator("#pages-button")).toBeEnabled();

  await page.locator("#home-button").focus();
  await expect(page.locator("#home-button")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#pages-button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pages-dialog")).toBeVisible();
  await expect(page.locator("#close-pages")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#new-page")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".page-switch")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#pages-dialog")).toBeHidden();
  await expect(page.locator("#pages-button")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#clear-button")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#quick-new-page")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#more-button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#readback-button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#readback-panel")).toBeVisible();
  await expect(page.locator("#readback-heading")).toBeFocused();
  await expect(page.locator(".line-choice")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.locator("#close-readback")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".line-choice")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#correction-input")).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("11+a=");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Use correction" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#correction-error")).toBeVisible();
  await expect(page.locator("#correction-input")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#correction-input")).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#close-readback")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#readback-panel")).toBeHidden();
  await expect(page.locator("#more-button")).toBeFocused();
});
