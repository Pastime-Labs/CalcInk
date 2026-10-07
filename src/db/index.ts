import type { Page, PageGeometry } from "../canvas/types";
export { PAGE_WIDTH, PAGE_HEIGHT } from "../canvas/types";
import {
  StoredDataError,
  validateLegacyPage,
  validateSavedPage,
  type SavedPage,
} from "./validation";

export type { SavedPage } from "./validation";
export { StoredDataError, serializeRecoveryRecord } from "./validation";

export type PageSummary = { id: string; title: string; updatedAt: number };
export type WorkspaceKind = "notebook" | "whiteboard";
export type WorkspaceSummary = {
  id: string;
  kind: WorkspaceKind;
  title: string;
  pageIds: string[];
  updatedAt: number;
};

export interface PageRepository {
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  createWorkspace(kind: WorkspaceKind, title: string): Promise<WorkspaceSummary>;
  getWorkspace(id: string): Promise<WorkspaceSummary | null>;
  listWorkspacePages(id: string): Promise<PageSummary[]>;
  listPages(): Promise<PageSummary[]>;
  getPage(id: string): Promise<SavedPage | null>;
  savePage(record: SavedPage): Promise<void>;
  savePageInNewNotebook(record: SavedPage, title?: string): Promise<WorkspaceSummary>;
  insertPageAfter(record: SavedPage, afterId: string): Promise<void>;
  deletePage(id: string): Promise<void>;
  getActivePageId(): Promise<string | null>;
  setActivePageId(id: string): Promise<void>;
  getRecoveryIssueIds(): string[];
  close(): void;
}

const DATABASE_NAME = "calcink";
const DATABASE_VERSION = 4;
const RECORDS = "pageRecords";
const META = "meta";
const LEGACY = "pages";
const WORKSPACES = "workspaces";
const ACTIVE = "activePageId";
const PAGE_ORDER = "pageOrder";
const RECOVERY_IGNORED = "recoveryIgnoredPageIds";
const RECOVERY_IGNORED_WORKSPACES = "recoveryIgnoredWorkspaceIds";
const LEGACY_PAGE = "working-page";
type IgnoredRecords = { pages: Set<string>; workspaces: Set<string> };

type Fail = (error: unknown) => void;
type Done<T> = (value: T) => void;

function request<T>(
  source: IDBRequest<T>,
  success: (value: T) => void,
  fail: Fail,
): void {
  source.onsuccess = () => {
    try {
      success(source.result);
    } catch (error) {
      fail(error);
    }
  };
  source.onerror = () => fail(source.error ?? new Error("IndexedDB request failed"));
}

function transaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, done: Done<T>, fail: Fail) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result!: T;
    let failure: unknown;
    let failed = false;
    const fail: Fail = (error) => {
      if (failed) return;
      failed = true;
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => {
      failure ??= tx.error ?? new Error("IndexedDB transaction failed");
    };
    try {
      work(tx, (value) => { result = value; }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function pageOrder(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) || value.length > 10_000 ||
    value.some((id) => typeof id !== "string" || !id || id.length > 128) ||
    new Set(value).size !== value.length
  ) {
    throw new StoredDataError(META, PAGE_ORDER, "invalid page order", value);
  }
  return value;
}

function orderedRecords(records: SavedPage[], order: readonly string[]): SavedPage[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...records].sort(
    (a, b) =>
      (positions.get(a.page.id) ?? Infinity) - (positions.get(b.page.id) ?? Infinity) ||
      a.page.createdAt - b.page.createdAt ||
      a.page.id.localeCompare(b.page.id),
  );
}

function summaries(records: SavedPage[], order: readonly string[]): PageSummary[] {
  return orderedRecords(records, order)
    .map(({ page }) => ({ id: page.id, title: page.title, updatedAt: page.updatedAt }));
}

