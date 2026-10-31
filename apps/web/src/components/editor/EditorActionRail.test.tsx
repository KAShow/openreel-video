import "../../test/install-local-storage-mock";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../../stores/theme-store";
import { EditorActionRail } from "./EditorActionRail";

describe("EditorActionRail", () => {
  afterEach(() => cleanup());

  it("has no theme switch: the editor is always dark (DARK_ONLY)", () => {
    render(<EditorActionRail />);
    expect(screen.queryByRole("button", { name: /^Theme:/ })).toBeNull();

    useThemeStore.getState().setMode("light");
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(useThemeStore.getState().isDark).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
