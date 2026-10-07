import { expect, test, type Page } from "@playwright/test";

async function createWorkspace(page: Page, choice: "create-notebook" | "create-whiteboard"): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("library-home")).toBeVisible();
  await page.getByTestId("library-new").click();
  await page.getByTestId(choice).click();
  await expect(page.locator("#workspace")).toBeVisible();
}

function rgbChannels(color: string): number[] {
  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (channels?.length !== 3) throw new Error(`Expected an RGB color, got ${color}`);
  return channels;
}

async function storedStrokeCount(page: Page, pageId?: string): Promise<number> {
  return page.evaluate((id) => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open("calcink");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains("pageRecords")) {
        db.close();
        resolve(0);
        return;
      }
      const store = db.transaction("pageRecords", "readonly").objectStore("pageRecords");
      const request = id ? store.get(id) : store.getAll();
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        const result = request.result as { page?: { strokes?: unknown[] } }
          | { page?: { strokes?: unknown[] } }[] | undefined;
        const records = Array.isArray(result) ? result : [result];
        const count = records.reduce((total, record) => total + (record?.page?.strokes?.length ?? 0), 0);
        db.close();
        resolve(count);
      };
    };
  }), pageId);
}

test("home creates a notebook that remains in the library after reload", async ({ page }) => {
  await createWorkspace(page, "create-notebook");
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "notebook");
  await expect(page.locator(".notebook-page")).toHaveCount(1);
  await expect(page.locator("#corner-reveal")).toHaveCount(0);
  await expect(page.locator("#corner-new-page")).toHaveCount(0);

  await page.locator("#home-button").click();
  await expect(page.getByTestId("library-home")).toBeVisible();
  const notebook = page.getByRole("button", { name: /^Open / });
  await expect(notebook).toHaveCount(1);
  await page.reload();
  await expect(notebook).toHaveCount(1);
  await notebook.click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "notebook");
});

test("notebook and whiteboard share dark chrome with light ink", async ({ page }) => {
  await createWorkspace(page, "create-notebook");
  await expect(page.locator("#paper")).toHaveText("");
  await expect(page.locator(".notebook-page .paper")).toHaveCount(1);
  for (const selector of ["#paper", ".topbar", ".bottom-toolbar", ".page-stepper"]) {
    const background = await page.locator(selector).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(rgbChannels(background).every((channel) => channel <= 80), `${selector}: ${background}`)
      .toBe(true);
  }
  const chromeSelectors = [".topbar", ".bottom-toolbar"];
  const notebookChrome = await Promise.all(chromeSelectors.map((selector) => page.locator(selector).evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )));
  const notebookInk = await page.locator(".current-color").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const [red, green, blue] = rgbChannels(notebookInk);
  expect(0.2126 * red + 0.7152 * green + 0.0722 * blue).toBeGreaterThan(180);

  await page.locator("#home-button").click();
  await page.getByTestId("library-new").click();
  await page.getByTestId("create-whiteboard").click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "whiteboard");
  const boardBackground = await page.locator("#paper").evaluate(
    (paper) => getComputedStyle(paper).backgroundColor,
  );
  expect(rgbChannels(boardBackground).every((channel) => channel <= 40)).toBe(true);
  for (const [index, selector] of chromeSelectors.entries()) {
    await expect(page.locator(selector)).toHaveCSS("background-color", notebookChrome[index]);
  }
  await expect(page.locator(".current-color")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("empty-library creation choices stay on screen without covering the message", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("library-home")).toBeVisible();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1440, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByTestId("library-new").click();
    const menu = await page.locator(".library-create-menu").boundingBox();
    const heading = await page.locator(".library-empty h1").boundingBox();
    const description = await page.locator(".library-empty p").boundingBox();
    if (!menu || !heading || !description) throw new Error("Library menu layout is missing");
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
    expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height);
    for (const text of [heading, description]) {
      const overlap = menu.x < text.x + text.width && menu.x + menu.width > text.x
        && menu.y < text.y + text.height && menu.y + menu.height > text.y;
      expect(overlap).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".library-create-menu")).toHaveCount(0);
  }
});

