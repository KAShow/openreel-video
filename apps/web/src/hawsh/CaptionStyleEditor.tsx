/**
 * "شكل الترجمة": size, colour, font, outline, background and position of the captions — all lines at
 * once, or only one line (or one text clip) when `clipId` is given. Every change is one undo step and
 * shows in the preview at once. Used in the phone captions sheet, the phone text tools and the
 * desktop captions panel.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../stores/project-store";
import { chip, chipOff as off, chipOn as on, Row, Slider } from "./mobile/ui";
import { ensureFontFamily } from "../services/project-fonts";
import {
  CAPTION_COLORS, CAPTION_FONTS, CAPTION_PRESETS, captionClips, captionSizeRange, defaultCaptionLook, defaultCaptionY, isCaption, lookOf,
  type CaptionLook,
} from "./caption-look";
import { applyCaptionLook } from "./caption-apply";

export const CaptionStyleEditor: React.FC<{ clipId?: string }> = ({ clipId }) => {
  const project = useProjectStore((s) => s.project);
  const settings = project.settings;
  const captions = useMemo(() => captionClips(project), [project]);
  const single = clipId ? (project.textClips ?? []).find((c) => c.id === clipId) : undefined;
  const singleIsCaption = !!single && isCaption(single, project);
  const [onlyThis, setOnlyThis] = useState(!!single && !singleIsCaption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { for (const f of CAPTION_FONTS) void ensureFontFamily(f.family, 700, f.label).catch(() => undefined); }, []);

  const targets = single && (onlyThis || !singleIsCaption) ? [single] : captions;
  const first = single ?? captions[0];
  if (!first) {
    return <p className="py-6 text-center text-sm text-fg-muted" dir="rtl" data-no-translate="">ما فيه ترجمة بعد. فرّغ الكلام أولاً، وبعدها غيّر شكلها من هنا.</p>;
  }
  const look = lookOf(first, settings);
  const range = captionSizeRange(settings);

  const apply = async (patch: Partial<CaptionLook>) => {
    setBusy(true); setError(null);
    try {
      const ok = await applyCaptionLook(targets.map((t) => t.id), { ...look, ...patch });
      if (!ok) setError("تعذّر تغيير بعض الأسطر.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" dir="rtl" data-no-translate="" data-testid="caption-style-editor">
      {single && singleIsCaption && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`${chip} ${!onlyThis ? on : off}`} onClick={() => setOnlyThis(false)}>كل الترجمة ({captions.length})</button>
          <button type="button" className={`${chip} ${onlyThis ? on : off}`} onClick={() => setOnlyThis(true)}>هذا السطر فقط</button>
        </div>
      )}
      {!single && <p className="text-xs text-fg-muted">التغيير على كل الترجمة ({captions.length} سطر). لتعديل كلام سطر، اضغط عليه في الخط الزمني.</p>}

      <Row label="شكل جاهز">
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {CAPTION_PRESETS.map((p) => {
            const l = p.look(look);
            return (
              <button key={p.id} type="button" disabled={busy} onClick={() => void apply(p.look(look))} aria-label={p.label}
                className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-border bg-neutral-700 px-3 py-2 active:scale-95 disabled:opacity-40">
                <span style={{ fontFamily: l.fontFamily, fontWeight: l.fontWeight, color: l.color, background: l.background || "transparent", WebkitTextStroke: l.outline ? `1px ${l.outlineColor}` : undefined, padding: "0 6px", borderRadius: 4, fontSize: 18 }}>أهلاً</span>
                <span className="text-[10px] text-white">{p.label}</span>
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="الحجم">
        <Slider label="الحجم" value={look.fontSize} min={range.min} max={range.max} step={1} disabled={busy} show={(v) => String(Math.round(v))}
          onCommit={(v) => void apply({ fontSize: Math.round(v), outline: look.outline ? Math.max(1, Math.round(v * (look.outline / look.fontSize))) : 0 })} />
        <div className="grid grid-cols-3 gap-2">
          {([["صغير", 0.7], ["متوسط", 1], ["كبير", 1.35]] as const).map(([label, k]) => {
            const size = Math.round(defaultCaptionLook(settings).fontSize * k);
            return <button key={label} type="button" disabled={busy} className={`${chip} ${Math.abs(look.fontSize - size) <= 1 ? on : off}`}
              onClick={() => void apply({ fontSize: size, outline: look.outline ? Math.max(1, Math.round(size * (look.outline / look.fontSize))) : 0 })}>{label}</button>;
          })}
        </div>
      </Row>

      <Row label="اللون">
        <div className="flex flex-wrap gap-2">
          {CAPTION_COLORS.map((c) => (
            <button key={c} type="button" disabled={busy} aria-label={`اللون ${c}`} onClick={() => void apply({ color: c })}
              className={`h-9 w-9 rounded-full border-2 active:scale-95 ${look.color.toLowerCase() === c ? "border-primary ring-2 ring-primary/40" : "border-[var(--line-strong)]"}`} style={{ background: c }} />
          ))}
          <label className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 border-dashed border-[var(--line-strong)] text-lg" aria-label="لون آخر">
            +
            <input type="color" className="sr-only" value={/^#[0-9a-f]{6}$/i.test(look.color) ? look.color : "#ffffff"} onChange={(e) => void apply({ color: e.target.value })} />
          </label>
        </div>
      </Row>

      <Row label="الخط">
        <div className="flex flex-wrap gap-2">
          {CAPTION_FONTS.map((f) => (
            <button key={f.family} type="button" disabled={busy} onClick={() => void apply({ fontFamily: f.family })}
              className={`${chip} ${look.fontFamily === f.family ? on : off}`} style={{ fontFamily: f.family }}>{f.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" disabled={busy} className={`${chip} ${look.fontWeight < 700 ? on : off}`} onClick={() => void apply({ fontWeight: 500 })}>عادي</button>
          <button type="button" disabled={busy} className={`${chip} ${look.fontWeight >= 700 ? on : off}`} onClick={() => void apply({ fontWeight: 800 })}>سميك</button>
        </div>
      </Row>

      <Row label="الحدود حول الحروف">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={`${chip} ${!look.outline ? on : off}`} onClick={() => void apply({ outline: 0 })}>بلا</button>
          {(["#000000", "#ffffff"] as const).map((c) => (
            <button key={c} type="button" disabled={busy} className={`${chip} ${look.outline && look.outlineColor.toLowerCase() === c ? on : off}`}
              onClick={() => void apply({ outline: look.outline || Math.max(2, Math.round(look.fontSize * 0.08)), outlineColor: c })}>{c === "#000000" ? "سوداء" : "بيضاء"}</button>
          ))}
        </div>
        {look.outline > 0 && (
          <Slider label="سماكة الحدود" value={look.outline} min={1} max={Math.max(4, Math.round(look.fontSize * 0.2))} step={1} disabled={busy} show={(v) => String(Math.round(v))}
            onCommit={(v) => void apply({ outline: Math.round(v) })} />
        )}
      </Row>

      <Row label="الخلفية">
        <div className="flex flex-wrap gap-2">
          {([["بلا", ""], ["سوداء", "rgba(0,0,0,0.75)"], ["بيضاء", "rgba(255,255,255,0.92)"], ["ملونة", "rgba(255,59,92,0.9)"]] as const).map(([label, bg]) => (
            <button key={label} type="button" disabled={busy} className={`${chip} ${look.background === bg ? on : off}`} onClick={() => void apply({ background: bg })}>{label}</button>
          ))}
        </div>
      </Row>

      <Row label="المكان">
        <div className="grid grid-cols-3 gap-2">
          {([["فوق", 0.15], ["الوسط", 0.5], ["تحت", defaultCaptionY(settings)]] as const).map(([label, y]) => (
            <button key={label} type="button" disabled={busy} className={`${chip} ${Math.abs(look.y - y) < 0.01 ? on : off}`} onClick={() => void apply({ y })}>{label}</button>
          ))}
        </div>
        <Slider label="المكان من فوق لتحت" value={look.y} min={0.05} max={0.95} step={0.01} disabled={busy} show={(v) => `${Math.round(v * 100)}%`}
          onCommit={(v) => void apply({ y: Math.round(v * 100) / 100 })} />
      </Row>

      {error && <p className="text-center text-xs text-red-400" role="status">{error}</p>}
    </div>
  );
};

export default CaptionStyleEditor;
