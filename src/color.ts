import { parseBrushColorSrgb, srgbToHsl } from "./brush-color.ts";

export type Hsl = readonly [hue: number, saturation: number, lightness: number];

export function hexToHsl(hex: string): Hsl {
  try {
    return srgbToHsl(parseBrushColorSrgb(hex));
  } catch {
    throw new Error(`Invalid HEX color: ${hex}`);
  }
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
