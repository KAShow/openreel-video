/**
 * The assistant's usage guide (Hawsh Khalifa build): what it understands, by topic, with requests the
 * user can tap to put in the composer. Every example maps to tools the assistant really has
 * (services/agent/editing-tools.ts); keep the two in step.
 */
export interface GuideSection {
  readonly title: string;
  readonly examples: readonly string[];
  /** A short note under the examples (cost, limits). */
  readonly note?: string;
}

export const ASSISTANT_GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    title: "البدء",
    examples: ["ضع أول فيديو من المكتبة على الخط الزمني", "ضع كل ملفات المكتبة على الخط الزمني بالترتيب"],
    note: "أضف ملفاتك أولاً من قسم «الوسائط»؛ المساعد لا يجلب ملفات بنفسه.",
  },
  {
    title: "القص والترتيب",
    examples: ["قص آخر ثانيتين من المقطع الأول", "اقطع المقطع عند الثانية 5", "احذف المقطع الثاني", "انقل المقطع الثاني إلى البداية", "سرّع هذا المقطع مرتين"],
  },
  {
    title: "الصوت",
    examples: ["احذف فترات الصمت من الفيديو", "اخفض صوت الموسيقى إلى 20%", "اكتم صوت المقطع الثاني", "أضف ظهوراً واختفاءً تدريجياً للصوت"],
  },
  {
    title: "النصوص والترجمة",
    examples: ["أضف عنواناً نصه «عرض اليوم» في أول 3 ثوانٍ", "ضع كابشن عربي للفيديو", "اجعل لون العنوان أصفر وكبّر خطه"],
    note: "الكابشن (تفريغ الكلام) يُخصم عليه نقاط عن كل دقيقة صوت، ويظهر لك التقدير قبل الموافقة.",
  },
  {
    title: "المقاس والشكل",
    examples: ["حوّل الفيديو إلى المقاس العمودي للريلز", "حوّله إلى مقاس يوتيوب الأفقي", "اجعل الصورة تملأ الشاشة"],
  },
  {
    title: "المؤثرات والانتقالات",
    examples: ["أضف انتقالاً بين المقطعين", "زد السطوع والتباين قليلاً", "أضف تعتيماً خفيفاً على الأطراف", "أضف تلاشياً في بداية الفيديو ونهايته"],
  },
  {
    title: "طلبات عامة",
    examples: ["خله احترافي", "وش تقدر تسوي؟", "افتح نافذة التصدير"],
  },
];
