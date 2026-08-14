import type { BrushEngine } from "./brush-engine";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "./engine-limits";
import type { DirtyRect } from "./engine-stroke-types";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_MASK_WORD_COUNT,
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_WIDTH,
  countLayerStorageTiles,
  createLayerStorageTileMask,
} from "./layer-storage-study";

const OCCUPANCY_WORKGROUP_EDGE = 16;
const OCCUPANCY_RESULT_WORD_COUNT = 16;
const OCCUPANCY_RESULT_BYTES = OCCUPANCY_RESULT_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const OCCUPANCY_UNIFORM_BYTES = 12 * Uint32Array.BYTES_PER_ELEMENT;
const RESULT_OCCUPIED = LAYER_STORAGE_MASK_WORD_COUNT;
const RESULT_MIN_X = RESULT_OCCUPIED + 1;
const RESULT_MIN_Y = RESULT_OCCUPIED + 2;
const RESULT_MAX_X = RESULT_OCCUPIED + 3;
const RESULT_MAX_Y = RESULT_OCCUPIED + 4;

export const RASTER_OCCUPANCY_ANALYSIS_STRATEGY =
  "gpu-exact-nonzero-pixel-bounds-and-256-tile-mask-v1" as const;

export const rasterOccupancyAnalysisShader = /* wgsl */ `
struct OccupancyParams {
  // origin.xy, size.xy; the scan rect is workgroup aligned.
  scan: vec4<u32>,
  // Exact conservative input bounds: left, top, right, bottom.
  clip: vec4<u32>,
  // tile width, tile height, grid edge, unused.
  tile: vec4<u32>,
}

struct OccupancyResult {
  mask: array<atomic<u32>, ${LAYER_STORAGE_MASK_WORD_COUNT}>,
  occupied: atomic<u32>,
  minX: atomic<u32>,
  minY: atomic<u32>,
  maxX: atomic<u32>,
  maxY: atomic<u32>,
  padding0: atomic<u32>,
  padding1: atomic<u32>,
  padding2: atomic<u32>,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> result: OccupancyResult;
@group(0) @binding(2) var<uniform> params: OccupancyParams;

var<workgroup> localOccupied: atomic<u32>;
var<workgroup> localMinX: atomic<u32>;
var<workgroup> localMinY: atomic<u32>;
var<workgroup> localMaxX: atomic<u32>;
var<workgroup> localMaxY: atomic<u32>;

@compute @workgroup_size(${OCCUPANCY_WORKGROUP_EDGE}, ${OCCUPANCY_WORKGROUP_EDGE})
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  if (localIndex == 0u) {
    atomicStore(&localOccupied, 0u);
    atomicStore(&localMinX, 0xffffffffu);
    atomicStore(&localMinY, 0xffffffffu);
    atomicStore(&localMaxX, 0u);
    atomicStore(&localMaxY, 0u);
  }
  workgroupBarrier();

  let coordinate = params.scan.xy + globalId.xy;
  let inScan = all(globalId.xy < params.scan.zw);
  let inClip = all(coordinate >= params.clip.xy)
    && all(coordinate < params.clip.zw);
  if (inScan && inClip) {
    let value = textureLoad(sourceTexture, vec2<i32>(coordinate), 0);
    // Authoritative premultiplied textures should have zero RGB at zero alpha,
    // but preserving any non-zero component also protects future/raw formats.
    if (any(value != vec4<f32>(0.0))) {
      atomicStore(&localOccupied, 1u);
      atomicMin(&localMinX, coordinate.x);
      atomicMin(&localMinY, coordinate.y);
      atomicMax(&localMaxX, coordinate.x + 1u);
      atomicMax(&localMaxY, coordinate.y + 1u);
    }
  }
  workgroupBarrier();

  if (localIndex == 0u && atomicLoad(&localOccupied) != 0u) {
    let minimumX = atomicLoad(&localMinX);
    let minimumY = atomicLoad(&localMinY);
    // The scan origin is aligned to a 16-pixel workgroup and storage tiles are
    // multiples of 16, so one workgroup cannot cross a storage-tile boundary.
    let tileX = minimumX / params.tile.x;
    let tileY = minimumY / params.tile.y;
    let tileIndex = tileY * params.tile.z + tileX;
    atomicOr(&result.mask[tileIndex >> 5u], 1u << (tileIndex & 31u));
    atomicStore(&result.occupied, 1u);
    atomicMin(&result.minX, minimumX);
    atomicMin(&result.minY, minimumY);
    atomicMax(&result.maxX, atomicLoad(&localMaxX));
    atomicMax(&result.maxY, atomicLoad(&localMaxY));
  }
}
`;

