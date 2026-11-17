/**
 * Bodies of the phone tool sheets that used to say "coming in the next stage": transitions, effects,
 * sound, edit and more, plus the captions sheet with its style tab. The work itself is in cuts.ts,
 * effect-tools.ts, audio-tools.ts and project-tools.ts.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clapperboard, Mic, Music, Square } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useChatStore } from "../../stores/chat-store";
import { useRouter } from "../../hooks/use-router";
import { AssistantGuide } from "../../components/editor/chat/AssistantGuide";
import { HawshLibraryDialog } from "../HawshLibrary";
import { useHawshStore } from "../session";
import { SKIP_WELCOME } from "../simple";
import { logEvent } from "../logger";
import { ServerCaptionPanel } from "../ServerCaptionPanel";
import { CaptionStyleEditor } from "../CaptionStyleEditor";
import { captionClips } from "../caption-look";
import { AppearancePicker } from "../AppearanceControls";
import { captionClipId } from "./add-tools";
import { sheetTarget } from "./live";
import {
  DEFAULT_TRANSITION_SECONDS, mainCuts, nearestCut, PHONE_TRANSITIONS, removeAllTransitions, removeTransition, setTransition,
  setTransitionEverywhere, TRANSITION_MAX, TRANSITION_MIN, transitionLabel,
} from "./cuts";
import { ADJUSTMENTS, adjustmentValue, applyLook, applyLookEverywhere, clearEffects, currentLook, LOOKS, setAdjustment } from "./effect-tools";
import {
  AUDIO_FADE, hasNoiseReduction, importAudio, isOriginalMuted, muteOriginal, placeAudio, recordingName, setAudioFade, setNoiseReduction,
} from "./audio-tools";
import { currentFormat, cutSilenceEverywhere, FORMATS, planSilenceEverywhere, setFormat, setReversed, type SilencePlan } from "./project-tools";
import { bigButton, chip, chipOff, chipOn, Note, primaryButton, Row, Slider, useNote } from "./ui";

/** The playhead at the moment of a tap (sheets do not re-render on every frame of playback). */
const playheadNow = () => useTimelineStore.getState().playheadPosition;

const useTarget = () => {
  const project = useProjectStore((s) => s.project);
  const selected = useUIStore((s) => s.selectedItems);
  // Re-render when the clip under the playhead changes, not on every frame.
  const targetId = useTimelineStore((s) => sheetTarget(project, selected, s.playheadPosition)?.clip.id ?? null);
  const target = useMemo(() => {
    if (!targetId) return null;
    // Asking at the clip's own start finds the same clip as asking at the playhead.
    const start = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === targetId)?.startTime ?? playheadNow();
    return sheetTarget(project, selected, start);
  }, [project, selected, targetId]);
  return { project, target };
};

const mediaType = (project: ReturnType<typeof useProjectStore.getState>["project"], mediaId: string) =>
  project.mediaLibrary.items.find((m) => m.id === mediaId)?.type;

/* ------------------------------------------------------------------ transitions */

