/**
 * Theme and colour controls (Hawsh Khalifa build): a one-tap dark/light switch for the editor's top bar
 * and the start page, and the full choice (dark, light, like the device; accent colour) in "More".
 */
import React from "react";
import { Moon, Sun } from "lucide-react";
import { useThemeStore, type ThemeMode } from "../stores/theme-store";
import { ACCENTS, useAccentStore } from "./appearance";
import { chipOff, chipOn } from "./mobile/ui";

/** Dark ↔ light in one tap. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const isDark = useThemeStore((s) => s.isDark);
  const setMode = useThemeStore((s) => s.setMode);
  const label = isDark ? "الوضع الفاتح" : "الوضع الداكن";
  return (
    <button type="button" aria-label={label} title={label} onClick={() => setMode(isDark ? "light" : "dark")}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${className}`}>
      {isDark ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
    </button>
  );
};

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "داكن" },
  { id: "light", label: "فاتح" },
  { id: "auto", label: "حسب الجهاز" },
];

/** The "Appearance" section of the More sheet. */
export const AppearancePicker: React.FC = () => {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const accent = useAccentStore((s) => s.accent);
  const setAccent = useAccentStore((s) => s.setAccent);
  return (
    <div className="space-y-3" data-testid="appearance">
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}
            className={`rounded-full border px-3 py-2 text-xs font-semibold ${mode === m.id ? chipOn : chipOff}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {ACCENTS.map((a) => (
          <button key={a.id} type="button" aria-label={`لون ${a.label}`} aria-pressed={accent === a.id} onClick={() => setAccent(a.id)}
            className="flex flex-col items-center gap-1 text-[11px] text-fg">
            <span className={`h-9 w-9 rounded-full border-2 ${accent === a.id ? "border-fg ring-2 ring-offset-2 ring-offset-bg" : "border-transparent"}`}
              style={{ background: a.hex, ["--tw-ring-color" as string]: a.hex }} />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
};
