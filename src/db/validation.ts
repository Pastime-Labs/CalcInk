import type { Page, Stroke } from "../canvas/types";
import { validInkColor, validStrokeStyle } from "../canvas/brush";

export type SavedPage = {
  page: Page;
  corrections: Record<string, string>;
};

export class StoredDataError extends Error {
  constructor(
    readonly store: string,
    readonly key: IDBValidKey,
    reason: string,
    readonly original?: unknown,
  ) {
    super(`${store}[${String(key)}]: ${reason}`);
    this.name = "StoredDataError";
  }
}

const MAX_STROKES = 10_000;
const MAX_POINTS = 200_000;
const MAX_POINTS_PER_STROKE = 20_000;
const MAX_CORRECTIONS = 5_000;

function object(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validStrokes(value: unknown): value is Stroke[] {
  if (!Array.isArray(value) || value.length > MAX_STROKES) return false;
  const ids = new Set<string>();
  let totalPoints = 0;
  for (const stroke of value) {
    if (
      !object(stroke) ||
      !text(stroke.id, 128) ||
      ids.has(stroke.id) ||
      !finite(stroke.width) ||
      stroke.width <= 0 ||
      (stroke.color !== undefined && !validInkColor(stroke.color)) ||
      (stroke.style !== undefined && !validStrokeStyle(stroke.style)) ||
      !Array.isArray(stroke.points) ||
      stroke.points.length === 0 ||
      stroke.points.length > MAX_POINTS_PER_STROKE
    ) {
      return false;
    }
    ids.add(stroke.id);
    totalPoints += stroke.points.length;
    if (totalPoints > MAX_POINTS) return false;
    for (const point of stroke.points) {
      if (
        !object(point) ||
        !finite(point.x) ||
        !finite(point.y) ||
        (point.pressure !== undefined &&
          (!finite(point.pressure) || point.pressure < 0 || point.pressure > 1)) ||
        (point.t !== undefined && (!finite(point.t) || point.t < 0))
      ) {
        return false;
      }
    }
  }
  return true;
}

function validCorrections(value: unknown): value is Record<string, string> {
  if (!object(value) || Object.keys(value).length > MAX_CORRECTIONS) return false;
  return Object.entries(value).every(
    ([key, correction]) => text(key, 512) && typeof correction === "string" && correction.length <= 512,
  );
}

export function validateSavedPage(value: unknown, key: IDBValidKey): SavedPage {
  const bad = (reason: string): never => {
    throw new StoredDataError("pageRecords", key, reason, value);
  };
  if (!object(value) || !object(value.page)) return bad("invalid page wrapper");
  const page = value.page;
  if (page.schemaVersion !== 2 && page.schemaVersion !== 3) {
    return bad("unsupported page schema");
  }
  if (page.schemaVersion === 3 &&
      (page.geometry !== "a4" && page.geometry !== "legacy" ||
       page.template !== "blank" && page.template !== "ruled" &&
       page.template !== "grid" && page.template !== "dots")) {
    return bad("invalid page geometry or template");
  }
  if (page.schemaVersion === 2 && (page.geometry !== undefined || page.template !== undefined)) {
    return bad("invalid legacy page metadata");
  }
  if (!text(page.id, 128) || page.id !== key) return bad("invalid page ID");
  if (!text(page.title, 80)) return bad("invalid title");
  if (
    !finite(page.createdAt) ||
    page.createdAt < 0 ||
    !finite(page.updatedAt) ||
    page.updatedAt < page.createdAt
  ) {
    return bad("invalid timestamps");
  }
  if (!validStrokes(page.strokes)) return bad("invalid strokes");
  if (!validCorrections(value.corrections)) return bad("invalid corrections");
  return value as unknown as SavedPage;
}

export function validateLegacyPage(value: unknown): {
  title: string;
  strokes: Stroke[];
  corrections: Record<string, string>;
} {
  const bad = (reason: string): never => {
    throw new StoredDataError("pages", "working-page", reason, value);
  };
  if (!object(value) || value.schemaVersion !== 1) return bad("unsupported legacy schema");
  if (!text(value.title, 80)) return bad("invalid legacy title");
  if (!validStrokes(value.strokes)) return bad("invalid legacy strokes");
  const corrections = value.corrections ?? {};
  if (!validCorrections(corrections)) return bad("invalid legacy corrections");
  return {
    title: value.title,
    strokes: value.strokes,
    corrections,
  };
}

export function serializeRecoveryRecord(error: StoredDataError): string | null {
  const seen = new WeakSet<object>();
  const jsonValue = (value: unknown): boolean => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.every(jsonValue);
    return object(value) && Object.values(value).every(jsonValue);
  };
  if (!jsonValue(error.original)) return null;
  try {
    return JSON.stringify(error.original);
  } catch {
    return null;
  }
}
