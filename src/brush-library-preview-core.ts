import type { BrushSettings } from "./engine-types";

export const BRUSH_LIBRARY_PREVIEW_RENDERER_VERSION = "fixed-path-canvas2d-v2";

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

function hash32(value: number): number {
  let mixed = value | 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/** Fixed integer PRNG: independent from clocks, runtime entropy, gesture history and GPU state. */
export function brushLibraryPreviewRandom(seed: number, lane: number): number {
  return hash32(seed ^ Math.imul(lane + 1, 0x9e3779b1)) / 0x1_0000_0000;
}

export function brushLibraryPreviewFingerprint(
  brushId: string,
  settings: Readonly<BrushSettings>,
): string {
  // Color is intentionally absent: library strokes always use neutral ivory.
  // Fields absent below do not affect this representative fixed-path renderer.
  const identity = [
    BRUSH_LIBRARY_PREVIEW_RENDERER_VERSION,
    brushId,
    settings.shape,
    settings.shapeAssetId,
    settings.shapeInvert ? "1" : "0",
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
    fingerprintNumber(settings.size),
    fingerprintNumber(settings.spacingPercent),
    fingerprintNumber(settings.startThickness),
    fingerprintNumber(settings.endThickness),
    String(Math.round(settings.count)),
    fingerprintNumber(settings.flow),
    fingerprintNumber(settings.opacity),
    fingerprintNumber(settings.darknessJitter),
    settings.jitterPerCopy ? "1" : "0",
    fingerprintNumber(settings.positionJitterLateral),
    fingerprintNumber(settings.positionJitterLinear),
  ].join("|");
  return hashString(identity).toString(16).padStart(8, "0");
}

export function hashBrushLibraryPreviewPixels(
  pixels: Uint8Array | Uint8ClampedArray,
): string {
  let hash = 0x811c9dc5;
  for (const value of pixels) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
