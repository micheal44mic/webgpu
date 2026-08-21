/**
 * Pure CPU contract for the raster Color Overlay effect.
 *
 * Colors are stored in linear RGB. The effect never occupies a source pixel
 * whose alpha is zero. Its default mode preserves source alpha; the optional
 * uniform-alpha mode replaces every positive source alpha with the selected
 * opacity.
 */

export const RASTER_COLOR_OVERLAY_STRATEGY =
  "analytic-linear-selectable-source-or-uniform-alpha-color-overlay-zero-scratch-v2" as const;

export const RASTER_COLOR_OVERLAY_EFFECT_ID = "color-overlay" as const;
export const RASTER_COLOR_OVERLAY_SCRATCH_BYTES = 0 as const;

export type RasterColorOverlayColor = [number, number, number];
export type RasterColorOverlayReadonlyColor =
  readonly [number, number, number];
export type RasterColorOverlayPremultipliedRgba =
  readonly [number, number, number, number];

export interface RasterColorOverlayStyle {
  enabled: boolean;
  /** Linear RGB, one finite channel in the inclusive range 0..1. */
  color: RasterColorOverlayColor;
  /**
   * When true, every source pixel with alpha > 0 receives one uniform output
   * alpha. A source pixel whose alpha is exactly zero remains transparent.
   */
  uniformAlpha: boolean;
  /**
   * UI percentage in the inclusive range 0..100. This is recolor strength in
   * preserve-alpha mode and the output alpha in uniform-alpha mode.
   */
  opacity: number;
}

const DEFAULT_COLOR: RasterColorOverlayColor = [0, 0, 0];
Object.freeze(DEFAULT_COLOR);

export const DEFAULT_RASTER_COLOR_OVERLAY_STYLE:
Readonly<RasterColorOverlayStyle> = Object.freeze({
  enabled: false,
  color: DEFAULT_COLOR,
  uniformAlpha: false,
  opacity: 100,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sourceRecord(value: unknown): Record<PropertyKey, unknown> {
  return value && typeof value === "object"
    ? value as Record<PropertyKey, unknown>
    : {};
}

function arrayLike(value: unknown): ArrayLike<unknown> | null {
  if (!value) {
    return null;
  }
  const candidate = value as { length?: unknown };
  return typeof candidate.length === "number"
    ? value as ArrayLike<unknown>
    : null;
}

function finiteUnitChannel(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return clamp(value, 0, 1);
}

/** Converts one normalized sRGB channel to linear light. */
export function srgbChannelToLinearColorOverlay(value: number): number {
  const channel = finiteUnitChannel(value, "The sRGB channel");
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Converts one normalized linear-light channel to sRGB. */
export function linearChannelToSrgbColorOverlay(value: number): number {
  const channel = finiteUnitChannel(value, "The linear channel");
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** Parses a six-digit sRGB HEX value into the authoritative linear RGB form. */
export function rasterColorOverlayColorFromHex(
  hex: string,
): RasterColorOverlayColor {
  const normalized = String(hex).trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Invalid Color Overlay HEX color: ${hex}`);
  }
  return [0, 2, 4].map((offset) => (
    srgbChannelToLinearColorOverlay(
      Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
    )
  )) as RasterColorOverlayColor;
}

/** Serializes authoritative linear RGB as a six-digit lowercase sRGB HEX. */
export function rasterColorOverlayColorToHex(
  color: RasterColorOverlayReadonlyColor,
): string {
  const encoded = color.map((channel, index) => {
    const srgb = linearChannelToSrgbColorOverlay(
      finiteUnitChannel(Number(channel), `The linear channel ${index}`),
    );
    return Math.round(srgb * 255).toString(16).padStart(2, "0");
  });
  return `#${encoded.join("")}`;
}

// Explicit aliases keep the storage color space visible at call sites that
// exchange values with `<input type="color">`.
export const hexToLinearRasterColorOverlayColor =
  rasterColorOverlayColorFromHex;
export const linearRasterColorOverlayColorToHex =
  rasterColorOverlayColorToHex;

function normalizeColor(value: unknown): RasterColorOverlayColor {
  if (typeof value === "string") {
    try {
      return rasterColorOverlayColorFromHex(value);
    } catch {
      return [...DEFAULT_COLOR];
    }
  }
  const source = arrayLike(value) ?? DEFAULT_COLOR;
  return Array.from({ length: 3 }, (_, index) => (
    clamp(finite(source[index], DEFAULT_COLOR[index]), 0, 1)
  )) as RasterColorOverlayColor;
}

export function normalizeRasterColorOverlayStyle(
  source: unknown = {},
): RasterColorOverlayStyle {
  const value = sourceRecord(source);
  return {
    enabled: value.enabled === true,
    color: normalizeColor(value.color),
    uniformAlpha: value.uniformAlpha === true,
    opacity: clamp(
      finite(value.opacity, DEFAULT_RASTER_COLOR_OVERLAY_STYLE.opacity),
      0,
      100,
    ),
  };
}

export function copyRasterColorOverlayStyle(
  source: unknown = {},
): RasterColorOverlayStyle {
  const value = normalizeRasterColorOverlayStyle(source);
  return {
    ...value,
    color: [...value.color],
  };
}

export function rasterColorOverlayStylesEqual(
  left: unknown,
  right: unknown,
): boolean {
  const a = normalizeRasterColorOverlayStyle(left);
  const b = normalizeRasterColorOverlayStyle(right);
  return a.enabled === b.enabled
    && a.uniformAlpha === b.uniformAlpha
    && a.opacity === b.opacity
    && a.color.every((channel, index) => channel === b.color[index]);
}

export function rasterColorOverlayIsActive(
  style: {
    readonly enabled: boolean;
    readonly opacity: number;
    readonly uniformAlpha?: boolean;
  },
): boolean {
  return style.enabled && (style.uniformAlpha === true || style.opacity > 0);
}

/**
 * CPU oracle for the shader equation. `base` is premultiplied linear RGBA.
 * Preserve mode returns the supplied alpha byte-for-byte. Uniform mode maps
 * every positive source alpha to `opacity` and keeps alpha zero unoccupied.
 */
export function compositeRasterColorOverlayPixel(
  base: RasterColorOverlayPremultipliedRgba,
  source: unknown,
): readonly [number, number, number, number] {
  const style = normalizeRasterColorOverlayStyle(source);
  if (!style.enabled) {
    return [base[0], base[1], base[2], base[3]];
  }
  const amount = style.opacity / 100;
  if (style.uniformAlpha) {
    if (base[3] <= 0) {
      return [0, 0, 0, 0];
    }
    return [
      style.color[0] * amount,
      style.color[1] * amount,
      style.color[2] * amount,
      amount,
    ];
  }
  if (amount === 0) {
    return [base[0], base[1], base[2], base[3]];
  }
  const inverseAmount = 1 - amount;
  return [
    base[0] * inverseAmount + style.color[0] * base[3] * amount,
    base[1] * inverseAmount + style.color[1] * base[3] * amount,
    base[2] * inverseAmount + style.color[2] * base[3] * amount,
    base[3],
  ];
}
