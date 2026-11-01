import {
  MOTION_VARIABLE_TYPES,
  RegisteredTool,
  applyMotionAction,
  asRecord,
  commitMotionComposition,
  fail,
  genId,
  getMotionComposition,
  getMotionLayer,
  obj,
  ok,
  optionalString,
  replaceMotionLayer,
  str,
} from "./shared";
import {
  type LottieAnimation,
} from "@openreel/core/types/lottie";
import {
  type MotionComposition,
  type MotionVariable,
  type MotionVariableBindingTarget,
} from "@openreel/core/motion/types";
import {
  addMotionLayerVariableBinding,
  getCompatibleMotionVariableBindingTargets,
  isMotionVariableBindingCompatible,
  removeMotionLayerVariableBinding,
} from "@openreel/core/motion/motion-variable-bindings";
import {
  coerceMotionVariableValue,
  createMotionVariable,
  removeMotionCompositionVariable,
  updateMotionCompositionVariable,
} from "@openreel/core/motion/motion-variables";
import {
  importFigmaJsonAsMotionComposition,
} from "@openreel/core/motion/importers/figma-json-importer";
import {
  importLottieAsMotionComposition,
} from "@openreel/core/motion/importers/lottie-importer";
import {
  importSvgAsMotionComposition,
} from "@openreel/core/motion/importers/svg-importer";

