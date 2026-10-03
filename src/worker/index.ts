export type {
  RecognitionRequest,
  RecognitionResponse,
  RecognizeRequest,
  RecognitionIdentity,
} from "./protocol";

export function createRecognitionWorker(): Worker {
  return new Worker(new URL("./recognition.worker.ts", import.meta.url), {
    type: "module",
    name: "calcink-recognition",
  });
}
