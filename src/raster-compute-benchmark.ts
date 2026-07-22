export type RasterComputeStorageBackend =
  | "r32uint-read-write-storage-texture"
  | "u32-read-write-storage-buffer";

export interface RasterComputeBenchmarkResult {
  targetSize: number;
  baseStamps: number;
  physicalCopies: number;
  tileSize: number;
  activeTiles: number;
  tileReferences: number;
  averageReferencesPerTile: number;
  maximumReferencesPerTile: number;
  trialsPerPath: number;
  workloadRepetitionsPerSample: number;
  storageBackend: RasterComputeStorageBackend;
  storageTextureFallbackReason: string | null;
  preparationCpuMs: number;
  uploadCpuMs: number;
  rasterEncodingP50Ms: number;
  computeEncodingP50Ms: number;
  rasterCompletionSamplesMs: number[];
  computeCompletionSamplesMs: number[];
  rasterCompletionMedianMs: number;
  computeCompletionMedianMs: number;
  computeSpeedupPercent: number;
  exactPixelRatio: number;
  differentPixels: number;
  meanAbsoluteChannelError: number;
  maximumChannelError: number;
  verdict: "compute-clear-win" | "compute-small-win" | "raster-wins" | "output-mismatch";
}

interface PhysicalCopy {
  centerX: number;
  centerY: number;
  radius: number;
  packedColor: number;
}

interface PreparedWorkload {
  copies: PhysicalCopy[];
  packedCopies: ArrayBuffer;
  packedTileHeaders: Uint32Array;
  packedTileReferences: Uint32Array;
  activeTiles: number;
  tileReferences: number;
  averageReferencesPerTile: number;
  maximumReferencesPerTile: number;
}

type BenchmarkPath = "raster" | "compute";

const TARGET_SIZE = 2048;
const BASE_STAMP_COUNT = 32;
const COPIES_PER_BASE_STAMP = 16;
const BASE_RADIUS = 375;
const BASE_SPACING = 7.5;
const TILE_SIZE = 64;
const WORKGROUP_EDGE = 16;
const WORKGROUP_INVOCATIONS = WORKGROUP_EDGE * WORKGROUP_EDGE;
const PIXELS_PER_INVOCATION_AXIS = TILE_SIZE / WORKGROUP_EDGE;
const PIXELS_PER_INVOCATION = PIXELS_PER_INVOCATION_AXIS * PIXELS_PER_INVOCATION_AXIS;
const TRIALS_PER_PATH = 3;
const WORKLOAD_REPETITIONS_PER_SAMPLE = 4;
const COPY_STRIDE_BYTES = 16;
const TILE_HEADER_WORDS = 4;
const BYTES_PER_PIXEL = 4;
const READBACK_BYTES_PER_ROW = TARGET_SIZE * BYTES_PER_PIXEL;
const TARGET_BYTE_SIZE = TARGET_SIZE * READBACK_BYTES_PER_ROW;
const READ_WRITE_STORAGE_TEXTURE_FEATURE = "readonly_and_readwrite_storage_textures";

function hash32(value: number): number {
  let result = value >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result = (result ^ (result >>> 15)) >>> 0;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  return (result ^ (result >>> 16)) >>> 0;
}

function random01(seed: number, salt: number): number {
  return (hash32(seed ^ Math.imul(salt, 0x9e3779b9)) & 0x00ffffff) / 0x01000000;
}

