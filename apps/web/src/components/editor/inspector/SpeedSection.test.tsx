import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { SpeedSection } from "./SpeedSection";

// The speed engine is a singleton keyed by clip id, so each test needs its own clip.
let clipCounter = 0;
const makeClip = () =>
  ({
    id: `speed-test-clip-${clipCounter++}`,
    mediaId: "media-1",
    inPoint: 0,
    outPoint: 10,
    duration: 10,
  }) as unknown as Clip;

describe("SpeedSection", () => {
  it("offers a 0.01-step slider and a numeric field", () => {
    render(<SpeedSection clip={makeClip()} />);

    const slider = screen.getByRole("slider", { name: "Speed" });
    expect(slider).toHaveAttribute("aria-valuemin", "0.1");
    expect(slider).toHaveAttribute("aria-valuemax", "5");
    expect(screen.getByRole("textbox", { name: /Custom Speed/ })).toBeInTheDocument();
  });

  it("clamps typed speeds to the engine range and tells the user", () => {
    render(<SpeedSection clip={makeClip()} />);

    const input = screen.getByRole("textbox", { name: /Custom Speed/ });
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);

    expect(input).toHaveValue("20");
    expect(screen.getByText("Value adjusted to the allowed range")).toBeInTheDocument();
    expect(screen.getByText(/Clip length:/)).toHaveTextContent("10.0s");
    expect(screen.getByText(/Clip length:/)).toHaveTextContent("0.50s");
  });

  it("rejects non-numeric input and restores the previous value", () => {
    render(<SpeedSection clip={makeClip()} />);

    const input = screen.getByRole("textbox", { name: /Custom Speed/ });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input).toHaveValue("1");
    expect(screen.getByText("Enter a number such as 1.25")).toBeInTheDocument();
  });
});
