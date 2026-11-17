import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DARK_ONLY } from "../hawsh/simple";

export type ThemeMode = "light" | "dark" | "auto";

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const calculateIsDark = (mode: ThemeMode): boolean => {
  if (DARK_ONLY) return true;
  if (mode === "auto") {
    return getSystemTheme() === "dark";
  }
  return mode === "dark";
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Hawsh Khalifa build: dark by default, light on request (src/hawsh/appearance.ts).
      mode: "dark",
      isDark: true,

      setMode: (requested: ThemeMode) => {
        const mode = DARK_ONLY ? "dark" : requested;
        const isDark = calculateIsDark(mode);
        set({ mode, isDark });

        if (isDark) {
          document.documentElement.classList.add("dark");
          document.documentElement.dataset.theme = "dark";
        } else {
          document.documentElement.classList.remove("dark");
          document.documentElement.dataset.theme = "light";
        }
      },

      toggleTheme: () => {
        const currentMode = get().mode;
        const nextMode: ThemeMode =
          currentMode === "light"
            ? "dark"
            : currentMode === "dark"
              ? "auto"
              : "light";
        get().setMode(nextMode);
      },
    }),
    {
      // New key (2026-11-17): a "light" left in "openreel-theme" from before the dark-only months must
      // not switch anyone to light now that the switch is back.
      name: "hawsh-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (DARK_ONLY) state.mode = "dark";
          const isDark = calculateIsDark(state.mode);
          state.isDark = isDark;
          if (isDark) {
            document.documentElement.classList.add("dark");
            document.documentElement.dataset.theme = "dark";
          } else {
            document.documentElement.classList.remove("dark");
            document.documentElement.dataset.theme = "light";
          }
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  mediaQuery.addEventListener("change", (e) => {
    const state = useThemeStore.getState();
    if (state.mode === "auto") {
      const isDark = e.matches;
      useThemeStore.setState({ isDark });

      if (isDark) {
        document.documentElement.classList.add("dark");
        document.documentElement.dataset.theme = "dark";
      } else {
        document.documentElement.classList.remove("dark");
        document.documentElement.dataset.theme = "light";
      }
    }
  });
}
