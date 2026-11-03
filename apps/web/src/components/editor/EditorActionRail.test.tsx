import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
