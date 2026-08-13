/** Transactional destructive Noise for the selected native raster layer. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-residency-runtime";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-resources-runtime";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  DEFAULT_RASTER_NOISE_SETTINGS,
  DESTRUCTIVE_RASTER_NOISE_ALGORITHM,
  DESTRUCTIVE_RASTER_NOISE_ALGORITHM_VERSION,
  RASTER_NOISE_CHANNEL_SALT_B,
  RASTER_NOISE_CHANNEL_SALT_G,
  RASTER_NOISE_CHANNEL_SALT_R,
  RASTER_NOISE_WARP_SALT_X,
  RASTER_NOISE_WARP_SALT_Y,
  normalizeRasterNoiseSettings,
  rasterNoiseAmountFactor,
  rasterNoiseOctaveCount,
  rasterNoisePeriodPixels,
  rasterNoiseTurbulence,
  type RasterNoiseChannels,
  type RasterNoiseSeed,
  type RasterNoiseSettings,
  type RasterNoiseStyle,
} from "./noise-core";

export const DESTRUCTIVE_RASTER_NOISE_RUNTIME_BUILD =
  "destructive-raster-noise-webgpu-v1-immutable-source-single-pass";
export const DESTRUCTIVE_RASTER_NOISE_PRECISION =
  "rgba16float-storage-f32-procedural" as const;
export const DESTRUCTIVE_RASTER_NOISE_COLOR_SPACE =
  "linear-premultiplied" as const;
export const DESTRUCTIVE_RASTER_NOISE_ALPHA_MODE = "preserve" as const;
export const DESTRUCTIVE_RASTER_NOISE_BOUNDS_MODE = "preserve" as const;

const PARAMETER_BYTES = 64;
const BYTES_PER_RGBA16F_PIXEL = 8;
const WORKGROUP_WIDTH = 8;
const WORKGROUP_HEIGHT = 8;

interface RasterNoiseSharedResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
}

export interface RasterNoiseSnapshot {
  readonly layerId: number;
  readonly settings: Readonly<RasterNoiseSettings>;
  readonly randomSeedLow: number;
  readonly randomSeedHigh: number;
  readonly sourceBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterNoiseSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadU32: Uint32Array;
  readonly parameterUploadF32: Float32Array;
  readonly outputView: GPUTextureView;
  readonly bindGroup: GPUBindGroup;
  readonly shared: RasterNoiseSharedResources;
  readonly randomSeedLow: number;
  readonly randomSeedHigh: number;
  readonly memoryBytes: number;
  settings: RasterNoiseSettings;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

const sharedByDevice = new WeakMap<GPUDevice, Promise<RasterNoiseSharedResources>>();
const lastSeedByEngine = new WeakMap<BrushEngine, RasterNoiseSeed>();
const injectedSeedsByEngine = new WeakMap<BrushEngine, RasterNoiseSeed[]>();

function noiseShader(): string {
  return /* wgsl */ `
struct NoiseParameters {
  sourceOriginAndSize: vec4<i32>,
  amountScaleOctavesTurbulence: vec4<f32>,
  modesAndSeedLow: vec4<u32>,
  seedVersionAndDocument: vec4<u32>,
};

const HALF_MAX = 65504.0;
const CHANNEL_SALT_R = ${RASTER_NOISE_CHANNEL_SALT_R}u;
const CHANNEL_SALT_G = ${RASTER_NOISE_CHANNEL_SALT_G}u;
const CHANNEL_SALT_B = ${RASTER_NOISE_CHANNEL_SALT_B}u;
const WARP_SALT_X = ${RASTER_NOISE_WARP_SALT_X}u;
const WARP_SALT_Y = ${RASTER_NOISE_WARP_SALT_Y}u;

@group(0) @binding(0) var<uniform> parameters: NoiseParameters;
@group(0) @binding(1) var immutableSource: texture_2d<f32>;
@group(0) @binding(2) var authoritativeOutput:
  texture_storage_2d<rgba16float, write>;

fn pcgHash(input: u32) -> u32 {
  let state = input * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn latticeHash(lattice: vec2<i32>, salt: u32) -> u32 {
  var hash = parameters.modesAndSeedLow.w ^ salt;
  hash = pcgHash(hash ^ bitcast<u32>(lattice.x));
  hash = pcgHash(
    hash ^ bitcast<u32>(lattice.y) ^ parameters.seedVersionAndDocument.x
  );
  return hash;
}

fn gradientDot(index: u32, delta: vec2<f32>) -> f32 {
  let diagonal = 0.7071067811865476;
  switch index & 7u {
    case 0u: { return delta.x; }
    case 1u: { return -delta.x; }
    case 2u: { return delta.y; }
    case 3u: { return -delta.y; }
    case 4u: { return diagonal * (delta.x + delta.y); }
    case 5u: { return diagonal * (-delta.x + delta.y); }
    case 6u: { return diagonal * (delta.x - delta.y); }
    default: { return diagonal * (-delta.x - delta.y); }
  }
}

fn fade(value: vec2<f32>) -> vec2<f32> {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

fn gradientNoise(position: vec2<f32>, salt: u32) -> f32 {
  let cellFloat = floor(position);
  let cell = vec2<i32>(cellFloat);
  let fraction = position - cellFloat;
  let blend = fade(fraction);
  let top = mix(
    gradientDot(latticeHash(cell, salt), fraction),
    gradientDot(
      latticeHash(cell + vec2<i32>(1, 0), salt),
      fraction - vec2<f32>(1.0, 0.0)
    ),
    blend.x
  );
  let bottom = mix(
    gradientDot(
      latticeHash(cell + vec2<i32>(0, 1), salt),
      fraction - vec2<f32>(0.0, 1.0)
    ),
    gradientDot(
      latticeHash(cell + vec2<i32>(1, 1), salt),
      fraction - vec2<f32>(1.0, 1.0)
    ),
    blend.x
  );
  return clamp(mix(top, bottom, blend.y) * 1.4142135623730951, -1.0, 1.0);
}

fn styledNoise(value: f32, style: u32) -> f32 {
  let magnitude = abs(value);
  let direction = select(select(0.0, 1.0, value > 0.0), -1.0, value < 0.0);
  if (style == 1u) {
    return direction * (2.0 * magnitude - magnitude * magnitude);
  }
  if (style == 2u) {
    return direction * sqrt(magnitude);
  }
  return value;
}

fn octaveSalt(channelSalt: u32, octave: u32) -> u32 {
  return pcgHash(channelSalt ^ ((octave + 1u) * 2654435769u));
}

fn fbm(
  documentPosition: vec2<f32>,
  initialPeriod: f32,
  initialRemaining: f32,
  style: u32,
  channelSalt: u32,
  octaveLimit: u32,
) -> f32 {
  var remaining = initialRemaining;
  var period = initialPeriod;
  var amplitude = 1.0;
  var sum = 0.0;
  var weightSum = 0.0;
  for (var octave = 0u; octave < 8u; octave += 1u) {
    if (octave >= octaveLimit) { break; }
    let fraction = min(1.0, remaining);
    if (fraction <= 0.0 || period < 1.0) { break; }
    let value = styledNoise(
      gradientNoise(documentPosition / period, octaveSalt(channelSalt, octave)),
      style
    );
    let weight = fraction * amplitude;
    sum += value * weight;
    weightSum += weight;
    remaining -= 1.0;
    amplitude *= 0.5;
    period *= 0.5;
  }
  return select(0.0, clamp(sum / weightSum, -1.0, 1.0), weightSum > 0.0);
}

fn warpedPosition(documentPosition: vec2<f32>) -> vec2<f32> {
  let period = parameters.amountScaleOctavesTurbulence.y;
  let turbulence = parameters.amountScaleOctavesTurbulence.w;
  if (turbulence <= 0.0) { return documentPosition; }
  let warpPeriod = max(2.0, period * 2.0);
  let warpAmplitude = 0.75 * turbulence * turbulence * period;
  let warp = vec2<f32>(
    fbm(documentPosition, warpPeriod, 3.0, 0u, WARP_SALT_X, 3u),
    fbm(documentPosition, warpPeriod, 3.0, 0u, WARP_SALT_Y, 3u)
  );
  return documentPosition + warpAmplitude * warp;
}

fn evaluateChannel(position: vec2<f32>, salt: u32) -> f32 {
  let value = fbm(
    position,
    parameters.amountScaleOctavesTurbulence.y,
    parameters.amountScaleOctavesTurbulence.z,
    parameters.modesAndSeedLow.x,
    salt,
    8u
  );
  return clamp(0.5 + 0.5 * value, 0.0, 1.0);
}

fn evaluateNoise(documentPosition: vec2<f32>) -> vec3<f32> {
  let position = warpedPosition(documentPosition);
  let red = evaluateChannel(position, CHANNEL_SALT_R);
  if (parameters.modesAndSeedLow.y == 0u) {
    return vec3<f32>(red);
  }
  return vec3<f32>(
    red,
    evaluateChannel(position, CHANNEL_SALT_G),
    evaluateChannel(position, CHANNEL_SALT_B)
  );
}

@compute @workgroup_size(${WORKGROUP_WIDTH}, ${WORKGROUP_HEIGHT})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let sourceSize = vec2<u32>(parameters.sourceOriginAndSize.zw);
  if (any(globalId.xy >= sourceSize)) { return; }
  let localPosition = vec2<i32>(globalId.xy);
  let documentPosition = parameters.sourceOriginAndSize.xy + localPosition;
  let source = textureLoad(immutableSource, localPosition, 0);

  // The source copy already restored pixels that the filter must preserve.
  if (!(source.a > 0.0)) { return; }
  if (any(source != source) || any(abs(source) > vec4<f32>(HALF_MAX))) { return; }

  let field = evaluateNoise(vec2<f32>(documentPosition) + vec2<f32>(0.5));
  let amount = parameters.amountScaleOctavesTurbulence.x;
  var resultRgb: vec3<f32>;
  if (parameters.modesAndSeedLow.z != 0u) {
    resultRgb = source.rgb + source.a * amount * (field - vec3<f32>(0.5));
  } else if (amount <= 1.0) {
    resultRgb = mix(source.rgb, source.a * field, amount);
  } else {
    resultRgb = source.a * (vec3<f32>(0.5) + amount * (field - vec3<f32>(0.5)));
  }
  if (any(resultRgb != resultRgb)) { return; }
  textureStore(
    authoritativeOutput,
    documentPosition,
    vec4<f32>(
      clamp(resultRgb, vec3<f32>(-HALF_MAX), vec3<f32>(HALF_MAX)),
      source.a
    )
  );
}
`;
}

