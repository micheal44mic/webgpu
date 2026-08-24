/** Transactional, procedural WebGPU Glass for the selected native raster. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
import {
  DEFAULT_RASTER_GLASS_SETTINGS,
  DESTRUCTIVE_RASTER_GLASS_ALGORITHM,
  DESTRUCTIVE_RASTER_GLASS_ALGORITHM_VERSION,
  DESTRUCTIVE_RASTER_GLASS_MAX_OCTAVES,
  normalizeRasterGlassSeed,
  normalizeRasterGlassSettings,
  rasterGlassMaximumBounds,
  rasterGlassMaxDisplacementPixels,
  rasterGlassResultBounds,
  rasterGlassScalePixels,
  rasterGlassSmoothness,
  unionRasterGlassRects,
  type RasterGlassSeed,
  type RasterGlassSettings,
} from "./glass-core";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  planMemoryAdmission,
  type MemoryRequest,
  type MemoryReservation,
} from "./memory-governor-core";
import { tileMaskCoveringRect } from "./raster-transform-math";

export const DESTRUCTIVE_RASTER_GLASS_RUNTIME_BUILD =
  "destructive-raster-glass-webgpu-v1-immutable-source-analytic-gradient" as const;
export const DESTRUCTIVE_RASTER_GLASS_PRECISION =
  "rgba16float-source-and-output-f32-field-and-bilinear" as const;
export const DESTRUCTIVE_RASTER_GLASS_EDGE_MODE =
  "transparent-content-clamp-document-edge" as const;
export const DESTRUCTIVE_RASTER_GLASS_COORDINATE_SPACE =
  "document-pixel-centers" as const;

const PARAMETER_BYTES = 64;
const BYTES_PER_RGBA16F_PIXEL = 8;
const WORKGROUP_WIDTH = 8;
const WORKGROUP_HEIGHT = 8;
const GLASS_SURFACE_SALT = 0x6a09e667;

interface RasterGlassSharedResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
}

export interface RasterGlassSnapshot {
  readonly layerId: number;
  readonly settings: Readonly<RasterGlassSettings>;
  readonly seed: Readonly<RasterGlassSeed>;
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly maximumDisplacementPixels: number;
  readonly surfaceScalePixels: number;
  readonly memoryBytes: number;
}

export interface ActiveRasterGlassSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly targetTexture: GPUTexture;
  readonly targetView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadU32: Uint32Array;
  readonly parameterUploadF32: Float32Array;
  readonly bindGroup: GPUBindGroup;
  readonly shared: RasterGlassSharedResources;
  readonly memoryBytes: number;
  settings: RasterGlassSettings;
  seed: RasterGlassSeed;
  resultBounds: DirtyRect;
  resultTileMask: Uint32Array;
  presentedBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

/**
 * The host adds the session slot while wiring this isolated runtime into the
 * engine. Keeping it explicit lets this module type-check before that wiring.
 */
export type RasterGlassEngineHost = BrushEngine & {
  activeRasterGlassSession: ActiveRasterGlassSession | null;
};

const sharedByDevice = new WeakMap<GPUDevice, Promise<RasterGlassSharedResources>>();

