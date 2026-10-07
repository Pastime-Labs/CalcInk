import type { Point, Stroke, StrokeStyle } from "./types";

export const DEFAULT_INK_COLOR = "#263133";

export function displayInkColor(color: string | undefined, darkPaper: boolean): string {
  const ink = color ?? DEFAULT_INK_COLOR;
  return darkPaper && (ink.toLowerCase() === "#121619" || ink.toLowerCase() === DEFAULT_INK_COLOR)
    ? "#d9ddde" : ink;
}

export function validInkColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function validStrokeStyle(value: unknown): value is StrokeStyle {
  return value === "pen" || value === "pencil";
}

export function pointWidth(width: number, point: Pick<Point, "pressure">): number {
  return width * (point.pressure === undefined ? 1 : 0.45 + point.pressure * 0.55);
}

export function segmentWidths(stroke: Pick<Stroke, "points" | "width">): number[] {
  const widths: number[] = [];
  let response = 1;
  for (let index = 1; index < stroke.points.length; index++) {
    const before = stroke.points[index - 1];
    const after = stroke.points[index];
    const elapsed = before.t === undefined || after.t === undefined ? 0 : after.t - before.t;
    const speed = elapsed > 0
      ? Math.hypot(after.x - before.x, after.y - before.y) / Math.max(8, elapsed)
      : 0;
    const target = Math.max(0.55, 1 - Math.min(speed, 2) * 0.225);
    response += (target - response) * 0.5;
    const pressure = ((before.pressure ?? 1) + (after.pressure ?? 1)) / 2;
    widths.push(stroke.width * response * (0.45 + pressure * 0.55));
  }
  return widths;
}