function packRgba8(red: number, green: number, blue: number, alpha: number): number {
  return (
    (red & 0xff)
    | ((green & 0xff) << 8)
    | ((blue & 0xff) << 16)
    | ((alpha & 0xff) << 24)
  ) >>> 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function prepareWorkload(): PreparedWorkload {
  const copies: PhysicalCopy[] = [];
  const targetCenter = TARGET_SIZE * 0.5;

  for (let baseIndex = 0; baseIndex < BASE_STAMP_COUNT; baseIndex += 1) {
    const progress = BASE_STAMP_COUNT <= 1 ? 0 : baseIndex / (BASE_STAMP_COUNT - 1);
    const waveAngle = progress * Math.PI * 2;
    const baseCenterX = targetCenter
      + (baseIndex - (BASE_STAMP_COUNT - 1) * 0.5) * BASE_SPACING;
    const baseCenterY = targetCenter + Math.sin(waveAngle) * 55;
    const tangentX = 1;
    const tangentY = Math.cos(waveAngle)
      * 55
      * Math.PI
      * 2
      / Math.max(1, (BASE_STAMP_COUNT - 1) * BASE_SPACING);
    const tangentLength = Math.hypot(tangentX, tangentY);
    const directionX = tangentX / tangentLength;
    const directionY = tangentY / tangentLength;
    const stampSeed = hash32(Math.imul(baseIndex + 1, 0x9e3779b1) ^ 0xa511e9b3);

    for (let copyIndex = 0; copyIndex < COPIES_PER_BASE_STAMP; copyIndex += 1) {
      const copySeed = hash32(stampSeed ^ Math.imul(copyIndex, 0x85ebca6b));
      const linearOffset = (random01(copySeed, 5) - 0.5) * 4 * BASE_RADIUS;
      const lateralOffset = (random01(copySeed, 6) - 0.5) * 4 * BASE_RADIUS;
      const centerX = baseCenterX
        + directionX * linearOffset
        - directionY * lateralOffset;
      const centerY = baseCenterY
        + directionY * linearOffset
        + directionX * lateralOffset;
      const red = 32 + Math.floor(random01(copySeed, 1) * 224);
      const green = 32 + Math.floor(random01(copySeed, 2) * 224);
      const blue = 32 + Math.floor(random01(copySeed, 3) * 224);

      copies.push({
        centerX,
        centerY,
        radius: BASE_RADIUS,
        // Il Base canonico arriva al clamp 0.999999, che su RGBA8 produce
        // alpha piena nell'interno. Il benchmark conserva quel caso reale.
        packedColor: packRgba8(red, green, blue, 255),
      });
    }
  }

  const tilesPerAxis = TARGET_SIZE / TILE_SIZE;
  const tileCount = tilesPerAxis * tilesPerAxis;
  const tileCounts = new Uint32Array(tileCount);
  const copyTileBounds = new Int16Array(copies.length * 4);
  copyTileBounds.fill(-1);

  // Primo passaggio: conta i riferimenti e conserva soltanto i quattro limiti
  // di ogni copia. Evita migliaia di piccoli Array e le relative riallocazioni.
  for (let copyIndex = 0; copyIndex < copies.length; copyIndex += 1) {
    const copy = copies[copyIndex];
    const minimumX = Math.max(0, Math.floor(copy.centerX - copy.radius));
    const minimumY = Math.max(0, Math.floor(copy.centerY - copy.radius));
    const maximumX = Math.min(TARGET_SIZE, Math.ceil(copy.centerX + copy.radius));
    const maximumY = Math.min(TARGET_SIZE, Math.ceil(copy.centerY + copy.radius));
    if (maximumX <= minimumX || maximumY <= minimumY) {
      continue;
    }

    const minimumTileX = Math.floor(minimumX / TILE_SIZE);
    const minimumTileY = Math.floor(minimumY / TILE_SIZE);
    const maximumTileX = Math.floor((maximumX - 1) / TILE_SIZE);
    const maximumTileY = Math.floor((maximumY - 1) / TILE_SIZE);
    const boundsOffset = copyIndex * 4;
    copyTileBounds[boundsOffset] = minimumTileX;
    copyTileBounds[boundsOffset + 1] = minimumTileY;
    copyTileBounds[boundsOffset + 2] = maximumTileX;
    copyTileBounds[boundsOffset + 3] = maximumTileY;
    for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
      for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
        tileCounts[tileY * tilesPerAxis + tileX] += 1;
      }
    }
  }

  const tileOffsets = new Uint32Array(tileCount + 1);
  let activeTiles = 0;
  let maximumReferencesPerTile = 0;
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const references = tileCounts[tileIndex];
    tileOffsets[tileIndex + 1] = tileOffsets[tileIndex] + references;
    activeTiles += references > 0 ? 1 : 0;
    maximumReferencesPerTile = Math.max(maximumReferencesPerTile, references);
  }

  const packedTileHeaders = new Uint32Array(activeTiles * TILE_HEADER_WORDS);
  let activeTileIndex = 0;
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const referenceCount = tileCounts[tileIndex];
    if (referenceCount === 0) {
      continue;
    }
    const headerOffset = activeTileIndex * TILE_HEADER_WORDS;
    packedTileHeaders[headerOffset] = tileIndex % tilesPerAxis;
    packedTileHeaders[headerOffset + 1] = Math.floor(tileIndex / tilesPerAxis);
    packedTileHeaders[headerOffset + 2] = tileOffsets[tileIndex];
    packedTileHeaders[headerOffset + 3] = referenceCount;
    activeTileIndex += 1;
  }

  const packedTileReferences = new Uint32Array(tileOffsets[tileCount]);
  const tileWriteOffsets = tileOffsets.slice(0, tileCount);
  // Secondo passaggio in ordine globale: ogni segmento di tile conserva
  // stamp-major/copy-minor senza sort e senza oggetti intermedi.
  for (let copyIndex = 0; copyIndex < copies.length; copyIndex += 1) {
    const boundsOffset = copyIndex * 4;
    const minimumTileX = copyTileBounds[boundsOffset];
    if (minimumTileX < 0) {
      continue;
    }
    const minimumTileY = copyTileBounds[boundsOffset + 1];
    const maximumTileX = copyTileBounds[boundsOffset + 2];
    const maximumTileY = copyTileBounds[boundsOffset + 3];
    for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
      for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
        const tileIndex = tileY * tilesPerAxis + tileX;
        packedTileReferences[tileWriteOffsets[tileIndex]] = copyIndex;
        tileWriteOffsets[tileIndex] += 1;
      }
    }
  }

  const packedCopies = new ArrayBuffer(copies.length * COPY_STRIDE_BYTES);
  const packedCopiesF32 = new Float32Array(packedCopies);
  const packedCopiesU32 = new Uint32Array(packedCopies);
  for (let index = 0; index < copies.length; index += 1) {
    const wordOffset = index * (COPY_STRIDE_BYTES / 4);
    const copy = copies[index];
    packedCopiesF32[wordOffset] = copy.centerX;
    packedCopiesF32[wordOffset + 1] = copy.centerY;
    packedCopiesF32[wordOffset + 2] = copy.radius;
    packedCopiesU32[wordOffset + 3] = copy.packedColor;
  }

  return {
    copies,
    packedCopies,
    packedTileHeaders,
    packedTileReferences,
    activeTiles,
    tileReferences: packedTileReferences.length,
    averageReferencesPerTile: activeTiles > 0 ? packedTileReferences.length / activeTiles : 0,
    maximumReferencesPerTile,
  };
}

