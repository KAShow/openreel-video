import {
  RegisteredTool,
  actionTool,
  fail,
  obj,
  ok,
  str,
} from "./shared";

export const mediaTools: RegisteredTool[] = [
  {
    name: "import_media_from_url",
    domain: "media",
    title: "Import media from URL",
    description: "Download an image, video, or audio file from a public http(s) URL (e.g. a free stock library) and add it to the media library. Returns the mediaId to use with add_clip. Requires an open project.",
    inputSchema: obj({ url: str, name: str }, ["url"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (typeof host.importMediaFromUrl !== "function") {
        return fail("import_media_from_url is not available in this host", "UNSUPPORTED");
      }
      host.requireOpenProject();
      const ref = await host.importMediaFromUrl(String(args.url), {
        name: typeof args.name === "string" ? args.name : undefined,
      });
      return ok(`Imported ${ref.type} "${ref.name}" (${ref.durationSec.toFixed(2)}s)`, ref);
    },
  },
  actionTool({ name: "delete_media", domain: "media", actionType: "media/delete", title: "Delete media", description: "Delete a media library item.", inputSchema: obj({ mediaId: str }, ["mediaId"]), destructive: true }),
  actionTool({ name: "rename_media", domain: "media", actionType: "media/rename", title: "Rename media", description: "Rename a media item.", inputSchema: obj({ mediaId: str, name: str }, ["mediaId", "name"]) })
];
