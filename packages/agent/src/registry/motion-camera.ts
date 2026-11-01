import {
  MOTION_LIGHT_TYPES,
  ParsedScalarKeyframe,
  RegisteredTool,
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
  parseScalarKeyframes,
  parseVectorKeyframes,
  replaceMotionLayer,
  str,
} from "./shared";
import {
  type Marker,
} from "@openreel/core/types/timeline";
import {
  type MotionBlurSettings,
  type MotionComposition,
  type MotionLayer,
  type MotionLight,
  type MotionLightType,
} from "@openreel/core/motion/types";
import {
  type MotionCameraProperty,
  createDefaultMotionCamera,
  isMotionCameraProperty,
  normalizeMotionCamera,
  setMotionCameraDepthOfFieldEnabled,
  setMotionCameraPropertyValue,
  upsertMotionCameraKeyframe,
} from "@openreel/core/motion/motion-camera";
import {
  type MotionLightProperty,
  addMotionCompositionLight,
  createMotionLight,
  isMotionLightProperty,
  normalizeMotionLight,
  removeMotionCompositionLight,
  setMotionLightPropertyValue,
  updateMotionCompositionLight,
  upsertMotionLightKeyframe,
} from "@openreel/core/motion/motion-lights";
import {
  addMotionCompositionMarker,
  createMotionMarker,
  removeMotionCompositionMarker,
  updateMotionCompositionMarker,
} from "@openreel/core/motion/motion-markers";
import {
  normalizeMotionBlurSettings,
} from "@openreel/core/motion/motion-blur";