export const TransitionsSheet: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const seekTo = useTimelineStore((s) => s.seekTo);
  const cuts = mainCuts(project);
  const [index, setIndex] = useState(() => {
    const near = nearestCut(cuts, playheadNow());
    return near ? cuts.indexOf(near) : 0;
  });
  const [seconds, setSeconds] = useState(DEFAULT_TRANSITION_SECONDS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useNote();

  const cut = cuts[Math.min(index, cuts.length - 1)];
  useEffect(() => { if (cut?.transition) setSeconds(Math.round(cut.transition.duration * 10) / 10); }, [cut?.transition]);

  if (!cut) return <p className="py-8 text-center text-sm text-fg-muted">أضف لقطتين أو أكثر حتى تضع انتقالاً بينهما.</p>;

  const run = async (fn: () => Promise<string | null>, ok?: string) => {
    setBusy(true);
    try { const err = await fn(); setNote(err ?? ok ?? null); } finally { setBusy(false); }
  };
  const go = (i: number) => { setIndex(i); seekTo(Math.max(0, cuts[i].time - 1)); };
  const current = cut.transition?.type;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="القطعة السابقة" disabled={index <= 0} onClick={() => go(index - 1)} className="grid h-9 w-9 place-items-center rounded-full border border-border disabled:opacity-30"><ChevronRight size={18} /></button>
        <div className="text-center">
          <p className="text-sm font-bold">بين اللقطة {cut.index} واللقطة {cut.index + 1}</p>
          <p className="text-[11px] text-fg-muted">{transitionLabel(current)}</p>
        </div>
        <button type="button" aria-label="القطعة التالية" disabled={index >= cuts.length - 1} onClick={() => go(index + 1)} className="grid h-9 w-9 place-items-center rounded-full border border-border disabled:opacity-30"><ChevronLeft size={18} /></button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button type="button" disabled={busy} onClick={() => void run(() => removeTransition(cut))}
          className={`rounded-xl border px-2 py-3 text-xs font-semibold ${!current ? chipOn : chipOff}`}>بلا</button>
        {PHONE_TRANSITIONS.map((t) => (
          <button key={t.type} type="button" disabled={busy} onClick={() => { void run(() => setTransition(cut, t.type, seconds)); seekTo(Math.max(0, cut.time - seconds - 0.6)); }}
            className={`rounded-xl border px-2 py-3 text-xs font-semibold ${current === t.type ? chipOn : chipOff}`}>{t.label}</button>
        ))}
      </div>

      <Row label="المدة">
        <Slider label="مدة الانتقال" value={seconds} min={TRANSITION_MIN} max={TRANSITION_MAX} step={0.1} disabled={busy} show={(v) => `${v.toFixed(1)} ث`}
          onCommit={(v) => { const s = Math.round(v * 10) / 10; setSeconds(s); if (current) void run(() => setTransition(cut, current, s)); }} />
      </Row>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !current} className={`${chip} ${chipOff} py-2.5`}
          onClick={() => current && void run(() => setTransitionEverywhere(current, seconds), `«${transitionLabel(current)}» على كل القطعات.`)}>طبّقه على كل القطعات</button>
        <button type="button" disabled={busy || !cuts.some((c) => c.transition)} className={`${chip} ${chipOff} py-2.5`}
          onClick={() => void run(removeAllTransitions, "حُذفت كل الانتقالات.")}>احذف كل الانتقالات</button>
      </div>
      <Note text={note} />
    </div>
  );
};

/* ------------------------------------------------------------------ effects */

export const EffectsSheet: React.FC<{ clipId?: string }> = ({ clipId }) => {
  const { project, target } = useTarget();
  const clip = clipId ? project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) : target?.clip;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useNote();
  const visual = clip && mediaType(project, clip.mediaId) !== "audio";
  if (!clip || !visual) return <p className="py-8 text-center text-sm text-fg-muted">أضف فيديو أو صورة أولاً، أو حرّك المؤشر الأبيض فوق لقطة.</p>;

  const look = currentLook(clip);
  const run = async (fn: () => Promise<string | null>, ok?: string) => {
    setBusy(true);
    try { const err = await fn(); setNote(err ?? ok ?? null); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {!clipId && target && target.index > 0 && <p className="text-center text-xs text-fg-muted">على اللقطة {target.index}</p>}
      <Row label="فلتر">
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
          <button type="button" disabled={busy} onClick={() => void run(() => applyLook(clip.id, null))} className="flex shrink-0 flex-col items-center gap-1 text-[11px]">
            <span className={`grid h-14 w-14 place-items-center rounded-xl border-2 bg-bg-1 text-lg ${!look ? "border-primary" : "border-transparent"}`}>⦸</span>بلا
          </button>
          {LOOKS.map((l) => (
            <button key={l.id} type="button" disabled={busy} onClick={() => void run(() => applyLook(clip.id, l.id, look?.id === l.id ? look.strength : 1))} className="flex shrink-0 flex-col items-center gap-1 text-[11px]">
              <span className={`h-14 w-14 rounded-xl border-2 ${look?.id === l.id ? "border-primary" : "border-transparent"}`} style={{ background: l.swatch }} />{l.label}
            </button>
          ))}
        </div>
      </Row>
      {look && (
        <Row label="قوة الفلتر">
          <Slider label="قوة الفلتر" value={Math.round(look.strength * 100)} min={10} max={100} step={5} disabled={busy} show={(v) => `${Math.round(v)}%`}
            onCommit={(v) => void run(() => applyLook(clip.id, look.id, v / 100))} />
        </Row>
      )}
      <Row label="ضبط يدوي">
        <div className="space-y-2">
          {ADJUSTMENTS.map((a) => (
            <div key={a.type} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <span className="text-xs">{a.label}</span>
              <Slider label={a.label} value={adjustmentValue(clip, a)} min={a.min} max={a.max} step={a.step} disabled={busy} show={(v) => v.toFixed(2)}
                onCommit={(v) => void run(() => setAdjustment(clip.id, a, v))} />
            </div>
          ))}
        </div>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className={`${chip} ${chipOff} py-2.5`}
          onClick={() => void run(() => applyLookEverywhere(look?.id ?? null, look?.strength ?? 1), look ? "الفلتر على كل اللقطات." : "أُزيل الفلتر من كل اللقطات.")}>الفلتر على كل اللقطات</button>
        <button type="button" disabled={busy || !clip.effects?.length} className={`${chip} ${chipOff} py-2.5`}
          onClick={() => void run(() => clearEffects(clip.id), "أُزيلت المؤثرات.")}>أزل كل المؤثرات</button>
      </div>
      <Note text={note} />
    </div>
  );
};

