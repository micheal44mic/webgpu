import type { BrushSettings } from "./engine-types";

export const BRUSH_LIBRARY_PREVIEW_RENDERER_VERSION = "authoritative-webgpu-v1";

function fingerprintNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function brushLibraryPreviewFingerprint(
  brushId: string,
  settings: Readonly<BrushSettings>,
): string {
  // Color is intentionally absent: library strokes always use neutral ivory.
  // Every other field that reaches the authoritative paint path participates.
  const shapeSequence = settings.shapeAssetIds?.length
    ? settings.shapeAssetIds
    : [settings.shapeAssetId];
  const identity = [
    BRUSH_LIBRARY_PREVIEW_RENDERER_VERSION,
    brushId,
    settings.shape,
    settings.tipFalloff ?? "standard",
    shapeSequence.join(">"),
    settings.shapeSequenceMode,
    settings.shapeInvert ? "1" : "0",
    settings.shapeMaskFormat === "r8unorm" ? "r8unorm" : "r16float",
    settings.shapeRotation,
    fingerprintNumber(settings.shapeScatter),
    settings.grainMode,
    settings.grainAssetId,
    fingerprintNumber(settings.grainScale),
    fingerprintNumber(settings.grainMovement),
    fingerprintNumber(settings.grainDepth),
    fingerprintNumber(settings.grainBrightness),
    fingerprintNumber(settings.grainContrast),
    settings.grainInvert ? "1" : "0",
    settings.grainFiltering,
    settings.grainBlendMode,
    fingerprintNumber(settings.size),
    fingerprintNumber(settings.spacingPercent),
    fingerprintNumber(settings.stabilization),
    fingerprintNumber(settings.startThickness),
    fingerprintNumber(settings.endThickness),
    String(Math.round(settings.count)),
    fingerprintNumber(settings.flow),
    fingerprintNumber(settings.opacity),
    fingerprintNumber(settings.hardness),
    settings.blendMode,
    fingerprintNumber(settings.hueJitterDegrees),
    fingerprintNumber(settings.saturationJitter),
    fingerprintNumber(settings.lightnessJitter),
    fingerprintNumber(settings.darknessJitter),
    settings.jitterPerCopy ? "1" : "0",
    fingerprintNumber(settings.positionJitterLateral),
    fingerprintNumber(settings.positionJitterLinear),
  ].join("|");
  return hashString(identity).toString(16).padStart(8, "0");
}
