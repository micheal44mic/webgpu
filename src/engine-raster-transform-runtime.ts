/** Transactional WebGPU Transform for every native raster layer. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled, createRenderPipelineAsync } from "./engine-gpu-utils";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { LayerFormat, RasterTransformSnapshot } from "./engine-types";
import type { LayerColdStorageResources } from "./engine-layer-resources";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { SerialAsyncQueue } from "./serial-async-queue";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { publishMixedScene } from "./engine-vector-text-runtime";
import type { DirtyRect } from "./engine-stroke-types";
import type {
  RasterTransformHistoryAction,
  SelectionHistoryMaskSnapshot,
} from "./engine-history-types";
import {
  normalizeRasterTransform,
  packRasterTransformUniforms,
  rasterTransformBounds,
  rasterTransformDirtyRect,
  rasterTransformSamplingBounds,
  rasterTransformSamplingPadding,
  rasterTransformScratchRect,
  rasterTransformTileMask,
  tileMaskCoveringRect,
  RASTER_TRANSFORM_UNIFORM_BYTES,
  type RasterTransformAffine,
  type NormalizedRasterTransformAffine,
} from "./raster-transform-math";
import {
  rasterTransformMipmapShader,
  rasterSelectionTranslateShader,
  rasterTransformShader,
  RASTER_SELECTION_TRANSLATE_SHADER_STRATEGY,
  RASTER_TRANSFORM_SHADER_STRATEGY,
} from "./raster-transform-shader";
import {
  isRasterWarpGridSize,
  normalizeRasterDeformPoints,
  normalizeRasterWarpBezierHandles,
  packRasterDeformVertices,
  rasterDeformCenter,
  rasterDeformGridSize,
  rasterDeformInitialPoints,
  rasterDeformIsIdentity,
  rasterDeformRenderedBounds,
  rasterWarpDefaultBezierHandles,
  remapRasterWarpBezierHandles,
  resampleRasterDeformGrid,
  translateRasterDeformPoints,
  RASTER_DEFORM_MAX_VERTEX_BYTES,
  RASTER_DEFORM_MAX_VERTICES,
  RASTER_DEFORM_VERTEX_FLOATS,
  type RasterTransformControlPoint,
  type RasterTransformMode,
  type RasterWarpBezierHandles,
  type RasterWarpGridSize,
} from "./raster-deform-math";
import {
  rasterDeformShader,
  RASTER_DEFORM_SHADER_STRATEGY,
} from "./raster-deform-shader";
import {
  captureSelectionHistoryMask,
  renderPixelSelectionOverlay,
  restorePixelSelectionHistoryMask,
  translatePixelSelection,
} from "./engine-selection-runtime";
import { rebuildRasterLayerFromImmutableSource } from "./engine-raster-image-runtime";
import {
  cloneRasterLayerSource,
  composeRasterLayerSourceTransform,
  rasterLayerSourceBounds,
  type RasterLayerSource,
} from "./raster-layer-source";

export const RASTER_LAYER_TRANSFORM_STRATEGY =
  "immutable-master-cumulative-matrix-native-cache-selection-pixel-checkpoint-v4" as const;
export const RASTER_SOURCE_MATRIX_TRANSFORM_STRATEGY =
  "immutable-master-gamma-mips-cumulative-matrix-derived-cache-v1" as const;
export const RASTER_LAYER_DEFORM_STRATEGY =
  "transactional-raster-warp-perspective-grid-v1" as const;
const RASTER_TRANSFORM_TRANSPARENT_GUARD_PX = 2;

interface RasterTransformSharedResources {
  readonly device: GPUDevice;
  readonly format: LayerFormat;
  bindGroupLayout: GPUBindGroupLayout;
  selectionMaskBindGroupLayout: GPUBindGroupLayout;
  mipBindGroupLayout: GPUBindGroupLayout;
  pipelineLayout: GPUPipelineLayout;
  selectionPipelineLayout: GPUPipelineLayout;
  mipPipelineLayout: GPUPipelineLayout;
  sampler: GPUSampler;
  pipeline: GPURenderPipeline | null;
  selectionPipeline: GPURenderPipeline | null;
  deformPipeline: GPURenderPipeline | null;
  clearPipeline: GPURenderPipeline | null;
  mipPipeline: GPURenderPipeline | null;
  readonly programPromises: Map<RasterTransformProgramBundle, Promise<void>>;
}

type RasterTransformProgramBundle = "affine" | "deform" | "mip" | "selection";

type CompiledRasterTransformProgramBundle =
  | { readonly kind: "affine"; readonly pipeline: GPURenderPipeline }
  | {
    readonly kind: "deform";
    readonly deformPipeline: GPURenderPipeline;
    readonly clearPipeline: GPURenderPipeline;
  }
  | { readonly kind: "mip"; readonly pipeline: GPURenderPipeline }
  | { readonly kind: "selection"; readonly pipeline: GPURenderPipeline };

export interface ActiveRasterTransformSession {
  readonly layerId: number;
  readonly scope: "layer" | "selection";
  /** Stable handle/pivot geometry, restored from the latest Transform action. */
  readonly sourceBounds: DirtyRect;
  /** Actual filtered pixel support used by storage, effects and sampling. */
  readonly sourceRasterBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceSelectionTileMask: Uint32Array | null;
  readonly sourceScratchRect: DirtyRect;
  readonly sourceTextureRect: DirtyRect;
  readonly sourcePivot: { x: number; y: number };
  /** Present only for a whole imported layer; never mutated by preview. */
  readonly rasterSourceBefore: RasterLayerSource | null;
  readonly scratchTexture: GPUTexture;
  readonly scratchView: GPUTextureView;
  readonly uniformBuffer: GPUBuffer;
  readonly deformVertexBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly selectionMaskBindGroup: GPUBindGroup | null;
  readonly uniformUpload: Float32Array;
  readonly deformVertexUpload: Float32Array;
  readonly shared: RasterTransformSharedResources;
  readonly memoryBytes: number;
  transform: NormalizedRasterTransformAffine;
  mode: RasterTransformMode;
  gridSize: RasterWarpGridSize;
  controlPoints: RasterTransformControlPoint[];
  bezierHandles: RasterTransformControlPoint[];
  deformVertexCount: number;
  resultBounds: DirtyRect | null;
  samplingBounds: DirtyRect | null;
  mutationBounds: DirtyRect | null;
  resultTileMask: Uint32Array;
  presentedSamplingBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  terminal: boolean;
}

export interface BeginRasterLayerTransformOptions {
  /** Internal group transactions always operate on the complete raster. */
  readonly forceWholeLayer?: boolean;
  /** The group owns scene selection, so the hot raster need not be selected. */
  readonly allowSelectionMismatch?: boolean;
}

const sharedResources = new WeakMap<
  BrushEngine,
  Map<LayerFormat, Promise<RasterTransformSharedResources>>
>();
const programCompilationQueues = new WeakMap<GPUDevice, SerialAsyncQueue>();

function programCompilationQueue(device: GPUDevice): SerialAsyncQueue {
  let queue = programCompilationQueues.get(device);
  if (!queue) {
    queue = new SerialAsyncQueue();
    programCompilationQueues.set(device, queue);
  }
  return queue;
}

function copyRect(rect: DirtyRect | null): DirtyRect | null {
  return rect ? { ...rect } : null;
}

