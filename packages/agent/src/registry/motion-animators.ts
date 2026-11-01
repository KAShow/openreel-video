import {
  RegisteredTool,
  applyMotionTextAnimatorOverrides,
  asRecord,
  bool,
  commitMotionComposition,
  fail,
  genId,
  getMotionComposition,
  getMotionLayer,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  replaceMotionLayer,
  resolveShaderParams,
  str,
} from "./shared";
import {
  type MotionTextAnimator,
} from "@openreel/core/motion/types";
import {
  addMotionTextAnimator,
  createMotionTextAnimator,
  getMotionTextShaderAnimator,
  removeMotionTextAnimator,
  toggleMotionTextAnimator,
  updateMotionTextAnimator,
} from "@openreel/core/motion/motion-text-animators";
import {
  getMotionShaderDef,
} from "@openreel/core/motion/shaders/index";

export const motionAnimatorTools: RegisteredTool[] = [
  {
    name: "add_motion_text_animator",
    domain: "motion",
    title: "Add motion text animator",
    description:
      "Add a per-glyph text animator preset (e.g. text-reveal-up, text-type-on) to a text layer. Returns the animatorId. Optional one-call overrides on top of the preset (each field independently merged): name; enabled (start disabled with false); selector { basedOn: characters|words, start (0-100), end (0-100), offset }; timing { startTime, duration, stagger, direction: forward|reverse|center, easing: linear|ease|ease-in|ease-out }; properties { position {x,y}, scale {x,y}, rotation (deg), opacity (0-1) } (these are the from-values glyphs animate from toward the rest state).",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        presetId: str,
        name: str,
        enabled: bool,
        selector: { type: "object" },
        timing: { type: "object" },
        properties: { type: "object" },
      },
      ["compositionId", "layerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "text") {
        return fail("Text animators require a text layer", "INVALID_PARAMS");
      }
      const presetId = optionalString(args.presetId);
      let animator: MotionTextAnimator;
      try {
        animator = createMotionTextAnimator(presetId, genId());
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Invalid text animator preset",
          "INVALID_PARAMS",
        );
      }
      const overridden = applyMotionTextAnimatorOverrides(animator, args);
      if ("error" in overridden) {
        return fail(overridden.error, "INVALID_PARAMS");
      }
      const enabled = typeof args.enabled === "boolean" ? args.enabled : undefined;
      animator = enabled !== undefined ? { ...overridden, enabled } : overridden;
      const nextLayer = addMotionTextAnimator(layer, animator);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Added text animator", {
            compositionId: composition.id,
            layerId: layer.id,
            animatorId: animator.id,
          })
        : result;
    },
  },
  {
    name: "update_motion_text_animator",
    domain: "motion",
    title: "Update motion text animator",
    description:
      "Update an existing per-glyph text animator on a text layer by animatorId. Each field is optional and merged onto the current animator (unspecified fields are left intact): name; enabled (routes through the enable/disable path); selector { basedOn: characters|words, start (0-100), end (0-100), offset }; timing { startTime, duration, stagger, direction: forward|reverse|center, easing: linear|ease|ease-in|ease-out }; properties { position {x,y}, scale {x,y}, rotation (deg), opacity (0-1) }. Nested selector/timing/properties objects are themselves partially merged, so passing timing:{duration} changes only the duration.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        animatorId: str,
        name: str,
        enabled: bool,
        selector: { type: "object" },
        timing: { type: "object" },
        properties: { type: "object" },
      },
      ["compositionId", "layerId", "animatorId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "text") {
        return fail("Text animators require a text layer", "INVALID_PARAMS");
      }
      const animatorId = optionalString(args.animatorId);
      if (!animatorId) return fail("animatorId is required", "INVALID_PARAMS");
      const existing = (layer.textAnimators ?? []).find(
        (animator) => animator.id === animatorId,
      );
      if (!existing) return fail("Motion text animator not found", "NOT_FOUND");
      const overridden = applyMotionTextAnimatorOverrides(existing, args);
      if ("error" in overridden) {
        return fail(overridden.error, "INVALID_PARAMS");
      }
      let nextLayer = updateMotionTextAnimator(layer, animatorId, () => overridden);
      if (typeof args.enabled === "boolean") {
        nextLayer = toggleMotionTextAnimator(nextLayer, animatorId, args.enabled);
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated text animator", {
            compositionId: composition.id,
            layerId: layer.id,
            animatorId,
          })
        : result;
    },
  },
  {
    name: "add_motion_text_shader_animator",
    domain: "motion",
    title: "Add motion text shader animator",
    description:
      "Add a per-glyph GPU shader animator (glyph-dissolve|glyph-glow-wave|chromatic-cascade|scanline-materialize) to a text layer. shaderId must be a text shader from list_motion_shaders (category 'text'). Pass shaderId='' (empty string) to CLEAR/detach the shader from the layer's text animator (back to no GPU shader) — returns { cleared: true }. The shader runs per glyph driven by the animator's staggered progress. Supplied params are clamped to each param's [min,max]; unknown names are ignored and missing ones use the shader default. Optional stagger/duration tune the per-glyph timing. Returns the new animatorId.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        shaderId: str,
        params: obj({}, []),
        stagger: num,
        duration: num,
      },
      ["compositionId", "layerId", "shaderId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "text") {
        return fail("Text shader animators require a text layer", "INVALID_PARAMS");
      }
      if (typeof args.shaderId === "string" && args.shaderId.trim().length === 0) {
        const existingAnimator = getMotionTextShaderAnimator(layer);
        if (!existingAnimator) {
          return ok("No text shader animator to clear", {
            compositionId: composition.id,
            layerId: layer.id,
            cleared: true,
          });
        }
        const clearedLayer = updateMotionTextAnimator(
          layer,
          existingAnimator.id,
          (animator) => {
            const { shader: _shader, ...rest } = animator;
            return rest;
          },
        );
        const clearResult = await commitMotionComposition(
          host,
          replaceMotionLayer(composition, layer.id, clearedLayer),
        );
        return clearResult.ok
          ? ok("Cleared text shader animator", {
              compositionId: composition.id,
              layerId: layer.id,
              animatorId: existingAnimator.id,
              cleared: true,
            })
          : clearResult;
      }
      const shaderId = optionalString(args.shaderId);
      if (!shaderId) return fail("shaderId is required", "INVALID_PARAMS");
      const def = getMotionShaderDef(shaderId);
      if (!def || def.category !== "text") {
        return fail(`Unknown text shader: ${shaderId}`, "INVALID_PARAMS");
      }
      const params = resolveShaderParams(def, asRecord(args.params));
      const stagger = optionalNumber(args.stagger);
      const duration = optionalNumber(args.duration);
      const applyTiming = (
        timing: MotionTextAnimator["timing"],
      ): MotionTextAnimator["timing"] => ({
        ...timing,
        ...(stagger !== undefined ? { stagger: Math.max(0, stagger) } : {}),
        ...(duration !== undefined ? { duration: Math.max(0, duration) } : {}),
      });

      const existing = getMotionTextShaderAnimator(layer);
      let nextLayer: typeof layer;
      let animatorId: string;
      if (existing) {
        animatorId = existing.id;
        nextLayer = updateMotionTextAnimator(layer, existing.id, (animator) => ({
          ...animator,
          timing: applyTiming(animator.timing),
          shader: { shaderId, params },
        }));
      } else {
        let baseAnimator;
        try {
          baseAnimator = createMotionTextAnimator("text-reveal-up", genId());
        } catch (error) {
          return fail(
            error instanceof Error ? error.message : "Invalid text animator preset",
            "INVALID_PARAMS",
          );
        }
        animatorId = baseAnimator.id;
        nextLayer = addMotionTextAnimator(layer, {
          ...baseAnimator,
          timing: applyTiming(baseAnimator.timing),
          shader: { shaderId, params },
        });
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(
            existing
              ? `Updated ${shaderId} text shader animator`
              : `Added ${shaderId} text shader animator`,
            {
              compositionId: composition.id,
              layerId: layer.id,
              animatorId,
              shaderId,
              params,
            },
          )
        : result;
    },
  },
  {
    name: "remove_motion_text_animator",
    domain: "motion",
    title: "Remove motion text animator",
    description: "Remove a text animator from a text layer by animatorId.",
    inputSchema: obj({ compositionId: str, layerId: str, animatorId: str }, [
      "compositionId",
      "layerId",
      "animatorId",
    ]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "text") {
        return fail("Text animators require a text layer", "INVALID_PARAMS");
      }
      const animatorId = optionalString(args.animatorId);
      if (!animatorId) return fail("animatorId is required", "INVALID_PARAMS");
      const nextLayer = removeMotionTextAnimator(layer, animatorId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed text animator", { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  }
];
