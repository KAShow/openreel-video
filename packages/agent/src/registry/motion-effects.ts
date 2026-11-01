import {
  MOTION_BLEND_MODE_IDS,
  MOTION_EFFECT_PARAMETERS,
  MOTION_EFFECT_TYPES,
  MOTION_TRACK_MATTE_TYPES,
  RegisteredTool,
  asRecord,
  bool,
  clampNumber,
  commitMotionComposition,
  fail,
  genId,
  getMotionComposition,
  getMotionLayer,
  isMotionShaderCategory,
  kebabCase,
  normalizeAiShaderParams,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseMaskPathPoints,
  parseMaskPolygonPoints,
  parseStringArray,
  replaceMotionLayer,
  resolveShaderParams,
  shortGlslHash,
  str,
} from "./shared";
import {
  type BlendMode,
} from "@openreel/core/video/types";
import {
  type MotionEffectNumericParameter,
  type MotionEffectParameterName,
  addMotionLayerEffect,
  createMotionEffect,
  createMotionShaderEffect,
  removeMotionLayerEffect,
  reorderMotionLayerEffect,
  setMotionEffectParameterValue,
  toggleMotionLayerEffect,
  transferMotionEffectStack,
  updateMotionLayerEffect,
} from "@openreel/core/motion/motion-effects";
import {
  type MotionEffectType,
  type MotionLayer,
  type MotionMaskMode,
  type MotionMaskShape,
  type MotionShaderEffect,
  type MotionShapeLayer,
  type MotionTextLayer,
  type MotionTrackMatteType,
} from "@openreel/core/motion/types";
import {
  type MotionShaderDef,
  type MotionShaderParamDef,
  getMotionShaderDef,
  getMotionShaderEffectDefs,
  getMotionShaderFillDefs,
  getMotionShaderTextDefs,
  listGeneratedMotionShaders,
} from "@openreel/core/motion/shaders/index";
import {
  type MotionShapePathPoint,
  buildMotionPathData,
} from "@openreel/core/motion/motion-shape-path";
import {
  addMotionLayerMask,
  createMotionMask,
  normalizeMaskKeyframeTime,
  removeMotionLayerMask,
  transferMotionMaskStack,
  updateMotionLayerMask,
  upsertMotionMaskPathKeyframe,
} from "@openreel/core/motion/motion-masks";
import {
  clearMotionLayerTrackMatte,
  setMotionLayerTrackMatte,
} from "@openreel/core/motion/motion-track-mattes";
import {
  validateMotionShaderSource,
} from "@openreel/core/motion/motion-shader-validator";

