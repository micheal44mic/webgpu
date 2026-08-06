export type Hsl = readonly [hue: number, saturation: number, lightness: number];

export function hexToHsl(hex: string): Hsl {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Colore HEX non valido: ${hex}`);
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;

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
  if (hue < 0) {
    hue += 1;
  }

  return [hue, saturation, lightness];
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