function unionRects(left: DirtyRect | null, right: DirtyRect | null): DirtyRect | null {
  if (!left) return copyRect(right);
  if (!right) return copyRect(left);
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function rasterTransformScratchMemoryBytes(
  width: number,
  height: number,
  mipLevelCount: number,
  format: LayerFormat,
): number {
  const bytesPerPixel = format === "rgba16float" ? 8 : 4;
  let bytes = RASTER_TRANSFORM_UNIFORM_BYTES + RASTER_DEFORM_MAX_VERTEX_BYTES;
  for (let level = 0; level < mipLevelCount; level += 1) {
    bytes += Math.max(1, Math.floor(width / 2 ** level))
      * Math.max(1, Math.floor(height / 2 ** level))
      * bytesPerPixel;
  }
  return bytes;
}

function transformSnapshot(session: ActiveRasterTransformSession): RasterTransformSnapshot {
  const center = session.mode === "affine"
    ? {
      x: session.sourcePivot.x + session.transform.translationX,
      y: session.sourcePivot.y + session.transform.translationY,
    }
    : rasterDeformCenter(session.controlPoints);
  return {
    layerId: session.layerId,
    scope: session.scope,
    mode: session.mode,
    gridSize: session.gridSize,
    controlPoints: session.controlPoints.map((point) => ({ ...point })),
    bezierHandles: session.bezierHandles.map((point) => ({ ...point })),
    x: center.x,
    y: center.y,
    scale: session.transform.scale,
    scaleX: session.transform.scaleX,
    scaleY: session.transform.scaleY,
    rotation: session.transform.rotation,
    sourceBounds: { ...session.sourceBounds },
    sourcePivot: { ...session.sourcePivot },
    resultBounds: copyRect(session.resultBounds),
  };
}

async function createSharedResources(
  engine: BrushEngine,
): Promise<RasterTransformSharedResources> {
  const format = engine.layerFormat;
  const device = engine.device;
  const bindGroupLayout = device.createBindGroupLayout({
    label: "Native raster Transform bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: RASTER_TRANSFORM_UNIFORM_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ],
  });
  const mipBindGroupLayout = device.createBindGroupLayout({
    label: "Native raster Transform mip bind group layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d" },
    }],
  });
  const selectionMaskBindGroupLayout = device.createBindGroupLayout({
    label: "Native raster Transform selection mask bind group layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "read-only-storage" },
    }],
  });
  const sampler = device.createSampler({
    label: "Native raster Transform linear sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "nearest",
    maxAnisotropy: 1,
  });
  return {
    device,
    format,
    bindGroupLayout,
    selectionMaskBindGroupLayout,
    mipBindGroupLayout,
    pipelineLayout: device.createPipelineLayout({
      label: "Native raster Transform pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    }),
    selectionPipelineLayout: device.createPipelineLayout({
      label: "Native raster selected-pixel translation pipeline layout",
      bindGroupLayouts: [bindGroupLayout, selectionMaskBindGroupLayout],
    }),
    mipPipelineLayout: device.createPipelineLayout({
      label: "Native raster Transform mip pipeline layout",
      bindGroupLayouts: [mipBindGroupLayout],
    }),
    sampler,
    pipeline: null,
    selectionPipeline: null,
    deformPipeline: null,
    clearPipeline: null,
    mipPipeline: null,
    programPromises: new Map(),
  };
}

function affinePipelineDescriptor(
  shared: RasterTransformSharedResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Transform ${shared.format}`,
    layout: shared.pipelineLayout,
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function deformPipelineDescriptor(
  shared: RasterTransformSharedResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Warp and Perspective ${shared.format}`,
    layout: shared.pipelineLayout,
    vertex: {
      module,
      entryPoint: "deformVertexMain",
      buffers: [{
        arrayStride: RASTER_DEFORM_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" },
          { shaderLocation: 1, offset: 16, format: "float32" },
        ],
      }],
    },
    fragment: {
      module,
      entryPoint: "deformFragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function clearPipelineDescriptor(
  shared: RasterTransformSharedResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Warp dirty clear ${shared.format}`,
    layout: shared.pipelineLayout,
    vertex: { module, entryPoint: "clearVertexMain" },
    fragment: {
      module,
      entryPoint: "clearFragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function mipPipelineDescriptor(
  shared: RasterTransformSharedResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Transform exact mip ${shared.format}`,
    layout: shared.mipPipelineLayout,
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function selectionPipelineDescriptor(
  shared: RasterTransformSharedResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster selected-pixel translation ${shared.format}`,
    layout: shared.selectionPipelineLayout,
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function programBundleReady(
  shared: RasterTransformSharedResources,
  bundle: RasterTransformProgramBundle,
): boolean {
  if (bundle === "affine") return shared.pipeline !== null;
  if (bundle === "deform") {
    return shared.deformPipeline !== null && shared.clearPipeline !== null;
  }
  if (bundle === "mip") return shared.mipPipeline !== null;
  return shared.selectionPipeline !== null;
}

async function createProgramBundle(
  shared: RasterTransformSharedResources,
  bundle: RasterTransformProgramBundle,
): Promise<void> {
  // Some drivers compile independent async pipelines effectively serially and
  // become less responsive when several cold tools contend at once. Bound the
  // compiler work per device while retaining concurrency inside one bundle.
  // Pipeline creation rejects directly, so no device-global error scope is
  // held across this long-running operation.
  const compiled = await programCompilationQueue(shared.device).run(
    async (): Promise<CompiledRasterTransformProgramBundle> => {
        if (bundle === "affine") {
          const module = shared.device.createShaderModule({
            label: "Native raster Transform WGSL",
            code: rasterTransformShader,
          });
          await assertShaderCompiled(module, "Native raster Transform");
          return {
            kind: "affine",
            pipeline: await createRenderPipelineAsync(
              shared.device,
              affinePipelineDescriptor(shared, module),
            ),
          };
        }
        if (bundle === "deform") {
          const module = shared.device.createShaderModule({
            label: "Native raster Warp and Perspective WGSL",
            code: rasterDeformShader,
          });
          await assertShaderCompiled(module, "Native raster Warp and Perspective");
          const [deformPipeline, clearPipeline] = await Promise.all([
            createRenderPipelineAsync(shared.device, deformPipelineDescriptor(shared, module)),
            createRenderPipelineAsync(shared.device, clearPipelineDescriptor(shared, module)),
          ]);
          return { kind: "deform", deformPipeline, clearPipeline };
        }
        if (bundle === "mip") {
          const module = shared.device.createShaderModule({
            label: "Native raster Transform exact mip WGSL",
            code: rasterTransformMipmapShader,
          });
          await assertShaderCompiled(module, "Native raster Transform mip");
          return {
            kind: "mip",
            pipeline: await createRenderPipelineAsync(
              shared.device,
              mipPipelineDescriptor(shared, module),
            ),
          };
        }
        const module = shared.device.createShaderModule({
          label: "Native raster selected-pixel translation WGSL",
          code: rasterSelectionTranslateShader,
        });
        await assertShaderCompiled(module, "Native raster selected-pixel translation");
        return {
          kind: "selection",
          pipeline: await createRenderPipelineAsync(
            shared.device,
            selectionPipelineDescriptor(shared, module),
          ),
        };
    },
  );
  // Publish only after every pipeline in the requested bundle is valid. A
  // rejected compilation therefore leaves the bundle absent and retryable.
  if (compiled.kind === "affine") shared.pipeline = compiled.pipeline;
  else if (compiled.kind === "deform") {
    shared.deformPipeline = compiled.deformPipeline;
    shared.clearPipeline = compiled.clearPipeline;
  } else if (compiled.kind === "mip") shared.mipPipeline = compiled.pipeline;
  else shared.selectionPipeline = compiled.pipeline;
}

async function ensureProgramBundle(
  shared: RasterTransformSharedResources,
  bundle: RasterTransformProgramBundle,
): Promise<void> {
  if (programBundleReady(shared, bundle)) return;
  let promise = shared.programPromises.get(bundle);
  if (!promise) {
    promise = createProgramBundle(shared, bundle);
    shared.programPromises.set(bundle, promise);
  }
  try {
    await promise;
  } catch (error) {
    if (shared.programPromises.get(bundle) === promise) {
      shared.programPromises.delete(bundle);
    }
    throw error;
  }
  if (!programBundleReady(shared, bundle)) {
    shared.programPromises.delete(bundle);
    throw new Error(`Raster Transform ${bundle} programs were not published.`);
  }
}

function requireModeProgramBundle(
  shared: RasterTransformSharedResources,
  bundle: "affine" | "deform",
): void {
  if (programBundleReady(shared, bundle)) return;
  throw new Error(
    `Raster Transform ${bundle} programs must be prepared before changing mode.`,
  );
}

async function requireSharedResources(
  engine: BrushEngine,
  requestedMode: RasterTransformMode,
  selectionScope: boolean,
): Promise<RasterTransformSharedResources> {
  const format = engine.layerFormat;
  let byFormat = sharedResources.get(engine);
  byFormat ??= new Map<LayerFormat, Promise<RasterTransformSharedResources>>();
  let promise = byFormat.get(format);
  if (!promise) {
    promise = createSharedResources(engine);
    byFormat.set(format, promise);
    sharedResources.set(engine, byFormat);
  }
  let shared: RasterTransformSharedResources;
  try {
    shared = await promise;
  } catch (error) {
    byFormat.delete(format);
    if (byFormat.size === 0) sharedResources.delete(engine);
    throw error;
  }
  if (selectionScope) {
    await ensureProgramBundle(shared, "selection");
    return shared;
  }
  // Keep capability compilation sequential; only the two related deform
  // pipelines compile concurrently.
  await ensureProgramBundle(shared, requestedMode === "affine" ? "affine" : "deform");
  await ensureProgramBundle(shared, "mip");
  return shared;
}

/** Starts only the program bundle needed by the selected transform tool. */
export async function prewarmRasterTransformPrograms(
  engine: BrushEngine,
  requestedMode: RasterTransformMode = "affine",
): Promise<void> {
  if (!engine.initialized || engine.deviceLostError) return;
  const selectionScope = engine.pixelSelectionState.selectedPixels > 0;
  await requireSharedResources(engine, requestedMode, selectionScope);
}

function destroySessionResources(session: ActiveRasterTransformSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.uniformBuffer.destroy();
  session.deformVertexBuffer.destroy();
  session.scratchTexture.destroy();
}

function writeSessionUniforms(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
  transform: RasterTransformAffine = session.transform,
): void {
  packRasterTransformUniforms({
    sourceScratchRect: session.sourceTextureRect,
    sourceContentBounds: session.sourceRasterBounds,
    sourcePivot: session.sourcePivot,
    transform,
    documentWidth: engine.documentWidth,
    documentHeight: engine.documentHeight,
  }, session.uniformUpload);
  engine.device.queue.writeBuffer(session.uniformBuffer, 0, session.uniformUpload);
}

function writeSessionDeformVertices(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
): void {
  if (session.mode === "affine") {
    session.deformVertexCount = 0;
    return;
  }
  const packed = packRasterDeformVertices(
    session.controlPoints,
    session.sourceBounds,
    session.sourceTextureRect,
    session.mode,
    session.gridSize,
    session.deformVertexUpload,
    session.bezierHandles,
  );
  session.deformVertexCount = packed.vertexCount;
  engine.device.queue.writeBuffer(
    session.deformVertexBuffer,
    0,
    packed.data.buffer,
    packed.data.byteOffset,
    packed.data.byteLength,
  );
}

function setAuthoritativeMetadata(
  engine: BrushEngine,
  bounds: DirtyRect | null,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  engine.layerContentBounds = copyRect(bounds);
  engine.layerHasContent = bounds !== null;
  record.contentBounds = copyRect(bounds);
  record.hasContent = bounds !== null;
  // Punto unico in cui bounds e maschera vengono scritti insieme: e' qui che
  // l'invariante "contenuto dentro i tile" va imposta, non nei quattro
  // chiamanti. Vedi `tileMaskCoveringRect`.
  record.storageTileMask.set(
    tileMaskCoveringRect(tileMask, bounds),
  );
}

function requiredProgram(
  pipeline: GPURenderPipeline | null,
  label: string,
): GPURenderPipeline {
  if (!pipeline) {
    throw new Error(`Raster Transform ${label} pipeline is not prepared.`);
  }
  return pipeline;
}

function encodeTransformPass(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
  encoder: GPUCommandEncoder,
  dirtyRect: DirtyRect,
  mode: RasterTransformMode = session.mode,
): void {
  const pass = encoder.beginRenderPass({
    label: "Native raster Transform preview",
    colorAttachments: [{
      view: engine.layerView,
      loadOp: "load",
      storeOp: "store",
    }],
  });
  pass.setScissorRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
  if (session.scope !== "selection" && mode !== "affine") {
    pass.setPipeline(requiredProgram(session.shared.clearPipeline, "clear"));
    pass.setBindGroup(0, session.bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.setPipeline(requiredProgram(session.shared.deformPipeline, "deform"));
    pass.setBindGroup(0, session.bindGroup);
    pass.setVertexBuffer(0, session.deformVertexBuffer);
    pass.draw(session.deformVertexCount, 1, 0, 0);
    pass.end();
    return;
  }
  pass.setPipeline(requiredProgram(
    session.scope === "selection"
      ? session.shared.selectionPipeline
      : session.shared.pipeline,
    session.scope === "selection" ? "selected-pixel translation" : "affine",
  ));
  pass.setBindGroup(0, session.bindGroup);
  if (session.scope === "selection") {
    if (!session.selectionMaskBindGroup) {
      throw new Error("The Pixel Selection bind group is missing during Transform.");
    }
    pass.setBindGroup(1, session.selectionMaskBindGroup);
  }
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function renderRequestedPreview(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
): void {
  if (engine.activeRasterTransformSession !== session) return;
  session.previewFrame = null;
  if (session.encodedSerial === session.requestedSerial) return;
  const dirtyRect = rasterTransformDirtyRect(
    session.presentedSamplingBounds,
    session.mutationBounds,
    DOCUMENT_WIDTH,
    0,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (dirtyRect) {
    writeSessionUniforms(engine, session);
    writeSessionDeformVertices(engine, session);
    const encoder = engine.device.createCommandEncoder({
      label: `Native raster Transform preview #${session.requestedSerial}`,
    });
    encodeTransformPass(engine, session, encoder, dirtyRect);
    engine.device.queue.submit([encoder.finish()]);

    // FIFO ordering makes this presentation/effects submit observe the exact
    // transformed pixels without a CPU fence or an intermediate frame.
    // `resultBounds` is the geometric box used by the handles. The raster can
    // contain legitimate filtered alpha out to `samplingBounds`; that actual
    // pixel support is authoritative for effects, cold storage and replay.
    setAuthoritativeMetadata(engine, session.samplingBounds, session.resultTileMask);
    engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
    setAuthoritativeMetadata(engine, session.samplingBounds, session.resultTileMask);
  }
  session.presentedSamplingBounds = copyRect(session.mutationBounds);
  session.encodedSerial = session.requestedSerial;
  if (session.scope === "selection") {
    engine.selectionOverlayOffsetX = session.transform.translationX;
    engine.selectionOverlayOffsetY = session.transform.translationY;
    renderPixelSelectionOverlay(engine);
  }
  publishMixedScene(engine);
  engine.publishStats();
}