/* ------------------------------------------------------------------ sound */

const Recorder: React.FC<{ onDone: (file: File, start: number) => Promise<void> }> = ({ onDone }) => {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; start: number } | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [state]);
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("هذا المتصفح لا يدعم التسجيل."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const timeline = useTimelineStore.getState();
      timeline.pause();
      rec.current = { recorder, stream, chunks, start: timeline.playheadPosition };
      recorder.start();
      setSeconds(0); setState("recording");
    } catch {
      setError("ما قدرت أفتح الميكروفون. اسمح للموقع باستخدامه وجرّب مرة ثانية.");
    }
  };

  const stop = () => {
    const r = rec.current;
    if (!r) return;
    setState("saving");
    r.recorder.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const type = r.recorder.mimeType || "audio/webm";
      const file = new File(r.chunks, recordingName(type), { type });
      rec.current = null;
      void onDone(file, r.start).finally(() => setState("idle"));
    };
    r.recorder.stop();
  };

  return (
    <div className="space-y-1">
      {state === "recording" ? (
        <button type="button" onClick={stop} className={`${bigButton} border-red-500/60`}>
          <Square size={22} className="shrink-0 text-red-400" fill="currentColor" aria-hidden />
          <span><b className="block">أوقف التسجيل</b><span className="font-mono text-xs text-red-400">● {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></span>
        </button>
      ) : (
        <button type="button" disabled={state === "saving"} onClick={() => void start()} className={bigButton}>
          <Mic size={22} className="shrink-0" aria-hidden />
          <span><b className="block">{state === "saving" ? "جارٍ الحفظ…" : "سجّل بصوتك"}</b><span className="text-xs text-fg-muted">تعليق صوتي يبدأ عند المؤشر الأبيض</span></span>
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
};

export const AudioSheet: React.FC = () => {
  const { project, target } = useTarget();
  const signedIn = useHawshStore((s) => s.status === "ready");
  const [library, setLibrary] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useNote();
  const input = useRef<HTMLInputElement>(null);
  const muted = isOriginalMuted(project);
  const clip = target?.clip;
  const audible = clip && (mediaType(project, clip.mediaId) === "video" || mediaType(project, clip.mediaId) === "audio");

  const run = async (label: string, fn: () => Promise<string | null>) => {
    setBusy(label);
    try { setNote(await fn()); } finally { setBusy(null); }
  };
  const added = (placed: number, failed: number) => (failed ? `تعذّرت إضافة ${failed} ملف.` : placed ? "أُضيف الصوت عند المؤشر الأبيض." : null);

  return (
    <div className="space-y-3">
      <input ref={input} type="file" accept="audio/*" multiple hidden data-testid="audio-sheet-file"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void run("جارٍ إضافة الصوت…", async () => { const r = await importAudio(files, playheadNow()); return added(r.placed, r.failed); });
        }} />
      <button type="button" disabled={!!busy} onClick={() => input.current?.click()} className={bigButton}>
        <Music size={22} className="shrink-0" aria-hidden />
        <span><b className="block">موسيقى أو صوت من جهازي</b><span className="text-xs text-fg-muted">تنحط عند المؤشر الأبيض، بصوت منخفض تحت الكلام</span></span>
      </button>
      {signedIn && (
        <button type="button" disabled={!!busy} onClick={() => setLibrary(true)} className={bigButton}>
          <Clapperboard size={22} className="shrink-0" aria-hidden />
          <span><b className="block">من مكتبة عيون المخرج</b><span className="text-xs text-fg-muted">الأصوات التي ولّدتها أو حفظتها</span></span>
        </button>
      )}
      <Recorder onDone={async (file, start) => { const r = await importAudio([file], start); setNote(added(r.placed, r.failed)); }} />
      {library && <HawshLibraryDialog onClose={() => setLibrary(false)} onAdded={async (ids) => { const n = await placeAudio(ids, playheadNow()); setNote(n ? "أُضيف الصوت عند المؤشر الأبيض." : "اختر ملفاً صوتياً."); }} />}

      <Row label="صوت الفيديو الأصلي">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!!busy} className={`${chip} ${!muted ? chipOn : chipOff} py-2.5`} onClick={() => void run("", () => muteOriginal(false))}>مسموع</button>
          <button type="button" disabled={!!busy} className={`${chip} ${muted ? chipOn : chipOff} py-2.5`} onClick={() => void run("", () => muteOriginal(true))}>مكتوم</button>
        </div>
      </Row>

      {clip && audible && (
        <Row label={target && target.index > 0 ? `على اللقطة ${target.index}` : "على اللقطة المحددة"}>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!!busy} className={`${chip} ${hasNoiseReduction(clip) ? chipOn : chipOff} py-2.5`}
              onClick={() => void run("", () => setNoiseReduction(clip.id, !hasNoiseReduction(clip)))}>إزالة الضجيج</button>
            <button type="button" disabled={!!busy} className={`${chip} ${(clip.fade?.fadeIn ?? 0) > 0 ? chipOn : chipOff} py-2.5`}
              onClick={() => { const f = (clip.fade?.fadeIn ?? 0) > 0 ? 0 : Math.min(AUDIO_FADE, clip.duration / 4); void run("", () => setAudioFade(clip.id, f, f)); }}>تلاشي الصوت</button>
          </div>
          <p className="text-[11px] text-fg-muted">مستوى صوت اللقطة: اضغط عليها في الخط الزمني ثم «صوت».</p>
        </Row>
      )}
      {busy && <p className="text-center text-xs text-fg-muted" role="status">{busy}</p>}
      <Note text={note} />
    </div>
  );
};

