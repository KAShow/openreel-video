import { describe, expect, it } from "vitest";
import { exportSettings } from "./PhoneExport";

const project = (width: number, height: number, frameRate = 30) => ({ settings: { width, height, frameRate } });

describe("phone export settings", () => {
  it("exports at the project size in MP4/H.264 for high quality", () => {
    expect(exportSettings(project(1080, 1920), "high")).toMatchObject({ width: 1080, height: 1920, frameRate: 30, format: "mp4", codec: "h264", bitrate: 12000 });
  });

  it("scales the short side to 720 with even dimensions for the smaller file", () => {
    expect(exportSettings(project(1080, 1920), "small")).toMatchObject({ width: 720, height: 1280, bitrate: 5000 });
    expect(exportSettings(project(1920, 1080), "small")).toMatchObject({ width: 1280, height: 720 });
    expect(exportSettings(project(1080, 1080, 0), "small")).toMatchObject({ width: 720, height: 720, frameRate: 30 });
  });

  it("never upscales a project that is already small", () => {
    expect(exportSettings(project(540, 960), "small")).toMatchObject({ width: 540, height: 960 });
  });
});
