import { test, expect } from "@playwright/test";

test("opens a simple personal start page", async ({ page }, testInfo) => {
  await page.goto("/#/welcome");

  await expect(page.getByRole("heading", { name: "ماذا تريد أن تصنع اليوم؟" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "مشروع جديد", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "المشاريع السابقة", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "إنشاء مشروع طولي" })).toHaveCount(0);
  await expect(page.getByText("أو ابدأ من قالب جاهز")).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("welcome-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "المشاريع السابقة" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("welcome-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "المشاريع السابقة" }).click();
  await expect(page.getByRole("heading", { name: "مشاريعك", exact: true })).toBeVisible();
});
