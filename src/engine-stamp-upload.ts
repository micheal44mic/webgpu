
import { type BrushSettings, type LayerFormat } from "./engine-types";
import { brushColorHsl } from "./brush-color.ts";
import { clamp } from "./color";
import { type PackedStampUpload, type Stamp } from "./engine-stroke-types";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH, STAMP_STRIDE_BYTES } from "./engine-limits";/**
 * Impacchettamento degli stamp e degli uniform del pennello nei buffer di
 * upload. Formato binario condiviso con gli shader: le taglie vivono in
 * `engine-limits`, qui c'e' solo la scrittura.
 */
import {
  encodeStrokeSymmetryOptions,
  reflectedStrokeSymmetryExtent,
  reflectStrokeSymmetryCenter,
  strokeSymmetryReflectionCoefficients,
  type StrokeSymmetryMode,
} from "./stroke-symmetry-core";

export function populateGrainUniformUpload(
  upload: ArrayBuffer | Float32Array,
  settings: Readonly<BrushSettings>,
  textureWidth: number,
  mipLevelCount: number,
  coordinateScale = 1,
): void {
  const floats = upload instanceof Float32Array ? upload : new Float32Array(upload);
  const unsigned = new Uint32Array(
    floats.buffer,
    floats.byteOffset,
    floats.byteLength / Uint32Array.BYTES_PER_ELEMENT,
  );
  floats.fill(0);
  const authoredScale = clamp(settings.grainScale, 0.1, 4);
  const projectedScale = Math.max(Number.EPSILON, coordinateScale) * authoredScale;
  const polarity = settings.grainInvert ? -1 : 1;
  floats[0] = 1 / (Math.max(1, textureWidth) * projectedScale);
  floats[1] = clamp(settings.grainDepth, 0, 1);
  // Folding inversion into the affine brightness/contrast transform keeps the
  // exact fragment path shared by fixed and moving grain.
  floats[2] = clamp(settings.grainBrightness, -1, 1) * polarity;
  floats[3] = (1 + clamp(settings.grainContrast, -1, 1)) * polarity;
  unsigned[4] = settings.grainFiltering === "no"
    ? 0
    : settings.grainFiltering === "classic" ? 1 : 2;
  const movement = clamp(settings.grainMovement ?? 0, 0, 1);
  unsigned[5] = settings.grainMode === "moving"
    ? movement > 0 ? 2 : 1
    : 0;
  unsigned[6] = Math.max(1, mipLevelCount) >>> 0;
  floats[7] = movement;
}

export type StrokeGlazeAccumulationMode =
  | "source-over"
  | "light-no-build-up"
  | "encoded-srgb-source-over";

export function populateStrokeGlazeUniformUpload(
  upload: ArrayBuffer,
  opacity: number,
  layerFormat: LayerFormat,
  accumulationMode: StrokeGlazeAccumulationMode,
  tintLinear: readonly [number, number, number] | null,
): void {
  const floats = new Float32Array(upload);
  const unsigned = new Uint32Array(upload);
  floats.fill(0);
  floats[0] = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
  unsigned[1] = layerFormat === "rgba16float" ? 1 : 0;
  unsigned[2] = accumulationMode === "light-no-build-up"
    ? 1
    : accumulationMode === "encoded-srgb-source-over" ? 2 : 0;
  floats[4] = tintLinear?.[0] ?? 0;
  floats[5] = tintLinear?.[1] ?? 0;
  floats[6] = tintLinear?.[2] ?? 0;
  floats[7] = 1;
}

export function populateBrushUniformUpload(
  upload: ArrayBuffer,
  settings: BrushSettings,
  targetWidth: number,
  targetHeight: number,
  targetOriginX: number,
  targetOriginY: number,
  symmetryMode: StrokeSymmetryMode = "off",
  symmetryAngleRadians?: number,
  documentWidth = targetWidth,
  documentHeight = targetHeight,
): void {
  const floats = new Float32Array(upload);
  const unsigned = new Uint32Array(upload);
  floats.fill(0);

  const [hue, saturation, lightness] = brushColorHsl(settings);

  floats[0] = targetWidth;
  floats[1] = targetHeight;
  floats[2] = targetOriginX;
  floats[3] = targetOriginY;
  floats[4] = hue;
  floats[5] = saturation;
  floats[6] = lightness;
  // The WGSL already multiplied baseHslAlpha.w into every physical stamp.
  // Feeding opacity through that existing lane keeps Normal at 100% on the
  // same shader and pipeline path while extending Normal/Additive exactly.
  floats[7] = Number.isFinite(settings.opacity) ? clamp(settings.opacity, 0, 1) : 1;
  floats[8] = settings.hueJitterDegrees / 360;
  floats[9] = settings.saturationJitter;
  floats[10] = settings.lightnessJitter;
  floats[11] = settings.darknessJitter;
  floats[12] = settings.flow;
  floats[13] = settings.hardness;
  // Legacy ABI lane: Blend Intensity is permanently neutralized.
  floats[14] = 1;
  // Precomputed reflection coefficients occupy two retired ABI lanes. This
  // keeps arbitrary-axis symmetry out of the per-vertex trigonometry path.
  const [reflectionCosine, reflectionSine] = strokeSymmetryReflectionCoefficients(
    symmetryMode,
    symmetryAngleRadians,
  );
  floats[15] = reflectionCosine;
  floats[16] = settings.positionJitterLinear;
  floats[17] = settings.positionJitterLateral;
  floats[18] = settings.shapeScatter;
  floats[19] = reflectionSine;
  unsigned[20] = encodeStrokeSymmetryOptions(settings.count, symmetryMode);
  unsigned[21] = settings.jitterPerCopy ? 1 : 0;
  // Bit 0 retains the render-mode ABI. Bit 1 selects the explicit 8-bit A/B
  // comparison while the authoritative textures and render targets stay 16F.
  unsigned[22] = (settings.blendMode === "additive" ? 1 : 0)
    | (settings.shapeMaskFormat === "r8unorm" ? 2 : 0);
  // Previously unused ABI lane: opt-in base rotation along the stamp direction.
  unsigned[23] = settings.shapeRotation === "follow-stroke" ? 1 : 0;
  floats[24] = documentWidth;
  floats[25] = documentHeight;
}

