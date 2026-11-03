import { test, expect } from "@playwright/test";

async function visibleLatin(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const values = new Set<string>();
    const add = (value: string | null) => {
      const text = value?.replace(/\s+/g, " ").trim();
      if (text && /[A-Za-z]/.test(text)) values.add(text);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
      if (!el || el.closest("script, style, input, textarea, [contenteditable='true'], [data-no-translate]")) continue;
      if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
      if (node.nodeType === Node.TEXT_NODE) add(node.nodeValue);
      else {
        add(el.getAttribute("title"));
        add(el.getAttribute("aria-label"));
        add(el.getAttribute("placeholder"));
      }
    }
    return [...values].sort();
  });
}

test("reviews Arabic settings, assistant and asset tabs", async ({ page }, testInfo) => {
  await page.goto("/#/editor");
  await expect(page.getByRole("button", { name: "تصدير", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "إجراءات أخرى" }).click();
  await page.getByText("الإعدادات", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "الإعدادات" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-general.png"), fullPage: true });
  await testInfo.attach("settings-general-latin", { body: JSON.stringify(await visibleLatin(page), null, 2), contentType: "application/json" });

  await page.getByRole("tab", { name: "مساعد المونتاج", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("settings-ai.png"), fullPage: true });
  await testInfo.attach("settings-ai-latin", { body: JSON.stringify(await visibleLatin(page), null, 2), contentType: "application/json" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "مساعد المونتاج", exact: true }).click();
  await expect(page.getByRole("log", { name: "محادثة الذكاء الاصطناعي ونتائج التعديل" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("assistant.png"), fullPage: true });
  await testInfo.attach("assistant-latin", { body: JSON.stringify(await visibleLatin(page), null, 2), contentType: "application/json" });
  await page.getByRole("button", { name: "مساعد المونتاج", exact: true }).click();

  for (const [name, file] of [["نص", "text"], ["رسومات", "graphics"], ["المؤثرات", "effects"], ["الانتقالات", "transitions"], ["توليد ذكي", "ai"]] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator('[title="' + ({ "نص": "Text", "رسومات": "Graphics", "المؤثرات": "Effects", "الانتقالات": "Transitions", "توليد ذكي": "AI Generate" }[name]) + '"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`assets-${file}.png`), fullPage: true });
    await testInfo.attach(`assets-${file}-latin`, { body: JSON.stringify(await visibleLatin(page), null, 2), contentType: "application/json" });
  }
});
