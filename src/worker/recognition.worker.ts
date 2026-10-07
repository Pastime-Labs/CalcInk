import { PaddleOCR } from "@paddleocr/paddleocr-js";
import { InvalidInkError, RASTER_VERSION, rasterizeLine } from "./raster";
import type {
  RecognitionIdentity,
  RecognitionRequest,
  RecognitionResponse,
  RecognizeRequest,
} from "./protocol";

const MODEL_ID = "PP-OCRv6_tiny_det+rec";
const DECODER_ID = "ctc-mask-v1";
const MODEL_ROOT = `${import.meta.env.BASE_URL}models/paddle/`;
const ORT_ROOT = `${import.meta.env.BASE_URL}paddle-ort/`;
const scope = self as DedicatedWorkerGlobalScope;

type Ocr = Awaited<ReturnType<typeof PaddleOCR.create>>;
let model: Promise<Ocr> | null = null;
let active: RecognizeRequest | null = null;
const queued: RecognizeRequest[] = [];
const cancelled = new Set<number>();

function post(response: RecognitionResponse): void {
  scope.postMessage(response);
}

function identity(request: RecognizeRequest): RecognitionIdentity {
  const { requestId, pageId, lineId, canvasRevisionId } = request;
  return { requestId, pageId, lineId, canvasRevisionId };
}

function getModel(): Promise<Ocr> {
  model ??= PaddleOCR.create({
    textDetectionModelName: "PP-OCRv6_tiny_det",
    textRecognitionModelName: "PP-OCRv6_tiny_rec",
    textDetectionModelAsset: {
      url: `${MODEL_ROOT}PP-OCRv6_tiny_det_onnx_infer.tar?v=ff6ab415`,
    },
    textRecognitionModelAsset: {
      url: `${MODEL_ROOT}PP-OCRv6_tiny_rec_onnx_infer.tar?v=1e13b227`,
    },
    // The SDK's direct pipeline uses document.createElement, so its own
    // Worker is required even though this application Worker owns rasterization.
    worker: true,
    ortOptions: {
      backend: "wasm",
      wasmPaths: ORT_ROOT,
      numThreads: 1,
      simd: true,
    },
  }).catch((error: unknown) => {
    model = null;
    throw error;
  });
  return model;
}

async function initialize(requestId: number): Promise<void> {
  const start = performance.now();
  try {
    await getModel();
    post({
      type: "ready",
      requestId,
      modelId: MODEL_ID,
      decoderId: DECODER_ID,
      elapsedMs: performance.now() - start,
    });
  } catch (error) {
    console.error("CalcInk model initialization failed", error);
    post({ type: "init_error", requestId, code: "model_load_failed", elapsedMs: performance.now() - start });
  }
}

async function recognize(request: RecognizeRequest): Promise<void> {
  const start = performance.now();
  let image: ImageBitmap | null = null;
  try {
    const raster = rasterizeLine(request.strokes);
    image = raster.image;
    const ocr = await getModel().catch(() => {
      throw new ModelLoadError();
    });
    if (cancelled.has(request.requestId)) return;
    const [result] = await ocr.predict(image);
    if (cancelled.has(request.requestId)) return;
    if (!result) throw new Error("OCR returned no result");
    const boxes = result.items.map((item) => {
      const masked = item as typeof item & { unmaskedText?: string; unmaskedScore?: number };
      if (typeof masked.unmaskedText !== "string" ||
          !Number.isFinite(masked.unmaskedScore)) {
        throw new Error("PaddleOCR CTC mask is unavailable");
      }
      return {
        text: item.text,
        score: item.score,
        unmaskedText: masked.unmaskedText,
        unmaskedScore: masked.unmaskedScore,
      };
    });
    post({
      type: "result",
      ...identity(request),
      rawText: boxes.map((box) => box.text).join(""),
      unmaskedRawText: boxes.map((box) => box.unmaskedText).join(""),
      boxes,
      detMs: result.metrics.detMs,
      recMs: result.metrics.recMs,
      elapsedMs: performance.now() - start,
      raster: {
        width: raster.plan.width,
        height: raster.plan.height,
        version: RASTER_VERSION,
      },
    });
  } catch (error) {
    if (!cancelled.has(request.requestId)) {
      post({
        type: "error",
        ...identity(request),
        code: error instanceof InvalidInkError ? "invalid_ink"
          : error instanceof ModelLoadError ? "model_load_failed"
            : "inference_failed",
        elapsedMs: performance.now() - start,
      });
    }
  } finally {
    image?.close();
    cancelled.delete(request.requestId);
  }
}

class ModelLoadError extends Error {}

async function drain(): Promise<void> {
  if (active) return;
  while (queued.length > 0) {
    const request = queued.shift()!;
    if (cancelled.delete(request.requestId)) continue;
    active = request;
    await recognize(request);
    active = null;
  }
}

scope.addEventListener("message", (event: MessageEvent<RecognitionRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    void initialize(request.requestId);
    return;
  }
  if (request.type === "cancel") {
    if (active?.requestId === request.requestId) cancelled.add(request.requestId);
    const index = queued.findIndex((job) => job.requestId === request.requestId);
    if (index !== -1) queued.splice(index, 1);
    return;
  }

  if (active?.pageId === request.pageId && active.lineId === request.lineId) {
    cancelled.add(active.requestId);
  }
  const previous = queued.findIndex((job) => job.pageId === request.pageId && job.lineId === request.lineId);
  if (previous !== -1) queued.splice(previous, 1);
  queued.push(request);
  void drain();
});
