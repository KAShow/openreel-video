import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/** Clicks and lets the async apply finish (the editor is disabled while it runs). */
const tap = async (name: string, index = 0) => { await act(async () => { fireEvent.click(screen.getAllByRole("button", { name })[index]); }); };

const h = vi.hoisted(() => ({ apply: vi.fn(async () => true), project: null as unknown }));
vi.mock("../stores/project-store", () => ({ useProjectStore: (sel: (s: unknown) => unknown) => sel({ project: h.project }) }));
vi.mock("./caption-apply", () => ({ applyCaptionLook: h.apply }));
vi.mock("../services/project-fonts", () => ({ ensureFontFamily: vi.fn(async () => undefined) }));

import { CaptionStyleEditor } from "./CaptionStyleEditor";

const line = (id: string, start: number, extra: object = {}) => ({
  id, trackId: "cap", startTime: start, duration: 2, text: "سطر",
  style: { fontFamily: "Cairo", fontSize: 65, fontWeight: 800, color: "#ffffff", strokeColor: "#000000", strokeWidth: 5 },
  transform: { position: { x: 0.5, y: 0.72 } }, ...extra,
});

beforeEach(() => {
  h.apply.mockClear();
  h.project = {
    settings: { width: 1080, height: 1920 },
    timeline: { tracks: [{ id: "cap", role: "captions", name: "Captions" }, { id: "txt", name: "Text" }] },
    textClips: [line("a", 0), line("b", 2), { ...line("title", 0), trackId: "txt" }],
  };
});

describe("caption style editor", () => {
  it("changes every caption line at once, keeping the rest of the look", async () => {
    render(<CaptionStyleEditor />);
    await tap("اللون #ffe600");
    expect(h.apply).toHaveBeenCalledWith(["a", "b"], expect.objectContaining({ color: "#ffe600", fontSize: 65, fontFamily: "Cairo", y: 0.72 }));
    await tap("فوق");
    expect(h.apply).toHaveBeenLastCalledWith(["a", "b"], expect.objectContaining({ y: 0.15 }));
    await tap("كبير");
    expect(h.apply).toHaveBeenLastCalledWith(["a", "b"], expect.objectContaining({ fontSize: 88 }));
  });

  it("can change only the line that was tapped", async () => {
    render(<CaptionStyleEditor clipId="b" />);
    await tap("هذا السطر فقط");
    await tap("تجوّل");
    expect(h.apply).toHaveBeenLastCalledWith(["b"], expect.objectContaining({ fontFamily: "Tajawal" }));
  });

  it("styles a plain text clip on its own", async () => {
    render(<CaptionStyleEditor clipId="title" />);
    expect(screen.queryByRole("button", { name: "هذا السطر فقط" })).toBeNull();
    await tap("سوداء", 0);
    expect(h.apply).toHaveBeenLastCalledWith(["title"], expect.anything());
  });

  it("says what to do when there are no captions yet", async () => {
    h.project = { ...(h.project as object), textClips: [] };
    render(<CaptionStyleEditor />);
    expect(screen.getByText(/ما فيه ترجمة بعد/)).toBeTruthy();
  });
});