function validateWorkspace(value: unknown, key: IDBValidKey): WorkspaceSummary {
  const bad = (): never => {
    throw new StoredDataError(WORKSPACES, key, "invalid workspace", value);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return bad();
  const workspace = value as WorkspaceSummary;
  if (
    typeof workspace.id !== "string" || !workspace.id || workspace.id.length > 128 ||
    workspace.id !== key ||
    (workspace.kind !== "notebook" && workspace.kind !== "whiteboard") ||
    typeof workspace.title !== "string" || !workspace.title.trim() ||
    workspace.title.length > 80 ||
    !Number.isFinite(workspace.updatedAt) || workspace.updatedAt < 0 ||
    !Array.isArray(workspace.pageIds) || workspace.pageIds.length < 1 ||
    workspace.pageIds.length > 10_000 ||
    workspace.pageIds.some((id) => typeof id !== "string" || !id || id.length > 128) ||
    new Set(workspace.pageIds).size !== workspace.pageIds.length ||
    (workspace.kind === "whiteboard" && workspace.pageIds.length !== 1)
  ) return bad();
  return workspace;
}

function readWorkspaces(
  tx: IDBTransaction,
  success: (workspaces: WorkspaceSummary[]) => void,
  fail: Fail,
  ignoreCorrupt?: (error: StoredDataError) => boolean,
): void {
  const store = tx.objectStore(WORKSPACES);
  let values: unknown[] | undefined;
  let keys: IDBValidKey[] | undefined;
  const complete = () => {
    if (!values || !keys) return;
    if (values.length !== keys.length) throw new Error("Workspace key count mismatch");
    const workspaces: WorkspaceSummary[] = [];
    const owned = new Set<string>();
    for (let index = 0; index < values.length; index++) {
      try {
        const workspace = validateWorkspace(values[index], keys[index]!);
        for (const pageId of workspace.pageIds) {
          if (owned.has(pageId)) {
            throw new StoredDataError(WORKSPACES, workspace.id, "page has multiple owners", workspace);
          }
        }
        workspace.pageIds.forEach((pageId) => owned.add(pageId));
        workspaces.push(workspace);
      } catch (error) {
        if (!(error instanceof StoredDataError) || !ignoreCorrupt?.(error)) throw error;
      }
    }
    success(workspaces);
  };
  request(store.getAll(), (result) => { values = result; complete(); }, fail);
  request(store.getAllKeys(), (result) => { keys = result; complete(); }, fail);
}

function ownerOf(workspaces: readonly WorkspaceSummary[], pageId: string): WorkspaceSummary | undefined {
  return workspaces.find((workspace) => workspace.pageIds.includes(pageId));
}

function updatedWorkspace(workspace: WorkspaceSummary, pageIds = workspace.pageIds): WorkspaceSummary {
  return {
    ...workspace,
    pageIds: [...pageIds],
    updatedAt: Math.max(Date.now(), workspace.updatedAt + 1),
  };
}

function newWorkspace(kind: WorkspaceKind, title: string, pageIds: string[], updatedAt: number): WorkspaceSummary {
  if (kind !== "notebook" && kind !== "whiteboard") throw new TypeError("Invalid workspace kind");
  const normalized = title.trim();
  if (!normalized || normalized.length > 80) throw new RangeError("Invalid workspace title");
  const workspace: WorkspaceSummary = {
    id: crypto.randomUUID(),
    kind,
    title: normalized,
    pageIds: [...pageIds],
    updatedAt,
  };
  return validateWorkspace(workspace, workspace.id);
}

function initialPage(kind: WorkspaceKind): Page {
  const page = createPage(kind === "whiteboard" ? "Canvas" : "Page 1",
    kind === "whiteboard" ? "legacy" : "a4");
  if (kind === "whiteboard") page.template = "blank";
  return page;
}

function readAll(
  tx: IDBTransaction,
  success: (records: SavedPage[]) => void,
  fail: Fail,
  ignoreCorrupt?: (error: StoredDataError) => boolean,
): void {
  const store = tx.objectStore(RECORDS);
  let values: unknown[] | undefined;
  let keys: IDBValidKey[] | undefined;
  const complete = () => {
    const loadedValues = values;
    const loadedKeys = keys;
    if (!loadedValues || !loadedKeys) return;
    if (loadedValues.length !== loadedKeys.length) throw new Error("Page key count mismatch");
    const records: SavedPage[] = [];
    for (let index = 0; index < loadedValues.length; index++) {
      try {
        records.push(validateSavedPage(loadedValues[index], loadedKeys[index]!));
      } catch (error) {
        if (!(error instanceof StoredDataError) || !ignoreCorrupt?.(error)) throw error;
      }
    }
    success(records);
  };
  request(store.getAll(), (result) => { values = result; complete(); }, fail);
  request(store.getAllKeys(), (result) => { keys = result; complete(); }, fail);
}

export function createPage(title = "Untitled page", geometry: PageGeometry = "a4"): Page {
  const normalized = title.trim() || "Untitled page";
  if (normalized.length > 80) throw new RangeError("Page title is too long");
  if (geometry !== "a4" && geometry !== "legacy") throw new TypeError("Invalid page geometry");
  const now = Date.now();
  return {
    schemaVersion: 3,
    id: crypto.randomUUID(),
    title: normalized,
    createdAt: now,
    updatedAt: now,
    geometry,
    template: "ruled",
    strokes: [],
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(LEGACY)) db.createObjectStore(LEGACY);
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(WORKSPACES)) db.createObjectStore(WORKSPACES);
    };
    opening.onblocked = () => {
      blocked = true;
      reject(new Error("Close other CalcInk tabs to finish updating"));
    };
    opening.onerror = () => reject(opening.error ?? new Error("Could not open local storage"));
    opening.onsuccess = () => {
      if (blocked) {
        opening.result.close();
        return;
      }
      opening.result.onversionchange = () => opening.result.close();
      resolve(opening.result);
    };
  });
}

