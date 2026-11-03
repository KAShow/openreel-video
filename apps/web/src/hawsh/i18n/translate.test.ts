import { describe, expect, it } from "vitest";
import { translateTextNode, translateUi } from "./translate";

describe("translateUi", () => {
  it("translates known UI strings exactly", () => {
    expect(translateUi("Export")).toBe("تصدير");
    expect(translateUi("  Media ")).toBe("الوسائط");
  });
  it("leaves unknown text, user content and non-Latin text alone", () => {
    expect(translateUi("UP 10 S13.mp4")).toBeNull();
    expect(translateUi("Poppins")).toBeNull();
    expect(translateUi("00:00:05:00")).toBeNull();
    expect(translateUi("تصدير")).toBeNull();
    expect(translateUi("")).toBeNull();
  });
  it("translates strings built from parts only when every part is known", () => {
    expect(translateUi("Open Crop")).toBe("فتح اقتصاص");
    expect(translateUi("Expand Keyframes section")).toBe("توسيع قسم الإطارات المفتاحية");
    expect(translateUi("Add Grinning Face")).toBe("إضافة وجه مبتسم");
    expect(translateUi("Add Purple Unicorn")).toBeNull();
    expect(translateUi("5 minutes ago")).toBe("قبل 5 دقائق");
    expect(translateUi("2 hours ago")).toBe("قبل ساعتين");
    expect(translateUi("12 days ago")).toBe("قبل 12 يوم");
    expect(translateUi("Rename Track 2")).toBe("إعادة تسمية المسار 2");
    expect(translateUi("3 selected")).toBe("3 محدد");
    expect(translateUi("Sepia. Drag onto a clip to apply, or double-click to apply to selected clip.")).toMatch(/^بني قديم\. اسحبه/);
  });
  it("translates dynamic controls, progress, notifications and time labels", () => {
    expect(translateUi("Add Keyframe at 2.50s")).toBe("إضافة إطار مفتاحي عند 2.50 ث");
    expect(translateUi("Added to Video 1")).toBe("أُضيف إلى Video 1");
    expect(translateUi("Advanced Options (3)")).toBe("خيارات متقدمة (3)");
    expect(translateUi("Analyzing 4 clip samples")).toBe("جارٍ تحليل 4 عينة من المقاطع");
    expect(translateUi("Apply Beat Cuts to 2 Clips")).toBe("تطبيق القص على النبضات لـ 2 مقاطع");
    expect(translateUi("Creating proxy · 45%")).toBe("جارٍ إنشاء نسخة المعاينة · 45%");
    expect(translateUi("Delete Vacation edit")).toBe("حذف Vacation edit");
    expect(translateUi("Trim start of interview.mp4")).toBe("قص بداية interview.mp4");
    expect(translateUi("Importing clip.mp4 (2/5)...")).toBe("جارٍ استيراد clip.mp4 (2/5)...");
    expect(translateUi("Edit imported. Relink 2 missing media file(s) below.")).toBe("تم استيراد التعديل. أعد ربط 2 ملفات وسائط مفقودة أدناه.");
    expect(translateUi("Effects · 12")).toBe("المؤثرات · 12");
    expect(translateUi("Shaders · 4")).toBe("الشيدرات · 4");
    expect(translateUi("Go to caption 7")).toBe("الانتقال إلى الترجمة 7");
    expect(translateUi("Group range: 1.25s – 4.75s")).toBe("نطاق المجموعة: 1.25 ث – 4.75 ث");
    expect(translateUi("Loading local Whisper model · 80%")).toBe("جارٍ تحميل نموذج Whisper المحلي · 80%");
    expect(translateUi("Replaced 3 matches in 2 captions. Undo restores the batch.")).toBe("تم استبدال 3 نتائج في 2 ترجمات. التراجع يستعيد المجموعة.");
    expect(translateUi("Removed 4 silent pauses (8.5s)")).toBe("أُزيل 4 فترات صمت (8.5 ث)");
    expect(translateUi("Restoring Vacation edit…")).toBe("جارٍ استعادة Vacation edit…");
    expect(translateUi("Scene 2")).toBe("مشهد 2");
    expect(translateUi("Transition applied; duration shortened from 2s to 1.5s to fit both clips")).toBe("طُبق الانتقال؛ قُصّرت المدة من 2 ث إلى 1.5 ث لتناسب المقطعين");
    expect(translateUi("2 recordings imported!")).toBe("تم استيراد 2 تسجيلات!");
    expect(translateUi("3 snapshots")).toBe("3 لقطات حفظ");
    expect(translateUi("5 keyframes")).toBe("5 إطارات مفتاحية");
    expect(translateUi("8 stickers available")).toBe("8 ملصقًا متاحًا");
    expect(translateUi("2d ago")).toBe("قبل يومين");
    expect(translateUi("5h ago")).toBe("قبل 5 ساعات");
    expect(translateUi("10m ago")).toBe("قبل 10 دقائق");
    expect(translateUi("• Recommended 15s")).toBe("• المدة المقترحة 15 ث");
    expect(translateUi("• Max 60s")).toBe("• المدة القصوى 60 ث");
  });
  it("keeps dynamic user names verbatim", () => {
    expect(translateUi("Rename مشروع العائلة")).toBe("إعادة تسمية مشروع العائلة");
    expect(translateUi("Added to مسار الصوت")).toBe("أُضيف إلى مسار الصوت");
    expect(translateUi("Importing فيديو العائلة.mp4 (1/1)...")).toBe("جارٍ استيراد فيديو العائلة.mp4 (1/1)...");
  });
});

describe("translateTextNode", () => {
  it("keeps the whitespace around the text", () => {
    expect(translateTextNode(" Export ")).toBe(" تصدير ");
    expect(translateTextNode("Poppins")).toBeNull();
  });
});
