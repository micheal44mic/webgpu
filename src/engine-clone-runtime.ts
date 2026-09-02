import type { BrushEngine } from "./brush-engine";
import {
  cloneConservativeStampBounds,
  cloneHistoryBytesPerRow,
  cloneHistorySourceOffset,
  createCloneSourceTransform,
  cloneSourceLayout,
  cloneSourceTileIndicesForRect,
  cloneSourceTileRect,
  CLONE_SOURCE_INITIAL_ATLAS_LAYERS,
  CLONE_SOURCE_PAGE_TABLE_LENGTH,
  CLONE_SOURCE_UNIFORM_BYTES,
  growCloneAtlasLayerCapacity,
  type CloneSourceLayout,
  type CloneSourceTransform,
  type CloneStrokeConfiguration,
} from "./clone-gpu-core";
import type { CloneSampleMode } from "./clone-interaction-core";
import {
  cloneBrushShader,
  cloneTexturizedGrainShader,
  selectionCloneBrushShader,
  selectionCloneTexturizedGrainShader,
} from "./clone-shaders";
import { assertShaderCompiled } from "./engine-gpu-utils";
import type {
  CloneHistorySourcePayload,
  PaintHistoryRenderBatch,
} from "./engine-history-types";
import {
  allocateMergedSurface,
  foldClippingGroupIntoMergedSurface,
  foldRasterRecordIntoMergedSurface,
  layerCompositeVisualBounds,
  releaseLayerBlendFoldScratch,
  restoreEffectsWorkbenchToActiveLayer,
} from "./engine-layer-runtime";
import type { MergedSurfaceResources } from "./engine-layer-resources";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH, STAMP_STRIDE_BYTES } from "./engine-limits";
import type { DirtyRect, Stamp } from "./engine-stroke-types";
import type { BrushSettings, LayerFormat } from "./engine-types";
import { grainCoordinateMode, isTexturizedGrainActive } from "./engine-strategies";
import type { GpuHistorySlice } from "./gpu-history-storage";
import type { LayerRecord } from "./layer-stack";
import {
  alignedMergedSurfaceBounds,
  unionMergedSurfaceRects,
  type MergedSurfaceRect,
} from "./merged-surface-bounds";

export const CLONE_GPU_STRATEGY =
  "immutable-raster-only-virtual-source-tiles-gpu-history-replay-v1" as const;

interface ClonePipelineSet {
  readonly circle: GPURenderPipeline;
  readonly shape: GPURenderPipeline;
  readonly shapeOccupancy: GPURenderPipeline;
  readonly grainCircle: GPURenderPipeline;
  readonly grainShape: GPURenderPipeline;
  readonly grainShapeOccupancy: GPURenderPipeline;
}

interface CloneBindGroupLayouts {
  readonly brush: GPUBindGroupLayout;
  readonly brushOccupancy: GPUBindGroupLayout;
  readonly grain: GPUBindGroupLayout;
  readonly grainOccupancy: GPUBindGroupLayout;
}

export interface CloneRendererResources {
  readonly layouts: CloneBindGroupLayouts;
  readonly pipelines: ClonePipelineSet;
}

interface CloneVirtualSource {
  atlasTexture: GPUTexture;
  atlasView: GPUTextureView;
  atlasCapacity: number;
  readonly pageTableBuffer: GPUBuffer;
  readonly pageTableUpload: Uint32Array;
  readonly uniformBuffer: GPUBuffer;
  readonly tileLayers: Map<number, number>;
  readonly bindGroups: Map<string, GPUBindGroup>;
  revision: number;
}

export interface ActiveCloneStrokeSession extends CloneVirtualSource {
  readonly actionId: number;
  readonly layerId: number;
  readonly sampleMode: CloneSampleMode;
  readonly sourceLayerIds: readonly number[];
  readonly layout: CloneSourceLayout;
  readonly transform: CloneSourceTransform;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly settings: BrushSettings;
  readonly requestedTiles: Set<number>;
  readonly resolvedTiles: Set<number>;
  sourceSurface: MergedSurfaceResources | null;
  fault: Error | null;
  ending: boolean;
  canceled: boolean;
  destroyed: boolean;
}

export interface CloneReplaySource extends CloneVirtualSource {
  readonly layout: CloneSourceLayout;
  readonly transform: CloneSourceTransform;
  readonly offsetX: number;
  readonly offsetY: number;
  destroyed: boolean;
}

export interface CloneHistoryCapturePlan {
  readonly logicalBytes: number;
  readonly metadata: CloneHistorySourcePayload;
  encode(encoder: GPUCommandEncoder, slice: GpuHistorySlice): void;
}

type CloneEngineHost = BrushEngine & {
  cloneRendererResources: CloneRendererResources | null;
  cloneRendererPromise: Promise<CloneRendererResources> | null;
  activeCloneStrokeSession: ActiveCloneStrokeSession | null;
};

interface PreparedCloneSource {
  readonly key: string;
  readonly sampleMode: Exclude<CloneSampleMode, "current">;
  readonly sourceLayerIds: readonly number[];
  surface: MergedSurfaceResources | null;
}

interface PreparedCloneSourceState {
  ready: PreparedCloneSource | null;
  promise: Promise<void> | null;
  promiseKey: string | null;
  epoch: number;
}

export interface ClonePreviewTextureSource {
  readonly view: GPUTextureView | null;
  readonly bounds: DirtyRect;
}

const preparedCloneSources = new WeakMap<CloneEngineHost, PreparedCloneSourceState>();

const sourceOverBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

