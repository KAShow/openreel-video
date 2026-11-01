import type { JSONSchema, ToolDef } from "./types";
import type { NamedToolSchema, RegisteredTool } from "./registry/types";
import { readTools } from "./registry/read";
import { creationReadTools } from "./registry/creation-read";
import { creationTransformTools } from "./registry/creation-transform";
import { creationMaterialTools } from "./registry/creation-materials";
import { creationAnimationTools } from "./registry/creation-animation";
import { projectTools } from "./registry/project";
import { trackTools } from "./registry/track";
import { mediaTools } from "./registry/media";
import { timelineTools } from "./registry/timeline";
import { effectsTools } from "./registry/effects";
import { audioTools } from "./registry/audio";
import { subtitleTools } from "./registry/subtitles";
import { timelineEditingTools } from "./registry/timeline-editing";
import { textTools } from "./registry/text";
import { motionTools } from "./registry/motion";
import { creationSceneTools } from "./registry/creation-scene";
import { creationProductTools } from "./registry/creation-products";
import { creationCharacterTools } from "./registry/creation-characters";
import { creationPhysicsTools } from "./registry/creation-physics";
import { creationGeometryTools } from "./registry/creation-geometry";
import { creationCinematicTools } from "./registry/creation-cinematic";
import { motionLayerTools } from "./registry/motion-layers";
import { motionEditingTools } from "./registry/motion-editing";
import { motionTextTools } from "./registry/motion-text";
import { motionEffectTools } from "./registry/motion-effects";
import { motionHierarchyTools } from "./registry/motion-hierarchy";
import { motionShapeTools } from "./registry/motion-shapes";
import { motionAnimatorTools } from "./registry/motion-animators";
import { motionCameraTools } from "./registry/motion-camera";
import { motionVariableTools } from "./registry/motion-variables";
import { motionLayoutTools } from "./registry/motion-layout";
import { motionGeometryTools } from "./registry/motion-geometry";
import { actionToolsList } from "./registry/actions";
import { motionRenderTools } from "./registry/motion-render";
import { multicamTools } from "./registry/multicam";
import { exportTools } from "./registry/export";

export type { RegisteredTool, ToolHandler } from "./registry/types";

// The spread order is the public contract. Keep domain groups contiguous.
const TOOLS: RegisteredTool[] = [
  ...readTools,
  ...creationReadTools,
  ...creationTransformTools,
  ...creationMaterialTools,
  ...creationAnimationTools,
  ...projectTools,
  ...trackTools,
  ...mediaTools,
  ...timelineTools,
  ...effectsTools,
  ...audioTools,
  ...subtitleTools,
  ...timelineEditingTools,
  ...textTools,
  ...motionTools,
  ...creationSceneTools,
  ...creationProductTools,
  ...creationCharacterTools,
  ...creationPhysicsTools,
  ...creationGeometryTools,
  ...creationCinematicTools,
  ...motionLayerTools,
  ...motionEditingTools,
  ...motionTextTools,
  ...motionEffectTools,
  ...motionHierarchyTools,
  ...motionShapeTools,
  ...motionAnimatorTools,
  ...motionCameraTools,
  ...motionVariableTools,
  ...motionLayoutTools,
  ...motionGeometryTools,
  ...actionToolsList,
  ...motionRenderTools,
  ...multicamTools,
  ...exportTools,
];

const REGISTRY = new Map<string, RegisteredTool>();
for (const tool of TOOLS) {
  if (REGISTRY.has(tool.name)) {
    throw new Error(`Duplicate registered tool name: ${tool.name}`);
  }
  REGISTRY.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return REGISTRY.get(name);
}

export function listTools(): RegisteredTool[] {
  return [...REGISTRY.values()];
}

export function toolDefs(): ToolDef[] {
  return listTools().map(({ handler: _handler, ...def }) => def);
}

function selectedTools(names?: Iterable<string>): RegisteredTool[] {
  if (!names) return listTools();
  const selected = new Set(names);
  return listTools().filter((tool) => selected.has(tool.name));
}

/** Anthropic Messages API tool format. */
export function toAnthropicTools(names?: Iterable<string>): NamedToolSchema[] {
  return selectedTools(names).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

/** OpenAI Chat Completions tool format. */
export function toOpenAITools(names?: Iterable<string>): Array<{
  type: "function";
  function: { name: string; description: string; parameters: JSONSchema };
}> {
  return selectedTools(names).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/** MCP tools/list format. */
export function toMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: JSONSchema;
}> {
  return listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/** Human-readable capability reference generated from the registry. */
export function toCapabilityDoc(names?: Iterable<string>): string {
  const byDomain = new Map<string, RegisteredTool[]>();
  for (const tool of selectedTools(names)) {
    const tools = byDomain.get(tool.domain) ?? [];
    tools.push(tool);
    byDomain.set(tool.domain, tools);
  }
  let out = "# OpenReel Agent Tools\n";
  for (const [domain, tools] of byDomain) {
    out += `\n## ${domain}\n`;
    for (const tool of tools) {
      const flags = [
        tool.readOnly ? "read-only" : null,
        tool.destructive ? "destructive" : null,
        tool.expensive ? "expensive" : null,
      ]
        .filter(Boolean)
        .join(", ");
      out += `- **${tool.name}**${flags ? ` (${flags})` : ""} — ${tool.description}\n`;
    }
  }
  return out;
}
