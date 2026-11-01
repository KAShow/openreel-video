import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import {
  captureBrowserErrors,
  createProjectWithFixture,
  expectNoBrowserErrors,
} from "./helpers/editor";

test("exports a real MP4 download with video and audio", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await createProjectWithFixture(page);

  await page.locator("header div.flex.items-stretch button").last().click();
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("menuitem").first().click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("New Horizontal Video.mp4");
  expect(await download.failure()).toBeNull();
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect((await stat(downloadedPath!)).size).toBeGreaterThan(1_000);

  const bytes = await readFile(downloadedPath!);
  const input = new Input({
    source: new BlobSource(new Blob([bytes], { type: "video/mp4" })),
    formats: ALL_FORMATS,
  });
  const duration = await input.computeDuration();
  const videoTrack = await input.getPrimaryVideoTrack();
  const audioTracks = await input.getAudioTracks();

  expect(duration).toBeGreaterThan(1.5);
  expect(duration).toBeLessThan(3.5);
  expect(videoTrack?.displayWidth).toBe(320);
  expect(videoTrack?.displayHeight).toBe(240);
  expect(videoTrack?.codec).toBe("avc");
  expect(audioTracks).toHaveLength(1);

  expectNoBrowserErrors(browserErrors);
});
