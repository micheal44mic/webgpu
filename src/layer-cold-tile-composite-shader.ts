import {
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_SIZE,
} from "./engine-limits.ts";

/**
 * Directly folds authoritative cold array tiles into a mip-0 merged surface.
 *
 * The source and destination stay in the document's native format. A tile is
 * addressed with integer coordinates and `textureLoad`, so this path performs
 * neither filtering nor RGBA8 conversion. It is intentionally restricted by
 * the runtime to resolutionScale=1 and Normal fixed-function compositing.
 */
export const LAYER_COLD_TILE_COMPOSITE_UNIFORM_BYTES = 32 as const;
export const LAYER_COLD_TILE_COMPOSITE_BATCH_TILES = 16 as const;

export const LAYER_COLD_TILE_COMPOSITE_WGSL = /* wgsl */ `
const TILE_SIZE: i32 = ${DOCUMENT_TILE_SIZE};
const TILE_GRID_SIZE: u32 = ${DOCUMENT_TILE_GRID_SIZE}u;

struct ColdTileCompositeUniforms {
  destinationOrigin: vec2<i32>,
  destinationDimensions: vec2<u32>,
  opacity: f32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct ColdTileIndices {
  values: array<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) arrayLayer: u32,
  @location(1) @interpolate(flat) tileOrigin: vec2<i32>,
};

@group(0) @binding(0) var sourceTiles: texture_2d_array<f32>;
@group(0) @binding(1) var<storage, read> tileIndices: ColdTileIndices;
@group(0) @binding(2) var<uniform> fold: ColdTileCompositeUniforms;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2<u32>, 6>(
    vec2<u32>(0u, 0u),
    vec2<u32>(1u, 0u),
    vec2<u32>(0u, 1u),
    vec2<u32>(0u, 1u),
    vec2<u32>(1u, 0u),
    vec2<u32>(1u, 1u)
  );
  let tileIndex = tileIndices.values[instanceIndex];
  let tileOrigin = vec2<i32>(
    i32(tileIndex % TILE_GRID_SIZE) * TILE_SIZE,
    i32(tileIndex / TILE_GRID_SIZE) * TILE_SIZE
  );
  let tileEnd = tileOrigin + vec2<i32>(TILE_SIZE);
  let destinationEnd = fold.destinationOrigin + vec2<i32>(fold.destinationDimensions);
  let clippedOrigin = max(tileOrigin, fold.destinationOrigin);
  let clippedEnd = min(tileEnd, destinationEnd);
  let corner = corners[vertexIndex];
  let documentPosition = vec2<i32>(
    select(clippedOrigin.x, clippedEnd.x, corner.x != 0u),
    select(clippedOrigin.y, clippedEnd.y, corner.y != 0u)
  );
  let localPosition = vec2<f32>(documentPosition - fold.destinationOrigin);
  let dimensions = max(vec2<f32>(fold.destinationDimensions), vec2<f32>(1.0));
  let clipPosition = vec2<f32>(
    localPosition.x / dimensions.x * 2.0 - 1.0,
    1.0 - localPosition.y / dimensions.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.arrayLayer = instanceIndex;
  output.tileOrigin = tileOrigin;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let destinationPixel = vec2<i32>(input.position.xy);
  let documentPixel = fold.destinationOrigin + destinationPixel;
  let sourcePixel = documentPixel - input.tileOrigin;
  return textureLoad(
    sourceTiles,
    sourcePixel,
    i32(input.arrayLayer),
    0
  ) * clamp(fold.opacity, 0.0, 1.0);
}
`;
