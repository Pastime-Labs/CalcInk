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
  let repairing = false;
  let reloadAuthorized = false;
  const publish = (next: OfflineStatus) => {
    status = next;
    onStatus(next);
  };
  const controller: OfflineController = {
    current: () => status,
    async applyUpdate(flushPendingSave) {
      if (status.kind !== "update_available") return;
      await flushPendingSave();
      const current = await navigator.serviceWorker.getRegistration(baseUrl.href);
      if (!current?.waiting) {
        window.location.reload();
        return;
      }
      reloadAuthorized = true;
      try {
        await updateSW(true);
      } catch (error) {
        reloadAuthorized = false;
        throw error;
      }
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
        let current = await navigator.serviceWorker.getRegistration(baseUrl.href);
        if (!current?.active) {
          registration = await navigator.serviceWorker.register(new URL("sw.js", baseUrl), {
            scope: baseUrl.href,
          });
          current = registration;
          observeInstall(registration.installing ?? registration.waiting);
          if (!registration.active) {
            if (!registration.installing && !registration.waiting) {
              throw new Error("No service worker is installing");
            }
            return;
          }
        }
        let cache: Cache;
        try {
          cache = await openPrecache(baseUrl);
        } catch {
          await reinstall(current);
          return;
        }
        let assets: string[];
        try {
          assets = await requiredOfflineAssets(cache, baseUrl);
        } catch {
          const manifest = (await cache.keys()).find((request) =>
            new URL(request.url).pathname === new URL("offline-assets.json", baseUrl).pathname);
          if (manifest) await cache.delete(manifest);
          await reinstall(current);
          return;
        }
        const keys = await cache.keys();
        for (const asset of assets) {
          const url = new URL(asset, baseUrl);
          const model = asset.includes(".tar?");
          const emitted = asset.startsWith("assets/");
          const key = keys.find((request) => model
            ? request.url === url.href
            : new URL(request.url).pathname === url.pathname);
          if (!key && !model && !emitted) {
            await reinstall(current);
            return;
          }
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
      } catch (error) {
        console.error("CalcInk offline install retry failed", error);
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
  const reinstall = async (current: ServiceWorkerRegistration | undefined) => {
    if (current?.waiting) {
      publish({
        kind: "update_available",
        message: "An update is available. Save your work before applying it.",
      });
      return;
    }
    const script = new URL("sw.js", baseUrl);
    script.searchParams.set("repair", String(Date.now()));
    repairing = true;
    try {
      registration = await navigator.serviceWorker.register(script, { scope: baseUrl.href });
      const worker = registration.installing ?? registration.waiting;
      if (!worker) {
        repairing = false;
        await verifyReady(true);
        return;
      }
      const checkState = () => {
        if (worker.state === "installed") {
          registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
        } else if (worker.state === "activated") {
          repairing = false;
          void verifyReady(true);
        } else if (worker.state === "redundant") {
          repairing = false;
          publish({
            kind: "failed",
            message: "Offline assets could not be installed. Drawing remains available.",
          });
        }
      };
      worker.addEventListener("statechange", checkState);
      checkState();
    } catch (error) {
      repairing = false;
      throw error;
    }
  };
  const verifyReady = async (failureOnMissing: boolean): Promise<boolean> => {
    let complete = false;
    try {
      if ((await navigator.serviceWorker.getRegistration(baseUrl.href))?.active) {
        complete = await hasCompleteOfflineCache(await openPrecache(baseUrl), baseUrl);
      }
    } catch {
      // A missing or inaccessible precache is not proof of offline readiness.
    }
    if (status.kind === "update_available") return complete;
    if (complete) {
      publish({ kind: "ready", message: "Ready offline on this device." });
    } else if (failureOnMissing) {
      publish({
        kind: "failed",
        message: "Offline setup is incomplete. Connect and retry the install.",
      });
    }
    return complete;
  };
  const observeInstall = (worker: ServiceWorker | null) => {
    if (!worker) return;
    const checkState = () => {
      if (worker.state === "activated") void verifyReady(true);
      if (worker.state === "redundant" && !registration?.active &&
          status.kind === "downloading") {
        publish({
          kind: "failed",
          message: "Offline assets could not be installed. Drawing remains available.",
        });
      }
    };
    worker.addEventListener("statechange", checkState);
    checkState();
  };

  const updateSW = registerSW({
    immediate: true,
    onNeedReload() {
      if (reloadAuthorized) {
        reloadAuthorized = false;
        window.location.reload();
      } else {
        void verifyReady(true);
      }
    },
    onOfflineReady() {
      void verifyReady(true);
    },
    onNeedRefresh() {
      if (repairing) return;
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
    onRegisterError(error) {
      console.error("CalcInk offline registration failed", error);
      const previous = status;
      void verifyReady(false).then((complete) => {
        if (!complete && status === previous && status.kind !== "update_available") {
          publish({
            kind: "failed",
            message: "Offline setup failed. Drawing remains available; retry when connected.",
          });
        }
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
