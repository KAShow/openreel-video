/**
 * AI assistant tools for the user's Director's Eyes library (Hawsh Khalifa build):
 * - list_library (read-only): the latest generations or references, by kind.
 * - add_from_library: downloads one of them into the project's media library and returns its mediaId,
 *   so the assistant can then place it with add_clip. The import goes through
 *   EditingSession.importIntoProject, which keeps the AI turn consistent.
 */
import type { EditingHost, ToolResult } from "@openreel/agent";
import { itemToFile, listLibrary } from "./api";
import type { HawshItem, HawshKind, HawshSource } from "./library";
import { useHawshStore } from "./session";

export const LIST_LIBRARY_TOOL = "list_library";
export const ADD_FROM_LIBRARY_TOOL = "add_from_library";

interface ImportHost extends EditingHost { importIntoProject?: (file: File) => Promise<string[]> }

/** Items the assistant has seen in this page session, by libraryId (the item key). */
const seen = new Map<string, HawshItem>();
export function clearLibraryToolCache(): void { seen.clear(); }

const fail = (message: string): ToolResult => ({ ok: false, summary: "Library request failed", error: { code: "LIBRARY_FAILED", message } });
const signedOut = () => useHawshStore.getState().status !== "ready";
const SIGN_IN = "The user is not signed in to Director's Eyes, so their library is unavailable. Tell them to use the sign-in button on the start page.";

export async function listLibraryTool(args: Record<string, unknown>): Promise<ToolResult> {
  if (signedOut()) return fail(SIGN_IN);
  const source: HawshSource = args.source === "references" ? "references" : "generations";
  const kind: HawshKind = args.kind === "image" ? "image" : "video";
  const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, Math.round(args.limit))) : 10;
  try {
    const items = (await listLibrary(source, kind)).slice(0, limit);
    for (const item of items) seen.set(item.key, item);
    return {
      ok: true,
      summary: `${items.length} ${kind === "image" ? "images" : "videos"} from ${source === "generations" ? "My generations" : "My references"}, newest first`,
      data: { source, kind, items: items.map((i) => ({ libraryId: i.key, title: i.title, kind: i.kind, createdAt: i.createdAt })) },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not load the library");
  }
}

export async function addFromLibraryTool(args: Record<string, unknown>, host: ImportHost): Promise<ToolResult> {
  if (signedOut()) return fail(SIGN_IN);
  const item = seen.get(String(args.libraryId));
  if (!item) return fail("Unknown libraryId; call list_library first and use one of its libraryId values");
  if (!host.importIntoProject) return fail("Importing from the library is not available here");
  try {
    const mediaIds = await host.importIntoProject(await itemToFile(item));
    if (!mediaIds.length) return fail(`"${item.title}" could not be added`);
    return {
      ok: true,
      summary: `Added "${item.title}" to the media library. Place it on the timeline with add_clip using this mediaId.`,
      data: { mediaId: mediaIds[0], title: item.title, kind: item.kind },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : `"${item.title}" could not be added`);
  }
}
