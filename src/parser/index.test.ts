import { describe, expect, it } from "vitest";
import { evaluate, normalizeRead } from "./index";

describe("normalizeRead", () => {
  it("maps only notation variants and ignores spaces", () => {
    expect(normalizeRead(" 18 + 4 \u00d7 3 \u2212 2 \u00f7 1 = ")).toEqual({
      kind: "canonical",
      text: "18+4*3-2/1=",
    });
    expect(normalizeRead("1*2/3=")).toEqual({
      kind: "canonical",
      text: "1*2/3=",
    });
  });

  it("maps every occurrence of U+4E8C to equals", () => {
    expect(normalizeRead("11+11\u4e8c")).toEqual({ kind: "canonical", text: "11+11=" });
    expect(normalizeRead("\u4e8c1\u4e8c2\u4e8c")).toEqual({ kind: "canonical", text: "=1=2=" });
  });

  it("is idempotent", () => {
    for (const raw of ["18+4\u00d73=", "\u2212.5 \u00f7 2 =", "1*2/3="]) {
      const first = normalizeRead(raw);
      expect(first.kind).toBe("canonical");
      if (first.kind === "canonical") {
        expect(normalizeRead(first.text)).toEqual(first);
      }
    }
  });

  it.each(["g=", "x=10", "X", "1e999*2=", "(2+3)=", "2^3=", "1\n2="])(
    "rejects unsupported input %s rather than guessing",
    (raw) => {
      expect(normalizeRead(raw).kind).toBe("unsupported_read");
    },
  );

  it("never repairs an unsupported character inserted into a valid read", () => {
    const equation = "18+4*3=";
    for (const character of ["g", "x", "X", "^", "(", ")", "\u03c3", "|", "\n"]) {
      for (let position = 0; position <= equation.length; position += 1) {
        const raw =
          equation.slice(0, position) +
          character +
          equation.slice(position);
        expect(normalizeRead(raw).kind).toBe("unsupported_read");
      }
    }
  });

  it("bounds the canonical input", () => {
    expect(normalizeRead("1".repeat(512)).kind).toBe("canonical");
    expect(normalizeRead("1".repeat(513)).kind).toBe("unsupported_read");
  });
});

describe("evaluate", () => {
  it.each([
    ["18+4*3=", "30"],
    ["18+5*3=", "33"],
    ["-12/3=", "-4"],
    ["99-100=", "-1"],
    ["25*4=", "100"],
    ["100/4=", "25"],
    ["0.5+1.25=", "1.75"],
    ["0.1+0.2=", "0.3"],
    ["1--2=", "3"],
    ["1+-2=", "-1"],
    ["--2=", "2"],
    ["10-3-2=", "5"],
    ["16/4/2=", "2"],
    ["2+3*4-5=", "9"],
    ["2*-3=", "-6"],
    ["1.=", "1"],
    [".25*4=", "1"],
    ["-0=", "0"],
    ["12345678901+1=", "12345678902"],
    ["-12345678901-1=", "-12345678902"],
  ])("evaluates %s as %s", (expression, display) => {
    expect(evaluate(expression)).toMatchObject({ kind: "value", display });
  });

  it.each(["4/0=", "1/-0=", "0/0=", "1+2/0="])(
    "returns typed zero division for %s",
    (expression) => {
      expect(evaluate(expression)).toEqual({
        kind: "undefined",
        reason: "division_by_zero",
      });
    },
  );

  it("reports non-finite input and operations", () => {
    expect(evaluate(`${"9".repeat(400)}=`)).toEqual({
      kind: "undefined",
      reason: "non_finite",
    });
    expect(evaluate(`${"9".repeat(308)}*9=`)).toEqual({
      kind: "undefined",
      reason: "non_finite",
    });
    expect(evaluate("9007199254740993-9007199254740992=")).toEqual({
      kind: "undefined",
      reason: "non_finite",
    });
    expect(evaluate("9007199254740991+2=")).toEqual({
      kind: "undefined",
      reason: "non_finite",
    });
  });

  it.each([
    "", "1", "1+=", "9==", ".=", "1..2=", "1 2=", "1=2", "1/=",
    "1/0+=", "1/0=2", "1/0+2", "1+2/0+=", `${"9".repeat(400)}+=`,
  ])(
    "rejects malformed canonical input %s",
    (expression) => {
      expect(evaluate(expression).kind).toBe("syntax");
    },
  );

  it("bounds direct evaluator calls and unary depth", () => {
    expect(evaluate("1".repeat(513)).kind).toBe("syntax");
    expect(evaluate(`${"-".repeat(64)}1=`).kind).toBe("value");
    expect(evaluate(`${"-".repeat(65)}1=`).kind).toBe("syntax");
  });
});