export const motionCameraTools: RegisteredTool[] = [
  {
    name: "set_motion_camera",
    domain: "motion",
    title: "Set motion camera",
    description:
      "Enable and configure the composition camera. Optional: position x/y/z, zoom, rotation (roll), perspective, and depthOfField (enabled, focusDistance, aperture, maxBlur).",
    inputSchema: obj({
      compositionId: str,
      enabled: bool,
      x: num,
      y: num,
      z: num,
      zoom: num,
      rotation: num,
      perspective: num,
      depthOfField: { type: "object" },
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      let camera = composition.camera
        ? normalizeMotionCamera(composition)
        : createDefaultMotionCamera(composition);
      if (typeof args.enabled === "boolean") {
        camera = { ...camera, enabled: args.enabled };
      }
      const setProp = (property: MotionCameraProperty, value: number | undefined) => {
        if (value !== undefined && isMotionCameraProperty(property)) {
          camera = setMotionCameraPropertyValue(camera, property, value);
        }
      };
      setProp("camera.position.x", optionalNumber(args.x));
      setProp("camera.position.y", optionalNumber(args.y));
      setProp("camera.position.z", optionalNumber(args.z));
      setProp("camera.zoom", optionalNumber(args.zoom));
      setProp("camera.rotation", optionalNumber(args.rotation));
      setProp("camera.perspective", optionalNumber(args.perspective));
      const dof = asRecord(args.depthOfField);
      if (dof) {
        if (typeof dof.enabled === "boolean") {
          camera = setMotionCameraDepthOfFieldEnabled(camera, dof.enabled);
        }
        setProp("camera.focusDistance", optionalNumber(dof.focusDistance));
        setProp("camera.aperture", optionalNumber(dof.aperture));
        setProp("camera.maxBlur", optionalNumber(dof.maxBlur));
      }
      const nextComposition: MotionComposition = {
        ...composition,
        camera,
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Set motion camera", { compositionId: composition.id })
        : result;
    },
  },
  {
    name: "add_motion_marker",
    domain: "motion",
    title: "Add motion marker",
    description:
      "Add a composition marker (a labelled timeline cue) at `time` seconds. Optional label (defaults to 'Marker') and color (#rrggbb). Markers annotate the Motion Creator timeline and are used for snapping. Returns the markerId.",
    inputSchema: obj({ compositionId: str, time: num, label: str, color: str }, [
      "compositionId",
      "time",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const time = optionalNumber(args.time);
      if (time === undefined) return fail("time must be a finite number", "INVALID_PARAMS");
      const marker = createMotionMarker({
        id: genId(),
        time: Math.max(0, time),
        label: optionalString(args.label),
        color: optionalString(args.color),
      });
      const nextComposition = addMotionCompositionMarker(composition, marker);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Added marker "${marker.label}"`, {
            compositionId: composition.id,
            markerId: marker.id,
          })
        : result;
    },
  },
  {
    name: "update_motion_marker",
    domain: "motion",
    title: "Update motion marker",
    description:
      "Update a composition marker by markerId. Optional label, time (seconds), color (#rrggbb). Only the fields you pass change.",
    inputSchema: obj({ compositionId: str, markerId: str, label: str, time: num, color: str }, [
      "compositionId",
      "markerId",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const markerId = optionalString(args.markerId);
      if (!markerId || !composition.markers.some((marker) => marker.id === markerId)) {
        return fail("Motion marker not found", "NOT_FOUND");
      }
      const label = optionalString(args.label);
      const color = optionalString(args.color);
      const time = optionalNumber(args.time);
      const nextComposition = updateMotionCompositionMarker(
        composition,
        markerId,
        (marker: Marker) => ({
          ...marker,
          ...(label !== undefined ? { label } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(time !== undefined ? { time: Math.max(0, time) } : {}),
        }),
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Updated motion marker", { compositionId: composition.id, markerId })
        : result;
    },
  },
  {
    name: "remove_motion_marker",
    domain: "motion",
    title: "Remove motion marker",
    description: "Remove a composition marker by markerId.",
    inputSchema: obj({ compositionId: str, markerId: str }, ["compositionId", "markerId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const markerId = optionalString(args.markerId);
      if (!markerId || !composition.markers.some((marker) => marker.id === markerId)) {
        return fail("Motion marker not found", "NOT_FOUND");
      }
      const nextComposition = removeMotionCompositionMarker(composition, markerId);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Removed motion marker", { compositionId: composition.id, markerId })
        : result;
    },
  },
  {
    name: "animate_motion_camera",
    domain: "motion",
    title: "Animate motion camera",
    description:
      "Keyframe the composition camera over time — comp-level push-in, dolly, orbit, or roll. `position` is an array of { time, x?, y?, z?, easing? } (each channel keyframed independently; omit a channel to leave it alone). `zoom`, `rotation`, and `perspective` are arrays of { time, value, easing? }. Optional `depthOfField` { focusDistance?, aperture?, maxBlur? } enables DOF and sets those values. Times in seconds. Enables the camera automatically. Re-calling upserts keyframes at matching times.",
    inputSchema: obj(
      {
        compositionId: str,
        position: { type: "array" },
        zoom: { type: "array" },
        rotation: { type: "array" },
        perspective: { type: "array" },
        depthOfField: { type: "object" },
      },
      ["compositionId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const position = parseVectorKeyframes(args.position);
      const zoom = parseScalarKeyframes(args.zoom);
      const rotation = parseScalarKeyframes(args.rotation);
      const perspective = parseScalarKeyframes(args.perspective);
      if (args.position !== undefined && position === undefined) {
        return fail("position must be an array of { time, x?, y?, z?, easing? }", "INVALID_PARAMS");
      }
      if (args.zoom !== undefined && zoom === undefined) {
        return fail("zoom must be an array of { time, value, easing? }", "INVALID_PARAMS");
      }
      if (args.rotation !== undefined && rotation === undefined) {
        return fail("rotation must be an array of { time, value, easing? }", "INVALID_PARAMS");
      }
      if (args.perspective !== undefined && perspective === undefined) {
        return fail("perspective must be an array of { time, value, easing? }", "INVALID_PARAMS");
      }
      const dof = asRecord(args.depthOfField);
      const dofFocus = dof ? optionalNumber(dof.focusDistance) : undefined;
      const dofAperture = dof ? optionalNumber(dof.aperture) : undefined;
      const dofMaxBlur = dof ? optionalNumber(dof.maxBlur) : undefined;
      const hasKeyframes =
        (position?.length ?? 0) > 0 ||
        (zoom?.length ?? 0) > 0 ||
        (rotation?.length ?? 0) > 0 ||
        (perspective?.length ?? 0) > 0;
      const hasDof =
        dofFocus !== undefined || dofAperture !== undefined || dofMaxBlur !== undefined;
      if (!hasKeyframes && !hasDof) {
        return fail(
          "Provide at least one of position, zoom, rotation, perspective, or depthOfField",
          "INVALID_PARAMS",
        );
      }
      let camera = composition.camera
        ? normalizeMotionCamera(composition)
        : createDefaultMotionCamera(composition);
      camera = { ...camera, enabled: true };
      const applyScalar = (
        property: MotionCameraProperty,
        keyframes: ParsedScalarKeyframe[] | undefined,
      ) => {
        for (const keyframe of keyframes ?? []) {
          camera = upsertMotionCameraKeyframe(camera, property, keyframe.time, {
            value: keyframe.value,
            easing: keyframe.easing,
            idFactory: genId,
          });
        }
      };
      for (const keyframe of position ?? []) {
        if (keyframe.x !== undefined) {
          camera = upsertMotionCameraKeyframe(camera, "camera.position.x", keyframe.time, {
            value: keyframe.x,
            easing: keyframe.easing,
            idFactory: genId,
          });
        }
        if (keyframe.y !== undefined) {
          camera = upsertMotionCameraKeyframe(camera, "camera.position.y", keyframe.time, {
            value: keyframe.y,
            easing: keyframe.easing,
            idFactory: genId,
          });
        }
        if (keyframe.z !== undefined) {
          camera = upsertMotionCameraKeyframe(camera, "camera.position.z", keyframe.time, {
            value: keyframe.z,
            easing: keyframe.easing,
            idFactory: genId,
          });
        }
      }
      applyScalar("camera.zoom", zoom);
      applyScalar("camera.rotation", rotation);
      applyScalar("camera.perspective", perspective);
      if (hasDof) {
        camera = setMotionCameraDepthOfFieldEnabled(camera, true);
        if (dofFocus !== undefined) {
          camera = setMotionCameraPropertyValue(camera, "camera.focusDistance", dofFocus);
        }
        if (dofAperture !== undefined) {
          camera = setMotionCameraPropertyValue(camera, "camera.aperture", dofAperture);
        }
        if (dofMaxBlur !== undefined) {
          camera = setMotionCameraPropertyValue(camera, "camera.maxBlur", dofMaxBlur);
        }
      }
      const nextComposition: MotionComposition = {
        ...composition,
        camera,
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Animated motion camera", {
            compositionId: composition.id,
            keyframes: (camera.keyframes ?? []).length,
          })
        : result;
    },
  },
  {
    name: "animate_motion_light",
    domain: "motion",
    title: "Animate motion light",
    description:
      "Keyframe a composition light property over time by lightId. `property` is one of light.intensity, light.position.x/y/z, light.radius, light.falloff, light.angle, light.shadowOpacity, light.shadowSoftness. `keyframes` is an array of { time, value, easing? }. Times in seconds. Re-calling upserts keyframes at matching times.",
    inputSchema: obj(
      { compositionId: str, lightId: str, property: str, keyframes: { type: "array" } },
      ["compositionId", "lightId", "property", "keyframes"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const lightId = optionalString(args.lightId);
      if (!lightId || !(composition.lights ?? []).some((light) => light.id === lightId)) {
        return fail("Motion light not found", "NOT_FOUND");
      }
      const property = optionalString(args.property) as MotionLightProperty | undefined;
      if (!property || !isMotionLightProperty(property)) {
        return fail(`Unknown light property: ${String(args.property)}`, "INVALID_PARAMS");
      }
      const keyframes = parseScalarKeyframes(args.keyframes);
      if (!keyframes || keyframes.length === 0) {
        return fail(
          "keyframes must be a non-empty array of { time, value, easing? }",
          "INVALID_PARAMS",
        );
      }
      const nextComposition = updateMotionCompositionLight(composition, lightId, (light) =>
        keyframes.reduce<MotionLight>(
          (currentLight, keyframe) =>
            upsertMotionLightKeyframe(currentLight, property, keyframe.time, {
              value: keyframe.value,
              easing: keyframe.easing,
              idFactory: genId,
            }),
          light,
        ),
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Animated light ${property} (${keyframes.length} keyframes)`, {
            compositionId: composition.id,
            lightId,
          })
        : result;
    },
  },
  {
    name: "set_motion_light_style",
    domain: "motion",
    title: "Set motion light style",
    description:
      "Update a light's non-numeric style by lightId. Optional: color (#rrggbb or rgba()), castsShadow (bool), name, enabled (bool), type (ambient|point|directional — changing the type renormalizes defaults). Only the fields you pass change. Use update_motion_light / animate_motion_light for numeric properties.",
    inputSchema: obj(
      {
        compositionId: str,
        lightId: str,
        color: str,
        castsShadow: bool,
        name: str,
        enabled: bool,
        type: str,
      },
      ["compositionId", "lightId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const lightId = optionalString(args.lightId);
      if (!lightId || !(composition.lights ?? []).some((light) => light.id === lightId)) {
        return fail("Motion light not found", "NOT_FOUND");
      }
      const color = optionalString(args.color);
      const name = optionalString(args.name);
      const castsShadow =
        typeof args.castsShadow === "boolean" ? args.castsShadow : undefined;
      const enabled = typeof args.enabled === "boolean" ? args.enabled : undefined;
      const typeRaw = optionalString(args.type);
      if (typeRaw !== undefined && !MOTION_LIGHT_TYPES.has(typeRaw as MotionLightType)) {
        return fail(`Unknown light type: ${typeRaw}`, "INVALID_PARAMS");
      }
      const nextType = typeRaw as MotionLightType | undefined;
      if (
        color === undefined &&
        name === undefined &&
        castsShadow === undefined &&
        enabled === undefined &&
        nextType === undefined
      ) {
        return fail(
          "Provide at least one of color, castsShadow, name, enabled, or type",
          "INVALID_PARAMS",
        );
      }
      const nextComposition = updateMotionCompositionLight(composition, lightId, (light) =>
        normalizeMotionLight(
          {
            ...light,
            ...(nextType !== undefined ? { type: nextType } : {}),
            ...(color !== undefined ? { color } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(castsShadow !== undefined ? { castsShadow } : {}),
            ...(enabled !== undefined ? { enabled } : {}),
            ...(nextType === "ambient" ? { castsShadow: false, shadowOpacity: 0 } : {}),
          },
          composition,
        ),
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Set motion light style", { compositionId: composition.id, lightId })
        : result;
    },
  },
  {
    name: "set_motion_blur",
    domain: "motion",
    title: "Set composition motion blur",
    description:
      "Configure composition-wide motion blur. Optional: enabled (bool), shutterAngle (0-720 deg; higher = more blur), shutterPhase (-360..360 deg), samples (2-32 sub-frame samples). Per-layer opt-in is controlled by set_motion_layer_motion_blur. Only the fields you pass change.",
    inputSchema: obj(
      {
        compositionId: str,
        enabled: bool,
        shutterAngle: num,
        shutterPhase: num,
        samples: num,
      },
      ["compositionId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const current = normalizeMotionBlurSettings(composition.motionBlur);
      const enabled = typeof args.enabled === "boolean" ? args.enabled : undefined;
      const shutterAngle = optionalNumber(args.shutterAngle);
      const shutterPhase = optionalNumber(args.shutterPhase);
      const samples = optionalNumber(args.samples);
      if (
        enabled === undefined &&
        shutterAngle === undefined &&
        shutterPhase === undefined &&
        samples === undefined
      ) {
        return fail(
          "Provide at least one of enabled, shutterAngle, shutterPhase, or samples",
          "INVALID_PARAMS",
        );
      }
      const merged: MotionBlurSettings = normalizeMotionBlurSettings({
        enabled: enabled ?? current.enabled,
        shutterAngle: shutterAngle ?? current.shutterAngle,
        shutterPhase: shutterPhase ?? current.shutterPhase,
        samples: samples ?? current.samples,
      });
      const nextComposition: MotionComposition = {
        ...composition,
        motionBlur: merged,
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Set composition motion blur", { compositionId: composition.id, motionBlur: merged })
        : result;
    },
  },
  {
    name: "set_motion_layer_motion_blur",
    domain: "motion",
    title: "Set layer motion blur",
    description:
      "Enable or disable motion blur for a single layer by layerId (per-layer opt-in). Composition motion blur must also be enabled via set_motion_blur for the effect to render.",
    inputSchema: obj({ compositionId: str, layerId: str, enabled: bool }, [
      "compositionId",
      "layerId",
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
      if (typeof args.enabled !== "boolean") {
        return fail("enabled must be a boolean", "INVALID_PARAMS");
      }
      const nextLayer: MotionLayer = { ...layer, motionBlur: args.enabled };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`${args.enabled ? "Enabled" : "Disabled"} layer motion blur`, {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "add_motion_light",
    domain: "motion",
    title: "Add motion light",
    description:
      "Add a light (ambient|point|directional) to the composition. Optional: color, intensity, position x/y/z, angle, radius, falloff (light attenuation exponent), castsShadow (bool), shadowOpacity (0-1), shadowSoftness (px blur). Returns the lightId.",
    inputSchema: obj({
      compositionId: str,
      lightType: str,
      name: str,
      color: str,
      intensity: num,
      x: num,
      y: num,
      z: num,
      angle: num,
      radius: num,
      falloff: num,
      castsShadow: bool,
      shadowOpacity: num,
      shadowSoftness: num,
    }, ["compositionId", "lightType"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const lightType = optionalString(args.lightType) as MotionLightType | undefined;
      if (!lightType || !MOTION_LIGHT_TYPES.has(lightType)) {
        return fail(`Unknown light type: ${String(args.lightType)}`, "INVALID_PARAMS");
      }
      const posX = optionalNumber(args.x);
      const posY = optionalNumber(args.y);
      const posZ = optionalNumber(args.z);
      const position =
        posX !== undefined || posY !== undefined || posZ !== undefined
          ? {
              ...(posX !== undefined ? { x: posX } : {}),
              ...(posY !== undefined ? { y: posY } : {}),
              ...(posZ !== undefined ? { z: posZ } : {}),
            }
          : undefined;
      const castsShadow =
        typeof args.castsShadow === "boolean" ? args.castsShadow : undefined;
      const light = createMotionLight(lightType, composition, {
        id: genId(),
        name: optionalString(args.name),
        color: optionalString(args.color),
        intensity: optionalNumber(args.intensity),
        position,
        angle: optionalNumber(args.angle),
        radius: optionalNumber(args.radius),
        falloff: optionalNumber(args.falloff),
        ...(castsShadow !== undefined ? { castsShadow } : {}),
        shadowOpacity: optionalNumber(args.shadowOpacity),
        shadowSoftness: optionalNumber(args.shadowSoftness),
      });
      const nextComposition = addMotionCompositionLight(composition, light);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Added ${lightType} light`, { compositionId: composition.id, lightId: light.id })
        : result;
    },
  },
  {
    name: "update_motion_light",
    domain: "motion",
    title: "Update motion light",
    description:
      "Update a light's numeric property by lightId. property is one of light.intensity, light.position.x/y/z, light.radius, light.falloff, light.angle, light.shadowOpacity, light.shadowSoftness.",
    inputSchema: obj({
      compositionId: str,
      lightId: str,
      property: str,
      value: num,
    }, ["compositionId", "lightId", "property", "value"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const lightId = optionalString(args.lightId);
      if (!lightId || !(composition.lights ?? []).some((light) => light.id === lightId)) {
        return fail("Motion light not found", "NOT_FOUND");
      }
      const property = optionalString(args.property) as MotionLightProperty | undefined;
      if (!property || !isMotionLightProperty(property)) {
        return fail(`Unknown light property: ${String(args.property)}`, "INVALID_PARAMS");
      }
      const value = optionalNumber(args.value);
      if (value === undefined) return fail("value must be a finite number", "INVALID_PARAMS");
      const nextComposition = updateMotionCompositionLight(composition, lightId, (light) =>
        setMotionLightPropertyValue(light, property, value),
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Updated light ${property}`, { compositionId: composition.id, lightId })
        : result;
    },
  },
  {
    name: "remove_motion_light",
    domain: "motion",
    title: "Remove motion light",
    description: "Remove a light from the composition by lightId.",
    inputSchema: obj({ compositionId: str, lightId: str }, ["compositionId", "lightId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const lightId = optionalString(args.lightId);
      if (!lightId || !(composition.lights ?? []).some((light) => light.id === lightId)) {
        return fail("Motion light not found", "NOT_FOUND");
      }
      const nextComposition = removeMotionCompositionLight(composition, lightId);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Removed motion light", { compositionId: composition.id, lightId })
        : result;
    },
  }
];