function schedulePreview(engine: BrushEngine, session: ActiveRasterTransformSession): void {
  if (session.previewFrame !== null) return;
  session.previewFrame = requestAnimationFrame(() => renderRequestedPreview(engine, session));
}

function flushPreview(engine: BrushEngine, session: ActiveRasterTransformSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  renderRequestedPreview(engine, session);
}

export async function beginRasterLayerTransform(
  engine: BrushEngine,
  requestedMode: RasterTransformMode = "affine",
  options: Readonly<BeginRasterLayerTransformOptions> = {},
): Promise<RasterTransformSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  const groupSession = engine.activeMixedSceneGroupTransformSession;
  if (
    groupSession
    && !(options.allowSelectionMismatch && groupSession.internalRasterOperation)
  ) {
    throw new Error("The group Transform already owns the Transform transaction.");
  }
  if (engine.activeRasterTransformSession) {
    const active = engine.activeRasterTransformSession;
    if (active.scope === "layer" && active.mode !== requestedMode) {
      await ensureProgramBundle(
        active.shared,
        requestedMode === "affine" ? "affine" : "deform",
      );
      const snapshot = updateRasterLayerTransform(engine, { mode: requestedMode });
      publishMixedScene(engine);
      return snapshot;
    }
    return transformSnapshot(active);
  }
  engine.assertDestructiveRasterEditCanOpen("transform");
  const record = engine.layerStack.active;
  if (!options.allowSelectionMismatch) {
    const selected = engine.mixedSceneStack?.selected;
    if (selected?.kind !== "raster") return null;
    if (selected.rasterLayerId !== record.id) {
      throw new Error(
        `Transform invariant: selected raster ${selected.rasterLayerId}, `
        + `but active raster ${record.id}.`,
      );
    }
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  const selectionScope = !options.forceWholeLayer
    && engine.pixelSelectionState.selectedPixels > 0;
  const selectionBounds = engine.pixelSelectionState.bounds;
  const selectionRenderer = selectionScope ? engine.selectionRenderer : null;
  if (selectionScope && (!selectionBounds || !selectionRenderer)) {
    throw new Error("Pixel Selection is active, but its GPU mask is not resident.");
  }
  engine.selectionOverlaySuppressed = false;
  engine.selectionOverlayOffsetX = 0;
  engine.selectionOverlayOffsetY = 0;
  if (selectionScope) renderPixelSelectionOverlay(engine);
  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterTransformSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The hot texture for the raster to transform is missing.");
    const sourceRasterBounds = { ...record.contentBounds };
    let sourceBounds = selectionScope ? { ...selectionBounds! } : sourceRasterBounds;
    if (!selectionScope && !record.rasterSource) {
      for (let index = engine.historyCursor - 1; index >= 0; index -= 1) {
        const action = engine.historyActions[index];
        if (
          action.kind === "vector"
          || action.kind === "document-background"
          || action.kind === "scene-reorder"
          || action.kind === "layer-add"
          || action.kind === "layer-delete"
          || action.kind === "layer-merge"
        ) continue;
        const transformAction = action.kind === "group-transform"
          ? action.rasters.find((entry) => entry.layerId === record.id) ?? null
          : action.kind === "raster-transform" && action.layerId === record.id
            ? action
            : null;
        if (action.kind === "group-transform" && !transformAction) continue;
        if (action.kind !== "group-transform" && action.layerId !== record.id) continue;
        if (
          transformAction?.scope === "layer"
          && transformAction.geometryBounds
        ) {
          // Unione, non sostituzione. Il `geometryBounds` journaled e'
          // l'estensione della geometria trasformata, e si riusa proprio
          // perche' puo' eccedere il contenuto rasterizzato: senza, ogni giro
          // ritaglierebbe un po' di piu'. Ma per arrotondamento nella
          // rasterizzazione e' anche sistematicamente **piu' piccolo** del
          // contenuto reale di qualche pixel (misurato: record 1079x736 contro
          // journal 1074x730 dopo due Applica). Sostituirlo dimensiona lo
          // scratch su un rettangolo che non contiene i pixel del livello, e la
          // riapertura muore su "sourceContentBounds deve essere contenuto
          // nello scratch": da li' Trasforma non si apre piu' su quel livello.
          sourceBounds = unionRects(sourceRasterBounds, transformAction.geometryBounds)
            ?? sourceRasterBounds;
        }
        break;
      }
    }
    // Anche in lettura, non solo in scrittura: lo scratch nasce da questa
    // maschera ed e' contro di lui che `packRasterTransformUniforms` verifica
    // il contenuto. Imporlo qui ripara anche un livello che ha gia' divergenza
    // da prima — da una sessione precedente o da un altro percorso che scrive
    // la maschera — invece di limitarsi a prevenirla d'ora in poi.
    const sourceTileMask = tileMaskCoveringRect(
      record.storageTileMask,
      sourceBounds,
    );
    const sourceSelectionTileMask = selectionScope
      ? engine.pixelSelectionTileMask.slice()
      : null;
    const sourceScratchRect = rasterTransformScratchRect(
      sourceTileMask,
    ) as DirtyRect | null;
    if (!sourceScratchRect) {
      throw new Error("The raster layer contains no transformable tiles.");
    }
    const sourcePivot = {
      x: record.rasterSource?.x ?? sourceBounds.x + sourceBounds.width * 0.5,
      y: record.rasterSource?.y ?? sourceBounds.y + sourceBounds.height * 0.5,
    };
    const sourceTextureRect = {
      x: sourceScratchRect.x - RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
      y: sourceScratchRect.y - RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
      width: sourceScratchRect.width + RASTER_TRANSFORM_TRANSPARENT_GUARD_PX * 2,
      height: sourceScratchRect.height + RASTER_TRANSFORM_TRANSPARENT_GUARD_PX * 2,
    };
    const shared = await requireSharedResources(engine, requestedMode, selectionScope);
    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocate Raster Transform ${sourceScratchRect.width}×${sourceScratchRect.height}`,
      async (transaction) => {
        const mipLevelCount = selectionScope
          ? 1
          : Math.floor(Math.log2(Math.max(
            sourceTextureRect.width,
            sourceTextureRect.height,
          ))) + 1;
        const mipPipeline = mipLevelCount > 1
          ? requiredProgram(shared.mipPipeline, "mip")
          : null;
        const scratchTexture = engine.device.createTexture({
          label: `Native raster Transform source layer ${record.id}`,
          size: {
            width: sourceTextureRect.width,
            height: sourceTextureRect.height,
            depthOrArrayLayers: 1,
          },
          mipLevelCount,
          format: engine.layerFormat,
          usage:
            GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        transaction.deferRollback(() => scratchTexture.destroy());
        const scratchView = scratchTexture.createView({
          label: `Native raster Transform source mips layer ${record.id}`,
          baseMipLevel: 0,
          mipLevelCount,
        });
        const uniformBuffer = engine.device.createBuffer({
          label: `Native raster Transform uniform layer ${record.id}`,
          size: RASTER_TRANSFORM_UNIFORM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => uniformBuffer.destroy());
        const deformVertexBuffer = engine.device.createBuffer({
          label: `Native raster Warp vertices layer ${record.id}`,
          size: RASTER_DEFORM_MAX_VERTEX_BYTES,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => deformVertexBuffer.destroy());
        const bindGroup = engine.device.createBindGroup({
          label: `Native raster Transform bind group layer ${record.id}`,
          layout: shared.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: scratchView },
            { binding: 2, resource: shared.sampler },
          ],
        });
        const selectionMaskBindGroup = selectionScope
          ? engine.device.createBindGroup({
            label: `Native raster Transform selection mask layer ${record.id}`,
            layout: shared.selectionMaskBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: selectionRenderer!.maskBuffer } }],
          })
          : null;
        const transform = normalizeRasterTransform({
          translationX: 0,
          translationY: 0,
          scale: 1,
          rotation: 0,
        });
        const created: ActiveRasterTransformSession = {
          layerId: record.id,
          scope: selectionScope ? "selection" : "layer",
          sourceBounds,
          sourceRasterBounds,
          sourceTileMask,
          sourceSelectionTileMask,
          sourceScratchRect,
          sourceTextureRect,
          sourcePivot,
          rasterSourceBefore: cloneRasterLayerSource(record.rasterSource),
          scratchTexture,
          scratchView,
          uniformBuffer,
          deformVertexBuffer,
          bindGroup,
          selectionMaskBindGroup,
          uniformUpload: new Float32Array(RASTER_TRANSFORM_UNIFORM_BYTES / 4),
          deformVertexUpload: new Float32Array(
            RASTER_DEFORM_MAX_VERTICES * RASTER_DEFORM_VERTEX_FLOATS,
          ),
          shared,
          memoryBytes: rasterTransformScratchMemoryBytes(
            sourceTextureRect.width,
            sourceTextureRect.height,
            mipLevelCount,
            engine.layerFormat,
          ),
          transform,
          mode: "affine",
          gridSize: 3,
          controlPoints: [],
          bezierHandles: [],
          deformVertexCount: 0,
          resultBounds: { ...sourceBounds },
          samplingBounds: selectionScope
            ? { ...sourceRasterBounds }
            : rasterTransformSamplingBounds(
              sourceRasterBounds,
              sourcePivot,
              transform,
              DOCUMENT_WIDTH,
              DOCUMENT_HEIGHT,
            ) as DirtyRect | null,
          mutationBounds: selectionScope ? { ...sourceBounds } : { ...sourceRasterBounds },
          resultTileMask: sourceTileMask.slice(),
          presentedSamplingBounds: selectionScope
            ? { ...sourceBounds }
            : { ...sourceRasterBounds },
          requestedSerial: 0,
          encodedSerial: 0,
          previewFrame: null,
          terminal: false,
        };
        if (!selectionScope && requestedMode !== "affine") {
          transitionRasterTransformMode(created, requestedMode, created.gridSize);
        }
        writeSessionUniforms(engine, created);

        const encoder = engine.device.createCommandEncoder({
          label: `Native raster Transform immutable source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: { x: sourceScratchRect.x, y: sourceScratchRect.y, z: 0 },
          },
          {
            texture: scratchTexture,
            mipLevel: 0,
            origin: {
              x: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
              y: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
              z: 0,
            },
          },
          {
            width: sourceScratchRect.width,
            height: sourceScratchRect.height,
            depthOrArrayLayers: 1,
          },
        );
        for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel += 1) {
          const sourceView = scratchTexture.createView({
            baseMipLevel: mipLevel - 1,
            mipLevelCount: 1,
          });
          const targetView = scratchTexture.createView({
            baseMipLevel: mipLevel,
            mipLevelCount: 1,
          });
          const mipBindGroup = engine.device.createBindGroup({
            layout: shared.mipBindGroupLayout,
            entries: [{ binding: 0, resource: sourceView }],
          });
          const pass = encoder.beginRenderPass({
            label: `Native raster Transform mip ${mipLevel}`,
            colorAttachments: [{
              view: targetView,
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            }],
          });
          pass.setPipeline(mipPipeline!);
          pass.setBindGroup(0, mipBindGroup);
          pass.draw(3, 1, 0, 0);
          pass.end();
        }
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Prepare Raster Transform", 60_000);
        return created;
      },
    );
    engine.activeRasterTransformSession = session;
    // La preparazione e' finita: da qui la sessione e' aperta e ad ammettere o
    // rifiutare le operazioni e' `activeRasterTransformSession`, non piu'
    // `historyBusy`. Lasciarlo acceso rendeva Undo un rifiuto **silenzioso** a
    // tempo indefinito, e per giunta con il motivo sbagliato: `historyBusy`
    // viene interrogato prima della sessione, quindi l'utente leggeva "un'altra
    // operazione in corso" invece di "chiudi la trasformazione".
    engine.historyBusy = false;
    engine.publishStatus(
      selectionScope
        ? `Move the selected pixels in ${record.name}: Apply or Cancel.`
        : `GPU Transform ready for ${record.name}: Apply or Cancel.`,
      "ok",
    );
    publishMixedScene(engine);
    engine.publishHistoryState();
    engine.publishStats();
    return transformSnapshot(session);
  } catch (error) {
    if (session) destroySessionResources(session);
    engine.activeRasterTransformSession = null;
    engine.selectionOverlaySuppressed = false;
    engine.selectionOverlayOffsetX = 0;
    engine.selectionOverlayOffsetY = 0;
    renderPixelSelectionOverlay(engine);
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.scheduleLayerColdCompression();
    throw error;
  }
}

