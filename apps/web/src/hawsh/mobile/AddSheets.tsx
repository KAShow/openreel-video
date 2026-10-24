/**
 * Phone editor sheets for adding things (stage 4): writing a text, and the "+" button that opens the
 * Director's Eyes library and puts the picked items at the end of the main track.
 */
import React, { useState } from "react";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { HAWSH_EDITOR_PAGE } from "../config";
import { HawshLibraryDialog } from "../HawshLibrary";
import { useHawshStore } from "../session";
import { addText, appendToTimeline } from "./add-tools";

const field = "w-full resize-none rounded-xl border border-border bg-bg-1 p-3 text-base leading-relaxed outline-none focus:border-primary";
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

/** Big "+" over the timeline: the library when signed in, otherwise how to sign in. */
export const AddMediaButton: React.FC = () => {
  const status = useHawshStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  return (
    <>
      <button type="button" aria-label="أضف من مكتبة عيون المخرج" data-testid="add-media"
        onClick={() => (status === "ready" ? setOpen(true) : setHint(true))}
        className="absolute end-3 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-2xl bg-white text-3xl font-light leading-none text-black shadow-lg active:scale-95">
        +
      </button>
      {open && <HawshLibraryDialog onClose={() => setOpen(false)} onAdded={async (ids) => { await appendToTimeline(ids); }} />}
      {hint && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => setHint(false)}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} dir="rtl" data-no-translate=""
            className="space-y-3 rounded-t-2xl border-t border-border bg-bg p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <p className="text-sm">{status === "connecting" ? "جارٍ الاتصال بعيون المخرج…" : "المكتبة تشتغل لما تفتح المحرر من عيون المخرج."}</p>
            {status !== "connecting" && <a href={HAWSH_EDITOR_PAGE} className={`${primary} block text-center`}>افتح عيون المخرج</a>}
          </div>
        </div>
      )}
    </>
  );
};
