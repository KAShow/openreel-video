import {
  RegisteredTool,
  num,
  obj,
  readTool,
  str,
} from "./shared";
import {
  type ClipFilter,
  getClipDetail,
  listClips,
  listMedia,
  listTracks,
  serializeEditorState,
} from "../serialize";

export const readTools: RegisteredTool[] = [
  readTool("get_editor_state", "Editor state", "Project settings, durations, and counts.", obj({}), (_a, h) =>
    serializeEditorState(h.getProject()),
  ),
  readTool("list_media", "List media", "Media library items (blob-free).", obj({}), (_a, h) =>
    listMedia(h.getProject()),
  ),
  readTool("list_tracks", "List tracks", "All timeline tracks.", obj({}), (_a, h) =>
    listTracks(h.getProject()),
  ),
  readTool(
    "list_clips",
    "List clips",
    "Compact clip list. Optional filters: trackIndex, fromSec, toSec; paginate huge timelines with offset/limit.",
    obj({ trackIndex: num, fromSec: num, toSec: num, offset: num, limit: num }),
    (a, h) => listClips(h.getProject(), a as ClipFilter),
  ),
  readTool("get_clip", "Get clip", "Full detail for one clip by id.", obj({ clipId: str }, ["clipId"]), (a, h) =>
    getClipDetail(h.getProject(), a.clipId as string),
  ),
  readTool("get_capabilities", "Capabilities", "Valid enums + parameter ranges.", obj({}), (_a, h) =>
    h.capabilities(),
  )
];
