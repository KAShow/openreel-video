import {
  RegisteredTool,
  asRecord,
  fail,
  genId,
  obj,
  ok,
  optionalNumber,
  overlayRemoveTool,
  str,
} from "./shared";
import {
  type Action,
} from "@openreel/core/types/actions";

export const textTools: RegisteredTool[] = [
  {
    name: "create_text_clip",
    domain: "text",
    title: "Create text",
    description: "Create a text overlay that renders immediately. Pass { clip: { text, startTime, duration, style?, trackId? } }. A text track is created automatically if needed.",
    inputSchema: obj({ clip: { type: "object" } }, ["clip"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = (args.clip ?? {}) as Record<string, unknown>;
      const text = String(clip.text ?? "");
      if (!text) return fail("clip.text is required", "INVALID_PARAMS");
      if (typeof host.createTextOverlay === "function") {
        const animObj = (clip.animation ?? {}) as Record<string, unknown>;
        const animation =
          typeof clip.animation === "string"
            ? clip.animation
            : typeof animObj.type === "string"
              ? animObj.type
              : typeof animObj.preset === "string"
                ? animObj.preset
                : undefined;
        const ref = await host.createTextOverlay({
          text,
          startSec: typeof clip.startTime === "number" ? clip.startTime : 0,
          durationSec: typeof clip.duration === "number" ? clip.duration : 3,
          trackId: typeof clip.trackId === "string" ? clip.trackId : undefined,
          style: (clip.style as Record<string, unknown>) ?? undefined,
          animation,
        });
        return ok(`Created text "${text}"${animation ? ` (${animation})` : ""}`, ref);
      }
      const action: Action = {
        type: "text/create",
        id: genId(),
        timestamp: Date.now(),
        params: { clip },
      };
      const result = await host.applyAction(action);
      return result.success
        ? ok(`Created text "${text}"`, { actionId: result.actionId })
        : fail(result.error?.message ?? "text/create failed", result.error?.code);
    },
  },
  {
    name: "update_text_clip",
    domain: "text",
    title: "Update text",
    description: "Update a text overlay clip's content/style/animation/transform. Pass { clipId, updates: { text?, style?, animation?, transform? } }. Renders immediately.",
    inputSchema: obj({ clipId: str, updates: { type: "object" } }, ["clipId", "updates"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (typeof args.clipId !== "string" || !args.clipId.trim()) {
        return fail("clipId is required", "INVALID_PARAMS");
      }
      const clipId = args.clipId;
      const updates = asRecord(args.updates);
      if (!updates) return fail("updates object is required", "INVALID_PARAMS");
      if (typeof host.updateTextOverlay === "function") {
        const animObj = asRecord(updates.animation);
        const animation =
          typeof updates.animation === "string"
            ? updates.animation
            : typeof animObj?.type === "string"
              ? animObj.type
              : typeof animObj?.preset === "string"
                ? animObj.preset
                : undefined;
        const ref = await host.updateTextOverlay(clipId, {
          text: typeof updates.text === "string" ? updates.text : undefined,
          style: asRecord(updates.style),
          transform: asRecord(updates.transform),
          animation,
          animationInSec: optionalNumber(animObj?.inDuration ?? updates.animationInSec),
          animationOutSec: optionalNumber(animObj?.outDuration ?? updates.animationOutSec),
        });
        return ok("Updated text overlay", ref);
      }
      const result = await host.applyAction({ type: "text/update", id: genId(), timestamp: Date.now(), params: { clipId, updates } });
      return result.success ? ok("Updated text (action)", { clipId }) : fail(result.error?.message ?? "text/update failed", result.error?.code);
    },
  },
  overlayRemoveTool("remove_text_clip", "text", "text/remove", "text", "Remove text"),
  {
    name: "create_shape_clip",
    domain: "graphics",
    title: "Create shape",
    description: "Create a graphic/shape overlay that renders above the video and image tracks (e.g. a full-frame black scrim). Pass { clip: { shapeType?, startTime, duration, color?, opacity?, fullFrame?, trackId? } }.",
    inputSchema: obj({ clip: { type: "object" } }, ["clip"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = (args.clip ?? {}) as Record<string, unknown>;
      if (typeof host.createShapeOverlay === "function") {
        const ref = await host.createShapeOverlay({
          shapeType: typeof clip.shapeType === "string" ? clip.shapeType : undefined,
          startSec: typeof clip.startTime === "number" ? clip.startTime : 0,
          durationSec: typeof clip.duration === "number" ? clip.duration : 3,
          trackId: typeof clip.trackId === "string" ? clip.trackId : undefined,
          color: typeof clip.color === "string" ? clip.color : undefined,
          opacity: typeof clip.opacity === "number" ? clip.opacity : undefined,
          fullFrame: clip.fullFrame === true,
        });
        return ok("Created shape overlay", ref);
      }
      const action: Action = { type: "shape/create", id: genId(), timestamp: Date.now(), params: { clip } };
      const result = await host.applyAction(action);
      return result.success ? ok("Created shape (action)") : fail(result.error?.message ?? "shape/create failed", result.error?.code);
    },
  },
  {
    name: "update_shape_clip",
    domain: "graphics",
    title: "Update shape",
    description: "Update a shape overlay's color/opacity/style/transform/fullFrame. Pass { clipId, updates: { color?, opacity?, style?, transform?, fullFrame? } }. Renders immediately.",
    inputSchema: obj({ clipId: str, updates: { type: "object" } }, ["clipId", "updates"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (typeof args.clipId !== "string" || !args.clipId.trim()) {
        return fail("clipId is required", "INVALID_PARAMS");
      }
      const clipId = args.clipId;
      const updates = asRecord(args.updates);
      if (!updates) return fail("updates object is required", "INVALID_PARAMS");
      if (typeof host.updateShapeOverlay === "function") {
        const ref = await host.updateShapeOverlay(clipId, {
          color: typeof updates.color === "string" ? updates.color : undefined,
          opacity: typeof updates.opacity === "number" ? updates.opacity : undefined,
          style: asRecord(updates.style),
          transform: asRecord(updates.transform),
          fullFrame: updates.fullFrame === true,
        });
        return ok("Updated shape overlay", ref);
      }
      const result = await host.applyAction({ type: "shape/update", id: genId(), timestamp: Date.now(), params: { clipId, updates } });
      return result.success ? ok("Updated shape (action)", { clipId }) : fail(result.error?.message ?? "shape/update failed", result.error?.code);
    },
  },
  overlayRemoveTool("remove_shape_clip", "shape", "shape/remove", "graphics", "Remove shape"),
  {
    name: "create_sticker_clip",
    domain: "graphics",
    title: "Create sticker",
    description: "Create a sticker/emoji overlay that renders above the video tracks. Pass { clip: { emoji?, imageUrl?, name?, startTime, duration, trackId? } }. A graphics track is created automatically if needed.",
    inputSchema: obj({ clip: { type: "object" } }, ["clip"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = asRecord(args.clip);
      if (!clip) return fail("clip object is required", "INVALID_PARAMS");
      if (typeof host.createStickerOverlay === "function") {
        const ref = await host.createStickerOverlay({
          emoji: typeof clip.emoji === "string" ? clip.emoji : undefined,
          imageUrl: typeof clip.imageUrl === "string" ? clip.imageUrl : undefined,
          name: typeof clip.name === "string" ? clip.name : undefined,
          startSec: typeof clip.startTime === "number" ? clip.startTime : 0,
          durationSec: typeof clip.duration === "number" ? clip.duration : 5,
          trackId: typeof clip.trackId === "string" ? clip.trackId : undefined,
        });
        return ok("Created sticker overlay", ref);
      }
      const result = await host.applyAction({ type: "sticker/create", id: genId(), timestamp: Date.now(), params: { clip } });
      return result.success ? ok("Created sticker (action)") : fail(result.error?.message ?? "sticker/create failed", result.error?.code);
    },
  },
  {
    name: "update_sticker_clip",
    domain: "graphics",
    title: "Update sticker",
    description: "Update a sticker overlay's transform (position/scale/rotation/opacity). Pass { clipId, updates: { transform } }.",
    inputSchema: obj({ clipId: str, updates: { type: "object" } }, ["clipId", "updates"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (typeof args.clipId !== "string" || !args.clipId.trim()) {
        return fail("clipId is required", "INVALID_PARAMS");
      }
      const clipId = args.clipId;
      const updates = asRecord(args.updates);
      if (!updates) return fail("updates object is required", "INVALID_PARAMS");
      if (typeof host.updateStickerOverlay === "function") {
        const ref = await host.updateStickerOverlay(clipId, {
          transform: asRecord(updates.transform),
        });
        return ok("Updated sticker overlay", ref);
      }
      const result = await host.applyAction({ type: "sticker/update", id: genId(), timestamp: Date.now(), params: { clipId, updates } });
      return result.success ? ok("Updated sticker (action)", { clipId }) : fail(result.error?.message ?? "sticker/update failed", result.error?.code);
    },
  },
  overlayRemoveTool("remove_sticker_clip", "sticker", "sticker/remove", "graphics", "Remove sticker"),
  {
    name: "create_svg_clip",
    domain: "graphics",
    title: "Create SVG",
    description: "Create an SVG/vector graphic overlay from raw SVG markup. Pass { clip: { svg, startTime, duration, trackId? } }. A graphics track is created automatically if needed.",
    inputSchema: obj({ clip: { type: "object" } }, ["clip"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = asRecord(args.clip);
      if (!clip) return fail("clip object is required", "INVALID_PARAMS");
      const svg = typeof clip.svg === "string" ? clip.svg : "";
      if (!svg) return fail("clip.svg (SVG markup) is required", "INVALID_PARAMS");
      if (typeof host.createSvgOverlay === "function") {
        const ref = await host.createSvgOverlay({
          svg,
          startSec: typeof clip.startTime === "number" ? clip.startTime : 0,
          durationSec: typeof clip.duration === "number" ? clip.duration : 5,
          trackId: typeof clip.trackId === "string" ? clip.trackId : undefined,
        });
        return ok("Created SVG overlay", ref);
      }
      const result = await host.applyAction({ type: "svg/create", id: genId(), timestamp: Date.now(), params: { clip } });
      return result.success ? ok("Created SVG (action)") : fail(result.error?.message ?? "svg/create failed", result.error?.code);
    },
  },
  {
    name: "update_svg_clip",
    domain: "graphics",
    title: "Update SVG",
    description: "Update an SVG overlay's fields (transform, color style, etc.). Pass { clipId, updates }.",
    inputSchema: obj({ clipId: str, updates: { type: "object" } }, ["clipId", "updates"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (typeof args.clipId !== "string" || !args.clipId.trim()) {
        return fail("clipId is required", "INVALID_PARAMS");
      }
      const clipId = args.clipId;
      const updates = asRecord(args.updates);
      if (!updates) return fail("updates object is required", "INVALID_PARAMS");
      if (typeof host.updateSvgOverlay === "function") {
        const ref = await host.updateSvgOverlay(clipId, updates);
        return ok("Updated SVG overlay", ref);
      }
      const result = await host.applyAction({ type: "svg/update", id: genId(), timestamp: Date.now(), params: { clipId, updates } });
      return result.success ? ok("Updated SVG (action)", { clipId }) : fail(result.error?.message ?? "svg/update failed", result.error?.code);
    },
  },
  overlayRemoveTool("remove_svg_clip", "svg", "svg/remove", "graphics", "Remove SVG")
];
