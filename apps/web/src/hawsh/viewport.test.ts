import { describe, expect, it } from "vitest";
import { installViewport } from "./viewport";

describe("phone viewport", () => {
  it("follows the visible height and cancels page pinch-zoom until removed", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    const remove = installViewport();
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("700px");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("640px");

    const pinch = new Event("gesturestart", { cancelable: true });
    document.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);

    remove();
    const after = new Event("gesturestart", { cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
