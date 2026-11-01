import { expect, test } from "@playwright/test";
import {
  addFixtureToTimeline,
  captureBrowserErrors,
  createProject,
  expectNoBrowserErrors,
  fixtureName,
  importFixture,
} from "./helpers/editor";

test("imports real video and renders it on the preview canvas", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const previewCanvas = await createProject(page);
  const emptyFrame = await previewCanvas.evaluate((canvas: HTMLCanvasElement) =>
    canvas.toDataURL("image/png"),
  );

  await importFixture(page);

  const thumbnail = page.getByRole("img", { name: fixtureName, exact: true });
  const thumbnailSize = await thumbnail.evaluate((image: HTMLImageElement) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  expect(thumbnailSize.width / thumbnailSize.height).toBeCloseTo(4 / 3, 5);

  await addFixtureToTimeline(page);

  await expect
    .poll(() =>
      previewCanvas.evaluate((canvas: HTMLCanvasElement) =>
        canvas.toDataURL("image/png"),
      ),
    )
    .not.toBe(emptyFrame);

  expectNoBrowserErrors(browserErrors);
});
