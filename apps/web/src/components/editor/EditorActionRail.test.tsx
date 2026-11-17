import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../../stores/theme-store";
import { EditorActionRail } from "./EditorActionRail";

describe("EditorActionRail", () => {
  afterEach(() => cleanup());

  it("switches between dark and light (the theme switch is back since 2026-11-17)", () => {
    useThemeStore.getState().setMode("light");
    expect(useThemeStore.getState().isDark).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    useThemeStore.getState().setMode("dark");
    expect(useThemeStore.getState().isDark).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps only settings and the editor tour in the simple more menu", async () => {
    render(<EditorActionRail />);
    expect(screen.getByRole("button", { name: "AI Editor chat" })).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "More editor actions" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Editor tour")).toBeInTheDocument();
    expect(screen.queryByText("Animation & effects tour")).toBeNull();
    expect(screen.queryByText("Help & shortcuts (press ?)")).toBeNull();
    expect(screen.queryByText("Cmd+K to search")).toBeNull();
  });
});
