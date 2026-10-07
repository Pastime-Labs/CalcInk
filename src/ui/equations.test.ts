import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page, Stroke } from "../canvas/types";
import type { RecognitionRequest, RecognitionResponse } from "../worker";
import { EquationController } from "./equations";

class FakeWorker {
  onmessage: ((event: MessageEvent<RecognitionResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  sent: RecognitionRequest[] = [];

  postMessage(request: RecognitionRequest): void {
    this.sent.push(request);
  }

  emit(response: RecognitionResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<RecognitionResponse>);
  }

  terminate(): void {}
}

function stroke(id: string, x: number, y = 10): Stroke {
  return {
    id,
    width: 4,
    points: [{ x, y }, { x: x + 12, y: y + 14 }],
  };
}

function page(id: string, strokes: Stroke[]): Page {
  return { schemaVersion: 2, id, title: id, createdAt: 1, updatedAt: 1, strokes };
}

afterEach(() => vi.useRealTimers());

describe("EquationController", () => {
  it("exports the first automatic read without letting retry or correction replace it", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const ink = stroke("one", 10);
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    const environment = {
      userAgent: "Test browser",
      language: "en",
      devicePixelRatio: 2,
      online: false,
      exportedAt: "2026-10-04T00:00:00.000Z",
    };
    controller.setPage(page("A", [ink]), {});
    const lineId = controller.lines[0]!.line.lineId;
    expect(controller.hasFirstRead(lineId)).toBe(false);
    expect(controller.diagnosticSampleFor(lineId, "9+9=", environment)).toBeNull();

    worker.emit({
      type: "ready",
      requestId: 1,
      modelId: "PP-OCRv6_tiny_det+rec",
      decoderId: "ctc-mask-v2",
      elapsedMs: 1,
    });
    await vi.runOnlyPendingTimersAsync();
    const first = worker.sent.find((request) => request.type === "recognize");
    if (!first || first.type !== "recognize") throw new Error("First read was not sent");
    const box = {
      text: "9+9=",
      score: 0.8,
      unmaskedText: "g+g=",
      unmaskedScore: 0.9,
      poly: [[1, 2], [3, 2]] as [number, number][],
    };
    worker.emit({
      type: "result",
      requestId: first.requestId,
      pageId: first.pageId,
      lineId: first.lineId,
      canvasRevisionId: first.canvasRevisionId,
      rawText: "9+9=",
      unmaskedRawText: "g+g=",
      boxes: [box],
      detectedBoxes: 2,
      recognizedCount: 1,
      detMs: 3,
      recMs: 4,
      elapsedMs: 10,
      raster: { width: 32, height: 24, version: "raster-v1" },
    });
    expect(controller.hasFirstRead(lineId)).toBe(true);
    expect(controller.lines[0]?.unmaskedRawRead).toBe("g+g=");
    expect(controller.lines[0]?.message).toContain("Verify this answer");
    ink.points[0]!.x = 999;
    box.text = "changed";
    box.poly[0]![0] = 99;

    controller.retry();
    const init = worker.sent.at(-1);
    if (!init || init.type !== "init") throw new Error("Retry was not initialized");
    worker.emit({
      type: "ready",
      requestId: init.requestId,
      modelId: "PP-OCRv6_tiny_det+rec",
      decoderId: "ctc-mask-v2",
      elapsedMs: 1,
    });
    await vi.runOnlyPendingTimersAsync();
    const second = worker.sent.filter((request) => request.type === "recognize").at(-1);
    if (!second || second.type !== "recognize") throw new Error("Second read was not sent");
    worker.emit({
      type: "result",
      requestId: second.requestId,
      pageId: second.pageId,
      lineId: second.lineId,
      canvasRevisionId: second.canvasRevisionId,
      rawText: "11+11=",
      boxes: [{ text: "11+11=", score: 0.99 }],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 40, height: 25, version: "raster-v2" },
    });
    const guard = controller.guardFor(lineId)!;
    expect(controller.applyCorrection(guard, "12+12=")).toBeNull();
    const sample = controller.diagnosticSampleFor(lineId, "9 \u00d7 2 =", environment)!;
    expect(sample).toMatchObject({
      schemaVersion: 1,
      intendedExpression: "9*2=",
      strokes: [{ id: "one", points: [{ x: 10, y: 10 }, { x: 22, y: 24 }] }],
      firstRead: {
        rawText: "9+9=",
        unmaskedRawText: "g+g=",
        normalizedText: "9+9=",
        result: { kind: "value", display: "18" },
        boxes: [{
          text: "9+9=", score: 0.8, unmaskedText: "g+g=", unmaskedScore: 0.9,
          poly: [[1, 2], [3, 2]],
        }],
        detectedBoxes: 2,
        recognizedCount: 1,
        detMs: 3,
        recMs: 4,
        elapsedMs: 10,
        raster: { width: 32, height: 24, version: "raster-v1" },
      },
      model: {
        id: "PP-OCRv6_tiny_det+rec",
        decoder: "ctc-mask-v2",
        detector: {
          id: "PP-OCRv6_tiny_det",
          archiveSha256: "ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d",
        },
        recognizer: {
          id: "PP-OCRv6_tiny_rec",
          archiveSha256: "1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29",
        },
      },
      environment,
    });
    expect(sample.sampleId).toMatch(/^[0-9a-f-]{36}$/);
    sample.strokes[0]!.points[0]!.x = 500;
    sample.firstRead.boxes[0]!.text = "changed again";
    sample.firstRead.boxes[0]!.poly![0]![0] = 77;
    const repeated = controller.diagnosticSampleFor(lineId, "9*2=", environment)!;
    expect(repeated.strokes[0]!.points[0]!.x).toBe(10);
    expect(repeated.firstRead.boxes[0]!.text).toBe("9+9=");
    expect(repeated.firstRead.boxes[0]!.poly![0]![0]).toBe(1);
    expect(() => controller.diagnosticSampleFor(lineId, "9+=", environment)).toThrow();
    controller.inkChanged(page("A", [stroke("other", 10)]));
    expect(controller.hasFirstRead(controller.lines[0]!.line.lineId)).toBe(false);
    controller.setPage(page("B", [stroke("one", 10)]), {});
    expect(controller.hasFirstRead(controller.lines[0]!.line.lineId)).toBe(false);
    controller.destroy();
  });

