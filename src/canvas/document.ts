import type { Page, Point, Stroke } from "./types";

type Edit = { index: number; removed: Stroke[]; inserted: Stroke[] };
type Command = Edit[];
type Interval = [number, number];

const EPSILON = 1e-7;

function cloneStroke(stroke: Stroke): Stroke {
  return {
    id: stroke.id,
    width: stroke.width,
    points: stroke.points.map((point) => ({ ...point })),
  };
}

function validPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Point;
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (point.pressure === undefined ||
      (Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1)) &&
    (point.t === undefined || (Number.isFinite(point.t) && point.t >= 0))
  );
}

function validateStroke(value: unknown): asserts value is Stroke {
  if (typeof value !== "object" || value === null) throw new TypeError("Invalid stroke");
  const stroke = value as Stroke;
  if (
    typeof stroke.id !== "string" ||
    stroke.id.length === 0 ||
    !Number.isFinite(stroke.width) ||
    stroke.width <= 0 ||
    !Array.isArray(stroke.points) ||
    stroke.points.length === 0 ||
    stroke.points.some((point) => !validPoint(point))
  ) {
    throw new TypeError("Invalid stroke");
  }
}

function validatePage(value: unknown): asserts value is Page {
  if (typeof value !== "object" || value === null) throw new TypeError("Invalid page");
  const page = value as Page;
  if (
    page.schemaVersion !== 2 ||
    typeof page.id !== "string" ||
    page.id.length === 0 ||
    typeof page.title !== "string" ||
    page.title.length === 0 ||
    !Number.isFinite(page.createdAt) ||
    page.createdAt < 0 ||
    !Number.isFinite(page.updatedAt) ||
    page.updatedAt < page.createdAt ||
    !Array.isArray(page.strokes)
  ) {
    throw new TypeError("Invalid page");
  }
  const ids = new Set<string>();
  for (const stroke of page.strokes) {
    validateStroke(stroke);
    if (ids.has(stroke.id)) throw new TypeError(`Duplicate stroke ID: ${stroke.id}`);
    ids.add(stroke.id);
  }
}

function validatePath(path: readonly Point[], radius: number): void {
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some((point) => !validPoint(point)) ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    throw new TypeError("Invalid eraser gesture");
  }
}

function interpolate(a: Point, b: Point, fraction: number): Point {
  const point: Point = {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
  };
  if (a.pressure !== undefined || b.pressure !== undefined) {
    point.pressure =
      (a.pressure ?? b.pressure!) +
      ((b.pressure ?? a.pressure!) - (a.pressure ?? b.pressure!)) * fraction;
  }
  if (a.t !== undefined || b.t !== undefined) {
    point.t = (a.t ?? b.t!) + ((b.t ?? a.t!) - (a.t ?? b.t!)) * fraction;
  }
  return point;
}

function distanceSquaredToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const x = point.x - (a.x + fraction * dx);
  const y = point.y - (a.y + fraction * dy);
  return x * x + y * y;
}

function boxesMayMeet(a: Point, b: Point, c: Point, d: Point, radius: number): boolean {
  return (
    Math.max(a.x, b.x) + radius >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) + radius >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) + radius >= Math.min(c.y, d.y) &&
    Math.max(c.y, d.y) + radius >= Math.min(a.y, b.y)
  );
}

function closestFraction(a: Point, b: Point, c: Point, d: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = d.x - c.x;
  const wy = d.y - c.y;
  const strokeLengthSquared = vx * vx + vy * vy;
  const eraserLengthSquared = wx * wx + wy * wy;
  const candidates = [0, 1];
  const clamp = (value: number) => Math.max(0, Math.min(1, value));

  if (strokeLengthSquared > 0) {
    candidates.push(clamp(((c.x - a.x) * vx + (c.y - a.y) * vy) / strokeLengthSquared));
    candidates.push(clamp(((d.x - a.x) * vx + (d.y - a.y) * vy) / strokeLengthSquared));
  }
  if (eraserLengthSquared > 0) {
    const along = vx * wx + vy * wy;
    if (along !== 0) {
      const start = (c.x - a.x) * wx + (c.y - a.y) * wy;
      candidates.push(clamp(start / along), clamp((start + eraserLengthSquared) / along));
    }
    const cross = vx * wy - vy * wx;
    if (cross !== 0) {
      candidates.push(clamp(((c.x - a.x) * wy - (c.y - a.y) * wx) / cross));
    }
  }

  let closest = 0;
  let minimum = Infinity;
  for (const fraction of candidates) {
    const point = interpolate(a, b, fraction);
    const distance = distanceSquaredToSegment(point, c, d);
    if (distance < minimum) {
      minimum = distance;
      closest = fraction;
    }
  }
  return closest;
}

