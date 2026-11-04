import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { SpeedControl } from "./ClipTools";

const clip = { id: "c1", inPoint: 0, outPoint: 10, speed: 1 } as unknown as Clip;

describe("phone SpeedControl", () => {
  it("exposes a 0.01-step slider from 0.1× to 5×", () => {
    render(<SpeedControl clip={clip} busy={false} onApply={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "السرعة" });
    expect(slider).toHaveAttribute("min", "0.1");
    expect(slider).toHaveAttribute("max", "5");
    expect(slider).toHaveAttribute("step", "0.01");
  });

  it("nudges by 0.01 with the + and − buttons", () => {
    const onApply = vi.fn();
    const { rerender } = render(<SpeedControl clip={clip} busy={false} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "أسرع 0.01" }));
    expect(onApply).toHaveBeenLastCalledWith(1.01);
    expect(screen.getByText("1.01×")).toBeInTheDocument();

    // The store updates the clip after the action runs.
    rerender(<SpeedControl clip={{ ...clip, speed: 1.01 } as Clip} busy={false} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "أبطأ 0.01" }));
    expect(onApply).toHaveBeenLastCalledWith(1);
  });

  it("commits the slider value when the finger lifts, not while dragging", () => {
    const onApply = vi.fn();
    render(<SpeedControl clip={clip} busy={false} onApply={onApply} />);
    const slider = screen.getByRole("slider", { name: "السرعة" });

    fireEvent.change(slider, { target: { value: "1.37" } });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("1.37×")).toBeInTheDocument();

    fireEvent.pointerUp(slider);
    expect(onApply).toHaveBeenCalledWith(1.37);
  });

  it("applies presets and shows the resulting clip length", () => {
    const onApply = vi.fn();
    render(<SpeedControl clip={clip} busy={false} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "2×" }));
    expect(onApply).toHaveBeenCalledWith(2);
    expect(screen.getByText(/مدة اللقطة/)).toHaveTextContent("10.0s");
    expect(screen.getByText(/مدة اللقطة/)).toHaveTextContent("5.00s");
  });
});
