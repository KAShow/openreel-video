import {
  RegisteredTool,
  actionTool,
  bool,
  clipTransformSchema,
  num,
  obj,
  str,
} from "./shared";

export const timelineTools: RegisteredTool[] = [
  actionTool({ name: "add_clip", domain: "clip", actionType: "clip/add", title: "Add clip", description: "Add a media clip to a track at a time.", inputSchema: obj({ trackId: str, mediaId: str, startTime: num }, ["trackId", "mediaId", "startTime"]) }),
  actionTool({ name: "remove_clip", domain: "clip", actionType: "clip/remove", title: "Remove clip", description: "Remove a clip.", inputSchema: obj({ clipId: str }, ["clipId"]), destructive: true }),
  actionTool({ name: "move_clip", domain: "clip", actionType: "clip/move", title: "Move clip", description: "Move a clip to a new start time / track.", inputSchema: obj({ clipId: str, startTime: num, trackId: str }, ["clipId", "startTime"]) }),
  actionTool({ name: "trim_clip", domain: "clip", actionType: "clip/trim", title: "Trim clip", description: "Trim an existing main-timeline clip by setting either or both source-media inPoint/outPoint values in seconds. Read the current values with get_clip first.", inputSchema: obj({ clipId: str, inPoint: num, outPoint: num }, ["clipId"]) }),
  actionTool({ name: "split_clip", domain: "clip", actionType: "clip/split", title: "Split clip", description: "Split an existing main-timeline clip at an absolute timeline time in seconds. The time must fall strictly inside the clip's startTime..startTime+duration range.", inputSchema: obj({ clipId: str, time: num }, ["clipId", "time"]) }),
  actionTool({ name: "ripple_delete_clip", domain: "clip", actionType: "clip/rippleDelete", title: "Ripple delete", description: "Delete a clip and close the gap.", inputSchema: obj({ clipId: str }, ["clipId"]), destructive: true }),
  actionTool({ name: "slip_clip", domain: "clip", actionType: "clip/slip", title: "Slip clip", description: "Slip a clip's source by delta.", inputSchema: obj({ clipId: str, delta: num }, ["clipId", "delta"]) }),
  actionTool({ name: "slide_clip", domain: "clip", actionType: "clip/slide", title: "Slide clip", description: "Slide a clip by delta.", inputSchema: obj({ clipId: str, delta: num, prevClipId: str, nextClipId: str }, ["clipId", "delta"]) }),
  actionTool({ name: "roll_edit", domain: "clip", actionType: "clip/roll", title: "Roll edit", description: "Roll the edit point between two clips.", inputSchema: obj({ leftClipId: str, rightClipId: str, delta: num }, ["leftClipId", "rightClipId", "delta"]) }),
  actionTool({ name: "trim_to_playhead", domain: "clip", actionType: "clip/trimToPlayhead", title: "Trim to playhead", description: "Trim a clip's start/end to a time.", inputSchema: obj({ clipId: str, playheadTime: num, trimStart: bool }, ["clipId", "playheadTime", "trimStart"]) }),
  actionTool({ name: "close_gap", domain: "clip", actionType: "clip/closeGapBefore", title: "Close gap", description: "Close the gap before a clip.", inputSchema: obj({ clipId: str }, ["clipId"]) }),
  actionTool({ name: "set_clip_speed", domain: "speed", actionType: "clip/setSpeed", title: "Set speed", description: "Set an existing main-timeline clip's playback-speed multiplier (for example 0.5 = half speed, 2 = double speed); recomputes its duration. Use get_capabilities speed.range for limits.", inputSchema: obj({ clipId: str, speed: num }, ["clipId", "speed"]) }),
  actionTool({ name: "set_clip_reverse", domain: "speed", actionType: "clip/setReverse", title: "Reverse clip", description: "Toggle clip reverse.", inputSchema: obj({ clipId: str, reversed: bool }, ["clipId", "reversed"]) }),
  actionTool({ name: "set_clip_pitch_correction", domain: "speed", actionType: "clip/setPitchCorrection", title: "Pitch correction", description: "Toggle pitch correction on speed changes.", inputSchema: obj({ clipId: str, pitchCorrection: bool }, ["clipId", "pitchCorrection"]) }),
  actionTool({ name: "set_speed_ramp", domain: "speed", actionType: "speed/setRampData", title: "Speed ramp", description: "Set speed keyframes / freeze frames / pitch.", inputSchema: obj({ clipId: str, keyframes: { type: "array" }, freezeFrames: { type: "array" }, pitchCorrection: bool }, ["clipId"]) }),
  actionTool({ name: "set_clip_stabilization", domain: "speed", actionType: "clip/setStabilization", title: "Stabilization", description: "Set clip stabilization settings.", inputSchema: obj({ clipId: str, stabilization: { type: "object" } }, ["clipId"]) }),
  actionTool({ name: "set_clip_chroma_key", domain: "speed", actionType: "clip/setChromaKey", title: "Chroma key", description: "Set green-screen / chroma-key settings.", inputSchema: obj({ clipId: str, chromaKey: { type: "object" } }, ["clipId"]) }),
  actionTool({ name: "set_clip_transform", domain: "transform", actionType: "transform/update", title: "Transform clip", description: "Update an existing main-timeline clip's static transform. position is a pixel offset from canvas center; scale uses 1 = 100%; rotation is degrees; opacity is 0..1. Partial nested updates are safely merged, so {scale:{x:1.2,y:1.2}} performs a 120% zoom without resetting position.", inputSchema: obj({ clipId: str, transform: clipTransformSchema }, ["clipId", "transform"]) }),
  actionTool({ name: "set_clip_blend_mode", domain: "transform", actionType: "clip/setBlendMode", title: "Blend mode", description: "Set a clip's blend mode.", inputSchema: obj({ clipId: str, blendMode: str }, ["clipId", "blendMode"]) }),
  actionTool({ name: "set_clip_blend_opacity", domain: "transform", actionType: "clip/setBlendOpacity", title: "Blend opacity", description: "Set a clip's blend opacity (0..1).", inputSchema: obj({ clipId: str, opacity: num }, ["clipId", "opacity"]) })
];