function affineApproximationForDeform(
  session: ActiveRasterTransformSession,
): NormalizedRasterTransformAffine {
  const size = rasterDeformGridSize(session.mode, session.gridSize);
  const topLeft = session.controlPoints[0];
  const topRight = session.controlPoints[size - 1];
  const bottomLeft = session.controlPoints[(size - 1) * size];
  const horizontalScale = Math.hypot(
    topRight.x - topLeft.x,
    topRight.y - topLeft.y,
  ) / Math.max(1e-6, session.sourceBounds.width);
  const verticalScale = Math.hypot(
    bottomLeft.x - topLeft.x,
    bottomLeft.y - topLeft.y,
  ) / Math.max(1e-6, session.sourceBounds.height);
  const rotation = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
  const sourceCenter = {
    x: session.sourceBounds.x + session.sourceBounds.width * 0.5,
    y: session.sourceBounds.y + session.sourceBounds.height * 0.5,
  };
  const destinationCenter = rasterDeformCenter(session.controlPoints);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const sourceDeltaX = sourceCenter.x - session.sourcePivot.x;
  const sourceDeltaY = sourceCenter.y - session.sourcePivot.y;
  return normalizeRasterTransform({
    translationX: destinationCenter.x - session.sourcePivot.x
      - (cosine * horizontalScale * sourceDeltaX
        - sine * verticalScale * sourceDeltaY),
    translationY: destinationCenter.y - session.sourcePivot.y
      - (sine * horizontalScale * sourceDeltaX
        + cosine * verticalScale * sourceDeltaY),
    scaleX: horizontalScale,
    scaleY: verticalScale,
    rotation,
  });
}