async function createSharedResources(device: GPUDevice): Promise<RasterNoiseSharedResources> {
  return runGpuAllocationTransaction(
    device,
    "Pipeline Native raster Noise RGBA16F",
    async () => {
      const module = device.createShaderModule({
        label: "Native raster Noise procedural WGSL",
        code: noiseShader(),
      });
      await assertShaderCompiled(module, "Noise procedurale");
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Noise layout",
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
        label: "Native raster Noise compute pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module, entryPoint: "main" },
      });
      return { bindGroupLayout, pipeline };
    },
  );
}

async function requireSharedResources(device: GPUDevice): Promise<RasterNoiseSharedResources> {
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

function previewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copySettings(settings: RasterNoiseSettings): RasterNoiseSettings {
  return { ...settings };
}

function settingsEqual(left: RasterNoiseSettings, right: RasterNoiseSettings): boolean {
  return left.amountPercent === right.amountPercent
    && left.scalePercent === right.scalePercent
    && left.octavesPercent === right.octavesPercent
    && left.turbulencePercent === right.turbulencePercent
    && left.style === right.style
    && left.channels === right.channels
    && left.additive === right.additive;
}

function snapshot(session: ActiveRasterNoiseSession): RasterNoiseSnapshot {
  return {
    layerId: session.layerId,
    settings: copySettings(session.settings),
    randomSeedLow: session.randomSeedLow,
    randomSeedHigh: session.randomSeedHigh,
    sourceBounds: { ...session.sourceBounds },
    memoryBytes: session.memoryBytes,
  };
}

function setAuthoritativeMetadata(
  engine: BrushEngine,
  bounds: DirtyRect,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  engine.layerContentBounds = { ...bounds };
  engine.layerHasContent = true;
  record.contentBounds = { ...bounds };
  record.hasContent = true;
  record.storageTileMask.set(tileMask);
  invalidateActiveLayerBake(engine);
}

function styleCode(style: RasterNoiseStyle): number {
  if (style === "billows") return 1;
  if (style === "ridges") return 2;
  return 0;
}

function channelsCode(channels: RasterNoiseChannels): number {
  return channels === "multi" ? 1 : 0;
}

function writeParameters(
  engine: BrushEngine,
  session: ActiveRasterNoiseSession,
  settings: RasterNoiseSettings,
): void {
  const bounds = session.sourceBounds;
  const i32 = session.parameterUploadI32;
  const u32 = session.parameterUploadU32;
  const f32 = session.parameterUploadF32;
  i32[0] = bounds.x;
  i32[1] = bounds.y;
  i32[2] = bounds.width;
  i32[3] = bounds.height;
  f32[4] = rasterNoiseAmountFactor(settings.amountPercent);
  f32[5] = rasterNoisePeriodPixels(settings.scalePercent);
  f32[6] = rasterNoiseOctaveCount(settings.octavesPercent);
  f32[7] = rasterNoiseTurbulence(settings.turbulencePercent);
  u32[8] = styleCode(settings.style);
  u32[9] = channelsCode(settings.channels);
  u32[10] = settings.additive ? 1 : 0;
  u32[11] = session.randomSeedLow;
  u32[12] = session.randomSeedHigh;
  u32[13] = DESTRUCTIVE_RASTER_NOISE_ALGORITHM_VERSION;
  u32[14] = DOCUMENT_WIDTH;
  u32[15] = DOCUMENT_HEIGHT;
  engine.device.queue.writeBuffer(
    session.parameterBuffer,
    0,
    session.parameterUpload,
  );
}

function destroySessionResources(session: ActiveRasterNoiseSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.parameterBuffer.destroy();
}

/**
 * Releases session-local handles after the GPU device becomes unusable.
 * No rollback copy is attempted: commands cannot be submitted after device loss.
 */
export function abandonRasterNoiseSession(engine: BrushEngine): boolean {
  const session = engine.activeRasterNoiseSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterNoiseSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function readRandomSeed(): RasterNoiseSeed {
  const words = new Uint32Array(2);
  globalThis.crypto.getRandomValues(words);
  return { low: words[0] >>> 0, high: words[1] >>> 0 };
}

function seedsEqual(left: RasterNoiseSeed | undefined, right: RasterNoiseSeed): boolean {
  return left?.low === right.low && left.high === right.high;
}

function nextSeed(engine: BrushEngine): RasterNoiseSeed {
  const injected = injectedSeedsByEngine.get(engine);
  let seed = injected?.shift() ?? readRandomSeed();
  const previous = lastSeedByEngine.get(engine);
  if (seedsEqual(previous, seed)) {
    seed = injected?.shift() ?? readRandomSeed();
    if (seedsEqual(previous, seed)) {
      seed = { low: (seed.low ^ 0x9e3779b9) >>> 0, high: seed.high >>> 0 };
    }
  }
  const normalized = { low: seed.low >>> 0, high: seed.high >>> 0 };
  lastSeedByEngine.set(engine, normalized);
  return normalized;
}

export function injectRasterNoiseSeedsForTesting(
  engine: BrushEngine,
  ...seeds: readonly RasterNoiseSeed[]
): void {
  if (!import.meta.env.DEV) {
    throw new Error("L'iniezione del seed Noise è disponibile solo in modalità dev.");
  }
  injectedSeedsByEngine.set(
    engine,
    seeds.map((seed) => ({ low: seed.low >>> 0, high: seed.high >>> 0 })),
  );
}

function encodeRequestedPreview(
  engine: BrushEngine,
  session: ActiveRasterNoiseSession,
  serial: number,
  settings: RasterNoiseSettings,
): void {
  if (engine.activeRasterNoiseSession !== session) return;
  if (session.encodedSerial === serial) return;
  writeParameters(engine, session, settings);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Native raster Noise preview ${settings.amountPercent}%`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: engine.layerTexture,
      origin: { x: bounds.x, y: bounds.y, z: 0 },
    },
    { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
  );
  if (settings.amountPercent > 0) {
    const pass = encoder.beginComputePass({ label: "Noise procedural pass" });
    pass.setPipeline(session.shared.pipeline);
    pass.setBindGroup(0, session.bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(bounds.width / WORKGROUP_WIDTH),
      Math.ceil(bounds.height / WORKGROUP_HEIGHT),
    );
    pass.end();
  }
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, bounds, session.sourceTileMask);
  engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  setAuthoritativeMetadata(engine, bounds, session.sourceTileMask);
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: BrushEngine,
  session: ActiveRasterNoiseSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterNoiseSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const settings = copySettings(session.settings);
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, settings);
      await engine.waitForGpuCapped(
        `Anteprima Noise ${settings.amountPercent.toFixed(0)}%`,
        60_000,
      );
    } catch (error) {
      session.previewFault = previewError(error);
      if (engine.activeRasterNoiseSession === session) {
        engine.publishStatus(
          `Anteprima Noise interrotta: ${session.previewFault.message}. Usa Annulla.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterNoiseSession === session
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
  engine: BrushEngine,
  session: ActiveRasterNoiseSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterNoiseSession !== session
      || session.terminal
      || session.previewFault
    ) {
      return;
    }
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: BrushEngine,
  session: ActiveRasterNoiseSession,
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
  engine: BrushEngine,
  session: ActiveRasterNoiseSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Cancel Native raster Noise layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: engine.layerTexture,
      origin: { x: bounds.x, y: bounds.y, z: 0 },
    },
    { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, bounds, session.sourceTileMask);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, bounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Annullamento Noise", 60_000);
  if (session.previewInFlight) await session.previewInFlight;
  if (presentationError) throw presentationError;
}

