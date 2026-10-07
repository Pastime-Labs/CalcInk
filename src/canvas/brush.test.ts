import { describe, expect, it } from "vitest";
import { DEFAULT_INK_COLOR, displayInkColor, segmentWidths } from "./brush";

describe("notebook ink display", () => {
  it("lightens legacy dark ink only on dark notebook paper", () => {
    for (const color of ["#121619", DEFAULT_INK_COLOR, "#121619".toUpperCase(), undefined]) {
      expect(displayInkColor(color, true)).toBe("#d9ddde");
    }
    expect(displayInkColor("#121619", false)).toBe("#121619");
    expect(displayInkColor(DEFAULT_INK_COLOR, false)).toBe(DEFAULT_INK_COLOR);
    expect(displayInkColor(undefined, false)).toBe(DEFAULT_INK_COLOR);
    expect(displayInkColor("#ed3152", true)).toBe("#ed3152");
  });
});

describe("speed-sensitive brush widths", () => {
  it("smooths fast movement within bounds while keeping a deterministic timestamp fallback", () => {
    const stroke = {
      width: 10,
      points: [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 20 },
        { x: 21, y: 0, t: 30 },
        { x: 41, y: 0, t: 40 },
        { x: 42, y: 0, t: 40 },
      ],
    };
    const widths = segmentWidths(stroke);
    expect(widths[1]).toBeLessThan(widths[0]);
    expect(widths[2]).toBeLessThan(widths[1]);
    expect(widths.every((width) => width >= 5.5 && width <= 10)).toBe(true);
    expect(widths[3]).toBeGreaterThan(widths[2]);
    expect(segmentWidths(stroke)).toEqual(widths);
    expect(segmentWidths({ width: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }))
      .toEqual([10]);
  });

  it("retains stylus pressure in the speed response", () => {
    const unpressed = segmentWidths({
      width: 10,
      points: [{ x: 0, y: 0, pressure: 0, t: 0 }, { x: 10, y: 0, pressure: 0, t: 10 }],
    });
    const pressed = segmentWidths({
      width: 10,
      points: [{ x: 0, y: 0, pressure: 1, t: 0 }, { x: 10, y: 0, pressure: 1, t: 10 }],
    });
    expect(unpressed[0]).toBeCloseTo(pressed[0] * 0.45);
  });
});