function transitionRasterTransformMode(
  session: ActiveRasterTransformSession,
  nextMode: RasterTransformMode,
  nextGridSize: RasterWarpGridSize,
): void {
  if (session.mode === nextMode && session.gridSize === nextGridSize) return;
  requireModeProgramBundle(
    session.shared,
    nextMode === "affine" ? "affine" : "deform",
  );
  if (nextMode === "affine") {
    if (session.mode !== "affine") session.transform = affineApproximationForDeform(session);
    session.mode = "affine";
    session.gridSize = nextGridSize;
    session.controlPoints = [];
    session.bezierHandles = [];
    session.deformVertexCount = 0;
    return;
  }
  const previousMode = session.mode;
  const previousSize = previousMode === "affine"
    ? 0
    : rasterDeformGridSize(previousMode, session.gridSize);
  const previousPoints = session.controlPoints;
  const previousHandles = session.bezierHandles;
  const nextSize = rasterDeformGridSize(nextMode, nextGridSize);
  const nextPoints = previousMode === "affine"
    ? rasterDeformInitialPoints(
      session.sourceBounds,
      nextMode,
      nextGridSize,
      session.transform,
    )
    : resampleRasterDeformGrid(
      previousPoints,
      previousSize,
      nextSize,
    );
  session.controlPoints = nextPoints;
  session.bezierHandles = nextMode === "warp"
    ? previousMode === "warp"
      ? [...remapRasterWarpBezierHandles(
        previousPoints,
        previousSize,
        nextPoints,
        nextSize,
        previousHandles,
      )]
      : [...rasterWarpDefaultBezierHandles(nextPoints, nextSize)]
    : [];
  session.mode = nextMode;
  session.gridSize = nextGridSize;
  session.transform = normalizeRasterTransform({
    translationX: 0,
    translationY: 0,
    scale: 1,
    rotation: 0,
  });
}

