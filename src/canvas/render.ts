import type { FinishedGesture } from "./input";
import { strokeBounds, type Rect } from "./lines";
import type { Point, Stroke } from "./types";

export type AnswerProjection = {
  lineId: string;
  anchor: Pick<Point, "x" | "y">;
  text: string;
  source: "automatic" | "corrected" | "attention";
};

type Layers = {
  ink: HTMLCanvasElement;
  answers: HTMLCanvasElement;
  draft: HTMLCanvasElement;
};

type Contexts = {
  ink: CanvasRenderingContext2D;
  answers: CanvasRenderingContext2D;
  draft: CanvasRenderingContext2D;
};

type PlacedAnswer = { projection: AnswerProjection; footprint: Rect };

const ANSWER_FONT = '600 22px "IBM Plex Sans Variable", sans-serif';
const ANSWER_HEIGHT = 28;
const PAPER_MARGIN = 48;

export function canvasBackingSize(cssWidth: number, cssHeight: number, dpr: number) {
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth < 0 ||
    cssHeight < 0 ||
    !Number.isFinite(dpr) ||
    dpr <= 0
  ) {
    throw new RangeError("Invalid canvas size or device pixel ratio");
  }
  return { width: Math.round(cssWidth * dpr), height: Math.round(cssHeight * dpr) };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function answerFootprint(anchor: Pick<Point, "x" | "y">, textWidth: number): Rect {
  const left = anchor.x + 12;
  const top = Math.max(0, anchor.y - ANSWER_HEIGHT / 2);
  return { left, top, right: left + textWidth, bottom: top + ANSWER_HEIGHT };
}

export function answerDisplayText(projection: AnswerProjection): string {
  if (projection.source === "attention") return projection.text;
  return `${projection.text} (${projection.source === "corrected" ? "Corrected" : "Review read"})`;
}

export function placeAnswerProjections(
  projections: readonly AnswerProjection[],
  strokes: readonly Stroke[],
  measureText: (text: string) => number,
): { placed: PlacedAnswer[]; conflicts: Set<string> } {
  const inkBounds = strokes.map(strokeBounds);
  const placed: PlacedAnswer[] = [];
  const conflicts = new Set<string>();
  for (const projection of projections) {
    const footprint = answerFootprint(projection.anchor, measureText(answerDisplayText(projection)));
    if (
      inkBounds.some((bounds) => rectsOverlap(bounds, footprint)) ||
      placed.some((answer) => rectsOverlap(answer.footprint, footprint))
    ) {
      conflicts.add(projection.lineId);
    } else {
      placed.push({ projection, footprint });
    }
  }
  return { placed, conflicts };
}

export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Pick<Stroke, "points" | "width">,
): void {
  if (stroke.points.length === 0) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  const pressureWidth = (pressure: number | undefined) =>
    stroke.width * (pressure === undefined ? 1 : 0.45 + pressure * 0.55);
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.beginPath();
    context.arc(point.x, point.y, pressureWidth(point.pressure) / 2, 0, Math.PI * 2);
    context.fill();
  } else if (stroke.points.every((point) => point.pressure === undefined)) {
    context.lineWidth = stroke.width;
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  } else {
    for (let index = 1; index < stroke.points.length; index++) {
      const before = stroke.points[index - 1];
      const after = stroke.points[index];
      const pressure =
        ((before.pressure ?? 1) + (after.pressure ?? 1)) / 2;
      context.lineWidth = pressureWidth(pressure);
      context.beginPath();
      context.moveTo(before.x, before.y);
      context.lineTo(after.x, after.y);
      context.stroke();
    }
  }
  context.restore();
}

function getContexts(layers: Layers): Contexts {
  const ink = layers.ink.getContext("2d");
  const answers = layers.answers.getContext("2d");
  const draft = layers.draft.getContext("2d");
  if (!ink || !answers || !draft) throw new Error("Canvas 2D is unavailable");
  return { ink, answers, draft };
}

function cloneStroke(stroke: Stroke): Stroke {
  return { id: stroke.id, width: stroke.width, points: stroke.points.map((point) => ({ ...point })) };
}

export class CanvasRenderer {
  private contexts: Contexts;
  private observer: ResizeObserver | null = null;
  private ink: Stroke[] = [];
  private draft: FinishedGesture | null = null;
  private answers: AnswerProjection[] = [];
  private placed: PlacedAnswer[] = [];
  private conflicts = new Set<string>();
  private frame: number | null = null;
  private inkDirty = true;
  private answerDirty = true;
  private draftDirty = true;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private destroyed = false;
  private readonly initialMinWidth: string;
  private readonly initialMinHeight: string;