// Distance along AB to the eraser segment is convex; its hit set is one interval.
function erasedInterval(a: Point, b: Point, c: Point, d: Point, radius: number): Interval | null {
  if (!boxesMayMeet(a, b, c, d, radius)) return null;
  const limit = radius * radius;
  const distanceAt = (fraction: number) =>
    distanceSquaredToSegment(interpolate(a, b, fraction), c, d);
  const nearest = closestFraction(a, b, c, d);
  if (distanceAt(nearest) > limit) return null;
  if (distanceAt(0) <= limit && distanceAt(1) <= limit) return [0, 1];

  let low = 0;
  let high = nearest;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (distanceAt(middle) <= limit) high = middle;
    else low = middle;
  }
  const start = distanceAt(0) <= limit ? 0 : high;

  low = nearest;
  high = 1;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (distanceAt(middle) <= limit) low = middle;
    else high = middle;
  }
  const end = distanceAt(1) <= limit ? 1 : low;
  return [start, end];
}

function erasedIntervals(a: Point, b: Point, path: readonly Point[], radius: number): Interval[] {
  const intervals: Interval[] = [];
  for (let i = 0; i < path.length; i++) {
    const interval = erasedInterval(a, b, path[i], path[Math.min(i + 1, path.length - 1)], radius);
    if (interval) intervals.push(interval);
  }
  intervals.sort((left, right) => left[0] - right[0]);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1] + EPSILON) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function appendDistinct(points: Point[], point: Point): void {
  const last = points[points.length - 1];
  if (
    !last ||
    Math.hypot(last.x - point.x, last.y - point.y) > EPSILON ||
    last.pressure !== point.pressure ||
    last.t !== point.t
  ) {
    points.push(point);
  }
}

function pixelErase(stroke: Stroke, path: readonly Point[], radius: number): Point[][] | null {
  const contactRadius = radius + stroke.width / 2;
  if (stroke.points.length === 1) {
    const hit = path.some(
      (start, index) =>
        distanceSquaredToSegment(
          stroke.points[0],
          start,
          path[Math.min(index + 1, path.length - 1)],
        ) <=
        contactRadius * contactRadius,
    );
    return hit ? [] : null;
  }

  const fragments: Point[][] = [];
  let current: Point[] = [];
  let changed = false;
  for (let index = 0; index < stroke.points.length - 1; index++) {
    const a = stroke.points[index];
    const b = stroke.points[index + 1];
    const intervals = erasedIntervals(a, b, path, contactRadius);
    let cursor = 0;
    for (const [start, end] of intervals) {
      if (end - start <= EPSILON) continue;
      changed = true;
      if (start > cursor + EPSILON) {
        appendDistinct(current, interpolate(a, b, cursor));
        appendDistinct(current, interpolate(a, b, start));
      }
      if (current.length > 1) fragments.push(current);
      current = [];
      cursor = end;
    }
    if (cursor < 1 - EPSILON) {
      appendDistinct(current, interpolate(a, b, cursor));
      appendDistinct(current, b);
    }
  }
  if (current.length > 1) fragments.push(current);
  return changed ? fragments : null;
}

