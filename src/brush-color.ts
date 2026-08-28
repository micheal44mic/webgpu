import type { BrushSettings, BrushShapeMaskFormat } from "./engine-types";

export type BrushSrgb = readonly [red: number, green: number, blue: number];
export type BrushHsl = readonly [hue: number, saturation: number, lightness: number];

const HEX8_PATTERN = /^[0-9a-f]{6}$/i;
const HEX16_PATTERN = /^[0-9a-f]{12}$/i;

function normalizedHex(color: string): string {
  const value = color.trim().replace(/^#/, "");
  if (!HEX8_PATTERN.test(value) && !HEX16_PATTERN.test(value)) {
    throw new Error(`Invalid brush HEX color: ${color}`);
  }
  return value.toLowerCase();
}

function channelHex(value: number, maximum: number, width: number): string {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(1, Math.max(0, finite)) * maximum)
    .toString(16)
    .padStart(width, "0");
}

/** Parses either #RRGGBB or #RRRRGGGGBBBB into normalized encoded-sRGB channels. */
export function parseBrushColorSrgb(color: string): BrushSrgb {
  const value = normalizedHex(color);
  const width = value.length === 12 ? 4 : 2;
  const maximum = width === 4 ? 65_535 : 255;
  return [
    Number.parseInt(value.slice(0, width), 16) / maximum,
    Number.parseInt(value.slice(width, width * 2), 16) / maximum,
    Number.parseInt(value.slice(width * 2, width * 3), 16) / maximum,
  ];
}

/** Returns a canonical 16-bit/channel brush color without reducing source precision. */
export function canonicalBrushColor16(color: string): string {
  const [red, green, blue] = parseBrushColorSrgb(color);
  return `#${channelHex(red, 65_535, 4)}${channelHex(green, 65_535, 4)}${channelHex(blue, 65_535, 4)}`;
}

/** Quantizes normalized encoded-sRGB channels to the diagnostic 8-bit grid. */
export function quantizeBrushSrgb8(color: BrushSrgb): BrushSrgb {
  return [
    Math.round(color[0] * 255) / 255,
    Math.round(color[1] * 255) / 255,
    Math.round(color[2] * 255) / 255,
  ];
}

/** Returns the 8-bit diagnostic representation also accepted by CSS color inputs. */
export function brushColorCssHex(color: string): string {
  const [red, green, blue] = quantizeBrushSrgb8(parseBrushColorSrgb(color));
  return `#${channelHex(red, 255, 2)}${channelHex(green, 255, 2)}${channelHex(blue, 255, 2)}`;
}

export function canonicalBrushColorForFormat(
  color: string,
  format: BrushShapeMaskFormat,
): string {
  return format === "r16float"
    ? canonicalBrushColor16(color)
    : brushColorCssHex(color);
}

/**
 * Resolves the color reaching the authoritative brush path. The Shape mask
 * format is intentionally the single A/B precision switch: R8 quantizes the
 * same source color, while R16F retains its authored 16-bit channel values.
 */
export function brushColorSrgb(
  settings: Pick<BrushSettings, "color" | "shapeMaskFormat">,
): BrushSrgb {
  const color = parseBrushColorSrgb(settings.color);
  return settings.shapeMaskFormat === "r16float" ? color : quantizeBrushSrgb8(color);
}

export function srgbToHsl(color: BrushSrgb): BrushHsl {
  const [red, green, blue] = color;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) * 0.5;

  if (delta === 0) {
    return [0, 0, lightness];
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (maximum === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (maximum === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  hue /= 6;
  if (hue < 0) hue += 1;
  return [hue, saturation, lightness];
}

export function brushColorHsl(
  settings: Pick<BrushSettings, "color" | "shapeMaskFormat">,
): BrushHsl {
  return srgbToHsl(brushColorSrgb(settings));
}

export function srgbChannelToLinear(channel: number): number {
  const value = Math.min(1, Math.max(0, channel));
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

export function brushColorLinearRgb(
  settings: Pick<BrushSettings, "color" | "shapeMaskFormat">,
): BrushSrgb {
  const [red, green, blue] = brushColorSrgb(settings);
  return [
    srgbChannelToLinear(red),
    srgbChannelToLinear(green),
    srgbChannelToLinear(blue),
  ];
}
