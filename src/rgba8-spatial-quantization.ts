/**
 * A deterministic 16x16 ordered threshold field for adjacent-code RGBA8
 * quantization. Coordinates are document texels, so camera changes cannot move
 * the pattern. The action seed only scrambles the periodic field between
 * independent edits; replaying the same edit reconstructs the same pixels.
 *
 * One threshold is shared by RGBA. That makes the quantizer monotone across
 * channels and therefore preserves RGB <= A for premultiplied input.
 */
export const rgba8SpatialQuantizationShader = /* wgsl */ `
fn rgba8SpatialThresholdRank(
  documentCoordinate: vec2<u32>,
  seed: u32
) -> u32 {
  // The odd multiplier permutes all 256 phases. Split that phase into a 16x16
  // translation: every action retains the ordered spatial field, while one
  // fixed document texel visits every threshold over 256 replay-stable edits.
  let phase = (seed * 159u + 47u) & 255u;
  let x = (documentCoordinate.x + (phase & 15u)) & 15u;
  let y = (documentCoordinate.y + ((phase >> 4u) & 15u)) & 15u;

  // A 16x16 Bayer permutation. Every rank 0..255 occurs exactly once in each
  // tile, while every power-of-two neighborhood receives dispersed thresholds.
  let diagonal = x ^ y;
  return ((diagonal & 1u) << 7u)
    | ((y & 1u) << 6u)
    | (((diagonal >> 1u) & 1u) << 5u)
    | (((y >> 1u) & 1u) << 4u)
    | (((diagonal >> 2u) & 1u) << 3u)
    | (((y >> 2u) & 1u) << 2u)
    | (((diagonal >> 3u) & 1u) << 1u)
    | ((y >> 3u) & 1u);
}

fn quantizeRgba8SpatialAdjacent(
  value: vec4<f32>,
  documentCoordinate: vec2<u32>,
  seed: u32
) -> vec4<f32> {
  let rank = rgba8SpatialThresholdRank(documentCoordinate, seed);
  let threshold = (f32(rank) + 0.5) / 256.0;
  let bounded = clamp(value, vec4<f32>(0.0), vec4<f32>(1.0));
  let scaled = bounded * 255.0;
  let lower = floor(scaled);
  let roundUp = select(
    vec4<f32>(0.0),
    vec4<f32>(1.0),
    fract(scaled) > vec4<f32>(threshold)
  );
  return min(lower + roundUp, vec4<f32>(255.0)) / 255.0;
}
`;

export function rgba8SpatialThresholdRank(
  documentX: number,
  documentY: number,
  seed: number,
): number {
  const phase = (Math.imul(Math.trunc(seed), 159) + 47) & 0xff;
  const x = ((Math.trunc(documentX) >>> 0) + (phase & 15)) & 15;
  const y = ((Math.trunc(documentY) >>> 0) + (phase >>> 4)) & 15;
  const diagonal = x ^ y;
  return ((diagonal & 1) << 7)
    | ((y & 1) << 6)
    | (((diagonal >>> 1) & 1) << 5)
    | (((y >>> 1) & 1) << 4)
    | (((diagonal >>> 2) & 1) << 3)
    | (((y >>> 2) & 1) << 2)
    | (((diagonal >>> 3) & 1) << 1)
    | ((y >>> 3) & 1);
}

export function quantizeUnorm8SpatialAdjacent(
  value: number,
  documentX: number,
  documentY: number,
  seed: number,
): number {
  const bounded = Math.max(0, Math.min(1, value));
  const scaled = bounded * 255;
  const lower = Math.floor(scaled);
  const threshold = (
    rgba8SpatialThresholdRank(documentX, documentY, seed) + 0.5
  ) / 256;
  return Math.min(255, lower + (scaled - lower > threshold ? 1 : 0));
}