function recoveryIds(value: unknown, key = RECOVERY_IGNORED): Set<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > 10_000 ||
      value.some((id) => typeof id !== "string" || !id || id.length > 128)) {
    throw new StoredDataError(META, key, "invalid recovery marker", value);
  }
  return new Set(value);
}

async function initialize(db: IDBDatabase): Promise<IgnoredRecords> {
  return transaction(db, [RECORDS, META, LEGACY, WORKSPACES], "readwrite", (tx, done, fail) => {
    let records: SavedPage[] | undefined;
    let workspaces: WorkspaceSummary[] | undefined;
    let active: unknown;
    let legacy: unknown;
    let storedOrder: string[] | null | undefined;
    let marked = new Set<string>();
    let ignored = new Set<string>();
    let markedWorkspaces = new Set<string>();
    let ignoredWorkspaces = new Set<string>();
    let pending = 5;
    const finish = () => {
      if (--pending !== 0) return;
      if (!records || !workspaces || storedOrder === undefined) {
        throw new Error("Stored documents were not loaded");
      }
      const meta = tx.objectStore(META);
      const workspaceStore = tx.objectStore(WORKSPACES);
      const order = [...(storedOrder ?? [])];
      const knownIds = new Set(order);
      const missing = orderedRecords(records, []).filter(({ page }) => !knownIds.has(page.id));
      order.push(...missing.map(({ page }) => page.id));
      const available = [...records];
      if (records.length > 0) {
        const sorted = summaries(records, order);
        const selected =
          typeof active === "string" && records.some(({ page }) => page.id === active)
            ? active
            : sorted[0]!.id;
        if (active !== selected) meta.put(selected, ACTIVE);
      } else if (ignored.size > 0) {
        throw new StoredDataError(RECORDS, "<recovery>", "no valid page remains");
      } else if (legacy !== undefined) {
        const old = validateLegacyPage(legacy);
        const page = createPage(old.title, "legacy");
        page.strokes = old.strokes;
        tx.objectStore(RECORDS).put({ page, corrections: old.corrections }, page.id);
        available.push({ page, corrections: old.corrections });
        order.push(page.id);
        meta.put(page.id, ACTIVE);
      } else if (active !== undefined) {
        meta.delete(ACTIVE);
      }
      const owned = new Set(workspaces.flatMap((workspace) => workspace.pageIds));
      const unowned = orderedRecords(available, order)
        .filter(({ page }) => !owned.has(page.id));
      if (unowned.length > 0) {
        const imported = newWorkspace(
          "notebook",
          workspaces.length === 0 ? "My Notebook" : "Recovered pages",
          unowned.map(({ page }) => page.id),
          unowned.reduce((latest, { page }) => Math.max(latest, page.updatedAt), 0),
        );
        workspaceStore.add(imported, imported.id);
      }
      if (storedOrder === null || missing.length > 0 || legacy !== undefined && records.length === 0) {
        meta.put(order, PAGE_ORDER);
      }
      done({ pages: ignored, workspaces: ignoredWorkspaces });
    };
    request(tx.objectStore(META).get(RECOVERY_IGNORED), (value) => {
      marked = recoveryIds(value);
      readAll(tx, (pages) => { records = pages; finish(); }, fail,
        (error) => {
          const key = String(error.key);
          if (!marked.has(key)) return false;
          ignored.add(key);
          return true;
        });
      request(tx.objectStore(META).get(ACTIVE), (id) => { active = id; finish(); }, fail);
      request(tx.objectStore(LEGACY).get(LEGACY_PAGE), (page) => { legacy = page; finish(); }, fail);
      request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
        storedOrder = pageOrder(value);
        finish();
      }, fail);
      request(tx.objectStore(META).get(RECOVERY_IGNORED_WORKSPACES), (value) => {
        markedWorkspaces = recoveryIds(value, RECOVERY_IGNORED_WORKSPACES);
        readWorkspaces(tx, (loaded) => { workspaces = loaded; finish(); }, fail,
          (error) => {
            const key = String(error.key);
            if (!markedWorkspaces.has(key)) return false;
            ignoredWorkspaces.add(key);
            return true;
          });
      }, fail);
    }, fail);
  });
}