  it("does not assume missing terminal equals was never drawn", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    controller.setPage(page("A", [stroke("one", 10)]), {});
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    const request = worker.sent.find((item) => item.type === "recognize");
    if (!request || request.type !== "recognize") throw new Error("Read was not sent");
    worker.emit({
      type: "result",
      requestId: request.requestId,
      pageId: request.pageId,
      lineId: request.lineId,
      canvasRevisionId: request.canvasRevisionId,
      rawText: "21",
      boxes: [{ text: "21", score: 0.8 }],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines[0]).toMatchObject({
      phase: "incomplete",
      rawRead: "21",
      result: null,
      message: "No final = was recognized. Check the ink or correct the read.",
    });
    const sample = controller.diagnosticSampleFor(request.lineId, "1+2", {
      userAgent: "Test browser",
      language: "en",
      devicePixelRatio: 1,
      online: true,
      exportedAt: "2026-10-05T00:00:00.000Z",
    });
    expect(sample?.intendedExpression).toBe("1+2");
    expect(() => controller.diagnosticSampleFor(request.lineId, "1+", sample!.environment)).toThrow();
    controller.destroy();
  });

  it("evaluates an OCR read ending in U+4E8C while preserving the raw read", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    controller.setPage(page("A", [stroke("one", 10)]), {});
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    const request = worker.sent.find((item) => item.type === "recognize");
    if (!request || request.type !== "recognize") throw new Error("Read was not sent");
    worker.emit({
      type: "result",
      requestId: request.requestId,
      pageId: request.pageId,
      lineId: request.lineId,
      canvasRevisionId: request.canvasRevisionId,
      rawText: "11+11\u4e8c",
      boxes: [{ text: "11+11\u4e8c", score: 0.8 }],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines[0]).toMatchObject({
      phase: "complete",
      rawRead: "11+11\u4e8c",
      normalizedRead: "11+11=",
      result: { kind: "value", display: "22" },
    });
    const sample = controller.diagnosticSampleFor(request.lineId, "11+11=", {
      userAgent: "test",
      language: "en",
      devicePixelRatio: 1,
      online: true,
      exportedAt: "2026-10-07T00:00:00.000Z",
    });
    expect(sample?.firstRead).toMatchObject({
      rawText: "11+11\u4e8c",
      normalizedText: "11+11=",
    });
    controller.destroy();
  });

  it("reports an empty OCR result as a completed read, not pending work", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    controller.setPage(page("A", [stroke("one", 10)]), {});
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    const request = worker.sent.find((item) => item.type === "recognize");
    if (!request || request.type !== "recognize") throw new Error("Read was not sent");
    worker.emit({
      type: "result",
      requestId: request.requestId,
      pageId: request.pageId,
      lineId: request.lineId,
      canvasRevisionId: request.canvasRevisionId,
      rawText: "",
      boxes: [],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines[0]).toMatchObject({
      phase: "incomplete",
      rawRead: "",
      message: "No text was recognized. Check the ink or correct the read.",
    });
    expect(controller.hasFirstRead(request.lineId)).toBe(true);
    controller.destroy();
  });

