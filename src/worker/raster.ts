import type { Point, Stroke } from "../canvas/types";
import { pointWidth, segmentWidths, validInkColor, validStrokeStyle } from "../canvas/brush";

export const RASTER_VERSION = "paddle-raster-v2";

const MAX_STROKES = 256;
const MAX_POINTS = 20_000;
const MAX_STROKE_WIDTH = 128;
const MAX_WIDTH = 2048;
const MAX_HEIGHT = 512;
const MIN_SCALE = 0.25;
const INK_COLOR = "#263133";

export class InvalidInkError extends Error {
  constructor() {
    super("Invalid or oversized ink line");
    this.name = "InvalidInkError";
  }
}

export type RasterPlan = {
  left: number;
  top: number;
  padding: number;
  scale: number;
  width: number;
  height: number;
};

function validPoint(point: Point): boolean {
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && (point.pressure === undefined
      || (Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1))
    && (point.t === undefined || (Number.isFinite(point.t) && point.t >= 0));
}

export function planRaster(strokes: readonly Stroke[]): RasterPlan {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > MAX_STROKES) {
    throw new InvalidInkError();
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let maxStrokeWidth = 0;
  let pointCount = 0;

  for (const stroke of strokes) {
    if (!stroke || !Number.isFinite(stroke.width)
      || stroke.width <= 0 || stroke.width > MAX_STROKE_WIDTH
      || (stroke.color !== undefined && !validInkColor(stroke.color))
      || (stroke.style !== undefined && !validStrokeStyle(stroke.style))
      || !Array.isArray(stroke.points) || stroke.points.length === 0) {
      throw new InvalidInkError();
    }
    pointCount += stroke.points.length;
    if (pointCount > MAX_POINTS) throw new InvalidInkError();
    maxStrokeWidth = Math.max(maxStrokeWidth, stroke.width);
    const radius = stroke.width / 2;
    for (const point of stroke.points) {
      if (!point || !validPoint(point)) throw new InvalidInkError();
      left = Math.min(left, point.x - radius);
      top = Math.min(top, point.y - radius);
      right = Math.max(right, point.x + radius);
      bottom = Math.max(bottom, point.y + radius);
    }
  }

  const padding = Math.max(18, 3 * maxStrokeWidth);
  const worldWidth = right - left + 2 * padding;
  const worldHeight = bottom - top + 2 * padding;
  const scale = Math.min(2, MAX_WIDTH / worldWidth, MAX_HEIGHT / worldHeight);
  if (!Number.isFinite(scale) || scale < MIN_SCALE) throw new InvalidInkError();
  const width = Math.max(1, Math.ceil(worldWidth * scale));
  const height = Math.max(1, Math.ceil(worldHeight * scale));
  if (width > MAX_WIDTH || height > MAX_HEIGHT) throw new InvalidInkError();
  return { left, top, padding, scale, width, height };
}

function drawStroke(context: OffscreenCanvasRenderingContext2D, stroke: Stroke): void {
  const { points, width } = stroke;
  context.strokeStyle = INK_COLOR;
  context.fillStyle = INK_COLOR;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (points.length === 1) {
    context.beginPath();
    context.arc(
      points[0].x, points[0].y,
      pointWidth(width, points[0]) / 2, 0, Math.PI * 2,
    );
    context.fill();
  } else if (points.some((point) => point.pressure !== undefined || point.t !== undefined)) {
    const widths = segmentWidths(stroke);
    for (let i = 1; i < points.length; i++) {
      context.lineWidth = widths[i - 1];
      context.beginPath();
      context.moveTo(points[i - 1].x, points[i - 1].y);
      context.lineTo(points[i].x, points[i].y);
      context.stroke();
    }
  } else {
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    context.stroke();
  }
}

export function rasterizeLine(strokes: readonly Stroke[]): {
  image: ImageBitmap;
  plan: RasterPlan;
} {
  const plan = planRaster(strokes);
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is unavailable");
  }
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("OffscreenCanvas 2D is unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, plan.width, plan.height);
  context.setTransform(
    plan.scale, 0, 0, plan.scale,
    (plan.padding - plan.left) * plan.scale,
    (plan.padding - plan.top) * plan.scale,
  );
  for (const stroke of strokes) drawStroke(context, stroke);
  return { image: canvas.transferToImageBitmap(), plan };
}
