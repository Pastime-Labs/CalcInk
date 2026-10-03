# 11. Arithmetic Engine

Status: Implemented locally in Phase 2 with focused tests. The prototype parser handles basic
arithmetic; the V1 parser is a deterministic numeric evaluator, not a
symbolic algebra system. Parentheses and powers are deferred to V2.

## Purpose and boundary

Implements master requirement **P-05**. Convert a model read or user
correction to a small canonical arithmetic language, then evaluate it
without executing code. Recognition uncertainty is not "fixed" by
arithmetic guessing. The parser cannot infer an intended
digit from a plausible but wrong read. See
[inference](10-model-inference.md) and
[results](12-results-and-correction.md).

## Canonical input and result contract

Accepted canonical alphabet: digits, `.`, `+`, `-`, `*`, `/`, and one
final `=`. Spaces are ignored. Written `×` and `÷` map to `*` and `/`;
a Unicode minus maps to `-`. ASCII `*` and `/` are equivalent operator
spellings in a model read or manual correction, not extra written
requirements. No alphabetic character is accepted: `g=` must not become
`9=`, and `x`/`X` must not be guessed into multiplication. Variables,
parentheses, powers, stacked fractions, functions, implicit
multiplication, and extra `=` are rejected.

The normalizer returns canonical text or a typed `unsupported_read`
result. The evaluator receives canonical text only and returns one of:

```ts
type EquationResult =
  | { kind: "value"; value: number; display: string }
  | { kind: "undefined"; reason: "division_by_zero" | "non_finite" }
  | { kind: "syntax"; message: string };
```

An absent final `=` is `incomplete` in the orchestration/UI layer, not a
numeric result. Parser messages use safe plain text and a position where
useful. Neither raw model output nor user correction is rendered as HTML.

## Grammar and numerical policy

Use a small Pratt parser with left binding powers `10` for `+`/`-`
and `20` for `*`/`/`. Parse a right operand at binding power plus one
for left associativity; prefix unary signs use binding power `30`.
The equivalent grammar is:

```text
equation := sum "=" EOF
sum      := product (("+" | "-") product)*
product  := unary (("*" | "/") unary)*
unary    := ("+" | "-") unary | number
number   := digits ("." digits?)? | "." digits
```

This gives `-12/3=-4`, `18+4*3=30`, and `99-100=-1`.
Reject adjacent operands without an operator, lone decimal points,
trailing operators, and characters after terminal `=`.

Use JavaScript numbers, display safe integer results without rounding,
and round fractional results to 10 significant digits; strip a negative
zero display to `0`. This is a calculator for ordinary arithmetic, not an
exact-decimal or arbitrary precision engine. Results beyond JavaScript's
safe integer magnitude and any NaN/infinite result display `Undefined`
with the typed reason, rather than a plausible rounded integer. Bound canonical input to 512
characters and unary-prefix depth to 64 to prevent pathological input
from crashing the page. Validate the entire expression before reporting
a numeric error: malformed `1/0+=` is syntax, while complete `1/0=` is
`Undefined`.

## Build sequence

1. Implement normalization as a pure, idempotent function. Preserve the
   raw read separately so users can see what the model actually emitted.
   Test every permitted operator spelling and rejection of unsupported
   content, especially alphabetic OCR output.
2. Tokenize or scan the bounded canonical string without `eval`,
   `Function`, DOM parsing, or regex-based arithmetic replacement.
3. Implement the Pratt binding powers above; require exact end-of-input after the
   terminal `=`. Use explicit errors for syntax and non-finite/undefined
   numerical cases.
4. Format only successful finite values. Do not convert parser failure
   into `0`, blank, or a believable answer.
5. Connect the parser to both automatic readback and manual correction so
   they follow the same arithmetic rules.

## Tests and done gate

| Input | Expected |
| --- | --- |
| `18+4*3=` / `18+5*3=` | `30` / `33` |
| `-12/3=` / `99-100=` | `-4` / `-1` |
| `25*4=` / `100/4=` | `100` / `25` |
| `0.5+1.25=` / `0.1+0.2=` | `1.75` / `0.3` |
| `4/0=` | Evaluator returns typed `undefined`. |
| `1e999*2=`, `g=`, `x=10`, `(2+3)=`, `2^3=` | Normalizer returns `unsupported_read`; never a guessed value. |
| `1+=`, `9==`, lone `.`, too deep/long | Typed syntax or bounded-input error; never execution. |

Property tests should confirm normalization idempotence and that inserting
unsupported characters never yields a value. Browser acceptance must
exercise written arithmetic through the real model, not only typed parser
tests. The engine is done when all grammar cases pass and
correct first reads yield correct projected results in the fresh benchmark.