export const motionEffectTools: RegisteredTool[] = [
  {
    name: "list_motion_shaders",
    domain: "motion",
    title: "List motion shaders",
    description:
      "Enumerate the built-in GPU shader library for Motion Creator. Returns fill shaders (procedural fills for shape/text layers), effect shaders (post-process effects on any visual layer), and text shaders (per-glyph animator shaders for text layers), each with its parameters (name, label, type, min, max, default, step) and its collection ('Paper' for the Paper Design catalog, null for the original built-ins). Use before set_motion_shader_fill / add_motion_shader_effect / add_motion_text_shader_animator to pick a valid shaderId and know its params. Optional category filter: 'fill', 'effect', or 'text'. Optional collection filter (e.g. 'Paper') narrows to one collection; an unknown collection returns empty lists, not an error.",
    inputSchema: obj({ category: str, collection: str }, []),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args) => {
      const toInfo = (def: MotionShaderDef) => ({
        id: def.id,
        name: def.name,
        category: def.category,
        collection: def.collection ?? null,
        params: def.params.map((p: MotionShaderParamDef) => ({
          name: p.name,
          label: p.label,
          type: p.type,
          min: p.min,
          max: p.max,
          default: p.default,
          step: p.step,
          control: p.control ?? null,
        })),
      });
      const category = optionalString(args.category);
      const collection = optionalString(args.collection);
      const inCollection = (def: MotionShaderDef): boolean =>
        collection === undefined || (def.collection ?? null) === collection;
      const fills = getMotionShaderFillDefs().filter(inCollection).map(toInfo);
      const effects = getMotionShaderEffectDefs().filter(inCollection).map(toInfo);
      const text = getMotionShaderTextDefs().filter(inCollection).map(toInfo);
      if (category === "fill") return ok(`${fills.length} fill shaders`, { fills });
      if (category === "effect") return ok(`${effects.length} effect shaders`, { effects });
      if (category === "text") return ok(`${text.length} text shaders`, { text });
      return ok(
        `${fills.length} fill + ${effects.length} effect + ${text.length} text shaders`,
        { fills, effects, text },
      );
    },
  },
  {
    name: "create_ai_shader",
    domain: "motion",
    title: "Create AI shader",
    description:
      "Register a new AI-authored GPU shader (GLSL + params) into the project's shader library so it can be used like a built-in via set_motion_shader_fill / add_motion_effect / add_motion_text_shader_animator. category is 'fill', 'effect', or 'text'. glsl must be a WebGL2 GLSL ES 3.00 fragment shader following the authoring contract (#version 300 es; in vec2 vUv; uniform vec2 u_resolution; uniform float u_time; out vec4 fragColor; effect/text also declare uniform sampler2D u_input; text also uniform float u_progress; fills must NOT sample u_input). params is an array of { name, label, min, max, default, step, type?, control? }. If the shader fails the contract or GLSL compile, the tool returns INVALID_PARAMS with the error log so you can repair the source and retry. The created shaderId is namespaced 'ai-<slug>-<hash>' and persists with the project.",
    inputSchema: obj(
      {
        name: str,
        category: str,
        glsl: str,
        params: { type: "array" },
      },
      ["name", "category", "glsl"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const name = optionalString(args.name);
      if (!name) return fail("name is required", "INVALID_PARAMS");
      const category = optionalString(args.category);
      if (!isMotionShaderCategory(category)) {
        return fail("category must be one of fill, effect, text", "INVALID_PARAMS");
      }
      const glsl = typeof args.glsl === "string" ? args.glsl : "";
      if (glsl.trim().length === 0) {
        return fail("glsl is required", "INVALID_PARAMS");
      }
      const normalizedParams = normalizeAiShaderParams(args.params);
      if (!normalizedParams.ok) {
        return fail(normalizedParams.error, "INVALID_PARAMS");
      }
      const validation = validateMotionShaderSource(glsl, category);
      if (!validation.ok) {
        return fail(`Shader failed to compile: ${validation.error}`, "INVALID_PARAMS");
      }
      const def: MotionShaderDef = {
        id: `ai-${kebabCase(name)}-${shortGlslHash(glsl)}`,
        name,
        category,
        glsl,
        params: normalizedParams.params,
        origin: "generated",
      };
      const result = await host.applyAction({
        type: "project/registerGeneratedShader",
        id: genId(),
        timestamp: Date.now(),
        params: { def },
      });
      return result.success
        ? ok(`Created shader ${def.id}`, { shaderId: def.id, category: def.category })
        : fail(result.error?.message ?? "Failed to register generated shader", result.error?.code);
    },
  },
  {
    name: "list_ai_shaders",
    domain: "motion",
    title: "List AI shaders",
    description:
      "List the AI-authored (generated) shaders registered in the current project, each with its id, name, category, and parameters. These also appear in list_motion_shaders under their category.",
    inputSchema: obj({}, []),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (_args, host) => {
      host.requireOpenProject();
      const shaders = listGeneratedMotionShaders().map((def) => ({
        id: def.id,
        name: def.name,
        category: def.category,
        params: def.params.map((p: MotionShaderParamDef) => ({
          name: p.name,
          label: p.label,
          min: p.min,
          max: p.max,
          default: p.default,
          step: p.step,
          type: p.type,
          control: p.control ?? null,
        })),
      }));
      return ok(`${shaders.length} generated shaders`, { shaders });
    },
  },
  {
    name: "remove_ai_shader",
    domain: "motion",
    title: "Remove AI shader",
    description:
      "Remove an AI-authored (generated) shader from the project's shader library by its shaderId (as returned by create_ai_shader / list_ai_shaders). Built-in shaders cannot be removed.",
    inputSchema: obj({ shaderId: str }, ["shaderId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const shaderId = optionalString(args.shaderId);
      if (!shaderId) return fail("shaderId is required", "INVALID_PARAMS");
      const exists = listGeneratedMotionShaders().some((def) => def.id === shaderId);
      if (!exists) return fail(`Generated shader not found: ${shaderId}`, "NOT_FOUND");
      const result = await host.applyAction({
        type: "project/removeGeneratedShader",
        id: genId(),
        timestamp: Date.now(),
        params: { shaderId },
      });
      return result.success
        ? ok(`Removed shader ${shaderId}`, { shaderId })
        : fail(result.error?.message ?? "Failed to remove generated shader", result.error?.code);
    },
  },
  {
    name: "set_motion_shader_fill",
    domain: "motion",
    title: "Set motion shader fill",
    description:
      "Paint a shape or text layer with a procedural GPU fill shader. shaderId must be a fill shader from list_motion_shaders (category 'fill'). Supplied params are clamped to each param's [min,max]; unknown param names are ignored and missing ones use the shader default. Shape layers store it on style.fill; text layers store it on style.fillShader (overriding color).",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      shaderId: str,
      params: obj({}, []),
    }, ["compositionId", "layerId", "shaderId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const shaderId = optionalString(args.shaderId);
      if (!shaderId) return fail("shaderId is required", "INVALID_PARAMS");
      const def = getMotionShaderDef(shaderId);
      if (!def || def.category !== "fill") {
        return fail(`Unknown fill shader: ${shaderId}`, "INVALID_PARAMS");
      }
      const params = resolveShaderParams(def, asRecord(args.params));
      let nextLayer: MotionLayer;
      if (layer.type === "shape") {
        nextLayer = {
          ...layer,
          style: {
            ...layer.style,
            fill: {
              type: "shader",
              opacity: layer.style.fill.opacity ?? 1,
              shader: { shaderId, params },
            },
          },
        } as MotionShapeLayer;
      } else if (layer.type === "text") {
        nextLayer = {
          ...layer,
          style: { ...layer.style, fillShader: { shaderId, params } },
        } as MotionTextLayer;
      } else {
        return fail("Shader fill applies only to shape or text layers", "INVALID_PARAMS");
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Set ${shaderId} shader fill`, {
            compositionId: composition.id,
            layerId: layer.id,
            shaderId,
            params,
            layerType: layer.type,
          })
        : result;
    },
  },
  {
    name: "clear_motion_shader_fill",
    domain: "motion",
    title: "Clear motion shader fill",
    description:
      "Remove a procedural GPU fill shader previously applied with set_motion_shader_fill. For a text layer this strips style.fillShader so the layer falls back to its solid color/gradient. For a shape layer this resets style.fill.type to 'solid' (keeping the existing color and opacity) and drops the shader reference. Succeeds as a no-op if the layer has no shader fill. Applies only to shape or text layers.",
    inputSchema: obj({ compositionId: str, layerId: str }, ["compositionId", "layerId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      let nextLayer: MotionLayer;
      if (layer.type === "text") {
        const { fillShader: _fillShader, ...restStyle } = layer.style;
        nextLayer = { ...layer, style: restStyle } as MotionTextLayer;
      } else if (layer.type === "shape") {
        const { shader: _shader, ...restFill } = layer.style.fill;
        nextLayer = {
          ...layer,
          style: {
            ...layer.style,
            fill: {
              ...restFill,
              type: "solid",
              color: layer.style.fill.color ?? "#ffffff",
              opacity: layer.style.fill.opacity ?? 1,
            },
          },
        } as MotionShapeLayer;
      } else {
        return fail("Shader fill applies only to shape or text layers", "INVALID_PARAMS");
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Cleared motion shader fill", {
            compositionId: composition.id,
            layerId: layer.id,
            layerType: layer.type,
          })
        : result;
    },
  },
  {
    name: "add_motion_effect",
    domain: "motion",
    title: "Add motion effect",
    description:
      "Add an effect (blur|drop-shadow|glow|color-adjust|invert|grayscale|sepia|levels|sharpen|posterize|directional-blur|noise|radial-blur|displace|backdrop-blur) to a layer with sensible preset defaults (backdrop-blur frosts what is behind the layer, radius ~16). Returns the new effectId.",
    inputSchema: obj({ compositionId: str, layerId: str, effectType: str }, [
      "compositionId",
      "layerId",
      "effectType",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const effectType = optionalString(args.effectType) as MotionEffectType | undefined;
      if (!effectType || !MOTION_EFFECT_TYPES.has(effectType)) {
        return fail(`Unknown effect type: ${String(args.effectType)}`, "INVALID_PARAMS");
      }
      const effect = createMotionEffect(effectType, genId());
      const nextLayer = addMotionLayerEffect(layer, effect);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added ${effectType} effect`, {
            compositionId: composition.id,
            layerId: layer.id,
            effectId: effect.id,
          })
        : result;
    },
  },
  {
    name: "add_motion_shader_effect",
    domain: "motion",
    title: "Add motion shader effect",
    description:
      "Add a GPU post-process shader effect to any visual layer. shaderId must be an effect shader from list_motion_shaders (category 'effect'). Supplied params are clamped to each param's [min,max]; unknown param names are ignored and missing ones use the shader default. Returns the new effectId; edit params later with update_motion_effect.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      shaderId: str,
      params: obj({}, []),
    }, ["compositionId", "layerId", "shaderId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const shaderId = optionalString(args.shaderId);
      if (!shaderId) return fail("shaderId is required", "INVALID_PARAMS");
      const def = getMotionShaderDef(shaderId);
      if (!def || def.category !== "effect") {
        return fail(`Unknown effect shader: ${shaderId}`, "INVALID_PARAMS");
      }
      const base = createMotionShaderEffect(shaderId, genId());
      const effect: MotionShaderEffect = {
        ...base,
        params: { ...base.params, ...resolveShaderParams(def, asRecord(args.params)) },
      };
      const nextLayer = addMotionLayerEffect(layer, effect);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added ${shaderId} shader effect`, {
            compositionId: composition.id,
            layerId: layer.id,
            effectId: effect.id,
            shaderId,
            params: effect.params,
          })
        : result;
    },
  },
  {
    name: "update_motion_effect",
    domain: "motion",
    title: "Update motion effect",
    description:
      "Update a numeric effect parameter (radius|opacity|blur|offsetX|offsetY|intensity|brightness|contrast|saturation|hue|value|...) by effectId. Pass parameter='value' to statically set the control value of an expression-control effect (slider/checkbox/angle) — the same knob add_motion_expression_control seeds and that effect(\"<name>\")(\"value\") reads. Also accepts any parameter of a shader effect, referenced by that shader's param name (as listed by list_motion_shaders).",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      effectId: str,
      parameter: str,
      value: num,
    }, ["compositionId", "layerId", "effectId", "parameter", "value"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const effectId = optionalString(args.effectId);
      if (!effectId) return fail("effectId is required", "INVALID_PARAMS");
      const parameter = optionalString(args.parameter);
      if (!parameter) return fail("parameter is required", "INVALID_PARAMS");
      const value = optionalNumber(args.value);
      if (value === undefined) return fail("value must be a finite number", "INVALID_PARAMS");
      const target = (layer.effects ?? []).find((effect) => effect.id === effectId);
      if (!target) return fail("Motion effect not found", "NOT_FOUND");
      let resolvedParameter: MotionEffectParameterName;
      if (target.type === "shader") {
        const shaderDef = getMotionShaderDef(target.shaderId);
        if (!shaderDef || !shaderDef.params.some((param) => param.name === parameter)) {
          return fail(`Unknown shader effect parameter: ${parameter}`, "INVALID_PARAMS");
        }
        resolvedParameter = parameter;
      } else if (MOTION_EFFECT_PARAMETERS.has(parameter as MotionEffectNumericParameter)) {
        resolvedParameter = parameter as MotionEffectNumericParameter;
      } else {
        return fail(`Unknown effect parameter: ${parameter}`, "INVALID_PARAMS");
      }
      const nextLayer = updateMotionLayerEffect(layer, effectId, (effect) =>
        setMotionEffectParameterValue(effect, resolvedParameter, value),
      );
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Updated effect ${parameter}`, { compositionId: composition.id, layerId: layer.id, effectId })
        : result;
    },
  },
  {
    name: "transfer_motion_effect_stack",
    domain: "motion",
    title: "Transfer motion effect stack",
    description:
      "Copy a source layer's complete ordered effect stack, including animated parameters and expressions, to one or more target layers. mode is append (default) or replace. All pasted effects, keyframes, and expressions receive independent identities.",
    inputSchema: obj(
      {
        compositionId: str,
        sourceLayerId: str,
        targetLayerIds: { type: "array" },
        mode: str,
      },
      ["compositionId", "sourceLayerId", "targetLayerIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const source = getMotionLayer(composition, args.sourceLayerId);
      if (!source) return fail("Source motion layer not found", "NOT_FOUND");
      const targetLayerIds = parseStringArray(args.targetLayerIds);
      if (!targetLayerIds?.length) {
        return fail("targetLayerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      const mode = optionalString(args.mode) ?? "append";
      if (mode !== "append" && mode !== "replace") {
        return fail("mode must be append or replace", "INVALID_PARAMS");
      }
      const targetIds = new Set(targetLayerIds.filter((id) => id !== source.id));
      const missing = [...targetIds].filter(
        (id) => !composition.layers.some((layer) => layer.id === id),
      );
      if (missing.length) {
        return fail(`Motion layers not found: ${missing.join(", ")}`, "NOT_FOUND");
      }
      const pasted: Record<string, readonly string[]> = {};
      const layers = composition.layers.map((layer) => {
        if (!targetIds.has(layer.id)) return layer;
        const result = transferMotionEffectStack(source, layer, mode, () => genId());
        pasted[layer.id] = result.pastedEffectIds;
        return result.layer;
      });
      const result = await commitMotionComposition(host, {
        ...composition,
        layers,
        modifiedAt: Date.now(),
      });
      return result.ok
        ? ok(`Transferred effect stack to ${targetIds.size} layers`, {
            compositionId: composition.id,
            sourceLayerId: source.id,
            targetLayerIds: [...targetIds],
            pastedEffectIds: pasted,
            mode,
          })
        : result;
    },
  },
  {
    name: "remove_motion_effect",
    domain: "motion",
    title: "Remove motion effect",
    description: "Remove an effect from a layer by effectId.",
    inputSchema: obj({ compositionId: str, layerId: str, effectId: str }, [
      "compositionId",
      "layerId",
      "effectId",
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
      const effectId = optionalString(args.effectId);
      if (!effectId) return fail("effectId is required", "INVALID_PARAMS");
      const nextLayer = removeMotionLayerEffect(layer, effectId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed motion effect", { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  },
  {
    name: "toggle_motion_effect",
    domain: "motion",
    title: "Toggle motion effect",
    description: "Enable or disable an effect on a layer by effectId.",
    inputSchema: obj({ compositionId: str, layerId: str, effectId: str, enabled: bool }, [
      "compositionId",
      "layerId",
      "effectId",
      "enabled",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const effectId = optionalString(args.effectId);
      if (!effectId) return fail("effectId is required", "INVALID_PARAMS");
      if (typeof args.enabled !== "boolean") {
        return fail("enabled must be a boolean", "INVALID_PARAMS");
      }
      const nextLayer = toggleMotionLayerEffect(layer, effectId, args.enabled);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`${args.enabled ? "Enabled" : "Disabled"} effect`, {
            compositionId: composition.id,
            layerId: layer.id,
            effectId,
          })
        : result;
    },
  },
  {
    name: "reorder_motion_effect",
    domain: "motion",
    title: "Reorder motion effect",
    description:
      "Move an effect one slot within a layer's effect stack. direction is 'up' (renders earlier — closer to the top of the stack) or 'down' (renders later). Effect order matters: later effects process the output of earlier ones. Returns INVALID_PARAMS if the effect is already at the top (up) or bottom (down) and cannot move further.",
    inputSchema: obj({ compositionId: str, layerId: str, effectId: str, direction: str }, [
      "compositionId",
      "layerId",
      "effectId",
      "direction",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const effectId = optionalString(args.effectId);
      if (!effectId) return fail("effectId is required", "INVALID_PARAMS");
      const direction = optionalString(args.direction);
      if (direction !== "up" && direction !== "down") {
        return fail("direction must be 'up' or 'down'", "INVALID_PARAMS");
      }
      const effects = layer.effects ?? [];
      const index = effects.findIndex((effect) => effect.id === effectId);
      if (index < 0) return fail("Motion effect not found", "NOT_FOUND");
      const step = direction === "up" ? -1 : 1;
      const nextIndex = index + step;
      if (nextIndex < 0 || nextIndex >= effects.length) {
        return fail(
          `Effect is already at the ${direction === "up" ? "top" : "bottom"} of the stack`,
          "INVALID_PARAMS",
        );
      }
      const nextLayer = reorderMotionLayerEffect(layer, effectId, step);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Moved effect ${direction}`, {
            compositionId: composition.id,
            layerId: layer.id,
            effectId,
            order: (nextLayer.effects ?? []).map((effect) => effect.id),
          })
        : result;
    },
  },
  {
    name: "add_motion_mask",
    domain: "motion",
    title: "Add motion mask",
    description:
      "Add a rectangle, ellipse, polygon, or path (bezier) mask to a layer. Optional: mode (add|subtract), inverted, feather, expansion (px grow/shrink of the mask edge; positive grows), opacity (0-1 mask strength); for polygon a `points` array of {x,y} normalized [0,1] vertices; for path a `pathPoints` array of >=3 {x,y,inX?,inY?,outX?,outY?} vertices in layer-local pixel coordinates (handles optional). Returns the new maskId.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      shape: str,
      mode: str,
      inverted: bool,
      feather: num,
      expansion: num,
      opacity: num,
      points: { type: "array" },
      pathPoints: { type: "array" },
    }, ["compositionId", "layerId", "shape"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const shape = optionalString(args.shape) as MotionMaskShape | undefined;
      if (
        shape !== "rectangle" &&
        shape !== "ellipse" &&
        shape !== "polygon" &&
        shape !== "path"
      ) {
        return fail(
          "shape must be rectangle, ellipse, polygon, or path",
          "INVALID_PARAMS",
        );
      }
      const mode = optionalString(args.mode) as MotionMaskMode | undefined;
      if (mode !== undefined && mode !== "add" && mode !== "subtract") {
        return fail("mode must be add or subtract", "INVALID_PARAMS");
      }
      let pathPoints: readonly MotionShapePathPoint[] | undefined;
      if (shape === "path") {
        pathPoints = parseMaskPathPoints(args.pathPoints);
        if (!pathPoints) {
          return fail(
            "path masks require a pathPoints array of >=3 finite {x,y} vertices (layer-local pixels)",
            "INVALID_PARAMS",
          );
        }
      }
      const points = parseMaskPolygonPoints(args.points);
      const base = createMotionMask(shape === "path" ? "polygon" : shape, genId());
      let mask =
        shape === "path" && pathPoints
          ? { ...base, name: "Path Mask", shape, points: undefined, pathPoints }
          : base;
      const expansion = optionalNumber(args.expansion);
      const opacity = optionalNumber(args.opacity);
      if (
        mode ||
        typeof args.inverted === "boolean" ||
        optionalNumber(args.feather) !== undefined ||
        expansion !== undefined ||
        opacity !== undefined ||
        (shape === "polygon" && points)
      ) {
        mask = {
          ...mask,
          mode: mode ?? mask.mode,
          inverted: typeof args.inverted === "boolean" ? args.inverted : mask.inverted,
          feather: optionalNumber(args.feather) ?? mask.feather,
          ...(expansion !== undefined ? { expansion } : {}),
          ...(opacity !== undefined ? { opacity: clampNumber(opacity, 0, 1) } : {}),
          points: shape === "polygon" && points ? points : mask.points,
        };
      }
      const nextLayer = addMotionLayerMask(layer, mask);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added ${shape} mask`, {
            compositionId: composition.id,
            layerId: layer.id,
            maskId: mask.id,
          })
        : result;
    },
  },
  {
    name: "transfer_motion_mask_stack",
    domain: "motion",
    title: "Transfer motion mask stack",
    description:
      "Copy a source layer's complete mask stack, including animated mask properties, path keyframes, and expressions, to one or more target layers. mode is append (default) or replace. Every pasted mask and animation identity is regenerated.",
    inputSchema: obj(
      {
        compositionId: str,
        sourceLayerId: str,
        targetLayerIds: { type: "array" },
        mode: str,
      },
      ["compositionId", "sourceLayerId", "targetLayerIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const source = getMotionLayer(composition, args.sourceLayerId);
      if (!source) return fail("Source motion layer not found", "NOT_FOUND");
      const targetLayerIds = parseStringArray(args.targetLayerIds);
      if (!targetLayerIds?.length) {
        return fail("targetLayerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      const mode = optionalString(args.mode) ?? "append";
      if (mode !== "append" && mode !== "replace") {
        return fail("mode must be append or replace", "INVALID_PARAMS");
      }
      const targetIds = new Set(targetLayerIds.filter((id) => id !== source.id));
      const missing = [...targetIds].filter(
        (id) => !composition.layers.some((layer) => layer.id === id),
      );
      if (missing.length) {
        return fail(`Motion layers not found: ${missing.join(", ")}`, "NOT_FOUND");
      }
      const pasted: Record<string, readonly string[]> = {};
      const layers = composition.layers.map((layer) => {
        if (!targetIds.has(layer.id)) return layer;
        const result = transferMotionMaskStack(source, layer, mode, () => genId());
        pasted[layer.id] = result.pastedMaskIds;
        return result.layer;
      });
      const result = await commitMotionComposition(host, {
        ...composition,
        layers,
        modifiedAt: Date.now(),
      });
      return result.ok
        ? ok(`Transferred mask stack to ${targetIds.size} layers`, {
            compositionId: composition.id,
            sourceLayerId: source.id,
            targetLayerIds: [...targetIds],
            pastedMaskIds: pasted,
            mode,
          })
        : result;
    },
  },
  {
    name: "update_motion_mask",
    domain: "motion",
    title: "Update motion mask",
    description:
      "Update a mask's geometry/options by maskId. Optional normalized bounds (x|y|width|height in 0..1), rotation, mode, inverted, feather, expansion, opacity.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      maskId: str,
      x: num,
      y: num,
      width: num,
      height: num,
      rotation: num,
      mode: str,
      inverted: bool,
      feather: num,
      expansion: num,
      opacity: num,
    }, ["compositionId", "layerId", "maskId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const maskId = optionalString(args.maskId);
      if (!maskId) return fail("maskId is required", "INVALID_PARAMS");
      if (!(layer.masks ?? []).some((mask) => mask.id === maskId)) {
        return fail("Motion mask not found", "NOT_FOUND");
      }
      const mode = optionalString(args.mode);
      if (mode !== undefined && mode !== "add" && mode !== "subtract") {
        return fail("mode must be add or subtract", "INVALID_PARAMS");
      }
      const nextLayer = updateMotionLayerMask(layer, maskId, (mask) => ({
        ...mask,
        x: optionalNumber(args.x) ?? mask.x,
        y: optionalNumber(args.y) ?? mask.y,
        width: optionalNumber(args.width) ?? mask.width,
        height: optionalNumber(args.height) ?? mask.height,
        rotation: optionalNumber(args.rotation) ?? mask.rotation,
        mode: (mode as MotionMaskMode | undefined) ?? mask.mode,
        inverted: typeof args.inverted === "boolean" ? args.inverted : mask.inverted,
        feather: optionalNumber(args.feather) ?? mask.feather,
        expansion: optionalNumber(args.expansion) ?? mask.expansion,
        opacity: optionalNumber(args.opacity) ?? mask.opacity,
      }));
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated motion mask", { compositionId: composition.id, layerId: layer.id, maskId })
        : result;
    },
  },
  {
    name: "remove_motion_mask",
    domain: "motion",
    title: "Remove motion mask",
    description: "Remove a mask from a layer by maskId.",
    inputSchema: obj({ compositionId: str, layerId: str, maskId: str }, [
      "compositionId",
      "layerId",
      "maskId",
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
      const maskId = optionalString(args.maskId);
      if (!maskId) return fail("maskId is required", "INVALID_PARAMS");
      const nextLayer = removeMotionLayerMask(layer, maskId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed motion mask", { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  },
  {
    name: "set_motion_mask_path",
    domain: "motion",
    title: "Set motion mask path",
    description:
      "Replace a path mask's bezier vertices. pathPoints is an array of >=3 {x,y,inX?,inY?,outX?,outY?} vertices in layer-local pixel coordinates (handles optional). The mask must have shape:path.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        maskId: str,
        pathPoints: { type: "array" },
      },
      ["compositionId", "layerId", "maskId", "pathPoints"],
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
      const maskId = optionalString(args.maskId);
      if (!maskId) return fail("maskId is required", "INVALID_PARAMS");
      const target = (layer.masks ?? []).find((mask) => mask.id === maskId);
      if (!target) return fail("Motion mask not found", "NOT_FOUND");
      if (target.shape !== "path") {
        return fail("Mask is not a path mask", "INVALID_PARAMS");
      }
      const pathPoints = parseMaskPathPoints(args.pathPoints);
      if (!pathPoints) {
        return fail(
          "pathPoints must be an array of >=3 finite {x,y} vertices (layer-local pixels)",
          "INVALID_PARAMS",
        );
      }
      const nextLayer = updateMotionLayerMask(layer, maskId, (mask) => ({
        ...mask,
        pathPoints,
      }));
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated motion mask path", {
            compositionId: composition.id,
            layerId: layer.id,
            maskId,
          })
        : result;
    },
  },
  {
    name: "add_motion_mask_path_keyframe",
    domain: "motion",
    title: "Add motion mask path keyframe",
    description:
      "Add or replace a mask-path keyframe (rotoscoping) at a time on a path mask. Optional pathPoints (>=3 {x,y,inX?,inY?,outX?,outY?} vertices in layer-local pixel coordinates) default to the mask's current path. The mask must have shape:path. Returns the keyframe id.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        maskId: str,
        time: num,
        pathPoints: { type: "array" },
      },
      ["compositionId", "layerId", "maskId", "time"],
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
      const maskId = optionalString(args.maskId);
      if (!maskId) return fail("maskId is required", "INVALID_PARAMS");
      const target = (layer.masks ?? []).find((mask) => mask.id === maskId);
      if (!target) return fail("Motion mask not found", "NOT_FOUND");
      if (target.shape !== "path") {
        return fail("Mask is not a path mask", "INVALID_PARAMS");
      }
      const time = optionalNumber(args.time);
      if (time === undefined) return fail("time must be a finite number", "INVALID_PARAMS");

      let pathData: string | undefined;
      if (args.pathPoints !== undefined) {
        const supplied = parseMaskPathPoints(args.pathPoints);
        if (!supplied) {
          return fail(
            "pathPoints must be an array of >=3 finite {x,y} vertices (layer-local pixels)",
            "INVALID_PARAMS",
          );
        }
        pathData = buildMotionPathData(supplied);
      } else if (!target.pathPoints || target.pathPoints.length < 3) {
        return fail(
          "mask has no current path; supply pathPoints or set the mask path first",
          "INVALID_PARAMS",
        );
      }

      const nextLayer = upsertMotionMaskPathKeyframe(layer, maskId, time, pathData);
      const updatedMask = (nextLayer.masks ?? []).find((mask) => mask.id === maskId);
      const normalizedTime = normalizeMaskKeyframeTime(time);
      const keyframe = (updatedMask?.pathKeyframes ?? []).find(
        (candidate) => Math.abs(candidate.time - normalizedTime) <= 0.001,
      );
      if (!keyframe) {
        return fail("Failed to resolve mask path keyframe", "ERROR");
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Added motion mask path keyframe", {
            compositionId: composition.id,
            layerId: layer.id,
            maskId,
            keyframeId: keyframe.id,
          })
        : result;
    },
  },
  {
    name: "set_motion_track_matte",
    domain: "motion",
    title: "Set motion track matte",
    description:
      "Set, toggle, or clear a track matte on a layer, using another layer as the matte source. type is alpha|alpha-inverted|luma|luma-inverted. Pass sourceLayerId=null to CLEAR the matte entirely. Pass enabled (bool) to enable/disable an existing matte without changing its source (defaults true when a source is given). When updating an existing matte, sourceLayerId and type are optional and merge onto the current matte.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      sourceLayerId: str,
      type: str,
      enabled: bool,
    }, ["compositionId", "layerId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (args.sourceLayerId === null) {
        const clearedLayer = clearMotionLayerTrackMatte(layer);
        const clearResult = await commitMotionComposition(
          host,
          replaceMotionLayer(composition, layer.id, clearedLayer),
        );
        return clearResult.ok
          ? ok("Cleared track matte", {
              compositionId: composition.id,
              layerId: layer.id,
              cleared: true,
            })
          : clearResult;
      }
      const existing = layer.trackMatte;
      const sourceLayerId = optionalString(args.sourceLayerId);
      const type = optionalString(args.type) as MotionTrackMatteType | undefined;
      const enabled = typeof args.enabled === "boolean" ? args.enabled : undefined;
      if (type !== undefined && !MOTION_TRACK_MATTE_TYPES.has(type)) {
        return fail(`Unknown track matte type: ${String(args.type)}`, "INVALID_PARAMS");
      }
      if (sourceLayerId !== undefined) {
        if (!getMotionLayer(composition, sourceLayerId)) {
          return fail("Matte source layer not found", "NOT_FOUND");
        }
        if (sourceLayerId === layer.id) {
          return fail("A layer cannot be its own matte source", "INVALID_PARAMS");
        }
      }
      const resolvedSource = sourceLayerId ?? existing?.sourceLayerId;
      if (!resolvedSource) {
        return fail(
          "sourceLayerId is required when no track matte exists yet",
          "INVALID_PARAMS",
        );
      }
      const resolvedType = type ?? existing?.type ?? "alpha";
      const nextLayer = setMotionLayerTrackMatte(layer, {
        enabled: enabled ?? existing?.enabled ?? true,
        sourceLayerId: resolvedSource,
        type: resolvedType,
      });
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Set ${resolvedType} track matte`, {
            compositionId: composition.id,
            layerId: layer.id,
            sourceLayerId: resolvedSource,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_blend_mode",
    domain: "motion",
    title: "Set motion layer blend mode",
    description:
      "Set a layer's blend mode (see get_capabilities motion.blendModes / blendModes).",
    inputSchema: obj({ compositionId: str, layerId: str, blendMode: str }, [
      "compositionId",
      "layerId",
      "blendMode",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const blendMode = optionalString(args.blendMode) as BlendMode | undefined;
      if (!blendMode || !MOTION_BLEND_MODE_IDS.has(blendMode)) {
        return fail(`Unknown blend mode: ${String(args.blendMode)}`, "INVALID_PARAMS");
      }
      const nextLayer: MotionLayer = { ...layer, blendMode };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Set blend mode ${blendMode}`, { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  }
];
