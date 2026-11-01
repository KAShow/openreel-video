import { expect, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

export const fixturePath = fileURLToPath(
  new URL("../fixtures/color-clock-audio.webm", import.meta.url),
);
export const fixtureName = "color-clock-audio.webm";

export interface BrowserErrors {
  page: string[];
  console: string[];
}

export function captureBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { page: [], console: [] };
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  return errors;
}

export function expectNoBrowserErrors(errors: BrowserErrors): void {
  expect(errors).toEqual({ page: [], console: [] });
}

export async function createProject(page: Page): Promise<Locator> {
  await page.goto("/#/new?dimensions=320x240&fps=30");
  const previewCanvas = page.locator('[data-tour="preview"] canvas').first();
  await expect(previewCanvas).toBeVisible();
  await expect(page.locator("[data-preview-timecode] input")).toHaveValue(
    "00:00:00:00",
  );
  return previewCanvas;
}

export async function importFixture(page: Page): Promise<void> {
  const importInput = page.locator(
    'input[type="file"][accept="video/*,audio/*,image/*"]',
  );
  await expect(importInput).toBeAttached();
  await importInput.setInputFiles(fixturePath);

  await expect(page.getByText(fixtureName, { exact: true })).toBeVisible();
  const thumbnail = page.getByRole("img", { name: fixtureName, exact: true });
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText("00:02", { exact: true }).first()).toBeVisible();
}

export async function addFixtureToTimeline(page: Page): Promise<Locator> {
  await page.getByRole("img", { name: fixtureName, exact: true }).dblclick();
  const clip = page.locator("[data-timeline-clip]");
  await expect(clip).toBeVisible();
  return clip;
}

export async function createProjectWithFixture(page: Page): Promise<{
  previewCanvas: Locator;
  clip: Locator;
}> {
  const previewCanvas = await createProject(page);
  await importFixture(page);
  const clip = await addFixtureToTimeline(page);
  return { previewCanvas, clip };
}