  it("does not turn a retry after an OCR error into first-read evidence", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    controller.setPage(page("A", [stroke("one", 10)]), {});
    const lineId = controller.lines[0]!.line.lineId;
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    const first = worker.sent.find((request) => request.type === "recognize");
    if (!first || first.type !== "recognize") throw new Error("First read was not sent");
    worker.emit({
      type: "error",
      requestId: first.requestId,
      pageId: first.pageId,
      lineId: first.lineId,
      canvasRevisionId: first.canvasRevisionId,
      code: "inference_failed",
      elapsedMs: 5,
    });
    expect(controller.hasFirstRead(lineId)).toBe(false);

    controller.retry();
    const init = worker.sent.at(-1);
    if (!init || init.type !== "init") throw new Error("Retry was not initialized");
    worker.emit({ type: "ready", requestId: init.requestId, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    const second = worker.sent.filter((request) => request.type === "recognize").at(-1);
    if (!second || second.type !== "recognize") throw new Error("Retry read was not sent");
    worker.emit({
      type: "result",
      requestId: second.requestId,
      pageId: second.pageId,
      lineId: second.lineId,
      canvasRevisionId: second.canvasRevisionId,
      rawText: "9=",
      boxes: [{ text: "9=", score: 0.9 }],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines[0]?.result).toMatchObject({ kind: "value", display: "9" });
    expect(controller.hasFirstRead(lineId)).toBe(false);
    controller.destroy();
  });

  it.each([
    { label: "empty", maskedText: "" },
    { label: "space-only", maskedText: " " },
  ])("rejects a valid-looking read when masking leaves a $label box", async ({ maskedText }) => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    controller.setPage(page("A", [stroke("one", 10)]), {});
    const lineId = controller.lines[0]!.line.lineId;
    worker.emit({
      type: "ready",
      requestId: 1,
      modelId: "PP-OCRv6_tiny_det+rec",
      decoderId: "ctc-mask-v2",
      elapsedMs: 1,
    });
    await vi.runOnlyPendingTimersAsync();
    const request = worker.sent.find((item) => item.type === "recognize");
    if (!request || request.type !== "recognize") throw new Error("Read was not sent");
    worker.emit({
      type: "result",
      requestId: request.requestId,
      pageId: request.pageId,
      lineId: request.lineId,
      canvasRevisionId: request.canvasRevisionId,
      rawText: `${maskedText}9=`,
      unmaskedRawText: "g9=",
      boxes: [
        { text: maskedText, score: 0, unmaskedText: "g", unmaskedScore: 0.9 },
        { text: "9=", score: 0.8, unmaskedText: "9=", unmaskedScore: 0.8 },
      ],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines[0]).toMatchObject({
      phase: "unreadable",
      rawRead: `${maskedText}9=`,
      unmaskedRawRead: "g9=",
      result: null,
    });
    expect(controller.lines[0]?.message).toContain("omitted part");
    const sample = controller.diagnosticSampleFor(lineId, "9=", {
      userAgent: "test",
      language: "en",
      devicePixelRatio: 1,
      online: true,
      exportedAt: "2026-10-04T00:00:00.000Z",
    });
    expect(sample?.firstRead).toMatchObject({ normalizedText: null, result: null });
    controller.destroy();
  });

  it("drops stale replies and keeps a correction over a cancelled read", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const changes = vi.fn();
    const corrections = vi.fn();
    const controller = new EquationController(
      changes,
      corrections,
      () => worker as unknown as Worker,
    );
    controller.setPage(page("A", [stroke("one", 10)]), {});
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    const first = worker.sent.find((request) => request.type === "recognize");
    if (!first || first.type !== "recognize") throw new Error("First read was not sent");

    controller.inkChanged(page("A", [stroke("one", 10), stroke("two", 30)]));
    worker.emit({
      type: "result",
      requestId: first.requestId,
      pageId: first.pageId,
      lineId: first.lineId,
      canvasRevisionId: first.canvasRevisionId,
      rawText: "1+1=",
      boxes: [],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines.some((view) => view.phase === "complete")).toBe(false);
    expect(controller.lines.some((view) => controller.hasFirstRead(view.line.lineId))).toBe(false);
    await vi.advanceTimersByTimeAsync(750);
    const second = worker.sent.filter((request) => request.type === "recognize").at(-1);
    if (!second || second.type !== "recognize") throw new Error("Second read was not sent");
    expect(second.canvasRevisionId).toBeGreaterThan(first.canvasRevisionId);

    const guard = controller.guardFor(second.lineId);
    if (!guard) throw new Error("No correction guard");
    expect(controller.applyCorrection(guard, "11+11=")).toBeNull();
    worker.emit({
      type: "result",
      requestId: second.requestId,
      pageId: second.pageId,
      lineId: second.lineId,
      canvasRevisionId: second.canvasRevisionId,
      rawText: "1+1=",
      boxes: [],
      detMs: 1,
      recMs: 1,
      elapsedMs: 2,
      raster: { width: 20, height: 20, version: "test" },
    });
    expect(controller.lines[0]?.result).toMatchObject({ kind: "value", display: "22" });
    expect(controller.lines[0]?.source).toBe("corrected");
    expect(controller.lines[0]?.rawRead).toBe("");
    expect(corrections).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it("rejects a correction if the canvas revision changed", () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(() => {}, () => {}, () => worker as unknown as Worker);
    controller.setPage(page("A", [stroke("one", 10)]), {});
    const guard = controller.guardFor(controller.lines[0]!.line.lineId)!;
    controller.inkChanged(page("A", [stroke("one", 10), stroke("two", 30)]));
    expect(controller.applyCorrection(guard, "11+11=")).toContain("ink changed");
    expect(controller.corrections).toEqual({});
    controller.destroy();
  });

  it("keeps ink lines and manual correction available when Worker construction fails", async () => {
    vi.useFakeTimers();
    let unavailable = true;
    const worker = new FakeWorker();
    const controller = new EquationController(
      () => {},
      () => {},
      () => {
        if (unavailable) throw new Error("Worker blocked");
        return worker as unknown as Worker;
      },
    );
    controller.setPage(page("A", [stroke("one", 10)]), {});
    expect(controller.status).toBe("unavailable");
    const guard = controller.guardFor(controller.lines[0]!.line.lineId)!;
    expect(controller.applyCorrection(guard, "11+11=")).toBeNull();
    expect(controller.lines[0]?.result).toMatchObject({ kind: "value", display: "22" });
    unavailable = false;
    controller.retry();
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(controller.status).toBe("ready");
    expect(controller.lines[0]?.source).toBe("corrected");
    controller.destroy();
  });

  it("shows model initialization failure and preserves correction after retry", async () => {
    vi.useFakeTimers();
    const first = new FakeWorker();
    const second = new FakeWorker();
    let calls = 0;
    const controller = new EquationController(
      () => {},
      () => {},
      () => (calls++ === 0 ? first : second) as unknown as Worker,
    );
    controller.setPage(page("A", [stroke("upper", 10), stroke("lower", 10, 80)]), {});
    first.emit({ type: "init_error", requestId: 1, code: "model_load_failed", elapsedMs: 4 });
    expect(controller.status).toBe("unavailable");
    expect(controller.lines).toHaveLength(2);
    expect(controller.lines.every((line) =>
      line.phase === "unreadable" && line.message.includes("Recognition is unavailable"))).toBe(true);

    const guard = controller.guardFor(controller.lines[0]!.line.lineId)!;
    expect(controller.applyCorrection(guard, "11+11=")).toBeNull();
    controller.retry();
    expect(controller.lines[0]?.result).toMatchObject({ kind: "value", display: "22" });
    expect(controller.lines[0]?.source).toBe("corrected");
    const init = second.sent[0];
    if (!init || init.type !== "init") throw new Error("Retry did not initialize the model");
    second.emit({ type: "ready", requestId: init.requestId, modelId: "test", elapsedMs: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(controller.status).toBe("reading");
    expect(second.sent.some((request) =>
      request.type === "recognize" && request.lineId === controller.lines[1]?.line.lineId)).toBe(true);
    expect(controller.lines[0]?.source).toBe("corrected");
    controller.destroy();
  });

  it("reads the edited lower line before an older queued upper line", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new EquationController(
      () => {},
      () => {},
      () => worker as unknown as Worker,
    );
    controller.setPage(page("A", [stroke("upper", 10)]), {});
    worker.emit({ type: "ready", requestId: 1, modelId: "test", elapsedMs: 1 });
    controller.inkChanged(page("A", [stroke("upper", 10), stroke("lower", 10, 80)]));
    await vi.advanceTimersByTimeAsync(750);
    const first = worker.sent.find((request) => request.type === "recognize");
    expect(first).toMatchObject({ type: "recognize", lineId: "line:lower" });
    controller.destroy();
  });
});
