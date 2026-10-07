import { strokeBounds } from "./lines";
import type { Point, Stroke } from "./types";

type Position = Pick<Point, "x" | "y">;
type PageSize = { width: number; height: number };

const EPSILON = 1e-9;

function distanceSquaredToSegment(point: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const x = point.x - a.x - fraction * dx;
  const y = point.y - a.y - fraction * dy;
  return x * x + y * y;
}

function segmentsWithinDistance(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
  distance: number,
): boolean {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) > EPSILON) {
    const acX = c.x - a.x;
    const acY = c.y - a.y;
    const alongAB = (acX * cdY - acY * cdX) / denominator;
    const alongCD = (acX * abY - acY * abX) / denominator;
    if (
      alongAB >= -EPSILON && alongAB <= 1 + EPSILON &&
      alongCD >= -EPSILON && alongCD <= 1 + EPSILON
    ) return true;
  }

  const limit = distance * distance + EPSILON;
  return (
    distanceSquaredToSegment(a, c, d) <= limit ||
    distanceSquaredToSegment(b, c, d) <= limit ||
    distanceSquaredToSegment(c, a, b) <= limit ||
    distanceSquaredToSegment(d, a, b) <= limit
  );
}

function pointInPolygon(point: Position, polygon: readonly Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous];
    const b = polygon[index];
    if (distanceSquaredToSegment(point, a, b) <= EPSILON) return true;
    if ((a.y > point.y) !== (b.y > point.y)) {
      const crossingX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (point.x < crossingX) inside = !inside;
    }
  }
  return inside;
}

function strokeIntersectsPolygon(stroke: Stroke, polygon: readonly Position[]): boolean {
  if (stroke.points.some((point) => pointInPolygon(point, polygon))) return true;
  const radius = stroke.width / 2;
  for (let index = 0; index < stroke.points.length; index++) {
    const a = stroke.points[index];
    const b = stroke.points[Math.min(index + 1, stroke.points.length - 1)];
    for (let edge = 0; edge < polygon.length; edge++) {
      if (
        segmentsWithinDistance(
          a,
          b,
          polygon[edge],
          polygon[(edge + 1) % polygon.length],
          radius,
        )
      ) return true;
    }
  }
  return false;
}

export function selectStrokeIds(
  strokes: readonly Stroke[],
  polygon: readonly Position[],
): Set<string> {
  if (polygon.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new TypeError("Invalid lasso path");
  }
  if (polygon.length < 3) return new Set();
  return new Set(
    strokes
      .filter((stroke) => stroke.points.length > 0 && strokeIntersectsPolygon(stroke, polygon))
      .map((stroke) => stroke.id),
  );
}

export function translateStrokeSelection(
  strokes: readonly Stroke[],
  selectedIds: ReadonlySet<string>,
  dx: number,
  dy: number,
  bounds: PageSize | null,
): Stroke[] | null {
  if (
    !Number.isFinite(dx) || !Number.isFinite(dy) ||
    (bounds !== null && (!Number.isFinite(bounds.width) || bounds.width <= 0 ||
      !Number.isFinite(bounds.height) || bounds.height <= 0))
  ) throw new RangeError("Invalid lasso move or page size");

  if (bounds !== null) {
    for (const stroke of strokes) {
      if (!selectedIds.has(stroke.id)) continue;
      const box = strokeBounds(stroke);
      if (
        box.left + dx < -EPSILON || box.right + dx > bounds.width + EPSILON ||
        box.top + dy < -EPSILON || box.bottom + dy > bounds.height + EPSILON
      ) return null;
    }
  }

  return strokes.map((stroke) => selectedIds.has(stroke.id)
    ? {
      ...stroke,
      points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    }
    : stroke);
}
