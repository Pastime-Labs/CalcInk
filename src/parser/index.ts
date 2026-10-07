export type NormalizedRead =
  | { kind: "canonical"; text: string }
  | { kind: "unsupported_read"; message: string; position: number };

export type EquationResult =
  | { kind: "value"; value: number; display: string }
  | { kind: "undefined"; reason: "division_by_zero" | "non_finite" }
  | { kind: "syntax"; message: string };

const MAX_LENGTH = 512;
const MAX_UNARY_DEPTH = 64;

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

export function normalizeRead(raw: string): NormalizedRead {
  let text = "";

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === " ") continue;

    let canonical: string;
    if (character === "\u00d7") canonical = "*";
    else if (character === "\u00f7") canonical = "/";
    else if (character === "\u2212") canonical = "-";
    else if (character === "\u4e8c") canonical = "=";
    else if (
      isDigit(character) ||
      character === "." ||
      character === "+" ||
      character === "-" ||
      character === "*" ||
      character === "/" ||
      character === "="
    ) {
      canonical = character;
    } else {
      return {
        kind: "unsupported_read",
        message: `Unsupported character at position ${index + 1}`,
        position: index + 1,
      };
    }

    if (text.length === MAX_LENGTH) {
      return {
        kind: "unsupported_read",
        message: `Expression exceeds ${MAX_LENGTH} characters`,
        position: index + 1,
      };
    }
    text += canonical;
  }

  return { kind: "canonical", text };
}

class Parser {
  private position = 0;
  private failure: Exclude<EquationResult, { kind: "value" }> | null = null;

  constructor(private readonly input: string) {}

  parse(): EquationResult {
    const value = this.expression(0, 0);
    if (value === null) {
      return this.failure ?? { kind: "syntax", message: "Invalid expression" };
    }
    if (this.peek() !== "=") {
      return this.syntaxResult("Expected final '='");
    }
    this.position += 1;
    if (this.position !== this.input.length) {
      return this.syntaxResult("Unexpected content after '='");
    }
    if (this.failure !== null) return this.failure;
    const rounded = Object.is(value, -0)
      ? 0
      : Number.isSafeInteger(value) ? value : Number(value.toPrecision(10));
    return { kind: "value", value, display: String(rounded) };
  }

  private peek(): string | undefined {
    return this.input[this.position];
  }

  private syntaxResult(message: string): Extract<EquationResult, { kind: "syntax" }> {
    return {
      kind: "syntax",
      message: `${message} at position ${this.position + 1}`,
    };
  }

  private failSyntax(message: string): null {
    this.failure = this.syntaxResult(message);
    return null;
  }

  private failUndefined(reason: "division_by_zero" | "non_finite"): number {
    this.failure ??= { kind: "undefined", reason };
    return NaN;
  }

  private expression(minBindingPower: number, unaryDepth: number): number | null {
    let value = this.prefix(unaryDepth);
    if (value === null) return null;

    while (true) {
      const operator = this.peek();
      const bindingPower = operator === "+" || operator === "-" ? 10
        : operator === "*" || operator === "/" ? 20 : -1;
      if (bindingPower < minBindingPower) break;
      this.position += 1;
      const right = this.expression(bindingPower + 1, 0);
      if (right === null) return null;
      if (operator === "/" && right === 0) {
        value = this.failUndefined("division_by_zero");
        continue;
      }
      value = operator === "+" ? value + right
        : operator === "-" ? value - right
          : operator === "*" ? value * right : value / right;
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
        value = this.failUndefined("non_finite");
      }
    }
    return value;
  }

  private prefix(depth: number): number | null {
    const character = this.peek();
    if (character !== "+" && character !== "-") return this.number();
    if (depth === MAX_UNARY_DEPTH) {
      return this.failSyntax("Too many unary signs");
    }
    this.position += 1;
    const value = this.expression(30, depth + 1);
    if (value === null) return null;
    return character === "-" ? -value : value;
  }

  private number(): number | null {
    const start = this.position;
    while (isDigit(this.peek())) this.position += 1;
    const digitsBeforeDot = this.position > start;

    if (this.peek() === ".") {
      this.position += 1;
      const fractionStart = this.position;
      while (isDigit(this.peek())) this.position += 1;
      if (!digitsBeforeDot && this.position === fractionStart) {
        return this.failSyntax("Expected digit after '.'");
      }
    } else if (!digitsBeforeDot) {
      return this.failSyntax("Expected number");
    }

    const value = Number(this.input.slice(start, this.position));
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      return this.failUndefined("non_finite");
    }
    return value;
  }
}

export function evaluate(canonical: string): EquationResult {
  if (canonical.length > MAX_LENGTH) {
    return {
      kind: "syntax",
      message: `Expression exceeds ${MAX_LENGTH} characters`,
    };
  }
  return new Parser(canonical).parse();
}