function glassShader(): string {
  return /* wgsl */ `
struct GlassParameters {
  sourceOriginAndSize: vec4<i32>,
  dispatchOriginAndSize: vec4<i32>,
  distortionSmoothnessScaleSign: vec4<f32>,
  seedAndDocument: vec4<u32>,
};

struct GradientSample {
  value: f32,
  derivative: vec2<f32>,
};

const HALF_MAX = 65504.0;
const SURFACE_SALT = ${GLASS_SURFACE_SALT}u;
const MAX_OCTAVES = ${DESTRUCTIVE_RASTER_GLASS_MAX_OCTAVES}u;

@group(0) @binding(0) var<uniform> parameters: GlassParameters;
@group(0) @binding(1) var immutableSource: texture_2d<f32>;
@group(0) @binding(2) var authoritativeOutput:
  texture_storage_2d<rgba16float, write>;

fn pcgHash(input: u32) -> u32 {
  let state = input * 747796405u + 2891336453u;
  let word = (((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u);
  return ((word >> 22u) ^ word);
}

fn latticeHash(cell: vec2<i32>, octave: u32) -> u32 {
  var hash = (parameters.seedAndDocument.x ^ SURFACE_SALT);
  hash = pcgHash(hash ^ bitcast<u32>(cell.x));
  hash = pcgHash(
    (hash ^ bitcast<u32>(cell.y)) ^ parameters.seedAndDocument.y
  );
  return pcgHash(hash ^ ((octave + 1u) * 2654435769u));
}

fn gradient(index: u32) -> vec2<f32> {
  let diagonal = 0.7071067811865476;
  switch index & 7u {
    case 0u: { return vec2<f32>(1.0, 0.0); }
    case 1u: { return vec2<f32>(-1.0, 0.0); }
    case 2u: { return vec2<f32>(0.0, 1.0); }
    case 3u: { return vec2<f32>(0.0, -1.0); }
    case 4u: { return vec2<f32>(diagonal, diagonal); }
    case 5u: { return vec2<f32>(-diagonal, diagonal); }
    case 6u: { return vec2<f32>(diagonal, -diagonal); }
    default: { return vec2<f32>(-diagonal, -diagonal); }
  }
}

fn fade(value: vec2<f32>) -> vec2<f32> {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

fn fadeDerivative(value: vec2<f32>) -> vec2<f32> {
  let distance = value - vec2<f32>(1.0);
  return 30.0 * value * value * distance * distance;
}

fn gradientNoise(position: vec2<f32>, octave: u32) -> GradientSample {
  let cellFloat = floor(position);
  let cell = vec2<i32>(cellFloat);
  let fraction = position - cellFloat;
  let blend = fade(fraction);
  let blendDerivative = fadeDerivative(fraction);

  let g00 = gradient(latticeHash(cell, octave));
  let g10 = gradient(latticeHash(cell + vec2<i32>(1, 0), octave));
  let g01 = gradient(latticeHash(cell + vec2<i32>(0, 1), octave));
  let g11 = gradient(latticeHash(cell + vec2<i32>(1, 1), octave));
  let n00 = dot(g00, fraction);
  let n10 = dot(g10, fraction - vec2<f32>(1.0, 0.0));
  let n01 = dot(g01, fraction - vec2<f32>(0.0, 1.0));
  let n11 = dot(g11, fraction - vec2<f32>(1.0, 1.0));

  let upper = mix(n00, n10, blend.x);
  let lower = mix(n01, n11, blend.x);
  let upperDx = mix(g00.x, g10.x, blend.x) + (n10 - n00) * blendDerivative.x;
  let lowerDx = mix(g01.x, g11.x, blend.x) + (n11 - n01) * blendDerivative.x;
  let upperDy = mix(g00.y, g10.y, blend.x);
  let lowerDy = mix(g01.y, g11.y, blend.x);
  let normalization = 1.4142135623730951;
  return GradientSample(
    mix(upper, lower, blend.y) * normalization,
    vec2<f32>(
      mix(upperDx, lowerDx, blend.y),
      mix(upperDy, lowerDy, blend.y) + (lower - upper) * blendDerivative.y
    ) * normalization
  );
}

fn surfaceSlope(documentPosition: vec2<f32>) -> vec2<f32> {
  let smoothness = clamp(parameters.distortionSmoothnessScaleSign.y, 0.0, 1.0);
  let roughness = 1.0 - smoothness;
  let octaveSpan = 1.0 + f32(MAX_OCTAVES - 1u) * roughness;
  let persistence = 0.08 + 0.54 * roughness;
  let period = max(parameters.distortionSmoothnessScaleSign.z, 1.0);
  var frequency = 1.0;
  var amplitude = 1.0;
  var slope = vec2<f32>(0.0);
  var weightSum = 0.0;
  for (var octave = 0u; octave < MAX_OCTAVES; octave += 1u) {
    let fraction = clamp(octaveSpan - f32(octave), 0.0, 1.0);
    if (fraction <= 0.0) { break; }
    let sample = gradientNoise(documentPosition * frequency / period, octave);
    let weight = amplitude * fraction;
    slope += sample.derivative * frequency * weight;
    weightSum += weight;
    frequency *= 2.0;
    amplitude *= persistence;
  }
  if (weightSum > 0.0) {
    slope /= weightSum;
  }
  return slope / (1.0 + length(slope));
}

fn insideSource(localPixel: vec2<i32>) -> bool {
  let size = parameters.sourceOriginAndSize.zw;
  return all(localPixel >= vec2<i32>(0)) && all(localPixel < size);
}

fn loadSource(documentPixel: vec2<i32>) -> vec4<f32> {
  let documentSize = vec2<i32>(parameters.seedAndDocument.zw);
  let documentMaximum = max(documentSize - vec2<i32>(1), vec2<i32>(0));
  let clampedDocumentPixel = clamp(
    documentPixel,
    vec2<i32>(0),
    documentMaximum
  );
  let localPixel = clampedDocumentPixel - parameters.sourceOriginAndSize.xy;
  if (!insideSource(localPixel)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(immutableSource, localPixel, 0);
}

fn sampleSourceBilinear(documentPosition: vec2<f32>) -> vec4<f32> {
  let pixelPosition = documentPosition - vec2<f32>(0.5);
  let baseFloat = floor(pixelPosition);
  let base = vec2<i32>(baseFloat);
  let fraction = pixelPosition - baseFloat;
  let upper = mix(
    loadSource(base),
    loadSource(base + vec2<i32>(1, 0)),
    fraction.x
  );
  let lower = mix(
    loadSource(base + vec2<i32>(0, 1)),
    loadSource(base + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(upper, lower, fraction.y);
}

@compute @workgroup_size(${WORKGROUP_WIDTH}, ${WORKGROUP_HEIGHT})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let dispatchSize = vec2<u32>(parameters.dispatchOriginAndSize.zw);
  if (any(globalId.xy >= dispatchSize)) { return; }
  let documentPixel = parameters.dispatchOriginAndSize.xy + vec2<i32>(globalId.xy);
  let documentPosition = vec2<f32>(documentPixel) + vec2<f32>(0.5);
  let maximumDisplacement = parameters.distortionSmoothnessScaleSign.x;
  let sign = parameters.distortionSmoothnessScaleSign.w;
  let displacement = surfaceSlope(documentPosition) * maximumDisplacement * sign;
  var color = sampleSourceBilinear(documentPosition + displacement);
  if (any(color != color) || any(abs(color) > vec4<f32>(HALF_MAX))) {
    color = loadSource(documentPixel);
  }
  textureStore(authoritativeOutput, documentPixel, color);
}
`;
}

