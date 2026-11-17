import "../test/install-local-storage-mock";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ACCENTS, accentById, accentCss, useAccentStore } from "./appearance";
import { AppearancePicker, ThemeToggle } from "./AppearanceControls";
import { useThemeStore } from "../stores/theme-store";

afterEach(() => { cleanup(); useThemeStore.getState().setMode("dark"); useAccentStore.getState().setAccent("gold"); });

describe("appearance", () => {
  it("starts dark with Director's Eyes gold", () => {
    expect(useThemeStore.getState().isDark).toBe(true);
    expect(useAccentStore.getState().accent).toBe("gold");
    expect(accentById("nope").id).toBe("gold");
  });

  it("switches dark and light in one tap", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "الوضع الفاتح" }));
    expect(useThemeStore.getState().isDark).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "الوضع الداكن" }));
    expect(useThemeStore.getState().isDark).toBe(true);
  });

  it("paints the chosen colour over the gold defaults, and remembers it", () => {
    render(<AppearancePicker />);
    fireEvent.click(screen.getByRole("button", { name: "لون أزرق" }));
    expect(useAccentStore.getState().accent).toBe("blue");
    const css = document.getElementById("hawsh-accent")?.textContent ?? "";
    expect(css).toContain("--accent: #3b82f6");
    expect(css).toContain("--primary: 217 91% 60%");
    expect(css.startsWith(":root:root, :root .dark")).toBe(true);
    expect(localStorage.getItem("hawsh-accent")).toContain("blue");
    fireEvent.click(screen.getByRole("button", { name: "حسب الجهاز" }));
    expect(useThemeStore.getState().mode).toBe("auto");
  });

  it("gives every colour readable text on it", () => {
    for (const a of ACCENTS) {
      expect(accentCss(a)).toContain(`--accent-fg: ${a.onHex}`);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const on = a.onHex === "#ffffff" ? 1 : 0.0074;
      const ratio = (Math.max(lum, on) + 0.05) / (Math.min(lum, on) + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(2.5);
    }
  });
});