export interface RasterOccupancyAnalysis {
  readonly bounds: DirtyRect | null;
  readonly tileMask: Uint32Array;
  readonly occupiedTileCount: number;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function normalizedAnalysisBounds(bounds: DirtyRect): DirtyRect | null {
  const left = clampInteger(bounds.x, 0, DOCUMENT_WIDTH);
  const top = clampInteger(bounds.y, 0, DOCUMENT_HEIGHT);
  const right = clampInteger(Math.ceil(bounds.x + bounds.width), 0, DOCUMENT_WIDTH);
  const bottom = clampInteger(Math.ceil(bounds.y + bounds.height), 0, DOCUMENT_HEIGHT);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * One bounded readback derives the exact occupied storage tiles and pixel
 * bounds from an already-rendered raster. No pixel payload leaves the GPU.
 */
export async function analyzeRasterTextureOccupancy(
  engine: BrushEngine,
  texture: GPUTexture,
  conservativeBounds: DirtyRect,
  label: string,
): Promise<RasterOccupancyAnalysis> {
  const bounds = normalizedAnalysisBounds(conservativeBounds);
  if (!bounds) {
    return {
      bounds: null,
      tileMask: createLayerStorageTileMask(),
      occupiedTileCount: 0,
    };
  }

  const scanLeft = Math.floor(bounds.x / OCCUPANCY_WORKGROUP_EDGE)
    * OCCUPANCY_WORKGROUP_EDGE;
  const scanTop = Math.floor(bounds.y / OCCUPANCY_WORKGROUP_EDGE)
    * OCCUPANCY_WORKGROUP_EDGE;
  const scanRight = Math.min(
    DOCUMENT_WIDTH,
    Math.ceil((bounds.x + bounds.width) / OCCUPANCY_WORKGROUP_EDGE)
      * OCCUPANCY_WORKGROUP_EDGE,
  );
  const scanBottom = Math.min(
    DOCUMENT_HEIGHT,
    Math.ceil((bounds.y + bounds.height) / OCCUPANCY_WORKGROUP_EDGE)
      * OCCUPANCY_WORKGROUP_EDGE,
  );
  const scanWidth = scanRight - scanLeft;
  const scanHeight = scanBottom - scanTop;

  const resultBuffer = engine.device.createBuffer({
    label: `${label} occupancy result`,
    size: OCCUPANCY_RESULT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = engine.device.createBuffer({
    label: `${label} occupancy readback`,
    size: OCCUPANCY_RESULT_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const uniformBuffer = engine.device.createBuffer({
    label: `${label} occupancy uniforms`,
    size: OCCUPANCY_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  try {
    const initial = new Uint32Array(OCCUPANCY_RESULT_WORD_COUNT);
    initial[RESULT_MIN_X] = 0xffffffff;
    initial[RESULT_MIN_Y] = 0xffffffff;
    engine.device.queue.writeBuffer(resultBuffer, 0, initial);
    engine.device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Uint32Array([
        scanLeft,
        scanTop,
        scanWidth,
        scanHeight,
        bounds.x,
        bounds.y,
        bounds.x + bounds.width,
        bounds.y + bounds.height,
        LAYER_STORAGE_TILE_WIDTH,
        LAYER_STORAGE_TILE_HEIGHT,
        LAYER_STORAGE_GRID_SIZE,
        0,
      ]),
    );

    const bindGroupLayout = engine.device.createBindGroupLayout({
      label: `${label} occupancy bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
    const pipeline = engine.device.createComputePipeline({
      label: `${label} occupancy pipeline`,
      layout: engine.device.createPipelineLayout({
        label: `${label} occupancy pipeline layout`,
        bindGroupLayouts: [bindGroupLayout],
      }),
      compute: {
        module: engine.device.createShaderModule({
          label: `${label} occupancy shader`,
          code: rasterOccupancyAnalysisShader,
        }),
        entryPoint: "main",
      },
    });
    const bindGroup = engine.device.createBindGroup({
      label: `${label} occupancy bind group`,
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: resultBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });
    const encoder = engine.device.createCommandEncoder({
      label: `${label} occupancy analysis`,
    });
    const pass = encoder.beginComputePass({ label: `${label} occupancy pass` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(scanWidth / OCCUPANCY_WORKGROUP_EDGE),
      Math.ceil(scanHeight / OCCUPANCY_WORKGROUP_EDGE),
    );
    pass.end();
    encoder.copyBufferToBuffer(
      resultBuffer,
      0,
      readbackBuffer,
      0,
      OCCUPANCY_RESULT_BYTES,
    );
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped(`${label} occupancy`, 60_000);
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const words = new Uint32Array(readbackBuffer.getMappedRange()).slice();
    readbackBuffer.unmap();

    const tileMask = words.slice(0, LAYER_STORAGE_MASK_WORD_COUNT);
    const occupiedTileCount = countLayerStorageTiles(tileMask);
    if (words[RESULT_OCCUPIED] === 0) {
      if (occupiedTileCount !== 0) {
        throw new Error(`${label}: occupancy flag and tile mask disagree.`);
      }
      return { bounds: null, tileMask, occupiedTileCount: 0 };
    }
    const left = words[RESULT_MIN_X];
    const top = words[RESULT_MIN_Y];
    const right = words[RESULT_MAX_X];
    const bottom = words[RESULT_MAX_Y];
    if (
      occupiedTileCount === 0
      || right <= left
      || bottom <= top
      || right > DOCUMENT_WIDTH
      || bottom > DOCUMENT_HEIGHT
    ) {
      throw new Error(`${label}: invalid non-empty occupancy result.`);
    }
    return {
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
      tileMask,
      occupiedTileCount,
    };
  } finally {
    uniformBuffer.destroy();
    readbackBuffer.destroy();
    resultBuffer.destroy();
  }
}