class IndexedPageRepository implements PageRepository {
  constructor(
    private readonly db: IDBDatabase,
    private readonly ignored: IgnoredRecords,
  ) {}

  getRecoveryIssueIds(): string[] {
    return [...this.ignored.pages, ...[...this.ignored.workspaces].map((id) => `workspace:${id}`)];
  }

  close(): void {
    this.db.close();
  }

  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return transaction(this.db, [WORKSPACES], "readonly", (tx, done, fail) => {
      readWorkspaces(tx, (workspaces) => {
        done(workspaces
          .map((workspace) => ({
            ...workspace,
            pageIds: workspace.pageIds.filter((id) => !this.ignored.pages.has(id)),
          }))
          .filter((workspace) => workspace.pageIds.length > 0)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
      }, fail, (error) => this.ignored.workspaces.has(String(error.key)));
    });
  }

  getWorkspace(id: string): Promise<WorkspaceSummary | null> {
    if (this.ignored.workspaces.has(id)) return Promise.resolve(null);
    return transaction(this.db, [WORKSPACES], "readonly", (tx, done, fail) => {
      request(tx.objectStore(WORKSPACES).get(id), (value) => {
        if (value === undefined) return done(null);
        const workspace = validateWorkspace(value, id);
        const pageIds = workspace.pageIds.filter((pageId) => !this.ignored.pages.has(pageId));
        done(pageIds.length > 0 ? { ...workspace, pageIds } : null);
      }, fail);
    });
  }

  listWorkspacePages(id: string): Promise<PageSummary[]> {
    if (this.ignored.workspaces.has(id)) {
      return Promise.reject(new RangeError("Workspace does not exist"));
    }
    return transaction(this.db, [WORKSPACES, RECORDS], "readonly", (tx, done, fail) => {
      let workspace: WorkspaceSummary | undefined;
      let records: SavedPage[] | undefined;
      const finish = () => {
        if (!workspace || !records) return;
        const owned = new Set(workspace.pageIds);
        done(summaries(records.filter(({ page }) => owned.has(page.id)), workspace.pageIds));
      };
      request(tx.objectStore(WORKSPACES).get(id), (value) => {
        if (value === undefined) throw new RangeError("Workspace does not exist");
        workspace = validateWorkspace(value, id);
        finish();
      }, fail);
      readAll(tx, (value) => { records = value; finish(); }, fail,
        (error) => this.ignored.pages.has(String(error.key)));
    });
  }