function strokeHit(stroke: Stroke, path: readonly Point[], radius: number): boolean {
  const contactRadius = radius + stroke.width / 2;
  if (stroke.points.length === 1) {
    return path.some(
      (start, index) =>
        distanceSquaredToSegment(
          stroke.points[0],
          start,
          path[Math.min(index + 1, path.length - 1)],
        ) <=
        contactRadius * contactRadius,
    );
  }
  for (let index = 0; index < stroke.points.length - 1; index++) {
    if (erasedIntervals(stroke.points[index], stroke.points[index + 1], path, contactRadius).length) {
      return true;
    }
  }
  return false;
}

function nextTimestamp(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

export class InkDocument {
  private data: Page;
  private done: Command[] = [];
  private undone: Command[] = [];

  constructor(page: Page) {
    validatePage(page);
    this.data = {
      schemaVersion: 2,
      id: page.id,
      title: page.title,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      strokes: page.strokes.map(cloneStroke),
    };
  }

  get page(): Page {
    return { ...this.data, strokes: this.data.strokes.map(cloneStroke) };
  }

  get strokes(): readonly Stroke[] {
    return this.data.strokes.map(cloneStroke);
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  addStroke(stroke: Stroke): boolean {
    validateStroke(stroke);
    if (this.data.strokes.some((existing) => existing.id === stroke.id)) {
      throw new TypeError(`Duplicate stroke ID: ${stroke.id}`);
    }
    return this.commit([{ index: this.data.strokes.length, removed: [], inserted: [cloneStroke(stroke)] }]);
  }

  eraseStrokes(path: readonly Point[], radius: number): boolean {
    validatePath(path, radius);
    const edits: Edit[] = [];
    this.data.strokes.forEach((stroke, index) => {
      if (strokeHit(stroke, path, radius)) {
        edits.push({ index, removed: [stroke], inserted: [] });
      }
    });
    return this.commit(edits);
  }

  erasePixels(path: readonly Point[], radius: number): boolean {
    validatePath(path, radius);
    const edits: Edit[] = [];
    const ids = new Set(this.data.strokes.map((stroke) => stroke.id));
    this.data.strokes.forEach((stroke, index) => {
      const pieces = pixelErase(stroke, path, radius);
      if (pieces === null) return;
      const inserted = pieces.map((points) => {
        let id: string;
        do {
          id = crypto.randomUUID();
        } while (ids.has(id));
        ids.add(id);
        return { id, width: stroke.width, points };
      });
      inserted.forEach(validateStroke);
      edits.push({ index, removed: [stroke], inserted });
    });
    return this.commit(edits);
  }

  clear(): boolean {
    if (this.data.strokes.length === 0) return false;
    return this.commit([{ index: 0, removed: [...this.data.strokes], inserted: [] }]);
  }

  undo(): boolean {
    const command = this.done.at(-1);
    if (!command) return false;
    this.apply(command, false);
    this.done.pop();
    this.undone.push(command);
    this.touchUpdatedAt();
    return true;
  }

  redo(): boolean {
    const command = this.undone.at(-1);
    if (!command) return false;
    this.apply(command, true);
    this.undone.pop();
    this.done.push(command);
    this.touchUpdatedAt();
    return true;
  }

  setTitle(title: string): boolean {
    if (typeof title !== "string") throw new TypeError("Invalid page title");
    const normalized = title.trim() || "Untitled page";
    if (normalized.length > 80) throw new RangeError("Page title is too long");
    if (this.data.title === normalized) return false;
    this.data.title = normalized;
    this.touchUpdatedAt();
    return true;
  }

  touchUpdatedAt(): void {
    this.data.updatedAt = nextTimestamp(this.data.updatedAt);
  }

  private commit(command: Command): boolean {
    if (command.length === 0) return false;
    this.apply(command, true);
    this.done.push(command);
    this.undone = [];
    this.touchUpdatedAt();
    return true;
  }

  private apply(command: Command, forward: boolean): void {
    const next = [...this.data.strokes];
    if (forward) {
      for (let i = command.length - 1; i >= 0; i--) {
        const { index, removed, inserted } = command[i];
        next.splice(index, removed.length, ...inserted);
      }
    } else {
      for (const { index, removed, inserted } of command) {
        next.splice(index, inserted.length, ...removed);
      }
    }
    this.data.strokes = next;
  }
}
