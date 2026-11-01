import { test, expect } from "@playwright/test";

const projects = [
  ["project-summer", "إعلان مجموعة الصيف", 1],
  ["project-launch", "فيديو إطلاق المنتج", 2],
  ["project-brand", "قصة العلامة التجارية", 4],
  ["project-conference", "مقتطفات المؤتمر", 8],
  ["project-ramadan", "حملة رمضان", 15],
  ["project-intro", "فيديو تعريفي قصير", 35],
] as const;

async function seedProjects(page: import("@playwright/test").Page) {
  await page.goto("/#/recent");
  await page.evaluate((items) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("openreel-autosave", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("autosaves", "readwrite");
        const store = transaction.objectStore("autosaves");
        store.clear();
        for (const [projectId, projectName, daysAgo] of items) {
          store.put({
            id: `${projectId}-slot-0`,
            projectId,
            projectName,
            timestamp: Date.now() - daysAgo * 86_400_000,
            slot: 0,
            data: "{}",
          });
        }
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, projects);
  await page.reload();
}

test("browses, filters and deletes saved projects", async ({ page }) => {
  await seedProjects(page);

  await expect(page.getByRole("heading", { name: "مشاريعك", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إعلان مجموعة الصيف" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "فيديو إطلاق المنتج" })).toBeVisible();

  await page.getByLabel("ابحث في مشاريعك").fill("إطلاق");
  await expect(page.getByRole("heading", { name: "فيديو إطلاق المنتج" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إعلان مجموعة الصيف" })).toBeHidden();

  await page.getByRole("button", { name: "مسح البحث", exact: true }).click();
  await page.getByRole("button", { name: "عرض قائمة", exact: true }).click();
  await expect(page.getByRole("button", { name: "عرض قائمة", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "حذف مشروع فيديو إطلاق المنتج" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "حذف المشروع", exact: true }).click();
  await expect(page.getByRole("heading", { name: "فيديو إطلاق المنتج" })).toBeHidden();
});

test("keeps the projects workspace responsive", async ({ page }, testInfo) => {
  await seedProjects(page);
  await expect(page.getByRole("heading", { name: "مشاريعك", exact: true })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("projects-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "مشروع جديد", exact: true })).toBeVisible();
  await expect(page.getByLabel("ابحث في مشاريعك")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("projects-mobile.png"), fullPage: true });
});
