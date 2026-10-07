import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stroke } from "../canvas/types";
import { InvalidInkError, planRaster, rasterizeLine } from "./raster";

function stroke(id: string, x: number, y: number, width = 4): Stroke {
  return { id, width, points: [{ x, y }] };
}

afterEach(() => vi.unstubAllGlobals());

describe("planRaster", () => {
  it("pads separated marks without connecting pen lifts", () => {
    const plan = planRaster([stroke("decimal", 20, 30), stroke("equals", 120, 30)]);
    expect(plan).toEqual({
      left: 18,
      top: 28,
      padding: 18,
      scale: 2,
      width: 280,
      height: 80,
    });
  });

  it("is independent of page translation and device pixel ratio", () => {
    const local = planRaster([stroke("dot", 20, 30)]);
    const shifted = planRaster([stroke("dot", 520, -70)]);
    expect([shifted.width, shifted.height, shifted.scale]).toEqual([
      local.width, local.height, local.scale,
    ]);
  });

  it("bounds a long line to the raster budget", () => {
    const plan = planRaster([{
      id: "long",
      width: 4,
      points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
    }]);
    expect(plan.width).toBeLessThanOrEqual(2048);
    expect(plan.height).toBeLessThanOrEqual(512);
  });

  it.each([
    { strokes: [] },
    { strokes: [{ id: "empty", width: 4, points: [] }] },
    { strokes: [stroke("nan", NaN, 0)] },
    { strokes: [stroke("bad-width", 0, 0, 0)] },
    { strokes: [{ id: "bad-pressure", width: 4, points: [{ x: 0, y: 0, pressure: 2 }] }] },
    { strokes: [{ ...stroke("bad-color", 0, 0), color: "red" }] },
    { strokes: [{ ...stroke("bad-style", 0, 0), style: "marker" as Stroke["style"] }] },
    { strokes: [{ id: "too-large", width: 4, points: [{ x: 0, y: 0 }, { x: 10_000, y: 0 }] }] },
  ])("rejects malformed or excessive ink %#", ({ strokes }) => {
    expect(() => planRaster(strokes)).toThrow(InvalidInkError);
  });

  it("rasterizes colored pencil and pen as the same dark OCR ink", () => {
    const colors: string[] = [];
    const context = {
      fillStyle: "",
      strokeStyle: "",
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke() { colors.push(this.strokeStyle); },
    };
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() { return context; }
      transferToImageBitmap() { return {}; }
    });
    rasterizeLine([
      { id: "pencil", width: 4, color: "#ffff00", style: "pencil",
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { id: "pen", width: 4, color: "#ff0000", style: "pen",
        points: [{ x: 20, y: 0 }, { x: 30, y: 0 }] },
    ]);
    expect(colors).toEqual(["#263133", "#263133"]);
    expect(context.fillRect).toHaveBeenCalled();
  });
});
