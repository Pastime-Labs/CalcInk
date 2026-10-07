import type { FinishedGesture } from "./input";
import { displayInkColor, pointWidth, segmentWidths } from "./brush";
import { strokeBounds, type Rect } from "./lines";
import type { Point, Stroke } from "./types";

export type AnswerProjection = {
  lineId: string;
  anchor: Pick<Point, "x" | "y">;
  inkHeight?: number;
  text: string;
  source: "automatic" | "corrected" | "attention";
};

export type CanvasCamera = { x: number; y: number; scale: number };

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

type PlacedAnswer = {
  projection: AnswerProjection;
  footprint: Rect;
  fontSize: number;
  valueWidth: number;
  label: string;
};

const DEFAULT_ANSWER_SIZE = 30;
const ANSWER_HEIGHT = 36;
const LABEL_FONT = '600 13px "DM Sans Variable", sans-serif';
const LABEL_GAP = 8;
const PAPER_MARGIN = 48;

function answerFont(size: number): string {
  return `600 ${size}px "Caveat Variable", cursive`;
}

export function answerFontSize(inkHeight?: number): number {
  return inkHeight !== undefined && Number.isFinite(inkHeight) && inkHeight > 0
    ? Math.max(16, Math.min(240, Math.round(inkHeight * 1.85)))
    : DEFAULT_ANSWER_SIZE;
}

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

export function answerFootprint(
  anchor: Pick<Point, "x" | "y">,
  textWidth: number,
  allowNegative = false,
  height = ANSWER_HEIGHT,
): Rect {
  const left = anchor.x + 12;
  const top = allowNegative ? anchor.y - height / 2
    : Math.max(0, anchor.y - height / 2);
  return { left, top, right: left + textWidth, bottom: top + height };
}

function answerLabel(projection: AnswerProjection): string {
  if (projection.source === "attention") return "";
  return projection.source === "corrected" ? "(Corrected)" : "(Review read)";
}

export function answerDisplayText(projection: AnswerProjection): string {
  const label = answerLabel(projection);
  return label ? `${projection.text} ${label}` : projection.text;
}

export function placeAnswerProjections(
  projections: readonly AnswerProjection[],
  strokes: readonly Stroke[],
  measureText: (text: string, font: string) => number,
  pageSize?: { width: number; height: number },
  allowNegative = false,
): { placed: PlacedAnswer[]; conflicts: Set<string> } {
  const inkBounds = strokes.map(strokeBounds);
  const placed: PlacedAnswer[] = [];
  const conflicts = new Set<string>();
  for (const projection of projections) {
    const fontSize = answerFontSize(projection.inkHeight);
    const label = answerLabel(projection);
    const valueWidth = measureText(projection.text, answerFont(fontSize));
    const labelWidth = label ? LABEL_GAP + measureText(label, LABEL_FONT) : 0;
    const footprint = answerFootprint(
      projection.anchor,
      valueWidth + labelWidth,
      allowNegative,
      Math.ceil(fontSize * 0.95),
    );
    if (
      (pageSize !== undefined &&
        (footprint.left < 0 || footprint.right > pageSize.width ||
          footprint.top < 0 || footprint.bottom > pageSize.height)) ||
      inkBounds.some((bounds) => rectsOverlap(bounds, footprint)) ||
      placed.some((answer) => rectsOverlap(answer.footprint, footprint))
    ) {
      conflicts.add(projection.lineId);
    } else {
      placed.push({ projection, footprint, fontSize, valueWidth, label });
    }
  }
  return { placed, conflicts };
}

export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Pick<Stroke, "points" | "width" | "color" | "style">,
  darkPaper = false,
): void {
  if (stroke.points.length === 0) return;
  context.save();
  const color = displayInkColor(stroke.color, darkPaper);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  const paint = (widthScale: number): void => {
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(point.x, point.y, pointWidth(stroke.width, point) * widthScale / 2, 0, Math.PI * 2);
      context.fill();
    } else if (stroke.points.every((point) => point.pressure === undefined && point.t === undefined)) {
      context.lineWidth = stroke.width * widthScale;
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    } else {
      const widths = segmentWidths(stroke);
      for (let index = 1; index < stroke.points.length; index++) {
        const before = stroke.points[index - 1];
        const after = stroke.points[index];
        context.lineWidth = widths[index - 1] * widthScale;
        context.beginPath();
        context.moveTo(before.x, before.y);
        context.lineTo(after.x, after.y);
        context.stroke();
      }
    }
  };
  if (stroke.style === "pencil") {
    context.globalAlpha = 0.6;
    paint(1);
    context.globalAlpha = 0.22;
    context.setLineDash([1, 3]);
    paint(0.42);
  } else {
    paint(1);
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
  return {
    id: stroke.id,
    width: stroke.width,
    ...(stroke.color === undefined ? {} : { color: stroke.color }),
    ...(stroke.style === undefined ? {} : { style: stroke.style }),
    points: stroke.points.map((point) => ({ ...point })),
  };
}

