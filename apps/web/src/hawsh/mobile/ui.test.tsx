import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ wide: false }));
vi.mock("./phone", () => ({ useWideEditor: () => h.wide }));

import { Sheet, useSidePanelOpen } from "./ui";

const Probe = () => <span data-testid="room">{useSidePanelOpen() ? "room" : "none"}</span>;

afterEach(() => { cleanup(); h.wide = false; });

describe("tool sheet", () => {
  it("is a bottom sheet on phones that closes when tapping outside", () => {
    const onClose = vi.fn();
    const { container } = render(<><Probe /><Sheet title="انتقالات" onClose={onClose}>محتوى</Sheet></>);
    expect(screen.getByRole("dialog", { name: "انتقالات" }).tagName).toBe("DIV");
    expect(screen.getByTestId("room").textContent).toBe("none");
    fireEvent.click(container.querySelector(".fixed.inset-0")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("is a side panel on computers, and the editor makes room for it while it is open", () => {
    h.wide = true;
    const { rerender } = render(<><Probe /><Sheet title="مؤثرات" onClose={() => undefined}>محتوى</Sheet></>);
    expect(screen.getByRole("dialog", { name: "مؤثرات" }).tagName).toBe("ASIDE");
    expect(screen.getByTestId("room").textContent).toBe("room");
    rerender(<Probe />);
    expect(screen.getByTestId("room").textContent).toBe("none");
  });

  it("has one close button: its own, or the content's when bare", () => {
    render(<Sheet title="صوت" onClose={() => undefined}>محتوى</Sheet>);
    expect(screen.getAllByRole("button", { name: "إغلاق" })).toHaveLength(1);
    cleanup();
    render(<Sheet bare title="مساعد" onClose={() => undefined}><button type="button" aria-label="Close">x</button></Sheet>);
    expect(screen.queryByRole("button", { name: "إغلاق" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "مساعد" }).hasAttribute("data-no-translate")).toBe(false);
  });
});
