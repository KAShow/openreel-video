import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditingHost } from "@openreel/agent";

const h = vi.hoisted(() => ({
  status: "ready" as string,
  list: vi.fn(),
  toFile: vi.fn(async (item: { title: string }) => new File(["x"], `${item.title}.mp4`, { type: "video/mp4" })),
}));
vi.mock("./session", () => ({ useHawshStore: { getState: () => ({ status: h.status }) } }));
vi.mock("./api", () => ({ listLibrary: h.list, itemToFile: h.toFile }));

import { addFromLibraryTool, clearLibraryToolCache, listLibraryTool } from "./library-tools";
import { editingToolDefs, editingToolReadOnly } from "../services/agent/editing-tools";
import { toolLabel } from "../components/editor/chat/tool-labels";

const items = [
  { key: "vid:new", kind: "video", source: "generations", title: "قهوة الصباح", url: "https://x/1.mp4", thumb: null, createdAt: "2026-11-16" },
  { key: "vid:old", kind: "video", source: "generations", title: "إعلان قديم", url: "https://x/2.mp4", thumb: null, createdAt: "2026-11-01" },
];
const host = (ids = ["m-new"]) => ({ importIntoProject: vi.fn(async (_file: File) => ids) }) as unknown as EditingHost & { importIntoProject: (file: File) => Promise<string[]> };

describe("library tools", () => {
  beforeEach(() => {
    h.status = "ready";
    h.list.mockReset().mockResolvedValue(items);
    clearLibraryToolCache();
  });

  it("are offered to the assistant with Arabic labels, and listing is read-only", () => {
    const names = editingToolDefs("openai").map((d) => (d as { function: { name: string } }).function.name);
    expect(names).toEqual(expect.arrayContaining(["list_library", "add_from_library"]));
    expect(editingToolReadOnly("list_library")).toBe(true);
    expect(editingToolReadOnly("add_from_library")).toBe(false);
    expect(toolLabel("list_library")).toBeTruthy();
    expect(toolLabel("add_from_library")).toBeTruthy();
  });

  it("lists the newest items with ids the assistant can add", async () => {
    const result = await listLibraryTool({ source: "generations", kind: "video", limit: 1 });
    expect(h.list).toHaveBeenCalledWith("generations", "video");
    expect(result.data).toEqual({ source: "generations", kind: "video", items: [{ libraryId: "vid:new", title: "قهوة الصباح", kind: "video", createdAt: "2026-11-16" }] });
  });

  it("adds a listed item to the project and returns its mediaId", async () => {
    await listLibraryTool({});
    const target = host();
    const result = await addFromLibraryTool({ libraryId: "vid:new" }, target);
    expect(result).toMatchObject({ ok: true, data: { mediaId: "m-new", title: "قهوة الصباح" } });
    expect(vi.mocked(target.importIntoProject)).toHaveBeenCalledWith(expect.any(File));
  });

  it("refuses an id it has not listed, and explains when signed out", async () => {
    expect(await addFromLibraryTool({ libraryId: "vid:new" }, host())).toMatchObject({ ok: false, error: { message: expect.stringContaining("list_library") } });
    h.status = "off";
    expect(await listLibraryTool({})).toMatchObject({ ok: false, error: { message: expect.stringContaining("not signed in") } });
    expect(h.list).not.toHaveBeenCalled();
  });

  it("reports a failed download as a failed step", async () => {
    await listLibraryTool({});
    h.toFile.mockRejectedValueOnce(new Error('Couldn\'t download "قهوة الصباح".'));
    expect(await addFromLibraryTool({ libraryId: "vid:new" }, host())).toMatchObject({ ok: false, error: { message: expect.stringContaining("download") } });
  });
});
