import {
  RegisteredTool,
  actionTool,
  asRecord,
  bool,
  genId,
  num,
  obj,
  str,
} from "./shared";
import {
  AUDIO_EFFECT_TYPES,
} from "@openreel/core/types/effects";

export const audioTools: RegisteredTool[] = [
  actionTool({ name: "set_clip_volume", domain: "audio", actionType: "audio/setVolume", title: "Set volume", description: "Set a clip's volume (0..1+).", inputSchema: obj({ clipId: str, volume: num }, ["clipId", "volume"]) }),
  actionTool({ name: "set_clip_fade", domain: "audio", actionType: "audio/setFade", title: "Set fade", description: "Set audio fade in/out seconds.", inputSchema: obj({ clipId: str, fadeIn: num, fadeOut: num }, ["clipId"]) }),
  actionTool({ name: "add_audio_automation", domain: "audio", actionType: "audio/addAutomation", title: "Audio automation", description: "Add audio automation points.", inputSchema: obj({ clipId: str, points: { type: "array" } }, ["clipId", "points"]) }),
  actionTool({
    name: "add_audio_effect",
    domain: "audio",
    actionType: "audio/addEffect",
    title: "Add audio effect",
    description: "Add an audio effect to an existing main-timeline clip. Pass effectType (gain|pan|eq|compressor|reverb|delay|noiseReduction|fadeIn|fadeOut) and optional params; the effect id is generated automatically. A complete legacy effect object is also accepted.",
    inputSchema: {
      ...obj({
        clipId: str,
        effectType: { type: "string", enum: [...AUDIO_EFFECT_TYPES] },
        params: { type: "object" },
        effect: { type: "object" },
      }, ["clipId"]),
      anyOf: [{ required: ["effectType"] }, { required: ["effect"] }],
    },
    mapParams: (args) => ({
      clipId: args.clipId,
      effect:
        asRecord(args.effect) ?? {
          id: genId(),
          type: args.effectType,
          enabled: true,
          params: asRecord(args.params) ?? {},
        },
    }),
  }),
  actionTool({ name: "remove_audio_effect", domain: "audio", actionType: "audio/removeEffect", title: "Remove audio effect", description: "Remove an audio effect.", inputSchema: obj({ clipId: str, effectId: str }, ["clipId", "effectId"]) }),
  actionTool({ name: "update_audio_effect", domain: "audio", actionType: "audio/updateEffect", title: "Update audio effect", description: "Update an audio effect's params.", inputSchema: obj({ clipId: str, effectId: str, params: { type: "object" } }, ["clipId", "effectId", "params"]) }),
  actionTool({ name: "toggle_audio_effect", domain: "audio", actionType: "audio/toggleEffect", title: "Toggle audio effect", description: "Enable/disable an audio effect.", inputSchema: obj({ clipId: str, effectId: str, enabled: bool }, ["clipId", "effectId", "enabled"]) })
];
