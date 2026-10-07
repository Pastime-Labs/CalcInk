import { expect, type Page } from "@playwright/test";

export async function createNotebook(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("library-home")).toBeVisible();
  await page.getByTestId("library-new").click();
  await page.getByTestId("create-notebook").click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "notebook");
}

export async function openSavedNotebook(page: Page): Promise<void> {
  await expect(page.getByTestId("library-home")).toBeVisible();
  await page.getByRole("button", { name: /^Open / }).first().click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "notebook");
}

export async function reloadNotebook(page: Page): Promise<void> {
  await page.reload();
  await openSavedNotebook(page);
}
