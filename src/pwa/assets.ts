// These fixed URLs must exist in the build's precache before offline readiness is reported.
export const REQUIRED_OFFLINE_ASSETS = [
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "offline-assets.json",
  "models/paddle/PP-OCRv6_tiny_det_onnx_infer.tar?v=ff6ab415",
  "models/paddle/PP-OCRv6_tiny_rec_onnx_infer.tar?v=1e13b227",
  "paddle-ort/ort-wasm-simd-threaded.jsep.mjs",
  "paddle-ort/ort-wasm-simd-threaded.jsep.wasm",
] as const;
