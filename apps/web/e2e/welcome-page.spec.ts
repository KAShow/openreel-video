import { test, expect } from "@playwright/test";

test("opens straight on the saved projects, with a new-project button and sign-in", async ({ page }, testInfo) => {
  await page.goto("/#/welcome");

  await expect(page.getByText("مونتاج عيون المخرج", { exact: true })).toBeVisible();
  await expect(page.getByText("مبني على OpenReel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "مشروع جديد", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "مشاريعك", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "المشاريع السابقة" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /تسجيل الدخول بعيون المخرج/ })).toHaveAttribute("href", "https://hawsh-khalifa.com/tools/director/editor?return=1");

  await page.screenshot({ path: testInfo.outputPath("welcome-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "دخول" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("welcome-mobile.png"), fullPage: true });
});
