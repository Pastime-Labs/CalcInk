import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPage,
  openPageRepository,
  serializeRecoveryRecord,
  startFreshAfterRecovery,
  StoredDataError,
  type PageRepository,
  type SavedPage,
} from "./index";

let repositories: PageRepository[];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  repositories = [];
});

async function open(): Promise<PageRepository> {
  const repository = await openPageRepository();
  repositories.push(repository);
  return repository;
}

async function seedLegacy(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("calcink", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pages");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("pages", "readwrite");
      tx.objectStore("pages").put(value, "working-page");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
}

async function raw(storeName: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("calcink", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, "readonly");
      const read = tx.objectStore(storeName).get(key);
      read.onsuccess = () => {
        const result: unknown = read.result;
        db.close();
        resolve(result);
      };
      read.onerror = () => reject(read.error);
    };
  });
}

async function writeRaw(storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("calcink", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
}

describe("page repository", () => {
  it("saves independent pages and a valid active pointer", async () => {
    const repository = await open();
    expect(await repository.listPages()).toEqual([]);

    const first = createPage("A");
    const second = createPage("B");
    second.updatedAt += 1;
    await repository.savePage({ page: first, corrections: {} });
    await repository.savePage({ page: second, corrections: { line: "11+11=" } });
    await repository.setActivePageId(first.id);
    expect(await repository.getActivePageId()).toBe(first.id);
    expect((await repository.listPages()).map((summary) => summary.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect((await repository.getPage(second.id))?.corrections).toEqual({ line: "11+11=" });
    await expect(repository.setActivePageId("missing")).rejects.toThrow("Page does not exist");
  });

  it("migrates a valid v1 record once without changing the original", async () => {
    const original = {
      schemaVersion: 1,
      id: "working-page",
      title: "Old notebook",
      strokes: [{
        id: "stroke-one",
        width: 3,
        points: [{ x: 9, y: 11, pressure: 0.5, t: 4 }],
      }],
      corrections: { line: "9=" },
    };
    await seedLegacy(original);
    const repository = await open();
    const active = await repository.getActivePageId();
    expect(active).toBeTruthy();
    expect(active).not.toBe("working-page");
    expect(await repository.getPage(active!)).toEqual({
      page: {
        schemaVersion: 2,
        id: active,
        title: "Old notebook",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        strokes: original.strokes,
      },
      corrections: original.corrections,
    });
    expect(await raw("pages", "working-page")).toEqual(original);
    repository.close();

    const reopened = await open();
    expect(await reopened.getActivePageId()).toBe(active);
    expect(await reopened.listPages()).toHaveLength(1);
  });

  it("refuses corrupt legacy data instead of creating a blank replacement", async () => {
    const corrupt = {
      schemaVersion: 1,
      title: "Old notebook",
      strokes: [{ id: "bad", width: 2, points: [{ x: Number.NaN, y: 3 }] }],
    };
    await seedLegacy(corrupt);
    await expect(open()).rejects.toBeInstanceOf(StoredDataError);
    expect(await raw("pages", "working-page")).toEqual(corrupt);
    expect(await raw("meta", "activePageId")).toBeUndefined();
  });

  it("starts fresh explicitly while retaining corrupt legacy data", async () => {
    const corrupt = {
      schemaVersion: 1,
      title: "Old notebook",
      strokes: [{ id: "bad", width: 2, points: [{ x: Number.NaN, y: 3 }] }],
    };
    await seedLegacy(corrupt);
    await expect(open()).rejects.toBeInstanceOf(StoredDataError);
    const recovered = await startFreshAfterRecovery();
    repositories.push(recovered);
    const active = await recovered.getActivePageId();
    expect(active).toBeTruthy();
    expect(await recovered.listPages()).toHaveLength(1);
    expect(await raw("pages", "working-page")).toEqual(corrupt);
    recovered.close();
    const reopened = await open();
    expect(await reopened.getActivePageId()).toBe(active);
    expect(await reopened.listPages()).toHaveLength(1);
  });

  it("rejects malformed saves and never overwrites an existing page", async () => {
    const repository = await open();
    const page = createPage();
    const record: SavedPage = { page, corrections: {} };
    await repository.savePage(record);
    const invalid = structuredClone(record);
    invalid.page.strokes = [{
      id: "bad",
      width: 2,
      points: [{ x: Number.POSITIVE_INFINITY, y: 1 }],
    }];
    await expect(repository.savePage(invalid)).rejects.toBeInstanceOf(StoredDataError);
    expect(await repository.getPage(page.id)).toEqual(record);
  });

  it("refuses to overwrite a corrupt stored page even with a valid snapshot", async () => {
    const repository = await open();
    const page = createPage();
    const record: SavedPage = { page, corrections: {} };
    await repository.savePage(record);
    const corrupt = { page: { ...page, schemaVersion: 3 }, corrections: {} };
    await writeRaw("pageRecords", page.id, corrupt);
    await expect(repository.savePage(record)).rejects.toBeInstanceOf(StoredDataError);
    expect(await raw("pageRecords", page.id)).toEqual(corrupt);
  });

  it("preserves corrupt v2 records across explicit recovery and reload", async () => {
    const repository = await open();
    const page = createPage();
    await repository.savePage({ page, corrections: {} });
    await repository.setActivePageId(page.id);
    repository.close();
    const corrupt = { page: { ...page, schemaVersion: 3 }, corrections: {} };
    await writeRaw("pageRecords", page.id, corrupt);
    await expect(open()).rejects.toBeInstanceOf(StoredDataError);
    const recovered = await startFreshAfterRecovery();
    repositories.push(recovered);
    expect(recovered.getRecoveryIssueIds()).toEqual([page.id]);
    expect(await recovered.listPages()).toHaveLength(1);
    recovered.close();
    const reopened = await open();
    expect(reopened.getRecoveryIssueIds()).toEqual([page.id]);
    expect(await raw("pageRecords", page.id)).toEqual(corrupt);
    await expect(reopened.getPage(page.id)).rejects.toBeInstanceOf(StoredDataError);
  });

  it("snapshots input before an asynchronous save", async () => {
    const repository = await open();
    const page = createPage();
    const record: SavedPage = { page, corrections: {} };
    const saving = repository.savePage(record);
    record.page.title = "Changed after save call";
    await saving;
    expect((await repository.getPage(page.id))?.page.title).toBe("Untitled page");
  });

  it("rejects a quota write failure without changing the saved page", async () => {
    const repository = await open();
    const page = createPage("Original");
    const record: SavedPage = { page, corrections: {} };
    await repository.savePage(record);
    const updated = structuredClone(record);
    updated.page.title = "Uncommitted";
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    try {
      await expect(repository.savePage(updated)).rejects.toMatchObject({
        name: "QuotaExceededError",
      });
    } finally {
      put.mockRestore();
    }
    expect(await repository.getPage(page.id)).toEqual(record);
  });

  it("rejects an aborted transaction and rolls back a queued write", async () => {
    const repository = await open();
    const page = createPage("Original");
    const record: SavedPage = { page, corrections: {} };
    await repository.savePage(record);
    const updated = structuredClone(record);
    updated.page.title = "Uncommitted";
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(
      function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const request = originalPut.call(this, value, key);
        this.transaction.abort();
        return request;
      },
    );
    try {
      await expect(repository.savePage(updated)).rejects.toThrow();
    } finally {
      put.mockRestore();
    }
    expect(await repository.getPage(page.id)).toEqual(record);
  });

  it("reports a blocked upgrade and succeeds after the old connection closes", async () => {
    const legacy = {
      schemaVersion: 1,
      title: "Old notebook",
      strokes: [],
      corrections: {},
    };
    await seedLegacy(legacy);
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("calcink", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await expect(openPageRepository()).rejects.toThrow(
        "Close other CalcInk tabs to finish updating",
      );
    } finally {
      held.close();
    }
    const repository = await open();
    expect(await repository.listPages()).toHaveLength(1);
    expect(await raw("pages", "working-page")).toEqual(legacy);
  });

  it("replaces the final page within the delete transaction", async () => {
    const repository = await open();
    const page = createPage("Only");
    await repository.savePage({ page, corrections: {} });
    await repository.setActivePageId(page.id);
    await repository.deletePage(page.id);
    const pages = await repository.listPages();
    expect(pages).toHaveLength(1);
    expect(pages[0]!.id).not.toBe(page.id);
    expect(await repository.getActivePageId()).toBe(pages[0]!.id);
    expect(await repository.getPage(page.id)).toBeNull();
  });

  it("keeps the active pointer when deleting another page", async () => {
    const repository = await open();
    const active = createPage("Active");
    const other = createPage("Other");
    await repository.savePage({ page: active, corrections: {} });
    await repository.savePage({ page: other, corrections: {} });
    await repository.setActivePageId(active.id);
    await repository.deletePage(other.id);
    expect(await repository.getActivePageId()).toBe(active.id);
    expect((await repository.listPages()).map((page) => page.id)).toEqual([active.id]);
  });

  it("exports a recoverable original without modifying it", () => {
    const error = new StoredDataError("pageRecords", "bad", "invalid", { hello: "world" });
    expect(serializeRecoveryRecord(error)).toBe('{"hello":"world"}');
    expect(serializeRecoveryRecord(new StoredDataError("pageRecords", "bad", "invalid", {
      unsafe: 1n,
    }))).toBeNull();
    expect(serializeRecoveryRecord(new StoredDataError("pageRecords", "bad", "invalid", {
      unsafe: Number.NaN,
    }))).toBeNull();
  });
});
