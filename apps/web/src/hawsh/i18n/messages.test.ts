import { describe, expect, it } from "vitest";
import { MESSAGES, msg, type MessageKey } from "./messages";

const entries = Object.entries(MESSAGES) as [MessageKey, string][];

describe("msg", () => {
  it("returns the Arabic text for a key", () => {
    expect(msg("chat.errorCard.dismiss")).toBe("إغلاق الخطأ");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(msg("chat.panel.tokens", { count: "1.2k" })).toBe("1.2k رمز");
    expect(msg("chat.panel.tokensTitle", { input: 10, output: 4 })).toBe("10 إدخال · 4 إخراج");
    expect(msg("chat.history.delete", {})).toBe("حذف {title}");
  });
});

describe("MESSAGES", () => {
  it("holds no English words, so an untranslated value cannot slip in", () => {
    const names = /\b(Enter|Shift|HTTPS|HTTP|CORS|OpenReel|JSON)\b/g;
    const bad = entries
      .filter(([, text]) => /[A-Za-z]/.test(text.replace(/\{\w+\}/g, "").replace(names, "")))
      .map(([key]) => key);
    expect(bad).toEqual([]);
  });

  it("is never empty", () => {
    expect(entries.filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([]);
  });

  it("uses the same style of placeholders everywhere", () => {
    for (const [key, text] of entries) {
      const stray = text.replace(/\{\w+\}/g, "").match(/[{}]/);
      expect(stray, key).toBeNull();
    }
  });

  it("has a key naming scheme of area.group.name", () => {
    for (const [key] of entries) expect(key, key).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
  });
});
