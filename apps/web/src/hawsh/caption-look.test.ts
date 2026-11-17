import { describe, expect, it } from "vitest";
import { CAPTION_PRESETS, captionClips, defaultCaptionLook, defaultCaptionSize, lookOf, lookStyle } from "./caption-look";
import { GOOGLE_FONT_SPECS } from "../services/font-catalog";
import { CAPTION_FONTS } from "./caption-look";

const vertical = { width: 1080, height: 1920 };

describe("caption look", () => {
  it("gives new captions a size that reads on a phone, bold, outlined, above the app buttons", () => {
    expect(defaultCaptionSize(vertical)).toBe(65);
    expect(defaultCaptionSize({ width: 1920, height: 1080 })).toBe(65);
    const look = defaultCaptionLook(vertical);
    expect(look).toMatchObject({ fontFamily: "Cairo", fontWeight: 800, color: "#ffffff", outlineColor: "#000000", y: 0.72 });
    expect(look.outline).toBeGreaterThan(0);
    expect(defaultCaptionLook({ width: 1920, height: 1080 }).y).toBe(0.85);
  });

  it("turns a look into a text style and reads it back", () => {
    const look = { ...defaultCaptionLook(vertical), background: "rgba(0,0,0,0.75)", outline: 0 };
    const style = lookStyle(look);
    expect(style).toMatchObject({ fontSize: 65, strokeWidth: 0, strokeColor: undefined, backgroundColor: "rgba(0,0,0,0.75)", textAlign: "center", letterSpacing: 0 });
    const back = lookOf({ style: { ...style, fontStyle: "normal", verticalAlign: "middle", lineHeight: 1.2 } as never, transform: { position: { x: 0.5, y: 0.72 } } as never }, vertical);
    expect(back).toEqual(look);
  });

  it("keeps the size and position when a ready look is chosen", () => {
    const base = { ...defaultCaptionLook(vertical), fontSize: 90, y: 0.3 };
    for (const p of CAPTION_PRESETS) expect(p.look(base)).toMatchObject({ fontSize: 90, y: 0.3 });
  });

  it("finds caption lines by their track or their source", () => {
    const project = {
      timeline: { tracks: [{ id: "cap", role: "captions", name: "Captions" }, { id: "txt", name: "Text" }] },
      textClips: [
        { id: "2", trackId: "cap", startTime: 4 },
        { id: "title", trackId: "txt", startTime: 0 },
        { id: "1", trackId: "txt", startTime: 1, metadata: { captionSource: "whisper" } },
      ],
    } as never;
    expect(captionClips(project).map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("offers only fonts the editor can load", () => {
    for (const f of CAPTION_FONTS) expect(GOOGLE_FONT_SPECS[f.family]).toBeTruthy();
  });
});
