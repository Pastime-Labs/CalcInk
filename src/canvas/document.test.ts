import { afterEach, describe, expect, it, vi } from "vitest";
import { InkDocument } from "./document";
import type { Page, Point, Stroke } from "./types";

const line = (id: string, y = 0): Stroke => ({
  id,
  width: 2,
  points: [
    { x: 0, y },
    { x: 100, y },
  ],
});

const page = (strokes: Stroke[] = []): Page => ({
  schemaVersion: 2,
  id: "page-1",
  title: "Untitled page",
  createdAt: 100,
  updatedAt: 100,
  strokes,
});

afterEach(() => vi.restoreAllMocks());

describe("InkDocument validation and snapshots", () => {
  it("rejects invalid pages and duplicate stroke IDs", () => {
    expect(() => new InkDocument({ ...page(), schemaVersion: 3 } as unknown as Page)).toThrow();
    expect(() => new InkDocument({ ...page(), updatedAt: 99 })).toThrow();
    expect(() => new InkDocument({ ...page(), title: "" })).toThrow();
    expect(() => new InkDocument(page([line("a"), line("a")]))).toThrow();
    expect(() =>
      new InkDocument(page([{ id: "bad", width: 0, points: [{ x: 0, y: 0 }] }])),
    ).toThrow();
    expect(() =>
      new InkDocument(
        page([{ id: "bad", width: 1, points: [{ x: 0, y: 0, pressure: 2 }] }]),
      ),
    ).toThrow();
    expect(() =>
      new InkDocument(page([{ id: "bad", width: 1, points: [{ x: Infinity, y: 0 }] }])),
    ).toThrow();
    expect(() => new InkDocument(page([{ ...line("bad"), color: "red" }]))).toThrow();
    expect(() => new InkDocument(page([{ ...line("bad"), style: "marker" as Stroke["style"] }]))).toThrow();
  });

  it("clones constructor input, additions, page snapshots, and stroke snapshots", () => {
    const original = line("a");
    const document = new InkDocument(page([original]));
    original.points[0].x = 99;
    expect(document.page.strokes[0].points[0].x).toBe(0);

    const addition = line("b", 20);
    document.addStroke(addition);
    addition.points[0].x = 99;
    const snapshot = document.page;
    snapshot.strokes[0].points[0].x = 77;
    const strokes = document.strokes;
    strokes[1].points[0].x = 88;
    expect(document.page.strokes.map((stroke) => stroke.points[0].x)).toEqual([0, 0]);
  });

  it("preserves color and pencil style through pixel erasing and history", () => {
    const styled = { ...line("pencil"), color: "#eAB123", style: "pencil" as const };
    const document = new InkDocument(page([styled]));
    expect(document.erasePixels([{ x: 50, y: -5 }, { x: 50, y: 5 }], 4)).toBe(true);
    const fragments = document.page.strokes;
    expect(fragments).toHaveLength(2);
    expect(fragments.every((stroke) => stroke.color === "#eAB123" && stroke.style === "pencil"))
      .toBe(true);
    expect(document.undo()).toBe(true);
    expect(document.page.strokes[0]).toEqual(styled);
    expect(document.redo()).toBe(true);
    expect(document.page.strokes).toEqual(fragments);
  });

  it("rejects invalid edit input without changing ink or history", () => {
    const document = new InkDocument(page([line("a")]));
    const before = document.page;
    expect(() => document.addStroke(line("a"))).toThrow();
    expect(() => document.addStroke({ ...line("b"), points: [] })).toThrow();
    expect(() => document.eraseStrokes([{ x: NaN, y: 0 }], 2)).toThrow();
    expect(() => document.erasePixels([{ x: 0, y: 0 }], 0)).toThrow();
    expect(document.page).toEqual(before);
    expect(document.canUndo).toBe(false);
    expect(document.canRedo).toBe(false);
  });

  it("retains A4 metadata and upgrades legacy geometry only when its template changes", () => {
    const a4 = {
      ...page([line("a")]),
      schemaVersion: 3 as const,
      geometry: "a4" as const,
      template: "ruled" as const,
    };
    const document = new InkDocument(a4);
    expect(document.setTemplate("grid")).toBe(true);
    expect(document.page).toMatchObject({ schemaVersion: 3, geometry: "a4", template: "grid" });
    expect(document.page.strokes).toEqual(a4.strokes);
    const legacy = new InkDocument(page([line("b")]));
    expect(legacy.setTemplate("ruled")).toBe(false);
    expect(legacy.page.schemaVersion).toBe(2);
    expect(legacy.setTemplate("dots")).toBe(true);
    expect(legacy.page).toMatchObject({ schemaVersion: 3, geometry: "legacy", template: "dots" });
  });
});

