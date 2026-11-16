/**
 * Arabic text the code builds at run time (errors, notices, outcomes, labels with values in them),
 * addressed by key. Static labels written in JSX stay English and go through the page translator
 * (translate.ts + ar.ts), so source files stay close to upstream OpenReel; anything assembled in
 * code belongs here, because the page translator can only match whole, fixed English strings.
 *
 * Values may hold `{name}` placeholders, filled by msg(key, { name }).
 */
export const MESSAGES = {
  // ── AI assistant: errors raised before or during a turn ───────────────────
  "chat.error.noProject": "افتح مشروعاً أو أنشئ مشروعاً جديداً قبل بدء المحادثة.",
  "chat.error.apiFormat": "اختر صيغة الواجهة في الإعدادات ← مساعد المونتاج.",
  "chat.error.modelId": "أدخل معرّف النموذج في الإعدادات ← مساعد المونتاج.",
  "chat.error.endpoint": "أدخل عنوان HTTPS صالحاً، أو HTTP على الجهاز المحلي فقط.",
  "chat.error.apiKey": "أضف مفتاح الواجهة لهذه الجلسة في الإعدادات ← مساعد المونتاج قبل إرسال طلب التعديل.",
  "chat.error.connection": "إعدادات الاتصال غير صالحة.",
  "chat.error.turnFailed": "تعذّر إكمال طلب المساعد.",
  "chat.error.fallback": "تعذّر تنفيذ طلب المساعد.",

  // ── AI assistant: how a turn ended ────────────────────────────────────────
  "chat.stop.maxSteps": "توقفت لأنني بلغت حدّ الخطوات في هذا الطلب. اطلب مني المتابعة إن بقي عمل.",
  "chat.stop.maxToolCalls": "توقفت لأنني بلغت حدّ استدعاءات الأدوات في هذا الطلب. اطلب مني المتابعة إن بقي عمل.",
  "chat.stop.budget": "توقف النموذج عند حدّ الردّ أو حدّ الرموز. اطلب مني المتابعة، أو ارفع حدّ إخراج النموذج.",
  "chat.turn.cancelled": "أُلغي الطلب، وتم تجاهل التعديلات المعلّقة.",
  "chat.turn.failedNoEdits": "تعذّر إكمال الطلب، ولم يُطبَّق أي تعديل.",
  "chat.turn.noSummary": "اكتملت التعديلات، لكن النموذج لم يكتب ملخصاً.",
  "chat.turn.empty": "أعاد النموذج ردّاً فارغاً. حاول مرة أخرى.",
  "chat.turn.undoLabel": "تعديل بالمساعد",

  // ── AI assistant: error card ──────────────────────────────────────────────
  "chat.errorCard.auth.title": "فشلت المصادقة",
  "chat.errorCard.auth.message": "رفضت الخدمة مفتاح الواجهة. تحقق من مفتاح الجلسة وحاول مرة أخرى.",
  "chat.errorCard.auth.action": "التحقق من المفتاح",
  "chat.errorCard.session.title": "انتهت الجلسة",
  "chat.errorCard.rate.title": "بلغت حدّ الطلبات",
  "chat.errorCard.rate.message": "الخدمة تتلقى طلبات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
  "chat.errorCard.network.title": "تعذّر الوصول إلى الخدمة",
  "chat.errorCard.network.message": "تحقق من عنوان الخدمة وتأكد أنها تعمل. وفي المتصفح يجب أن تسمح الخدمة بطلبات CORS من OpenReel.",
  "chat.errorCard.endpoint.action": "التحقق من العنوان",
  "chat.errorCard.context.title": "المحادثة طويلة جداً",
  "chat.errorCard.context.message": "لا يتسع النموذج لكامل المحادثة. ابدأ محادثة جديدة وأكمل فيها.",
  "chat.errorCard.context.action": "بدء محادثة جديدة",
  "chat.errorCard.notFound.title": "النموذج أو المسار غير موجود",
  "chat.errorCard.notFound.message": "تحقق أن العنوان الأساسي ومعرّف النموذج يطابقان ما تقدمه الخدمة.",
  "chat.errorCard.setup.title": "الإعداد مطلوب",
  "chat.errorCard.setup.settings": "فتح إعدادات المساعد",
  "chat.errorCard.generic.title": "تعذّر تنفيذ الطلب",
  "chat.errorCard.dismiss": "إغلاق الخطأ",
  "chat.errorCard.details": "تفاصيل تقنية",
  "chat.errorCard.fix": "إصلاح المشكلة",

  // ── AI assistant: panel ───────────────────────────────────────────────────
  "chat.panel.log": "المحادثة ونتائج التعديل",
  "chat.panel.tokens": "{count} رمز",
  "chat.panel.tokensTitle": "{input} إدخال · {output} إخراج",
  "chat.suggestion.title": "أضف عنواناً نصه «مرحباً» في أول 3 ثوانٍ",
  "chat.suggestion.trim": "اقتطع ثانيتين من نهاية أول مقطع",
  "chat.suggestion.fade": "أضف تلاشياً تدريجياً في بداية أول مقطع",
  "chat.suggestion.addFirst": "ضع أول فيديو من المكتبة على الخط الزمني",
  "chat.suggestion.addAll": "ضع كل ملفات المكتبة على الخط الزمني بالترتيب",
  "chat.suggestion.silence": "احذف فترات الصمت من الفيديو",
  "chat.suggestion.captions": "ضع كابشن عربي للفيديو",
  "chat.suggestion.vertical": "حوّل الفيديو إلى المقاس العمودي للريلز",
  "chat.next.label": "جرّب بعدها",
  "chat.empty.needsMedia": "أضف فيديو أو صورة من «الوسائط» أولاً، ثم اطلب التعديل بالكلام.",
  "chat.composer.hint": "اضغط Enter للإرسال · Shift+Enter لسطر جديد",

  // ── AI assistant: tool cards and confirmation ─────────────────────────────
  "chat.tool.status.running": "جارٍ التنفيذ",
  "chat.tool.status.done": "تم",
  "chat.tool.status.retrying": "جارٍ التصحيح",
  "chat.tool.status.corrected": "صُحّح",
  "chat.tool.status.error": "فشل",
  "chat.tool.status.rejected": "تم التخطي",
  "chat.tool.outcome.done": "تم تنفيذ «{label}» بنجاح.",
  "chat.tool.outcome.corrected": "أخطأ النموذج في «{label}» ثم صحّحه.",
  "chat.tool.outcome.retrying": "«{label}» يحتاج تصحيحاً، وسيحاول النموذج مرة أخرى.",
  "chat.tool.outcome.rejected": "تم تخطي «{label}» بقرارك.",
  "chat.tool.outcome.running": "جارٍ تنفيذ «{label}»…",
  "chat.tool.outcome.error": "تعذّر تنفيذ «{label}».",
  "chat.tool.args": "المعطيات",
  "chat.tool.result": "النتيجة",
  "chat.tool.aria": "{label} — {status}",
  "chat.confirm.body": "يريد المساعد تنفيذ «{label}»، وقد يغيّر مشروعك أو يستهلك رصيداً.",

  // ── AI assistant: speech-to-captions tool (charged in points) ─────────────
  "chat.transcribe.costEstimate": "تفريغ الكلام يُخصم من نقاط عيون المخرج: نحو {points} نقطة لهذا المقطع ({price} نقطة لكل دقيقة صوت بدأت). تُخصم النقاط بمجرد نجاح التفريغ.",
  "chat.transcribe.costGeneric": "تفريغ الكلام يُخصم من نقاط عيون المخرج عن كل دقيقة صوت بدأت.",
  "chat.transcribe.costReuse": "سبق تفريغ هذا المقطع في هذه الجلسة، فسيُستخدم النص نفسه دون خصم نقاط جديدة.",
  "transcribe.noSpeech": "لم يُكتشف كلام في هذا المقطع.",
  "transcribe.noSpeechCharged": "لم يُكتشف كلام في هذا المقطع، وخُصم {points} نقطة مقابل الاستماع إليه.",
  "chat.transcribe.chargedNotApplied": "خُصم {points} نقطة لتفريغ الكلام، لكن الطلب لم يكتمل فلم تُضف الترجمة. اطلبها مرة أخرى للمقطع نفسه وسيُستخدم التفريغ ذاته دون خصم جديد ما دامت الصفحة مفتوحة.",

  // ── AI assistant: history and code blocks ─────────────────────────────────
  "chat.history.delete": "حذف {title}",
  "chat.history.requests.one": "طلب واحد",
  "chat.history.requests.two": "طلبان",
  "chat.history.requests.few": "{n} طلبات",
  "chat.history.requests.many": "{n} طلباً",
  "chat.code.copy": "نسخ الكود",
  "chat.code.copied": "تم نسخ الكود",

  // ── AI assistant: points a request consumed ───────────────────────────────
  "chat.cost.line": "استهلك هذا الطلب {points} نقطة ({steps})",
  "chat.cost.steps.one": "خطوة واحدة",
  "chat.cost.steps.two": "خطوتان",
  "chat.cost.steps.few": "{n} خطوات",
  "chat.cost.steps.many": "{n} خطوة",

  // ── AI assistant: edit JSON and presets panel ─────────────────────────────
  "share.error.generic": "تعذّرت مشاركة التعديل",
  "share.error.chooseClip": "اختر مقطعاً أولاً",
  "share.error.tooLarge": "ملف JSON يتجاوز 5 ميغابايت",
  "share.error.mediaType": "اختر ملفاً من نوع الوسائط نفسه",
  "share.txn.import": "استيراد تعديل محمول",
  "share.txn.preset": "تطبيق إعداد مشترك",
  "share.txn.relink": "إعادة ربط وسائط مشتركة",
  "share.done.importMissing": "تم استيراد التعديل. أعد ربط {count} ملفات وسائط مفقودة أدناه.",
  "share.done.import": "تم استيراد التعديل كخطوة تراجع واحدة. كل مراجع الوسائط مرتبطة.",
  "share.done.exportEdit": "تم تصدير ملف التعديل. شارك ملفات الوسائط الأصلية بشكل منفصل.",
  "share.done.exportPreset": "تم تصدير الإعداد الجاهز. عند تطبيقه تُنشأ معرّفات جديدة للمؤثرات والانتقالات.",
  "share.done.applyPreset": "تم تطبيق الإعداد على المقطع. {summary}",
  "share.done.undo": "تم التراجع عن التعديل",
  "share.done.redo": "تمت إعادة التعديل",
  "share.done.relinked": "أُعيد ربط {name}. حُفظت معرّفات العناصر.",
  "share.clipFallback": "مقطع",
  "share.working": "جارٍ التحقق والتطبيق…",
  "share.help": "التعديل المحمول (الإصدار 2) يشارك الخط الزمني ومراجع الوسائط المحلية. الاستيراد يستبدل التعديل الحالي بخطوة تراجع واحدة. الملفات تحتوي بيانات فقط؛ وتُرفض السكربتات والروابط وتعليمات الوكيل.",
  "share.relink": "إعادة ربط {name}",
} as const;

export type MessageKey = keyof typeof MESSAGES;

/** The Arabic message for `key`, with `{name}` placeholders filled from `params`. */
export function msg(key: MessageKey, params?: Record<string, string | number>): string {
  const text: string = MESSAGES[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
