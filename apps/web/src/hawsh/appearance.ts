/**
 * Appearance (Hawsh Khalifa build): dark or light, and the accent colour of buttons, selection and
 * highlights. The theme mode lives in the theme store (stores/theme-store.ts); the accent here. Both are
 * remembered in this browser. Dark with Director's Eyes gold is the default.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Accent {
  id: string;
  label: string;
  /** The colour itself. */
  hex: string;
  /** Same colour as "h s% l%" for the shadcn-style hsl tokens (--primary, --ring). */
  hsl: string;
  /** Text on the colour: dark on light colours, white on dark ones. */
  onHsl: string;
  onHex: string;
}

export const ACCENTS: Accent[] = [
  { id: "gold", label: "ذهبي", hex: "#f8c61c", hsl: "46 94% 54%", onHsl: "0 0% 8%", onHex: "#141414" },
  { id: "orange", label: "برتقالي", hex: "#f97316", hsl: "25 95% 53%", onHsl: "0 0% 8%", onHex: "#141414" },
  { id: "pink", label: "وردي", hex: "#ec4899", hsl: "330 81% 60%", onHsl: "0 0% 100%", onHex: "#ffffff" },
  { id: "purple", label: "بنفسجي", hex: "#8b5cf6", hsl: "258 90% 66%", onHsl: "0 0% 100%", onHex: "#ffffff" },
  { id: "blue", label: "أزرق", hex: "#3b82f6", hsl: "217 91% 60%", onHsl: "0 0% 100%", onHex: "#ffffff" },
  { id: "green", label: "أخضر", hex: "#10b981", hsl: "160 84% 39%", onHsl: "0 0% 100%", onHex: "#ffffff" },
];

export const DEFAULT_ACCENT = "gold";

export const accentById = (id: string | undefined) => ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];

/**
 * The CSS that paints the accent. `:root:root` and `:root .dark` outrank the `.dark` blocks in
 * index.css (which set gold), so the choice wins in both themes and inside the editor's own `.dark`.
 */
export function accentCss(accent: Accent): string {
  return `:root:root, :root .dark, :root [data-theme] {
  --primary: ${accent.hsl};
  --primary-foreground: ${accent.onHsl};
  --ring: ${accent.hsl};
  --accent: ${accent.hex};
  --accent-strong: color-mix(in srgb, ${accent.hex} 85%, black);
  --accent-soft: color-mix(in srgb, ${accent.hex} 20%, transparent);
  --accent-fg: ${accent.onHex};
  --accent-glow: color-mix(in srgb, ${accent.hex} 45%, transparent);
  --selected: color-mix(in srgb, ${accent.hex} 25%, transparent);
}`;
}

/** Puts the accent on the page (one <style> element, replaced on change). */
export function applyAccent(id: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById("hawsh-accent") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "hawsh-accent";
    document.head.appendChild(el);
  }
  el.textContent = accentCss(accentById(id));
}

interface AccentState { accent: string; setAccent: (id: string) => void }

export const useAccentStore = create<AccentState>()(
  persist(
    (set) => ({
      accent: DEFAULT_ACCENT,
      setAccent: (id) => { const a = accentById(id).id; set({ accent: a }); applyAccent(a); },
    }),
    {
      name: "hawsh-accent",
      onRehydrateStorage: () => (state) => applyAccent(state?.accent ?? DEFAULT_ACCENT),
    },
  ),
);
