/** Transactional, dirty-region WebGPU Liquify for the selected native raster. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import type { DirtyRect } from "./engine-stroke-types";
import {
  createRgba16fToRgba8ResolveResources,
  destroyRgba16fToRgba8ResolveResources,
  encodeRgba16fToRgba8Resolve,
  type Rgba16fToRgba8ResolveResources,
} from "./engine-rgba16f-resolve";
import type { LayerFormat } from "./engine-types";
import type { LayerPoint } from "./engine-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  planMemoryAdmission,
  type MemoryReservation,
  type MemoryRequest,
} from "./memory-governor-core";
import { tileMaskCoveringRect } from "./raster-transform-math";
import {
  DEFAULT_LIQUIFY_SETTINGS,
  LIQUIFY_LIMITS,
  LIQUIFY_MODES,
  LIQUIFY_UNIFORM_BYTES,
  LIQUIFY_UNIFORM_USED_BYTES,
  clipLiquifyRect,
  liquifyDabDirtyBounds,
  liquifyInterpolatedPoint,
  liquifySegmentDirtyBounds,
  liquifySegmentStepCount,
  liquifySpacingPx,
  normalizeLiquifySettings,
  packLiquifyUniforms,
  unionLiquifyRects,
  type LiquifyMode,
  type LiquifyPoint,
  type LiquifyRect,
  type LiquifySettings,
  type LiquifyUniformInput,
} from "./liquify-core";
import {
  LIQUIFY_DISPLACEMENT_FORMAT,
  LIQUIFY_RESOLVE_SHADER,
  LIQUIFY_SHADER_STRATEGY,
  LIQUIFY_UPDATE_SHADER,
  LIQUIFY_WORKGROUP_SIZE,
} from "./liquify-shader";

export const RASTER_LIQUIFY_RUNTIME_BUILD =
  "raster-liquify-webgpu-v2-composed-warp-stable-patterns-transactional" as const;
export const RASTER_LIQUIFY_MEMORY_STRATEGY =
  "one-full-displacement-one-full-rgba16f-output-one-cropped-source-one-reused-swept-dirty-scratch" as const;
export const RASTER_LIQUIFY_INPUT_STRATEGY =
  "coalesced-pressure-mode-aware-resampling-stable-axis-hold-resampled-momentum" as const;

const BYTES_PER_RGBA16F_PIXEL = 8;
const MAX_DABS_PER_PREVIEW = 64;
const MAX_GENERATED_DABS_PER_EVENT = 2_048;
const MAX_MOMENTUM_DABS_PER_FRAME = 32;
const UNIFORM_SLOT_COUNT = MAX_DABS_PER_PREVIEW + 1;
const HOLD_MINIMUM_INTERVAL_MS = 12;
const MOMENTUM_MINIMUM_SPEED_PX_PER_MS = 0.012;
const MOMENTUM_MAXIMUM_DURATION_MS = 760;
const MAXIMUM_DISPLACEMENT_DOCUMENTS = 1.5;

interface LiquifySharedResources {
  updateBindGroupLayout: GPUBindGroupLayout;
  resolveBindGroupLayout: GPUBindGroupLayout;
  updatePipeline: GPUComputePipeline;
  resolvePipeline: GPUComputePipeline;
}

interface LiquifyDab {
  readonly center: LiquifyPoint;
  readonly previousCenter: LiquifyPoint;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly elapsedSeconds: number;
  readonly settings: LiquifySettings;
  readonly seed: number;
  readonly strength: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly dirtyRect: DirtyRect;
}

interface ActiveLiquifyStroke {
  lastInput: LiquifyPoint;
  lastDab: LiquifyPoint;
  velocityX: number;
  velocityY: number;
  lastHoldTimeMs: number;
  holdFrame: number | null;
  patternSeed: number;
  directionX: number;
  directionY: number;
  directionEstablished: boolean;
  dabCount: number;
}

export interface RasterLiquifySnapshot {
  readonly layerId: number;
  readonly settings: Readonly<LiquifySettings>;
  readonly amount: number;
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly mutationBounds: DirtyRect | null;
  readonly strokeCount: number;
  readonly dabCount: number;
  readonly memoryBytes: number;
  readonly activeStroke: boolean;
}

export interface ActiveRasterLiquifySession {
  readonly layerId: number;
  readonly sourceFormat: LayerFormat;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceScratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly outputTexture: GPUTexture;
  readonly outputView: GPUTextureView;
  readonly displacementTexture: GPUTexture;
  readonly displacementView: GPUTextureView;
  readonly displacementScratchTexture: GPUTexture;
  readonly displacementScratchView: GPUTextureView;
  readonly uniformBuffer: GPUBuffer;
  readonly uniformStride: number;
  readonly uniformUpload: ArrayBuffer;
  readonly uniformUploadBytes: Uint8Array;
  readonly uniformScratch: ArrayBuffer;
  readonly updateBindGroup: GPUBindGroup;
  readonly resolveBindGroup: GPUBindGroup;
  readonly rgba8Resolve: Rgba16fToRgba8ResolveResources | null;
  readonly shared: LiquifySharedResources;
  readonly memoryBytes: number;
  readonly pendingDabs: LiquifyDab[];
  readonly usedModes: Set<LiquifyMode>;
  settings: LiquifySettings;
  amount: number;
  mutationBounds: DirtyRect | null;
  resultBounds: DirtyRect;
  resultTileMask: Uint32Array;
  strokeCount: number;
  dabCount: number;
  nextSeed: number;
  stroke: ActiveLiquifyStroke | null;
  momentumFrame: number | null;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  rerenderRequested: boolean;
  terminal: boolean;
}

const sharedByDevice = new WeakMap<GPUDevice, Promise<LiquifySharedResources>>();

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copyRect(rect: Readonly<LiquifyRect> | null): DirtyRect | null {
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

function copyPoint(point: Readonly<LiquifyPoint>): LiquifyPoint {
  return {
    x: point.x,
    y: point.y,
    pressure: point.pressure,
    timeMs: point.timeMs,
  };
}

interface LiquifyDirection {
  x: number;
  y: number;
}

function normalizedDirection(
  x: number,
  y: number,
  fallbackX = 1,
  fallbackY = 0,
): LiquifyDirection {
  const length = Math.hypot(x, y);
  if (Number.isFinite(length) && length > 1e-6) {
    return { x: x / length, y: y / length };
  }
  const fallbackLength = Math.hypot(fallbackX, fallbackY);
  return fallbackLength > 1e-6
    ? { x: fallbackX / fallbackLength, y: fallbackY / fallbackLength }
    : { x: 1, y: 0 };
}

function directionFromSeed(seed: number): LiquifyDirection {
  let hash = (Math.trunc(seed) >>> 0) + 0x9e3779b9;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  hash = (hash ^ (hash >>> 15)) >>> 0;
  const angle = hash / 0x1_0000_0000 * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function normalizedPoint(point: Readonly<LayerPoint>): LiquifyPoint {
  return {
    x: Number.isFinite(point.x) ? point.x : 0,
    y: Number.isFinite(point.y) ? point.y : 0,
    pressure: Math.min(1, Math.max(0, Number.isFinite(point.pressure) ? point.pressure : 1)),
    timeMs: Number.isFinite(point.timeMs) ? point.timeMs : performance.now(),
  };
}

function expandedSourceBounds(bounds: DirtyRect, documentSize: number): DirtyRect {
  const guard = LIQUIFY_LIMITS.bilinearGuardPixels;
  return clipLiquifyRect(
    {
      x: bounds.x - guard,
      y: bounds.y - guard,
      width: bounds.width + guard * 2,
      height: bounds.height + guard * 2,
    },
    documentSize,
    documentSize,
  ) as DirtyRect;
}

function snapshot(session: ActiveRasterLiquifySession): RasterLiquifySnapshot {
  return {
    layerId: session.layerId,
    settings: { ...session.settings },
    amount: session.amount,
    sourceBounds: { ...session.sourceBounds },
    resultBounds: { ...session.resultBounds },
    mutationBounds: copyRect(session.mutationBounds),
    strokeCount: session.strokeCount,
    dabCount: session.dabCount,
    memoryBytes: session.memoryBytes,
    activeStroke: session.stroke !== null,
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

async function createSharedResources(device: GPUDevice): Promise<LiquifySharedResources> {
  return runGpuAllocationTransaction(device, "Pipeline Native raster Liquify", async () => {
    const updateModule = device.createShaderModule({
      label: "Native raster Liquify displacement update WGSL",
      code: LIQUIFY_UPDATE_SHADER,
    });
    const resolveModule = device.createShaderModule({
      label: "Native raster Liquify immutable source resolve WGSL",
      code: LIQUIFY_RESOLVE_SHADER,
    });
    await Promise.all([
      assertShaderCompiled(updateModule, "Native raster Liquify update"),
      assertShaderCompiled(resolveModule, "Native raster Liquify resolve"),
    ]);
    const updateBindGroupLayout = device.createBindGroupLayout({
      label: "Native raster Liquify update bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: LIQUIFY_UNIFORM_USED_BYTES,
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: "write-only",
            format: LIQUIFY_DISPLACEMENT_FORMAT,
            viewDimension: "2d",
          },
        },
      ],
    });
    const resolveBindGroupLayout = device.createBindGroupLayout({
      label: "Native raster Liquify resolve bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: LIQUIFY_UNIFORM_USED_BYTES,
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: "write-only",
            format: "rgba16float",
            viewDimension: "2d",
          },
        },
      ],
    });
    const updatePipeline = device.createComputePipeline({
      label: "Native raster Liquify dirty displacement pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [updateBindGroupLayout] }),
      compute: { module: updateModule, entryPoint: "updateLiquify" },
    });
    const resolvePipeline = device.createComputePipeline({
      label: "Native raster Liquify dirty resolve pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [resolveBindGroupLayout] }),
      compute: { module: resolveModule, entryPoint: "resolveLiquify" },
    });
    return {
      updateBindGroupLayout,
      resolveBindGroupLayout,
      updatePipeline,
      resolvePipeline,
    };
  });
}

async function requireSharedResources(device: GPUDevice): Promise<LiquifySharedResources> {
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

function cancelMomentum(session: ActiveRasterLiquifySession): void {
  if (session.momentumFrame !== null) {
    cancelAnimationFrame(session.momentumFrame);
    session.momentumFrame = null;
  }
}

function cancelStrokeHold(session: ActiveRasterLiquifySession): void {
  const stroke = session.stroke;
  if (stroke?.holdFrame !== null && stroke?.holdFrame !== undefined) {
    cancelAnimationFrame(stroke.holdFrame);
    stroke.holdFrame = null;
  }
}

function destroySessionResources(session: ActiveRasterLiquifySession): void {
  cancelStrokeHold(session);
  cancelMomentum(session);
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.outputTexture.destroy();
  session.displacementTexture.destroy();
  session.displacementScratchTexture.destroy();
  session.uniformBuffer.destroy();
  destroyRgba16fToRgba8ResolveResources(session.rgba8Resolve);
}

export function abandonRasterLiquifySession(engine: BrushEngine): boolean {
  const session = engine.activeRasterLiquifySession;
  if (!session) return false;
  session.terminal = true;
  session.pendingDabs.length = 0;
  destroySessionResources(session);
  engine.activeRasterLiquifySession = null;
  return true;
}

function uniformInput(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
  rect: DirtyRect,
  options: {
    center?: LiquifyPoint;
    previousCenter?: LiquifyPoint;
    deltaX?: number;
    deltaY?: number;
    elapsedSeconds?: number;
    settings?: Readonly<LiquifySettings>;
    seed?: number;
    strength?: number;
    directionX?: number;
    directionY?: number;
  } = {},
): LiquifyUniformInput {
  const center = options.center ?? { x: 0, y: 0, pressure: 1, timeMs: 0 };
  const previous = options.previousCenter ?? center;
  return {
    dispatchOriginX: rect.x,
    dispatchOriginY: rect.y,
    dispatchWidth: rect.width,
    dispatchHeight: rect.height,
    fieldOriginX: 0,
    fieldOriginY: 0,
    fieldWidth: engine.layerSize,
    fieldHeight: engine.layerSize,
    centerX: center.x,
    centerY: center.y,
    previousCenterX: previous.x,
    previousCenterY: previous.y,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    settings: options.settings ?? session.settings,
    pointerPressure: center.pressure,
    elapsedSeconds: options.elapsedSeconds ?? 0,
    seed: options.seed ?? 0,
    strength: options.strength ?? 1,
    maximumDisplacement: engine.layerSize * MAXIMUM_DISPLACEMENT_DOCUMENTS,
    sourceOriginX: session.sourceScratchBounds.x,
    sourceOriginY: session.sourceScratchBounds.y,
    sourceWidth: session.sourceScratchBounds.width,
    sourceHeight: session.sourceScratchBounds.height,
    documentWidth: engine.layerSize,
    documentHeight: engine.layerSize,
    strokeDirectionX: options.directionX ?? options.deltaX ?? 0,
    strokeDirectionY: options.directionY ?? options.deltaY ?? 0,
  };
}

function writeUniformSlot(
  session: ActiveRasterLiquifySession,
  slot: number,
  input: LiquifyUniformInput,
): void {
  packLiquifyUniforms(input, session.uniformScratch);
  session.uniformUploadBytes.set(
    new Uint8Array(session.uniformScratch),
    slot * session.uniformStride,
  );
}

function updateResultMetadata(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
): void {
  const result = unionLiquifyRects(session.sourceBounds, session.mutationBounds)
    ?? session.sourceBounds;
  session.resultBounds = result as DirtyRect;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    session.resultBounds,
    engine.layerSize,
  );
  setAuthoritativeMetadata(engine, session.resultBounds, session.resultTileMask);
}

function encodePreviewBatch(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
): DirtyRect | null {
  if (engine.activeRasterLiquifySession !== session || session.terminal) return null;
  const dabs = session.pendingDabs.splice(0, MAX_DABS_PER_PREVIEW);
  const rerenderRequested = session.rerenderRequested;
  session.rerenderRequested = false;
  let dabDirty: DirtyRect | null = null;
  for (const dab of dabs) {
    dabDirty = unionLiquifyRects(dabDirty, dab.dirtyRect) as DirtyRect | null;
  }
  if (dabDirty) {
    session.mutationBounds = unionLiquifyRects(
      session.mutationBounds,
      dabDirty,
    ) as DirtyRect;
    session.dabCount += dabs.length;
  }
  const resolveRect = rerenderRequested
    ? unionLiquifyRects(dabDirty, session.mutationBounds)
    : dabDirty;
  if (!resolveRect) return null;

  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index];
    writeUniformSlot(session, index, uniformInput(engine, session, dab.dirtyRect, {
      center: dab.center,
      previousCenter: dab.previousCenter,
      deltaX: dab.deltaX,
      deltaY: dab.deltaY,
      elapsedSeconds: dab.elapsedSeconds,
      settings: dab.settings,
      seed: dab.seed,
      strength: dab.strength,
      directionX: dab.directionX,
      directionY: dab.directionY,
    }));
  }
  const resolveSlot = dabs.length;
  const dirty = resolveRect as DirtyRect;
  writeUniformSlot(session, resolveSlot, uniformInput(engine, session, dirty, {
    strength: session.amount,
  }));
  const usedBytes = (resolveSlot + 1) * session.uniformStride;
  engine.device.queue.writeBuffer(
    session.uniformBuffer,
    0,
    session.uniformUpload,
    0,
    usedBytes,
  );

  const encoder = engine.device.createCommandEncoder({
    label: `Native raster Liquify preview ${dabs.length} dabs`,
  });
  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index];
    const pass = encoder.beginComputePass({
      label: `Liquify dab ${index + 1}/${dabs.length} · ${dab.settings.mode}`,
    });
    pass.setPipeline(session.shared.updatePipeline);
    pass.setBindGroup(0, session.updateBindGroup, [index * session.uniformStride]);
    pass.dispatchWorkgroups(
      Math.ceil(dab.dirtyRect.width / LIQUIFY_WORKGROUP_SIZE),
      Math.ceil(dab.dirtyRect.height / LIQUIFY_WORKGROUP_SIZE),
    );
    pass.end();
    encoder.copyTextureToTexture(
      { texture: session.displacementScratchTexture },
      {
        texture: session.displacementTexture,
        origin: { x: dab.dirtyRect.x, y: dab.dirtyRect.y, z: 0 },
      },
      {
        width: dab.dirtyRect.width,
        height: dab.dirtyRect.height,
        depthOrArrayLayers: 1,
      },
    );
  }

  const resolve = encoder.beginComputePass({ label: "Liquify dirty immutable-source resolve" });
  resolve.setPipeline(session.shared.resolvePipeline);
  resolve.setBindGroup(0, session.resolveBindGroup, [resolveSlot * session.uniformStride]);
  resolve.dispatchWorkgroups(
    Math.ceil(dirty.width / LIQUIFY_WORKGROUP_SIZE),
    Math.ceil(dirty.height / LIQUIFY_WORKGROUP_SIZE),
  );
  resolve.end();
  if (session.sourceFormat === "rgba8unorm") {
    if (!session.rgba8Resolve) {
      throw new Error("Liquify: resolve RGBA8 mancante.");
    }
    encodeRgba16fToRgba8Resolve(
      engine.device,
      encoder,
      session.rgba8Resolve,
      {
        sourceX: dirty.x,
        sourceY: dirty.y,
        targetX: dirty.x,
        targetY: dirty.y,
        width: dirty.width,
        height: dirty.height,
      },
      "Liquify RGBA16F → layer RGBA8",
    );
  } else {
    encoder.copyTextureToTexture(
      {
        texture: session.outputTexture,
        origin: { x: dirty.x, y: dirty.y, z: 0 },
      },
      {
        texture: engine.layerTexture,
        origin: { x: dirty.x, y: dirty.y, z: 0 },
      },
      { width: dirty.width, height: dirty.height, depthOrArrayLayers: 1 },
    );
  }
  engine.device.queue.submit([encoder.finish()]);

  updateResultMetadata(engine, session);
  engine.submitImmediate([], false, engine.settings, true, null, dirty, false);
  updateResultMetadata(engine, session);
  publishMixedScene(engine);
  engine.publishStats();
  return dirty;
}

function startPreviewSubmission(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterLiquifySession !== session
    || session.terminal
    || session.previewFault
    || (session.pendingDabs.length === 0 && !session.rerenderRequested)
  ) {
    return Promise.resolve();
  }
  const completion = Promise.resolve().then(async () => {
    try {
      const dirty = encodePreviewBatch(engine, session);
      if (dirty) await engine.waitForGpuCapped("Anteprima Liquify", 60_000);
    } catch (error) {
      session.previewFault = errorFrom(error);
      if (engine.activeRasterLiquifySession === session) {
        engine.publishStatus(
          `Anteprima Liquify interrotta: ${session.previewFault.message}. Usa Annulla.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterLiquifySession === session
        && !session.terminal
        && !session.previewFault
        && (session.pendingDabs.length > 0 || session.rerenderRequested)
      ) {
        schedulePreview(engine, session);
      }
    }
  });
  session.previewInFlight = completion;
  return completion;
}

function schedulePreview(engine: BrushEngine, session: ActiveRasterLiquifySession): void {
  if (
    session.previewFrame !== null
    || session.previewInFlight
    || session.previewFault
    || session.terminal
  ) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterLiquifySession !== session
      || session.terminal
      || session.previewFault
    ) return;
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  for (;;) {
    if (session.previewFault) throw session.previewFault;
    if (session.previewInFlight) {
      await session.previewInFlight;
      continue;
    }
    if (session.pendingDabs.length === 0 && !session.rerenderRequested) return;
    await startPreviewSubmission(engine, session);
  }
}

function enqueueDab(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
  center: LiquifyPoint,
  previousCenter: LiquifyPoint,
  settings: Readonly<LiquifySettings>,
  seed: number,
  elapsedSeconds: number,
  strength = 1,
  directionX = center.x - previousCenter.x,
  directionY = center.y - previousCenter.y,
): boolean {
  const normalized = normalizeLiquifySettings(settings, session.settings);
  const deltaX = center.x - previousCenter.x;
  const deltaY = center.y - previousCenter.y;
  if (
    strength <= 0
    || normalized.pressure * center.pressure <= 0
    || (normalized.mode === "push" && Math.hypot(deltaX, deltaY) < 1e-4)
    || (normalized.mode === "reconstruct" && session.dabCount === 0
      && session.pendingDabs.length === 0)
  ) return false;
  const dirtyRect = (
    normalized.mode === "push"
      ? liquifySegmentDirtyBounds(
        previousCenter,
        center,
        normalized,
        engine.layerSize,
        engine.layerSize,
      )
      : liquifyDabDirtyBounds(
        center,
        normalized,
        engine.layerSize,
        engine.layerSize,
      )
  ) as DirtyRect | null;
  if (!dirtyRect) return false;
  const direction = normalizedDirection(directionX, directionY, deltaX, deltaY);
  session.pendingDabs.push({
    center: copyPoint(center),
    previousCenter: copyPoint(previousCenter),
    deltaX,
    deltaY,
    elapsedSeconds: Math.min(0.1, Math.max(1 / 240, elapsedSeconds)),
    settings: normalized,
    seed,
    strength: Math.min(1, Math.max(0, strength)),
    directionX: direction.x,
    directionY: direction.y,
    dirtyRect,
  });
  session.usedModes.add(normalized.mode);
  schedulePreview(engine, session);
  return true;
}

function scheduleStrokeHold(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
  stroke: ActiveLiquifyStroke,
): void {
  if (stroke.holdFrame !== null || session.terminal) return;
  stroke.holdFrame = requestAnimationFrame((timeMs) => {
    stroke.holdFrame = null;
    if (
      engine.activeRasterLiquifySession !== session
      || session.stroke !== stroke
      || session.terminal
      || session.previewFault
    ) return;
    const elapsedMs = Math.max(0, timeMs - stroke.lastHoldTimeMs);
    if (elapsedMs >= HOLD_MINIMUM_INTERVAL_MS) {
      const velocityDamping = Math.exp(-elapsedMs / 55);
      stroke.velocityX *= velocityDamping;
      stroke.velocityY *= velocityDamping;
      if (session.settings.mode !== "push") {
        const center = { ...stroke.lastInput, timeMs };
        if (enqueueDab(
          engine,
          session,
          center,
          center,
          session.settings,
          stroke.patternSeed,
          elapsedMs / 1_000,
          1,
          stroke.directionX,
          stroke.directionY,
        )) {
          stroke.dabCount += 1;
        }
      }
      stroke.lastHoldTimeMs = timeMs;
    }
    scheduleStrokeHold(engine, session, stroke);
  });
}

function scheduleMomentumTail(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
  stroke: ActiveLiquifyStroke,
  settings: LiquifySettings,
): void {
  const momentum = settings.momentum;
  const speed = Math.hypot(stroke.velocityX, stroke.velocityY);
  if (
    momentum <= 0
    || (settings.mode === "push" && speed < MOMENTUM_MINIMUM_SPEED_PX_PER_MS)
  ) return;
  const startedAt = performance.now();
  const durationMs = 80 + momentum * (MOMENTUM_MAXIMUM_DURATION_MS - 80);
  let previousTime = startedAt;
  let center: LiquifyPoint = { ...stroke.lastInput, timeMs: startedAt };
  const interpolated: LiquifyPoint = { x: 0, y: 0, pressure: 0, timeMs: 0 };
  const spacing = liquifySpacingPx(settings);
  const tick = (timeMs: number) => {
    session.momentumFrame = null;
    if (
      engine.activeRasterLiquifySession !== session
      || session.terminal
      || session.previewFault
      || session.stroke
    ) return;
    const progress = Math.min(1, Math.max(0, (timeMs - startedAt) / durationMs));
    const decay = (1 - progress) ** 2 * momentum;
    const elapsedMs = Math.min(34, Math.max(1, timeMs - previousTime));
    previousTime = timeMs;

    let travelX = stroke.velocityX * elapsedMs * decay;
    let travelY = stroke.velocityY * elapsedMs * decay;
    const travelLength = Math.hypot(travelX, travelY);
    const maximumTravel = spacing * MAX_MOMENTUM_DABS_PER_FRAME;
    if (travelLength > maximumTravel) {
      const travelScale = maximumTravel / travelLength;
      travelX *= travelScale;
      travelY *= travelScale;
    }
    const nextCenter: LiquifyPoint = {
      x: center.x + travelX,
      y: center.y + travelY,
      pressure: stroke.lastInput.pressure,
      timeMs,
    };
    const steps = Math.min(
      MAX_MOMENTUM_DABS_PER_FRAME,
      liquifySegmentStepCount(center, nextCenter, spacing),
    );
    let previousDab = copyPoint(center);
    for (let step = 1; step <= steps; step += 1) {
      liquifyInterpolatedPoint(center, nextCenter, step, steps, interpolated);
      const current = copyPoint(interpolated);
      const elapsedSeconds = Math.max(1e-6, (current.timeMs - previousDab.timeMs) / 1_000);
      // Non-Push modes are temporal effects during Momentum. Passing a zero
      // delta makes dabTimeScale integrate elapsed time; splitting one frame
      // into more spatial samples therefore cannot strengthen the effect.
      const warpPrevious = settings.mode === "push" ? previousDab : current;
      enqueueDab(
        engine,
        session,
        current,
        warpPrevious,
        settings,
        stroke.patternSeed,
        elapsedSeconds,
        settings.mode === "push" ? 1 : decay,
        stroke.directionX,
        stroke.directionY,
      );
      previousDab = current;
    }
    center = nextCenter;
    if (progress < 1 && decay > 0.002) {
      session.momentumFrame = requestAnimationFrame(tick);
    }
  };
  session.momentumFrame = requestAnimationFrame(tick);
}

function clearDisplacementPass(
  encoder: GPUCommandEncoder,
  session: ActiveRasterLiquifySession,
): void {
  const clear = encoder.beginRenderPass({
    label: "Clear Native raster Liquify displacement field",
    colorAttachments: [{
      view: session.displacementView,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  clear.end();
}

async function restoreOriginalPixels(
  engine: BrushEngine,
  session: ActiveRasterLiquifySession,
): Promise<void> {
  cancelStrokeHold(session);
  cancelMomentum(session);
  session.stroke = null;
  session.pendingDabs.length = 0;
  session.rerenderRequested = false;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;

  const dirty = copyRect(session.mutationBounds);
  const encoder = engine.device.createCommandEncoder({
    label: `Restore Native raster Liquify source layer ${session.layerId}`,
  });
  clearDisplacementPass(encoder, session);
  if (dirty) {
    writeUniformSlot(session, 0, uniformInput(engine, session, dirty, { strength: 0 }));
    engine.device.queue.writeBuffer(
      session.uniformBuffer,
      0,
      session.uniformUpload,
      0,
      session.uniformStride,
    );
    const resolve = encoder.beginComputePass({ label: "Restore Liquify immutable source" });
    resolve.setPipeline(session.shared.resolvePipeline);
    resolve.setBindGroup(0, session.resolveBindGroup, [0]);
    resolve.dispatchWorkgroups(
      Math.ceil(dirty.width / LIQUIFY_WORKGROUP_SIZE),
      Math.ceil(dirty.height / LIQUIFY_WORKGROUP_SIZE),
    );
    resolve.end();
    if (session.sourceFormat === "rgba8unorm") {
      if (!session.rgba8Resolve) {
        throw new Error("Liquify: resolve RGBA8 mancante durante il ripristino.");
      }
      encodeRgba16fToRgba8Resolve(
        engine.device,
        encoder,
        session.rgba8Resolve,
        {
          sourceX: dirty.x,
          sourceY: dirty.y,
          targetX: dirty.x,
          targetY: dirty.y,
          width: dirty.width,
          height: dirty.height,
        },
        "Ripristino Liquify RGBA16F → layer RGBA8",
      );
    } else {
      encoder.copyTextureToTexture(
        {
          texture: session.outputTexture,
          origin: { x: dirty.x, y: dirty.y, z: 0 },
        },
        {
          texture: engine.layerTexture,
          origin: { x: dirty.x, y: dirty.y, z: 0 },
        },
        { width: dirty.width, height: dirty.height, depthOrArrayLayers: 1 },
      );
    }
  }
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  let presentationError: unknown = null;
  if (dirty) {
    try {
      engine.submitImmediate([], false, engine.settings, true, null, dirty, false);
    } catch (error) {
      presentationError = error;
    }
  }
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Ripristino Liquify", 60_000);
  if (presentationError) throw presentationError;
  session.mutationBounds = null;
  session.resultBounds = { ...session.sourceBounds };
  session.resultTileMask = session.sourceTileMask.slice();
  session.strokeCount = 0;
  session.dabCount = 0;
  session.usedModes.clear();
  session.nextSeed = 1;
  session.previewFault = null;
  publishMixedScene(engine);
  engine.publishStats();
}

function sessionMemoryRequest(memoryBytes: number): MemoryRequest {
  return {
    category: "native-raster-liquify-session",
    steadyBytes: memoryBytes,
    peakBytes: memoryBytes,
    priority: "interactive",
  };
}

function reserveSessionMemory(engine: BrushEngine, memoryBytes: number): MemoryReservation {
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
  if (decision.outcome !== "admit") {
    const requiredMiB = request.peakBytes / (1024 * 1024);
    const availableMiB = Math.max(0, decision.ceilingBytes - decision.usedBytes)
      / (1024 * 1024);
    throw new Error(
      `Memoria insufficiente per Liquify: ${requiredMiB.toFixed(1)} MiB richiesti, `
      + `${availableMiB.toFixed(1)} MiB disponibili.`,
    );
  }
  return engine.memoryReservations.reserve(request);
}

export async function beginRasterLiquify(
  engine: BrushEngine,
  initial: Partial<LiquifySettings> = DEFAULT_LIQUIFY_SETTINGS,
): Promise<RasterLiquifySnapshot | null> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (engine.activeRasterLiquifySession) return snapshot(engine.activeRasterLiquifySession);
  engine.assertDestructiveRasterEditCanOpen("liquify");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("Il raster selezionato non coincide con il livello attivo.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Liquify lavora sull’intero livello: deseleziona i pixel prima di aprirlo.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("Il livello raster selezionato è vuoto.");
  }
  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let reservation: MemoryReservation | null = null;
  let reservationClosed = false;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("Texture hot del raster per Liquify mancante.");
    const sourceBounds = { ...record.contentBounds };
    const sourceScratchBounds = expandedSourceBounds(sourceBounds, engine.layerSize);
    const sourceTileMask = record.storageTileMask.slice();
    const settings = normalizeLiquifySettings(initial);
    const shared = await requireSharedResources(engine.device);
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const uniformStride = Math.ceil(LIQUIFY_UNIFORM_BYTES / uniformAlignment)
      * uniformAlignment;
    const scratchExtent = Math.min(
      engine.layerSize,
      Math.ceil(
        LIQUIFY_LIMITS.maximumSize
        + LIQUIFY_LIMITS.maximumSpacing
        + LIQUIFY_LIMITS.bilinearGuardPixels * 2,
      ) + 1,
    );
    const maximumDispatch = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    const scratchWorkgroups = Math.ceil(scratchExtent / LIQUIFY_WORKGROUP_SIZE);
    if (Number.isFinite(maximumDispatch) && scratchWorkgroups > maximumDispatch) {
      throw new Error("Liquify: dimensione dispatch non supportata dalla GPU.");
    }
    const sourceBytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
    const memoryBytes =
      sourceScratchBounds.width * sourceScratchBounds.height * sourceBytesPerPixel
      + (
        engine.layerSize * engine.layerSize * 2
        + scratchExtent * scratchExtent
      ) * BYTES_PER_RGBA16F_PIXEL
      + uniformStride * UNIFORM_SLOT_COUNT
      + (engine.layerFormat === "rgba8unorm" ? 32 : 0);
    reservation = reserveSessionMemory(engine, memoryBytes);

    const session = await runGpuAllocationTransaction(
      engine.device,
      `Allocazione Native raster Liquify layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Liquify immutable source layer ${record.id}`,
          size: {
            width: sourceScratchBounds.width,
            height: sourceScratchBounds.height,
            depthOrArrayLayers: 1,
          },
          format: engine.layerFormat,
          usage:
            GPUTextureUsage.COPY_DST
            | GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => sourceTexture.destroy());
        const sourceView = sourceTexture.createView({
          label: "Native raster Liquify immutable source view",
        });
        const outputTexture = engine.device.createTexture({
          label: `Native raster Liquify RGBA16F output ${engine.layerSize}x${engine.layerSize}`,
          size: {
            width: engine.layerSize,
            height: engine.layerSize,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage:
            GPUTextureUsage.STORAGE_BINDING
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_SRC,
        });
        transaction.deferRollback(() => outputTexture.destroy());
        const outputView = outputTexture.createView({
          label: "Native raster Liquify RGBA16F output view",
        });
        const displacementTexture = engine.device.createTexture({
          label: `Native raster Liquify displacement field ${engine.layerSize}x${engine.layerSize}`,
          size: {
            width: engine.layerSize,
            height: engine.layerSize,
            depthOrArrayLayers: 1,
          },
          format: LIQUIFY_DISPLACEMENT_FORMAT,
          usage:
            GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        transaction.deferRollback(() => displacementTexture.destroy());
        const displacementView = displacementTexture.createView({
          label: "Native raster Liquify displacement field view",
        });
        const displacementScratchTexture = engine.device.createTexture({
          label: `Native raster Liquify reused dirty scratch ${scratchExtent}x${scratchExtent}`,
          size: {
            width: scratchExtent,
            height: scratchExtent,
            depthOrArrayLayers: 1,
          },
          format: LIQUIFY_DISPLACEMENT_FORMAT,
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        transaction.deferRollback(() => displacementScratchTexture.destroy());
        const displacementScratchView = displacementScratchTexture.createView({
          label: "Native raster Liquify reused dirty scratch view",
        });
        const uniformBuffer = engine.device.createBuffer({
          label: "Native raster Liquify dynamic uniform ring",
          size: uniformStride * UNIFORM_SLOT_COUNT,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => uniformBuffer.destroy());
        const updateBindGroup = engine.device.createBindGroup({
          label: "Native raster Liquify update bind group",
          layout: shared.updateBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: uniformBuffer, offset: 0, size: LIQUIFY_UNIFORM_USED_BYTES },
            },
            { binding: 1, resource: displacementView },
            { binding: 2, resource: displacementScratchView },
          ],
        });
        const resolveBindGroup = engine.device.createBindGroup({
          label: "Native raster Liquify resolve bind group",
          layout: shared.resolveBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: uniformBuffer, offset: 0, size: LIQUIFY_UNIFORM_USED_BYTES },
            },
            { binding: 1, resource: displacementView },
            { binding: 2, resource: sourceView },
            { binding: 3, resource: outputView },
          ],
        });
        const rgba8Resolve = engine.layerFormat === "rgba8unorm"
          ? await createRgba16fToRgba8ResolveResources(
            engine.device,
            outputView,
            engine.layerView,
            "Liquify",
          )
          : null;
        transaction.deferRollback(() => {
          destroyRgba16fToRgba8ResolveResources(rgba8Resolve);
        });
        const uniformUpload = new ArrayBuffer(uniformStride * UNIFORM_SLOT_COUNT);
        const created: ActiveRasterLiquifySession = {
          layerId: record.id,
          sourceFormat: engine.layerFormat,
          sourceBounds,
          sourceTileMask,
          sourceScratchBounds,
          sourceTexture,
          sourceView,
          outputTexture,
          outputView,
          displacementTexture,
          displacementView,
          displacementScratchTexture,
          displacementScratchView,
          uniformBuffer,
          uniformStride,
          uniformUpload,
          uniformUploadBytes: new Uint8Array(uniformUpload),
          uniformScratch: new ArrayBuffer(LIQUIFY_UNIFORM_BYTES),
          updateBindGroup,
          resolveBindGroup,
          rgba8Resolve,
          shared,
          memoryBytes,
          pendingDabs: [],
          usedModes: new Set<LiquifyMode>(),
          settings,
          amount: 1,
          mutationBounds: null,
          resultBounds: { ...sourceBounds },
          resultTileMask: sourceTileMask.slice(),
          strokeCount: 0,
          dabCount: 0,
          nextSeed: 1,
          stroke: null,
          momentumFrame: null,
          previewFrame: null,
          previewInFlight: null,
          previewFault: null,
          rerenderRequested: false,
          terminal: false,
        };
        const encoder = engine.device.createCommandEncoder({
          label: `Capture Native raster Liquify source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: {
              x: sourceScratchBounds.x,
              y: sourceScratchBounds.y,
              z: 0,
            },
          },
          { texture: sourceTexture },
          {
            width: sourceScratchBounds.width,
            height: sourceScratchBounds.height,
            depthOrArrayLayers: 1,
          },
        );
        clearDisplacementPass(encoder, created);
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Preparazione Liquify", 60_000);
        return created;
      },
    );
    engine.memoryReservations.settle(reservation);
    reservationClosed = true;
    engine.activeRasterLiquifySession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    engine.publishStats();
    engine.publishStatus(
      "Liquify pronto: trascina sul canvas, poi usa Applica o Annulla.",
      "ok",
    );
    return snapshot(session);
  } catch (error) {
    if (reservation && !reservationClosed) {
      engine.memoryReservations.release(reservation);
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    engine.scheduleLayerColdCompression();
    throw error;
  }
}

export function updateRasterLiquifySettings(
  engine: BrushEngine,
  update: Partial<LiquifySettings>,
): RasterLiquifySnapshot {
  const session = engine.activeRasterLiquifySession;
  if (!session) throw new Error("Nessuna sessione Liquify aperta.");
  if (session.terminal) throw new Error("Liquify sta già terminando.");
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Liquify interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.stroke) endRasterLiquifyStroke(engine, false);
  cancelMomentum(session);
  session.settings = normalizeLiquifySettings(update, session.settings);
  engine.publishStatus(`Liquify · ${session.settings.mode}.`, "ok");
  return snapshot(session);
}

export function setRasterLiquifyAmount(
  engine: BrushEngine,
  amount: number,
): RasterLiquifySnapshot {
  const session = engine.activeRasterLiquifySession;
  if (!session) throw new Error("Nessuna sessione Liquify aperta.");
  if (session.terminal) throw new Error("Liquify sta già terminando.");
  if (session.previewFault) {
    throw new Error(`Anteprima Liquify interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  const normalized = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 1));
  if (normalized === session.amount) return snapshot(session);
  cancelMomentum(session);
  session.amount = normalized;
  if (session.mutationBounds) {
    session.rerenderRequested = true;
    schedulePreview(engine, session);
  }
  engine.publishStatus(`Liquify · Amount ${Math.round(normalized * 100)}%.`, "working");
  return snapshot(session);
}

export function beginRasterLiquifyStroke(
  engine: BrushEngine,
  point: Readonly<LayerPoint>,
): boolean {
  const session = engine.activeRasterLiquifySession;
  if (!session || session.terminal || session.previewFault || session.stroke) return false;
  cancelMomentum(session);
  const input = normalizedPoint(point);
  const patternSeed = session.nextSeed++;
  const initialDirection = directionFromSeed(patternSeed);
  const stroke: ActiveLiquifyStroke = {
    lastInput: copyPoint(input),
    lastDab: copyPoint(input),
    velocityX: 0,
    velocityY: 0,
    lastHoldTimeMs: performance.now(),
    holdFrame: null,
    patternSeed,
    directionX: initialDirection.x,
    directionY: initialDirection.y,
    directionEstablished: false,
    dabCount: 0,
  };
  session.stroke = stroke;
  if (session.settings.mode !== "push") {
    if (enqueueDab(
      engine,
      session,
      input,
      input,
      session.settings,
      stroke.patternSeed,
      1 / 60,
      1,
      stroke.directionX,
      stroke.directionY,
    )) stroke.dabCount += 1;
  }
  scheduleStrokeHold(engine, session, stroke);
  return true;
}

export function extendRasterLiquifyStroke(
  engine: BrushEngine,
  points: readonly LayerPoint[],
): number {
  const session = engine.activeRasterLiquifySession;
  const stroke = session?.stroke;
  if (!session || !stroke || session.terminal || session.previewFault) return 0;
  let generated = 0;
  for (const rawPoint of points) {
    const point = normalizedPoint(rawPoint);
    const movementX = point.x - stroke.lastInput.x;
    const movementY = point.y - stroke.lastInput.y;
    const elapsedMs = Math.max(1, point.timeMs - stroke.lastInput.timeMs);
    const segmentVelocityX = movementX / elapsedMs;
    const segmentVelocityY = movementY / elapsedMs;
    stroke.velocityX = stroke.velocityX * 0.72 + segmentVelocityX * 0.28;
    stroke.velocityY = stroke.velocityY * 0.72 + segmentVelocityY * 0.28;

    if (
      session.settings.mode === "edge"
      && !stroke.directionEstablished
      && Math.hypot(movementX, movementY) > 1e-4
    ) {
      const candidate = normalizedDirection(
        movementX,
        movementY,
        stroke.directionX,
        stroke.directionY,
      );
      // Edge is a fold around one gesture axis. Freezing the first meaningful
      // tangent prevents overlapping dabs from composing incompatible folds
      // on curved or noisy pointer input.
      stroke.directionX = candidate.x;
      stroke.directionY = candidate.y;
      stroke.directionEstablished = true;
    }

    const spacing = liquifySpacingPx(session.settings);
    const segmentStart = stroke.lastDab;
    const segmentX = point.x - segmentStart.x;
    const segmentY = point.y - segmentStart.y;
    const segmentDistance = Math.hypot(segmentX, segmentY);
    // Fixed-distance sampling makes Push independent of pointer event rate.
    // The short residual is flushed once at pointer-up below.
    const uncappedSteps = Math.floor(segmentDistance / spacing);
    const steps = Math.min(MAX_GENERATED_DABS_PER_EVENT, uncappedSteps);
    const capped = uncappedSteps > MAX_GENERATED_DABS_PER_EVENT;
    const stepDistance = capped && steps > 0 ? segmentDistance / steps : spacing;
    let previousDab = copyPoint(segmentStart);
    for (let step = 1; step <= steps; step += 1) {
      const t = Math.min(1, step * stepDistance / Math.max(segmentDistance, 1e-6));
      const current: LiquifyPoint = {
        x: segmentStart.x + segmentX * t,
        y: segmentStart.y + segmentY * t,
        pressure: Math.min(1, Math.max(
          0,
          segmentStart.pressure + (point.pressure - segmentStart.pressure) * t,
        )),
        timeMs: segmentStart.timeMs + (point.timeMs - segmentStart.timeMs) * t,
      };
      const elapsedSeconds = Math.max(1 / 240, (current.timeMs - previousDab.timeMs) / 1_000);
      if (enqueueDab(
        engine,
        session,
        current,
        previousDab,
        session.settings,
        stroke.patternSeed,
        elapsedSeconds,
        1,
        stroke.directionX,
        stroke.directionY,
      )) {
        generated += 1;
        stroke.dabCount += 1;
      }
      previousDab = current;
    }
    if (steps > 0) stroke.lastDab = copyPoint(previousDab);
    stroke.lastInput = copyPoint(point);
    stroke.lastHoldTimeMs = performance.now();
  }
  return generated;
}

export function endRasterLiquifyStroke(
  engine: BrushEngine,
  allowMomentum = true,
): boolean {
  const session = engine.activeRasterLiquifySession;
  const stroke = session?.stroke;
  if (!session || !stroke) return false;
  cancelStrokeHold(session);
  if (session.settings.mode === "push") {
    const residualDistance = Math.hypot(
      stroke.lastInput.x - stroke.lastDab.x,
      stroke.lastInput.y - stroke.lastDab.y,
    );
    if (residualDistance > 1e-4 && enqueueDab(
      engine,
      session,
      stroke.lastInput,
      stroke.lastDab,
      session.settings,
      stroke.patternSeed,
      Math.max(1 / 240, (stroke.lastInput.timeMs - stroke.lastDab.timeMs) / 1_000),
      1,
      stroke.directionX,
      stroke.directionY,
    )) {
      stroke.dabCount += 1;
      stroke.lastDab = copyPoint(stroke.lastInput);
    }
  }
  session.stroke = null;
  if (stroke.dabCount > 0) session.strokeCount += 1;
  if (allowMomentum && stroke.dabCount > 0) {
    scheduleMomentumTail(engine, session, stroke, { ...session.settings });
  }
  return stroke.dabCount > 0;
}

export async function resetRasterLiquify(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterLiquifySession;
  if (!session) return false;
  if (session.terminal) throw new Error("Liquify sta già terminando.");
  session.terminal = true;
  engine.historyBusy = true;
  engine.publishHistoryState();
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Reset Liquify fallito: usa Annulla; se il ripristino fallisce, ricarica la pagina.",
    );
    throw error;
  }
  session.terminal = false;
  engine.historyBusy = false;
  engine.publishHistoryState();
  engine.publishStatus("Liquify ripristinato senza chiudere lo strumento.", "ok");
  return true;
}

export async function cancelRasterLiquify(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterLiquifySession;
  if (!session) return false;
  if (session.terminal) throw new Error("Liquify sta già terminando.");
  session.terminal = true;
  engine.historyBusy = true;
  engine.publishHistoryState();
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Annullamento Liquify fallito: ricarica la pagina.",
    );
    engine.publishStats();
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterLiquifySession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Liquify annullato: i pixel originali sono stati ripristinati.", "ok");
  return true;
}

export async function commitRasterLiquify(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterLiquifySession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Liquify interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Liquify sta già terminando.");
  cancelMomentum(session);
  if (session.stroke) endRasterLiquifyStroke(engine, false);
  if (
    (session.dabCount === 0 && session.pendingDabs.length === 0)
    || session.amount <= 0
  ) {
    await cancelRasterLiquify(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    // flushPreview normally refuses terminal sessions. Temporarily reopen only
    // the internal queue; external input remains blocked by the caller/UI.
    session.terminal = false;
    await flushPreview(engine, session);
    session.terminal = true;
    const record = engine.layerStack.active;
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("Texture hot del raster Liquify mancante.");
    seed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.resultTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const modes = LIQUIFY_MODES.filter((mode) => session.usedModes.has(mode));
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "liquify",
      strokeCount: session.strokeCount,
      dabCount: session.dabCount,
      modes,
      amountPercent: Math.round(session.amount * 100),
      strategy: LIQUIFY_SHADER_STRATEGY,
      precision: "layer-format-source-rgba16float-output-displacement-f32-math",
      displacementFormat: LIQUIFY_DISPLACEMENT_FORMAT,
      seed,
      baseBounds: { ...session.resultBounds },
      baseTileMask: session.resultTileMask.slice(),
    };
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
        "Commit Liquify fallito e rollback incompleto: ricarica la pagina.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      throw new Error(
        `Commit Liquify fallito: ${errorFrom(error).message}; `
        + `rollback fallito: ${errorFrom(rollbackError).message}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterLiquifySession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Liquify applicato · ${session.strokeCount} gesti · un solo Undo.`,
    "ok",
  );
  return true;
}