  async createWorkspace(kind: WorkspaceKind, title: string): Promise<WorkspaceSummary> {
    const page = initialPage(kind);
    const workspace = newWorkspace(kind, title, [page.id], page.updatedAt);
    return transaction(this.db, [WORKSPACES, RECORDS, META], "readwrite", (tx, done, fail) => {
      readWorkspaces(tx, () => {
        request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
          const order = pageOrder(value) ?? [];
          const nextOrder = [...order, page.id];
          pageOrder(nextOrder);
          tx.objectStore(RECORDS).add({ page, corrections: {} }, page.id);
          tx.objectStore(WORKSPACES).add(workspace, workspace.id);
          tx.objectStore(META).put(nextOrder, PAGE_ORDER);
          tx.objectStore(META).put(page.id, ACTIVE);
          done(structuredClone(workspace));
        }, fail);
      }, fail, (error) => this.ignored.workspaces.has(String(error.key)));
    });
  }

  listPages(): Promise<PageSummary[]> {
    return transaction(this.db, [RECORDS, META], "readonly", (tx, done, fail) => {
      let records: SavedPage[] | undefined;
      let order: string[] | null | undefined;
      const finish = () => {
        if (records && order !== undefined) done(summaries(records, order ?? []));
      };
      readAll(tx, (value) => { records = value; finish(); }, fail,
        (error) => this.ignored.pages.has(String(error.key)));
      request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
        order = pageOrder(value);
        finish();
      }, fail);
    });
  }

  getPage(id: string): Promise<SavedPage | null> {
    return transaction(this.db, [RECORDS], "readonly", (tx, done, fail) => {
      request(tx.objectStore(RECORDS).get(id), (value) => {
        done(value === undefined ? null : validateSavedPage(value, id));
      }, fail);
    });
  }

  async savePage(record: SavedPage): Promise<void> {
    const snapshot = structuredClone(record);
    const key = typeof snapshot?.page?.id === "string" ? snapshot.page.id : "<invalid>";
    validateSavedPage(snapshot, key);
    return transaction(this.db, [RECORDS, META, WORKSPACES], "readwrite", (tx, done, fail) => {
      const store = tx.objectStore(RECORDS);
      request(store.get(snapshot.page.id), (existing) => {
        if (existing !== undefined) validateSavedPage(existing, snapshot.page.id);
        request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
          const order = pageOrder(value) ?? [];
          readWorkspaces(tx, (workspaces) => {
            let owner = ownerOf(workspaces, snapshot.page.id);
            if (!owner) {
              if (existing !== undefined) {
                throw new StoredDataError(RECORDS, snapshot.page.id, "page has no workspace", existing);
              }
              if (workspaces.length === 0) {
                owner = newWorkspace("notebook", "My Notebook",
                  [snapshot.page.id], snapshot.page.updatedAt);
              } else if (workspaces.length === 1 && workspaces[0]!.kind === "notebook") {
                owner = updatedWorkspace(workspaces[0]!,
                  [...workspaces[0]!.pageIds, snapshot.page.id]);
              } else {
                throw new RangeError("New page needs a notebook workspace");
              }
            } else {
              owner = updatedWorkspace(owner);
            }
            const nextOrder = existing === undefined
              ? [...order, snapshot.page.id] : order;
            pageOrder(nextOrder);
            validateWorkspace(owner, owner.id);
            tx.objectStore(META).put(nextOrder, PAGE_ORDER);
            tx.objectStore(WORKSPACES).put(owner, owner.id);
            store.put(snapshot, snapshot.page.id);
            done();
          }, fail, (error) => this.ignored.workspaces.has(String(error.key)));
        }, fail);
      }, fail);
    });
  }

  async savePageInNewNotebook(
    record: SavedPage,
    title = "Recovered notebook",
  ): Promise<WorkspaceSummary> {
    const snapshot = structuredClone(record);
    const key = typeof snapshot?.page?.id === "string" ? snapshot.page.id : "<invalid>";
    validateSavedPage(snapshot, key);
    const workspace = newWorkspace("notebook", title, [snapshot.page.id],
      Math.max(Date.now(), snapshot.page.updatedAt));
    return transaction(this.db, [RECORDS, META, WORKSPACES], "readwrite", (tx, done, fail) => {
      const store = tx.objectStore(RECORDS);
      request(store.get(snapshot.page.id), (existing) => {
        if (existing !== undefined) throw new RangeError("Page already exists");
        request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
          const order = pageOrder(value) ?? [];
          readWorkspaces(tx, (workspaces) => {
            if (order.includes(snapshot.page.id) || ownerOf(workspaces, snapshot.page.id)) {
              throw new RangeError("Page ID is already in use");
            }
            const nextOrder = [...order, snapshot.page.id];
            pageOrder(nextOrder);
            store.add(snapshot, snapshot.page.id);
            tx.objectStore(WORKSPACES).add(workspace, workspace.id);
            tx.objectStore(META).put(nextOrder, PAGE_ORDER);
            tx.objectStore(META).put(snapshot.page.id, ACTIVE);
            done(structuredClone(workspace));
          }, fail, (error) => this.ignored.workspaces.has(String(error.key)));
        }, fail);
      }, fail);
    });
  }

  async insertPageAfter(record: SavedPage, afterId: string): Promise<void> {
    const snapshot = structuredClone(record);
    const key = typeof snapshot?.page?.id === "string" ? snapshot.page.id : "<invalid>";
    validateSavedPage(snapshot, key);
    if (snapshot.page.id === afterId) throw new RangeError("Page cannot follow itself");
    return transaction(this.db, [RECORDS, META, WORKSPACES], "readwrite", (tx, done, fail) => {
      const store = tx.objectStore(RECORDS);
      request(store.get(afterId), (previous) => {
        if (previous === undefined) throw new RangeError("Previous page does not exist");
        validateSavedPage(previous, afterId);
        request(store.get(snapshot.page.id), (existing) => {
          if (existing !== undefined) throw new RangeError("Page already exists");
          request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
            const order = pageOrder(value) ?? [];
            readWorkspaces(tx, (workspaces) => {
              const owner = ownerOf(workspaces, afterId);
              if (!owner) {
                throw new StoredDataError(WORKSPACES, afterId, "page has no workspace");
              }
              if (owner.kind !== "notebook") {
                throw new RangeError("Cannot add pages to a whiteboard");
              }
              const index = order.indexOf(afterId);
              const ownerIndex = owner.pageIds.indexOf(afterId);
              if (index < 0 || ownerIndex < 0) {
                throw new StoredDataError(META, PAGE_ORDER, "missing previous page", value);
              }
              order.splice(index + 1, 0, snapshot.page.id);
              const pageIds = [...owner.pageIds];
              pageIds.splice(ownerIndex + 1, 0, snapshot.page.id);
              const updated = updatedWorkspace(owner, pageIds);
              pageOrder(order);
              validateWorkspace(updated, updated.id);
              store.add(snapshot, snapshot.page.id);
              tx.objectStore(META).put(order, PAGE_ORDER);
              tx.objectStore(WORKSPACES).put(updated, updated.id);
              done();
            }, fail, (error) => this.ignored.workspaces.has(String(error.key)));
          }, fail);
        }, fail);
      }, fail);
    });
  }

  deletePage(id: string): Promise<void> {
    return transaction(this.db, [RECORDS, META, WORKSPACES], "readwrite", (tx, done, fail) => {
      let records: SavedPage[] | undefined;
      let workspaces: WorkspaceSummary[] | undefined;
      let active: unknown;
      let order: string[] | null | undefined;
      let pending = 4;
      const finish = () => {
        if (--pending !== 0) return;
        if (!records || !workspaces || order === undefined ||
            !records.some(({ page }) => page.id === id)) {
          throw new RangeError("Page does not exist");
        }
        const owner = ownerOf(workspaces, id);
        if (!owner) throw new StoredDataError(WORKSPACES, id, "page has no workspace");
        const ownerIndex = owner.pageIds.indexOf(id);
        const pageIds = owner.pageIds.filter((pageId) => pageId !== id);
        const remaining = records.filter(({ page }) => page.id !== id);
        const store = tx.objectStore(RECORDS);
        const meta = tx.objectStore(META);
        const nextOrder = (order ?? []).filter((pageId) => pageId !== id);
        if (pageIds.every((pageId) => this.ignored.pages.has(pageId))) {
          const replacement = initialPage(owner.kind);
          store.put({ page: replacement, corrections: {} }, replacement.id);
          remaining.push({ page: replacement, corrections: {} });
          pageIds.push(replacement.id);
          const globalIndex = (order ?? []).indexOf(id);
          nextOrder.splice(globalIndex < 0 ? nextOrder.length : globalIndex, 0, replacement.id);
        }
        const availableIds = pageIds.filter((pageId) => !this.ignored.pages.has(pageId));
        const selected =
          typeof active === "string" && active !== id &&
          remaining.some(({ page }) => page.id === active)
            ? active
            : availableIds[Math.min(ownerIndex, availableIds.length - 1)]!;
        pageOrder(nextOrder);
        const updated = updatedWorkspace(owner, pageIds);
        validateWorkspace(updated, updated.id);
        meta.put(selected, ACTIVE);
        meta.put(nextOrder, PAGE_ORDER);
        tx.objectStore(WORKSPACES).put(updated, updated.id);
        store.delete(id);
        done();
      };
      readAll(tx, (value) => { records = value; finish(); }, fail,
        (error) => this.ignored.pages.has(String(error.key)));
      request(tx.objectStore(META).get(ACTIVE), (value) => { active = value; finish(); }, fail);
      request(tx.objectStore(META).get(PAGE_ORDER), (value) => {
        order = pageOrder(value);
        finish();
      }, fail);
      readWorkspaces(tx, (value) => { workspaces = value; finish(); }, fail,
        (error) => this.ignored.workspaces.has(String(error.key)));
    });
  }

  getActivePageId(): Promise<string | null> {
    return transaction(this.db, [META], "readonly", (tx, done, fail) => {
      request(tx.objectStore(META).get(ACTIVE), (value) => {
        if (value !== undefined && typeof value !== "string") {
          throw new StoredDataError(META, ACTIVE, "invalid active page ID", value);
        }
        done(value ?? null);
      }, fail);
    });
  }

  setActivePageId(id: string): Promise<void> {
    return transaction(this.db, [RECORDS, META], "readwrite", (tx, done, fail) => {
      request(tx.objectStore(RECORDS).get(id), (value) => {
        if (value === undefined) throw new RangeError("Page does not exist");
        validateSavedPage(value, id);
        tx.objectStore(META).put(id, ACTIVE);
        done();
      }, fail);
    });
  }
}

