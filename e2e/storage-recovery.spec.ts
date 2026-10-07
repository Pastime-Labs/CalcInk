import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createNotebook, reloadNotebook } from "./notebook";

type RawRecord = {
  page: { id: string; schemaVersion: number; strokes: unknown[] };
  corrections: Record<string, string>;
};

async function readRecord(page: Page, id: string): Promise<RawRecord | undefined> {
  return page.evaluate((key) => new Promise<RawRecord | undefined>((resolve, reject) => {
    const opening = indexedDB.open("calcink");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("pageRecords", "readonly");
      const request = tx.objectStore("pageRecords").get(key);
      request.onsuccess = () => resolve(request.result as RawRecord | undefined);
      tx.oncomplete = () => db.close();
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), id);
}

test("future page record stays recoverable instead of being overwritten", async ({ page }) => {
  await createNotebook(page);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  const surface = page.locator("#drawing-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Drawing surface is not visible");
  await page.mouse.move(bounds.x + 100, bounds.y + 140);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 135, bounds.y + 175);
  await page.mouse.up();
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");

  const future = await page.evaluate(() => new Promise<RawRecord>((resolve, reject) => {
    const opening = indexedDB.open("calcink");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("pageRecords", "readwrite");
      const store = tx.objectStore("pageRecords");
      let futureRecord: RawRecord;
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result as RawRecord[];
        if (records.length !== 1 || records[0].page.strokes.length !== 1) {
          tx.abort();
          return;
        }
        futureRecord = structuredClone(records[0]);
        futureRecord.page.schemaVersion = 4;
        store.put(futureRecord, futureRecord.page.id);
      };
      tx.oncomplete = () => { db.close(); resolve(futureRecord); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Could not seed future record")); };
    };
  }));

  await page.reload();
  await expect(page.locator("#page-title")).toHaveText("Unsaved page");
  await expect(page.locator("#error-banner")).toContainText("original record is unchanged");
  await expect(page.locator("#export-recovery")).toBeVisible();
  await expect(page.locator("#start-fresh")).toBeVisible();
  expect(await readRecord(page, future.page.id)).toEqual(future);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-recovery").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("calcink-recovery-original.json");
  const path = await download.path();
  if (!path) throw new Error("Recovery download has no local path");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(future);

  await page.locator("#start-fresh").click();
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "notebook");
  await expect(page.locator("#pages-button")).toBeEnabled();
  await expect(page.locator("#error-banner")).toBeHidden();
  expect(await readRecord(page, future.page.id)).toEqual(future);
  await reloadNotebook(page);
  await expect(page.locator("#page-title")).toHaveText("Untitled page");
  expect(await readRecord(page, future.page.id)).toEqual(future);
});
