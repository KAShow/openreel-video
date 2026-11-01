import {
  MOTION_EXPORT_SCENE_FORMATS,
  MOTION_RENDER_QUEUE_FORMATS,
  MOTION_RENDER_QUEUE_SCALES,
  MOTION_RENDER_QUEUE_UNSUPPORTED,
  RegisteredTool,
  bool,
  fail,
  getMotionComposition,
  isExportMotionSceneFormat,
  isMotionRenderQueueFormat,
  motionRenderQueueFormatRequiresNative,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  str,
} from "./shared";
import {
  type ExportMotionSceneOptions,
  type MotionRenderQueueAddFormat,
  type MotionRenderQueueAddInput,
} from "../host";

export const motionRenderTools: RegisteredTool[] = [
  {
    name: "export_motion_video",
    domain: "export",
    title: "Export motion video",
    description:
      "Render a motion composition to a finished video file and return the filename plus width/height/duration/framesRendered and the format actually encoded. format: 'mp4' (H.264, opaque), 'webm-alpha' (VP9 with transparency), or 'mov-prores4444' (ProRes 4444 with transparency); default 'mp4'. On the web build only the desktop app can produce transparent WebM or ProRes — for those formats on web the export normalizes to opaque H.264, so you MUST pass acknowledgeH264Fallback:true to consent (otherwise the export fails with a warning telling you to acknowledge or use desktop). Optional filename overrides the auto-generated name. Inspect data.normalizedToH264 / data.encodedFormat to see what was really written. Expensive — requires confirmation.",
    inputSchema: obj(
      {
        compositionId: str,
        format: { type: "string", enum: [...MOTION_EXPORT_SCENE_FORMATS] },
        filename: str,
        acknowledgeH264Fallback: bool,
      },
      ["compositionId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const compositionId = optionalString(args.compositionId);
      if (!compositionId) {
        return fail("compositionId is required", "INVALID_PARAMS");
      }
      const rawFormat = optionalString(args.format);
      if (rawFormat !== undefined && !isExportMotionSceneFormat(rawFormat)) {
        return fail(
          `format must be one of ${MOTION_EXPORT_SCENE_FORMATS.join("|")}`,
          "INVALID_PARAMS",
        );
      }
      const filename = optionalString(args.filename);
      if (typeof host.exportMotionScene !== "function") {
        return fail(
          "Motion video export is not supported by this host (only the live/desktop web editor can render motion scenes).",
          "UNSUPPORTED",
        );
      }
      const composition = getMotionComposition(host, compositionId);
      if (!composition) {
        return fail(`Motion composition not found: ${compositionId}`, "NOT_FOUND");
      }
      const options: ExportMotionSceneOptions = {
        compositionId,
        ...(rawFormat !== undefined ? { format: rawFormat } : {}),
        ...(filename !== undefined ? { filename } : {}),
        ...(args.acknowledgeH264Fallback === true
          ? { acknowledgeH264Fallback: true }
          : {}),
      };
      const result = await host.exportMotionScene(options);
      const normalizedNote =
        result.normalizedToH264 && result.note ? ` — ${result.note}` : "";
      return ok(
        `Exported "${composition.name}" as ${result.encodedFormat} (${result.framesRendered} frames, ${result.width}x${result.height})${normalizedNote}`,
        {
          compositionId,
          filename: result.filename,
          width: result.width,
          height: result.height,
          duration: result.duration,
          framesRendered: result.framesRendered,
          requestedFormat: result.requestedFormat,
          encodedFormat: result.encodedFormat,
          normalizedToH264: result.normalizedToH264,
          ...(result.note !== undefined ? { note: result.note } : {}),
        },
      );
    },
  },
  {
    name: "queue_motion_render",
    domain: "export",
    title: "Queue motion render",
    description:
      "Add a motion composition to the render queue for later batch export. format: 'mp4' | 'webm-alpha' | 'mov-prores4444' | 'png-sequence' (default 'mp4'). Optional rangeStart/rangeEnd (seconds, within the composition duration, start<end) render only that span; resolutionScale (1 | 0.5 | 0.25) downscales the output; optional filename overrides the auto name. On the web build transparent WebM and ProRes normalize to opaque H.264 — for those you MUST pass acknowledgeH264Fallback:true to consent (png-sequence is transparent but ZIP-encoded and never needs acknowledgement). Returns data.itemId. Use run_motion_render_queue to render.",
    inputSchema: obj(
      {
        compositionId: str,
        format: { type: "string", enum: [...MOTION_RENDER_QUEUE_FORMATS] },
        rangeStart: num,
        rangeEnd: num,
        resolutionScale: { type: "number", enum: [...MOTION_RENDER_QUEUE_SCALES] },
        filename: str,
        acknowledgeH264Fallback: bool,
      },
      ["compositionId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      const compositionId = optionalString(args.compositionId);
      if (!compositionId) {
        return fail("compositionId is required", "INVALID_PARAMS");
      }
      const rawFormat = optionalString(args.format);
      if (rawFormat !== undefined && !isMotionRenderQueueFormat(rawFormat)) {
        return fail(
          `format must be one of ${MOTION_RENDER_QUEUE_FORMATS.join("|")}`,
          "INVALID_PARAMS",
        );
      }
      const format: MotionRenderQueueAddFormat = rawFormat ?? "mp4";
      const scale = optionalNumber(args.resolutionScale);
      if (
        args.resolutionScale !== undefined &&
        (scale === undefined || !MOTION_RENDER_QUEUE_SCALES.includes(scale))
      ) {
        return fail(
          `resolutionScale must be one of ${MOTION_RENDER_QUEUE_SCALES.join("|")}`,
          "INVALID_PARAMS",
        );
      }
      const rangeStart = optionalNumber(args.rangeStart);
      const rangeEnd = optionalNumber(args.rangeEnd);
      if (
        (args.rangeStart !== undefined && rangeStart === undefined) ||
        (args.rangeEnd !== undefined && rangeEnd === undefined)
      ) {
        return fail("rangeStart and rangeEnd must be finite numbers", "INVALID_PARAMS");
      }
      const hasRange = rangeStart !== undefined || rangeEnd !== undefined;
      const filename = optionalString(args.filename);
      if (typeof host.motionRenderQueue?.add !== "function") {
        return fail(MOTION_RENDER_QUEUE_UNSUPPORTED, "UNSUPPORTED");
      }
      const composition = getMotionComposition(host, compositionId);
      if (!composition) {
        return fail(`Motion composition not found: ${compositionId}`, "NOT_FOUND");
      }
      let range: { readonly startTime: number; readonly endTime: number } | undefined;
      if (hasRange) {
        const startTime = rangeStart ?? 0;
        const endTime = rangeEnd ?? composition.duration;
        if (
          startTime < 0 ||
          endTime > composition.duration ||
          !(startTime < endTime)
        ) {
          return fail(
            `range must satisfy 0 <= rangeStart < rangeEnd <= ${composition.duration}`,
            "INVALID_PARAMS",
          );
        }
        range = { startTime, endTime };
      }
      const requiresNative = motionRenderQueueFormatRequiresNative(format);
      if (requiresNative && args.acknowledgeH264Fallback !== true) {
        return fail(
          "Web render can't produce ProRes or alpha — this will encode H.264 without transparency. Pass acknowledgeH264Fallback:true to consent, or use the desktop app for ProRes/alpha.",
          "INVALID_PARAMS",
        );
      }
      const input: MotionRenderQueueAddInput = {
        compositionId,
        format,
        ...(range !== undefined ? { range } : {}),
        ...(scale !== undefined ? { resolutionScale: scale } : {}),
        ...(filename !== undefined ? { filename } : {}),
      };
      const result = host.motionRenderQueue.add(input);
      if ("error" in result) {
        return fail(result.error, "QUEUE_ADD_FAILED");
      }
      return ok(
        `Queued "${composition.name}" as ${format}`,
        {
          itemId: result.itemId,
          compositionId,
          format,
          ...(range !== undefined ? { range } : {}),
          ...(scale !== undefined ? { resolutionScale: scale } : {}),
        },
      );
    },
  },
  {
    name: "run_motion_render_queue",
    domain: "export",
    title: "Run motion render queue",
    description:
      "Render every queued (or previously failed) item in the motion render queue sequentially and return per-item outcomes (data.outcomes: itemId, status, encodedFormat, filename, error). Items whose cancel was requested are skipped as 'canceled'. Expensive — requires confirmation.",
    inputSchema: obj({}),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (_args, host) => {
      if (typeof host.motionRenderQueue?.run !== "function") {
        return fail(MOTION_RENDER_QUEUE_UNSUPPORTED, "UNSUPPORTED");
      }
      const runResult = await host.motionRenderQueue.run();
      if (runResult.alreadyRunning) {
        return ok(
          "Render queue is already running; no new run started.",
          { outcomes: [], alreadyRunning: true },
        );
      }
      const outcomes = runResult.outcomes;
      const completed = outcomes.filter((o) => o.status === "complete").length;
      const canceled = outcomes.filter((o) => o.status === "canceled").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      return ok(
        `Rendered ${outcomes.length} item(s): ${completed} complete, ${canceled} canceled, ${failed} failed`,
        { outcomes: outcomes.map((outcome) => ({ ...outcome })), alreadyRunning: false },
      );
    },
  },
  {
    name: "list_motion_render_queue",
    domain: "export",
    title: "List motion render queue",
    description:
      "List the current motion render queue items (data.items with itemId, compositionId, format, status, progress, and any range/resolutionScale/filename/error).",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.motionRenderQueue?.list !== "function") {
        return fail(MOTION_RENDER_QUEUE_UNSUPPORTED, "UNSUPPORTED");
      }
      const items = host.motionRenderQueue.list();
      return ok(`${items.length} render queue item(s)`, {
        items: items.map((item) => ({ ...item })),
      });
    },
  },
  {
    name: "cancel_motion_render_item",
    domain: "export",
    title: "Cancel motion render item",
    description:
      "Cancel a queued or in-progress motion render queue item by itemId. A queued item is canceled immediately; a rendering item stops at the next frame boundary. Returns whether the item was found.",
    inputSchema: obj({ itemId: str }, ["itemId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      const itemId = optionalString(args.itemId);
      if (!itemId) {
        return fail("itemId is required", "INVALID_PARAMS");
      }
      if (typeof host.motionRenderQueue?.cancel !== "function") {
        return fail(MOTION_RENDER_QUEUE_UNSUPPORTED, "UNSUPPORTED");
      }
      const canceled = host.motionRenderQueue.cancel(itemId);
      if (!canceled) {
        return fail(`Render queue item not found: ${itemId}`, "NOT_FOUND");
      }
      return ok(`Canceled render queue item ${itemId}`, { itemId });
    },
  }
];
