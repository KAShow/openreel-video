import { expect, test } from "@playwright/test";
import {
  captureBrowserErrors,
  createProjectWithFixture,
  expectNoBrowserErrors,
  fixtureName,
} from "./helpers/editor";

const restoredName = "Browser persistence check";

test("auto-saves and recovers the project with its original media", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await createProjectWithFixture(page);

  const projectName = page.locator("header input").first();
  await projectName.fill(restoredName);
  await projectName.press("Enter");
  await expect(projectName).toHaveValue(restoredName);

  await expect
    .poll(async () =>
      page.evaluate(async ({ expectedName, expectedFixture }) => {
        type SaveRecord = { data: string };
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("openreel-autosave", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const records = await new Promise<SaveRecord[]>((resolve, reject) => {
            const request = database
              .transaction("autosaves", "readonly")
              .objectStore("autosaves")
              .getAll();
            request.onsuccess = () => resolve(request.result as SaveRecord[]);
            request.onerror = () => reject(request.error);
          });
          return records.some((record) => {
            const project = JSON.parse(record.data) as {
              name: string;
              mediaLibrary: { items: Array<{ name: string }> };
              timeline: { tracks: Array<{ clips: unknown[] }> };
            };
            return (
              project.name === expectedName &&
              project.mediaLibrary.items.some((item) => item.name === expectedFixture) &&
              project.timeline.tracks.some((track) => track.clips.length > 0)
            );
          });
        } finally {
          database.close();
        }
      }, { expectedName: restoredName, expectedFixture: fixtureName }),
    )
    .toBe(true);

  await page.reload();
  await page.getByRole("dialog").getByRole("button").last().click();

  await expect(page.locator("header input").first()).toHaveValue(restoredName);
  await expect(page.locator("[data-timeline-clip]")).toBeVisible();
  const restoredThumbnail = page.getByRole("img", { name: fixtureName, exact: true });
  await expect(restoredThumbnail).toBeVisible();
  await expect
    .poll(() =>
      restoredThumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);

  expectNoBrowserErrors(browserErrors);
});