const rasterShader = /* wgsl */ `
const TARGET_SIZE: f32 = ${TARGET_SIZE}.0;

struct PhysicalCopy {
  center: vec2<f32>,
  radius: f32,
  packedColor: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) copyIndex: u32,
};

@group(0) @binding(0) var<storage, read> copies: array<PhysicalCopy>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let copy = copies[instanceIndex];
  let pixelPosition = copy.center + corners[vertexIndex] * copy.radius;

  var output: VertexOutput;
  output.position = vec4<f32>(
    pixelPosition.x / TARGET_SIZE * 2.0 - 1.0,
    1.0 - pixelPosition.y / TARGET_SIZE * 2.0,
    0.0,
    1.0,
  );
  output.copyIndex = instanceIndex;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let copy = copies[input.copyIndex];
  let localPosition = (input.position.xy - copy.center) / copy.radius;
  if (dot(localPosition, localPosition) > 1.0) {
    discard;
  }
  return unpack4x8unorm(copy.packedColor);
}
`;

function computeShader(storageBackend: RasterComputeStorageBackend): string {
  const requiredExtension = storageBackend === "r32uint-read-write-storage-texture"
    ? `requires ${READ_WRITE_STORAGE_TEXTURE_FEATURE};\n`
    : "";
  const targetDeclaration = storageBackend === "r32uint-read-write-storage-texture"
    ? "@group(0) @binding(3) var packedTarget: texture_storage_2d<r32uint, read_write>;"
    : "@group(0) @binding(3) var<storage, read_write> packedTarget: array<u32>;";
  const targetLoad = storageBackend === "r32uint-read-write-storage-texture"
    ? "textureLoad(packedTarget, vec2<i32>(pixelPosition)).x"
    : "packedTarget[pixelPosition.y * TARGET_SIZE + pixelPosition.x]";
  const targetStore = storageBackend === "r32uint-read-write-storage-texture"
    ? "textureStore(packedTarget, vec2<i32>(pixelPosition), vec4<u32>(packed, 0u, 0u, 0u));"
    : "packedTarget[pixelPosition.y * TARGET_SIZE + pixelPosition.x] = packed;";

  return /* wgsl */ `${requiredExtension}
const TARGET_SIZE: u32 = ${TARGET_SIZE}u;
const TILE_SIZE: u32 = ${TILE_SIZE}u;
const WORKGROUP_EDGE: u32 = ${WORKGROUP_EDGE}u;
const PIXELS_PER_INVOCATION_AXIS: u32 = ${PIXELS_PER_INVOCATION_AXIS}u;
const PIXELS_PER_INVOCATION: u32 = ${PIXELS_PER_INVOCATION}u;
const WORKGROUP_INVOCATIONS: u32 = ${WORKGROUP_INVOCATIONS}u;

struct PhysicalCopy {
  center: vec2<f32>,
  radius: f32,
  packedColor: u32,
};

struct TileHeader {
  tileX: u32,
  tileY: u32,
  referenceOffset: u32,
  referenceCount: u32,
};

@group(0) @binding(0) var<storage, read> copies: array<PhysicalCopy>;
@group(0) @binding(1) var<storage, read> tiles: array<TileHeader>;
@group(0) @binding(2) var<storage, read> references: array<u32>;
${targetDeclaration}

var<workgroup> cachedCopies: array<PhysicalCopy, ${WORKGROUP_INVOCATIONS}>;

fn loadTarget(pixelPosition: vec2<u32>) -> vec4<f32> {
  return unpack4x8unorm(${targetLoad});
}

fn storeTarget(pixelPosition: vec2<u32>, color: vec4<f32>) {
  let packed = pack4x8unorm(color);
  ${targetStore}
}

fn blendCopy(
  destination: vec4<f32>,
  copy: PhysicalCopy,
  pixelPosition: vec2<u32>,
) -> vec4<f32> {
  let samplePosition = vec2<f32>(pixelPosition) + vec2<f32>(0.5);
  let localPosition = (samplePosition - copy.center) / copy.radius;
  if (dot(localPosition, localPosition) > 1.0) {
    return destination;
  }

  let source = unpack4x8unorm(copy.packedColor);
  let blended = source + destination * (1.0 - source.a);
  // rgba8unorm quantizza l'attachment dopo ogni fragment. Il round-trip
  // riproduce quella quantizzazione dopo ogni copia, non soltanto alla fine.
  return unpack4x8unorm(pack4x8unorm(blended));
}

@compute @workgroup_size(${WORKGROUP_EDGE}, ${WORKGROUP_EDGE}, 1)
fn computeMain(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let tile = tiles[workgroupId.x];
  let tileOrigin = vec2<u32>(tile.tileX, tile.tileY) * TILE_SIZE;
  var pixelPositions: array<vec2<u32>, ${PIXELS_PER_INVOCATION}>;
  var destinations: array<vec4<f32>, ${PIXELS_PER_INVOCATION}>;
  for (var localPixelY = 0u; localPixelY < PIXELS_PER_INVOCATION_AXIS; localPixelY += 1u) {
    for (var localPixelX = 0u; localPixelX < PIXELS_PER_INVOCATION_AXIS; localPixelX += 1u) {
      let pixelIndex = localPixelY * PIXELS_PER_INVOCATION_AXIS + localPixelX;
      pixelPositions[pixelIndex] = tileOrigin
        + localId.xy
        + vec2<u32>(localPixelX, localPixelY) * WORKGROUP_EDGE;
    }
  }
  for (var pixelIndex = 0u; pixelIndex < PIXELS_PER_INVOCATION; pixelIndex += 1u) {
    destinations[pixelIndex] = loadTarget(pixelPositions[pixelIndex]);
  }

  var chunkStart = 0u;
  loop {
    if (chunkStart >= tile.referenceCount) {
      break;
    }
    let chunkCount = min(WORKGROUP_INVOCATIONS, tile.referenceCount - chunkStart);
    if (localIndex < chunkCount) {
      let referenceIndex = references[tile.referenceOffset + chunkStart + localIndex];
      cachedCopies[localIndex] = copies[referenceIndex];
    }
    workgroupBarrier();

    for (var copyIndex = 0u; copyIndex < chunkCount; copyIndex += 1u) {
      let copy = cachedCopies[copyIndex];
      for (var pixelIndex = 0u; pixelIndex < PIXELS_PER_INVOCATION; pixelIndex += 1u) {
        destinations[pixelIndex] = blendCopy(
          destinations[pixelIndex],
          copy,
          pixelPositions[pixelIndex],
        );
      }
    }
    workgroupBarrier();
    chunkStart += chunkCount;
  }

  for (var pixelIndex = 0u; pixelIndex < PIXELS_PER_INVOCATION; pixelIndex += 1u) {
    storeTarget(pixelPositions[pixelIndex], destinations[pixelIndex]);
  }
}
`;
}

