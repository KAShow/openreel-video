import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolcraftSliderControl } from "@openreel/ui";

describe("ToolcraftSliderControl", () => {
  it("commits edited percent labels back to normalized slider values", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftSliderControl
        label="Opacity"
        value={0.5}
        onChange={onChange}
        min={0}
        max={1}
        step={0.01}
        formatValue={(value) => `${Math.round(value * 100)}%`}
      />,
    );

    expect(screen.getByRole("slider", { name: "Opacity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Opacity value" }));
    const input = screen.getByRole("textbox", { name: "Opacity value" });
    fireEvent.change(input, { target: { value: "25%" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(0.25);
  });

  it("reports a committed value on keyboard step, snapped to the 0.01 step", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    render(
      <ToolcraftSliderControl
        label="Speed"
        value={1}
        onChange={onChange}
        onCommit={onCommit}
        min={0.1}
        max={5}
        step={0.01}
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Speed" }), {
      key: "ArrowRight",
    });

    expect(onChange).toHaveBeenCalledWith(1.01);
    expect(onCommit).toHaveBeenCalledWith(1.01);
  });
});