export class CanvasRenderer {
  private contexts: Contexts;
  private observer: ResizeObserver | null = null;
  private ink: Stroke[] = [];
  private inkBounds: Rect[] = [];
  private draft: FinishedGesture | null = null;
  private selection: Stroke[] = [];
  private pageSize: { width: number; height: number } | null = null;
  private camera: CanvasCamera | null = null;
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
  private readonly initialWidth: string;
  private readonly initialHeight: string;

  constructor(
    private readonly paper: HTMLElement,
    private readonly layers: Layers,
    private readonly onWarning?: (message: string | null) => void,
    private readonly onConflictsChanged?: (lineIds: ReadonlySet<string>) => void,
  ) {
    this.contexts = getContexts(layers);
    this.initialMinWidth = paper.style.minWidth;
    this.initialMinHeight = paper.style.minHeight;
    this.initialWidth = paper.style.width;
    this.initialHeight = paper.style.height;
    for (const canvas of Object.values(layers)) {
      canvas.style.pointerEvents = "none";
      canvas.addEventListener("contextlost", this.onContextLost);
      canvas.addEventListener("contextrestored", this.onContextRestored);
    }
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(paper);
      if (paper.parentElement) this.observer.observe(paper.parentElement);
    }
    window.addEventListener("resize", this.resize);
    void paper.ownerDocument.fonts?.ready.then(() => {
      if (!this.destroyed) this.refresh();
    });
    this.refresh();
  }

  setInk(strokes: readonly Stroke[]): void {
    this.ink = strokes.map(cloneStroke);
    this.inkBounds = this.ink.map(strokeBounds);
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

  setSelection(strokes: readonly Stroke[]): void {
    this.selection = strokes.map(cloneStroke);
    this.draftDirty = true;
    this.schedule();
  }

  setPageSize(size: { width: number; height: number } | null): void {
    if (size !== null && (!Number.isFinite(size.width) || size.width <= 0 ||
      !Number.isFinite(size.height) || size.height <= 0)) {
      throw new RangeError("Invalid page size");
    }
    this.pageSize = size === null ? null : { ...size };
    this.recomputePlacement();
    this.updateExtent();
    this.resize();
    this.answerDirty = true;
    this.schedule();
  }

  setCamera(camera: CanvasCamera | null): void {
    if (camera !== null && (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) ||
      !Number.isFinite(camera.scale) || camera.scale <= 0)) {
      throw new RangeError("Invalid canvas camera");
    }
    if (this.camera?.x === camera?.x && this.camera?.y === camera?.y &&
      this.camera?.scale === camera?.scale) return;
    const boundsChanged = (this.camera === null) !== (camera === null);
    this.camera = camera === null ? null : { ...camera };
    if (boundsChanged) this.recomputePlacement();
    if (boundsChanged || (window.devicePixelRatio || 1) !== this.dpr) this.resize();
    this.inkDirty = true;
    this.answerDirty = true;
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

  rightmostAnswerEdge(): number | null {
    if (this.placed.length === 0) return null;
    return this.placed.reduce((right, { footprint }) => Math.max(right, footprint.right), 0);
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
    this.paper.style.width = this.initialWidth;
    this.paper.style.height = this.initialHeight;
  }

  private recomputePlacement(): void {
    const context = this.contexts.answers;
    const { placed, conflicts } = placeAnswerProjections(
      this.answers,
      this.ink,
      (text, font) => {
        context.font = font;
        return context.measureText(text).width;
      },
      this.camera ? undefined : this.pageSize ?? undefined,
      this.camera !== null,
    );
    const changed =
      conflicts.size !== this.conflicts.size ||
      [...conflicts].some((lineId) => !this.conflicts.has(lineId));
    this.placed = placed;
    this.conflicts = conflicts;
    if (changed) this.onConflictsChanged?.(new Set(conflicts));
  }

  private updateExtent(): void {
    if (this.camera) {
      const parent = this.paper.parentElement;
      const width = `${Math.max(1, parent?.clientWidth ?? this.paper.clientWidth)}px`;
      const height = `${Math.max(1, parent?.clientHeight ?? this.paper.clientHeight)}px`;
      this.paper.style.width = width;
      this.paper.style.height = height;
      this.paper.style.minWidth = width;
      this.paper.style.minHeight = height;
      return;
    }
    if (this.pageSize) {
      const width = `${this.pageSize.width}px`;
      const height = `${this.pageSize.height}px`;
      this.paper.style.width = width;
      this.paper.style.height = height;
      this.paper.style.minWidth = width;
      this.paper.style.minHeight = height;
      return;
    }
    this.paper.style.width = this.initialWidth;
    this.paper.style.height = this.initialHeight;
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
    const width = Math.max(1, this.camera ? this.paper.parentElement?.clientWidth ?? this.paper.clientWidth
      : this.pageSize?.width ?? this.paper.clientWidth);
    const height = Math.max(1, this.camera ? this.paper.parentElement?.clientHeight ?? this.paper.clientHeight
      : this.pageSize?.height ?? this.paper.clientHeight);
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
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    if (this.camera) {
      const scale = this.dpr * this.camera.scale;
      context.setTransform(scale, 0, 0, scale, -this.camera.x * scale, -this.camera.y * scale);
    }
  }

  private paintInk(): void {
    this.inkDirty = false;
    const context = this.contexts.ink;
    this.clear(context);
    const darkPaper = this.paper.closest?.(".workspace")?.getAttribute("data-mode") === "notebook";
    const visible = this.camera && {
      left: this.camera.x,
      top: this.camera.y,
      right: this.camera.x + this.width / this.camera.scale,
      bottom: this.camera.y + this.height / this.camera.scale,
    };
    for (let index = 0; index < this.ink.length; index++) {
      if (!visible || rectsOverlap(this.inkBounds[index], visible)) {
        drawStroke(context, this.ink[index], darkPaper);
      }
    }
  }

  private paintAnswers(): void {
    this.answerDirty = false;
    const context = this.contexts.answers;
    this.clear(context);
    const style = getComputedStyle(this.paper);
    context.textBaseline = "middle";
    const visible = this.camera && {
      left: this.camera.x,
      top: this.camera.y,
      right: this.camera.x + this.width / this.camera.scale,
      bottom: this.camera.y + this.height / this.camera.scale,
    };
    for (const { projection, footprint, fontSize, valueWidth, label } of this.placed) {
      if (visible && !rectsOverlap(footprint, visible)) continue;
      context.fillStyle =
        (projection.source === "corrected"
          ? style.getPropertyValue("--corrected-color")
          : projection.source === "attention"
            ? style.getPropertyValue("--danger")
          : style.getPropertyValue("--answer-color")
        ).trim() || "#087e77";
      const baseline = footprint.top + (footprint.bottom - footprint.top) / 2;
      context.font = answerFont(fontSize);
      context.fillText(projection.text, footprint.left, baseline);
      if (label) {
        context.font = LABEL_FONT;
        context.fillText(label, footprint.left + valueWidth + LABEL_GAP, baseline);
      }
    }
  }

  private paintDraft(): void {
    this.draftDirty = false;
    const context = this.contexts.draft;
    this.clear(context);
    const darkPaper = this.paper.closest?.(".workspace")?.getAttribute("data-mode") === "notebook";
    if (this.selection.length > 0) {
      context.save();
      context.globalAlpha = 0.4;
      for (const stroke of this.selection) {
        drawStroke(context, {
          width: stroke.width + 5,
          points: stroke.points,
          color: "#168ac1",
        }, darkPaper);
      }
      context.restore();
    }
    const draft = this.draft;
    if (!draft || draft.points.length === 0) return;
    const color = getComputedStyle(this.paper).getPropertyValue("--draft-color").trim() || "#526b67";
    if (draft.tool === "pen" || draft.tool === "pencil") {
      drawStroke(context, {
        width: draft.width,
        points: draft.points,
        color: draft.color ?? color,
        style: draft.tool,
      }, darkPaper);
    } else if (draft.tool === "lasso") {
      context.save();
      context.strokeStyle = "#168ac1";
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.beginPath();
      context.moveTo(draft.points[0].x, draft.points[0].y);
      for (const point of draft.points.slice(1)) context.lineTo(point.x, point.y);
      if (draft.points.length > 2) context.lineTo(draft.points[0].x, draft.points[0].y);
      context.stroke();
      context.restore();
    } else {
      const point = draft.points.at(-1)!;
      context.save();
      context.strokeStyle = color;
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
