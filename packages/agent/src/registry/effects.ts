import {
  RegisteredTool,
  actionTool,
  bool,
  fail,
  genId,
  obj,
  ok,
  optionalString,
  str,
} from "./shared";
import {
  type Action,
} from "@openreel/core/types/actions";
import {
  getMotionShaderDef,
} from "@openreel/core/motion/shaders/index";

export const effectsTools: RegisteredTool[] = [
  {
    name: "add_video_effect",
    domain: "effect",
    title: "Add effect",
    description:
      "Add a video effect to a clip. Standard effectType values include brightness, contrast, saturation, blur, sharpen, vignette, grain, temperature, tint, shadow, glow, motion-blur, radial-blur, chromatic-aberration. Set effectType to 'shader' to run a GPU shader effect from the Motion shader library (only category 'effect' shaders, e.g. the Paper Design catalog like paper-halftone-dots or paper-liquid-metal — use list_motion_shaders with category 'effect' to discover ids); for shader effects, params MUST include a valid shaderId plus optional numeric params (name/value pairs from the shader's params) and an optional numeric time. Shader effects no-op gracefully when WebGL2 is unavailable.",
    inputSchema: obj(
      { clipId: str, effectType: str, params: { type: "object" } },
      ["clipId", "effectType"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const effectType = optionalString(args.effectType);
      if (!effectType) return fail("effectType is required", "INVALID_PARAMS");
      const params =
        typeof args.params === "object" && args.params !== null
          ? (args.params as Record<string, unknown>)
          : {};
      if (effectType === "shader") {
        const shaderId = optionalString(params.shaderId);
        if (!shaderId) {
          return fail(
            "shader effect requires params.shaderId",
            "INVALID_PARAMS",
          );
        }
        const def = getMotionShaderDef(shaderId);
        if (!def || def.category !== "effect") {
          return fail(
            `Unknown effect shader: ${shaderId}`,
            "INVALID_PARAMS",
          );
        }
      }
      const action: Action = {
        type: "effect/add",
        id: genId(),
        timestamp: Date.now(),
        params: args,
      };
      const result = await host.applyAction(action);
      if (result.success) return ok("add_video_effect applied", { actionId: action.id });
      return fail(
        result.error?.message ?? "add_video_effect failed",
        result.error?.code ?? "ACTION_FAILED",
      );
    },
  },
  actionTool({ name: "remove_video_effect", domain: "effect", actionType: "effect/remove", title: "Remove effect", description: "Remove a clip's video effect.", inputSchema: obj({ clipId: str, effectId: str }, ["clipId", "effectId"]) }),
  actionTool({ name: "update_video_effect", domain: "effect", actionType: "effect/update", title: "Update effect", description: "Update a video effect's params.", inputSchema: obj({ clipId: str, effectId: str, params: { type: "object" } }, ["clipId", "effectId", "params"]) }),
  actionTool({ name: "toggle_video_effect", domain: "effect", actionType: "effect/toggle", title: "Toggle effect", description: "Enable/disable a video effect.", inputSchema: obj({ clipId: str, effectId: str, enabled: bool }, ["clipId", "effectId", "enabled"]) }),
  actionTool({ name: "set_effect_order", domain: "effect", actionType: "effect/setOrder", title: "Reorder effects", description: "Set the full effect order for a clip.", inputSchema: obj({ clipId: str, effectIds: { type: "array" } }, ["clipId", "effectIds"]) }),
  actionTool({ name: "set_color_grading", domain: "color", actionType: "clip/setColorGrading", title: "Color grading", description: "Set a clip's color grading (wheels/curves/lut/hsl/temp/tint).", inputSchema: obj({ clipId: str, colorGrading: { type: "object" } }, ["clipId"]) })
];
