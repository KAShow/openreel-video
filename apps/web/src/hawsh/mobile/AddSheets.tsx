/**
 * Phone editor sheets for adding things (stage 4): writing a text, and the "+" button that adds files
 * from the phone or the Director's Eyes library at the end of the main track.
 */
import React, { useRef, useState } from "react";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { HAWSH_EDITOR_PAGE } from "../config";
import { HawshLibraryDialog } from "../HawshLibrary";
import { useHawshStore } from "../session";
import { addText, appendToTimeline, importFiles } from "./add-tools";

const field = "w-full resize-none rounded-xl border border-border bg-bg-1 p-3 text-base leading-relaxed outline-none focus:border-primary";
const option = "flex w-full items-center gap-3 rounded-xl border border-border bg-bg-1 p-3 text-start text-sm active:bg-bg-2 disabled:opacity-40";
const primary = "w-full rounded-xl bg-primary py-3 text-sm font-bold text-white disabled:opacity-40";

/** Text box + "add": the text goes on the timeline at the playhead and is selected. */
export const TextComposer: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const select = useUIStore((s) => s.select);
  const add = async () => {
    setBusy(true);
    try {
      const created = await addText(text, useTimelineStore.getState().playheadPosition);
      if (created) { select({ type: "text-clip", id: created.id, trackId: created.trackId }); onDone(); }
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3" dir="rtl" data-no-translate="">
      <textarea className={field} rows={3} dir="auto" placeholder="اكتب النص هنا" value={text} autoFocus
        onChange={(e) => setText(e.target.value)} aria-label="النص" />
      <p className="text-xs text-fg-muted">يُضاف عند المؤشر الأبيض لمدة 3 ثوانٍ، وتقدر تقصّه أو تعدّله بعدين.</p>
      <button type="button" className={primary} disabled={!text.trim() || busy} onClick={() => void add()}>أضف النص</button>
    </div>
  );
};

/** Text editor for a selected text clip. */
export const TextEditor: React.FC<{ initial: string; onSave: (text: string) => void }> = ({ initial, onSave }) => {
  const [text, setText] = useState(initial);
  return (
    <div className="space-y-3">
      <textarea className={field} rows={3} dir="auto" value={text} autoFocus onChange={(e) => setText(e.target.value)} aria-label="النص" />
      <button type="button" className={primary} disabled={!text.trim() || text.trim() === initial.trim()} onClick={() => onSave(text)}>حفظ</button>
    </div>
  );
};

/** Big "+" over the timeline: add from the phone (gallery, files, camera) or the Director's Eyes library. */
export const AddMediaButton: React.FC = () => {
  const status = useHawshStore((s) => s.status);
  const [menu, setMenu] = useState(false);
  const [library, setLibrary] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (input.current) input.current.value = "";
    if (!list.length) return;
    setBusy(list.length === 1 ? "جارٍ إضافة الملف…" : `جارٍ إضافة ${list.length} ملفات…`);
    try {
      const res = await importFiles(list);
      setBusy(res.failed ? `تعذّرت إضافة ${res.failed} من ${list.length}.` : null);
      if (!res.failed) setMenu(false);
    } catch {
      setBusy("تعذّرت الإضافة، حاول مرة ثانية.");
    }
  };

  return (
    <>
      <button type="button" aria-label="أضف فيديو أو صورة" data-testid="add-media" onClick={() => { setBusy(null); setMenu(true); }}
        className="absolute end-3 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-2xl bg-white text-3xl font-light leading-none text-black shadow-lg active:scale-95">
        +
      </button>
      <input ref={input} type="file" accept="video/*,image/*,audio/*" multiple hidden data-testid="add-media-file"
        onChange={(e) => void onFiles(e.target.files)} />
      {library && <HawshLibraryDialog onClose={() => setLibrary(false)} onAdded={async (ids) => { await appendToTimeline(ids); }} />}
      {menu && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => setMenu(false)}>
          <div role="dialog" aria-modal="true" aria-label="إضافة" onClick={(e) => e.stopPropagation()} dir="rtl" data-no-translate=""
            className="space-y-2 rounded-t-2xl border-t border-border bg-bg p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button type="button" className={option} disabled={!!busy && busy.startsWith("جارٍ")} onClick={() => input.current?.click()}>
              <span className="text-2xl" aria-hidden>📱</span><span><b className="block">من جهازي</b><span className="text-xs text-fg-muted">فيديو أو صورة أو صوت من الألبوم أو الملفات</span></span>
            </button>
            {status === "ready" ? (
              <button type="button" className={option} onClick={() => { setMenu(false); setLibrary(true); }}>
                <span className="text-2xl" aria-hidden>🎬</span><span><b className="block">من مكتبة عيون المخرج</b><span className="text-xs text-fg-muted">توليداتك ومراجعك</span></span>
              </button>
            ) : (
              <a href={HAWSH_EDITOR_PAGE} className={option}>
                <span className="text-2xl" aria-hidden>🎬</span><span><b className="block">مكتبة عيون المخرج</b><span className="text-xs text-fg-muted">{status === "connecting" ? "جارٍ الاتصال…" : "تشتغل لما تفتح المحرر من عيون المخرج"}</span></span>
              </a>
            )}
            {busy && <p className="pt-1 text-center text-sm text-fg-muted" role="status">{busy}</p>}
          </div>
        </div>
      )}
    </>
  );
};
