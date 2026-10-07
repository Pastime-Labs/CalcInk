import { describe, expect, it } from "vitest";
import { orderEquationBoxes } from "./order";

describe("equation OCR box order", () => {
  it("uses horizontal order even when tall digits start above an operator", () => {
    const digit1 = { text: "1", poly: [[10, 0], [20, 0], [20, 80], [10, 80]] } as const;
    const plus = { text: "+", poly: [[30, 28], [45, 28], [45, 50], [30, 50]] } as const;
    const digit2 = { text: "2", poly: [[55, 4], [75, 4], [75, 80], [55, 80]] } as const;
    const equals = { text: "=", poly: [[88, 35], [110, 35], [110, 55], [88, 55]] } as const;

    expect(orderEquationBoxes([digit1, digit2, plus, equals]).map((box) => box.text))
      .toEqual(["1", "+", "2", "="]);
  });

  it("does not mutate the SDK result", () => {
    const first = { text: "2", poly: [[20, 0], [30, 0]] } as const;
    const second = { text: "1", poly: [[0, 20], [10, 20]] } as const;
    const input = [first, second];

    expect(orderEquationBoxes(input)).toEqual([second, first]);
    expect(input).toEqual([first, second]);
  });
});
