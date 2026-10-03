import { describe, expect, it, vi } from "vitest";
import { hasCompleteOfflineCache } from "./cache";
import { REQUIRED_OFFLINE_ASSETS } from "./assets";

const baseUrl = new URL("https://example.test/");
const chunk = "assets/recognition.worker-abc123.js";
const manifestUrl = new URL("offline-assets.json", baseUrl).href;
const manifest = () => new Response(JSON.stringify({ version: 1, assets: [chunk] }));

describe("offline cache readiness", () => {
  it("requires every fixed asset and emitted chunk, not only the app shell", async () => {
    const cached = new Set([...REQUIRED_OFFLINE_ASSETS, chunk]
      .map((asset) => new URL(asset, baseUrl).href));
    const storage = {
      match: vi.fn(async (url: string) =>
        url === manifestUrl ? manifest() : cached.has(url) ? new Response("cached") : undefined),
    } as unknown as Pick<CacheStorage, "match">;
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(true);
    cached.delete(new URL(chunk, baseUrl).href);
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
    cached.add(new URL(chunk, baseUrl).href);
    cached.delete(new URL("paddle-ort/ort-wasm-simd-threaded.jsep.wasm", baseUrl).href);
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
  });

  it("rejects empty or failed model archives", async () => {
    const storage = {
      match: vi.fn(async (url: string) => url === manifestUrl ? manifest() : url.includes(".tar?")
        ? new Response(null, { status: 204 })
        : new Response("cached")),
    } as unknown as Pick<CacheStorage, "match">;
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
    storage.match = vi.fn(async (url: string) => url === manifestUrl ? manifest() : url.includes(".tar?")
      ? new Response("")
      : new Response("cached")) as typeof storage.match;
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
  });

  it("rejects missing or malformed emitted-asset lists", async () => {
    const storage = {
      match: vi.fn(async (url: string) => url === manifestUrl
        ? new Response(JSON.stringify({ version: 1, assets: ["assets/../outside.js"] }))
        : new Response("cached")),
    } as unknown as Pick<CacheStorage, "match">;
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
    storage.match = vi.fn(async (url: string) =>
      url === manifestUrl ? undefined : new Response("cached")) as typeof storage.match;
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
  });

  it("does not claim readiness when Cache Storage fails", async () => {
    const storage = {
      match: vi.fn(async () => { throw new Error("quota failure"); }),
    } as unknown as Pick<CacheStorage, "match">;
    expect(await hasCompleteOfflineCache(storage, baseUrl)).toBe(false);
  });
});