  constructor(
    private readonly paper: HTMLElement,
    private readonly layers: Layers,
    private readonly onWarning?: (message: string | null) => void,
    private readonly onConflictsChanged?: (lineIds: ReadonlySet<string>) => void,
  ) {
    this.contexts = getContexts(layers);
    this.initialMinWidth = paper.style.minWidth;
    this.initialMinHeight = paper.style.minHeight;
    for (const canvas of Object.values(layers)) {
      canvas.style.pointerEvents = "none";
      canvas.addEventListener("contextlost", this.onContextLost);
      canvas.addEventListener("contextrestored", this.onContextRestored);
    }
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(paper);
    }
    window.addEventListener("resize", this.resize);
    void paper.ownerDocument.fonts?.ready.then(() => {
      if (!this.destroyed) this.refresh();
    });
    this.refresh();
  }

  setInk(strokes: readonly Stroke[]): void {
    this.ink = strokes.map(cloneStroke);
    this.recomputePlacement();
    this.updateExtent();
    this.resize();
    this.inkDirty = true;
    this.answerDirty = true;
    this.schedule();
  }

  setDraft(gesture: FinishedGesture | null): void {
    this.draft = gesture;
    this.draftDirty = true;
    this.schedule();
  }

  setAnswers(projections: readonly AnswerProjection[]): Set<string> {
    this.answers = projections
      .filter((projection) => projection.text.length > 0)
      .map((projection) => ({ ...projection, anchor: { ...projection.anchor } }));
    this.recomputePlacement();
    this.updateExtent();
    this.resize();
    this.answerDirty = true;
    this.schedule();
    return new Set(this.conflicts);
  }

  refresh(): Set<string> {
    this.recomputePlacement();
    this.updateExtent();
    this.resize();
    return new Set(this.conflicts);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener("resize", this.resize);
    for (const canvas of Object.values(this.layers)) {
      canvas.removeEventListener("contextlost", this.onContextLost);
      canvas.removeEventListener("contextrestored", this.onContextRestored);
    }
    this.paper.style.minWidth = this.initialMinWidth;
    this.paper.style.minHeight = this.initialMinHeight;
  }

  private recomputePlacement(): void {
    const context = this.contexts.answers;
    context.font = ANSWER_FONT;
    const { placed, conflicts } = placeAnswerProjections(
      this.answers,
      this.ink,
      (text) => context.measureText(text).width,
    );
    const changed =
      conflicts.size !== this.conflicts.size ||
      [...conflicts].some((lineId) => !this.conflicts.has(lineId));
    this.placed = placed;
    this.conflicts = conflicts;
    if (changed) this.onConflictsChanged?.(new Set(conflicts));
  }

  private updateExtent(): void {
    let right = 0;
    let bottom = 0;
    for (const stroke of this.ink) {
      const bounds = strokeBounds(stroke);
      right = Math.max(right, bounds.right);
      bottom = Math.max(bottom, bounds.bottom);
    }
    for (const answer of this.placed) {
      right = Math.max(right, answer.footprint.right);
      bottom = Math.max(bottom, answer.footprint.bottom);
    }
    const parent = this.paper.parentElement;
    const width = Math.ceil(Math.max(parent?.clientWidth ?? 1, right + PAPER_MARGIN));
    const height = Math.ceil(Math.max(parent?.clientHeight ?? 1, bottom + PAPER_MARGIN));
    const nextWidth = `${width}px`;
    const nextHeight = `${height}px`;
    if (this.paper.style.minWidth !== nextWidth) this.paper.style.minWidth = nextWidth;
    if (this.paper.style.minHeight !== nextHeight) this.paper.style.minHeight = nextHeight;
  }

  private resize = (): void => {
    if (this.destroyed) return;
    this.updateExtent();
    const rect = this.paper.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    const backing = canvasBackingSize(width, height, dpr);
    if (
      width === this.width &&
      height === this.height &&
      dpr === this.dpr &&
      Object.values(this.layers).every(
        (canvas) => canvas.width === backing.width && canvas.height === backing.height,
      )
    ) {
      return;
    }
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const [name, canvas] of Object.entries(this.layers) as [keyof Layers, HTMLCanvasElement][]) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = backing.width;
      canvas.height = backing.height;
      this.contexts[name].setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.inkDirty = true;
    this.answerDirty = true;
    this.draftDirty = true;
    this.schedule();
  };

  private schedule(): void {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.inkDirty) this.paintInk();
      if (this.answerDirty) this.paintAnswers();
      if (this.draftDirty) this.paintDraft();
    });
  }

  private clear(context: CanvasRenderingContext2D): void {
    context.clearRect(0, 0, this.width, this.height);
  }

  private paintInk(): void {
    this.inkDirty = false;
    const context = this.contexts.ink;
    this.clear(context);
    const color = getComputedStyle(this.paper).getPropertyValue("--ink-color").trim() || "#263133";
    context.strokeStyle = color;
    context.fillStyle = color;
    for (const stroke of this.ink) drawStroke(context, stroke);
  }

  private paintAnswers(): void {
    this.answerDirty = false;
    const context = this.contexts.answers;
    this.clear(context);
    const style = getComputedStyle(this.paper);
    context.font = ANSWER_FONT;
    context.textBaseline = "middle";
    for (const { projection, footprint } of this.placed) {
      context.fillStyle =
        (projection.source === "corrected"
          ? style.getPropertyValue("--corrected-color")
          : projection.source === "attention"
            ? style.getPropertyValue("--danger")
          : style.getPropertyValue("--answer-color")
        ).trim() || "#087e77";
      context.fillText(
        answerDisplayText(projection),
        footprint.left,
        footprint.top + ANSWER_HEIGHT / 2,
      );
    }
  }

  private paintDraft(): void {
    this.draftDirty = false;
    const context = this.contexts.draft;
    this.clear(context);
    const draft = this.draft;
    if (!draft || draft.points.length === 0) return;
    const color = getComputedStyle(this.paper).getPropertyValue("--draft-color").trim() || "#526b67";
    context.strokeStyle = color;
    context.fillStyle = color;
    if (draft.tool === "pen") {
      drawStroke(context, { width: draft.width, points: draft.points });
    } else {
      const point = draft.points.at(-1)!;
      context.save();
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.arc(point.x, point.y, draft.width / 2, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.onWarning?.("Canvas display was interrupted; restoring your ink.");
  };

  private onContextRestored = (): void => {
    try {
      this.contexts = getContexts(this.layers);
      this.width = 0;
      this.refresh();
      this.onWarning?.(null);
    } catch {
      this.onWarning?.("Canvas display is unavailable. Your saved ink is unchanged.");
    }
  };
}
