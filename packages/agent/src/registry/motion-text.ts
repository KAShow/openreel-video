import {
  MOTION_EXPRESSION_CONTROL_EFFECT_TYPE_BY_ALIAS,
  MOTION_EXPRESSION_TYPES,
  RegisteredTool,
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
  parseGradientStyle,
  parseMotionTextStroke,
  parseShadowStyle,
  replaceMotionLayer,
  str,
} from "./shared";
import {
  type MotionExpressionType,
  type MotionTextLayer,
} from "@openreel/core/motion/types";
import {
  addMotionLayerEffect,
  createMotionEffect,
  nextMotionControlName,
  setMotionEffectParameterValue,
} from "@openreel/core/motion/motion-effects";
import {
  addMotionLayerExpression,
  createMotionExpression,
  evaluateMotionPropertyValueAtTime,
  getMotionExpressionError,
  removeMotionLayerExpression,
  toggleMotionLayerExpression,
  updateMotionLayerExpression,
} from "@openreel/core/motion/motion-expressions";
import {
  isMotionAnimatableProperty,
} from "@openreel/core/motion/motion-keyframes";

export const motionTextTools: RegisteredTool[] = [
  {
    name: "set_motion_text_style",
    domain: "motion",
    title: "Set motion text style",
    description:
      "Set the full visual style of a text layer. Optional: fontFamily, fontSize, fontWeight, color, align (left|center|right), lineHeight, letterSpacing, maxWidth (px, enables word wrap), verticalAlign (top|middle|bottom), fillGradient { type: linear|radial|conic, angle, center {x,y}, stops:[{offset,color,opacity?}] }, shadow { color, blur, offsetX, offsetY, spread?, inset? }, stroke { color, width, over? } (outline around glyphs; width 0 clears it, over:true paints on top of the fill), backgroundColor, backgroundPadding, backgroundRadius. Only the fields you pass change.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      fontFamily: str,
      fontSize: num,
      fontWeight: {},
      color: str,
      align: str,
      lineHeight: num,
      letterSpacing: num,
      maxWidth: num,
      verticalAlign: str,
      fillGradient: { type: "object" },
      shadow: { type: "object" },
      stroke: { type: "object" },
      backgroundColor: str,
      backgroundPadding: num,
      backgroundRadius: num,
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
      if (layer.type !== "text") {
        return fail("set_motion_text_style requires a text layer", "INVALID_PARAMS");
      }
      const align = optionalString(args.align);
      if (align !== undefined && align !== "left" && align !== "center" && align !== "right") {
        return fail("align must be left, center, or right", "INVALID_PARAMS");
      }
      const verticalAlign = optionalString(args.verticalAlign);
      if (
        verticalAlign !== undefined &&
        verticalAlign !== "top" &&
        verticalAlign !== "middle" &&
        verticalAlign !== "bottom"
      ) {
        return fail("verticalAlign must be top, middle, or bottom", "INVALID_PARAMS");
      }
      const fillGradient = args.fillGradient !== undefined
        ? parseGradientStyle(args.fillGradient)
        : undefined;
      if (args.fillGradient !== undefined && !fillGradient) {
        return fail("fillGradient is invalid", "INVALID_PARAMS");
      }
      const shadow = args.shadow !== undefined ? parseShadowStyle(args.shadow) : undefined;
      if (args.shadow !== undefined && !shadow) {
        return fail("shadow is invalid", "INVALID_PARAMS");
      }
      const stroke =
        args.stroke !== undefined ? parseMotionTextStroke(args.stroke) : undefined;
      if (args.stroke !== undefined && stroke === undefined) {
        return fail(
          "stroke is invalid — requires color string and finite width ≥ 0",
          "INVALID_PARAMS",
        );
      }
      const fontWeight =
        typeof args.fontWeight === "number" && Number.isFinite(args.fontWeight)
          ? args.fontWeight
          : optionalString(args.fontWeight);
      const fontSize = optionalNumber(args.fontSize);
      const lineHeight = optionalNumber(args.lineHeight);
      const letterSpacing = optionalNumber(args.letterSpacing);
      const maxWidth = optionalNumber(args.maxWidth);
      const backgroundPadding = optionalNumber(args.backgroundPadding);
      const backgroundRadius = optionalNumber(args.backgroundRadius);
      const resolvedStroke =
        stroke === undefined
          ? layer.style.stroke
          : stroke === "clear"
            ? undefined
            : stroke;
      const nextStyle: MotionTextLayer["style"] = {
        ...layer.style,
        fontFamily: optionalString(args.fontFamily) ?? layer.style.fontFamily,
        fontSize: fontSize !== undefined ? Math.max(1, fontSize) : layer.style.fontSize,
        fontWeight: fontWeight ?? layer.style.fontWeight,
        color: optionalString(args.color) ?? layer.style.color,
        align: (align as CanvasTextAlign | undefined) ?? layer.style.align,
        lineHeight: lineHeight ?? layer.style.lineHeight,
        letterSpacing: letterSpacing ?? layer.style.letterSpacing,
        maxWidth: maxWidth ?? layer.style.maxWidth,
        verticalAlign:
          (verticalAlign as MotionTextLayer["style"]["verticalAlign"] | undefined) ??
          layer.style.verticalAlign,
        fillGradient: fillGradient ?? layer.style.fillGradient,
        shadow: shadow ?? layer.style.shadow,
        backgroundColor: optionalString(args.backgroundColor) ?? layer.style.backgroundColor,
        backgroundPadding: backgroundPadding ?? layer.style.backgroundPadding,
        backgroundRadius: backgroundRadius ?? layer.style.backgroundRadius,
        stroke: resolvedStroke,
      };
      const nextLayer: MotionTextLayer = { ...layer, style: nextStyle };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Set motion text style", {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "set_motion_text_content",
    domain: "motion",
    title: "Set motion text content",
    description:
      "Replace the source text string of an existing text layer. Only mutates the layer's `.text`; styling, animators, and keyframes are untouched. Pass an empty string to clear the text. The layer referenced by layerId must be a text layer (else INVALID_PARAMS).",
    inputSchema: obj({ compositionId: str, layerId: str, text: str }, [
      "compositionId",
      "layerId",
      "text",
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
      if (layer.type !== "text") {
        return fail("set_motion_text_content requires a text layer", "INVALID_PARAMS");
      }
      if (typeof args.text !== "string") {
        return fail("text is required and must be a string", "INVALID_PARAMS");
      }
      const nextLayer: MotionTextLayer = { ...layer, text: args.text };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Set motion text content", {
            compositionId: composition.id,
            layerId: layer.id,
            text: args.text,
          })
        : result;
    },
  },
  {
    name: "attach_motion_expression",
    domain: "motion",
    title: "Attach motion expression",
    description:
      "Attach an expression to an animatable layer property. expressionType is a preset (sine|wiggle|drift|spring|loop|ping-pong|random|posterize) or 'expression' for a custom JavaScript expression supplied via `code`. Custom code may be a single expression ('value + 1') OR a multi-line body with an explicit return ('const a = value * 2;\\nreturn a + 1;'). Scope: value, time, valueAtTime(t) (this property's pre-expression value at t), thisLayer (.index/.name/.value(propertyId)/.valueAtTime(propertyId,t)), key(n) (1-based -> {index,time,value}), numKeys, nearestKey(t), thisComp (.layer(nameOrIndex)/.numLayers/.duration/.width/.height/.frameRate), layer(nameOrIndex) -> handle whose .value(propertyId)/.valueAtTime(propertyId,t) fully evaluate another layer (its keyframes + its own expressions), effect(name)(paramName) reading an expression-control param, plus wiggle(freq,amp), loopOut() (cycle), linear(), ease(), clamp(), random(), Math. Cross-layer references are cycle-guarded (A<->B loops fall back to pre-expression values, never hang) and depth-capped at 8. On error the value falls back to the property base and the message is surfaced in the editor. For the built-in presets you may tune amplitude, frequency (cycles/sec), phase (offset), seed (random stream), and decay (spring settle) — omitted knobs use the preset's default (e.g. a slow wide wiggle is amplitude 60, frequency 0.5). Replaces any existing expression on that property.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      property: str,
      expressionType: str,
      code: str,
      amplitude: num,
      frequency: num,
      phase: num,
      seed: num,
      decay: num,
    }, ["compositionId", "layerId", "property", "expressionType"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const property = optionalString(args.property);
      if (!property || !isMotionAnimatableProperty(property)) {
        return fail(`Unsupported motion property: ${String(args.property)}`, "INVALID_PARAMS");
      }
      const expressionType = optionalString(args.expressionType) as
        | MotionExpressionType
        | undefined;
      if (!expressionType || !MOTION_EXPRESSION_TYPES.has(expressionType)) {
        return fail(`Unknown expression type: ${String(args.expressionType)}`, "INVALID_PARAMS");
      }
      const code = optionalString(args.code);
      if (expressionType === "expression" && (!code || code.trim().length === 0)) {
        return fail("expression type requires a non-empty code string", "INVALID_PARAMS");
      }
      const baseExpression = createMotionExpression(expressionType, property, genId());
      const amplitude = optionalNumber(args.amplitude);
      const frequency = optionalNumber(args.frequency);
      const phase = optionalNumber(args.phase);
      const seed = optionalNumber(args.seed);
      const decay = optionalNumber(args.decay);
      const tunedExpression = {
        ...baseExpression,
        ...(amplitude !== undefined ? { amplitude } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(phase !== undefined ? { phase } : {}),
        ...(seed !== undefined ? { seed } : {}),
        ...(decay !== undefined ? { decay } : {}),
      };
      const expression =
        expressionType === "expression" && code
          ? { ...tunedExpression, code }
          : tunedExpression;
      const nextLayer = addMotionLayerExpression(layer, expression);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Attached ${expressionType} expression to ${property}`, {
            compositionId: composition.id,
            layerId: layer.id,
            expressionId: expression.id,
          })
        : result;
    },
  },
  {
    name: "remove_motion_expression",
    domain: "motion",
    title: "Remove motion expression",
    description: "Remove an expression from a layer by expressionId.",
    inputSchema: obj({ compositionId: str, layerId: str, expressionId: str }, [
      "compositionId",
      "layerId",
      "expressionId",
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
      const expressionId = optionalString(args.expressionId);
      if (!expressionId) return fail("expressionId is required", "INVALID_PARAMS");
      const nextLayer = removeMotionLayerExpression(layer, expressionId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed motion expression", { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  },
  {
    name: "update_motion_expression",
    domain: "motion",
    title: "Update motion expression",
    description:
      "Patch an existing expression in place (keeps its id, property, and enabled flag). Optional fields — only the ones you pass change: code (custom JavaScript body/expression), amplitude, frequency (cycles/sec), phase (offset), seed (random stream), decay (spring settle). Unlike attach_motion_expression this does NOT regenerate the id or reset untouched knobs, so it is the non-destructive way to tune a wiggle/spring/etc or repair a custom code string.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        expressionId: str,
        code: str,
        amplitude: num,
        frequency: num,
        phase: num,
        seed: num,
        decay: num,
      },
      ["compositionId", "layerId", "expressionId"],
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
      const expressionId = optionalString(args.expressionId);
      if (!expressionId) return fail("expressionId is required", "INVALID_PARAMS");
      const existing = (layer.expressions ?? []).find(
        (expression) => expression.id === expressionId,
      );
      if (!existing) return fail("Motion expression not found", "NOT_FOUND");
      const code = optionalString(args.code);
      const amplitude = optionalNumber(args.amplitude);
      const frequency = optionalNumber(args.frequency);
      const phase = optionalNumber(args.phase);
      const seed = optionalNumber(args.seed);
      const decay = optionalNumber(args.decay);
      const nextLayer = updateMotionLayerExpression(layer, expressionId, (expression) => ({
        ...expression,
        ...(code !== undefined ? { code } : {}),
        ...(amplitude !== undefined ? { amplitude } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(phase !== undefined ? { phase } : {}),
        ...(seed !== undefined ? { seed } : {}),
        ...(decay !== undefined ? { decay } : {}),
      }));
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated motion expression", {
            compositionId: composition.id,
            layerId: layer.id,
            expressionId,
          })
        : result;
    },
  },
  {
    name: "toggle_motion_expression",
    domain: "motion",
    title: "Toggle motion expression",
    description:
      "Enable or disable an expression on a layer by expressionId without removing it. When disabled the property falls back to its keyframed/base value and any stored error for that expression is cleared. `enabled` is required and must be a boolean.",
    inputSchema: obj(
      { compositionId: str, layerId: str, expressionId: str, enabled: bool },
      ["compositionId", "layerId", "expressionId", "enabled"],
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
      const expressionId = optionalString(args.expressionId);
      if (!expressionId) return fail("expressionId is required", "INVALID_PARAMS");
      if (typeof args.enabled !== "boolean") {
        return fail("enabled is required and must be a boolean", "INVALID_PARAMS");
      }
      const existing = (layer.expressions ?? []).find(
        (expression) => expression.id === expressionId,
      );
      if (!existing) return fail("Motion expression not found", "NOT_FOUND");
      const nextLayer = toggleMotionLayerExpression(layer, expressionId, args.enabled);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(args.enabled ? "Enabled motion expression" : "Disabled motion expression", {
            compositionId: composition.id,
            layerId: layer.id,
            expressionId,
            enabled: args.enabled,
          })
        : result;
    },
  },
  {
    name: "list_motion_expression_errors",
    domain: "motion",
    title: "List motion expression errors",
    description:
      "Evaluate every enabled expression in a composition and return the compile/cycle/runtime errors, one entry per failing expression: { layerId, property, expressionId, error }. Use this to see why an attached custom expression is not driving its property (the value silently falls back to the property base on error). Returns an empty list when every expression evaluates cleanly.",
    inputSchema: obj({ compositionId: str }, ["compositionId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const errors: Array<{
        readonly layerId: string;
        readonly property: string;
        readonly expressionId: string;
        readonly error: string;
      }> = [];
      for (const layer of composition.layers) {
        for (const expression of layer.expressions ?? []) {
          if (!expression.enabled) continue;
          evaluateMotionPropertyValueAtTime({
            keyframes: [],
            expressions: [expression],
            property: expression.property,
            localTime: 0,
            fallback: 0,
            duration: Math.max(0.001, composition.duration),
            context: { composition, layer },
          });
          const error = getMotionExpressionError(expression.id);
          if (error) {
            errors.push({
              layerId: layer.id,
              property: expression.property,
              expressionId: expression.id,
              error,
            });
          }
        }
      }
      return ok(`${errors.length} expression error(s)`, {
        compositionId: composition.id,
        errors,
      });
    },
  },
  {
    name: "add_motion_expression_control",
    domain: "motion",
    title: "Add motion expression control",
    description:
      "Add an expression-control effect (Slider/Checkbox/Angle) to a layer. controlType is 'slider' (finite float, default 0), 'checkbox' (0 or 1, coerced), or 'angle' (degrees float, default 0). These render nothing on their own; they are named knobs an expression reads via effect(\"<name>\")(\"value\"). Optional name (defaults 'Slider Control'/'Checkbox Control'/'Angle Control') is the reference key; optional value sets the initial control value. The 'value' param is keyframable at effect.<id>.value (see list_motion_animatable_properties). Returns { effectId, name }.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      controlType: str,
      name: str,
      value: num,
    }, ["compositionId", "layerId", "controlType"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const controlType = optionalString(args.controlType);
      const effectType = MOTION_EXPRESSION_CONTROL_EFFECT_TYPE_BY_ALIAS.get(controlType ?? "");
      if (!effectType) {
        return fail(
          `Invalid controlType: ${String(args.controlType)} (expected slider|checkbox|angle)`,
          "INVALID_PARAMS",
        );
      }
      const baseEffect = createMotionEffect(effectType, genId());
      const requestedName = optionalString(args.name);
      const resolvedName = nextMotionControlName(
        layer.effects ?? [],
        requestedName ?? baseEffect.name,
      );
      const namedEffect = { ...baseEffect, name: resolvedName };
      const value = optionalNumber(args.value);
      const effect = value === undefined
        ? namedEffect
        : setMotionEffectParameterValue(namedEffect, "value", value);
      const nextLayer = addMotionLayerEffect(layer, effect);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added ${effect.name} control`, {
            compositionId: composition.id,
            layerId: layer.id,
            effectId: effect.id,
            name: effect.name,
          })
        : result;
    },
  }
];