type RasterTransformUpdate = Partial<Pick<
  RasterTransformSnapshot,
  | "x"
  | "y"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "rotation"
  | "mode"
  | "gridSize"
  | "controlPoints"
  | "bezierHandles"
>>;

export function updateRasterLayerTransform(
  engine: BrushEngine,
  update: RasterTransformUpdate,
): RasterTransformSnapshot {
  const session = engine.activeRasterTransformSession;
  if (!session) throw new Error("No Raster Transform session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.terminal) {
    throw new Error("The raster transform is already being applied or canceled.");
  }
  const requestedMode = update.mode ?? session.mode;
  const requestedGridSize = update.gridSize ?? session.gridSize;
  if (!isRasterWarpGridSize(requestedGridSize)) {
    throw new Error("The Warp grid must be 3×3, 4×4, or 5×5.");
  }
  if (
    session.scope === "selection"
    && (requestedMode !== "affine"
      || update.controlPoints !== undefined
      || update.bezierHandles !== undefined
      || (update.scale !== undefined && Math.abs(update.scale - 1) > 1e-7)
      || (update.scaleX !== undefined && Math.abs(update.scaleX - 1) > 1e-7)
      || (update.scaleY !== undefined && Math.abs(update.scaleY - 1) > 1e-7)
      || (update.rotation !== undefined && Math.abs(update.rotation) > 1e-7))
  ) {
    throw new Error(
      "Pixel Selection can only be moved, not scaled, rotated, or distorted.",
    );
  }
  transitionRasterTransformMode(session, requestedMode, requestedGridSize);

  if (session.mode === "affine") {
    if (update.bezierHandles !== undefined) {
      throw new Error("Bézier handles are available only in Warp.");
    }
    let transform = normalizeRasterTransform({
      translationX: update.x === undefined
        ? session.transform.translationX
        : update.x - session.sourcePivot.x,
      translationY: update.y === undefined
        ? session.transform.translationY
        : update.y - session.sourcePivot.y,
      // The legacy field remains a uniform update. Explicit axis fields take
      // precedence so callers can also change both axes atomically.
      scaleX: update.scaleX ?? update.scale ?? session.transform.scaleX,
      scaleY: update.scaleY ?? update.scale ?? session.transform.scaleY,
      rotation: update.rotation ?? session.transform.rotation,
    });
    if (session.scope === "selection") {
      transform = {
        translationX: Math.round(transform.translationX),
        translationY: Math.round(transform.translationY),
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      };
    }
    session.transform = transform;
    session.resultBounds = rasterTransformBounds(
      session.sourceBounds,
      session.sourcePivot,
      transform,
      // Content metadata describes actual transformed pixels. Filtering safety
      // belongs only to the transient dirty/scissor rect; persisting it here
      // would grow bounds and shift the pivot after every successive Apply.
      { documentWidth: DOCUMENT_WIDTH, documentHeight: DOCUMENT_HEIGHT, padding: 0 },
    ) as DirtyRect | null;
  } else {
    if (
      update.scale !== undefined
      || update.scaleX !== undefined
      || update.scaleY !== undefined
      || update.rotation !== undefined
    ) {
      throw new Error("Warp and Perspective are edited by dragging the control points.");
    }
    const previousPoints = session.controlPoints;
    let nextPoints = previousPoints;
    if (update.controlPoints !== undefined) {
      nextPoints = normalizeRasterDeformPoints(
        update.controlPoints,
        session.mode,
        session.gridSize,
      );
    } else if (update.x !== undefined || update.y !== undefined) {
      const center = rasterDeformCenter(session.controlPoints);
      nextPoints = translateRasterDeformPoints(
        session.controlPoints,
        (update.x ?? center.x) - center.x,
        (update.y ?? center.y) - center.y,
      );
    }
    if (session.mode === "warp") {
      const nextSize = rasterDeformGridSize(session.mode, session.gridSize);
      const nextHandles: RasterWarpBezierHandles = update.bezierHandles !== undefined
        ? normalizeRasterWarpBezierHandles(
          update.bezierHandles,
          nextPoints,
          nextSize,
        )
        : remapRasterWarpBezierHandles(
          previousPoints,
          nextSize,
          nextPoints,
          nextSize,
          session.bezierHandles,
        );
      session.bezierHandles = [...nextHandles];
    } else if (update.bezierHandles !== undefined) {
      throw new Error("Bézier handles are available only in Warp.");
    }
    session.controlPoints = nextPoints;
    session.resultBounds = rasterDeformRenderedBounds(
      session.controlPoints,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
      session.mode,
      session.gridSize,
      0,
      session.bezierHandles,
    ) as DirtyRect | null;
  }

  if (session.scope === "selection") {
    session.mutationBounds = copyRect(session.resultBounds);
    session.samplingBounds = unionRects(session.sourceRasterBounds, session.resultBounds);
    const movedSelectionTiles = session.resultBounds && session.sourceSelectionTileMask
      ? rasterTransformTileMask(
        session.sourceSelectionTileMask,
        session.sourceBounds,
        session.sourcePivot,
        session.transform,
        {
          documentWidth: DOCUMENT_WIDTH,
          documentHeight: DOCUMENT_HEIGHT,
          padding: 0,
        },
      )
      : new Uint32Array(session.sourceTileMask.length);
    session.resultTileMask = session.sourceTileMask.slice();
    for (let index = 0; index < session.resultTileMask.length; index += 1) {
      session.resultTileMask[index] |= movedSelectionTiles[index];
    }
  } else if (session.mode === "affine") {
    const transform = session.transform;
    const samplingPadding = rasterTransformSamplingPadding(transform);
    session.samplingBounds = rasterTransformSamplingBounds(
      session.sourceRasterBounds,
      session.sourcePivot,
      transform,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect | null;
    session.mutationBounds = copyRect(session.samplingBounds);
    session.resultTileMask = session.samplingBounds
      ? rasterTransformTileMask(
        session.sourceTileMask,
        session.sourceRasterBounds,
        session.sourcePivot,
        transform,
        {
          documentWidth: DOCUMENT_WIDTH,
          documentHeight: DOCUMENT_HEIGHT,
          padding: samplingPadding,
        },
      )
      : new Uint32Array(session.sourceTileMask.length);
  } else {
    session.samplingBounds = rasterDeformRenderedBounds(
      session.controlPoints,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
      session.mode,
      session.gridSize,
      2,
      session.bezierHandles,
    ) as DirtyRect | null;
    session.mutationBounds = copyRect(session.samplingBounds);
    session.resultTileMask = tileMaskCoveringRect(
      new Uint32Array(session.sourceTileMask.length),
      session.samplingBounds,
    );
  }
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  return transformSnapshot(session);
}

export function nudgeRasterLayerTransform(
  engine: BrushEngine,
  deltaX: number,
  deltaY: number,
): RasterTransformSnapshot {
  const session = engine.activeRasterTransformSession;
  if (!session) {
    throw new Error("No raster is ready for keyboard movement.");
  }
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new RangeError("Raster movement must be finite.");
  }
  const center = session.mode === "affine"
    ? {
      x: session.sourcePivot.x + session.transform.translationX,
      y: session.sourcePivot.y + session.transform.translationY,
    }
    : rasterDeformCenter(session.controlPoints);
  return updateRasterLayerTransform(engine, {
    x: center.x + (session.scope === "selection" ? Math.round(deltaX) : deltaX),
    y: center.y + (session.scope === "selection" ? Math.round(deltaY) : deltaY),
  });
}