async function createCheckedPipeline<T>(
  device: GPUDevice,
  create: () => Promise<T>,
): Promise<T> {
  device.pushErrorScope("validation");
  let result: T | null = null;
  let thrown: unknown = null;
  try {
    result = await create();
  } catch (error) {
    thrown = error;
  }
  const validationError = await device.popErrorScope();
  if (thrown) {
    throw thrown;
  }
  if (validationError) {
    throw new Error(validationError.message);
  }
  if (!result) {
    throw new Error("Creazione pipeline non riuscita.");
  }
  return result;
}

async function assertShaderCompiled(
  module: GPUShaderModule,
  label: string,
): Promise<void> {
  const compilationInfo = await module.getCompilationInfo();
  const errors = compilationInfo.messages.filter((message) => message.type === "error");
  if (errors.length === 0) {
    return;
  }
  throw new Error(
    `${label}: ${errors.map((message) =>
      `${message.lineNum}:${message.linePos} ${message.message}`).join(" | ")}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createUploadBuffer(
  device: GPUDevice,
  label: string,
  byteLength: number,
): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(4, Math.ceil(byteLength / 4) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

function compareOutputs(
  rasterBytes: Uint8Array,
  computeBytes: Uint8Array,
): Pick<
  RasterComputeBenchmarkResult,
  "exactPixelRatio" | "differentPixels" | "meanAbsoluteChannelError" | "maximumChannelError"
> {
  const pixelCount = TARGET_SIZE * TARGET_SIZE;
  const computeView = new DataView(
    computeBytes.buffer,
    computeBytes.byteOffset,
    computeBytes.byteLength,
  );
  let differentPixels = 0;
  let totalAbsoluteChannelError = 0;
  let maximumChannelError = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const byteOffset = pixelIndex * BYTES_PER_PIXEL;
    const packedCompute = computeView.getUint32(byteOffset, true);
    let pixelDifferent = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const rasterValue = rasterBytes[byteOffset + channel];
      const computeValue = (packedCompute >>> (channel * 8)) & 0xff;
      const error = Math.abs(rasterValue - computeValue);
      totalAbsoluteChannelError += error;
      maximumChannelError = Math.max(maximumChannelError, error);
      pixelDifferent ||= error !== 0;
    }
    differentPixels += pixelDifferent ? 1 : 0;
  }

  return {
    exactPixelRatio: (pixelCount - differentPixels) / pixelCount,
    differentPixels,
    meanAbsoluteChannelError: totalAbsoluteChannelError / (pixelCount * 4),
    maximumChannelError,
  };
}

export async function runRasterComputeBenchmark(
  device: GPUDevice,
  wgslLanguageFeatures: ReadonlySet<string>,
): Promise<RasterComputeBenchmarkResult> {
  await device.queue.onSubmittedWorkDone();

  // Il primo giro scalda il codice JS; i tre successivi misurano il costo
  // stabile. Il workload dell'ultimo giro è quello realmente caricato.
  prepareWorkload();
  const preparationSamplesMs: number[] = [];
  let workload: PreparedWorkload | null = null;
  for (let sample = 0; sample < 3; sample += 1) {
    const preparationStart = performance.now();
    workload = prepareWorkload();
    preparationSamplesMs.push(performance.now() - preparationStart);
  }
  if (!workload) {
    throw new Error("Preparazione workload raster/compute non riuscita.");
  }
  const preparationCpuMs = median(preparationSamplesMs);
  const destroyables: Array<GPUBuffer | GPUTexture> = [];
  let rasterReadback: GPUBuffer | null = null;
  let computeReadback: GPUBuffer | null = null;

  try {
    const copiesBuffer = createUploadBuffer(
      device,
      "Raster/compute benchmark physical copies",
      workload.packedCopies.byteLength,
    );
    const tileHeadersBuffer = createUploadBuffer(
      device,
      "Raster/compute benchmark tile headers",
      workload.packedTileHeaders.byteLength,
    );
    const tileReferencesBuffer = createUploadBuffer(
      device,
      "Raster/compute benchmark tile references",
      workload.packedTileReferences.byteLength,
    );
    destroyables.push(copiesBuffer, tileHeadersBuffer, tileReferencesBuffer);

    const uploadStart = performance.now();
    device.queue.writeBuffer(copiesBuffer, 0, workload.packedCopies);
    device.queue.writeBuffer(tileHeadersBuffer, 0, workload.packedTileHeaders);
    device.queue.writeBuffer(tileReferencesBuffer, 0, workload.packedTileReferences);
    const uploadCpuMs = performance.now() - uploadStart;

    const rasterTexture = device.createTexture({
      label: "Raster/compute benchmark raster RGBA8 target",
      size: { width: TARGET_SIZE, height: TARGET_SIZE },
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    destroyables.push(rasterTexture);

    const rasterModule = device.createShaderModule({
      label: "Raster/compute benchmark raster WGSL",
      code: rasterShader,
    });
    await assertShaderCompiled(rasterModule, "Shader raster benchmark non valido");
    const rasterPipeline = await createCheckedPipeline(device, () =>
      device.createRenderPipelineAsync({
        label: "Raster/compute benchmark raster pipeline",
        layout: "auto",
        vertex: { module: rasterModule, entryPoint: "vertexMain" },
        fragment: {
          module: rasterModule,
          entryPoint: "fragmentMain",
          targets: [{
            format: "rgba8unorm",
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          }],
        },
        primitive: { topology: "triangle-strip" },
      }),
    );
    const rasterBindGroup = device.createBindGroup({
      label: "Raster/compute benchmark raster bind group",
      layout: rasterPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: copiesBuffer } }],
    });

    let storageBackend: RasterComputeStorageBackend =
      "u32-read-write-storage-buffer";
    let storageTextureFallbackReason: string | null = null;
    let computeTexture: GPUTexture | null = null;
    let computeBuffer: GPUBuffer | null = null;
    let computePipeline: GPUComputePipeline;

    if (wgslLanguageFeatures.has(READ_WRITE_STORAGE_TEXTURE_FEATURE)) {
      try {
        computeTexture = device.createTexture({
          label: "Raster/compute benchmark packed R32Uint target",
          size: { width: TARGET_SIZE, height: TARGET_SIZE },
          format: "r32uint",
          usage:
            GPUTextureUsage.STORAGE_BINDING
            | GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST,
        });
        const textureModule = device.createShaderModule({
          label: "Raster/compute benchmark read-write texture WGSL",
          code: computeShader("r32uint-read-write-storage-texture"),
        });
        await assertShaderCompiled(textureModule, "Shader compute texture non valido");
        computePipeline = await createCheckedPipeline(device, () =>
          device.createComputePipelineAsync({
            label: "Raster/compute benchmark read-write texture pipeline",
            layout: "auto",
            compute: { module: textureModule, entryPoint: "computeMain" },
          }),
        );
        storageBackend = "r32uint-read-write-storage-texture";
        destroyables.push(computeTexture);
      } catch (error) {
        computeTexture?.destroy();
        computeTexture = null;
        storageTextureFallbackReason = `pipeline texture non disponibile: ${errorMessage(error)}`;
        const bufferModule = device.createShaderModule({
          label: "Raster/compute benchmark storage-buffer WGSL",
          code: computeShader("u32-read-write-storage-buffer"),
        });
        await assertShaderCompiled(bufferModule, "Shader compute buffer non valido");
        computePipeline = await createCheckedPipeline(device, () =>
          device.createComputePipelineAsync({
            label: "Raster/compute benchmark storage-buffer pipeline",
            layout: "auto",
            compute: { module: bufferModule, entryPoint: "computeMain" },
          }),
        );
      }
    } else {
      storageTextureFallbackReason =
        `WGSL ${READ_WRITE_STORAGE_TEXTURE_FEATURE} non supportato`;
      const bufferModule = device.createShaderModule({
        label: "Raster/compute benchmark storage-buffer WGSL",
        code: computeShader("u32-read-write-storage-buffer"),
      });
      await assertShaderCompiled(bufferModule, "Shader compute buffer non valido");
      computePipeline = await createCheckedPipeline(device, () =>
        device.createComputePipelineAsync({
          label: "Raster/compute benchmark storage-buffer pipeline",
          layout: "auto",
          compute: { module: bufferModule, entryPoint: "computeMain" },
        }),
      );
    }

    if (!computeTexture) {
      computeBuffer = device.createBuffer({
        label: "Raster/compute benchmark packed u32 target",
        size: TARGET_BYTE_SIZE,
        usage:
          GPUBufferUsage.STORAGE
          | GPUBufferUsage.COPY_SRC
          | GPUBufferUsage.COPY_DST,
      });
      destroyables.push(computeBuffer);
    }

    const computeBindGroup = device.createBindGroup({
      label: "Raster/compute benchmark compute bind group",
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: copiesBuffer } },
        { binding: 1, resource: { buffer: tileHeadersBuffer } },
        { binding: 2, resource: { buffer: tileReferencesBuffer } },
        computeTexture
          ? { binding: 3, resource: computeTexture.createView() }
          : { binding: 3, resource: { buffer: computeBuffer! } },
      ],
    });

    let zeroTextureBuffer: GPUBuffer | null = null;
    if (computeTexture) {
      zeroTextureBuffer = device.createBuffer({
        label: "Raster/compute benchmark zero texture source",
        size: TARGET_BYTE_SIZE,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
      });
      new Uint8Array(zeroTextureBuffer.getMappedRange()).fill(0);
      zeroTextureBuffer.unmap();
      destroyables.push(zeroTextureBuffer);
    }

    rasterReadback = device.createBuffer({
      label: "Raster/compute benchmark raster readback",
      size: TARGET_BYTE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    computeReadback = device.createBuffer({
      label: "Raster/compute benchmark compute readback",
      size: TARGET_BYTE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    destroyables.push(rasterReadback, computeReadback);

    const encodeRasterClear = (): GPUCommandBuffer => {
      const encoder = device.createCommandEncoder({
        label: "Raster/compute benchmark raster clear encoder",
      });
      const pass = encoder.beginRenderPass({
        label: "Raster/compute benchmark raster clear pass",
        colorAttachments: [{
          view: rasterTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.end();
      return encoder.finish();
    };

    const encodeComputeClear = (): GPUCommandBuffer => {
      const encoder = device.createCommandEncoder({
        label: "Raster/compute benchmark compute clear encoder",
      });
      if (computeTexture && zeroTextureBuffer) {
        encoder.copyBufferToTexture(
          {
            buffer: zeroTextureBuffer,
            bytesPerRow: READBACK_BYTES_PER_ROW,
            rowsPerImage: TARGET_SIZE,
          },
          { texture: computeTexture },
          { width: TARGET_SIZE, height: TARGET_SIZE, depthOrArrayLayers: 1 },
        );
      } else {
        encoder.clearBuffer(computeBuffer!);
      }
      return encoder.finish();
    };

    const encodeRasterWork = (): GPUCommandBuffer => {
      const encoder = device.createCommandEncoder({
        label: "Raster/compute benchmark raster work encoder",
      });
      const pass = encoder.beginRenderPass({
        label: "Raster/compute benchmark raster work pass",
        colorAttachments: [{
          view: rasterTexture.createView(),
          loadOp: "load",
          storeOp: "store",
        }],
      });
      pass.setPipeline(rasterPipeline);
      pass.setBindGroup(0, rasterBindGroup);
      for (let repetition = 0; repetition < WORKLOAD_REPETITIONS_PER_SAMPLE; repetition += 1) {
        pass.draw(4, workload.copies.length);
      }
      pass.end();
      return encoder.finish();
    };

    const encodeComputeWork = (): GPUCommandBuffer => {
      const encoder = device.createCommandEncoder({
        label: "Raster/compute benchmark compute work encoder",
      });
      const pass = encoder.beginComputePass({
        label: "Raster/compute benchmark compute work pass",
      });
      pass.setPipeline(computePipeline);
      pass.setBindGroup(0, computeBindGroup);
      for (let repetition = 0; repetition < WORKLOAD_REPETITIONS_PER_SAMPLE; repetition += 1) {
        pass.dispatchWorkgroups(workload.activeTiles);
      }
      pass.end();
      return encoder.finish();
    };

    const clearPath = async (path: BenchmarkPath): Promise<void> => {
      device.queue.submit([
        path === "raster" ? encodeRasterClear() : encodeComputeClear(),
      ]);
      await device.queue.onSubmittedWorkDone();
    };

    const runUntimed = async (path: BenchmarkPath): Promise<void> => {
      await clearPath(path);
      device.queue.submit([
        path === "raster" ? encodeRasterWork() : encodeComputeWork(),
      ]);
      await device.queue.onSubmittedWorkDone();
    };

    // Una prova calda per percorso evita di attribuire compilazione lazy alla
    // prima misura. I campioni successivi alternano l'ordine per la temperatura.
    await runUntimed("raster");
    await runUntimed("compute");

    const rasterCompletionSamplesMs: number[] = [];
    const computeCompletionSamplesMs: number[] = [];
    const rasterEncodingSamplesMs: number[] = [];
    const computeEncodingSamplesMs: number[] = [];
    const trialOrder: BenchmarkPath[] = [
      "raster",
      "compute",
      "compute",
      "raster",
      "raster",
      "compute",
    ];

    for (const path of trialOrder) {
      await clearPath(path);
      const encodingStart = performance.now();
      const commandBuffer = path === "raster" ? encodeRasterWork() : encodeComputeWork();
      const encodingMs = (performance.now() - encodingStart) / WORKLOAD_REPETITIONS_PER_SAMPLE;
      const completionStart = performance.now();
      device.queue.submit([commandBuffer]);
      await device.queue.onSubmittedWorkDone();
      const completionMs = (performance.now() - completionStart) / WORKLOAD_REPETITIONS_PER_SAMPLE;

      if (path === "raster") {
        rasterEncodingSamplesMs.push(encodingMs);
        rasterCompletionSamplesMs.push(completionMs);
      } else {
        computeEncodingSamplesMs.push(encodingMs);
        computeCompletionSamplesMs.push(completionMs);
      }
    }

    const copyEncoder = device.createCommandEncoder({
      label: "Raster/compute benchmark output readback encoder",
    });
    copyEncoder.copyTextureToBuffer(
      { texture: rasterTexture },
      {
        buffer: rasterReadback,
        bytesPerRow: READBACK_BYTES_PER_ROW,
        rowsPerImage: TARGET_SIZE,
      },
      { width: TARGET_SIZE, height: TARGET_SIZE, depthOrArrayLayers: 1 },
    );
    if (computeTexture) {
      copyEncoder.copyTextureToBuffer(
        { texture: computeTexture },
        {
          buffer: computeReadback,
          bytesPerRow: READBACK_BYTES_PER_ROW,
          rowsPerImage: TARGET_SIZE,
        },
        { width: TARGET_SIZE, height: TARGET_SIZE, depthOrArrayLayers: 1 },
      );
    } else {
      copyEncoder.copyBufferToBuffer(computeBuffer!, 0, computeReadback, 0, TARGET_BYTE_SIZE);
    }
    device.queue.submit([copyEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    await Promise.all([
      rasterReadback.mapAsync(GPUMapMode.READ),
      computeReadback.mapAsync(GPUMapMode.READ),
    ]);
    let comparison: ReturnType<typeof compareOutputs>;
    try {
      comparison = compareOutputs(
        new Uint8Array(rasterReadback.getMappedRange()),
        new Uint8Array(computeReadback.getMappedRange()),
      );
    } finally {
      rasterReadback.unmap();
      computeReadback.unmap();
    }

    const rasterCompletionMedianMs = median(rasterCompletionSamplesMs);
    const computeCompletionMedianMs = median(computeCompletionSamplesMs);
    const computeSpeedupPercent = rasterCompletionMedianMs > 0
      ? (rasterCompletionMedianMs - computeCompletionMedianMs)
        / rasterCompletionMedianMs
        * 100
      : 0;
    const outputExact = comparison.differentPixels === 0;
    const verdict = !outputExact
      ? "output-mismatch"
      : computeSpeedupPercent >= 20
        ? "compute-clear-win"
        : computeSpeedupPercent > 0
          ? "compute-small-win"
          : "raster-wins";

    return {
      targetSize: TARGET_SIZE,
      baseStamps: BASE_STAMP_COUNT,
      physicalCopies: workload.copies.length,
      tileSize: TILE_SIZE,
      activeTiles: workload.activeTiles,
      tileReferences: workload.tileReferences,
      averageReferencesPerTile: workload.averageReferencesPerTile,
      maximumReferencesPerTile: workload.maximumReferencesPerTile,
      trialsPerPath: TRIALS_PER_PATH,
      workloadRepetitionsPerSample: WORKLOAD_REPETITIONS_PER_SAMPLE,
      storageBackend,
      storageTextureFallbackReason,
      preparationCpuMs,
      uploadCpuMs,
      rasterEncodingP50Ms: median(rasterEncodingSamplesMs),
      computeEncodingP50Ms: median(computeEncodingSamplesMs),
      rasterCompletionSamplesMs,
      computeCompletionSamplesMs,
      rasterCompletionMedianMs,
      computeCompletionMedianMs,
      computeSpeedupPercent,
      ...comparison,
      verdict,
    };
  } finally {
    rasterReadback?.unmap();
    computeReadback?.unmap();
    for (let index = destroyables.length - 1; index >= 0; index -= 1) {
      destroyables[index].destroy();
    }
  }
}
