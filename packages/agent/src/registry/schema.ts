import type { JSONSchema } from "../types";
import { EASING_TYPES } from "@openreel/core/types/timeline";

export const str: JSONSchema = { type: "string" };
export const num: JSONSchema = { type: "number" };
export const bool: JSONSchema = { type: "boolean" };
export const obj = (
  properties: Record<string, JSONSchema>,
  required: string[] = [],
): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });

export const timelineKeyframePropertySchema: JSONSchema = {
  type: "string",
  enum: [
    "opacity",
    "position.x",
    "position.y",
    "scale.x",
    "scale.y",
    "rotation",
    "effect.brightness",
    "effect.contrast",
    "effect.saturation",
    "effect.blur",
  ],
};

export const easingSchema: JSONSchema = { type: "string", enum: [...EASING_TYPES] };

export const timelineKeyframeInputSchema: JSONSchema = obj(
  {
    id: str,
    time: num,
    property: timelineKeyframePropertySchema,
    value: {},
    easing: easingSchema,
  },
  ["time", "property", "value"],
);

export const clipTransformSchema: JSONSchema = obj({
  position: obj({ x: num, y: num }),
  scale: obj({ x: num, y: num }),
  rotation: num,
  opacity: num,
  anchor: obj({ x: num, y: num }),
  crop: obj({ x: num, y: num, width: num, height: num }),
  fitMode: { type: "string", enum: ["contain", "cover", "stretch", "none"] },
});