describe("ink history", () => {
  it("moves or deletes selected strokes as one undoable edit", () => {
    const document = new InkDocument(page([line("a"), line("b", 20), line("c", 40)]));
    const moved = document.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.id === "b"
        ? stroke.points.map((point) => ({ ...point, x: point.x + 5 }))
        : stroke.points,
    }));
    expect(document.replaceSelectedStrokes(new Set(["b"]), moved)).toBe(true);
    expect(document.strokes.find((stroke) => stroke.id === "b")!.points[0].x).toBe(5);
    expect(document.undo()).toBe(true);
    expect(document.strokes.find((stroke) => stroke.id === "b")!.points[0].x).toBe(0);
    expect(document.redo()).toBe(true);
    expect(document.replaceSelectedStrokes(new Set(["b", "c"]), null)).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["a"]);
    expect(document.undo()).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["a", "b", "c"]);
    expect(document.replaceSelectedStrokes(new Set(["b"]), document.strokes)).toBe(false);
    expect(() => document.replaceSelectedStrokes(new Set(["missing"]), null)).toThrow();
  });

  it("records each ink edit once and invalidates redo only after a new edit", () => {
    const document = new InkDocument(page());
    expect(document.addStroke(line("a"))).toBe(true);
    expect(document.addStroke(line("b", 20))).toBe(true);
    expect(document.eraseStrokes([{ x: 50, y: -10 }, { x: 50, y: 5 }], 2)).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["b"]);
    expect(document.clear()).toBe(true);
    expect(document.clear()).toBe(false);
    expect(document.undo()).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["b"]);
    expect(document.undo()).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["a", "b"]);
    expect(document.redo()).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["b"]);
    expect(document.erasePixels([{ x: 500, y: 500 }], 2)).toBe(false);
    expect(document.canRedo).toBe(true);
    expect(document.addStroke(line("c", 40))).toBe(true);
    expect(document.canRedo).toBe(false);
    expect(document.redo()).toBe(false);
  });

  it("restores erased strokes and clear in original order across repeated cycles", () => {
    const initial = page([line("a"), line("b", 20), line("c", 40)]);
    const document = new InkDocument(initial);
    expect(document.eraseStrokes([{ x: 50, y: -5 }, { x: 50, y: 45 }], 2)).toBe(true);
    expect(document.strokes).toHaveLength(0);
    for (let iteration = 0; iteration < 3; iteration++) {
      expect(document.undo()).toBe(true);
      expect(document.page.strokes).toEqual(initial.strokes);
      expect(document.redo()).toBe(true);
      expect(document.strokes).toHaveLength(0);
    }
    expect(document.undo()).toBe(true);
    expect(document.clear()).toBe(true);
    expect(document.undo()).toBe(true);
    expect(document.page.strokes).toEqual(initial.strokes);
  });

  it("keeps title and correction timestamps out of ink history", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const document = new InkDocument(page());
    document.addStroke(line("a"));
    const afterInk = document.page.updatedAt;
    expect(document.setTitle("  Homework  ")).toBe(true);
    expect(document.page.title).toBe("Homework");
    expect(document.page.updatedAt).toBe(afterInk + 1);
    expect(document.setTitle("Homework")).toBe(false);
    document.touchUpdatedAt();
    expect(document.page.updatedAt).toBe(afterInk + 2);
    expect(document.undo()).toBe(true);
    expect(document.strokes).toHaveLength(0);
    expect(document.page.title).toBe("Homework");
    expect(document.page.updatedAt).toBe(afterInk + 3);
    expect(document.redo()).toBe(true);
    expect(document.page.updatedAt).toBe(afterInk + 4);
  });
});