function layoutEntries(grain: boolean, occupancy: boolean): GPUBindGroupLayoutEntry[] {
  const entries: GPUBindGroupLayoutEntry[] = [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d-array" },
    },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
  ];
  if (occupancy) {
    entries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
  }
  if (grain) {
    entries.push(
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    );
  }
  entries.push(
    {
      binding: 8,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d-array" },
    },
    {
      binding: 9,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "read-only-storage" },
    },
    { binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
  );
  return entries;
}

async function createCloneRendererResources(engine: BrushEngine): Promise<CloneRendererResources> {
  const brushModule = engine.device.createShaderModule({
    label: "Clone brush fragment WGSL",
    code: cloneBrushShader,
  });
  const grainModule = engine.device.createShaderModule({
    label: "Clone grain fragment WGSL",
    code: cloneTexturizedGrainShader,
  });
  const selectedBrushModule = engine.device.createShaderModule({
    label: "Clone brush with Pixel Selection WGSL",
    code: selectionCloneBrushShader,
  });
  const selectedGrainModule = engine.device.createShaderModule({
    label: "Clone grain with Pixel Selection WGSL",
    code: selectionCloneTexturizedGrainShader,
  });
  await Promise.all([
    assertShaderCompiled(brushModule, "Clone brush"),
    assertShaderCompiled(grainModule, "Clone grain"),
    assertShaderCompiled(selectedBrushModule, "Clone brush with Pixel Selection"),
    assertShaderCompiled(selectedGrainModule, "Clone grain with Pixel Selection"),
  ]);

  const layouts: CloneBindGroupLayouts = {
    brush: engine.device.createBindGroupLayout({
      label: "Clone brush bind group layout",
      entries: layoutEntries(false, false),
    }),
    brushOccupancy: engine.device.createBindGroupLayout({
      label: "Clone brush occupancy bind group layout",
      entries: layoutEntries(false, true),
    }),
    grain: engine.device.createBindGroupLayout({
      label: "Clone grain bind group layout",
      entries: layoutEntries(true, false),
    }),
    grainOccupancy: engine.device.createBindGroupLayout({
      label: "Clone grain occupancy bind group layout",
      entries: layoutEntries(true, true),
    }),
  };
  const pipelineLayout = (layout: GPUBindGroupLayout, selected: boolean): GPUPipelineLayout =>
    engine.device.createPipelineLayout({
      label: selected ? "Clone selected pipeline layout" : "Clone pipeline layout",
      bindGroupLayouts: selected
        ? [layout, engine.selectionMaskBindGroupLayout]
        : [layout],
    });
  const createPipeline = (
    label: string,
    layout: GPUBindGroupLayout,
    fragmentModule: GPUShaderModule,
    vertexEntryPoint: "vertexMain" | "shapeVertexMain",
    fragmentEntryPoint:
      | "cloneFragmentMain"
      | "cloneShapeFragmentMain"
      | "cloneShapeOccupancyFragmentMain",
    selected = false,
  ): Promise<GPURenderPipeline> => engine.device.createRenderPipelineAsync({
    label,
    layout: pipelineLayout(layout, selected),
    vertex: { module: engine.brushShaderModule, entryPoint: vertexEntryPoint },
    fragment: {
      module: fragmentModule,
      entryPoint: fragmentEntryPoint,
      targets: [{ format: engine.layerFormat, blend: sourceOverBlend }],
    },
    primitive: { topology: "triangle-strip" },
  });

  const basePromises = [
    createPipeline("Clone circle", layouts.brush, brushModule, "vertexMain", "cloneFragmentMain"),
    createPipeline(
      "Clone Shape",
      layouts.brush,
      brushModule,
      "shapeVertexMain",
      "cloneShapeFragmentMain",
    ),
    createPipeline(
      "Clone Shape occupancy",
      layouts.brushOccupancy,
      brushModule,
      "shapeVertexMain",
      "cloneShapeOccupancyFragmentMain",
    ),
    createPipeline("Clone grain circle", layouts.grain, grainModule, "vertexMain", "cloneFragmentMain"),
    createPipeline(
      "Clone grain Shape",
      layouts.grain,
      grainModule,
      "shapeVertexMain",
      "cloneShapeFragmentMain",
    ),
    createPipeline(
      "Clone grain Shape occupancy",
      layouts.grainOccupancy,
      grainModule,
      "shapeVertexMain",
      "cloneShapeOccupancyFragmentMain",
    ),
  ] as const;
  const selectedPromises = [
    createPipeline(
      "Clone circle · Pixel Selection",
      layouts.brush,
      selectedBrushModule,
      "vertexMain",
      "cloneFragmentMain",
      true,
    ),
    createPipeline(
      "Clone Shape · Pixel Selection",
      layouts.brush,
      selectedBrushModule,
      "shapeVertexMain",
      "cloneShapeFragmentMain",
      true,
    ),
    createPipeline(
      "Clone Shape occupancy · Pixel Selection",
      layouts.brushOccupancy,
      selectedBrushModule,
      "shapeVertexMain",
      "cloneShapeOccupancyFragmentMain",
      true,
    ),
    createPipeline(
      "Clone grain circle · Pixel Selection",
      layouts.grain,
      selectedGrainModule,
      "vertexMain",
      "cloneFragmentMain",
      true,
    ),
    createPipeline(
      "Clone grain Shape · Pixel Selection",
      layouts.grain,
      selectedGrainModule,
      "shapeVertexMain",
      "cloneShapeFragmentMain",
      true,
    ),
    createPipeline(
      "Clone grain Shape occupancy · Pixel Selection",
      layouts.grainOccupancy,
      selectedGrainModule,
      "shapeVertexMain",
      "cloneShapeOccupancyFragmentMain",
      true,
    ),
  ] as const;
  const [base, selected] = await Promise.all([
    Promise.all(basePromises),
    Promise.all(selectedPromises),
  ]);
  const pipelines: ClonePipelineSet = {
    circle: base[0],
    shape: base[1],
    shapeOccupancy: base[2],
    grainCircle: base[3],
    grainShape: base[4],
    grainShapeOccupancy: base[5],
  };
  base.forEach((pipeline, index) => {
    engine.selectionPipelineByBase.set(pipeline, selected[index]);
  });
  return { layouts, pipelines };
}

