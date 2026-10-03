import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { REQUIRED_OFFLINE_ASSETS } from "./src/pwa/assets.ts";

const output = resolve("dist");

function requiredEmittedAsset(path: string): boolean {
  return path.startsWith("assets/") &&
    /\.(?:js|mjs|css|woff2|svg|json|wasm|onnx|tar)$/.test(path) &&
    !/^assets\/ort-wasm-simd-threaded\.jsep-.*\.wasm$/.test(path);
}

function emittedAssets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return emittedAssets(path);
    return [relative(output, path).split(sep).join("/")];
  });
}

export default defineConfig({
  plugins: [
    {
      name: "emit-offline-asset-list",
      apply: "build",
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).filter(requiredEmittedAsset).sort();
        if (!assets.length) throw new Error("No bundled offline assets were emitted");
        this.emitFile({
          type: "asset",
          fileName: "offline-assets.json",
          source: JSON.stringify({ version: 1, assets }),
        });
      },
    },
    {
      name: "serve-local-ort-modules-in-dev",
      apply: "serve",
      configureServer(server) {
        const modules = new Set([
          "ort-wasm-simd-threaded.mjs",
          "ort-wasm-simd-threaded.jsep.mjs",
        ]);
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          const name = url.pathname.slice("/paddle-ort/".length);
          if (!url.pathname.startsWith("/paddle-ort/") ||
              !url.searchParams.has("import") || !modules.has(name)) {
            next();
            return;
          }
          try {
            response.setHeader("Content-Type", "text/javascript; charset=utf-8");
            response.end(readFileSync(resolve("public/paddle-ort", name)));
          } catch (error) {
            next(error);
          }
        });
      },
    },
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: {
        name: "CalcInk - Handwritten Math Notebook",
        short_name: "CalcInk",
        description: "A private, on-device handwritten arithmetic notebook.",
        theme_color: "#f3efe6",
        background_color: "#f3efe6",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,woff2,svg,webmanifest,json,wasm,onnx,tar}"],
        // Bare model URLs return empty 204 responses in Chrome; use the OCR URLs.
        globIgnores: ["assets/ort-wasm-simd-threaded.jsep-*.wasm", "models/paddle/*.tar"],
        additionalManifestEntries: [
          { url: "models/paddle/PP-OCRv6_tiny_det_onnx_infer.tar?v=ff6ab415", revision: null },
          { url: "models/paddle/PP-OCRv6_tiny_rec_onnx_infer.tar?v=1e13b227", revision: null },
        ],
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        inlineWorkboxRuntime: true,
      },
    }),
    {
      name: "verify-complete-offline-precache",
      apply: "build",
      enforce: "post",
      closeBundle() {
        const worker = readFileSync(resolve(output, "sw.js"), "utf8");
        const required = [
          ...REQUIRED_OFFLINE_ASSETS,
          ...emittedAssets(resolve(output, "assets")).filter(requiredEmittedAsset),
        ];
        const missing = required.filter((path) => !worker.includes(path));
        if (missing.length) {
          throw new Error(`Offline precache is incomplete: ${missing.join(", ")}`);
        }
      },
    },
  ],
});