function rasterTransformMatrix(session: ActiveRasterTransformSession): readonly [
  number, number, number, number, number, number,
] {
  const cosine = Math.cos(session.transform.rotation);
  const sine = Math.sin(session.transform.rotation);
  const a = cosine * session.transform.scaleX;
  const b = sine * session.transform.scaleX;
  const c = -sine * session.transform.scaleY;
  const d = cosine * session.transform.scaleY;
  const destinationX = session.sourcePivot.x + session.transform.translationX;
  const destinationY = session.sourcePivot.y + session.transform.translationY;
  return [
    a,
    b,
    c,
    d,
    destinationX - a * session.sourcePivot.x - c * session.sourcePivot.y,
    destinationY - b * session.sourcePivot.x - d * session.sourcePivot.y,
  ];
}

function rasterTransformIsIdentity(session: ActiveRasterTransformSession): boolean {
  if (session.mode !== "affine") {
    return rasterDeformIsIdentity(
      session.controlPoints,
      session.sourceBounds,
      session.mode,
      session.gridSize,
      1e-6,
      session.bezierHandles,
    );
  }
  return Math.abs(session.transform.translationX) < 1e-7
    && Math.abs(session.transform.translationY) < 1e-7
    && Math.abs(session.transform.scaleX - 1) < 1e-7
    && Math.abs(session.transform.scaleY - 1) < 1e-7
    && Math.abs(session.transform.rotation) < 1e-7;
}

