import { describe, expect, it } from "vitest";
import { formatChatError } from "./ChatErrorCard";

describe("formatChatError", () => {
  it("extracts a useful provider message from a raw JSON error", () => {
    expect(
      formatChatError(
        'openai-compatible 401: {"error":{"message":"The API key is invalid"}}',
      ),
    ).toMatchObject({
      title: "فشلت المصادقة",
      message: "The API key is invalid",
      action: "ai-editor",
    });
  });

  it("turns network and CORS failures into endpoint guidance", () => {
    expect(
      formatChatError(
        "Could not reach the compatible endpoint. Check browser CORS settings.",
      ),
    ).toMatchObject({
      title: "تعذّر الوصول إلى الخدمة",
      action: "ai-editor",
    });
  });

  it("offers a new chat when the context window is exhausted", () => {
    expect(formatChatError("maximum context length exceeded")).toMatchObject({
      title: "المحادثة طويلة جداً",
      action: "new-chat",
    });
  });

  it("treats a Director's Eyes session expiry as its own case", () => {
    expect(formatChatError("انتهى الدخول — افتح المحرر من جديد من عيون المخرج.")).toMatchObject({
      title: "انتهت الجلسة",
      action: null,
    });
  });

  it("treats a Director's Eyes network failure as an endpoint problem", () => {
    expect(formatChatError("تعذّر الاتصال بعيون المخرج. تحقق من الاتصال وحاول مرة أخرى.")).toMatchObject({
      title: "تعذّر الوصول إلى الخدمة",
    });
  });

  it("keeps an unknown error readable", () => {
    expect(formatChatError("provider unavailable")).toEqual({
      title: "تعذّر تنفيذ الطلب",
      message: "provider unavailable",
      action: null,
      details: undefined,
    });
  });
});
