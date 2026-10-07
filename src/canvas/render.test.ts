import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerDisplayText,
  answerFontSize,
  answerFootprint,
  CanvasRenderer,
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

afterEach(() => vi.unstubAllGlobals());

describe("DPR-safe canvas projection", () => {
  it("scales only backing pixels, not world coordinates", () => {
    expect(canvasBackingSize(200, 101, 1)).toEqual({ width: 200, height: 101 });
    expect(canvasBackingSize(200, 101, 1.5)).toEqual({ width: 300, height: 152 });
    expect(canvasBackingSize(200, 101, 2)).toEqual({ width: 400, height: 202 });
    expect(() => canvasBackingSize(200, 101, 0)).toThrow();
    expect(() => canvasBackingSize(Infinity, 101, 1)).toThrow();
  });

  it("places a right-edge result beside its anchor", () => {
    const measure = vi.fn((text: string) => text === "42" ? 30 : 50);
    const { placed, conflicts } = placeAnswerProjections([answer("one", 100)], [line], measure);
    expect(conflicts.size).toBe(0);
    expect(placed[0].footprint).toEqual({ left: 112, top: 5.5, right: 200, bottom: 34.5 });
    expect(measure).toHaveBeenCalledWith("42", expect.stringContaining("30px"));
    expect(measure).toHaveBeenCalledWith("(Review read)", expect.stringContaining("13px"));
  });

  it("sizes the value from handwriting while keeping provenance compact", () => {
    expect(answerFontSize()).toBe(30);
    expect(answerFontSize(10)).toBe(19);
    expect(answerFontSize(20)).toBe(37);
    expect(answerFontSize(50)).toBe(93);
    expect(answerFontSize(100)).toBe(185);
    expect(answerFontSize(125)).toBe(231);
    expect(answerFontSize(1000)).toBe(240);

    const measure = vi.fn((text: string) => text === "42" ? 24 : 50);
    const small = placeAnswerProjections(
      [{ ...answer("small", 100, 50), inkHeight: 10 }],
      [],
      measure,
    );
    const large = placeAnswerProjections(
      [{ ...answer("large", 100, 50), inkHeight: 50 }],
      [],
      measure,
    );
    expect(small.placed[0].footprint.bottom - small.placed[0].footprint.top).toBe(Math.ceil(19 * 0.95));
    expect(large.placed[0].footprint.bottom - large.placed[0].footprint.top).toBe(Math.ceil(93 * 0.95));
    expect(answerFootprint({ x: 100, y: 50 }, 30, false, 60))
      .toEqual({ left: 112, top: 20, right: 142, bottom: 80 });
    expect(measure).toHaveBeenCalledWith("42", expect.stringContaining("19px"));
    expect(measure).toHaveBeenCalledWith("42", expect.stringContaining("93px"));
    expect(measure.mock.calls.filter(([text]) => text === "(Review read)"))
      .toEqual([
        ["(Review read)", expect.stringContaining("13px")],
        ["(Review read)", expect.stringContaining("13px")],
      ]);
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

  it("uses the scaled footprint for ink collisions and fixed A4 boundaries", () => {
    const measure = (text: string) => text === "42" ? 24 : 50;
    const small = { ...answer("small", 100, 50), inkHeight: 10 };
    const large = { ...answer("large", 100, 50), inkHeight: 50 };
    const nearbyInk: Stroke = {
      id: "above",
      width: 2,
      points: [{ x: 120, y: 20 }, { x: 120, y: 30 }],
    };
    expect(placeAnswerProjections([small], [nearbyInk], measure).conflicts.size).toBe(0);
    expect(placeAnswerProjections([large], [nearbyInk], measure).conflicts)
      .toEqual(new Set(["large"]));

    const pageSize = { width: 840, height: 1188 };
    expect(placeAnswerProjections(
      [{ ...small, anchor: { x: 740, y: 1155 } }],
      [],
      measure,
      pageSize,
    ).conflicts.size).toBe(0);
    expect(placeAnswerProjections(
      [{ ...large, anchor: { x: 740, y: 1155 } }],
      [],
      measure,
      pageSize,
    ).conflicts).toEqual(new Set(["large"]));
  });

  it("reports answers that would leave a fixed page", () => {
    const result = placeAnswerProjections(
      [answer("edge", 100), answer("inside", 20)],
      [],
      () => 30,
      { width: 130, height: 100 },
    );
    expect(result.conflicts).toEqual(new Set(["edge"]));
    expect(result.placed.map(({ projection }) => projection.lineId)).toEqual(["inside"]);
  });

  it("places answers above the initial origin on an unbounded board", () => {
    const result = placeAnswerProjections(
      [answer("negative", -80, -100)],
      [],
      () => 30,
      undefined,
      true,
    );
    expect(result.conflicts.size).toBe(0);
    expect(result.placed[0].footprint).toEqual({
      left: -68, top: -114.5, right: 0, bottom: -85.5,
    });
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

  it("uses saved color and pencil texture while speed changes segment widths", () => {
    const widths: number[] = [];
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      setLineDash: vi.fn(),
      stroke(this: { lineWidth: number }) { widths.push(this.lineWidth); },
      lineWidth: 0,
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    drawStroke(context, {
      width: 10,
      color: "#ef0000",
      style: "pencil",
      points: [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 20 }, { x: 21, y: 0, t: 30 }],
    });
    expect(context.strokeStyle).toBe("#ef0000");
    expect(widths).toHaveLength(4);
    expect(widths[1]).toBeLessThan(widths[0]);
    expect(widths[2]).toBeCloseTo(widths[0] * 0.42);
    expect(context.setLineDash).toHaveBeenCalledWith([1, 3]);
  });

  it("maps legacy dark ink for notebook strokes and drafts without changing whiteboard colors", () => {
    vi.stubGlobal("window", {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("getComputedStyle", vi.fn(() => ({ getPropertyValue: () => "" })));
    let mode = "notebook";
    const paper = {
      style: { width: "", height: "", minWidth: "", minHeight: "" },
      parentElement: { clientWidth: 300, clientHeight: 200 },
      ownerDocument: { fonts: undefined },
      clientWidth: 300,
      clientHeight: 200,
      closest: () => ({ getAttribute: () => mode }),
    } as unknown as HTMLElement;
    const context = () => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: () => ({ width: 30 }),
      strokeStyle: "",
      fillStyle: "",
    }) as unknown as CanvasRenderingContext2D;
    const ink = context();
    const draft = context();
    const layer = (drawing: CanvasRenderingContext2D) => ({
      style: {},
      width: 0,
      height: 0,
      getContext: () => drawing,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(paper, {
      ink: layer(ink),
      answers: layer(context()),
      draft: layer(draft),
    });
    const saved = { ...line, color: "#121619", points: [{ x: 10, y: 20 }] };
    renderer.setInk([saved]);
    renderer.setDraft({
      tool: "pen",
      width: 2,
      color: "#263133",
      points: [{ x: 20, y: 30 }],
    });
    frames.shift()?.(0);
    expect(ink.fillStyle).toBe("#d9ddde");
    expect(draft.fillStyle).toBe("#d9ddde");
    expect(saved.color).toBe("#121619");

    mode = "whiteboard";
    renderer.setInk([saved]);
    renderer.setDraft({
      tool: "pen",
      width: 2,
      color: "#263133",
      points: [{ x: 20, y: 30 }],
    });
    frames.shift()?.(0);
    expect(ink.fillStyle).toBe("#121619");
    expect(draft.fillStyle).toBe("#263133");
    renderer.destroy();
  });

  it("keeps fixed paper dimensions despite distant ink and uses unscaled backing size", () => {
    vi.stubGlobal("window", {
      devicePixelRatio: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const style = { width: "100%", height: "100%", minWidth: "", minHeight: "" };
    let printSize: { width: number; height: number } | null = null;
    const paper = {
      style,
      parentElement: { clientWidth: 400, clientHeight: 300 },
      ownerDocument: { fonts: undefined },
      get clientWidth() { return printSize?.width ?? (style.width.endsWith("px") ? Number.parseFloat(style.width) : 400); },
      get clientHeight() { return printSize?.height ?? (style.height.endsWith("px") ? Number.parseFloat(style.height) : 300); },
      getBoundingClientRect: () => ({ width: 420, height: 594 }),
    } as unknown as HTMLElement;
    const context = {
      setTransform: vi.fn(),
      measureText: () => ({ width: 30 }),
    } as unknown as CanvasRenderingContext2D;
    const layer = () => ({
      style: {},
      width: 0,
      height: 0,
      getContext: () => context,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLCanvasElement;
    const layers = { ink: layer(), answers: layer(), draft: layer() };
    const renderer = new CanvasRenderer(paper, layers);
    renderer.setInk([{ ...line, points: [{ x: 3000, y: 20 }] }]);
    renderer.setPageSize({ width: 840, height: 1188 });
    expect(style.width).toBe("840px");
    expect(style.minWidth).toBe("840px");
    expect(style.minHeight).toBe("1188px");
    expect(layers.ink.width).toBe(1680);
    expect(layers.ink.height).toBe(2376);
    printSize = { width: 794, height: 1123 };
    renderer.refresh();
    expect(layers.ink.width).toBe(1680);
    expect(layers.ink.height).toBe(2376);
    expect(renderer.setAnswers([answer("edge", 830)])).toEqual(new Set(["edge"]));
    printSize = null;
    renderer.setPageSize(null);
    expect(Number.parseFloat(style.minWidth)).toBeGreaterThan(3000);
    renderer.destroy();
  });

  it("keeps a camera board viewport-sized and transforms world ink", () => {
    vi.stubGlobal("window", {
      devicePixelRatio: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("getComputedStyle", vi.fn(() => ({ getPropertyValue: () => "" })));
    let notifyResize: (() => void) | undefined;
    const observed: unknown[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe(target: unknown) { observed.push(target); }
      disconnect() {}
    });
    const style = { width: "100%", height: "100%", minWidth: "", minHeight: "" };
    let viewportReads = 0;
    let viewportWidth = 320;
    let viewportHeight = 240;
    const paper = {
      style,
      parentElement: {
        get clientWidth() { viewportReads += 1; return viewportWidth; },
        get clientHeight() { viewportReads += 1; return viewportHeight; },
      },
      ownerDocument: { fonts: undefined },
      get clientWidth() { return style.width.endsWith("px") ? Number.parseFloat(style.width) : 320; },
      get clientHeight() { return style.height.endsWith("px") ? Number.parseFloat(style.height) : 240; },
    } as unknown as HTMLElement;
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      measureText: () => ({ width: 30 }),
    } as unknown as CanvasRenderingContext2D;
    const layer = () => ({
      style: {},
      width: 0,
      height: 0,
      getContext: () => context,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLCanvasElement;
    const layers = { ink: layer(), answers: layer(), draft: layer() };
    const renderer = new CanvasRenderer(paper, layers);
    expect(observed).toContain(paper.parentElement);
    renderer.setInk([
      { ...line, points: [{ x: 105, y: 60 }] },
      { ...line, id: "distant", points: [{ x: 3000, y: 20 }] },
    ]);
    renderer.setCamera({ x: 100, y: 50, scale: 2 });
    expect(style.width).toBe("320px");
    expect(style.minWidth).toBe("320px");
    expect(layers.ink.width).toBe(640);
    expect(layers.ink.height).toBe(480);
    frames.shift()?.(0);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 320, 240);
    expect(context.setTransform).toHaveBeenCalledWith(4, 0, 0, 4, -400, -200);
    expect(context.arc).toHaveBeenCalledTimes(1);
    const readsBeforePan = viewportReads;
    renderer.setCamera({ x: 200, y: 50, scale: 2 });
    expect(viewportReads).toBe(readsBeforePan);
    frames.shift()?.(0);
    expect(context.setTransform).toHaveBeenCalledWith(4, 0, 0, 4, -800, -200);
    expect(context.arc).toHaveBeenCalledTimes(1);
    viewportWidth = 400;
    viewportHeight = 300;
    notifyResize?.();
    expect(layers.ink.width).toBe(800);
    expect(layers.ink.height).toBe(600);
    expect(() => renderer.setCamera({ x: 0, y: 0, scale: 0 })).toThrow(RangeError);
    renderer.setCamera(null);
    expect(Number.parseFloat(style.minWidth)).toBeGreaterThan(3000);
    renderer.destroy();
  });
});
