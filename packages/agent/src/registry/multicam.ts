import {
  RegisteredTool,
  fail,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  str,
} from "./shared";

export const multicamTools: RegisteredTool[] = [
  {
    name: "get_project_manifest",
    domain: "multicam",
    title: "Get multicam project manifest",
    description:
      "Return the exact openreel-multicam/v1 manifest for a camera group, including participants, camera subjects, sync reference, and hard constraints.",
    inputSchema: obj({ groupId: str }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      return ok("Loaded multicam manifest", await host.multicam.getManifest(optionalString(args.groupId)));
    },
  },
  {
    name: "get_activity_map",
    domain: "multicam",
    title: "Get multicam activity map",
    description:
      "Read the reusable .orma speech activity map for an optional millisecond range. Large maps are deterministically sampled to at most 2,000 points.",
    inputSchema: obj({ groupId: str, startMs: num, endMs: num }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      const startMs = optionalNumber(args.startMs);
      const endMs = optionalNumber(args.endMs);
      if ((startMs !== undefined && startMs < 0) || (endMs !== undefined && endMs < 0) ||
          (startMs !== undefined && endMs !== undefined && endMs <= startMs)) {
        return fail("Activity range must satisfy 0 <= startMs < endMs", "INVALID_PARAMS");
      }
      return ok("Loaded multicam activity map", await host.multicam.getActivityMap(
        optionalString(args.groupId),
        { startMs, endMs },
      ));
    },
  },
  {
    name: "get_transcript",
    domain: "multicam",
    title: "Get multicam transcript",
    description:
      "Read optional per-participant local Whisper transcript segments from the separate .orma artifact.",
    inputSchema: obj({ groupId: str, startMs: num, endMs: num }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      const startMs = optionalNumber(args.startMs);
      const endMs = optionalNumber(args.endMs);
      if ((startMs !== undefined && startMs < 0) || (endMs !== undefined && endMs < 0) ||
          (startMs !== undefined && endMs !== undefined && endMs <= startMs)) {
        return fail("Transcript range must satisfy 0 <= startMs < endMs", "INVALID_PARAMS");
      }
      return ok("Loaded multicam transcript", await host.multicam.getTranscript(
        optionalString(args.groupId),
        { startMs, endMs },
      ));
    },
  },
  {
    name: "set_edit_policy",
    domain: "multicam",
    title: "Set multicam edit policy",
    description:
      "Re-plan the automatic multicam edit from cached analysis. All values are schema-validated and manifest shot constraints remain hard bounds.",
    inputSchema: obj({
      groupId: str,
      strategy: { type: "string", enum: ["hold", "winner", "priority", "wide", "composite", "progressive"] },
      escalateTo: { type: "string", enum: ["winner", "priority", "wide", "composite", "progressive"] },
      priorityParticipantIds: { type: "array", items: str, maxItems: 16 },
      commitMs: { type: "number", minimum: 0, maximum: 5_000 },
      layoutEnterMs: { type: "number", minimum: 0, maximum: 5_000 },
      layoutExitMs: { type: "number", minimum: 0, maximum: 10_000 },
      minLayoutLifeMs: { type: "number", minimum: 100, maximum: 30_000 },
      maxLayoutChangesPerMinute: { type: "number", minimum: 1, maximum: 60 },
    }, ["groupId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      const groupId = optionalString(args.groupId);
      if (!groupId) return fail("groupId is required", "INVALID_PARAMS");
      const strategies = ["hold", "winner", "priority", "wide", "composite", "progressive"] as const;
      const escalations = ["winner", "priority", "wide", "composite", "progressive"] as const;
      const strategy = optionalString(args.strategy);
      const escalateTo = optionalString(args.escalateTo);
      if (strategy && !(strategies as readonly string[]).includes(strategy)) {
        return fail("strategy is invalid", "INVALID_PARAMS");
      }
      if (escalateTo && !(escalations as readonly string[]).includes(escalateTo)) {
        return fail("escalateTo is invalid", "INVALID_PARAMS");
      }
      const bounded = (
        key: string,
        minimum: number,
        maximum: number,
      ): number | undefined => {
        const value = optionalNumber(args[key]);
        if (value === undefined) return undefined;
        if (value < minimum || value > maximum) throw new Error(`${key} must be between ${minimum} and ${maximum}`);
        return value;
      };
      try {
        const updates: Record<string, unknown> = {};
        if (strategy) updates.strategy = strategy;
        if (escalateTo) updates.escalateTo = escalateTo;
        if (Array.isArray(args.priorityParticipantIds)) {
          if (args.priorityParticipantIds.length > 16 || args.priorityParticipantIds.some((id) => typeof id !== "string")) {
            return fail("priorityParticipantIds must contain at most 16 strings", "INVALID_PARAMS");
          }
          updates.priorityParticipantIds = args.priorityParticipantIds;
        }
        for (const [key, minimum, maximum] of [
          ["commitMs", 0, 5_000],
          ["layoutEnterMs", 0, 5_000],
          ["layoutExitMs", 0, 10_000],
          ["minLayoutLifeMs", 100, 30_000],
          ["maxLayoutChangesPerMinute", 1, 60],
        ] as const) {
          const value = bounded(key, minimum, maximum);
          if (value !== undefined) updates[key] = value;
        }
        return ok("Updated multicam edit policy", await host.multicam.setEditPolicy(groupId, updates));
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Invalid edit policy", "INVALID_PARAMS");
      }
    },
  },
  {
    name: "annotate_segment",
    domain: "multicam",
    title: "Annotate multicam segment",
    description: "Attach a concise planning note to a bounded multicam time range without modifying cached analysis.",
    inputSchema: obj({ groupId: str, startMs: num, endMs: num, note: str }, ["groupId", "startMs", "endMs", "note"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      const groupId = optionalString(args.groupId);
      const startMs = optionalNumber(args.startMs);
      const endMs = optionalNumber(args.endMs);
      const note = optionalString(args.note);
      if (!groupId || startMs === undefined || endMs === undefined || startMs < 0 || endMs <= startMs || !note || note.length > 500) {
        return fail("groupId, a valid millisecond range, and a note of at most 500 characters are required", "INVALID_PARAMS");
      }
      return ok("Annotated multicam segment", await host.multicam.annotateSegment({ groupId, startMs, endMs, note }));
    },
  },
  {
    name: "get_edit_summary",
    domain: "multicam",
    title: "Get multicam edit summary",
    description: "Summarize shots, layouts, pending cut review, annotations, and top deterministic social candidates.",
    inputSchema: obj({ groupId: str }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      return ok("Loaded multicam edit summary", await host.multicam.getEditSummary(optionalString(args.groupId)));
    },
  },
  {
    name: "override_cut",
    domain: "multicam",
    title: "Override multicam cut",
    description: "Accept, reject, nudge by at most 2 seconds, or assign a valid manifest camera to one generated cut.",
    inputSchema: obj({
      groupId: str,
      switchId: str,
      operation: { type: "string", enum: ["accept", "reject", "nudge", "set-camera"] },
      deltaMs: { type: "number", minimum: -2_000, maximum: 2_000 },
      cameraId: str,
    }, ["groupId", "switchId", "operation"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      const groupId = optionalString(args.groupId);
      const switchId = optionalString(args.switchId);
      const operation = optionalString(args.operation);
      const deltaMs = optionalNumber(args.deltaMs);
      const cameraId = optionalString(args.cameraId);
      if (!groupId || !switchId || !operation || !["accept", "reject", "nudge", "set-camera"].includes(operation)) {
        return fail("groupId, switchId, and a valid operation are required", "INVALID_PARAMS");
      }
      if (operation === "nudge" && (deltaMs === undefined || Math.abs(deltaMs) > 2_000)) {
        return fail("nudge requires deltaMs between -2000 and 2000", "INVALID_PARAMS");
      }
      if (operation === "set-camera" && !cameraId) {
        return fail("set-camera requires cameraId", "INVALID_PARAMS");
      }
      return ok("Applied multicam cut override", await host.multicam.overrideCut({
        groupId,
        switchId,
        operation: operation as "accept" | "reject" | "nudge" | "set-camera",
        deltaMs,
        cameraId,
      }));
    },
  },
  {
    name: "preview_frame",
    domain: "multicam",
    title: "Preview multicam frame",
    description: "Render a frame at a bounded millisecond time for visual inspection of the current multicam edit.",
    inputSchema: obj({ groupId: str, timeMs: { type: "number", minimum: 0 } }, ["groupId", "timeMs"]),
    readOnly: true,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      if (!host.multicam) return fail("Multicam tools are unavailable in this host", "UNSUPPORTED");
      const groupId = optionalString(args.groupId);
      const timeMs = optionalNumber(args.timeMs);
      if (!groupId || timeMs === undefined || timeMs < 0) {
        return fail("groupId and non-negative timeMs are required", "INVALID_PARAMS");
      }
      const result = await host.multicam.previewFrame(groupId, timeMs);
      return result.ok
        ? ok("Rendered multicam preview frame", result.data)
        : fail(result.error ?? "Preview frame failed", "PREVIEW_FAILED");
    },
  }
];