test("a notebook stacks pages in one scrollable workspace", async ({ page }) => {
  await createWorkspace(page, "create-notebook");
  await page.locator("#quick-new-page").click();
  const pages = page.locator(".notebook-page");
  await expect(pages).toHaveCount(2);

  const layout = await page.locator("#workspace").evaluate((workspace) => {
    const sheets = [...workspace.querySelectorAll<HTMLElement>(".notebook-page")];
    return {
      scrollHeight: workspace.scrollHeight,
      clientHeight: workspace.clientHeight,
      firstBottom: sheets[0].getBoundingClientRect().bottom,
      secondTop: sheets[1].getBoundingClientRect().top,
    };
  });
  expect(layout.secondTop).toBeGreaterThan(layout.firstBottom);
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);

  await pages.nth(1).scrollIntoViewIfNeeded();
  await expect(pages.nth(1)).toBeInViewport();
  expect(await page.locator("#workspace").evaluate((workspace) => workspace.scrollTop))
    .toBeGreaterThan(0);

  const secondPageId = await pages.nth(1).getAttribute("data-page-id");
  if (!secondPageId) throw new Error("The second page has no persisted page id");
  await pages.nth(0).locator(".notebook-preview-action").click();
  await expect(pages.nth(0)).toHaveAttribute("data-active", "true");
  await pages.nth(1).locator(".notebook-preview-action").click();
  await expect(pages.nth(1)).toHaveAttribute("data-active", "true");
  const surface = pages.nth(1).locator("#drawing-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("The second page is not writable");
  await page.mouse.move(bounds.x + 80, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 120, bounds.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => storedStrokeCount(page, secondPageId)).toBe(1);
  await page.reload();
  await expect.poll(() => storedStrokeCount(page, secondPageId)).toBe(1);
});

test.describe("mobile notebook", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("one finger writes on paper while two fingers scroll the book", async ({ page, context }) => {
    await createWorkspace(page, "create-notebook");
    await page.locator("#quick-new-page").click();
    const pages = page.locator(".notebook-page");
    await expect(pages).toHaveCount(2);
    await page.locator("#prev-page").click();
    await expect(pages.nth(0)).toHaveAttribute("data-active", "true");
    await page.locator("#workspace").evaluate((workspace) => { workspace.scrollTop = 0; });
    await expect.poll(() => storedStrokeCount(page)).toBe(0);

    const surface = await page.locator("#drawing-surface").boundingBox();
    if (!surface) throw new Error("The active paper is not visible");
    const x = surface.x + surface.width / 2;
    const startY = Math.min(surface.y + surface.height * 0.8, 740);
    const cdp = await context.newCDPSession(page);
    const touchPoints = (y: number, fingers: number) => Array.from({ length: fingers },
      (_, id) => ({ x: x + id * 35, y, id }));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touchPoints(startY, 1),
    });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touchPoints(startY - step * 15, 1),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator("#undo-button")).toBeEnabled();
    await expect.poll(() => storedStrokeCount(page)).toBe(1);
    expect(await page.locator("#workspace").evaluate((workspace) => workspace.scrollTop))
      .toBeLessThan(50);

    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touchPoints(startY, 2),
    });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touchPoints(startY - step * 30, 2),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.locator("#workspace").evaluate((workspace) => workspace.scrollTop))
      .toBeGreaterThan(100);
    await expect(pages.nth(1)).toBeInViewport();
    await expect.poll(() => storedStrokeCount(page)).toBe(1);
  });
});

test("home creates and reopens a black whiteboard", async ({ page }) => {
  await createWorkspace(page, "create-whiteboard");
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "whiteboard");
  const background = await page.locator("#paper").evaluate(
    (paper) => getComputedStyle(paper).backgroundColor,
  );
  const channels = background.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  expect(channels, `Expected an opaque dark canvas background, got ${background}`)
    .toBeDefined();
  expect(channels!.every((channel) => channel <= 40)).toBe(true);

  const surface = page.locator("#drawing-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("The whiteboard is not writable");
  await page.mouse.move(bounds.x + 80, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 120, bounds.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => storedStrokeCount(page)).toBe(1);

  const boardSize = await page.locator("#paper").evaluate((paper) => {
    const { width, height } = paper.getBoundingClientRect();
    return { width, height };
  });
  const beforePan = await page.locator("#paper").evaluate(
    (paper) => getComputedStyle(paper).backgroundPosition,
  );
  await page.mouse.wheel(120, 160);
  await expect.poll(() => page.locator("#paper").evaluate(
    (paper) => getComputedStyle(paper).backgroundPosition,
  )).not.toBe(beforePan);
  expect(await page.locator("#paper").evaluate((paper) => {
    const { width, height } = paper.getBoundingClientRect();
    return { width, height };
  })).toEqual(boardSize);

  await page.locator("#home-button").click();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(1);
  await page.getByRole("button", { name: /^Open / }).click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-mode", "whiteboard");
  await expect.poll(() => storedStrokeCount(page)).toBe(1);
});