export async function beginRasterNoise(
  engine: BrushEngine,
  initial: Partial<RasterNoiseSettings> = DEFAULT_RASTER_NOISE_SETTINGS,
): Promise<RasterNoiseSnapshot | null> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (engine.activeRasterNoiseSession) return snapshot(engine.activeRasterNoiseSession);
  engine.assertDestructiveRasterEditCanOpen("noise");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("Il raster selezionato non coincide con il livello attivo.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Noise v1 lavora sull'intero livello: deseleziona i pixel prima di aprirlo.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("Il livello raster selezionato è vuoto.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Noise distruttivo richiede un documento RGBA16F.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterNoiseSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("Texture hot del raster per Noise mancante.");
    const sourceBounds = { ...record.contentBounds };
    const groupsX = Math.ceil(sourceBounds.width / WORKGROUP_WIDTH);
    const groupsY = Math.ceil(sourceBounds.height / WORKGROUP_HEIGHT);
    const maximumGroups = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (groupsX > maximumGroups || groupsY > maximumGroups) {
      throw new Error("Noise: dimensione dispatch non supportata dalla GPU.");
    }
    const sourceTileMask = record.storageTileMask.slice();
    const settings = normalizeRasterNoiseSettings(initial);
    const randomSeed = nextSeed(engine);
    const shared = await requireSharedResources(engine.device);
    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocazione Native raster Noise layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Noise immutable source layer ${record.id}`,
          size: {
            width: sourceBounds.width,
            height: sourceBounds.height,
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
          label: "Native raster Noise immutable source view",
        });
        const parameterBuffer = engine.device.createBuffer({
          label: "Native raster Noise parameters",
          size: PARAMETER_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => parameterBuffer.destroy());
        const parameterUpload = new ArrayBuffer(PARAMETER_BYTES);
        const outputView = hot.view;
        const bindGroup = engine.device.createBindGroup({
          label: "Native raster Noise bind group",
          layout: shared.bindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
            },
            { binding: 1, resource: sourceView },
            { binding: 2, resource: outputView },
          ],
        });
        const created: ActiveRasterNoiseSession = {
          layerId: record.id,
          sourceBounds,
          sourceTileMask,
          sourceTexture,
          sourceView,
          parameterBuffer,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadU32: new Uint32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          outputView,
          bindGroup,
          shared,
          randomSeedLow: randomSeed.low,
          randomSeedHigh: randomSeed.high,
          memoryBytes:
            sourceBounds.width * sourceBounds.height * BYTES_PER_RGBA16F_PIXEL
            + PARAMETER_BYTES,
          settings,
          requestedSerial: 1,
          encodedSerial: 0,
          previewFrame: null,
          previewInFlight: null,
          previewFault: null,
          terminal: false,
          destroyed: false,
        };
        const encoder = engine.device.createCommandEncoder({
          label: `Capture Native raster Noise source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: { x: sourceBounds.x, y: sourceBounds.y, z: 0 },
          },
          { texture: sourceTexture },
          {
            width: sourceBounds.width,
            height: sourceBounds.height,
            depthOrArrayLayers: 1,
          },
        );
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Preparazione Noise", 60_000);
        return created;
      },
    );
    engine.activeRasterNoiseSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus(
      `Anteprima Noise ${settings.amountPercent.toFixed(0)}%: Applica o Annulla.`,
      "ok",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterNoiseSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Avvio Noise fallito e ripristino incompleto: ricarica la pagina.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterNoiseSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Avvio Noise fallito: ${previewError(error).message}; `
        + `ripristino fallito: ${previewError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterNoise(
  engine: BrushEngine,
  update: Partial<RasterNoiseSettings>,
): RasterNoiseSnapshot {
  const session = engine.activeRasterNoiseSession;
  if (!session) throw new Error("Nessuna sessione Noise aperta.");
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Noise interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Noise sta già terminando.");
  const settings = normalizeRasterNoiseSettings({ ...session.settings, ...update });
  if (settingsEqual(settings, session.settings)) return snapshot(session);
  session.settings = settings;
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus(
    `Anteprima Noise ${settings.amountPercent.toFixed(0)}%…`,
    "working",
  );
  return snapshot(session);
}

export async function cancelRasterNoise(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterNoiseSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Noise sta già terminando.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Annullamento Noise fallito: ricarica la pagina.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterNoiseSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus(
    "Noise annullato: i pixel originali sono stati ripristinati.",
    "ok",
  );
  return true;
}

export async function commitRasterNoise(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterNoiseSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Noise interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Noise sta già terminando.");
  if (session.settings.amountPercent === 0) {
    await cancelRasterNoise(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    await flushPreview(engine, session);
    const record = engine.layerStack.active;
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("Texture hot del raster con Noise mancante.");
    seed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.sourceTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const settings = session.settings;
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "noise",
      amountPercent: settings.amountPercent,
      scalePercent: settings.scalePercent,
      octavesPercent: settings.octavesPercent,
      turbulencePercent: settings.turbulencePercent,
      style: settings.style,
      channels: settings.channels,
      additive: settings.additive,
      randomSeedLow: session.randomSeedLow,
      randomSeedHigh: session.randomSeedHigh,
      algorithm: DESTRUCTIVE_RASTER_NOISE_ALGORITHM,
      algorithmVersion: DESTRUCTIVE_RASTER_NOISE_ALGORITHM_VERSION,
      precision: DESTRUCTIVE_RASTER_NOISE_PRECISION,
      colorSpace: DESTRUCTIVE_RASTER_NOISE_COLOR_SPACE,
      alphaMode: DESTRUCTIVE_RASTER_NOISE_ALPHA_MODE,
      boundsMode: DESTRUCTIVE_RASTER_NOISE_BOUNDS_MODE,
      seed,
      baseBounds: { ...session.sourceBounds },
      baseTileMask: session.sourceTileMask.slice(),
    };
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    // One CPU boolean opts only this raster into continuous sampling of the
    // display pyramid it already owns while active. Pixels, export mip 0 and
    // the GPU allocation topology remain unchanged.
    record.noiseMipSmoothing = true;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Commit Noise fallito e rollback incompleto: ricarica la pagina.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Commit Noise fallito: ${operationMessage}; rollback fallito: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterNoiseSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Noise ${session.settings.amountPercent.toFixed(0)}% applicato ai pixel: un solo Undo.`,
    "ok",
  );
  return true;
}
