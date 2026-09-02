import {
  linearToSrgbChannel,
  type LinearPremultipliedRgba,
  type LayerBlendMode,
} from "./layer-blend-modes.ts";

export type LayerCutoutMode = "off" | "group" | "document";

/**
 * Ordered tonal transition points in the inclusive 8-bit display range:
 * hidden shadow end, visible shadow start, visible highlight end, hidden
 * highlight start.
 */
export type LayerTonalRange = readonly [number, number, number, number];

export interface LayerTonalBlend {
  readonly current: LayerTonalRange;
  readonly underlying: LayerTonalRange;
}

export interface LayerOptionsState {
  readonly opacity: number;
  readonly blendMode: LayerBlendMode;
  readonly contentOpacity: number;
  readonly cutoutMode: LayerCutoutMode;
  readonly tonalBlend: LayerTonalBlend;
}

export interface MutableLayerOptionsState {
  opacity: number;
  blendMode: LayerBlendMode;
  contentOpacity: number;
  cutoutMode: LayerCutoutMode;
  tonalBlend: LayerTonalBlend;
}

export const DEFAULT_LAYER_CONTENT_OPACITY = 1 as const;
export const DEFAULT_LAYER_CUTOUT_MODE: LayerCutoutMode = "off";
export const DEFAULT_LAYER_TONAL_RANGE: LayerTonalRange = [0, 0, 255, 255];
export const DEFAULT_LAYER_TONAL_BLEND: LayerTonalBlend = {
  current: DEFAULT_LAYER_TONAL_RANGE,
  underlying: DEFAULT_LAYER_TONAL_RANGE,
};

export const LAYER_CUTOUT_MODE_CODES: Readonly<Record<LayerCutoutMode, number>> = {
  off: 0,
  group: 1,
  document: 2,
};

const clampByte = (value: number): number => (
  Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
);

export function normalizeLayerContentOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LAYER_CONTENT_OPACITY;
  }
  return Math.min(1, Math.max(0, value));
}

export function normalizeLayerCutoutMode(value: unknown): LayerCutoutMode {
  return value === "group" || value === "document" ? value : "off";
}

export function normalizeLayerTonalRange(value: unknown): LayerTonalRange {
  if (!Array.isArray(value) || value.length !== 4) {
    return [...DEFAULT_LAYER_TONAL_RANGE];
  }
  const a = clampByte(Number(value[0]));
  const b = Math.max(a, clampByte(Number(value[1])));
  const c = Math.max(b, clampByte(Number(value[2])));
  const d = Math.max(c, clampByte(Number(value[3])));
  return [a, b, c, d];
}

export function normalizeLayerTonalBlend(value: unknown): LayerTonalBlend {
  const candidate = value && typeof value === "object"
    ? value as Partial<LayerTonalBlend>
    : {};
  return {
    current: normalizeLayerTonalRange(candidate.current),
    underlying: normalizeLayerTonalRange(candidate.underlying),
  };
}

export function cloneLayerTonalBlend(value: LayerTonalBlend): LayerTonalBlend {
  return {
    current: [...value.current] as LayerTonalRange,
    underlying: [...value.underlying] as LayerTonalRange,
  };
}

export function captureLayerOptionsState(value: LayerOptionsState): LayerOptionsState {
  return {
    opacity: value.opacity,
    blendMode: value.blendMode,
    contentOpacity: value.contentOpacity,
    cutoutMode: value.cutoutMode,
    tonalBlend: cloneLayerTonalBlend(value.tonalBlend),
  };
}

export function applyLayerOptionsState(
  target: MutableLayerOptionsState,
  value: LayerOptionsState,
): void {
  target.opacity = Number.isFinite(value.opacity)
    ? Math.min(1, Math.max(0, value.opacity))
    : 1;
  target.blendMode = value.blendMode;
  target.contentOpacity = normalizeLayerContentOpacity(value.contentOpacity);
  target.cutoutMode = normalizeLayerCutoutMode(value.cutoutMode);
  target.tonalBlend = normalizeLayerTonalBlend(value.tonalBlend);
}

export function layerOptionsStatesEqual(
  left: LayerOptionsState,
  right: LayerOptionsState,
): boolean {
  return left.opacity === right.opacity
    && left.blendMode === right.blendMode
    && left.contentOpacity === right.contentOpacity
    && left.cutoutMode === right.cutoutMode
    && left.tonalBlend.current.every(
      (entry, index) => entry === right.tonalBlend.current[index],
    )
    && left.tonalBlend.underlying.every(
      (entry, index) => entry === right.tonalBlend.underlying[index],
    );
}

export function layerTonalBlendIsDefault(value: LayerTonalBlend): boolean {
  return value.current[0] === 0
    && value.current[1] === 0
    && value.current[2] === 255
    && value.current[3] === 255
    && value.underlying[0] === 0
    && value.underlying[1] === 0
    && value.underlying[2] === 255
    && value.underlying[3] === 255;
}

export function layerCompositionIsDefault(value: {
  readonly contentOpacity: number;
  readonly cutoutMode: LayerCutoutMode;
  readonly tonalBlend: LayerTonalBlend;
}): boolean {
  return value.contentOpacity === DEFAULT_LAYER_CONTENT_OPACITY
    && value.cutoutMode === DEFAULT_LAYER_CUTOUT_MODE
    && layerTonalBlendIsDefault(value.tonalBlend);
}

function transitionMask(value: number, range: LayerTonalRange): number {
  const normalized = Math.min(1, Math.max(0, value));
  const shadowHidden = range[0] / 255;
  const shadowVisible = range[1] / 255;
  const highlightVisible = range[2] / 255;
  const highlightHidden = range[3] / 255;
  const low = shadowVisible > shadowHidden
    ? Math.min(1, Math.max(0, (normalized - shadowHidden) / (shadowVisible - shadowHidden)))
    : normalized >= shadowVisible ? 1 : 0;
  const high = highlightHidden > highlightVisible
    ? 1 - Math.min(
      1,
      Math.max(0, (normalized - highlightVisible) / (highlightHidden - highlightVisible)),
    )
    : normalized <= highlightVisible ? 1 : 0;
  return low * high;
}

export type LayerTonalBlendStorage =
  | "linear-premultiplied"
  | "encoded-srgb-premultiplied";

function premultipliedDisplayTone(
  input: LinearPremultipliedRgba,
  storage: LayerTonalBlendStorage,
): number {
  const alpha = Math.min(1, Math.max(0, input[3]));
  if (alpha <= 0) {
    return 0;
  }
  const displayChannel = (channel: number): number => {
    const straight = Math.min(1, Math.max(0, channel / alpha));
    return storage === "encoded-srgb-premultiplied"
      ? straight
      : linearToSrgbChannel(straight);
  };
  const red = displayChannel(input[0]);
  const green = displayChannel(input[1]);
  const blue = displayChannel(input[2]);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function layerTonalBlendMask(
  source: LinearPremultipliedRgba,
  backdrop: LinearPremultipliedRgba,
  value: LayerTonalBlend,
  storage: LayerTonalBlendStorage = "linear-premultiplied",
): number {
  return transitionMask(premultipliedDisplayTone(source, storage), value.current)
    * transitionMask(premultipliedDisplayTone(backdrop, storage), value.underlying);
}
