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

async function seedVersion2(records: { id: string; value: unknown }[], activeId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("calcink", 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("pages");
      request.result.createObjectStore("pageRecords");
      request.result.createObjectStore("meta");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["pageRecords", "meta"], "readwrite");
      for (const record of records) tx.objectStore("pageRecords").put(record.value, record.id);
      tx.objectStore("meta").put(activeId, "activePageId");
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
    const request = indexedDB.open("calcink", 4);
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
    const request = indexedDB.open("calcink", 4);
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
  it("creates isolated notebook and whiteboard workspaces with one initial page", async () => {
    const repository = await open();
    expect(await repository.listWorkspaces()).toEqual([]);
    const notebook = await repository.createWorkspace("notebook", "Math");
    const whiteboard = await repository.createWorkspace("whiteboard", "Ideas");
    expect(notebook.kind).toBe("notebook");
    expect(whiteboard.kind).toBe("whiteboard");
    expect(notebook.pageIds).toHaveLength(1);
    expect(whiteboard.pageIds).toHaveLength(1);
    expect((await repository.getPage(notebook.pageIds[0]!))?.page).toMatchObject({
      geometry: "a4",
      template: "ruled",
    });
    expect((await repository.getPage(whiteboard.pageIds[0]!))?.page).toMatchObject({
      geometry: "legacy",
      template: "blank",
    });
    expect((await repository.listWorkspacePages(notebook.id)).map((page) => page.id))
      .toEqual(notebook.pageIds);
    expect((await repository.listWorkspacePages(whiteboard.id)).map((page) => page.id))
      .toEqual(whiteboard.pageIds);
    await expect(repository.listWorkspacePages("missing")).rejects.toThrow("Workspace does not exist");
    repository.close();
    const reopened = await open();
    expect(await reopened.getWorkspace(notebook.id)).toEqual(notebook);
    expect(await reopened.getWorkspace(whiteboard.id)).toEqual(whiteboard);
  });

  it("rejects malformed workspace input and does not create an orphan page", async () => {
    const repository = await open();
    await expect(repository.createWorkspace("notebook", "  ")).rejects.toThrow();
    await expect(repository.createWorkspace(
      "whiteboard", "x".repeat(81),
    )).rejects.toThrow();
    await expect(repository.createWorkspace(
      "other" as "notebook", "Wrong",
    )).rejects.toThrow();
    expect(await repository.listWorkspaces()).toEqual([]);
    expect(await repository.listPages()).toEqual([]);
  });

  it("rolls back workspace creation when its page cannot be stored", async () => {
    const repository = await open();
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementationOnce(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    try {
      await expect(repository.createWorkspace("notebook", "Unsaved")).rejects.toMatchObject({
        name: "QuotaExceededError",
      });
    } finally {
      add.mockRestore();
    }
    expect(await repository.listWorkspaces()).toEqual([]);
    expect(await repository.listPages()).toEqual([]);
  });

  it("keeps page insertion and final-page replacement inside the owning workspace", async () => {
    const repository = await open();
    const first = await repository.createWorkspace("notebook", "First");
    const second = await repository.createWorkspace("notebook", "Second");
    const board = await repository.createWorkspace("whiteboard", "Board");
    const inserted = createPage("Inserted");
    await repository.insertPageAfter({ page: inserted, corrections: {} }, first.pageIds[0]!);
    expect((await repository.getWorkspace(first.id))?.pageIds)
      .toEqual([first.pageIds[0], inserted.id]);
    expect((await repository.getWorkspace(second.id))?.pageIds).toEqual(second.pageIds);
    await expect(repository.insertPageAfter(
      { page: createPage(), corrections: {} }, board.pageIds[0]!,
    )).rejects.toThrow("Cannot add pages to a whiteboard");
    await repository.deletePage(first.pageIds[0]!);
    expect((await repository.getWorkspace(first.id))?.pageIds).toEqual([inserted.id]);
    await repository.setActivePageId(inserted.id);
    await repository.deletePage(inserted.id);
    const replacement = (await repository.getWorkspace(first.id))!.pageIds;
    expect(replacement).toHaveLength(1);
    expect(replacement[0]).not.toBe(inserted.id);
    expect(await repository.getActivePageId()).toBe(replacement[0]);
    expect((await repository.listWorkspacePages(second.id)).map((page) => page.id))
      .toEqual(second.pageIds);
    await repository.deletePage(board.pageIds[0]!);
    const boardReplacement = (await repository.getWorkspace(board.id))!.pageIds[0]!;
    expect((await repository.getPage(boardReplacement))?.page).toMatchObject({
      geometry: "legacy",
      template: "blank",
    });
  });

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
      first.id,
      second.id,
    ]);
    expect((await repository.getPage(second.id))?.corrections).toEqual({ line: "11+11=" });
    expect((await repository.listWorkspaces())[0]?.pageIds).toEqual([first.id, second.id]);
    await expect(repository.setActivePageId("missing")).rejects.toThrow("Page does not exist");
  });

  it("recovers an unknown page into a new notebook when other workspaces exist", async () => {
    const repository = await open();
    const notebook = await repository.createWorkspace("notebook", "Math");
    const whiteboard = await repository.createWorkspace("whiteboard", "Ideas");
    const page = createPage("Unsaved work");
    page.strokes.push({
      id: "ink",
      width: 2,
      points: [{ x: 10, y: 20 }],
    });
    const record: SavedPage = { page, corrections: { line: "4+4=" } };

    const recovered = await repository.savePageInNewNotebook(record);
    expect(recovered).toMatchObject({
      kind: "notebook",
      title: "Recovered notebook",
      pageIds: [page.id],
    });
    expect(await repository.getPage(page.id)).toEqual(record);
    expect(await repository.getActivePageId()).toBe(page.id);
    expect((await repository.getWorkspace(notebook.id))?.pageIds).toEqual(notebook.pageIds);
    expect((await repository.getWorkspace(whiteboard.id))?.pageIds).toEqual(whiteboard.pageIds);
    expect((await repository.listWorkspacePages(recovered.id)).map(({ id }) => id)).toEqual([page.id]);

    repository.close();
    const reopened = await open();
    expect(await reopened.getWorkspace(recovered.id)).toEqual(recovered);
    expect(await reopened.getPage(page.id)).toEqual(record);
    await expect(reopened.savePageInNewNotebook(record)).rejects.toThrow("Page already exists");
    expect(await reopened.listWorkspaces()).toHaveLength(3);
  });

  it("rolls back a recovered notebook if its metadata write fails", async () => {
    const repository = await open();
    const existing = await repository.createWorkspace("notebook", "Existing");
    const record: SavedPage = { page: createPage("Unsaved work"), corrections: {} };
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    try {
      await expect(repository.savePageInNewNotebook(record)).rejects.toMatchObject({
        name: "QuotaExceededError",
      });
    } finally {
      put.mockRestore();
    }
    expect(await repository.getPage(record.page.id)).toBeNull();
    expect(await repository.listWorkspaces()).toEqual([existing]);
    expect(await repository.getActivePageId()).toBe(existing.pageIds[0]);
  });

  it("keeps notebook order through edits, insert-after, delete, and reload", async () => {
    const repository = await open();
    const first = createPage("First");
    const last = createPage("Last");
    const middle = createPage("Middle");
    await repository.savePage({ page: first, corrections: {} });
    await repository.savePage({ page: last, corrections: {} });
    await repository.insertPageAfter({ page: middle, corrections: {} }, first.id);
    first.updatedAt += 100;
    await repository.savePage({ page: first, corrections: {} });
    const ids = () => repository.listPages().then((pages) => pages.map((page) => page.id));
    expect(await ids()).toEqual([first.id, middle.id, last.id]);
    await expect(repository.insertPageAfter({ page: createPage(), corrections: {} }, "missing"))
      .rejects.toThrow();
    expect(await ids()).toEqual([first.id, middle.id, last.id]);
    await repository.deletePage(middle.id);
    expect(await ids()).toEqual([first.id, last.id]);
    repository.close();
    const reopened = await open();
    expect((await reopened.listPages()).map((page) => page.id)).toEqual([first.id, last.id]);
  });

  it("keeps existing schema-2 pages in legacy geometry without rewriting ink", async () => {
    const old = {
      schemaVersion: 2,
      id: "old-page",
      title: "Existing",
      createdAt: 1,
      updatedAt: 50,
      strokes: [{ id: "ink", width: 3, points: [{ x: 20, y: 30 }] }],
    };
    const later = {
      ...old,
      id: "later-page",
      title: "Later",
      createdAt: 2,
      updatedAt: 3,
      strokes: [],
    };
    await seedVersion2([
      { id: old.id, value: { page: old, corrections: { line: "2=" } } },
      { id: later.id, value: { page: later, corrections: {} } },
    ], later.id);
    const repository = await open();
    expect(await repository.getPage(old.id)).toEqual({
      page: old,
      corrections: { line: "2=" },
    });
    expect((await repository.listPages()).map((page) => page.id)).toEqual([old.id, later.id]);
    expect((await repository.listWorkspaces()).map((workspace) => workspace.pageIds))
      .toEqual([[old.id, later.id]]);
    expect(await repository.getActivePageId()).toBe(later.id);
    expect(await raw("pageRecords", old.id)).toEqual({
      page: old,
      corrections: { line: "2=" },
    });
    expect(createPage().geometry).toBe("a4");
  });

  it("refuses a corrupt workspace record without changing its stored data", async () => {
    const repository = await open();
    const notebook = await repository.createWorkspace("notebook", "Sound");
    repository.close();
    const corrupt = { ...notebook, pageIds: ["missing", "missing"] };
    await writeRaw("workspaces", notebook.id, corrupt);
    await expect(open()).rejects.toBeInstanceOf(StoredDataError);
    expect(await raw("workspaces", notebook.id)).toEqual(corrupt);
    const recovered = await startFreshAfterRecovery();
    repositories.push(recovered);
    expect(recovered.getRecoveryIssueIds()).toEqual([`workspace:${notebook.id}`]);
    expect(await recovered.listWorkspaces()).toHaveLength(1);
    recovered.close();
    const reopened = await open();
    expect(reopened.getRecoveryIssueIds()).toEqual([`workspace:${notebook.id}`]);
    expect((await reopened.listWorkspaces()).map((workspace) => workspace.title).sort())
      .toEqual(["Recovered notebook", "Recovered pages"]);
    expect(await raw("workspaces", notebook.id)).toEqual(corrupt);
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
        schemaVersion: 3,
        id: active,
        title: "Old notebook",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        geometry: "legacy",
        template: "ruled",
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
    const badTemplate = structuredClone(record);
    badTemplate.page.template = "lined" as "ruled";
    await expect(repository.savePage(badTemplate)).rejects.toBeInstanceOf(StoredDataError);
    expect(await repository.getPage(page.id)).toEqual(record);
  });

  it("refuses to overwrite a corrupt stored page even with a valid snapshot", async () => {
    const repository = await open();
    const page = createPage();
    const record: SavedPage = { page, corrections: {} };
    await repository.savePage(record);
    const corrupt = { page: { ...page, schemaVersion: 4 }, corrections: {} };
    await writeRaw("pageRecords", page.id, corrupt);
    await expect(repository.savePage(record)).rejects.toBeInstanceOf(StoredDataError);
    expect(await raw("pageRecords", page.id)).toEqual(corrupt);
  });

  it("preserves corrupt records across explicit recovery and reload", async () => {
    const repository = await open();
    const page = createPage();
    await repository.savePage({ page, corrections: {} });
    await repository.setActivePageId(page.id);
    repository.close();
    const corrupt = { page: { ...page, schemaVersion: 4 }, corrections: {} };
    await writeRaw("pageRecords", page.id, corrupt);
    await expect(open()).rejects.toBeInstanceOf(StoredDataError);
    const recovered = await startFreshAfterRecovery();
    repositories.push(recovered);
    expect(recovered.getRecoveryIssueIds()).toEqual([page.id]);
    expect(await recovered.listPages()).toHaveLength(1);
    expect(await recovered.listWorkspaces()).toHaveLength(1);
    recovered.close();
    const reopened = await open();
    expect(reopened.getRecoveryIssueIds()).toEqual([page.id]);
    expect(await reopened.listWorkspaces()).toHaveLength(1);
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