export const motionVariableTools: RegisteredTool[] = [
  {
    name: "create_motion_variable",
    domain: "motion",
    title: "Create motion variable",
    description:
      "Create a composition variable (text|number|color|boolean|media). Returns the variableId. Variables can be bound to layer targets via bind_motion_variable.",
    inputSchema: obj({
      compositionId: str,
      variableType: str,
      name: str,
      value: {},
    }, ["compositionId", "variableType"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const variableType = optionalString(args.variableType) as
        | MotionVariable["type"]
        | undefined;
      if (!variableType || !MOTION_VARIABLE_TYPES.has(variableType)) {
        return fail(`Unknown variable type: ${String(args.variableType)}`, "INVALID_PARAMS");
      }
      const value = args.value;
      const variable = createMotionVariable(variableType, {
        id: genId(),
        name: optionalString(args.name),
        value:
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : undefined,
      });
      const nextComposition: MotionComposition = {
        ...composition,
        variables: [...composition.variables, variable],
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Created ${variableType} variable`, {
            compositionId: composition.id,
            variableId: variable.id,
          })
        : result;
    },
  },
  {
    name: "update_motion_variable",
    domain: "motion",
    title: "Update motion variable",
    description:
      "Update a composition variable by variableId. Optional name, value, and variableType (text|number|color|boolean|media). Changing variableType re-coerces the value to the new type (e.g. number -> text). Only the fields you pass change.",
    inputSchema: obj(
      { compositionId: str, variableId: str, name: str, value: {}, variableType: str },
      ["compositionId", "variableId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const variableId = optionalString(args.variableId);
      if (!variableId || !composition.variables.some((variable) => variable.id === variableId)) {
        return fail("Motion variable not found", "NOT_FOUND");
      }
      const variableTypeRaw = optionalString(args.variableType);
      if (
        variableTypeRaw !== undefined &&
        !MOTION_VARIABLE_TYPES.has(variableTypeRaw as MotionVariable["type"])
      ) {
        return fail(`Unknown variable type: ${variableTypeRaw}`, "INVALID_PARAMS");
      }
      const nextType = variableTypeRaw as MotionVariable["type"] | undefined;
      const value = args.value;
      const providedValue =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? value
          : undefined;
      const nextComposition = updateMotionCompositionVariable(composition, variableId, (variable) => {
        const type = nextType ?? variable.type;
        const rawValue = providedValue ?? variable.value;
        return {
          ...variable,
          type,
          name: optionalString(args.name) ?? variable.name,
          value: coerceMotionVariableValue(type, rawValue),
        } as MotionVariable;
      });
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Updated motion variable", { compositionId: composition.id, variableId })
        : result;
    },
  },
  {
    name: "delete_motion_variable",
    domain: "motion",
    title: "Delete motion variable",
    description:
      "Delete a composition variable by variableId. Any layer bindings referencing it become inert. Use with care — bound layers will fall back to their static values.",
    inputSchema: obj({ compositionId: str, variableId: str }, ["compositionId", "variableId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const variableId = optionalString(args.variableId);
      if (!variableId || !composition.variables.some((variable) => variable.id === variableId)) {
        return fail("Motion variable not found", "NOT_FOUND");
      }
      const nextComposition = removeMotionCompositionVariable(composition, variableId);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Deleted motion variable", { compositionId: composition.id, variableId })
        : result;
    },
  },
  {
    name: "bind_motion_variable",
    domain: "motion",
    title: "Bind motion variable",
    description:
      "Bind a composition variable to a compatible layer target (e.g. text.content, text.color, shape.fill.color, transform.opacity, layer.visible, image.assetId). Use get_motion_composition to find ids.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      variableId: str,
      target: str,
    }, ["compositionId", "layerId", "variableId", "target"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const variableId = optionalString(args.variableId);
      const variable = variableId
        ? composition.variables.find((candidate) => candidate.id === variableId)
        : undefined;
      if (!variable) return fail("Motion variable not found", "NOT_FOUND");
      const target = optionalString(args.target) as MotionVariableBindingTarget | undefined;
      if (!target) return fail("target is required", "INVALID_PARAMS");
      if (!isMotionVariableBindingCompatible(layer, variable, target)) {
        const compatible = getCompatibleMotionVariableBindingTargets(layer, variable).map(
          (definition) => definition.target,
        );
        return fail(
          `Incompatible binding. Compatible targets: ${compatible.join(", ") || "(none)"}`,
          "INVALID_PARAMS",
        );
      }
      const nextLayer = addMotionLayerVariableBinding(layer, variable, target, genId());
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Bound variable to ${target}`, {
            compositionId: composition.id,
            layerId: layer.id,
            variableId: variable.id,
            target,
          })
        : result;
    },
  },
  {
    name: "unbind_motion_variable",
    domain: "motion",
    title: "Unbind motion variable",
    description: "Remove a variable binding from a layer by bindingId.",
    inputSchema: obj({ compositionId: str, layerId: str, bindingId: str }, [
      "compositionId",
      "layerId",
      "bindingId",
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
      const bindingId = optionalString(args.bindingId);
      if (!bindingId) return fail("bindingId is required", "INVALID_PARAMS");
      const nextLayer = removeMotionLayerVariableBinding(layer, bindingId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed variable binding", { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  },
  {
    name: "import_svg_composition",
    domain: "motion",
    title: "Import SVG composition",
    description:
      "Import raw SVG markup as a new Motion Creator composition (shapes/text become native motion layers). Returns the new compositionId and layer count.",
    inputSchema: obj({ svgContent: str, name: str }, ["svgContent"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const svgContent = optionalString(args.svgContent);
      if (!svgContent) return fail("svgContent is required", "INVALID_PARAMS");
      let composition: MotionComposition;
      try {
        composition = importSvgAsMotionComposition(svgContent, {
          name: optionalString(args.name),
        });
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to import SVG",
          "INVALID_PARAMS",
        );
      }
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition,
      });
      return result.ok
        ? ok(`Imported SVG as "${composition.name}"`, {
            compositionId: composition.id,
            layerCount: composition.layers.length,
          })
        : result;
    },
  },
  {
    name: "import_lottie_composition",
    domain: "motion",
    title: "Import Lottie composition",
    description:
      "Import a Lottie animation JSON object as a new Motion Creator composition. Returns the new compositionId and layer count.",
    inputSchema: obj({ lottie: { type: "object" }, name: str }, ["lottie"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const lottie = asRecord(args.lottie);
      if (!lottie) return fail("lottie must be a Lottie JSON object", "INVALID_PARAMS");
      let composition: MotionComposition;
      try {
        composition = importLottieAsMotionComposition(lottie as unknown as LottieAnimation);
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to import Lottie",
          "INVALID_PARAMS",
        );
      }
      const name = optionalString(args.name);
      if (name) composition = { ...composition, name };
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition,
      });
      return result.ok
        ? ok(`Imported Lottie as "${composition.name}"`, {
            compositionId: composition.id,
            layerCount: composition.layers.length,
          })
        : result;
    },
  },
  {
    name: "import_figma_composition",
    domain: "motion",
    title: "Import Figma composition",
    description:
      "Import a Figma frame JSON export as a new Motion Creator composition. Returns the new compositionId and layer count.",
    inputSchema: obj({ figma: { type: "object" }, name: str }, ["figma"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const figma = args.figma;
      if (!figma || typeof figma !== "object") {
        return fail("figma must be a Figma JSON object", "INVALID_PARAMS");
      }
      let composition: MotionComposition;
      try {
        composition = importFigmaJsonAsMotionComposition(figma, optionalString(args.name));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to import Figma",
          "INVALID_PARAMS",
        );
      }
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition,
      });
      return result.ok
        ? ok(`Imported Figma as "${composition.name}"`, {
            compositionId: composition.id,
            layerCount: composition.layers.length,
          })
        : result;
    },
  }
];