/* ------------------------------------------------------------------ edit */

export const EditSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { project, target } = useTarget();
  const select = useUIStore((s) => s.select);
  const [plan, setPlan] = useState<SilencePlan | "finding" | "cutting" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useNote();
  const clip = target?.clip;
  const isVideo = clip && mediaType(project, clip.mediaId) === "video";

  const find = async () => {
    setPlan("finding");
    const p = await planSilenceEverywhere();
    setPlan(p);
  };

  return (
    <div className="space-y-3">
      {clip ? (
        <button type="button" className={bigButton} onClick={() => { select({ type: "clip", id: clip.id, trackId: clip.trackId }); onClose(); }}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 font-bold text-primary">{target?.index || "•"}</span>
          <span><b className="block">عدّل اللقطة {target?.index || ""}</b><span className="text-xs text-fg-muted">تقسيم، قص، سرعة، صوت، مؤثرات…</span></span>
        </button>
      ) : <p className="py-4 text-center text-sm text-fg-muted">أضف فيديو أولاً من زر + في الخط الزمني.</p>}

      {clip && (
        <Row label="قص السكتات من كل اللقطات">
          {plan === null && <button type="button" className={`${chip} ${chipOff} w-full py-2.5`} onClick={() => void find()}>دوّر على السكتات</button>}
          {plan === "finding" && <p className="text-center text-xs text-fg-muted">أدوّر على السكتات…</p>}
          {plan === "cutting" && <p className="text-center text-xs text-fg-muted">أقص السكتات…</p>}
          {plan && typeof plan === "object" && (plan.clips.length ? (
            <div className="space-y-2">
              <p className="text-xs">لقيت سكتات مجموعها {plan.seconds} ثانية في {plan.clips.length} {plan.clips.length === 1 ? "لقطة" : "لقطات"}.</p>
              <button type="button" className={primaryButton} onClick={() => {
                const p = plan; setPlan("cutting");
                void cutSilenceEverywhere(p).then((err) => { setPlan(null); setNote(err ?? `قُصّت ${p.seconds} ثانية.`); });
              }}>قصها كلها</button>
            </div>
          ) : <p className="text-center text-xs text-fg-muted">ما لقيت سكتات.{plan.skipped ? ` (${plan.skipped} لقطة ما قدرت أقرأ صوتها)` : ""}</p>)}
        </Row>
      )}

      {clip && isVideo && (
        <Row label="اتجاه التشغيل">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} className={`${chip} ${!clip.reversed ? chipOn : chipOff} py-2.5`} onClick={() => { setBusy(true); void setReversed(clip.id, false).then(setNote).finally(() => setBusy(false)); }}>عادي</button>
            <button type="button" disabled={busy} className={`${chip} ${clip.reversed ? chipOn : chipOff} py-2.5`} onClick={() => { setBusy(true); void setReversed(clip.id, true).then(setNote).finally(() => setBusy(false)); }}>معكوس</button>
          </div>
        </Row>
      )}
      <p className="text-[11px] text-fg-muted">نصيحة: اضغط على أي لقطة في الخط الزمني لتظهر أدواتها مباشرة.</p>
      <Note text={note} />
    </div>
  );
};

