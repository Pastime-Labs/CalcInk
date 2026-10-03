import { describe, expect, it } from "vitest";
import { groupEquationLines, hasTerminalEqualsHint, strokeBounds } from "./lines";
import type { Stroke } from "./types";

const stroke = (id: string, x1: number, y1: number, x2 = x1, y2 = y1): Stroke => ({
  id,
  width: 2,
  points: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ],
});
const digit = (id: string, x: number, y: number) => stroke(id, x, y, x + 8, y + 28);
const bar = (id: string, x: number, y: number) => stroke(id, x, y, x + 20, y);

describe("equation line grouping", () => {
  it("includes ink width in bounds and ignores empty strokes", () => {
    expect(strokeBounds(stroke("a", 0, 0, 10, 20))).toEqual({
      left: -1,
      top: -1,
      right: 11,
      bottom: 21,
    });
    expect(groupEquationLines([{ id: "empty", width: 2, points: [] }])).toEqual([]);
  });

  it("keeps a decimal dot, minus, and equals bars with their row", () => {
    const input = [
      digit("one", 0, 0),
      digit("two", 20, 2),
      bar("equals-bottom", 56, 20),
      stroke("dot", 15, 29),
      bar("minus", 34, 14),
      bar("equals-top", 56, 10),
    ];
    const [line] = groupEquationLines(input);
    expect(groupEquationLines(input)).toHaveLength(1);
    expect(line.lineId).toBe("line:one");
    expect(line.strokes.map((mark) => mark.id)).toEqual(input.map((mark) => mark.id));
    expect(line.signature).toBe(JSON.stringify(input.map((mark) => mark.id)));
    expect(line.bounds).toEqual({ left: -1, top: -1, right: 77, bottom: 31 });
    expect(line.anchor).toEqual({ x: 77, y: 15 });
    expect(input.map((mark) => mark.id)).toEqual([
      "one",
      "two",
      "equals-bottom",
      "dot",
      "minus",
      "equals-top",
    ]);
  });

  it("separates rows and attaches a dot and division bar to the closer row", () => {
    const lines = groupEquationLines([
      digit("upper", 0, 0),
      digit("lower", 0, 52),
      stroke("dot", 15, 42),
      bar("division-bar", 25, 66),
    ]);
    expect(lines.map((line) => line.lineId)).toEqual(["line:upper", "line:lower"]);
    expect(lines.map((line) => line.strokes.map((mark) => mark.id))).toEqual([
      ["upper"],
      ["lower", "dot", "division-bar"],
    ]);
  });

  it("groups rows containing only short equals-sign bars", () => {
    const lines = groupEquationLines([
      bar("top-a", 0, 10),
      bar("bottom-a", 0, 20),
      bar("top-b", 0, 60),
      bar("bottom-b", 0, 70),
    ]);
    expect(lines.map((line) => line.strokes.map((mark) => mark.id))).toEqual([
      ["top-a", "bottom-a"],
      ["top-b", "bottom-b"],
    ]);
  });

  it("does not chain loose marks into a distant row", () => {
    const lines = groupEquationLines([
      digit("body", 0, 0),
      stroke("near", 20, 30),
      stroke("far", 40, 44),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].strokes.map((mark) => mark.id)).toEqual(["body", "near"]);
    expect(lines[1].strokes.map((mark) => mark.id)).toEqual(["far"]);
  });

  it("keeps original stroke order and distinct ordered signatures", () => {
    const lower = digit("lower", 0, 60);
    const upper = digit("upper", 0, 0);
    const added = bar("equals", 30, 14);
    const before = groupEquationLines([lower, upper]);
    const after = groupEquationLines([lower, upper, added]);
    expect(before.map((line) => line.lineId)).toEqual(["line:upper", "line:lower"]);
    expect(after.map((line) => line.lineId)).toEqual(["line:upper", "line:lower"]);
    expect(after[0].signature).not.toBe(before[0].signature);
    expect(after[1].signature).toBe(before[1].signature);
    expect(after[0].strokes.map((mark) => mark.id)).toEqual(["upper", "equals"]);
    expect(groupEquationLines([digit("ab", 0, 0), digit("c", 20, 0)])[0].signature).not.toBe(
      groupEquationLines([digit("a", 0, 0), digit("bc", 20, 0)])[0].signature,
    );
  });

  it("recomputes a split or merge without assigning a stroke to two lines", () => {
    const upper = digit("upper", 0, 0);
    const lower = digit("lower", 0, 60);
    const bridge = stroke("bridge", 30, 20, 30, 70);
    expect(groupEquationLines([upper, lower])).toHaveLength(2);
    const merged = groupEquationLines([upper, lower, bridge]);
    expect(merged).toHaveLength(1);
    expect(merged[0].strokes.map((mark) => mark.id)).toEqual(["upper", "lower", "bridge"]);
    expect(groupEquationLines([upper, lower])).toHaveLength(2);
  });

  it("uses two recent right-edge bars only as a terminal-equals hint", () => {
    const complete = groupEquationLines([
      digit("digit", 0, 0),
      bar("equals-top", 30, 10),
      bar("equals-bottom", 30, 20),
    ])[0];
    expect(hasTerminalEqualsHint(complete)).toBe(true);
    expect(hasTerminalEqualsHint(groupEquationLines([digit("digit", 0, 0)])[0])).toBe(false);
    expect(
      hasTerminalEqualsHint(
        groupEquationLines([
          bar("equals-top", 0, 10),
          bar("equals-bottom", 0, 20),
          digit("digit", 40, 0),
        ])[0],
      ),
    ).toBe(false);
    expect(
      hasTerminalEqualsHint(
        groupEquationLines([
          digit("digit", 0, 0),
          bar("minus-left", 30, 10),
          bar("minus-right", 60, 20),
        ])[0],
      ),
    ).toBe(false);
  });
});