describe("vector erasers", () => {
  it("erases sparse stroke segment contacts and one-point dots", () => {
    const dot: Stroke = { id: "dot", width: 2, points: [{ x: 10, y: 20 }] };
    const document = new InkDocument(page([line("a"), dot]));
    expect(document.eraseStrokes([{ x: 50, y: -10 }, { x: 50, y: 10 }], 2)).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["dot"]);
    expect(document.eraseStrokes([{ x: 10, y: 20 }], 2)).toBe(true);
    expect(document.strokes).toHaveLength(0);
    expect(document.undo()).toBe(true);
    expect(document.strokes.map((stroke) => stroke.id)).toEqual(["dot"]);
  });

  it("counts an endpoint touch for stroke erase but not as a pixel split", () => {
    const touch: Point[] = [{ x: -5, y: 0 }];
    const document = new InkDocument(page([line("a")]));
    const before = document.page;
    expect(document.erasePixels(touch, 4)).toBe(false);
    expect(document.page).toEqual(before);
    expect(document.eraseStrokes(touch, 4)).toBe(true);
    expect(document.strokes).toHaveLength(0);
  });

  it("splits a stroke at the middle and interpolates optional pressure and time", () => {
    const original: Stroke = {
      id: "a",
      width: 2,
      points: [
        { x: 0, y: 0, pressure: 0.2, t: 0 },
        { x: 100, y: 0, pressure: 0.8, t: 100 },
      ],
    };
    const document = new InkDocument(page([original]));
    expect(document.erasePixels([{ x: 50, y: -10 }, { x: 50, y: 10 }], 4)).toBe(true);
    const fragments = document.page.strokes;
    expect(fragments).toHaveLength(2);
    expect(new Set(fragments.map((fragment) => fragment.id)).size).toBe(2);
    expect(fragments.every((fragment) => fragment.id !== "a")).toBe(true);
    expect(fragments[0].points.at(-1)?.x).toBeCloseTo(45, 3);
    expect(fragments[1].points[0].x).toBeCloseTo(55, 3);
    expect(fragments[0].points.at(-1)?.pressure).toBeCloseTo(0.47, 2);
    expect(fragments[0].points.at(-1)?.t).toBeCloseTo(45, 3);
    expect(document.undo()).toBe(true);
    expect(document.page.strokes).toEqual([original]);
    expect(document.redo()).toBe(true);
    expect(document.page.strokes).toEqual(fragments);
  });

  it("retains coincident source samples with different metadata after splitting", () => {
    const document = new InkDocument(
      page([
        {
          id: "a",
          width: 2,
          points: [
            { x: 0, y: 0, pressure: 0.2, t: 0 },
            { x: 0, y: 0, pressure: 0.4, t: 1 },
            { x: 100, y: 0, pressure: 0.8, t: 101 },
          ],
        },
      ]),
    );
    expect(document.erasePixels([{ x: 50, y: 0 }], 4)).toBe(true);
    expect(document.strokes[0].points.slice(0, 2)).toEqual([
      { x: 0, y: 0, pressure: 0.2, t: 0 },
      { x: 0, y: 0, pressure: 0.4, t: 1 },
    ]);
  });

  it("removes both ends and tiny complete fragments without reviving erased ink", () => {
    const document = new InkDocument(page([line("a")]));
    expect(document.erasePixels([{ x: 0, y: 0 }], 4)).toBe(true);
    expect(document.strokes).toHaveLength(1);
    expect(document.strokes[0].points[0].x).toBeCloseTo(5, 3);
    expect(document.erasePixels([{ x: 100, y: 0 }], 4)).toBe(true);
    expect(document.strokes).toHaveLength(1);
    expect(document.strokes[0].points.at(-1)?.x).toBeCloseTo(95, 3);
    expect(document.erasePixels([{ x: 50, y: 0 }], 100)).toBe(true);
    expect(document.strokes).toHaveLength(0);
  });

  it("makes multiple gaps in one command and keeps all IDs unique", () => {
    const document = new InkDocument(page([line("a")]));
    const path: Point[] = [
      { x: 25, y: -10 },
      { x: 25, y: 10 },
      { x: 75, y: 10 },
      { x: 75, y: -10 },
    ];
    expect(document.erasePixels(path, 3)).toBe(true);
    expect(document.strokes).toHaveLength(3);
    expect(new Set(document.strokes.map((stroke) => stroke.id)).size).toBe(3);
    expect(document.undo()).toBe(true);
    expect(document.page.strokes).toEqual([line("a")]);
  });
});
