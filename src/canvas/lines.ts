import type { Point, Stroke } from "./types";

export type Rect = { left: number; top: number; right: number; bottom: number };

export type EquationLine = {
  lineId: string;
  signature: string;
  strokes: readonly Stroke[];
  bounds: Rect;
  anchor: Point;
};

type Mark = { stroke: Stroke; bounds: Rect; index: number };
type Group = { marks: Mark[]; bounds: Rect };

const height = (rect: Rect) => rect.bottom - rect.top;
const middle = (rect: Rect) => (rect.top + rect.bottom) / 2;
const verticalGap = (a: Rect, b: Rect) => Math.max(0, a.top - b.bottom, b.top - a.bottom);

export function strokeBounds(stroke: Stroke): Rect {
  if (stroke.points.length === 0) throw new TypeError("Stroke has no points");
  const padding = stroke.width / 2;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of stroke.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return {
    left: left - padding,
    top: top - padding,
    right: right + padding,
    bottom: bottom + padding,
  };
}

function include(group: Group, mark: Mark): void {
  group.marks.push(mark);
  group.bounds = {
    left: Math.min(group.bounds.left, mark.bounds.left),
    top: Math.min(group.bounds.top, mark.bounds.top),
    right: Math.max(group.bounds.right, mark.bounds.right),
    bottom: Math.max(group.bounds.bottom, mark.bounds.bottom),
  };
}

function newGroup(mark: Mark): Group {
  return { marks: [mark], bounds: { ...mark.bounds } };
}

export function groupEquationLines(strokes: readonly Stroke[]): EquationLine[] {
  const marks = strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => stroke.points.length > 0)
    .map(({ stroke, index }) => ({ stroke, index, bounds: strokeBounds(stroke) }));
  if (marks.length === 0) return [];

  const sizes = marks
    .map(({ bounds }) => Math.max(bounds.right - bounds.left, height(bounds)))
    .sort((a, b) => a - b);
  const tallHeights = marks
    .map(({ bounds }) => height(bounds))
    .filter((value) => value > 6)
    .sort((a, b) => a - b);
  const bodyHeight = tallHeights[Math.floor(tallHeights.length / 2)] ?? 0;
  const scale = Math.max(sizes[Math.floor(sizes.length / 2)], bodyHeight);
  const bodyThreshold = Math.max(6, bodyHeight * 0.35);
  const isBody = (mark: Mark) => height(mark.bounds) > bodyThreshold;

  const groups: Group[] = [];
  for (const mark of marks.filter(isBody).sort((a, b) => a.bounds.top - b.bounds.top)) {
    const last = groups.at(-1);
    if (last && verticalGap(mark.bounds, last.bounds) <= scale * 0.1) {
      include(last, mark);
    } else {
      groups.push(newGroup(mark));
    }
  }

  const attached = new Map<Group, Mark[]>();
  const loose: Mark[] = [];
  for (const mark of marks) {
    if (isBody(mark)) continue;
    let nearest: Group | undefined;
    let distance = Infinity;
    for (const group of groups) {
      if (verticalGap(mark.bounds, group.bounds) > scale * 0.4) continue;
      const candidate = Math.abs(middle(mark.bounds) - middle(group.bounds));
      if (candidate < distance) {
        nearest = group;
        distance = candidate;
      }
    }
    if (nearest) {
      const waiting = attached.get(nearest) ?? [];
      waiting.push(mark);
      attached.set(nearest, waiting);
    } else {
      loose.push(mark);
    }
  }
  for (const [group, waiting] of attached) {
    for (const mark of waiting) include(group, mark);
  }

  const looseGroups: Group[] = [];
  for (const mark of loose.sort((a, b) => middle(a.bounds) - middle(b.bounds))) {
    const last = looseGroups.at(-1);
    if (last && Math.abs(middle(mark.bounds) - middle(last.bounds)) <= scale * 0.6) {
      include(last, mark);
    } else {
      looseGroups.push(newGroup(mark));
    }
  }
  groups.push(...looseGroups);

  const separated = groups.flatMap((group) => {
    const rows: Group[] = [];
    for (const mark of [...group.marks].sort((a, b) => a.bounds.left - b.bounds.left)) {
      const last = rows.at(-1);
      if (last && mark.bounds.left - last.bounds.right <= Math.max(48, scale * 4)) {
        include(last, mark);
      } else {
        rows.push(newGroup(mark));
      }
    }
    return rows;
  });

  return separated
    .map((group) => {
      const ordered = group.marks.sort((a, b) => a.index - b.index);
      return {
        lineId: `line:${ordered[0].stroke.id}`,
        signature: JSON.stringify(ordered.map((mark) => mark.stroke.id)),
        strokes: ordered.map((mark) => mark.stroke),
        bounds: group.bounds,
        anchor: { x: group.bounds.right, y: middle(group.bounds) },
      };
    })
    .sort(
      (a, b) =>
        a.bounds.top - b.bounds.top ||
        a.bounds.left - b.bounds.left ||
        (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0),
    );
}

export function hasTerminalEqualsHint(line: EquationLine): boolean {
  const bars = line.strokes.slice(-2);
  if (bars.length !== 2) return false;
  const [first, second] = bars.map(strokeBounds);
  const isHorizontal = (bounds: Rect) => {
    const width = bounds.right - bounds.left;
    return width >= 8 && height(bounds) <= Math.max(4, width * 0.25);
  };
  if (!isHorizontal(first) || !isHorizontal(second)) return false;
  const overlap = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const shorter = Math.min(first.right - first.left, second.right - second.left);
  const separation = Math.abs(middle(first) - middle(second));
  const rightEdge = Math.max(first.right, second.right);
  return (
    overlap >= shorter * 0.5 &&
    separation >= 3 &&
    separation <= 18 &&
    rightEdge >= line.bounds.right - 12
  );
}
