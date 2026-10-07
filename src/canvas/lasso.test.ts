import { describe, expect, it } from "vitest";
import { selectStrokeIds, translateStrokeSelection } from "./lasso";
import type { Stroke } from "./types";

const square = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 30 },
  { x: 10, y: 30 },
  { x: 10, y: 10 },
];

const stroke = (id: string, points: Stroke["points"], width = 2): Stroke =>
  ({ id, points, width });

describe("lasso selection", () => {
  it("selects whole strokes when an unsampled segment crosses the polygon", () => {
    const crossing = stroke("crossing", [{ x: 0, y: 20 }, { x: 40, y: 20 }]);
    const dot = stroke("dot", [{ x: 20, y: 20 }]);
    const outside = stroke("outside", [{ x: 40, y: 40 }, { x: 50, y: 50 }]);
    expect(selectStrokeIds([crossing, dot, outside], square)).toEqual(new Set(["crossing", "dot"]));
  });

  it("includes contact with a thick stroke and ignores short gestures", () => {
    const touching = stroke("touching", [{ x: 8, y: 15 }, { x: 8, y: 25 }], 4);
    expect(selectStrokeIds([touching], square)).toEqual(new Set(["touching"]));
    expect(selectStrokeIds([touching], square.slice(0, 2))).toEqual(new Set());
  });
});

describe("lasso movement", () => {
  it("moves only selected strokes and preserves style and point metadata", () => {
    const selected = {
      ...stroke("selected", [{ x: 10, y: 20, pressure: 0.7, t: 12 }]),
      color: "#ff0000",
      brush: "pencil",
    };
    const untouched = stroke("untouched", [{ x: 50, y: 50 }]);
    const result = translateStrokeSelection(
      [selected, untouched],
      new Set(["selected"]),
      5,
      -3,
      { width: 100, height: 100 },
    );
    expect(result?.[0]).toEqual({
      ...selected,
      points: [{ x: 15, y: 17, pressure: 0.7, t: 12 }],
    });
    expect(result?.[1]).toBe(untouched);
    expect(selected.points[0]).toEqual({ x: 10, y: 20, pressure: 0.7, t: 12 });
  });

  it("rejects moves that would clip ink at any A4 page edge", () => {
    const selected = stroke("selected", [{ x: 10, y: 10 }, { x: 90, y: 90 }], 4);
    const bounds = { width: 100, height: 100 };
    expect(translateStrokeSelection([selected], new Set(["selected"]), 8, 8, bounds))
      .not.toBeNull();
    expect(translateStrokeSelection([selected], new Set(["selected"]), 9, 0, bounds))
      .toBeNull();
    expect(translateStrokeSelection([selected], new Set(["selected"]), 0, -9, bounds))
      .toBeNull();
  });

  it("moves whiteboard ink across negative world coordinates", () => {
    const selected = stroke("selected", [{ x: 4, y: 5 }]);
    expect(translateStrokeSelection([selected], new Set(["selected"]), -20, -30, null))
      .toMatchObject([{ points: [{ x: -16, y: -25 }] }]);
  });
});