export async function warmClonePipelines(engine: CloneEngineHost): Promise<void> {
  if (engine.cloneRendererResources) return;
  if (!engine.cloneRendererPromise) {
    engine.cloneRendererPromise = createCloneRendererResources(engine).then((resources) => {
      engine.cloneRendererResources = resources;
      return resources;
    }).finally(() => {
      engine.cloneRendererPromise = null;
    });
  }
  await engine.cloneRendererPromise;
}

function createAtlasTexture(
  engine: BrushEngine,
  layout: Readonly<CloneSourceLayout>,
  capacity: number,
  label: string,
): GPUTexture {
  return engine.device.createTexture({
    label,
    size: {
      width: layout.tileWidth,
      height: layout.tileHeight,
      depthOrArrayLayers: capacity,
    },
    format: engine.layerFormat,
    usage:
      GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });
}

function createVirtualSource(
  engine: BrushEngine,
  layout: Readonly<CloneSourceLayout>,
  transform: Readonly<CloneSourceTransform>,
  capacity: number,
  label: string,
  quantizationSeed: number,
): CloneVirtualSource {
  const atlasTexture = createAtlasTexture(engine, layout, capacity, `${label} atlas`);
  const pageTableBuffer = engine.device.createBuffer({
    label: `${label} page table`,
    size: CLONE_SOURCE_PAGE_TABLE_LENGTH * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const uniformBuffer = engine.device.createBuffer({
    label: `${label} uniforms`,
    size: CLONE_SOURCE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformUpload = new ArrayBuffer(CLONE_SOURCE_UNIFORM_BYTES);
  const uniformF32 = new Float32Array(uniformUpload);
  const uniformU32 = new Uint32Array(uniformUpload);
  uniformF32[0] = transform.sourceX;
  uniformF32[1] = transform.sourceY;
  uniformF32[2] = transform.destinationX;
  uniformF32[3] = transform.destinationY;
  uniformF32[4] = transform.rotationCos;
  uniformF32[5] = transform.rotationSin;
  uniformF32[6] = layout.documentWidth;
  uniformF32[7] = layout.documentHeight;
  uniformU32[8] = layout.tileWidth;
  uniformU32[9] = layout.tileHeight;
  uniformU32[10] = layout.gridSize;
  uniformU32[12] = engine.layerFormat === "rgba8unorm"
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
    ? 1
    : 0;
  uniformU32[13] = quantizationSeed >>> 0;
  engine.device.queue.writeBuffer(uniformBuffer, 0, uniformUpload);
  const pageTableUpload = new Uint32Array(CLONE_SOURCE_PAGE_TABLE_LENGTH);
  engine.device.queue.writeBuffer(pageTableBuffer, 0, pageTableUpload);
  return {
    atlasTexture,
    atlasView: atlasTexture.createView({ dimension: "2d-array" }),
    atlasCapacity: capacity,
    pageTableBuffer,
    pageTableUpload,
    uniformBuffer,
    tileLayers: new Map(),
    bindGroups: new Map(),
    revision: 1,
  };
}

function destroyVirtualSource(source: CloneVirtualSource): void {
  source.bindGroups.clear();
  source.atlasTexture.destroy();
  source.pageTableBuffer.destroy();
  source.uniformBuffer.destroy();
}

function preparedCloneSourceState(engine: CloneEngineHost): PreparedCloneSourceState {
  let state = preparedCloneSources.get(engine);
  if (!state) {
    state = { ready: null, promise: null, promiseKey: null, epoch: 0 };
    preparedCloneSources.set(engine, state);
  }
  return state;
}

function recordHasCloneContent(engine: BrushEngine, record: LayerRecord): boolean {
  return record.id === engine.layerStack.active.id
    ? engine.layerHasContent
    : record.hasContent;
}

function recordContributesToClone(engine: BrushEngine, record: LayerRecord): boolean {
  return record.visible && record.opacity > 0 && recordHasCloneContent(engine, record);
}

function sourceLayerIds(
  engine: BrushEngine,
  sampleMode: CloneSampleMode,
): number[] {
  if (sampleMode === "current") return [engine.layerStack.active.id];
  const end = sampleMode === "current-and-below"
    ? engine.layerStack.activeIndex + 1
    : engine.layerStack.layers.length;
  return engine.layerStack.layers.slice(0, end).map((record) => record.id);
}

function sourceRecords(
  engine: BrushEngine,
  sampleMode: CloneSampleMode,
): LayerRecord[] {
  return sourceLayerIds(engine, sampleMode)
    .map((id) => engine.layerStack.byId(id))
    .filter((record): record is LayerRecord => record !== null);
}

function cloneRecordVisualBounds(engine: BrushEngine, record: LayerRecord): DirtyRect {
  if (record.id !== engine.layerStack.active.id) {
    return layerCompositeVisualBounds(engine, record);
  }
  return layerCompositeVisualBounds(engine, {
    ...record,
    contentBounds: engine.layerContentBounds ? { ...engine.layerContentBounds } : null,
  });
}

function cloneSourceSnapshotKey(
  engine: CloneEngineHost,
  sampleMode: Exclude<CloneSampleMode, "current">,
): string {
  return JSON.stringify([
    sampleMode,
    engine.historyCursor,
    engine.nextHistoryActionId,
    engine.layerStack.active.id,
    sourceRecords(engine, sampleMode).map((record) => [
      record.id,
      record.visible,
      record.opacity,
      record.contentOpacity,
      record.blendMode,
      record.cutoutMode,
      record.clippingParentId,
      recordHasCloneContent(engine, record),
      record.id === engine.layerStack.active.id
        ? engine.layerContentBounds
        : record.contentBounds,
    ]),
  ]);
}

function destroyPreparedCloneSource(
  engine: CloneEngineHost,
  prepared: PreparedCloneSource | null,
): void {
  if (!prepared) return;
  engine.destroyMergedSurface(prepared.surface);
  prepared.surface = null;
}

async function buildPreparedCloneSource(
  engine: CloneEngineHost,
  sampleMode: Exclude<CloneSampleMode, "current">,
  key: string,
): Promise<PreparedCloneSource> {
  const selectedIds = new Set(sourceLayerIds(engine, sampleMode));
  const records = sourceRecords(engine, sampleMode);
  const visibleRecords = records.filter((record) => recordContributesToClone(engine, record));
  const contentBounds = unionMergedSurfaceRects(
    visibleRecords.map(
      (record) => cloneRecordVisualBounds(engine, record) as MergedSurfaceRect,
    ),
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!contentBounds) {
    return {
      key,
      sampleMode,
      sourceLayerIds: [...selectedIds],
      surface: null,
    };
  }
  const allocationBounds = alignedMergedSurfaceBounds(
    contentBounds,
    DOCUMENT_WIDTH,
    64,
    64,
    DOCUMENT_HEIGHT,
  );
  let surface: MergedSurfaceResources | null = allocateMergedSurface(
    engine,
    engine.layerFormat,
    "below",
    visibleRecords.length,
    allocationBounds,
    1,
    false,
  );
  try {
    try {
      let first = true;
      const folded = new Set<number>();
      for (const record of visibleRecords) {
        if (folded.has(record.id)) continue;
        const completeUnit = engine.layerStack.clippingUnit(record.id);
        const parent = completeUnit[0];
        if (
          record.clippingParentId !== null
          && (!selectedIds.has(parent.id) || !recordContributesToClone(engine, parent))
        ) {
          folded.add(record.id);
          continue;
        }
        const unit = completeUnit.filter(
          (member) => selectedIds.has(member.id) && recordContributesToClone(engine, member),
        );
        if (unit.length === 0 || unit[0].clippingParentId !== null) {
          folded.add(record.id);
          continue;
        }
        const didFold: boolean = unit.length > 1
          ? await foldClippingGroupIntoMergedSurface(
            engine,
            surface,
            unit,
            "below",
            "clone-source",
            first,
          )
          : await foldRasterRecordIntoMergedSurface(
            engine,
            surface,
            unit[0],
            "below",
            "clone-source",
            first,
          );
        unit.forEach((member) => folded.add(member.id));
        first = first && !didFold;
      }
      if (first) {
        engine.destroyMergedSurface(surface);
        surface = null;
      } else {
        releaseLayerBlendFoldScratch(surface);
      }
    } finally {
      await restoreEffectsWorkbenchToActiveLayer(
        engine,
        "clone-source",
        false,
        "content-bounds",
      );
    }
    return {
      key,
      sampleMode,
      sourceLayerIds: [...selectedIds],
      surface,
    };
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  }
}

export function isPreparedCloneSourceReady(
  engine: CloneEngineHost,
  sampleMode: CloneSampleMode,
): boolean {
  if (sampleMode === "current") return true;
  const state = preparedCloneSourceState(engine);
  const key = cloneSourceSnapshotKey(engine, sampleMode);
  if (state.ready?.key === key) return true;
  destroyPreparedCloneSource(engine, state.ready);
  state.ready = null;
  return false;
}

/** Read-only view used by the transient first-sample preview; it never consumes the snapshot. */
export function clonePreviewTextureSource(
  engine: CloneEngineHost,
  sampleMode: CloneSampleMode,
): ClonePreviewTextureSource | null {
  if (sampleMode === "current") {
    const activeRecord = engine.layerStack.active;
    const contributes = activeRecord.visible
      && activeRecord.opacity > 0
      && engine.layerHasContent;
    return {
      view: contributes ? engine.layerSamplingView : null,
      bounds: {
        x: 0,
        y: 0,
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
      },
    };
  }
  const state = preparedCloneSourceState(engine);
  const key = cloneSourceSnapshotKey(engine, sampleMode);
  const prepared = state.ready;
  if (!prepared || prepared.key !== key) return null;
  return prepared.surface
    ? {
      view: prepared.surface.samplingView,
      bounds: { ...prepared.surface.bounds },
    }
    : {
      view: null,
      bounds: {
        x: 0,
        y: 0,
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
      },
    };
}

export function isPreparedCloneSourcePending(
  engine: CloneEngineHost,
  sampleMode: CloneSampleMode,
): boolean {
  if (sampleMode === "current") return false;
  const state = preparedCloneSourceState(engine);
  return state.promise !== null || !isPreparedCloneSourceReady(engine, sampleMode);
}

export async function prepareCloneSourceSnapshot(
  engine: CloneEngineHost,
  sampleMode: CloneSampleMode,
): Promise<void> {
  const state = preparedCloneSourceState(engine);
  if (sampleMode === "current") {
    state.epoch += 1;
    destroyPreparedCloneSource(engine, state.ready);
    state.ready = null;
    return;
  }
  const key = cloneSourceSnapshotKey(engine, sampleMode);
  if (state.ready?.key === key) return;
  if (state.promise) {
    await state.promise;
    if (isPreparedCloneSourceReady(engine, sampleMode)) return;
    return prepareCloneSourceSnapshot(engine, sampleMode);
  }
  destroyPreparedCloneSource(engine, state.ready);
  state.ready = null;
  const epoch = state.epoch + 1;
  state.epoch = epoch;
  state.promiseKey = key;
  const promise = (async () => {
    const prepared = await buildPreparedCloneSource(engine, sampleMode, key);
    if (
      state.epoch !== epoch
      || cloneSourceSnapshotKey(engine, sampleMode) !== key
    ) {
      destroyPreparedCloneSource(engine, prepared);
      return;
    }
    state.ready = prepared;
  })();
  state.promise = promise;
  try {
    await promise;
  } finally {
    if (state.promise === promise) {
      state.promise = null;
      state.promiseKey = null;
    }
  }
  if (!isPreparedCloneSourceReady(engine, sampleMode)) {
    await prepareCloneSourceSnapshot(engine, sampleMode);
  }
}

export function releasePreparedCloneSource(engine: CloneEngineHost): void {
  const state = preparedCloneSourceState(engine);
  state.epoch += 1;
  destroyPreparedCloneSource(engine, state.ready);
  state.ready = null;
}

/**
 * Invalidates document-scoped Clone preparation and waits until an already
 * running snapshot builder has stopped touching the outgoing layer resources.
 * Pipeline objects remain owned by the engine and are intentionally preserved.
 */
export async function releasePreparedCloneSourceAndWait(
  engine: CloneEngineHost,
): Promise<void> {
  const state = preparedCloneSourceState(engine);
  releasePreparedCloneSource(engine);
  const inFlight = state.promise;
  if (inFlight) {
    await inFlight;
  }
  if (state.promise === inFlight) {
    state.promise = null;
    state.promiseKey = null;
  }
  destroyPreparedCloneSource(engine, state.ready);
  state.ready = null;
}

function takePreparedCloneSource(
  engine: CloneEngineHost,
  sampleMode: Exclude<CloneSampleMode, "current">,
): PreparedCloneSource {
  const state = preparedCloneSourceState(engine);
  const key = cloneSourceSnapshotKey(engine, sampleMode);
  const prepared = state.ready;
  if (!prepared || prepared.key !== key) {
    throw new Error("The raster source is not ready yet.");
  }
  state.ready = null;
  return prepared;
}

export function createActiveCloneStrokeSession(
  engine: CloneEngineHost,
  actionId: number,
  settings: BrushSettings,
  configuration: Readonly<CloneStrokeConfiguration>,
): ActiveCloneStrokeSession {
  if (!engine.cloneRendererResources) {
    throw new Error("Clone pipelines are not ready.");
  }
  const layout = cloneSourceLayout(DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
  const transform = createCloneSourceTransform(configuration);
  const offsetX = transform.sourceX - transform.destinationX;
  const offsetY = transform.sourceY - transform.destinationY;
  const prepared = configuration.sampleMode === "current"
    ? null
    : takePreparedCloneSource(engine, configuration.sampleMode);
  const source = createVirtualSource(
    engine,
    layout,
    transform,
    CLONE_SOURCE_INITIAL_ATLAS_LAYERS,
    `Clone action ${actionId}`,
    actionId,
  );
  return {
    ...source,
    actionId,
    layerId: engine.layerStack.active.id,
    sampleMode: configuration.sampleMode,
    sourceLayerIds: prepared?.sourceLayerIds ?? sourceLayerIds(engine, configuration.sampleMode),
    layout,
    transform,
    offsetX,
    offsetY,
    settings: { ...settings },
    requestedTiles: new Set(),
    resolvedTiles: new Set(),
    sourceSurface: prepared?.surface ?? null,
    fault: null,
    ending: false,
    canceled: false,
    destroyed: false,
  };
}

export function destroyActiveCloneStrokeSession(
  engine: CloneEngineHost,
  session: ActiveCloneStrokeSession | null = engine.activeCloneStrokeSession,
): void {
  if (!session || session.destroyed) return;
  session.destroyed = true;
  session.canceled = true;
  session.requestedTiles.clear();
  session.resolvedTiles.clear();
  engine.destroyMergedSurface(session.sourceSurface);
  session.sourceSurface = null;
  destroyVirtualSource(session);
  if (engine.activeCloneStrokeSession === session) {
    engine.activeCloneStrokeSession = null;
  }
}

function sourceBoundsForSession(
  engine: BrushEngine,
  session: ActiveCloneStrokeSession,
): DirtyRect | null {
  if (session.sampleMode !== "current") return session.sourceSurface?.bounds ?? null;
  const activeRecord = engine.layerStack.byId(session.layerId);
  if (
    !activeRecord
    || !activeRecord.visible
    || activeRecord.opacity <= 0
    || !engine.layerHasContent
  ) {
    return null;
  }
  return engine.layerContentBounds ?? {
    x: 0,
    y: 0,
    width: session.layout.documentWidth,
    height: session.layout.documentHeight,
  };
}

function sourceIntersectionForTile(
  engine: BrushEngine,
  session: ActiveCloneStrokeSession,
  tileIndex: number,
): DirtyRect | null {
  const tile = cloneSourceTileRect(session.layout, tileIndex);
  const bounds = sourceBoundsForSession(engine, session);
  if (!bounds || tile.width <= 0 || tile.height <= 0) return null;
  const left = Math.max(tile.x, bounds.x);
  const top = Math.max(tile.y, bounds.y);
  const right = Math.min(tile.x + tile.width, bounds.x + bounds.width);
  const bottom = Math.min(tile.y + tile.height, bounds.y + bounds.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

function encodeSourceTileCopy(
  engine: BrushEngine,
  encoder: GPUCommandEncoder,
  session: ActiveCloneStrokeSession,
  targetAtlas: GPUTexture,
  tileIndex: number,
  atlasLayer: number,
  intersection: Readonly<DirtyRect>,
): void {
  const tile = cloneSourceTileRect(session.layout, tileIndex);
  const sourceBounds = sourceBoundsForSession(engine, session);
  if (!sourceBounds) throw new Error("A resolved Clone tile lost its raster source.");
  const sourceTexture = session.sampleMode === "current"
    ? engine.layerTexture
    : session.sourceSurface?.texture;
  if (!sourceTexture) throw new Error("The prepared Clone raster source is unavailable.");
  encoder.copyTextureToTexture(
    {
      texture: sourceTexture,
      origin: {
        x: session.sampleMode === "current" ? intersection.x : intersection.x - sourceBounds.x,
        y: session.sampleMode === "current" ? intersection.y : intersection.y - sourceBounds.y,
        z: 0,
      },
    },
    {
      texture: targetAtlas,
      origin: {
        x: intersection.x - tile.x,
        y: intersection.y - tile.y,
        z: atlasLayer,
      },
    },
    { width: intersection.width, height: intersection.height, depthOrArrayLayers: 1 },
  );
}

function retireAtlasTexture(engine: BrushEngine, texture: GPUTexture): void {
  void engine.device.queue.onSubmittedWorkDone().then(
    () => texture.destroy(),
    () => texture.destroy(),
  );
}

function submitRequestedCloneTiles(
  engine: CloneEngineHost,
  session: ActiveCloneStrokeSession,
): void {
  const missing = [...session.requestedTiles].filter(
    (tileIndex) => !session.resolvedTiles.has(tileIndex),
  );
  if (missing.length === 0 || session.canceled || session.destroyed) return;
  const resident = missing.flatMap((tileIndex) => {
    const intersection = sourceIntersectionForTile(engine, session, tileIndex);
    return intersection ? [{ tileIndex, intersection }] : [];
  });
  const requiredCapacity = session.tileLayers.size + resident.length;
  let targetAtlas = session.atlasTexture;
  let targetView = session.atlasView;
  let targetCapacity = session.atlasCapacity;
  let previousAtlas: GPUTexture | null = null;
  const encoder = resident.length > 0
    ? engine.device.createCommandEncoder({ label: "Resolve Clone source pages" })
    : null;
  if (encoder && requiredCapacity > session.atlasCapacity) {
    targetCapacity = growCloneAtlasLayerCapacity(session.atlasCapacity, requiredCapacity);
    targetAtlas = createAtlasTexture(
      engine,
      session.layout,
      targetCapacity,
      `Clone action ${session.actionId} atlas ${targetCapacity}`,
    );
    targetView = targetAtlas.createView({ dimension: "2d-array" });
    previousAtlas = session.atlasTexture;
    for (const atlasLayer of session.tileLayers.values()) {
      encoder.copyTextureToTexture(
        { texture: session.atlasTexture, origin: { x: 0, y: 0, z: atlasLayer } },
        { texture: targetAtlas, origin: { x: 0, y: 0, z: atlasLayer } },
        {
          width: session.layout.tileWidth,
          height: session.layout.tileHeight,
          depthOrArrayLayers: 1,
        },
      );
    }
  }
  const additions: Array<{ tileIndex: number; atlasLayer: number }> = [];
  try {
    resident.forEach(({ tileIndex, intersection }, index) => {
      const atlasLayer = session.tileLayers.size + index;
      encodeSourceTileCopy(
        engine,
        encoder!,
        session,
        targetAtlas,
        tileIndex,
        atlasLayer,
        intersection,
      );
      additions.push({ tileIndex, atlasLayer });
    });
    if (encoder) engine.device.queue.submit([encoder.finish()]);
  } catch (error) {
    if (previousAtlas) targetAtlas.destroy();
    throw error;
  }
  if (previousAtlas) {
    session.atlasTexture = targetAtlas;
    session.atlasView = targetView;
    session.atlasCapacity = targetCapacity;
    session.revision += 1;
    session.bindGroups.clear();
    retireAtlasTexture(engine, previousAtlas);
  }
  additions.forEach(({ tileIndex, atlasLayer }) => {
    session.tileLayers.set(tileIndex, atlasLayer);
    session.pageTableUpload[tileIndex] = atlasLayer + 1;
  });
  missing.forEach((tileIndex) => session.resolvedTiles.add(tileIndex));
  if (additions.length > 0) {
    engine.device.queue.writeBuffer(
      session.pageTableBuffer,
      0,
      session.pageTableUpload,
    );
  }
  engine.displayDirty = true;
  engine.requestRender();
}

export function requestCloneSourceForRect(
  engine: CloneEngineHost,
  destinationRect: Readonly<DirtyRect> | null,
): boolean {
  const session = engine.activeCloneStrokeSession;
  if (!session || session.destroyed || session.canceled || session.fault) return false;
  const tileIndices = cloneSourceTileIndicesForRect(
    session.layout,
    destinationRect,
    session.transform,
    1,
  );
  tileIndices.forEach((tileIndex) => session.requestedTiles.add(tileIndex));
  try {
    submitRequestedCloneTiles(engine, session);
  } catch (error) {
    session.fault = error instanceof Error ? error : new Error(String(error));
    engine.callbacks.onStatus?.(`Clone source preparation failed: ${session.fault.message}`, "error");
    return false;
  }
  return tileIndices.every((tileIndex) => session.resolvedTiles.has(tileIndex));
}

export async function ensureCloneSourceForStamps(
  engine: CloneEngineHost,
  stamps: readonly Stamp[],
  settings: BrushSettings,
): Promise<void> {
  const session = engine.activeCloneStrokeSession;
  if (!session || session.destroyed || session.canceled) {
    throw new Error("Clone session is unavailable.");
  }
  const bounds = cloneConservativeStampBounds(stamps, settings);
  requestCloneSourceForRect(engine, bounds);
  if (session.fault) throw session.fault;
  const required = cloneSourceTileIndicesForRect(
    session.layout,
    bounds,
    session.transform,
    1,
  );
  if (!required.every((tileIndex) => session.resolvedTiles.has(tileIndex))) {
    throw new Error("Clone source pages did not resolve.");
  }
}

function cloneLayoutFor(
  renderer: CloneRendererResources,
  grain: boolean,
  occupancy: boolean,
): GPUBindGroupLayout {
  if (grain) return occupancy ? renderer.layouts.grainOccupancy : renderer.layouts.grain;
  return occupancy ? renderer.layouts.brushOccupancy : renderer.layouts.brush;
}

function clonePipelineFor(
  renderer: CloneRendererResources,
  grain: boolean,
  shape: boolean,
  occupancy: boolean,
): GPURenderPipeline {
  if (grain) {
    if (occupancy) return renderer.pipelines.grainShapeOccupancy;
    return shape ? renderer.pipelines.grainShape : renderer.pipelines.grainCircle;
  }
  if (occupancy) return renderer.pipelines.shapeOccupancy;
  return shape ? renderer.pipelines.shape : renderer.pipelines.circle;
}

export function clonePipelineAndBindGroup(
  engine: CloneEngineHost,
  source: CloneVirtualSource,
  settings: BrushSettings,
  preview: boolean,
  shapeOccupancyMip: number | null,
): { readonly pipeline: GPURenderPipeline; readonly bindGroup: GPUBindGroup } {
  const renderer = engine.cloneRendererResources;
  if (!renderer) throw new Error("Clone renderer is unavailable.");
  const grain = isTexturizedGrainActive(settings);
  const shape = settings.shape === "shape";
  const occupancy = shape && shapeOccupancyMip !== null;
  const mode = grain ? grainCoordinateMode(settings) : "fixed";
  const key = [
    source.revision,
    preview ? "preview" : "layer",
    grain ? `${mode}:${settings.grainFiltering}` : "plain",
    occupancy ? shapeOccupancyMip : shape ? "shape" : "circle",
    engine.shapeResourceRevision,
    engine.grainResourceRevision,
  ].join(":");
  let bindGroup = source.bindGroups.get(key);
  if (!bindGroup) {
    const entries: GPUBindGroupEntry[] = [
      {
        binding: 0,
        resource: { buffer: preview ? engine.thicknessTailBrushUniformBuffer : engine.brushUniformBuffer },
      },
      {
        binding: 1,
        resource: { buffer: preview ? engine.thicknessTailInstanceBuffer : engine.instanceBuffer },
      },
      { binding: 2, resource: engine.shapeMaskView },
      { binding: 3, resource: engine.shapeMaskSampler },
    ];
    if (occupancy) {
      entries.push({
        binding: 4,
        resource: { buffer: engine.shapeOccupancyUniformBuffers[shapeOccupancyMip!] },
      });
    }
    if (grain) {
      entries.push(
        { binding: 5, resource: engine.grainTextureView },
        { binding: 6, resource: engine.grainSamplers[mode][settings.grainFiltering] },
        { binding: 7, resource: { buffer: engine.grainUniformBuffer } },
      );
    }
    entries.push(
      { binding: 8, resource: source.atlasView },
      { binding: 9, resource: { buffer: source.pageTableBuffer } },
      { binding: 10, resource: { buffer: source.uniformBuffer } },
    );
    bindGroup = engine.device.createBindGroup({
      label: preview ? "Clone preview bind group" : "Clone layer bind group",
      layout: cloneLayoutFor(renderer, grain, occupancy),
      entries,
    });
    source.bindGroups.set(key, bindGroup);
  }
  return {
    pipeline: clonePipelineFor(renderer, grain, shape, occupancy),
    bindGroup,
  };
}

export function planCloneHistoryCapture(
  engine: CloneEngineHost,
  session: ActiveCloneStrokeSession,
  stamps: readonly Stamp[],
): CloneHistoryCapturePlan {
  const stampBytes = stamps.length * STAMP_STRIDE_BYTES;
  const bounds = cloneConservativeStampBounds(stamps, session.settings);
  const requiredTileIndices = cloneSourceTileIndicesForRect(
    session.layout,
    bounds,
    session.transform,
    1,
  );
  for (const tileIndex of requiredTileIndices) {
    if (!session.resolvedTiles.has(tileIndex)) {
      throw new Error(`Clone source page ${tileIndex} is unresolved during History capture.`);
    }
  }
  const tileIndices = requiredTileIndices.filter((tileIndex) => session.tileLayers.has(tileIndex));
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const bytesPerRow = cloneHistoryBytesPerRow(session.layout.tileWidth, bytesPerPixel);
  const rowsPerImage = session.layout.tileHeight;
  const tileStrideBytes = bytesPerRow * rowsPerImage;
  const sourceByteOffset = cloneHistorySourceOffset(stampBytes);
  const metadata: CloneHistorySourcePayload = {
    offsetX: session.offsetX,
    offsetY: session.offsetY,
    sourceX: session.transform.sourceX,
    sourceY: session.transform.sourceY,
    destinationX: session.transform.destinationX,
    destinationY: session.transform.destinationY,
    rotationCos: session.transform.rotationCos,
    rotationSin: session.transform.rotationSin,
    angleDegrees: session.transform.angleDegrees,
    tileIndices,
    stampBytes,
    sourceByteOffset,
    bytesPerRow,
    rowsPerImage,
    tileStrideBytes,
    tileWidth: session.layout.tileWidth,
    tileHeight: session.layout.tileHeight,
    documentWidth: session.layout.documentWidth,
    documentHeight: session.layout.documentHeight,
  };
  return {
    logicalBytes: sourceByteOffset + tileStrideBytes * tileIndices.length,
    metadata,
    encode(encoder, slice) {
      tileIndices.forEach((tileIndex, index) => {
        encoder.copyTextureToBuffer(
          {
            texture: session.atlasTexture,
            origin: { x: 0, y: 0, z: session.tileLayers.get(tileIndex)! },
          },
          {
            buffer: slice.buffer,
            offset: slice.offsetBytes + sourceByteOffset + index * tileStrideBytes,
            bytesPerRow,
            rowsPerImage,
          },
          {
            width: session.layout.tileWidth,
            height: session.layout.tileHeight,
            depthOrArrayLayers: 1,
          },
        );
      });
    },
  };
}

export function encodeCloneReplaySource(
  engine: CloneEngineHost,
  encoder: GPUCommandEncoder,
  replayBatch: PaintHistoryRenderBatch,
): CloneReplaySource | null {
  const metadata = replayBatch.cloneSource;
  if (!metadata) return null;
  const layout = cloneSourceLayout(metadata.documentWidth, metadata.documentHeight);
  if (layout.tileWidth !== metadata.tileWidth || layout.tileHeight !== metadata.tileHeight) {
    throw new Error("Clone History tile geometry does not match the document.");
  }
  const capacity = growCloneAtlasLayerCapacity(0, metadata.tileIndices.length);
  const transform: CloneSourceTransform = {
    sourceX: metadata.sourceX,
    sourceY: metadata.sourceY,
    destinationX: metadata.destinationX,
    destinationY: metadata.destinationY,
    rotationCos: metadata.rotationCos,
    rotationSin: metadata.rotationSin,
    angleDegrees: metadata.angleDegrees,
  };
  const source = createVirtualSource(
    engine,
    layout,
    transform,
    capacity,
    `Clone replay action ${replayBatch.actionId}`,
    replayBatch.actionId,
  );
  const replaySource: CloneReplaySource = {
    ...source,
    layout,
    transform,
    offsetX: metadata.offsetX,
    offsetY: metadata.offsetY,
    destroyed: false,
  };
  metadata.tileIndices.forEach((tileIndex, layer) => {
    replaySource.tileLayers.set(tileIndex, layer);
    replaySource.pageTableUpload[tileIndex] = layer + 1;
    encoder.copyBufferToTexture(
      {
        buffer: replayBatch.gpuSlice.buffer,
        offset:
          replayBatch.gpuSlice.offsetBytes
          + metadata.sourceByteOffset
          + layer * metadata.tileStrideBytes,
        bytesPerRow: metadata.bytesPerRow,
        rowsPerImage: metadata.rowsPerImage,
      },
      { texture: replaySource.atlasTexture, origin: { x: 0, y: 0, z: layer } },
      {
        width: metadata.tileWidth,
        height: metadata.tileHeight,
        depthOrArrayLayers: 1,
      },
    );
  });
  engine.device.queue.writeBuffer(
    replaySource.pageTableBuffer,
    0,
    replaySource.pageTableUpload,
  );
  return replaySource;
}

export function retireCloneReplaySource(
  engine: BrushEngine,
  source: CloneReplaySource | null,
): void {
  if (!source || source.destroyed) return;
  source.destroyed = true;
  void engine.device.queue.onSubmittedWorkDone().then(() => {
    destroyVirtualSource(source);
  }, () => {
    destroyVirtualSource(source);
  });
}

export function cloneSettingsForCurrentBrush(settings: BrushSettings): BrushSettings {
  return {
    ...settings,
    tool: "paint",
    blendMode: "normal",
  };
}

export function cloneSessionMatchesAction(
  session: ActiveCloneStrokeSession | null,
  actionId: number | undefined,
): session is ActiveCloneStrokeSession {
  return Boolean(session && !session.destroyed && actionId === session.actionId);
}

export function cloneFormatBytesPerPixel(format: LayerFormat): 4 | 8 {
  return format === "rgba16float" ? 8 : 4;
}
