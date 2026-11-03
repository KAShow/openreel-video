import { test, expect } from "@playwright/test";

test("keeps the simple editor free of duplicate AI and export controls", async ({ page }, testInfo) => {
  await page.goto("/#/editor");

  const exportButton = page.getByRole("button", { name: "تصدير", exact: true });
  await expect(exportButton).toBeVisible();
  await expect(page.getByRole("group", { name: "وضع التحرير" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "خيارات التصدير" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "مساعد المونتاج" })).toBeVisible();

  await page.getByRole("button", { name: "إجراءات أخرى" }).click();
  await expect(page.getByText("الإعدادات", { exact: true })).toBeVisible();
  await expect(page.getByText("جولة في المحرر", { exact: true })).toBeVisible();
  await expect(page.getByText("جولة الحركة والمؤثرات")).toHaveCount(0);
  await expect(page.getByText("المساعدة والاختصارات (اضغط ?)")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("simple-editor.png"), fullPage: true });
});