export function packStampsIntoUpload(
  stamps: readonly Stamp[],
  settings: BrushSettings,
  uploadF32: Float32Array,
  uploadU32: Uint32Array,
  stampCount = stamps.length,
): PackedStampUpload {
  let minimumX = DOCUMENT_WIDTH;
  let minimumY = DOCUMENT_HEIGHT;
  let maximumX = 0;
  let maximumY = 0;
  let minimumRadius = Number.POSITIVE_INFINITY;
  const maximumShapeAngle = Math.PI * settings.shapeScatter;
  const shapeExtentFactor = settings.shape === "shape"
    ? settings.shapeRotation === "follow-stroke" || maximumShapeAngle >= Math.PI * 0.25
      ? Math.SQRT2
      : Math.cos(maximumShapeAngle) + Math.sin(maximumShapeAngle)
    : 1;

  for (let index = 0; index < stampCount; index += 1) {
    const stamp = stamps[index];
    const base = index * (STAMP_STRIDE_BYTES / 4);
    uploadF32[base] = stamp.x;
    uploadF32[base + 1] = stamp.y;
    uploadF32[base + 2] = stamp.radius;
    uploadF32[base + 3] = stamp.pressure;
    uploadU32[base + 4] = stamp.seed;
    uploadU32[base + 5] = Math.max(0, Math.min(3, Math.trunc(stamp.shapeLayer ?? 0))) >>> 0;
    uploadF32[base + 6] = stamp.directionX;
    uploadF32[base + 7] = stamp.directionY;

    const packedX = uploadF32[base];
    const packedY = uploadF32[base + 1];
    const packedRadius = uploadF32[base + 2];
    minimumRadius = Math.min(minimumRadius, packedRadius);
    const packedDirectionX = uploadF32[base + 6];
    const packedDirectionY = uploadF32[base + 7];
    const directionLength = Math.hypot(packedDirectionX, packedDirectionY);
    const linearReach = packedRadius * 2 * settings.positionJitterLinear;
    const lateralReach = packedRadius * 2 * settings.positionJitterLateral;
    const brushReach = packedRadius * shapeExtentFactor;
    let reachX: number;
    let reachY: number;

    if (directionLength > 0.0002) {
      const directionX = packedDirectionX / directionLength;
      const directionY = packedDirectionY / directionLength;
      reachX = brushReach
        + Math.abs(directionX) * linearReach
        + Math.abs(directionY) * lateralReach
        + 2;
      reachY = brushReach
        + Math.abs(directionY) * linearReach
        + Math.abs(directionX) * lateralReach
        + 2;
    } else {
      const isotropicReach = brushReach + linearReach + lateralReach + 2;
      reachX = isotropicReach;
      reachY = isotropicReach;
    }

    minimumX = Math.min(minimumX, packedX - reachX);
    minimumY = Math.min(minimumY, packedY - reachY);
    maximumX = Math.max(maximumX, packedX + reachX);
    maximumY = Math.max(maximumY, packedY + reachY);

    if (stamp.symmetryMode !== "off") {
      const [reflectedX, reflectedY] = reflectStrokeSymmetryCenter(
        packedX,
        packedY,
        stamp.symmetryMode,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
        stamp.symmetryAngleRadians,
      );
      const [reflectedReachX, reflectedReachY] = reflectedStrokeSymmetryExtent(
        reachX,
        reachY,
        stamp.symmetryMode,
        stamp.symmetryAngleRadians,
      );
      minimumX = Math.min(minimumX, reflectedX - reflectedReachX);
      minimumY = Math.min(minimumY, reflectedY - reflectedReachY);
      maximumX = Math.max(maximumX, reflectedX + reflectedReachX);
      maximumY = Math.max(maximumY, reflectedY + reflectedReachY);
    }
  }

  const x = clamp(Math.floor(minimumX), 0, DOCUMENT_WIDTH - 1);
  const y = clamp(Math.floor(minimumY), 0, DOCUMENT_HEIGHT - 1);
  const right = clamp(Math.ceil(maximumX), 1, DOCUMENT_WIDTH);
  const bottom = clamp(Math.ceil(maximumY), 1, DOCUMENT_HEIGHT);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);

  return {
    dirtyRect: width > 0 && height > 0 ? { x, y, width, height } : null,
    minimumRadius,
  };
}
