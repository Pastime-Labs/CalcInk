import { describe, expect, it, vi } from "vitest";
import {
  answerDisplayText,
  answerFootprint,
  canvasBackingSize,
  drawStroke,
  placeAnswerProjections,
  rectsOverlap,
  type AnswerProjection,
} from "./render";
import type { Stroke } from "./types";

const line: Stroke = {
  id: "line",
  width: 2,
  points: [
    { x: 0, y: 20 },
    { x: 100, y: 20 },
  ],
};

const answer = (lineId: string, x: number, y = 20): AnswerProjection => ({
  lineId,
  anchor: { x, y },
  text: "42",
  source: "automatic",
});

describe("DPR-safe canvas projection", () => {
  it("scales only backing pixels, not world coordinates", () => {
    expect(canvasBackingSize(200, 101, 1)).toEqual({ width: 200, height: 101 });
    expect(canvasBackingSize(200, 101, 1.5)).toEqual({ width: 300, height: 152 });
    expect(canvasBackingSize(200, 101, 2)).toEqual({ width: 400, height: 202 });
    expect(() => canvasBackingSize(200, 101, 0)).toThrow();
    expect(() => canvasBackingSize(Infinity, 101, 1)).toThrow();
  });

  it("places a right-edge result beside its anchor", () => {
    const measure = vi.fn(() => 30);
    const { placed, conflicts } = placeAnswerProjections([answer("one", 100)], [line], measure);
    expect(conflicts.size).toBe(0);
    expect(placed[0].footprint).toEqual({ left: 112, top: 6, right: 142, bottom: 34 });
    expect(measure).toHaveBeenCalledWith("42 (Review read)");
  });

  it("spells out answer provenance and unreadable state without relying on color", () => {
    expect(answerDisplayText(answer("one", 100))).toBe("42 (Review read)");
    expect(answerDisplayText({ ...answer("one", 100), source: "corrected" }))
      .toBe("42 (Corrected)");
    expect(answerDisplayText({
      ...answer("one", 100),
      text: "Fix in Readback",
      source: "attention",
    })).toBe("Fix in Readback");
  });

  it("reports ink and projection collisions instead of overlapping them", () => {
    const nearbyInk: Stroke = {
      id: "next",
      width: 2,
      points: [
        { x: 120, y: 10 },
        { x: 120, y: 30 },
      ],
    };
    const inkConflict = placeAnswerProjections([answer("one", 100)], [line, nearbyInk], () => 30);
    expect(inkConflict.placed).toEqual([]);
    expect(inkConflict.conflicts).toEqual(new Set(["one"]));

    const answerConflict = placeAnswerProjections(
      [answer("one", 100), answer("two", 120)],
      [line],
      () => 30,
    );
    expect(answerConflict.placed.map((item) => item.projection.lineId)).toEqual(["one"]);
    expect(answerConflict.conflicts).toEqual(new Set(["two"]));
    expect(rectsOverlap(answerFootprint({ x: 100, y: 20 }, 30), {
      left: 200,
      top: 0,
      right: 220,
      bottom: 30,
    })).toBe(false);
  });

  it("renders a one-point stroke as a dot and a path with round joins", () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawStroke(context, { width: 4, points: [{ x: 10, y: 20 }] });
    expect(context.arc).toHaveBeenCalledWith(10, 20, 2, 0, Math.PI * 2);
    expect(context.fill).toHaveBeenCalledTimes(1);
    drawStroke(context, line);
    expect(context.moveTo).toHaveBeenCalledWith(0, 20);
    expect(context.lineTo).toHaveBeenCalledWith(100, 20);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    expect(context.lineCap).toBe("round");
    expect(context.lineJoin).toBe("round");
  });
});
