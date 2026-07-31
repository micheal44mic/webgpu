
import { type BrushSettings } from "./engine-types";
import { clamp, hexToHsl } from "./color";
import { type PackedStampUpload, type Stamp } from "./engine-stroke-types";
import { LAYER_SIZE, STAMP_STRIDE_BYTES } from "./engine-limits";/**
 * Impacchettamento degli stamp e degli uniform del pennello nei buffer di
 * upload. Formato binario condiviso con gli shader: le taglie vivono in
 * `engine-limits`, qui c'e' solo la scrittura.
 */

export function populateBrushUniformUpload(
  upload: ArrayBuffer,
  settings: BrushSettings,
  targetWidth: number,
  targetHeight: number,
  targetOriginX: number,
  targetOriginY: number,
): void {
  const floats = new Float32Array(upload);
  const unsigned = new Uint32Array(upload);
  floats.fill(0);

  const [hue, saturation, lightness] = hexToHsl(settings.color);

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
  // Keep the uniform ABI stable; pressure-to-alpha has been removed.
  floats[15] = 0;
  floats[16] = settings.positionJitterLinear;
  floats[17] = settings.positionJitterLateral;
  floats[18] = settings.shapeScatter;
  unsigned[20] = settings.count >>> 0;
  unsigned[21] = settings.jitterPerCopy ? 1 : 0;
  unsigned[22] = settings.blendMode === "additive" ? 1 : 0;
  unsigned[23] = 0;
}

export function packStampsIntoUpload(
  stamps: readonly Stamp[],
  settings: BrushSettings,
  uploadF32: Float32Array,
  uploadU32: Uint32Array,
): PackedStampUpload {
  let minimumX = LAYER_SIZE;
  let minimumY = LAYER_SIZE;
  let maximumX = 0;
  let maximumY = 0;
  let minimumRadius = Number.POSITIVE_INFINITY;
  const maximumShapeAngle = Math.PI * settings.shapeScatter;
  const shapeExtentFactor = settings.shape === "shape"
    ? maximumShapeAngle >= Math.PI * 0.25
      ? Math.SQRT2
      : Math.cos(maximumShapeAngle) + Math.sin(maximumShapeAngle)
    : 1;

  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = stamps[index];
    const base = index * (STAMP_STRIDE_BYTES / 4);
    uploadF32[base] = stamp.x;
    uploadF32[base + 1] = stamp.y;
    uploadF32[base + 2] = stamp.radius;
    uploadF32[base + 3] = stamp.pressure;
    uploadU32[base + 4] = stamp.seed;
    uploadU32[base + 5] = 0;
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
  }

  const x = clamp(Math.floor(minimumX), 0, LAYER_SIZE - 1);
  const y = clamp(Math.floor(minimumY), 0, LAYER_SIZE - 1);
  const right = clamp(Math.ceil(maximumX), 1, LAYER_SIZE);
  const bottom = clamp(Math.ceil(maximumY), 1, LAYER_SIZE);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);

  return {
    dirtyRect: width > 0 && height > 0 ? { x, y, width, height } : null,
    minimumRadius,
  };
}