/* ------------------------------------------------------------------ more */

export const MoreSheet: React.FC<{ onOpenAssistant: () => void }> = ({ onOpenAssistant }) => {
  const project = useProjectStore((s) => s.project);
  const { navigate } = useRouter();
  const [view, setView] = useState<"menu" | "guide" | "report">("menu");
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useNote();
  const draftBefore = useRef("");
  const format = currentFormat(project.settings);

  if (view === "guide") {
    return (
      <div className="flex max-h-[55vh] flex-col">
        <AssistantGuide onClose={() => { if (useChatStore.getState().draft !== draftBefore.current) onOpenAssistant(); else setView("menu"); }} />
      </div>
    );
  }
  if (view === "report") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">اكتب وش صار، ووش كنت تحاول تسوي. نرسل معها حالة المشروع (بدون ملفاتك).</p>
        <textarea value={report} onChange={(e) => setReport(e.target.value)} rows={4} dir="auto" placeholder="مثال: ضغطت تصدير وعلّق عند 50%"
          className="w-full rounded-xl border border-border bg-bg-1 p-3 text-sm outline-none focus:border-primary" />
        <button type="button" className={primaryButton} disabled={!report.trim()} onClick={() => {
          const tracks = project.timeline.tracks.map((t) => ({ type: t.type, clips: t.clips.length }));
          logEvent("error", { source: "user-report", message: report.trim().slice(0, 1000), device: "phone", duration: project.timeline.duration, width: project.settings.width, height: project.settings.height, tracks });
          setReport(""); setView("menu"); setNote("وصلتنا ملاحظتك، شكراً لك.");
        }}>أرسل</button>
        <button type="button" className={`${chip} ${chipOff} w-full py-2.5`} onClick={() => setView("menu")}>رجوع</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Row label="المظهر">
        <AppearancePicker />
      </Row>
      <Row label="مقاس الفيديو">
        <div className="grid grid-cols-2 gap-2">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" disabled={busy} onClick={() => { setBusy(true); void setFormat(f.id).then((err) => setNote(err ?? `صار المقاس ${f.label} ${f.id}.`)).finally(() => setBusy(false)); }}
              className={`rounded-xl border p-3 text-start ${format?.id === f.id ? chipOn : chipOff}`}>
              <b className="block text-sm">{f.label} <span className="font-mono text-xs" dir="ltr">{f.id}</span></b>
              <span className="text-[11px] opacity-80">{f.hint}</span>
            </button>
          ))}
        </div>
      </Row>
      <div className="space-y-2">
        <button type="button" className={bigButton} onClick={() => { draftBefore.current = useChatStore.getState().draft; setView("guide"); }}>
          <span className="text-lg" aria-hidden>💡</span><span><b className="block">دليل المساعد</b><span className="text-xs text-fg-muted">وش تقدر تطلب منه، بأمثلة</span></span>
        </button>
        {!SKIP_WELCOME && (
          <button type="button" className={bigButton} onClick={() => navigate("welcome")}>
            <span className="text-lg" aria-hidden>🗂️</span><span><b className="block">مشاريعي</b><span className="text-xs text-fg-muted">مشروعك محفوظ تلقائياً</span></span>
          </button>
        )}
        <button type="button" className={bigButton} onClick={() => setView("report")}>
          <span className="text-lg" aria-hidden>🛟</span><span><b className="block">أبلغ عن مشكلة</b><span className="text-xs text-fg-muted">تصلنا مباشرة لنصلحها</span></span>
        </button>
      </div>
      <Note text={note} />
    </div>
  );
};

/* ------------------------------------------------------------------ captions */

export const CaptionsSheet: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const captionClip = useTimelineStore((s) => captionClipId(project, s.playheadPosition));
  const has = captionClips(project).length > 0;
  const [tab, setTab] = useState<"make" | "style">(has ? "style" : "make");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`${chip} ${tab === "make" ? chipOn : chipOff} py-2`} onClick={() => setTab("make")}>ترجمة تلقائية</button>
        <button type="button" className={`${chip} ${tab === "style" ? chipOn : chipOff} py-2`} onClick={() => setTab("style")}>شكل الترجمة</button>
      </div>
      {tab === "make"
        ? <ServerCaptionPanel clipId={captionClip} buttonLabel="فرّغ المقطع اللي تحت المؤشر" emptyHint="أضف فيديو فيه كلام أولاً." />
        : <CaptionStyleEditor />}
    </div>
  );
};
