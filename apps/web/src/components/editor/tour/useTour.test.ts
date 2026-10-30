import "../../../test/install-local-storage-mock";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTour, stopTour, useTour } from "./useTour";
import { ONBOARDING_KEY } from "./tour-steps";

describe("editor tour", () => {
  afterEach(() => { act(() => stopTour()); vi.useRealTimers(); });

  it("does not pop up on a first visit", () => {
    vi.useFakeTimers();
    localStorage.removeItem(ONBOARDING_KEY);
    const { result } = renderHook(() => useTour());
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.isActive).toBe(false);
  });

  it("still opens from the menu", () => {
    const { result } = renderHook(() => useTour());
    act(() => startTour());
    expect(result.current.isActive).toBe(true);
  });
});
