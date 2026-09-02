/**
 * Deterministic adjacent-code quantization for long, smooth RGBA8 ramps.
 *
 * The ranked 16x16 cell is locally balanced, while every document-space cell
 * receives a stable rotation, reflection and translation. This keeps the
 * quantization error at high spatial frequencies without allowing a camera
 * change to move it. One threshold is shared by RGBA so premultiplication is
 * preserved.
 */

export const RGBA8_HIGH_FREQUENCY_RANK_WORDS = Object.freeze([
  0x55ed46ba, 0xf55f8fdc, 0x8caccf6e, 0x11799fee,
  0x85b064df, 0x9537be1f, 0x2f4e04e0, 0x3957d70c,
  0xcb2b08a6, 0x5310e6a2, 0x6be980b1, 0x882172b7,
  0x50f970e5, 0xc6786940, 0xcc934123, 0xca97f73b,
  0x81941c5d, 0xde2df201, 0x5e13fba5, 0x324d02a9,
  0xdbc443bb, 0x5a89b99d, 0x2cc3771a, 0xabeb7fd9,
  0x5815f083, 0x47d2223a, 0x52e3639a, 0x2967179c,
  0x7b6ca006, 0x0f73adfd, 0x8a09b3f1, 0xddc744bc,
  0xce33b554, 0xbfe44b0a, 0xe834823e, 0x926fff25,
  0x87e720f6, 0x2a9068a4, 0x4caad45b, 0x3c0ea77a,
  0xc0499666, 0xa114d52e, 0xc96a00f8, 0xd0b8621b,
  0x0374d812, 0xc845f359, 0xef288e71, 0x8630d698,
  0xe224b2a3, 0x1e7eb48d, 0x56aebd36, 0x4ff40542,
  0x3d61ec38, 0xea65169e, 0x7c0bda51, 0x76c291e1,
  0xc17dcd19, 0xa8d34afe, 0x35fc9984, 0x5c27af6d,
  0x310d9b8b, 0x26b60775, 0xc560183f, 0xfad1481d,
]);

const rankWordsWgsl = RGBA8_HIGH_FREQUENCY_RANK_WORDS
  .map((word) => `0x${word.toString(16).padStart(8, "0")}u`)
  .join(",\n  ");

export const rgba8HighFrequencyQuantizationShader = /* wgsl */ `
const RGBA8_HIGH_FREQUENCY_RANK_WORDS = array<u32, 64>(
  ${rankWordsWgsl}
);

fn rgba8HighFrequencyMix(input: u32) -> u32 {
  var value = input;
  value ^= value >> 16u;
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  value ^= value >> 16u;
  return value;
}

fn rgba8HighFrequencyThresholdRank(
  documentCoordinate: vec2<u32>,
  seed: u32
) -> u32 {
  let phase = (seed * 159u + 47u) & 255u;
  let block = documentCoordinate >> vec2<u32>(4u);
  let blockHash = rgba8HighFrequencyMix(
    (block.x * 0x9e3779b9u)
      ^ (block.y * 0x85ebca6bu)
      ^ 0xc2b2ae35u
  );
  var local = vec2<u32>(
    (documentCoordinate.x + (phase & 15u) + (blockHash & 15u)) & 15u,
    (documentCoordinate.y + ((phase >> 4u) & 15u)
      + ((blockHash >> 4u) & 15u)) & 15u
  );
  let transform = (blockHash >> 8u) & 7u;
  if ((transform & 4u) != 0u) {
    local = local.yx;
  }
  if ((transform & 1u) != 0u) {
    local.x = 15u - local.x;
  }
  if ((transform & 2u) != 0u) {
    local.y = 15u - local.y;
  }
  let index = local.y * 16u + local.x;
  let packed = RGBA8_HIGH_FREQUENCY_RANK_WORDS[index >> 2u];
  return (packed >> ((index & 3u) * 8u)) & 255u;
}

fn quantizeRgba8HighFrequencyAdjacent(
  value: vec4<f32>,
  documentCoordinate: vec2<u32>,
  seed: u32
) -> vec4<f32> {
  let rank = rgba8HighFrequencyThresholdRank(documentCoordinate, seed);
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

function mix32(input: number): number {
  let value = Math.trunc(input) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function rgba8HighFrequencyThresholdRank(
  documentX: number,
  documentY: number,
  seed: number,
): number {
  const x = Math.trunc(documentX) >>> 0;
  const y = Math.trunc(documentY) >>> 0;
  const phase = (Math.imul(Math.trunc(seed), 159) + 47) & 0xff;
  const blockX = x >>> 4;
  const blockY = y >>> 4;
  const blockHash = mix32(
    (Math.imul(blockX, 0x9e3779b9)
      ^ Math.imul(blockY, 0x85ebca6b)
      ^ 0xc2b2ae35) >>> 0,
  );
  let localX = (x + (phase & 15) + (blockHash & 15)) & 15;
  let localY = (y + ((phase >>> 4) & 15) + ((blockHash >>> 4) & 15)) & 15;
  const transform = (blockHash >>> 8) & 7;
  if ((transform & 4) !== 0) [localX, localY] = [localY, localX];
  if ((transform & 1) !== 0) localX = 15 - localX;
  if ((transform & 2) !== 0) localY = 15 - localY;
  const index = localY * 16 + localX;
  const packed = RGBA8_HIGH_FREQUENCY_RANK_WORDS[index >>> 2] >>> 0;
  return (packed >>> ((index & 3) * 8)) & 0xff;
}

export function quantizeUnorm8HighFrequencyAdjacent(
  value: number,
  documentX: number,
  documentY: number,
  seed: number,
): number {
  const bounded = Math.max(0, Math.min(1, value));
  const scaled = bounded * 255;
  const lower = Math.floor(scaled);
  const threshold = (
    rgba8HighFrequencyThresholdRank(documentX, documentY, seed) + 0.5
  ) / 256;
  return Math.min(255, lower + (scaled - lower > threshold ? 1 : 0));
}
