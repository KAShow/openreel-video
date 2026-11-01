import {
  RegisteredTool,
  actionTool,
  asRecord,
  easingSchema,
  genId,
  num,
  obj,
  optionalString,
  str,
  timelineKeyframeInputSchema,
  timelineKeyframePropertySchema,
} from "./shared";
import {
  TRANSITION_TYPES,
} from "@openreel/core/types/effects";

export const timelineEditingTools: RegisteredTool[] = [
  actionTool({ name: "add_keyframe", domain: "keyframe", actionType: "keyframe/add", title: "Add keyframe", description: "Animate an existing main-timeline clip by adding a property keyframe at clip-local time in seconds. Supported transform properties are opacity, position.x/y, scale.x/y, and rotation; supported effect properties are effect.brightness/contrast/saturation/blur. Add at least two keyframes for interpolation.", inputSchema: obj({ clipId: str, property: timelineKeyframePropertySchema, time: num, value: {}, easing: easingSchema }, ["clipId", "property", "time", "value"]) }),
  actionTool({ name: "remove_keyframe", domain: "keyframe", actionType: "keyframe/remove", title: "Remove keyframe", description: "Remove a keyframe.", inputSchema: obj({ clipId: str, property: str, time: num }, ["clipId", "property", "time"]) }),
  actionTool({
    name: "set_clip_keyframes",
    domain: "keyframe",
    actionType: "keyframe/setAll",
    title: "Set keyframes",
    description: "Replace all animation keyframes on an existing main-timeline clip. Times are clip-local seconds. Each item needs property, time, and value; id and easing default automatically.",
    inputSchema: obj({ clipId: str, keyframes: { type: "array", items: timelineKeyframeInputSchema } }, ["clipId", "keyframes"]),
    mapParams: (args) => ({
      clipId: args.clipId,
      keyframes: Array.isArray(args.keyframes)
        ? args.keyframes.map((value) => {
            const keyframe = asRecord(value) ?? {};
            return {
              ...keyframe,
              id: optionalString(keyframe.id) ?? genId(),
              easing: optionalString(keyframe.easing) ?? "linear",
            };
          })
        : args.keyframes,
    }),
  }),
  actionTool({ name: "add_transition", domain: "transition", actionType: "transition/add", title: "Add transition", description: "Add a rendered transition between two adjacent existing clips on the same main-timeline track. Use list_clips for ordered clip ids and get_capabilities transitionTypes for values such as whipPan, zoom, push, glitch, or flash.", inputSchema: obj({ clipAId: str, clipBId: str, transitionType: { type: "string", enum: [...TRANSITION_TYPES] }, duration: num }, ["clipAId", "clipBId", "transitionType", "duration"]) }),
  actionTool({ name: "update_transition", domain: "transition", actionType: "transition/update", title: "Update transition", description: "Update an existing main-timeline transition's type and/or duration.", inputSchema: obj({ transitionId: str, type: { type: "string", enum: [...TRANSITION_TYPES] }, duration: num }, ["transitionId"]) }),
  actionTool({ name: "remove_transition", domain: "transition", actionType: "transition/remove", title: "Remove transition", description: "Remove a transition.", inputSchema: obj({ transitionId: str }, ["transitionId"]) }),
  actionTool({ name: "add_marker", domain: "marker", actionType: "marker/add", title: "Add marker", description: "Add a timeline marker.", inputSchema: obj({ time: num, label: str, color: str }, ["time", "label", "color"]) }),
  actionTool({ name: "remove_marker", domain: "marker", actionType: "marker/remove", title: "Remove marker", description: "Remove a marker.", inputSchema: obj({ markerId: str }, ["markerId"]) }),
  actionTool({ name: "update_marker", domain: "marker", actionType: "marker/update", title: "Update marker", description: "Update a marker.", inputSchema: obj({ markerId: str, updates: { type: "object" } }, ["markerId", "updates"]) })
];
