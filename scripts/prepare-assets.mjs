import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const models = [
  {
    name: "PP-OCRv6_tiny_det_onnx_infer.tar",
    url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_det_onnx_infer.tar",
    sha256: "ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d",
  },
  {
    name: "PP-OCRv6_tiny_rec_onnx_infer.tar",
    url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar",
    sha256: "1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29",
  },
];
const ort = [
  {
    name: "ort-wasm-simd-threaded.jsep.mjs",
    sha256: "33949a3310b723a3ee14dc2da989e55060de26a75e2346095a150a042c9aad4e",
  },
  {
    name: "ort-wasm-simd-threaded.jsep.wasm",
    sha256: "411b39a77bb006ce0cf17b30c978c66a130ebb2ba39c8dfdbdc9c1c5a251ae76",
  },
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensureAsset(target, expectedHash, load) {
  try {
    const existing = await readFile(target);
    if (digest(existing) !== expectedHash) {
      throw new Error(`Existing asset has the wrong SHA-256: ${target}`);
    }
    console.log(`verified ${target}`);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const bytes = await load();
  if (digest(bytes) !== expectedHash) {
    throw new Error(`Downloaded or installed asset has the wrong SHA-256: ${target}`);
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`prepared ${target}`);
}

const ortPackage = JSON.parse(
  await readFile(resolve(root, "node_modules/onnxruntime-web/package.json"), "utf8"),
);
if (ortPackage.version !== "1.26.0") {
  throw new Error("ONNX Runtime Web version changed; review the pinned JSEP runtime hashes");
}

for (const model of models) {
  const target = resolve(root, "public/models/paddle", model.name);
  await ensureAsset(target, model.sha256, async () => {
    try {
      return await readFile(resolve(root, "local-assets", model.name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const response = await fetch(model.url);
    if (!response.ok) throw new Error(`Model download failed: ${model.name} (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  });
}

for (const asset of ort) {
  const source = resolve(root, "node_modules/onnxruntime-web/dist", asset.name);
  const target = resolve(root, "public/paddle-ort", asset.name);
  await ensureAsset(target, asset.sha256, () => readFile(source));
}