async function createSharedResources(
  device: GPUDevice,
): Promise<RasterGlassSharedResources> {
  return runGpuAllocationTransaction(
    device,
    "Pipeline Native raster Glass RGBA16F",
    async () => {
      const module = device.createShaderModule({
        label: "Native raster Glass procedural displacement WGSL",
        code: glassShader(),
      });
      await assertShaderCompiled(module, "Procedural Glass displacement");
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Glass layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform", minBindingSize: PARAMETER_BYTES },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: "unfilterable-float" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "write-only", format: "rgba16float" },
          },
        ],
      });
      const pipeline = device.createComputePipeline({
        label: "Native raster Glass compute pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module, entryPoint: "main" },
      });
      return { bindGroupLayout, pipeline };
    },
  );
}

async function requireSharedResources(
  device: GPUDevice,
): Promise<RasterGlassSharedResources> {
  let promise = sharedByDevice.get(device);
  if (!promise) {
    promise = createSharedResources(device);
    sharedByDevice.set(device, promise);
  }
  try {
    return await promise;
  } catch (error) {
    sharedByDevice.delete(device);
    throw error;
  }
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copySettings(settings: Readonly<RasterGlassSettings>): RasterGlassSettings {
  return { ...settings };
}

function copySeed(seed: Readonly<RasterGlassSeed>): RasterGlassSeed {
  return { low: seed.low >>> 0, high: seed.high >>> 0 };
}

function settingsEqual(
  left: Readonly<RasterGlassSettings>,
  right: Readonly<RasterGlassSettings>,
): boolean {
  return left.distortionPercent === right.distortionPercent
    && left.smoothnessPercent === right.smoothnessPercent
    && left.scalePercent === right.scalePercent
    && left.invert === right.invert;
}

function seedsEqual(
  left: Readonly<RasterGlassSeed>,
  right: Readonly<RasterGlassSeed>,
): boolean {
  return left.low === right.low && left.high === right.high;
}

function snapshot(session: ActiveRasterGlassSession): RasterGlassSnapshot {
  return {
    layerId: session.layerId,
    settings: copySettings(session.settings),
    seed: copySeed(session.seed),
    sourceBounds: { ...session.sourceBounds },
    resultBounds: { ...session.resultBounds },
    maximumDisplacementPixels: rasterGlassMaxDisplacementPixels(
      session.settings.distortionPercent,
    ),
    surfaceScalePixels: rasterGlassScalePixels(session.settings.scalePercent),
    memoryBytes: session.memoryBytes,
  };
}

function setAuthoritativeMetadata(
  engine: RasterGlassEngineHost,
  bounds: DirtyRect,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  engine.layerContentBounds = { ...bounds };
  engine.layerHasContent = true;
  record.contentBounds = { ...bounds };
  record.hasContent = true;
  record.storageTileMask.set(tileMaskCoveringRect(tileMask, bounds));
  invalidateActiveLayerBake(engine);
}

function writeParameters(
  engine: RasterGlassEngineHost,
  session: ActiveRasterGlassSession,
  settings: Readonly<RasterGlassSettings>,
  resultBounds: DirtyRect,
): void {
  const source = session.scratchBounds;
  const i32 = session.parameterUploadI32;
  const u32 = session.parameterUploadU32;
  const f32 = session.parameterUploadF32;
  i32[0] = source.x;
  i32[1] = source.y;
  i32[2] = source.width;
  i32[3] = source.height;
  i32[4] = resultBounds.x;
  i32[5] = resultBounds.y;
  i32[6] = resultBounds.width;
  i32[7] = resultBounds.height;
  f32[8] = rasterGlassMaxDisplacementPixels(settings.distortionPercent);
  f32[9] = rasterGlassSmoothness(settings.smoothnessPercent);
  f32[10] = rasterGlassScalePixels(settings.scalePercent);
  f32[11] = settings.invert ? -1 : 1;
  u32[12] = session.seed.low;
  u32[13] = session.seed.high;
  u32[14] = DOCUMENT_WIDTH;
  u32[15] = DOCUMENT_HEIGHT;
  engine.device.queue.writeBuffer(
    session.parameterBuffer,
    0,
    session.parameterUpload,
  );
}

function destroySessionResources(session: ActiveRasterGlassSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.parameterBuffer.destroy();
}

/** Releases local handles when command submission is no longer possible. */
export function abandonRasterGlassSession(
  engine: RasterGlassEngineHost,
): boolean {
  const session = engine.activeRasterGlassSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterGlassSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function readRandomSeed(): RasterGlassSeed {
  const words = new Uint32Array(2);
  globalThis.crypto.getRandomValues(words);
  return { low: words[0] >>> 0, high: words[1] >>> 0 };
}

function freshRandomSeed(previous?: Readonly<RasterGlassSeed>): RasterGlassSeed {
  let seed = readRandomSeed();
  if (previous && seedsEqual(seed, previous)) seed = readRandomSeed();
  if (previous && seedsEqual(seed, previous)) {
    seed = {
      low: (seed.low ^ 0x9e3779b9) >>> 0,
      high: (seed.high ^ 0x85ebca6b) >>> 0,
    };
  }
  return seed;
}

function encodeRequestedPreview(
  engine: RasterGlassEngineHost,
  session: ActiveRasterGlassSession,
  serial: number,
  settings: Readonly<RasterGlassSettings>,
  seed: Readonly<RasterGlassSeed>,
): void {
  if (engine.activeRasterGlassSession !== session || session.terminal) return;
  if (serial !== session.requestedSerial) return;
  if (session.encodedSerial === serial) return;
  if (!seedsEqual(seed, session.seed)) return;

  const resultBounds = rasterGlassResultBounds(
    session.sourceBounds,
    settings,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (!resultBounds) throw new Error("Glass: result bounds are missing.");
  const dirtyRect = unionRasterGlassRects(
    session.presentedBounds,
    resultBounds,
  ) as DirtyRect;
  writeParameters(engine, session, settings, resultBounds);

  const encoder = engine.device.createCommandEncoder({
    label: `Native raster Glass preview ${settings.distortionPercent.toFixed(0)}%`,
  });
  encoder.copyTextureToTexture(
    {
      texture: session.sourceTexture,
      origin: {
        x: dirtyRect.x - session.scratchBounds.x,
        y: dirtyRect.y - session.scratchBounds.y,
        z: 0,
      },
    },
    {
      texture: session.targetTexture,
      origin: { x: dirtyRect.x, y: dirtyRect.y, z: 0 },
    },
    { width: dirtyRect.width, height: dirtyRect.height, depthOrArrayLayers: 1 },
  );
  if (settings.distortionPercent > 0) {
    const pass = encoder.beginComputePass({ label: "Glass procedural displacement" });
    pass.setPipeline(session.shared.pipeline);
    pass.setBindGroup(0, session.bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(resultBounds.width / WORKGROUP_WIDTH),
      Math.ceil(resultBounds.height / WORKGROUP_HEIGHT),
    );
    pass.end();
  }
  engine.device.queue.submit([encoder.finish()]);

  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    resultBounds,
  );
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  session.presentedBounds = { ...resultBounds };
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: RasterGlassEngineHost,
  session: ActiveRasterGlassSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterGlassSession !== session
    || session.terminal
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const settings = copySettings(session.settings);
  const seed = copySeed(session.seed);
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, settings, seed);
      await engine.waitForGpuCapped(
        `Glass preview ${settings.distortionPercent.toFixed(0)}%`,
        60_000,
      );
    } catch (error) {
      session.previewFault = errorFrom(error);
      if (engine.activeRasterGlassSession === session) {
        engine.publishStatus(
          `Glass preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterGlassSession === session
        && !session.terminal
        && !session.previewFault
        && session.encodedSerial !== session.requestedSerial
      ) {
        schedulePreview(engine, session);
      }
    }
  });
  session.previewInFlight = completion;
  return completion;
}

function schedulePreview(
  engine: RasterGlassEngineHost,
  session: ActiveRasterGlassSession,
): void {
  if (
    session.previewFrame !== null
    || session.previewInFlight
    || session.previewFault
    || session.terminal
  ) {
    return;
  }
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterGlassSession !== session
      || session.terminal
      || session.previewFault
    ) {
      return;
    }
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: RasterGlassEngineHost,
  session: ActiveRasterGlassSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  for (;;) {
    if (session.previewFault) throw session.previewFault;
    if (session.encodedSerial === session.requestedSerial && !session.previewInFlight) return;
    await startPreviewSubmission(engine, session);
  }
}

async function restoreOriginalPixels(
  engine: RasterGlassEngineHost,
  session: ActiveRasterGlassSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;
  const bounds = session.scratchBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Restore Native raster Glass source layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: session.targetTexture,
      origin: { x: bounds.x, y: bounds.y, z: 0 },
    },
    { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Restore Glass", 60_000);
  if (presentationError) throw presentationError;
}

function sessionMemoryRequest(memoryBytes: number): MemoryRequest {
  return {
    category: "native-raster-glass-session",
    steadyBytes: memoryBytes,
    peakBytes: memoryBytes,
    priority: "interactive",
  };
}

async function reserveSessionMemory(
  engine: RasterGlassEngineHost,
  memoryBytes: number,
): Promise<MemoryReservation> {
  const request = sessionMemoryRequest(memoryBytes);
  const decision = planMemoryAdmission(
    {
      committedBytes: engine.gpuResourceRegistry.snapshot().currentBytes,
      reservedBytes: engine.memoryReservations.pendingBytes,
      reclaimableBytes: 0,
      inFlightBytes: 0,
    },
    engine.memoryGovernorLimits,
    request,
  );
  const requiredMiB = request.peakBytes / (1024 * 1024);
  const availableMiB = Math.max(0, decision.ceilingBytes - decision.usedBytes)
    / (1024 * 1024);
  return engine.reserveMemoryWithAdmissionOverride(
    request,
    decision,
    "Open Glass",
    `Insufficient memory for Glass: ${requiredMiB.toFixed(1)} MiB required, `
      + `${availableMiB.toFixed(1)} MiB available.`,
  );
}

export async function beginRasterGlass(
  engine: RasterGlassEngineHost,
  initial: Partial<RasterGlassSettings> = DEFAULT_RASTER_GLASS_SETTINGS,
  initialSeed?: Readonly<RasterGlassSeed>,
): Promise<RasterGlassSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterGlassSession) return snapshot(engine.activeRasterGlassSession);
  engine.assertDestructiveRasterEditCanOpen("glass");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("The selected raster does not match the active layer.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error("Glass works on the entire layer: deselect the pixels before opening it.");
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Destructive Glass requires an RGBA16F document.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let reservation: MemoryReservation | null = null;
  let reservationClosed = false;
  let session: ActiveRasterGlassSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The raster's hot texture for Glass is missing.");
    const sourceBounds = { ...record.contentBounds };
    const scratchBounds = rasterGlassMaximumBounds(
      sourceBounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("The raster contains no pixels that can be distorted.");
    const settings = normalizeRasterGlassSettings(initial);
    const seed = initialSeed
      ? normalizeRasterGlassSeed(initialSeed)
      : freshRandomSeed();
    const initialResultBounds = rasterGlassResultBounds(
      sourceBounds,
      settings,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect;
    const maximumDispatch = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (
      Number.isFinite(maximumDispatch)
      && (
        Math.ceil(scratchBounds.width / WORKGROUP_WIDTH) > maximumDispatch
        || Math.ceil(scratchBounds.height / WORKGROUP_HEIGHT) > maximumDispatch
      )
    ) {
      throw new Error("Glass: the GPU does not support the required dispatch size.");
    }
    const sourceTileMask = record.storageTileMask.slice();
    const shared = await requireSharedResources(engine.device);
    const memoryBytes = scratchBounds.width * scratchBounds.height
      * BYTES_PER_RGBA16F_PIXEL + PARAMETER_BYTES;
    reservation = await reserveSessionMemory(engine, memoryBytes);

    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocate Native raster Glass layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Glass immutable source layer ${record.id}`,
          size: {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage:
            GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => sourceTexture.destroy());
        const sourceView = sourceTexture.createView({
          label: "Native raster Glass immutable source view",
        });
        const parameterBuffer = engine.device.createBuffer({
          label: "Native raster Glass parameters",
          size: PARAMETER_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => parameterBuffer.destroy());
        const parameterUpload = new ArrayBuffer(PARAMETER_BYTES);
        const bindGroup = engine.device.createBindGroup({
          label: "Native raster Glass bind group",
          layout: shared.bindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
            },
            { binding: 1, resource: sourceView },
            { binding: 2, resource: hot.view },
          ],
        });
        const created: ActiveRasterGlassSession = {
          layerId: record.id,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          targetTexture: hot.texture,
          targetView: hot.view,
          parameterBuffer,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadU32: new Uint32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          bindGroup,
          shared,
          memoryBytes,
          settings,
          seed,
          resultBounds: initialResultBounds,
          resultTileMask: tileMaskCoveringRect(sourceTileMask, initialResultBounds),
          presentedBounds: null,
          requestedSerial: 1,
          encodedSerial: 0,
          previewFrame: null,
          previewInFlight: null,
          previewFault: null,
          terminal: false,
          destroyed: false,
        };
        const encoder = engine.device.createCommandEncoder({
          label: `Capture Native raster Glass source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: { x: scratchBounds.x, y: scratchBounds.y, z: 0 },
          },
          { texture: sourceTexture },
          {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
        );
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Prepare Glass", 60_000);
        return created;
      },
    );
    engine.memoryReservations.settle(reservation);
    reservationClosed = true;
    engine.activeRasterGlassSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus(
      `Glass preview ${settings.distortionPercent.toFixed(0)}%: Apply or Cancel.`,
      "ok",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    if (reservation && !reservationClosed) {
      engine.memoryReservations.release(reservation);
      reservationClosed = true;
    }
    let restoreError: unknown = null;
    if (session && engine.activeRasterGlassSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Glass startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterGlassSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Glass startup failed: ${errorFrom(error).message}; `
        + `recovery failed: ${errorFrom(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterGlass(
  engine: RasterGlassEngineHost,
  update: Partial<RasterGlassSettings>,
): RasterGlassSnapshot {
  const session = engine.activeRasterGlassSession;
  if (!session) throw new Error("No Glass session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Glass preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Glass is already finishing.");
  const settings = normalizeRasterGlassSettings({ ...session.settings, ...update });
  if (settingsEqual(settings, session.settings)) return snapshot(session);
  session.settings = settings;
  const resultBounds = rasterGlassResultBounds(
    session.sourceBounds,
    settings,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect;
  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    resultBounds,
  );
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus(
    `Glass preview ${settings.distortionPercent.toFixed(0)}%…`,
    "working",
  );
  return snapshot(session);
}

export function reseedRasterGlass(
  engine: RasterGlassEngineHost,
  requested?: Readonly<RasterGlassSeed>,
): RasterGlassSnapshot {
  const session = engine.activeRasterGlassSession;
  if (!session) throw new Error("No Glass session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Glass preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Glass is already finishing.");
  const seed = requested
    ? normalizeRasterGlassSeed(requested)
    : freshRandomSeed(session.seed);
  if (seedsEqual(seed, session.seed)) return snapshot(session);
  session.seed = seed;
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus("Glass surface regenerated…", "working");
  return snapshot(session);
}

export async function cancelRasterGlass(
  engine: RasterGlassEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterGlassSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Glass is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Glass cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterGlassSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Glass canceled: the original pixels were restored.", "ok");
  return true;
}

export async function commitRasterGlass(
  engine: RasterGlassEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterGlassSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Glass preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Glass is already finishing.");
  if (session.settings.distortionPercent === 0) {
    await cancelRasterGlass(engine);
    return false;
  }
  session.terminal = true;
  let historySeed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    session.terminal = false;
    await flushPreview(engine, session);
    session.terminal = true;
    const record = engine.layerStack.active;
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("The Glass raster's hot texture is missing.");
    historySeed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.resultTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const settings = session.settings;
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "glass",
      distortionPercent: settings.distortionPercent,
      smoothnessPercent: settings.smoothnessPercent,
      scalePercent: settings.scalePercent,
      invert: settings.invert,
      randomSeedLow: session.seed.low,
      randomSeedHigh: session.seed.high,
      maximumDisplacementPixels: rasterGlassMaxDisplacementPixels(
        settings.distortionPercent,
      ),
      surfaceScalePixels: rasterGlassScalePixels(settings.scalePercent),
      algorithm: DESTRUCTIVE_RASTER_GLASS_ALGORITHM,
      algorithmVersion: DESTRUCTIVE_RASTER_GLASS_ALGORITHM_VERSION,
      precision: DESTRUCTIVE_RASTER_GLASS_PRECISION,
      edgeMode: DESTRUCTIVE_RASTER_GLASS_EDGE_MODE,
      coordinateSpace: DESTRUCTIVE_RASTER_GLASS_COORDINATE_SPACE,
      seed: historySeed,
      baseBounds: { ...session.resultBounds },
      baseTileMask: session.resultTileMask.slice(),
    };
    // Pixels in the checkpoint remain authoritative; metadata only records the
    // deterministic surface controls used to produce them.
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      session.terminal = true;
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Glass commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(historySeed);
    }
    if (rollbackError) {
      throw new Error(
        `Glass commit failed: ${errorFrom(error).message}; `
        + `rollback failed: ${errorFrom(rollbackError).message}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterGlassSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Glass ${session.settings.distortionPercent.toFixed(0)}% applied to the pixels: one Undo step.`,
    "ok",
  );
  return true;
}
