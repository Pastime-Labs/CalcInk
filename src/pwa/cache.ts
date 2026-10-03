import { REQUIRED_OFFLINE_ASSETS } from "./assets";

export async function requiredOfflineAssets(
  storage: Pick<CacheStorage, "match">,
  baseUrl: URL,
): Promise<string[]> {
  const response = await storage.match(new URL("offline-assets.json", baseUrl).href, {
    ignoreSearch: true,
  });
  if (!response || response.status !== 200) throw new Error("Missing offline asset list");
  const manifest: unknown = await response.json();
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) ||
      manifest.version !== 1 || !("assets" in manifest) ||
      !Array.isArray(manifest.assets) || manifest.assets.length === 0 ||
      !manifest.assets.every((asset: unknown) =>
        typeof asset === "string" &&
        /^assets\/[a-zA-Z0-9._/-]+$/.test(asset) &&
        !asset.split("/").includes(".."))) {
    throw new Error("Invalid offline asset list");
  }
  return [...REQUIRED_OFFLINE_ASSETS, ...manifest.assets];
}

export async function hasCompleteOfflineCache(
  storage: Pick<CacheStorage, "match">,
  baseUrl: URL,
): Promise<boolean> {
  try {
    for (const asset of await requiredOfflineAssets(storage, baseUrl)) {
      const url = new URL(asset, baseUrl).href;
      const model = asset.includes(".tar?");
      const response = await storage.match(url, { ignoreSearch: !model });
      if (!response || response.status !== 200) return false;
      if (model && (await response.clone().blob()).size === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}
