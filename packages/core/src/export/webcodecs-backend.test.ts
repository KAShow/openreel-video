import { afterEach, describe, expect, it, vi } from "vitest";
import { WebCodecsBackend } from "./webcodecs-backend";

class FakeSample {
  constructor(public data: unknown, public init: Record<string, unknown>) {}
  close() {}
}

class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const canvas = this;
    return {
      canvas,
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    };
  }
}

function backend(webkit: boolean) {
  const b = new WebCodecsBackend({ VideoSample: FakeSample } as never);
  const added: FakeSample[] = [];
  const videoSource = { add: vi.fn(async (s: FakeSample) => { added.push(s); }), close: vi.fn() };
  const output = { cancel: vi.fn(async () => undefined) };
  Object.assign(b as object, { isWebKit: webkit, videoSource, output });
  return { b, added, videoSource, output };
}

const bitmap = () => ({ width: 4, height: 2, close: vi.fn() }) as unknown as ImageBitmap;

afterEach(() => { vi.unstubAllGlobals(); });

describe("WebCodecsBackend frames", () => {
  it("hands Safari's encoder the pixels, not a wrapped ImageBitmap", async () => {
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    const { b, added } = backend(true);
    await b.addVideoFrame(bitmap(), 0, 1 / 30);
    expect(added[0].data).toBeInstanceOf(Uint8ClampedArray);
    expect(added[0].init).toMatchObject({ format: "RGBX", codedWidth: 4, codedHeight: 2, timestamp: 0 });
  });

  it("keeps the bitmap path in other browsers", async () => {
    const { b, added } = backend(false);
    const frame = bitmap();
    await b.addVideoFrame(frame, 1, 1 / 30);
    expect(added[0].data).toBe(frame);
  });

  it("does not close the tracks again after cancelling (no stray encoder flush)", async () => {
    const { b, output, videoSource } = backend(true);
    await b.abort();
    expect(output.cancel).toHaveBeenCalled();
    expect(videoSource.close).not.toHaveBeenCalled();
  });
});
