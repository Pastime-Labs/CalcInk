import type { Page } from "../canvas/types";
import {
  StoredDataError,
  validateLegacyPage,
  validateSavedPage,
  type SavedPage,
} from "./validation";

export type { SavedPage } from "./validation";
export { StoredDataError, serializeRecoveryRecord } from "./validation";

export type PageSummary = { id: string; title: string; updatedAt: number };

export interface PageRepository {
  listPages(): Promise<PageSummary[]>;
  getPage(id: string): Promise<SavedPage | null>;
  savePage(record: SavedPage): Promise<void>;
  deletePage(id: string): Promise<void>;
  getActivePageId(): Promise<string | null>;
  setActivePageId(id: string): Promise<void>;
  getRecoveryIssueIds(): string[];
  close(): void;
}

const DATABASE_NAME = "calcink";
const DATABASE_VERSION = 2;
const RECORDS = "pageRecords";
const META = "meta";
const LEGACY = "pages";
const ACTIVE = "activePageId";
const RECOVERY_IGNORED = "recoveryIgnoredPageIds";
const LEGACY_PAGE = "working-page";

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

function summaries(records: SavedPage[]): PageSummary[] {
  return records
    .map(({ page }) => ({ id: page.id, title: page.title, updatedAt: page.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
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

export function createPage(title = "Untitled page"): Page {
  const normalized = title.trim() || "Untitled page";
  if (normalized.length > 80) throw new RangeError("Page title is too long");
  const now = Date.now();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    title: normalized,
    createdAt: now,
    updatedAt: now,
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

function recoveryIds(value: unknown): Set<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > 10_000 ||
      value.some((id) => typeof id !== "string" || !id || id.length > 128)) {
    throw new StoredDataError(META, RECOVERY_IGNORED, "invalid recovery marker", value);
  }
  return new Set(value);
}

async function initialize(db: IDBDatabase): Promise<Set<string>> {
  return transaction(db, [RECORDS, META, LEGACY], "readwrite", (tx, done, fail) => {
    let records: SavedPage[] | undefined;
    let active: unknown;
    let legacy: unknown;
    let marked = new Set<string>();
    let ignored = new Set<string>();
    let pending = 3;
    const finish = () => {
      if (--pending !== 0) return;
      if (!records) throw new Error("Page records were not loaded");
      const meta = tx.objectStore(META);
      if (records.length > 0) {
        const sorted = summaries(records);
        const selected =
          typeof active === "string" && records.some(({ page }) => page.id === active)
            ? active
            : sorted[0]!.id;
        if (active !== selected) meta.put(selected, ACTIVE);
      } else if (ignored.size > 0) {
        throw new StoredDataError(RECORDS, "<recovery>", "no valid page remains");
      } else if (legacy !== undefined) {
        const old = validateLegacyPage(legacy);
        const page = createPage(old.title);
        page.strokes = old.strokes;
        tx.objectStore(RECORDS).put({ page, corrections: old.corrections }, page.id);
        meta.put(page.id, ACTIVE);
      } else if (active !== undefined) {
        meta.delete(ACTIVE);
      }
      done(ignored);
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
    }, fail);
  });
}

class IndexedPageRepository implements PageRepository {
  constructor(
    private readonly db: IDBDatabase,
    private readonly ignored: ReadonlySet<string>,
  ) {}

  getRecoveryIssueIds(): string[] {
    return [...this.ignored];
  }

  close(): void {
    this.db.close();
  }

  listPages(): Promise<PageSummary[]> {
    return transaction(this.db, [RECORDS], "readonly", (tx, done, fail) => {
      readAll(tx, (records) => done(summaries(records)), fail,
        (error) => this.ignored.has(String(error.key)));
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
    return transaction(this.db, [RECORDS], "readwrite", (tx, done, fail) => {
      const store = tx.objectStore(RECORDS);
      request(store.get(snapshot.page.id), (existing) => {
        if (existing !== undefined) validateSavedPage(existing, snapshot.page.id);
        store.put(snapshot, snapshot.page.id);
        done();
      }, fail);
    });
  }

  deletePage(id: string): Promise<void> {
    return transaction(this.db, [RECORDS, META], "readwrite", (tx, done, fail) => {
      let records: SavedPage[] | undefined;
      let active: unknown;
      let pending = 2;
      const finish = () => {
        if (--pending !== 0) return;
        if (!records || !records.some(({ page }) => page.id === id)) {
          throw new RangeError("Page does not exist");
        }
        const remaining = records.filter(({ page }) => page.id !== id);
        const store = tx.objectStore(RECORDS);
        const meta = tx.objectStore(META);
        let selected = summaries(remaining)[0]?.id;
        if (!selected) {
          const replacement = createPage();
          store.put({ page: replacement, corrections: {} }, replacement.id);
          selected = replacement.id;
        } else if (typeof active === "string" && active !== id &&
                   remaining.some(({ page }) => page.id === active)) {
          selected = active;
        }
        meta.put(selected, ACTIVE);
        store.delete(id);
        done();
      };
      readAll(tx, (value) => { records = value; finish(); }, fail,
        (error) => this.ignored.has(String(error.key)));
      request(tx.objectStore(META).get(ACTIVE), (value) => { active = value; finish(); }, fail);
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
    const ignored = new Set<string>();
    const fresh = createPage();
    await transaction<void>(db, [RECORDS, META], "readwrite", (tx, done, fail) => {
      readAll(tx, () => {
        tx.objectStore(RECORDS).add({ page: fresh, corrections: {} }, fresh.id);
        const meta = tx.objectStore(META);
        meta.put(fresh.id, ACTIVE);
        meta.put([...ignored], RECOVERY_IGNORED);
        done();
      }, fail, (error) => {
        if (typeof error.key !== "string" || !error.key || error.key.length > 128) {
          throw error;
        }
        ignored.add(error.key);
        return true;
      });
    });
    return new IndexedPageRepository(db, ignored);
  } catch (error) {
    db.close();
    throw error;
  }
}
