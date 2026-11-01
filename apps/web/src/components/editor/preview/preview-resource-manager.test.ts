import { describe, expect, it, vi } from "vitest";
import { PreviewResourceManager } from "./preview-resource-manager";

describe("PreviewResourceManager", () => {
  it("disposes owned resources once in reverse ownership order", () => {
    const calls: string[] = [];
    const manager = new PreviewResourceManager();
    manager.own(() => calls.push("renderer"));
    manager.own(() => calls.push("bitmap"));

    manager.dispose();
    manager.dispose();

    expect(calls).toEqual(["bitmap", "renderer"]);
    expect(manager.isCurrent(manager.beginRequest())).toBe(false);
  });

  it("rejects requests completed after disposal and immediately cleans late resources", () => {
    const manager = new PreviewResourceManager();
    const request = manager.beginRequest();
    const destroyLateRenderer = vi.fn();

    manager.dispose();
    expect(manager.isCurrent(request)).toBe(false);

    manager.own(destroyLateRenderer);
    expect(destroyLateRenderer).toHaveBeenCalledOnce();
  });

  it("invalidates the old lifecycle when activated again", () => {
    const manager = new PreviewResourceManager();
    const oldRequest = manager.beginRequest();
    const disposeOldResource = vi.fn();
    manager.own(disposeOldResource);
    manager.dispose();

    manager.activate();
    const currentRequest = manager.beginRequest();

    expect(disposeOldResource).toHaveBeenCalledOnce();
    expect(manager.isCurrent(oldRequest)).toBe(false);
    expect(manager.isCurrent(currentRequest)).toBe(true);
  });

  it("continues cleanup when one resource fails", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const disposeBitmap = vi.fn();
    const manager = new PreviewResourceManager();
    manager.own(disposeBitmap);
    manager.own(() => {
      throw new Error("renderer cleanup failed");
    });

    manager.dispose();

    expect(disposeBitmap).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