export async function openPageRepository(): Promise<PageRepository> {
  const db = await openDatabase();
  try {
    const ignored = await initialize(db);
    return new IndexedPageRepository(db, ignored);
  } catch (error) {
    db.close();
    throw error;
  }
}

// Call only after an explicit recovery choice; malformed records remain in place.
export async function startFreshAfterRecovery(): Promise<PageRepository> {
  const db = await openDatabase();
  try {
    const ignored: IgnoredRecords = { pages: new Set(), workspaces: new Set() };
    const fresh = createPage();
    const workspace = newWorkspace("notebook", "Recovered notebook", [fresh.id], fresh.updatedAt);
    await transaction<void>(db, [RECORDS, META, WORKSPACES], "readwrite", (tx, done, fail) => {
      readAll(tx, (records) => {
        readWorkspaces(tx, () => {
          const meta = tx.objectStore(META);
          request(meta.get(PAGE_ORDER), (value) => {
            let order: string[];
            try {
              order = pageOrder(value) ?? [];
            } catch {
              order = [];
            }
            const retained = orderedRecords(records, order).map(({ page }) => page.id);
            tx.objectStore(RECORDS).add({ page: fresh, corrections: {} }, fresh.id);
            tx.objectStore(WORKSPACES).add(workspace, workspace.id);
            meta.put(fresh.id, ACTIVE);
            meta.put([...retained, fresh.id], PAGE_ORDER);
            meta.put([...ignored.pages], RECOVERY_IGNORED);
            meta.put([...ignored.workspaces], RECOVERY_IGNORED_WORKSPACES);
            done();
          }, fail);
        }, fail, (error) => {
          if (typeof error.key !== "string" || !error.key || error.key.length > 128) {
            throw error;
          }
          ignored.workspaces.add(error.key);
          return true;
        });
      }, fail, (error) => {
        if (typeof error.key !== "string" || !error.key || error.key.length > 128) {
          throw error;
        }
        ignored.pages.add(error.key);
        return true;
      });
    });
    return new IndexedPageRepository(db, ignored);
  } catch (error) {
    db.close();
    throw error;
  }
}
