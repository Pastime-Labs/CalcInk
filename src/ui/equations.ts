import { groupEquationLines, hasTerminalEqualsHint, type EquationLine } from "../canvas/lines";
import type { Page, Stroke } from "../canvas/types";
import { evaluate, normalizeRead, type EquationResult } from "../parser";
import {
  createRecognitionWorker,
  type RecognitionIdentity,
  type RecognitionRequest,
  type RecognitionResponse,
} from "../worker";

export type RecognitionStatus = "loading" | "ready" | "reading" | "unavailable";
export type LinePhase = "queued" | "reading" | "incomplete" | "complete" | "unreadable";

export type LineView = {
  line: EquationLine;
  phase: LinePhase;
  rawRead: string;
  normalizedRead: string;
  result: EquationResult | null;
  source: "automatic" | "corrected" | null;
  message: string;
};

export type CorrectionGuard = {
  pageId: string;
  lineId: string;
  canvasRevisionId: number;
  signature: string;
};

type FirstRead = {
  strokes: Stroke[];
  modelId: string;
  rawText: string;
  normalizedText: string | null;
  result: EquationResult | null;
  boxes: Array<{ text: string; score: number }>;
  detMs: number;
  recMs: number;
  elapsedMs: number;
  raster: { width: number; height: number; version: string };
};

export type DiagnosticEnvironment = {
  userAgent: string;
  language: string;
  devicePixelRatio: number;
  online: boolean;
  exportedAt: string;
};

export type DiagnosticSample = {
  schemaVersion: 1;
  sampleId: string;
  intendedExpression: string;
  strokes: Stroke[];
  firstRead: Omit<FirstRead, "strokes" | "modelId">;
  model: {
    id: string;
    detector: { id: string; archiveSha256: string } | null;
    recognizer: { id: string; archiveSha256: string } | null;
  };
  environment: DiagnosticEnvironment;
};

// These archive pins must match scripts/prepare-assets.mjs.
const PINNED_MODEL_ID = "PP-OCRv6_tiny_det+rec";
const PINNED_DETECTOR = {
  id: "PP-OCRv6_tiny_det",
  archiveSha256: "ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d",
};
const PINNED_RECOGNIZER = {
  id: "PP-OCRv6_tiny_rec",
  archiveSha256: "1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29",
};

function cloneStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({
    id: stroke.id,
    width: stroke.width,
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

function corrected(line: EquationLine, text: string): LineView | null {
  const normalized = normalizeRead(text);
  if (normalized.kind !== "canonical" || !normalized.text.endsWith("=")) return null;
  const result = evaluate(normalized.text);
  if (result.kind === "syntax") return null;
  return {
    line,
    phase: "complete",
    rawRead: text,
    normalizedRead: normalized.text,
    result,
    source: "corrected",
    message: "",
  };
}

function queued(line: EquationLine): LineView {
  return {
    line,
    phase: "queued",
    rawRead: "",
    normalizedRead: "",
    result: null,
    source: null,
    message: "",
  };
}

export class EquationController {
  private worker: Worker | null = null;
  private requestId = 0;
  private initId = 0;
  private active: RecognitionIdentity | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduled = false;
  private preferredSignature: string | null = null;
  private pageId = "";
  private revision = 0;
  private lineViews: LineView[] = [];
  private correctionMap: Record<string, string> = {};
  private firstReads = new Map<string, FirstRead>();
  private modelId = "";
  private modelStatus: RecognitionStatus = "loading";

  constructor(
    private readonly onChange: () => void,
    private readonly onCorrectionsChanged: (corrections: Record<string, string>) => void,
    private readonly makeWorker: () => Worker = createRecognitionWorker,
  ) {
    try {
      this.worker = this.createWorker();
      this.initialize();
    } catch {
      this.worker?.terminate();
      this.worker = null;
      this.modelStatus = "unavailable";
      queueMicrotask(() => this.onChange());
    }
  }

  get status(): RecognitionStatus {
    if (this.modelStatus === "ready" && this.active) return "reading";
    return this.modelStatus;
  }

  get lines(): readonly LineView[] {
    return this.lineViews;
  }

  get canvasRevisionId(): number {
    return this.revision;
  }

  get corrections(): Record<string, string> {
    return { ...this.correctionMap };
  }

  setPage(page: Page, corrections: Record<string, string>): void {
    this.cancelActive();
    this.clearTimer();
    if (page.id !== this.pageId) this.firstReads.clear();
    this.pageId = page.id;
    this.revision += 1;
    this.preferredSignature = null;
    this.correctionMap = { ...corrections };
    this.lineViews = groupEquationLines(page.strokes).map((line) =>
      corrected(line, this.correctionMap[line.signature] ?? "") ?? queued(line),
    );
    const signatures = new Set(this.lineViews.map((view) => view.line.signature));
    for (const signature of this.firstReads.keys()) {
      if (!signatures.has(signature)) this.firstReads.delete(signature);
    }
    this.schedule(0);
    this.onChange();
  }

  inkChanged(page: Page): void {
    if (page.id !== this.pageId) throw new Error("Ink edit belongs to another page");
    const previous = new Map(this.lineViews.map((view) => [view.line.signature, view]));
    this.cancelActive();
    this.clearTimer();
    this.revision += 1;
    const next = groupEquationLines(page.strokes);
    const validSignatures = new Set(next.map((line) => line.signature));
    for (const signature of this.firstReads.keys()) {
      if (!validSignatures.has(signature)) this.firstReads.delete(signature);
    }
    let correctionsChanged = false;
    for (const signature of Object.keys(this.correctionMap)) {
      if (!validSignatures.has(signature)) {
        delete this.correctionMap[signature];
        correctionsChanged = true;
      }
    }
    this.lineViews = next.map((line) => {
      const old = previous.get(line.signature);
      if (old?.phase === "complete" || old?.phase === "incomplete" || old?.phase === "unreadable") {
        return { ...old, line };
      }
      return corrected(line, this.correctionMap[line.signature] ?? "") ?? queued(line);
    });
    if (correctionsChanged) this.onCorrectionsChanged(this.corrections);
    const changed = this.lineViews.find((view) => !previous.has(view.line.signature));
    this.preferredSignature = changed?.line.signature ?? null;
    this.schedule(changed && hasTerminalEqualsHint(changed.line) ? 80 : 750);
    this.onChange();
  }

  guardFor(lineId: string): CorrectionGuard | null {
    const view = this.lineViews.find((item) => item.line.lineId === lineId);
    if (!view) return null;
    return {
      pageId: this.pageId,
      lineId,
      canvasRevisionId: this.revision,
      signature: view.line.signature,
    };
  }

  hasFirstRead(lineId: string): boolean {
    const view = this.lineViews.find((item) => item.line.lineId === lineId);
    return !!view && this.firstReads.has(view.line.signature);
  }

  diagnosticSampleFor(
    lineId: string,
    intendedExpression: string,
    environment: DiagnosticEnvironment,
  ): DiagnosticSample | null {
    const view = this.lineViews.find((item) => item.line.lineId === lineId);
    const first = view && this.firstReads.get(view.line.signature);
    if (!first) return null;
    const normalized = normalizeRead(intendedExpression);
    if (normalized.kind !== "canonical") throw new Error(normalized.message);
    if (!normalized.text.endsWith("=")) throw new Error("Finish the intended equation with =.");
    const result = evaluate(normalized.text);
    if (result.kind === "syntax") throw new Error(result.message);
    const pinned = first.modelId === PINNED_MODEL_ID;
    return {
      schemaVersion: 1,
      sampleId: crypto.randomUUID(),
      intendedExpression: normalized.text,
      strokes: cloneStrokes(first.strokes),
      firstRead: {
        rawText: first.rawText,
        normalizedText: first.normalizedText,
        result: first.result ? { ...first.result } : null,
        boxes: first.boxes.map((box) => ({ ...box })),
        detMs: first.detMs,
        recMs: first.recMs,
        elapsedMs: first.elapsedMs,
        raster: { ...first.raster },
      },
      model: {
        id: first.modelId,
        detector: pinned ? { ...PINNED_DETECTOR } : null,
        recognizer: pinned ? { ...PINNED_RECOGNIZER } : null,
      },
      environment: { ...environment },
    };
  }

  applyCorrection(guard: CorrectionGuard, input: string): string | null {
    const view = this.lineViews.find((item) => item.line.lineId === guard.lineId);
    if (
      guard.pageId !== this.pageId ||
      guard.canvasRevisionId !== this.revision ||
      view?.line.signature !== guard.signature
    ) {
      return "The ink changed; review this line again.";
    }
    const normalized = normalizeRead(input);
    if (normalized.kind !== "canonical") return normalized.message;
    if (!normalized.text.endsWith("=")) return "Finish the correction with =.";
    const result = evaluate(normalized.text);
    if (result.kind === "syntax") return result.message;
    if (this.active?.lineId === guard.lineId) this.cancelActive();
    this.correctionMap[view.line.signature] = normalized.text;
    this.lineViews = this.lineViews.map((item) =>
      item.line.lineId === guard.lineId
        ? {
            ...item,
            phase: "complete",
            rawRead: normalized.text,
            normalizedRead: normalized.text,
            result,
            source: "corrected",
            message: "",
          }
        : item,
    );
    this.onCorrectionsChanged(this.corrections);
    this.onChange();
    this.pump();
    return null;
  }

  retry(): void {
    this.cancelActive();
    this.clearTimer();
    this.worker?.terminate();
    this.worker = null;
    this.modelStatus = "loading";
    this.lineViews = this.lineViews.map((view) =>
      view.source === "corrected" ? view : queued(view.line),
    );
    try {
      this.worker = this.createWorker();
      this.initialize();
    } catch {
      this.failWorker();
    }
    this.schedule(0);
    this.onChange();
  }

  destroy(): void {
    this.cancelActive();
    this.clearTimer();
    this.worker?.terminate();
  }

  private createWorker(): Worker {
    const worker = this.makeWorker();
    worker.onmessage = (event: MessageEvent<RecognitionResponse>) => this.receive(event.data);
    worker.onerror = () => this.failWorker();
    worker.onmessageerror = () => this.failWorker();
    return worker;
  }

  private initialize(): void {
    this.initId = ++this.requestId;
    this.post({ type: "init", requestId: this.initId });
  }

  private post(request: RecognitionRequest): void {
    if (!this.worker) throw new Error("Recognition Worker is unavailable");
    this.worker.postMessage(request);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.scheduled = false;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    if (!this.lineViews.some((view) => view.phase === "queued")) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduled = true;
      this.pump();
    }, delay);
  }

  private cancelActive(): void {
    if (!this.active) return;
    try {
      this.post({ type: "cancel", requestId: this.active.requestId });
    } catch {
      // Revision checks still reject any late response from a failed Worker.
    }
    this.active = null;
  }

  private pump(): void {
    if (!this.scheduled || this.modelStatus !== "ready" || this.active) return;
    const view = this.lineViews.find(
      (item) => item.phase === "queued" && item.line.signature === this.preferredSignature,
    ) ?? this.lineViews.find((item) => item.phase === "queued");
    if (!view) return;
    this.preferredSignature = null;
    const identity: RecognitionIdentity = {
      requestId: ++this.requestId,
      pageId: this.pageId,
      lineId: view.line.lineId,
      canvasRevisionId: this.revision,
    };
    this.active = identity;
    view.phase = "reading";
    try {
      this.post({ type: "recognize", ...identity, strokes: [...view.line.strokes] });
    } catch {
      this.failWorker();
      return;
    }
    this.onChange();
  }

  private receive(response: RecognitionResponse): void {
    if (response.type === "ready" || response.type === "init_error") {
      if (response.requestId !== this.initId) return;
      this.modelStatus = response.type === "ready" ? "ready" : "unavailable";
      if (response.type === "ready") this.modelId = response.modelId;
      if (response.type === "init_error") {
        this.lineViews = this.lineViews.map((view) =>
          view.phase === "queued"
            ? { ...view, phase: "unreadable", message: "Recognition is unavailable. Retry to load it." }
            : view,
        );
      }
      this.onChange();
      this.pump();
      return;
    }
    const active = this.active;
    if (
      !active ||
      response.requestId !== active.requestId ||
      response.pageId !== this.pageId ||
      response.pageId !== active.pageId ||
      response.lineId !== active.lineId ||
      response.canvasRevisionId !== this.revision ||
      response.canvasRevisionId !== active.canvasRevisionId
    ) return;
    this.active = null;
    const view = this.lineViews.find((item) => item.line.lineId === response.lineId);
    if (!view || view.phase !== "reading") return;
    if (response.type === "error") {
      view.phase = "unreadable";
      view.message = response.code === "invalid_ink"
        ? "This line is too large or could not be prepared."
        : "Could not read this line. Retry or enter a correction.";
      if (response.code === "model_load_failed") {
        this.modelStatus = "unavailable";
        this.lineViews = this.lineViews.map((item) =>
          item.phase === "queued"
            ? { ...item, phase: "unreadable", message: "Recognition is unavailable. Retry to load it." }
            : item,
        );
      }
    } else {
      view.rawRead = response.rawText;
      const normalized = normalizeRead(response.rawText);
      if (normalized.kind !== "canonical") {
        view.phase = "unreadable";
        view.message = normalized.message;
      } else {
        view.normalizedRead = normalized.text;
        if (!normalized.text.endsWith("=")) {
          view.phase = "incomplete";
          view.message = "Finish with =.";
        } else {
          const result = evaluate(normalized.text);
          view.result = result;
          view.phase = result.kind === "syntax" ? "unreadable" : "complete";
          view.message = result.kind === "syntax" ? result.message : "";
          view.source = "automatic";
        }
      }
      if (!this.firstReads.has(view.line.signature)) {
        this.firstReads.set(view.line.signature, {
          strokes: cloneStrokes(view.line.strokes),
          modelId: this.modelId,
          rawText: response.rawText,
          normalizedText: normalized.kind === "canonical" ? normalized.text : null,
          result: view.result ? { ...view.result } : null,
          boxes: response.boxes.map((box) => ({ ...box })),
          detMs: response.detMs,
          recMs: response.recMs,
          elapsedMs: response.elapsedMs,
          raster: { ...response.raster },
        });
      }
    }
    this.onChange();
    this.pump();
  }

  private failWorker(): void {
    this.active = null;
    this.modelStatus = "unavailable";
    this.lineViews = this.lineViews.map((view) =>
      view.phase === "reading" || view.phase === "queued"
        ? { ...view, phase: "unreadable", message: "Recognition is unavailable. Retry to load it." }
        : view,
    );
    this.onChange();
  }
}
