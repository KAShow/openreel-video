import {
  RegisteredTool,
  actionTool,
  bool,
  num,
  obj,
  str,
} from "./shared";

export const trackTools: RegisteredTool[] = [
  actionTool({ name: "add_track", domain: "track", actionType: "track/add", title: "Add track", description: "Add a track (video|audio|image|text|graphics).", inputSchema: obj({ trackType: str, position: num }, ["trackType"]) }),
  actionTool({ name: "duplicate_track", domain: "track", actionType: "track/duplicate", title: "Duplicate track", description: "Duplicate a timeline-backed video, image, or audio track with fresh track, clip, and transition identities. Inserts the copy after the source unless position is supplied.", inputSchema: obj({ sourceTrackId: str, position: num }, ["sourceTrackId"]) }),
  actionTool({ name: "remove_track", domain: "track", actionType: "track/remove", title: "Remove track", description: "Remove a track and its clips.", inputSchema: obj({ trackId: str }, ["trackId"]), destructive: true }),
  actionTool({ name: "rename_track", domain: "track", actionType: "track/rename", title: "Rename track", description: "Rename a track.", inputSchema: obj({ trackId: str, name: str }, ["trackId", "name"]) }),
  actionTool({ name: "reorder_track", domain: "track", actionType: "track/reorder", title: "Reorder track", description: "Move a track to a new stacking position (0 = top of the timeline / front-most).", inputSchema: obj({ trackId: str, newPosition: num }, ["trackId", "newPosition"]) }),
  actionTool({ name: "lock_track", domain: "track", actionType: "track/lock", title: "Lock track", description: "Lock/unlock a track.", inputSchema: obj({ trackId: str, locked: bool }, ["trackId", "locked"]) }),
  actionTool({ name: "hide_track", domain: "track", actionType: "track/hide", title: "Hide track", description: "Show/hide a track.", inputSchema: obj({ trackId: str, hidden: bool }, ["trackId", "hidden"]) }),
  actionTool({ name: "mute_track", domain: "track", actionType: "track/mute", title: "Mute track", description: "Mute/unmute a track.", inputSchema: obj({ trackId: str, muted: bool }, ["trackId", "muted"]) }),
  actionTool({ name: "solo_track", domain: "track", actionType: "track/solo", title: "Solo track", description: "Solo/unsolo a track.", inputSchema: obj({ trackId: str, solo: bool }, ["trackId", "solo"]) }),
  actionTool({ name: "consolidate_track", domain: "track", actionType: "track/consolidate", title: "Consolidate", description: "Close gaps on a track.", inputSchema: obj({ trackId: str }, ["trackId"]) })
];
