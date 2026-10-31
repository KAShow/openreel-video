import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(
  new URL("./fixtures/color-clock-audio.webm", import.meta.url),
);

test("imports real video and renders it on the preview canvas", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/new");

  const importInput = page.locator(
    'input[type="file"][accept="video/*,audio/*,image/*"]',
  );
  await expect(importInput).toBeAttached();

  const previewCanvas = page.locator('[data-tour="preview"] canvas').first();
  await expect(previewCanvas).toBeVisible();
  const emptyFrame = await previewCanvas.evaluate((canvas: HTMLCanvasElement) =>
    canvas.toDataURL("image/png"),
  );

  await importInput.setInputFiles(fixturePath);

  await expect(page.getByText("color-clock-audio.webm", { exact: true })).toBeVisible();
  const thumbnail = page.getByRole("img", {
    name: "color-clock-audio.webm",
    exact: true,
  });
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const thumbnailSize = await thumbnail.evaluate((image: HTMLImageElement) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  expect(thumbnailSize.width / thumbnailSize.height).toBeCloseTo(4 / 3, 5);
  await expect(page.getByText("00:02", { exact: true }).first()).toBeVisible();

  await page.getByText("color-clock-audio.webm", { exact: true }).dblclick();

  await expect
    .poll(async () =>
      previewCanvas.evaluate((canvas: HTMLCanvasElement) =>
        canvas.toDataURL("image/png"),
      ),
    )
    .not.toBe(emptyFrame);

  expect(pageErrors).toEqual([]);
});
