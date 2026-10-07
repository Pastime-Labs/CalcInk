import type { Stroke } from "../canvas/types";

export type InitRequest = {
  type: "init";
  requestId: number;
};

export type RecognizeRequest = {
  type: "recognize";
  requestId: number;
  pageId: string;
  lineId: string;
  canvasRevisionId: number;
  strokes: Stroke[];
};

export type CancelRequest = {
  type: "cancel";
  requestId: number;
};

export type RecognitionRequest = InitRequest | RecognizeRequest | CancelRequest;

export type RecognitionIdentity = Pick<
  RecognizeRequest,
  "requestId" | "pageId" | "lineId" | "canvasRevisionId"
>;

export type RecognitionResponse =
  | {
      type: "ready";
      requestId: number;
      modelId: string;
      decoderId?: string;
      elapsedMs: number;
    }
  | {
      type: "init_error";
      requestId: number;
      code: "model_load_failed";
      elapsedMs: number;
    }
  | (RecognitionIdentity & {
      type: "result";
      rawText: string;
      unmaskedRawText?: string;
      boxes: Array<{
        text: string;
        score: number;
        unmaskedText?: string;
        unmaskedScore?: number;
        poly?: [number, number][];
      }>;
      detectedBoxes?: number;
      recognizedCount?: number;
      detMs: number;
      recMs: number;
      elapsedMs: number;
      raster: { width: number; height: number; version: string };
    })
  | (RecognitionIdentity & {
      type: "error";
      code: "model_load_failed" | "invalid_ink" | "inference_failed";
      elapsedMs: number;
    });
