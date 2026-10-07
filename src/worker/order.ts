type PositionedBox = { poly: readonly (readonly [number, number])[] };

function leftEdge(box: PositionedBox): number {
  let left = Infinity;
  for (const [x] of box.poly) left = Math.min(left, x);
  return left;
}

// CalcInk sends one handwritten equation line at a time, not a page of text.
export function orderEquationBoxes<T extends PositionedBox>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => leftEdge(a) - leftEdge(b));
}
