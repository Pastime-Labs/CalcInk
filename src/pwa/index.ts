import { registerSW } from "virtual:pwa-register";
import { hasCompleteOfflineCache, requiredOfflineAssets } from "./cache";

export { hasCompleteOfflineCache } from "./cache";

export type OfflineStatus =
  | { kind: "downloading"; message: string }
  | { kind: "ready"; message: string }
  | { kind: "update_available"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "unavailable"; message: string };

export type OfflineController = {
  current(): OfflineStatus;
  applyUpdate(flushPendingSave: () => Promise<void>): Promise<void>;
  retryInstall(): Promise<void>;
};

async function openPrecache(baseUrl: URL): Promise<Cache> {
  const cacheName = (await caches.keys()).find((name) =>
    name.startsWith("workbox-precache") && name.endsWith(baseUrl.href));
  if (!cacheName) throw new Error("No installed precache");
  return caches.open(cacheName);
}

export function registerOfflineApp(onStatus: (status: OfflineStatus) => void): OfflineController {
  let status: OfflineStatus = {
    kind: "downloading",
    message: "Downloading offline app and recognition assets.",
  };
  let registration: ServiceWorkerRegistration | undefined;
  const publish = (next: OfflineStatus) => {
    status = next;
    onStatus(next);
  };
  const controller: OfflineController = {
    current: () => status,
    async applyUpdate(flushPendingSave) {
      if (status.kind !== "update_available") return;
      await flushPendingSave();
      await updateSW(true);
    },
    async retryInstall() {
      if (status.kind !== "failed") return;
      if (!navigator.onLine) {
        publish({
          kind: "failed",
          message: "Reconnect before retrying the offline install.",
        });
        return;
      }
      publish({
        kind: "downloading",
        message: "Retrying the offline asset install.",
      });
      try {
        const cache = await openPrecache(baseUrl);
        const keys = await cache.keys();
        for (const asset of await requiredOfflineAssets(cache, baseUrl)) {
          const url = new URL(asset, baseUrl);
          const model = asset.includes(".tar?");
          const emitted = asset.startsWith("assets/");
          const key = keys.find((request) => model
            ? request.url === url.href
            : new URL(request.url).pathname === url.pathname);
          if (!key && !model && !emitted) throw new Error(`Missing precache key: ${asset}`);
          const cached = key ? await cache.match(key) : undefined;
          if (cached?.status === 200 &&
              (!model || (await cached.clone().blob()).size > 0)) continue;

          const repairUrl = new URL(url);
          repairUrl.searchParams.set("repair", String(Date.now()));
          const response = await fetch(repairUrl, { cache: "reload" });
          const contentType = response.headers.get("Content-Type") ?? "";
          if (response.status !== 200 ||
              (contentType.includes("text/html") && !asset.endsWith(".html")) ||
              (model && (await response.clone().blob()).size < 1_000_000)) {
            throw new Error(`Could not repair offline asset: ${asset}`);
          }
          await cache.put(key ?? url.href, response);
        }
        await verifyReady(true);
      } catch {
        publish({
          kind: "failed",
          message: "Offline setup failed. Drawing remains available; retry when connected.",
        });
      }
    },
  };

  if (import.meta.env.DEV || !("serviceWorker" in navigator) || !("caches" in window)) {
    publish({
      kind: "unavailable",
      message: import.meta.env.DEV
        ? "Offline install is available in the production preview."
        : "This browser cannot install CalcInk for offline use.",
    });
    return controller;
  }

  const baseUrl = new URL(import.meta.env.BASE_URL, location.origin);
  const verifyReady = async (failureOnMissing: boolean) => {
    let complete = false;
    try {
      complete = await hasCompleteOfflineCache(await openPrecache(baseUrl), baseUrl);
    } catch {
      // A missing or inaccessible precache is not proof of offline readiness.
    }
    if (status.kind === "update_available") return;
    if (complete) {
      publish({ kind: "ready", message: "Ready offline on this device." });
    } else if (failureOnMissing) {
      publish({
        kind: "failed",
        message: "Offline setup is incomplete. Connect and retry the install.",
      });
    }
  };
  const observeInstall = (worker: ServiceWorker | null) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") void verifyReady(true);
      if (worker.state === "redundant" && !registration?.active &&
          status.kind === "downloading") {
        publish({
          kind: "failed",
          message: "Offline assets could not be installed. Drawing remains available.",
        });
      }
    });
  };

  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      void verifyReady(true);
    },
    onNeedRefresh() {
      publish({
        kind: "update_available",
        message: "An update is available. Save your work before applying it.",
      });
    },
    onRegisteredSW(_url, readyRegistration) {
      registration = readyRegistration;
      if (!registration) return;
      observeInstall(registration.installing);
      registration.addEventListener("updatefound", () => observeInstall(registration?.installing ?? null));
      if (registration.waiting) {
        publish({
          kind: "update_available",
          message: "An update is available. Save your work before applying it.",
        });
      } else if (registration.active && !registration.installing) {
        void verifyReady(true);
      }
    },
    onRegisterError() {
      publish({
        kind: "failed",
        message: "Offline setup failed. Drawing remains available; retry when connected.",
      });
    },
  });
  window.addEventListener("offline", () => {
    if (status.kind === "downloading") {
      publish({
        kind: "failed",
        message: "First offline install is incomplete. Reconnect and retry.",
      });
    }
  });
  onStatus(status);
  return controller;
}
