/**
 * Color-space helpers shared by raster layer effects.
 *
 * Effect color pickers expose normalized sRGB values. The encoded RGBA8
 * document path converts those values once at the GPU-uniform boundary so the
 * style stack can keep all of its compositing math in linear-light f32.
 */

function boundedChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function rasterEffectSrgbChannelToLinear(value: number): number {
  const channel = boundedChannel(value);
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function rasterEffectColorForLinearCompositing(
  color: readonly number[],
  storedEncodedSrgb: boolean,
): readonly [number, number, number] {
  if (!storedEncodedSrgb) return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0];
  return [
    rasterEffectSrgbChannelToLinear(color[0]),
    rasterEffectSrgbChannelToLinear(color[1]),
    rasterEffectSrgbChannelToLinear(color[2]),
  ];
}
