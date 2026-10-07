import { expect, test } from "@playwright/test";
import { createNotebook, reloadNotebook } from "./notebook";

test("retry recovers a rejected first service-worker registration", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const serviceWorker = navigator.serviceWorker;
    const register = serviceWorker.register.bind(serviceWorker);
    Object.defineProperty(serviceWorker, "register", {
      configurable: true,
      value: (...args: Parameters<ServiceWorkerContainer["register"]>) => {
        if (sessionStorage.getItem("calcink-test-register-rejected") !== "yes") {
          sessionStorage.setItem("calcink-test-register-rejected", "yes");
          return Promise.reject(new Error("Simulated first registration failure"));
        }
        return register(...args);
      },
    });
  });

  await createNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline setup failed");
  await expect(page.locator("#retry-offline")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("calcink-test-register-rejected")))
    .toBe("yes");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active))
    .toBeUndefined();

  await page.locator("#retry-offline").click();
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });
  expect(await page.evaluate(async () => Boolean(
    (await navigator.serviceWorker.getRegistration())?.active,
  ))).toBe(true);

  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  await expect(page.locator("#recognition-status")).toHaveText("Recognition ready", {
    timeout: 60_000,
  });
});

test("registration error does not hide a complete installed offline cache", async ({ page, context }) => {
  await createNotebook(page);
  await expect(page.locator("#offline-status")).toHaveText("Ready offline on this device.", {
    timeout: 90_000,
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, "register", {
      configurable: true,
      value: () => Promise.reject(new Error("Simulated registration failure")),
    });
  });

  await context.setOffline(true);
  await reloadNotebook(page);
  await expect(page.locator("#offline-status")).toContainText("Offline; app assets installed");
  await expect(page.locator("#retry-offline")).toBeHidden();
});
