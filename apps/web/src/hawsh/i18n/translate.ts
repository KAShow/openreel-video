/**
 * Arabic UI for the Hawsh Khalifa build: English UI string → Arabic, from one dictionary (ar.ts) plus a
 * few patterns for strings built from parts ("Open Crop", "Expand Keyframes section", "3 selected").
 * Exact matches only, so user content (clip names, project names, typed text) is left alone unless it
 * happens to equal a UI label.
 */
import { AR } from "./ar";

type Pattern = [RegExp, (m: RegExpMatchArray, t: (s: string) => string | null) => string | null];

type Unit = "minute" | "hour" | "day";
const UNITS: Record<Unit, [one: string, two: string, few: string]> = {
  minute: ["دقيقة", "دقيقتين", "دقائق"],
  hour: ["ساعة", "ساعتين", "ساعات"],
  day: ["يوم", "يومين", "أيام"],
};
/** "5 دقائق", "دقيقتين", "11 دقيقة": Arabic plural rules for counts. */
function count(n: number, unit: Unit): string {
  const [one, two, few] = UNITS[unit];
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${n >= 3 && n <= 10 ? few : one}`;
}

/** Translates a part only when the dictionary knows it; otherwise the whole pattern is skipped. */
const part = (t: (s: string) => string | null, s: string) => t(s.trim());

const PATTERNS: Pattern[] = [
  [/^(.+)\. Drag onto a clip to apply, or double-click to apply to selected clip\.$/, (m, t) => {
    const name = part(t, m[1]);
    return name && `${name}. اسحبه إلى مقطع لتطبيقه، أو انقر مرتين لتطبيقه على المقطع المحدد.`;
  }],
  [/^(.+)\. Drag onto a clip edge, or double-click to apply to the selected cut\.$/, (m, t) => {
    const name = part(t, m[1]);
    return name && `${name}. اسحبه إلى طرف مقطع، أو انقر مرتين لتطبيقه على القطع المحدد.`;
  }],
  [/^Expand (.+) section$/, (m, t) => { const s = part(t, m[1]); return s && `توسيع قسم ${s}`; }],
  [/^Collapse (.+) section$/, (m, t) => { const s = part(t, m[1]); return s && `طي قسم ${s}`; }],
  [/^Open (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `فتح ${s}`; }],
  [/^Preview and select (.+?)(?:, (?:Built-in fill|Paper effect))?$/, (m, t) => { const s = part(t, m[1]); return s && `معاينة واختيار ${s}`; }],
  [/^Preview and apply (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `معاينة وتطبيق ${s}`; }],
  [/^Preview (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `معاينة ${s}`; }],
  [/^Set entry animation to (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `حركة الدخول: ${s}`; }],
  [/^Set exit animation to (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `حركة الخروج: ${s}`; }],
  [/^Edit (.+) value$/, (m, t) => { const s = part(t, m[1]); return s && `تعديل قيمة ${s}`; }],
  [/^Add (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `إضافة ${s}`; }],
  [/^Track (\d+)$/, (m) => `المسار ${m[1]}`],
  [/^(Rename|Duplicate|Delete|Hide|Show|Lock|Unlock) Track (\d+)$/, (m) => {
    const verb: Record<string, string> = { Rename: "إعادة تسمية", Duplicate: "تكرار", Delete: "حذف", Hide: "إخفاء", Show: "إظهار", Lock: "قفل", Unlock: "فتح قفل" };
    return `${verb[m[1]]} المسار ${m[2]}`;
  }],
  [/^Move Track (\d+) (up|down)$/, (m) => `نقل المسار ${m[1]} ${m[2] === "up" ? "للأعلى" : "للأسفل"}`],
  [/^Select (text|video|image|audio|shape) clip (.+)$/, (m) => {
    const kind: Record<string, string> = { text: "النص", video: "الفيديو", image: "الصورة", audio: "الصوت", shape: "الشكل" };
    return `تحديد مقطع ${kind[m[1]]} ${m[2]}`;
  }],
  [/^Go to step (\d+)$/, (m) => `الانتقال إلى الخطوة ${m[1]}`],
  [/^Select all captions \((\d+)\)$/, (m) => `تحديد كل الترجمات (${m[1]})`],
  [/^(\d+) emojis available$/, (m) => `${m[1]} رمزاً تعبيرياً متاحاً`],
  [/^(\d+) selected$/, (m) => `${m[1]} محدد`],
  [/^(\d+) items added to the project$/, (m) => `أُضيف ${m[1]} عناصر إلى المشروع`],
  [/^Undo \((\d+)\)$/, (m) => `تراجع (${m[1]})`],
  [/^Redo \((\d+)\)$/, (m) => `إعادة (${m[1]})`],
  [/^(\d+) (minute|hour|day)s? ago$/, (m) => `قبل ${count(Number(m[1]), m[2] as Unit)}`],
  [/^(\d+) older saves? available$/, (m) => `${m[1]} نسخة أقدم متاحة`],
  [/^· (\d+) kbps audio$/, (m) => `· ${m[1]} kbps صوت`],
  [/^Recover (.+)$/, (m) => `استعادة ${m[1]}`],
  [/^~(\d+) seconds?$/, (m) => `~${m[1]} ثانية`],
  [/^~(\d+) minutes?$/, (m) => `~${m[1]} دقيقة`],
  [/^(.+) · (\d+) cores$/, (m) => `${m[1]} · ${m[2]} أنوية`],
  [/^Loop (\S+) to (\S+) • I: mark start • O: mark end • Shift\+L: toggle$/, (m) =>
    `تكرار من ${m[1]} إلى ${m[2]} • I: بداية • O: نهاية • Shift+L: تشغيل/إيقاف`],
  [/^Go to a frame · (\S+) fps · HH:MM:SS:FF \(non-drop-frame\)\. You can also enter seconds\.$/, (m) =>
    `انتقل إلى إطار · ${m[1]} إطار/ث · HH:MM:SS:FF. يمكنك أيضاً إدخال الثواني.`],
  [/^Theme: (Light|Dark)\. Switch to (Light|Dark)$/, (m) =>
    `المظهر: ${m[1] === "Light" ? "فاتح" : "داكن"}. التبديل إلى ${m[2] === "Light" ? "الفاتح" : "الداكن"}`],
  [/^Add Keyframe at (\S+)s$/, (m) => `إضافة إطار مفتاحي عند ${m[1]} ث`],
  [/^Keyframe exists at (\S+)s$/, (m) => `يوجد إطار مفتاحي عند ${m[1]} ث`],
  [/^Added to (.+)$/, (m) => `أُضيف إلى ${m[1]}`],
  [/^Advanced Options \((\d+)\)$/, (m) => `خيارات متقدمة (${m[1]})`],
  [/^(Analyzing|Analyzed) (\d+) clip samples$/, (m) => `${m[1] === "Analyzing" ? "جارٍ تحليل" : "تم تحليل"} ${m[2]} عينة من المقاطع`],
  [/^Apply Beat Cuts to (\d+) Clips$/, (m) => `تطبيق القص على النبضات لـ ${m[1]} مقاطع`],
  [/^Sync (\d+) Clips to Beats$/, (m) => `مزامنة ${m[1]} مقاطع مع النبضات`],
  [/^Synced (\d+) clips to beats$/, (m) => `تمت مزامنة ${m[1]} مقاطع مع النبضات`],
  [/^Creating proxy · (\d+)%$/, (m) => `جارٍ إنشاء نسخة المعاينة · ${m[1]}%`],
  [/^(Delete|Duplicate|Rename|Hide|Show|Lock|Unlock|Mute|Unmute|Solo) (.+)$/, (m) => {
    const verb: Record<string, string> = { Delete: "حذف", Duplicate: "تكرار", Rename: "إعادة تسمية", Hide: "إخفاء", Show: "إظهار", Lock: "قفل", Unlock: "فتح قفل", Mute: "كتم", Unmute: "إلغاء كتم", Solo: "عزل" };
    return `${verb[m[1]]} ${m[2]}`;
  }],
  [/^Delete snapshot (.+)$/, (m) => `حذف لقطة الحفظ ${m[1]}`],
  [/^Delete (\d+) selected keyframes?$/, (m) => `حذف ${m[1]} إطارات مفتاحية محددة`],
  [/^(Copy|Duplicate) (\d+) selected clips$/, (m) => `${m[1] === "Copy" ? "نسخ" : "تكرار"} ${m[2]} مقاطع محددة`],
  [/^Downloading (.+?)…$/, (m) => `جارٍ تنزيل ${m[1]}…`],
  [/^Downloading (.+), then transcribing…$/, (m) => `جارٍ تنزيل ${m[1]}، ثم التفريغ…`],
  [/^Importing (.+) \((\d+)\/(\d+)\)\.\.\.$/, (m) => `جارٍ استيراد ${m[1]} (${m[2]}/${m[3]})...`],
  [/^Extracting audio from (.+)\.\.\.$/, (m) => `جارٍ استخراج الصوت من ${m[1]}...`],
  [/^Edit imported\. Relink (\d+) missing media file\(s\) below\.$/, (m) => `تم استيراد التعديل. أعد ربط ${m[1]} ملفات وسائط مفقودة أدناه.`],
  [/^(Effects|Shaders) · (\d+)$/, (m) => `${m[1] === "Effects" ? "المؤثرات" : "الشيدرات"} · ${m[2]}`],
  [/^Go to caption (\d+)$/, (m) => `الانتقال إلى الترجمة ${m[1]}`],
  [/^Group range: (\S+)s – (\S+)s$/, (m) => `نطاق المجموعة: ${m[1]} ث – ${m[2]} ث`],
  [/^Loading local Whisper model · (\d+)%$/, (m) => `جارٍ تحميل نموذج Whisper المحلي · ${m[1]}%`],
  [/^Replaced (\d+) matches in (\d+) captions\. Undo restores the batch\.$/, (m) => `تم استبدال ${m[1]} نتائج في ${m[2]} ترجمات. التراجع يستعيد المجموعة.`],
  [/^Removed (\d+) silent pauses \((\S+)s\)$/, (m) => `أُزيل ${m[1]} فترات صمت (${m[2]} ث)`],
  [/^Removed (\d+) silent sections?$/, (m) => `أُزيل ${m[1]} أجزاء صامتة`],
  [/^Restoring (.+)…$/, (m) => `جارٍ استعادة ${m[1]}…`],
  [/^(Scene|Marker|Beat) (\d+)$/, (m) => `${m[1] === "Scene" ? "مشهد" : m[1] === "Marker" ? "علامة" : "نبضة"} ${m[2]}`],
  [/^Transition applied; duration shortened from (\S+)s to (\S+)s to fit both clips$/, (m) => `طُبق الانتقال؛ قُصّرت المدة من ${m[1]} ث إلى ${m[2]} ث لتناسب المقطعين`],
  [/^Trim (start|end) of (.+)$/, (m) => `قص ${m[1] === "start" ? "بداية" : "نهاية"} ${m[2]}`],
  [/^(\d+) recordings? imported!$/, (m) => `تم استيراد ${m[1]} تسجيلات!`],
  [/^(\d+) snapshots$/, (m) => `${m[1]} لقطات حفظ`],
  [/^(\d+) keyframes$/, (m) => `${m[1]} إطارات مفتاحية`],
  [/^\((\d+) keyframes\)$/, (m) => `(${m[1]} إطارات مفتاحية)`],
  [/^(\d+) stickers available$/, (m) => `${m[1]} ملصقًا متاحًا`],
  [/^(\d+)d ago$/, (m) => `قبل ${count(Number(m[1]), "day")}`],
  [/^(\d+)h ago$/, (m) => `قبل ${count(Number(m[1]), "hour")}`],
  [/^(\d+)m ago$/, (m) => `قبل ${count(Number(m[1]), "minute")}`],
  [/^• (Recommended|Max) (\S+)s$/, (m) => `• ${m[1] === "Recommended" ? "المدة المقترحة" : "المدة القصوى"} ${m[2]} ث`],
  [/^(\d+) clips( selected)?$/, (m) => `${m[1]} مقاطع${m[2] ? " محددة" : ""}`],
  [/^(\d+) tracks$/, (m) => `${m[1]} مسارات`],
  [/^(\d+) files imported$/, (m) => `تم استيراد ${m[1]} ملفات`],
  [/^(\d+) layers selected$/, (m) => `${m[1]} طبقات محددة`],
  [/^Apply (.+?) filter preset$/, (m, t) => { const s = part(t, m[1]); return s && `تطبيق إعداد الفلتر ${s}`; }],
  [/^Apply (.+?) preset$/, (m, t) => { const s = part(t, m[1]); return s && `تطبيق إعداد ${s}`; }],
  [/^Apply (.+?) white balance$/, (m, t) => { const s = part(t, m[1]); return s && `تطبيق توازن الأبيض ${s}`; }],
  [/^Applying (\d+) cuts…$/, (m) => `جارٍ تطبيق ${m[1]} عمليات قص…`],
  [/^Audio synchronized · (\d+)% confidence$/, (m) => `تمت مزامنة الصوت · الثقة ${m[1]}%`],
  [/^Camera cut added at (\S+)s · Undo restores the previous edit$/, (m) => `أُضيف قطع الكاميرا عند ${m[1]} ث · التراجع يستعيد التعديل السابق`],
  [/^Caption (\d+) text$/, (m) => `نص الترجمة ${m[1]}`],
  [/^Create Group \((\d+) selected\)$/, (m) => `إنشاء مجموعة (${m[1]} محددة)`],
  [/^Decoding (.+)…$/, (m) => `جارٍ فك ترميز ${m[1]}…`],
  [/^Generate Beat Grid at (\S+) BPM$/, (m) => `إنشاء شبكة النبضات بمعدل ${m[1]} BPM`],
  [/^Move (.+) (up|down)$/, (m) => `نقل ${m[1]} ${m[2] === "up" ? "للأعلى" : "للأسفل"}`],
  [/^Original \((\d+)x(\d+)\)$/, (m) => `الأصلية (${m[1]}×${m[2]})`],
  [/^Paste clipboard at (\S+)s$/, (m) => `لصق الحافظة عند ${m[1]} ث`],
  [/^Proxy (\d+)%$/, (m) => `نسخة المعاينة ${m[1]}%`],
  [/^Relinked (\d+) of (\d+) assets?$/, (m) => `أُعيد ربط ${m[1]} من ${m[2]} أصول`],
  [/^Relinking (.+)…$/, (m) => `جارٍ إعادة ربط ${m[1]}…`],
  [/^Sampling clip audio \((\d+)\/(\d+)\)$/, (m) => `جارٍ أخذ عينات صوت المقطع (${m[1]}/${m[2]})`],
  [/^Transcribing with (.+)…$/, (m) => `جارٍ التفريغ باستخدام ${m[1]}…`],
];

/** Arabic for one UI string, or null when it is not a known UI string. */
export function translateUi(text: string): string | null {
  const key = text.trim();
  if (!key || !/[A-Za-z]/.test(key)) return null;
  const exact = AR[key];
  if (exact !== undefined) return exact;
  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) {
      const out = fn(m, translateUi);
      if (out) return out;
    }
  }
  return null;
}

/** Same as translateUi but keeps the surrounding whitespace of a text node. */
export function translateTextNode(value: string): string | null {
  const out = translateUi(value);
  if (out === null) return null;
  const lead = /^\s*/.exec(value)![0];
  const trail = /\s*$/.exec(value)![0];
  return lead + out + trail;
}
