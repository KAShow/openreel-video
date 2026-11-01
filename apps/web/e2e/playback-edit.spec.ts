import { expect, test } from "@playwright/test";
import {
  captureBrowserErrors,
  createProjectWithFixture,
  expectNoBrowserErrors,
} from "./helpers/editor";

test("plays and pauses real media, then splits with undo and redo", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const { clip } = await createProjectWithFixture(page);
  const timecode = page.locator("[data-preview-timecode] input");
  const playPause = page.locator("[data-preview-playback] button").nth(1);
  const initialTimecode = await timecode.inputValue();

  await playPause.click();
  await expect.poll(() => timecode.inputValue()).not.toBe(initialTimecode);

  await playPause.click();
  await expect
    .poll(async () => {
      const before = await timecode.inputValue();
      await page.waitForTimeout(250);
      return (await timecode.inputValue()) === before;
    })
    .toBe(true);

  await timecode.fill("1");
  await timecode.press("Enter");
  await expect(timecode).toHaveValue("00:00:01:00");
  await clip.click();

  const clips = page.locator("[data-timeline-clip]");
  await expect(clips).toHaveCount(1);
  await page.keyboard.press("s");
  await expect(clips).toHaveCount(2);

  await page.keyboard.press("Control+z");
  await expect(clips).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(clips).toHaveCount(2);

  expectNoBrowserErrors(browserErrors);
});