async function restoreOriginalPixels(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
): Promise<void> {
  flushPreview(engine, session);
  const identity: RasterTransformAffine = {
    translationX: 0,
    translationY: 0,
    scale: 1,
    rotation: 0,
  };
  const identitySamplingBounds = rasterTransformSamplingBounds(
    session.sourceRasterBounds,
    session.sourcePivot,
    identity,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  const identityMutationBounds = session.scope === "selection"
    ? session.sourceBounds
    : identitySamplingBounds;
  const dirtyRect = rasterTransformDirtyRect(
    session.presentedSamplingBounds,
    identityMutationBounds,
    DOCUMENT_WIDTH,
    0,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (dirtyRect) {
    writeSessionUniforms(engine, session, identity);
    const encoder = engine.device.createCommandEncoder({
      label: `Cancel native raster Transform layer ${session.layerId}`,
    });
    encodeTransformPass(engine, session, encoder, dirtyRect, "affine");
    encoder.copyTextureToTexture(
      {
        texture: session.scratchTexture,
        mipLevel: 0,
        origin: {
          x: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
          y: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
          z: 0,
        },
      },
      {
        texture: engine.layerTexture,
        origin: {
          x: session.sourceScratchRect.x,
          y: session.sourceScratchRect.y,
          z: 0,
        },
      },
      {
        width: session.sourceScratchRect.width,
        height: session.sourceScratchRect.height,
        depthOrArrayLayers: 1,
      },
    );
    engine.device.queue.submit([encoder.finish()]);
    setAuthoritativeMetadata(engine, session.sourceRasterBounds, session.sourceTileMask);
    engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
    setAuthoritativeMetadata(engine, session.sourceRasterBounds, session.sourceTileMask);
  }
  await engine.waitForGpuCapped("Cancel Raster Transform", 60_000);
  if (session.scope === "selection") {
    engine.selectionOverlayOffsetX = 0;
    engine.selectionOverlayOffsetY = 0;
    renderPixelSelectionOverlay(engine);
  }
}

export async function cancelRasterLayerTransform(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterTransformSession;
  if (!session) return false;
  if (session.terminal) {
    throw new Error("The raster transform is already finishing.");
  }
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    // Keep the immutable scratch and the session reachable: a second Cancel
    // can retry the exact restore instead of throwing away the only source.
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Raster Transform cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterTransformSession = null;
  engine.selectionOverlaySuppressed = false;
  engine.selectionOverlayOffsetX = 0;
  engine.selectionOverlayOffsetY = 0;
  renderPixelSelectionOverlay(engine);
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Raster transform canceled.", "ok");
  return true;
}

/**
 * Materializes an already-open whole-layer Transform and returns its exact
 * checkpoint without publishing a journal action. The caller owns the seed
 * until it either publishes a compound action or destroys it during rollback.
 */
export async function materializeRasterLayerTransformHistoryAction(
  engine: BrushEngine,
): Promise<RasterTransformHistoryAction | null> {
  const session = engine.activeRasterTransformSession;
  if (!session) return null;
  if (session.scope !== "layer") {
    throw new Error("A group Transform cannot materialize a Pixel Selection.");
  }
  if (session.terminal) {
    throw new Error("The raster transform is already finishing.");
  }
  if (rasterTransformIsIdentity(session)) {
    await cancelRasterLayerTransform(engine);
    return null;
  }

  session.terminal = true;
  let seed: LayerColdStorageResources | null = null;
  let retainSessionForRecovery = false;
  const rasterSourceBefore = cloneRasterLayerSource(session.rasterSourceBefore);
  let rasterSourceAfter: RasterLayerSource | null = null;
  try {
    flushPreview(engine, session);
    const record = engine.layerStack.active;
    if (record.id !== session.layerId) {
      throw new Error(
        `Raster Transform session ${session.layerId} is not the active raster ${record.id}.`,
      );
    }
    const affineSourceTransformIsRepresentable = session.mode === "affine"
      && Math.abs(session.transform.scaleX - session.transform.scaleY) < 1e-7;
    if (affineSourceTransformIsRepresentable && session.rasterSourceBefore) {
      rasterSourceAfter = composeRasterLayerSourceTransform(
        session.rasterSourceBefore,
        session.transform,
      );
      record.rasterSource = cloneRasterLayerSource(rasterSourceAfter);
      const dirtyRect = await rebuildRasterLayerFromImmutableSource(engine, record);
      const exactBounds = rasterLayerSourceBounds(
        rasterSourceAfter,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
      ) as DirtyRect | null;
      session.resultBounds = copyRect(exactBounds);
      session.samplingBounds = copyRect(exactBounds);
      session.mutationBounds = copyRect(exactBounds);
      session.resultTileMask = record.storageTileMask.slice();
      if (dirtyRect) {
        engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
        setAuthoritativeMetadata(engine, exactBounds, session.resultTileMask);
        record.rasterSource = cloneRasterLayerSource(rasterSourceAfter);
      }
    } else if (session.rasterSourceBefore) {
      // Independent axis scale is an intentional rasterization boundary.
      record.rasterSource = null;
    }
    await engine.waitForGpuCapped("Materialize group Raster Transform", 60_000);
    if (session.samplingBounds) {
      const hot = engine.requireLayerGpu(session.layerId).hot;
      if (!hot) throw new Error("The transformed raster's hot texture is missing.");
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        session.resultTileMask.slice(),
        engine.nextHistoryActionId,
        "history",
      );
    }
    const common = {
      id: engine.nextHistoryActionId,
      kind: "raster-transform",
      layerId: session.layerId,
      baseTileMask: session.resultTileMask.slice(),
      geometryBounds: copyRect(session.resultBounds),
      matrix: rasterTransformMatrix(session),
      filterStrategy: rasterSourceAfter
        ? RASTER_SOURCE_MATRIX_TRANSFORM_STRATEGY
        : RASTER_TRANSFORM_SHADER_STRATEGY,
      scope: "layer",
      selectionBefore: null,
      selectionAfter: null,
      rasterSourceBefore,
      rasterSourceAfter: cloneRasterLayerSource(rasterSourceAfter),
    } as const;
    return session.samplingBounds && seed
      ? {
        ...common,
        seed,
        baseBounds: { ...session.samplingBounds },
      }
      : {
        ...common,
        seed: null,
        baseBounds: null,
      };
  } catch (error) {
    try {
      engine.layerStack.active.rasterSource = cloneRasterLayerSource(rasterSourceBefore);
      await restoreOriginalPixels(engine, session);
      engine.layerStack.active.rasterSource = cloneRasterLayerSource(rasterSourceBefore);
    } catch (restoreError) {
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Group Transform raster rollback failed: reload the page.",
        restoreError,
      );
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Raster materialization failed: ${operationMessage}; rollback failed: ${rollbackMessage}`,
      );
    } finally {
      destroyLayerColdStorage(seed);
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterTransformSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
      engine.selectionOverlaySuppressed = false;
      engine.selectionOverlayOffsetX = 0;
      engine.selectionOverlayOffsetY = 0;
      renderPixelSelectionOverlay(engine);
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
}

export async function commitRasterLayerTransform(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterTransformSession;
  if (!session) return false;
  if (session.terminal) {
    throw new Error("The raster transform is already finishing.");
  }
  if (rasterTransformIsIdentity(session)) {
    await cancelRasterLayerTransform(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let selectionBefore: SelectionHistoryMaskSnapshot | null = null;
  let selectionAfter: SelectionHistoryMaskSnapshot | null = null;
  let selectionTranslated = false;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  const rasterSourceBefore = cloneRasterLayerSource(session.rasterSourceBefore);
  let rasterSourceAfter: RasterLayerSource | null = null;
  try {
    flushPreview(engine, session);
    const record = engine.layerStack.active;
    const affineSourceTransformIsRepresentable = session.mode === "affine"
      && Math.abs(session.transform.scaleX - session.transform.scaleY) < 1e-7;
    if (
      session.scope === "layer"
      && affineSourceTransformIsRepresentable
      && session.rasterSourceBefore
    ) {
      rasterSourceAfter = composeRasterLayerSourceTransform(
        session.rasterSourceBefore,
        session.transform,
      );
      record.rasterSource = cloneRasterLayerSource(rasterSourceAfter);
      const dirtyRect = await rebuildRasterLayerFromImmutableSource(engine, record);
      const exactBounds = rasterLayerSourceBounds(
        rasterSourceAfter,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
      ) as DirtyRect | null;
      session.resultBounds = copyRect(exactBounds);
      session.samplingBounds = copyRect(exactBounds);
      session.mutationBounds = copyRect(exactBounds);
      session.resultTileMask = record.storageTileMask.slice();
      if (dirtyRect) {
        // FIFO submission makes effects/presentation observe the cache rebuilt
        // from the master without any CPU readback or intermediate bake.
        engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
        setAuthoritativeMetadata(engine, exactBounds, session.resultTileMask);
        record.rasterSource = cloneRasterLayerSource(rasterSourceAfter);
      }
    } else if (
      session.scope === "layer"
      && (session.mode !== "affine" || session.rasterSourceBefore)
    ) {
      // A free mesh or independent axis scale cannot be represented by the
      // imported source's uniform-scale matrix. Apply is the intentional
      // rasterization boundary; Undo still restores rasterSourceBefore and
      // Redo hydrates the exact GPU checkpoint.
      record.rasterSource = null;
    } else if (session.scope === "selection" && session.rasterSourceBefore) {
      // A pixel selection is intentionally destructive: it is the explicit
      // rasterization boundary, unlike a whole-layer matrix transform.
      record.rasterSource = null;
    }
    await engine.waitForGpuCapped("Commit Raster Transform", 60_000);
    if (session.samplingBounds) {
      const hot = engine.requireLayerGpu(session.layerId).hot;
      if (!hot) throw new Error("The transformed raster's hot texture is missing.");
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        session.resultTileMask.slice(),
        engine.nextHistoryActionId,
        "history",
      );
    }
    if (session.scope === "selection") {
      selectionBefore = captureSelectionHistoryMask(
        engine,
        `Transform selection ${engine.nextHistoryActionId} · before`,
      );
      await translatePixelSelection(
        engine,
        session.transform.translationX,
        session.transform.translationY,
      );
      selectionTranslated = true;
      selectionAfter = captureSelectionHistoryMask(
        engine,
        `Transform selection ${engine.nextHistoryActionId} · after`,
        true,
      );
    }
    // Allocate every JS payload before invalidating Redo. After the truncate,
    // publication is reduced to one array insertion and scalar assignments.
    const actionId = engine.nextHistoryActionId;
    const common = {
      id: actionId,
      kind: "raster-transform",
      layerId: session.layerId,
      baseTileMask: session.resultTileMask.slice(),
      geometryBounds: copyRect(session.resultBounds),
      matrix: rasterTransformMatrix(session),
      filterStrategy: session.scope === "selection"
        ? RASTER_SELECTION_TRANSLATE_SHADER_STRATEGY
        : session.mode !== "affine"
          ? RASTER_DEFORM_SHADER_STRATEGY
        : rasterSourceAfter
          ? RASTER_SOURCE_MATRIX_TRANSFORM_STRATEGY
          : RASTER_TRANSFORM_SHADER_STRATEGY,
      scope: session.scope,
      selectionBefore,
      selectionAfter,
      rasterSourceBefore,
      rasterSourceAfter: cloneRasterLayerSource(rasterSourceAfter),
    } as const;
    const action: RasterTransformHistoryAction = session.samplingBounds && seed
      ? {
        ...common,
        seed,
        baseBounds: { ...session.samplingBounds },
      }
      : {
        ...common,
        seed: null,
        baseBounds: null,
      };
    commitHistoryActionAtomically(engine, action);
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
    journalPublished = true;
  } catch (error) {
    // The history cursor is untouched until the checkpoint exists. Restore the
    // immutable source if allocation or publication fails.
    let rollbackError: unknown = null;
    try {
      if (selectionTranslated && selectionBefore) {
        await restorePixelSelectionHistoryMask(engine, selectionBefore);
        selectionTranslated = false;
      }
      engine.layerStack.active.rasterSource = cloneRasterLayerSource(rasterSourceBefore);
      await restoreOriginalPixels(engine, session);
      engine.layerStack.active.rasterSource = cloneRasterLayerSource(rasterSourceBefore);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Raster Transform commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      destroyLayerColdStorage(seed);
      if (!journalPublished) {
        if (selectionBefore) engine.historyGpuStorage.release(selectionBefore.gpuSlice);
        if (selectionAfter) engine.historyGpuStorage.release(selectionAfter.gpuSlice);
      }
    }
    if (rollbackError) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Transform commit failed: ${operationMessage}; rollback failed: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterTransformSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
      engine.selectionOverlaySuppressed = false;
      engine.selectionOverlayOffsetX = 0;
      engine.selectionOverlayOffsetY = 0;
      renderPixelSelectionOverlay(engine);
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus("Raster transform applied: one Undo step.", "ok");
  return true;
}
