import type { BrushEngine } from "./brush-engine";
import {
  cloneLayerColdStorageResources,
  createColdLayerGpuResources,
  createLayerColdStorageCandidate,
  coldStorageMaskForRecord,
  destroyLayerColdStorage,
  destroyTransientLayerHydration,
  ensureActiveLayerHot,
  restoreColdStorageResources,
} from "./engine-cold-storage";
import type {
  LayerMergeHistoryAction,
  LayerMergeHistoryInput,
  DeletedLayerEntry,
} from "./engine-history-types";
import type {
  LayerGpuResources,
  MergedSurfaceResources,
} from "./engine-layer-resources";
import {
  allocateLayerGpuResources,
  allocateMergedSurface,
  buildClippingPrefixSurface,
  destroyLayerGpuResources,
  foldClippingGroupIntoMergedSurface,
  foldRasterRecordIntoMergedSurface,
  foldViewIntoMergedSurface,
  layerCompositeVisualBounds,
  materializeLayerCompositeSource,
  releaseLayerBlendFoldScratch,
  restoreEffectsWorkbenchToActiveLayer,
  type LayerFoldSceneDomain,
} from "./engine-layer-runtime";
import {
  detachLayer,
  restoreReferenceLayerId,
} from "./engine-layer-structure-runtime";
import {
  hydrateLayerFromSeed,
  switchActiveForStructuralHistory,
} from "./engine-raster-image-runtime";
import {
  clearVectorTextPresentationForTransaction,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";
import {
  renderVectorDrawsToTexture,
  vectorRasterChunkDimensions,
} from "./engine-vector-raster-runtime";
import { mergeDirtyRects } from "./engine-geometry";
import type { DirtyRect } from "./engine-stroke-types";
import {
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_WIDTH,
  countLayerStorageTiles,
  markLayerStorageRect,
} from "./layer-storage-study";
import {
  alignedMergedSurfaceBounds,
  intersectMergedSurfaceRects,
  mergedSurfacePhysicalRect,
  mergedSurfaceMemoryBytes,
  unionMergedSurfaceRects,
} from "./merged-surface-bounds";
import type {
  MixedSceneItem,
  MixedSceneVectorHistoryState,
} from "./mixed-scene-stack";
import {
  type MergeMixedSceneItemsRequest,
  type LayerMergeRenderRun,
  layerMergeRenderRuns,
  planMixedSceneLayerMerge,
} from "./layer-merge-core";
import { vectorTextGpuRunBounds } from "./engine-geometry";
import type { VectorTextViewState } from "./vector-text-types";
import type { LayerFormat } from "./engine-types";
import {
  borrowLayerMergeColdSeed,
  layerMergeColdSeedIsLiveAuthority,
  restoreBorrowedLayerMergeColdSeedAfterDetachFailure,
  transferBorrowedLayerMergeColdSeedForDetach,
} from "./layer-merge-seed-ownership";
import type { MemoryReservation, MemoryRequest } from "./memory-governor-core";
import { cloneLayerTonalBlend } from "./layer-composition.ts";
import { planLayerMergeCreateMemory } from "./layer-memory-admission-core";
import { isHistoryColdSeedHandle } from "./history-cold-seed";
import {
  documentBackgroundEncodedSrgbPremultiplied,
  documentBackgroundLinearPremultiplied,
} from "./document-background";
import { rgba8SpatialQuantizationShader } from "./rgba8-spatial-quantization";
import { LAYER_BLEND_FOLD_TILE_EXTENT } from "./layer-blend-fold-shader";
import { VECTOR_TEXT_GPU_SAMPLE_COUNT } from "./vector-text-gpu-shader";

export interface LayerMergeResult {
  readonly layerId: number;
  readonly itemCount: number;
  readonly rasterInputCount: number;
  readonly vectorInputCount: number;
  readonly tileCount: number;
  readonly preservesParentPresentation: boolean;
}

export interface PreparedLayerMerge {
  readonly action: LayerMergeHistoryAction;
  readonly result: LayerMergeResult;
}

interface MergeBackdropSeedResources {
  readonly pipeline: GPURenderPipeline;
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
}

const mergeBackdropSeedPipelines = new WeakMap<
  GPUDevice,
  Map<LayerFormat, GPURenderPipeline>
>();

const MERGE_BACKDROP_SEED_WGSL = /* wgsl */ `
struct BackdropUniforms {
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> backdrop: BackdropUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return backdrop.color;
}
`;

const mergeWorkingFinalizePipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const MERGE_WORKING_FINALIZE_WGSL = /* wgsl */ `
${rgba8SpatialQuantizationShader}

struct FinalizeUniforms {
  documentOrigin: vec2<u32>,
  actionSeed: u32,
  _pad0: u32,
};

@group(0) @binding(0) var workingTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> finalize: FinalizeUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  let documentCoordinate = vec2<u32>(fragmentPosition.xy);
  let local = vec2<i32>(documentCoordinate) - vec2<i32>(finalize.documentOrigin);
  let encodedPremultiplied = textureLoad(workingTexture, local, 0);
  return quantizeRgba8SpatialAdjacent(
    encodedPremultiplied,
    documentCoordinate,
    finalize.actionSeed,
  );
}
`;

function mergeWorkingFinalizePipeline(engine: BrushEngine): GPURenderPipeline {
  const existing = mergeWorkingFinalizePipelines.get(engine.device);
  if (existing) return existing;
  const module = engine.device.createShaderModule({
    label: "Layer merge cropped working finalizer WGSL",
    code: MERGE_WORKING_FINALIZE_WGSL,
  });
  const pipeline = engine.device.createRenderPipeline({
    label: "Layer merge cropped RGBA16F to encoded RGBA8 finalizer",
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  mergeWorkingFinalizePipelines.set(engine.device, pipeline);
  return pipeline;
}

async function finalizeMergeWorkingSurface(
  engine: BrushEngine,
  working: MergedSurfaceResources,
  output: MergedSurfaceResources,
  actionId: number,
): Promise<void> {
  if (
    engine.layerFormat !== "rgba8unorm"
    || engine.documentStorageColorSpace !== "encoded-srgb-premultiplied"
  ) {
    throw new Error("The cropped merge finalizer requires encoded RGBA8 document storage.");
  }
  const pipeline = mergeWorkingFinalizePipeline(engine);
  const uniformBuffer = engine.device.createBuffer({
    label: "Layer merge cropped working finalizer uniforms",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.device.queue.writeBuffer(
    uniformBuffer,
    0,
    new Uint32Array([
      working.bounds.x,
      working.bounds.y,
      actionId >>> 0,
      0,
    ]),
  );
  try {
    const bindGroup = engine.device.createBindGroup({
      label: "Layer merge cropped working finalizer bindings",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: working.samplingView },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    });
    const encoder = engine.device.createCommandEncoder({
      label: "Finalize cropped layer merge into encoded RGBA8 storage",
    });
    const pass = encoder.beginRenderPass({
      label: "Finalize cropped layer merge into encoded RGBA8 storage",
      colorAttachments: [{
        view: output.mipViews[0],
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setScissorRect(
      working.bounds.x,
      working.bounds.y,
      working.bounds.width,
      working.bounds.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped("Finalize cropped RGBA16F layer merge", 60_000);
  } finally {
    uniformBuffer.destroy();
  }
}

function mergeBackdropSeedPipeline(
  engine: BrushEngine,
  format: LayerFormat,
): GPURenderPipeline {
  let byFormat = mergeBackdropSeedPipelines.get(engine.device);
  if (!byFormat) {
    byFormat = new Map();
    mergeBackdropSeedPipelines.set(engine.device, byFormat);
  }
  const existing = byFormat.get(format);
  if (existing) return existing;
  const module = engine.device.createShaderModule({
    label: "Layer merge known-backdrop seed WGSL",
    code: MERGE_BACKDROP_SEED_WGSL,
  });
  const pipeline = engine.device.createRenderPipeline({
    label: `Layer merge known-backdrop seed ${format}`,
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{
        format,
        // Seed only transparent residuals. Previously folded pixels already
        // contain this same known backdrop and therefore remain unchanged.
        blend: {
          color: {
            operation: "add",
            srcFactor: "one-minus-dst-alpha",
            dstFactor: "one",
          },
          alpha: {
            operation: "add",
            srcFactor: "one-minus-dst-alpha",
            dstFactor: "one",
          },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  byFormat.set(format, pipeline);
  return pipeline;
}

function createMergeBackdropSeedResources(
  engine: BrushEngine,
  format: LayerFormat,
): MergeBackdropSeedResources {
  const pipeline = mergeBackdropSeedPipeline(engine, format);
  const uniformBuffer = engine.device.createBuffer({
    label: "Layer merge known-backdrop seed uniforms",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const color = engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
    ? documentBackgroundEncodedSrgbPremultiplied(engine.documentBackground)
    : documentBackgroundLinearPremultiplied(engine.documentBackground);
  engine.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(color));
  try {
    const bindGroup = engine.device.createBindGroup({
      label: "Layer merge known-backdrop seed bindings",
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    return { pipeline, uniformBuffer, bindGroup };
  } catch (error) {
    uniformBuffer.destroy();
    throw error;
  }
}

function seedMergeSurfaceWithKnownBackdrop(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  resources: MergeBackdropSeedResources | null,
  documentRect: DirtyRect | null,
  label: string,
): void {
  if (!resources || !documentRect) return;
  const clipped = intersectMergedSurfaceRects(
    documentRect,
    surface.bounds,
    engine.documentWidth,
    engine.documentHeight,
  );
  if (!clipped) return;
  const physical = mergedSurfacePhysicalRect(
    clipped,
    surface.bounds,
    surface.resolutionScale,
  );
  const encoder = engine.device.createCommandEncoder({ label });
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [{
      view: surface.mipViews[0],
      loadOp: "load",
      storeOp: "store",
    }],
  });
  pass.setPipeline(resources.pipeline);
  pass.setBindGroup(0, resources.bindGroup);
  pass.setScissorRect(physical.x, physical.y, physical.width, physical.height);
  pass.draw(3, 1, 0, 0);
  pass.end();
  engine.device.queue.submit([encoder.finish()]);
}

function fullDocumentView(engine: BrushEngine): VectorTextViewState {
  return {
    canvasWidth: engine.documentWidth,
    canvasHeight: engine.documentHeight,
    cssWidth: engine.documentWidth,
    cssHeight: engine.documentHeight,
    centerX: engine.documentWidth * 0.5,
    centerY: engine.documentHeight * 0.5,
    zoom: 1,
    rotationRadians: 0,
    rotationCos: 1,
    rotationSin: 0,
  };
}

function outputFoldSurface(
  engine: BrushEngine,
  gpu: LayerGpuResources,
): MergedSurfaceResources {
  const hot = gpu.hot;
  if (!hot) throw new Error("The merge hot texture is unavailable.");
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  return {
    texture: hot.texture,
    samplingView: hot.samplingView,
    mipViews: [hot.view],
    format: hot.format,
    mipDownsampleBindGroups: [],
    blendFoldBackdropScratchTexture: null,
    blendFoldBackdropScratchView: null,
    blendFoldScratchTexture: null,
    blendFoldScratchView: null,
    blendFoldUniformBuffer: null,
    blendFoldUniformStride: 0,
    blendFoldTileWidth: 0,
    blendFoldTileHeight: 0,
    bounds: {
      x: 0,
      y: 0,
      width: engine.documentWidth,
      height: engine.documentHeight,
    },
    resolutionScale: 1,
    textureWidth: engine.documentWidth,
    textureHeight: engine.documentHeight,
    mip0MemoryBytes: engine.documentWidth * engine.documentHeight * bytesPerPixel,
    mipChainMemoryBytes: 0,
    validThroughLevel: 0,
    layerCount: 0,
    foldedPixels: 0,
    analyticBakePixels: 0,
  };
}

function clearOutputTexture(engine: BrushEngine, surface: MergedSurfaceResources): void {
  const encoder = engine.device.createCommandEncoder({ label: "Clear output merge layer" });
  const pass = encoder.beginRenderPass({
    label: "Clear output merge layer",
    colorAttachments: [{
      view: surface.mipViews[0],
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  pass.end();
  engine.device.queue.submit([encoder.finish()]);
}

function itemName(engine: BrushEngine, item: MixedSceneItem): string {
  const scene = requireMixedSceneStack(engine);
  if (item.kind === "raster") {
    return engine.layerStack.byId(item.rasterLayerId)?.name ?? `Raster ${item.rasterLayerId}`;
  }
  if (item.kind === "text") return scene.textById(item.textNodeId).name;
  if (item.kind === "svg") return scene.svgById(item.svgNodeId).name;
  return scene.imageById(item.imageNodeId).name;
}

function cloneHistoryStateAtOffset(
  state: MixedSceneVectorHistoryState,
  indexOffset: number,
  selectedKey: MixedSceneItem["key"],
): MixedSceneVectorHistoryState {
  return {
    ...state,
    index: state.index + indexOffset,
    selectedKey,
  };
}

type MergeVectorItem = Extract<MixedSceneItem, { kind: "text" | "svg" }>;
type MergeVectorDrawEntry = MergeMixedSceneItemsRequest["vectorDraws"][number];
type MergeVectorRun = Extract<LayerMergeRenderRun, { kind: "vector-run" }>;

function visibleVectorRunDraws(
  engine: BrushEngine,
  items: readonly MergeVectorItem[],
  drawEntries: ReadonlyMap<MergeVectorDrawEntry["key"], MergeVectorDrawEntry>,
  opacity: number,
): { readonly draws: MergeVectorDrawEntry["draws"][number][]; readonly visibleKeys: string[] } {
  const scene = requireMixedSceneStack(engine);
  const draws: MergeVectorDrawEntry["draws"][number][] = [];
  const visibleKeys: string[] = [];
  for (const item of items) {
    const visible = item.kind === "text"
      ? (() => {
        const node = scene.textById(item.textNodeId);
        return node.visible && node.opacity > 0 && node.text.length > 0;
      })()
      : (() => {
        const node = scene.svgById(item.svgNodeId);
        return node.visible && node.opacity > 0;
      })();
    if (!visible) continue;
    const entry = drawEntries.get(item.key);
    if (!entry) throw new Error(`Missing vector draws for ${item.key}.`);
    if (entry.opacity !== opacity) {
      throw new Error(`Vector run opacity does not match ${item.key}.`);
    }
    if (entry.draws.length === 0) continue;
    visibleKeys.push(item.key);
    draws.push(...entry.draws);
  }
  return { draws, visibleKeys };
}

async function renderVectorRunBlockInput(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  runs: readonly MergeVectorRun[],
  drawEntries: ReadonlyMap<MergeVectorDrawEntry["key"], MergeVectorDrawEntry>,
  view: VectorTextViewState,
  backdropSeed: MergeBackdropSeedResources | null,
  sceneDomain: LayerFoldSceneDomain,
): Promise<DirtyRect | null> {
  const prepared = runs.flatMap((run) => {
    const visible = visibleVectorRunDraws(
      engine,
      run.items,
      drawEntries,
      run.opacity,
    );
    return visible.draws.length === 0
      ? []
      : [{
        ...visible,
        opacity: run.opacity,
        bounds: vectorTextGpuRunBounds(visible.draws, view),
      }];
  });
  const blockBounds = unionMergedSurfaceRects(
    prepared.map((run) => run.bounds),
    engine.documentWidth,
    engine.documentHeight,
  );
  if (!blockBounds) return null;
  const blockAllocationBounds = alignedMergedSurfaceBounds(
    blockBounds,
    engine.documentWidth,
    64,
    64,
    engine.documentHeight,
  );
  const linearBlockSurface = allocateMergedSurface(
    engine,
    "rgba16float",
    "above",
    prepared.length,
    blockAllocationBounds,
    1,
    false,
  );
  clearOutputTexture(engine, linearBlockSurface);
  let renderedBlockBounds: DirtyRect | null = null;
  try {
    for (const run of prepared) {
      const allocationBounds = alignedMergedSurfaceBounds(
        run.bounds,
        engine.documentWidth,
        64,
        64,
        engine.documentHeight,
      );
      const vectorSurface = allocateMergedSurface(
        engine,
        "rgba16float",
        "above",
        1,
        allocationBounds,
        1,
        false,
      );
      try {
        const rendered = await renderVectorDrawsToTexture(
          engine,
          run.draws,
          view,
          { texture: vectorSurface.texture, format: "rgba16float" },
          vectorSurface.bounds,
          "linear-premultiplied",
        );
        await foldViewIntoMergedSurface(
          engine,
          linearBlockSurface,
          vectorSurface.samplingView,
          vectorSurface.bounds,
          1,
          vectorSurface.textureWidth,
          vectorSurface.textureHeight,
          run.opacity,
          rendered.bounds,
          "normal",
          "source-over",
          false,
          `Merge accumulate linear vector run ${run.visibleKeys.join(",")}`,
          null,
          vectorSurface.samplingView,
          null,
          null,
          "defer-to-fold-fence",
          "storage",
        );
        renderedBlockBounds = mergeDirtyRects(renderedBlockBounds, rendered.bounds);
      } finally {
        engine.destroyMergedSurface(vectorSurface);
      }
    }
    if (!renderedBlockBounds) return null;
    const visibleKeys = prepared.flatMap((run) => run.visibleKeys);
    seedMergeSurfaceWithKnownBackdrop(
      engine,
      surface,
      backdropSeed,
      renderedBlockBounds,
      `Merge seed known backdrop for vector block ${visibleKeys.join(",")}`,
    );
    await foldViewIntoMergedSurface(
      engine,
      surface,
      linearBlockSurface.samplingView,
      linearBlockSurface.bounds,
      1,
      linearBlockSurface.textureWidth,
      linearBlockSurface.textureHeight,
      1,
      renderedBlockBounds,
      "normal",
      "source-over",
      false,
      `Merge fold linear vector block ${visibleKeys.join(",")}`,
      null,
      linearBlockSurface.samplingView,
      null,
      null,
      "defer-to-fold-fence",
      sceneDomain === "storage" ? "storage" : "linear-source",
    );
    return renderedBlockBounds;
  } finally {
    engine.destroyMergedSurface(linearBlockSurface);
  }
}

async function renderSingleRasterUnitPreservingParent(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  rasterLayerId: number,
  surfaceFormat: LayerFormat,
): Promise<DirtyRect | null> {
  const unit = engine.layerStack.clippingUnit(rasterLayerId);
  const parent = unit[0];
  if (!parent.hasContent) return null;
  if (unit.length > 1) {
    const group = await buildClippingPrefixSurface(
      engine,
      parent,
      unit.slice(1),
      "structural-history",
      false,
      `Merge preserve clipping group ${parent.id}`,
      surfaceFormat,
    );
    if (!group) return null;
    try {
      await foldViewIntoMergedSurface(
        engine,
        surface,
        group.samplingView,
        group.bounds,
        group.resolutionScale,
        group.textureWidth,
        group.textureHeight,
        1,
        group.bounds,
        "normal",
        "source-over",
        false,
        `Merge preserve clipping group ${parent.id}`,
      );
      return layerCompositeVisualBounds(engine, parent);
    } finally {
      engine.destroyMergedSurface(group);
    }
  }

  const source = await materializeLayerCompositeSource(engine, parent, "structural-history");
  try {
    await foldViewIntoMergedSurface(
      engine,
      surface,
      source.view,
      { x: 0, y: 0 },
      1,
      engine.documentWidth,
      engine.documentHeight,
      1,
      source.nonTransparentBounds,
      "normal",
      "source-over",
      false,
      `Merge preserve raster ${parent.id}`,
      null,
      source.rawView,
      null,
      null,
      "defer-to-fold-fence",
    );
    return { ...source.nonTransparentBounds };
  } finally {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
  }
}

function mergeWorkingContentBounds(
  engine: BrushEngine,
  plan: ReturnType<typeof planMixedSceneLayerMerge>,
  request: MergeMixedSceneItemsRequest,
  drawEntries: ReadonlyMap<MergeVectorDrawEntry["key"], MergeVectorDrawEntry>,
  view: VectorTextViewState,
): DirtyRect | null {
  if (plan.preservesParentPresentation) {
    const parent = engine.layerStack.clippingUnit(plan.rasterLayerIds[0])[0];
    return parent.hasContent ? layerCompositeVisualBounds(engine, parent) : null;
  }
  const bounds: DirtyRect[] = [];
  const foldedRasterParents = new Set<number>();
  for (const run of layerMergeRenderRuns(plan.items, request.vectorDraws)) {
    if (run.kind === "raster") {
      const parent = engine.layerStack.clippingUnit(run.item.rasterLayerId)[0];
      if (foldedRasterParents.has(parent.id)) continue;
      foldedRasterParents.add(parent.id);
      if (!parent.visible || parent.opacity <= 0 || !parent.hasContent) continue;
      bounds.push(layerCompositeVisualBounds(engine, parent));
      continue;
    }
    if (run.kind === "image") {
      throw new Error("Image nodes are not supported by merge v1.");
    }
    const visible = visibleVectorRunDraws(
      engine,
      run.items,
      drawEntries,
      run.opacity,
    );
    if (visible.draws.length > 0) {
      bounds.push(vectorTextGpuRunBounds(visible.draws, view));
    }
  }
  return unionMergedSurfaceRects(
    bounds,
    engine.documentWidth,
    engine.documentHeight,
  );
}

async function renderMergeOutput(
  engine: BrushEngine,
  request: MergeMixedSceneItemsRequest,
  actionId: number,
): Promise<{
  readonly record: ReturnType<BrushEngine["layerStack"]["createDetachedRecord"]>;
  readonly gpu: LayerGpuResources;
  readonly seed: DeletedLayerEntry["seed"];
  readonly baseBounds: DirtyRect | null;
  readonly plan: ReturnType<typeof planMixedSceneLayerMerge>;
}> {
  const scene = requireMixedSceneStack(engine);
  const plan = planMixedSceneLayerMerge(engine.layerStack, scene, request.keys);
  const drawEntries = new Map(request.vectorDraws.map((entry) => [entry.key, entry]));
  if (drawEntries.size !== request.vectorDraws.length) {
    throw new Error("Duplicate vector draws in the merge request.");
  }
  for (const key of plan.vectorKeys) {
    if (!drawEntries.has(key as Extract<typeof key, `text:${number}` | `svg:${number}`>)) {
      throw new Error(`Missing vector draws for ${key}.`);
    }
  }
  for (const key of drawEntries.keys()) {
    if (!plan.vectorKeys.includes(key)) {
      throw new Error(`Vector draws outside the selection: ${key}.`);
    }
  }
  for (const item of plan.items) {
    if (item.kind !== "text" && item.kind !== "svg") continue;
    const entry = drawEntries.get(item.key);
    if (!entry) continue;
    const node = item.kind === "text"
      ? scene.textById(item.textNodeId)
      : scene.svgById(item.svgNodeId);
    if (entry.visible !== node.visible) {
      throw new Error(`Vector visibility changed while preparing merge input: ${item.key}.`);
    }
    if (
      !Number.isFinite(entry.opacity)
      || entry.opacity < 0
      || entry.opacity > 1
      || entry.opacity !== node.opacity
    ) {
      throw new Error(`Vector opacity changed while preparing merge input: ${item.key}.`);
    }
  }

  const topName = itemName(engine, plan.items[plan.items.length - 1]);
  const record = engine.layerStack.createDetachedRecord(
    request.name?.trim() || `${topName} · merged`,
  );
  const gpu = await allocateLayerGpuResources(
    engine,
    engine.layerFormat,
    `Output merge layer ${record.id}`,
  );
  const outputSurface = outputFoldSurface(engine, gpu);
  clearOutputTexture(engine, outputSurface);
  const view = fullDocumentView(engine);
  const plannedContentBounds = mergeWorkingContentBounds(
    engine,
    plan,
    request,
    drawEntries,
    view,
  );
  const usesCroppedWorkingSurface = engine.layerFormat === "rgba8unorm"
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
    && plannedContentBounds !== null;
  let workingSurface: MergedSurfaceResources | null = null;
  try {
    if (usesCroppedWorkingSurface && plannedContentBounds) {
      workingSurface = allocateMergedSurface(
        engine,
        "rgba16float",
        "above",
        plan.items.length,
        alignedMergedSurfaceBounds(
          plannedContentBounds,
          engine.documentWidth,
          64,
          64,
          engine.documentHeight,
        ),
        1,
        false,
      );
      clearOutputTexture(engine, workingSurface);
    }
  } catch (error) {
    destroyLayerGpuResources(engine, gpu);
    throw error;
  }
  const surface = workingSurface ?? outputSurface;
  const surfaceFormat: LayerFormat = workingSurface ? "rgba16float" : engine.layerFormat;
  const outerAdvancedBlend = plan.rasterLayerIds.some((layerId) => {
    const parent = engine.layerStack.clippingUnit(layerId)[0];
    return parent.visible
      && parent.opacity > 0
      && parent.hasContent
      && parent.blendMode !== "normal";
  });
  // A multi-item merge that starts at the document floor can resolve an
  // advanced outer blend only against the current, known canvas backdrop.
  // Seed it behind touched bounds; normal-only merges keep their transparency,
  // and a single clipping unit keeps its outer blend as metadata.
  const requiresSemanticBackdrop = plan.vectorKeys.length > 0
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied";
  const sceneDomain: LayerFoldSceneDomain = plan.vectorKeys.length > 0
      && engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
    ? "linear-stored-source"
    : "storage";
  let backdropSeed: MergeBackdropSeedResources | null = null;
  let bounds: DirtyRect | null = null;
  try {
    backdropSeed = plan.bakesParentBlendModesFromTransparentBackdrop
      && (outerAdvancedBlend || requiresSemanticBackdrop)
      && engine.documentBackground.visible
      ? createMergeBackdropSeedResources(engine, surfaceFormat)
      : null;
    if (plan.preservesParentPresentation) {
      const parent = engine.layerStack.clippingUnit(plan.rasterLayerIds[0])[0];
      record.visible = parent.visible;
      record.opacity = parent.opacity;
      record.blendMode = parent.blendMode;
      record.cutoutMode = parent.cutoutMode;
      record.tonalBlend = cloneLayerTonalBlend(parent.tonalBlend);
      bounds = await renderSingleRasterUnitPreservingParent(
        engine,
        surface,
        plan.rasterLayerIds[0],
        surfaceFormat,
      );
    } else {
      record.visible = true;
      record.opacity = 1;
      record.blendMode = "normal";
      const foldedRasterParents = new Set<number>();
      const renderRuns = layerMergeRenderRuns(plan.items, request.vectorDraws);
      let runIndex = 0;
      while (runIndex < renderRuns.length) {
        const run = renderRuns[runIndex];
        if (run.kind === "raster") {
          runIndex += 1;
          const unit = engine.layerStack.clippingUnit(run.item.rasterLayerId);
          const parent = unit[0];
          if (foldedRasterParents.has(parent.id)) continue;
          foldedRasterParents.add(parent.id);
          if (!parent.visible || parent.opacity <= 0 || !parent.hasContent) continue;
          const visualBounds = layerCompositeVisualBounds(engine, parent);
          seedMergeSurfaceWithKnownBackdrop(
            engine,
            surface,
            backdropSeed,
            visualBounds,
            `Merge seed known backdrop for raster ${parent.id}`,
          );
          const folded = unit.length > 1
            ? await foldClippingGroupIntoMergedSurface(
              engine,
              surface,
              unit,
              "above",
              "structural-history",
              false,
              plan.bakesParentBlendModesFromTransparentBackdrop
                ? parent.blendMode
                : "normal",
              parent,
              null,
              "defer-to-fold-fence",
              sceneDomain,
            )
            : await foldRasterRecordIntoMergedSurface(
              engine,
              surface,
              parent,
              "above",
              "structural-history",
              false,
              plan.bakesParentBlendModesFromTransparentBackdrop
                ? parent.blendMode
                : "normal",
              parent,
              false,
              "defer-to-fold-fence",
              sceneDomain,
            );
          if (folded) bounds = mergeDirtyRects(bounds, visualBounds);
          continue;
        }
        if (run.kind === "image") {
          throw new Error("Image nodes are not supported by merge v1.");
        }
        const vectorRuns: MergeVectorRun[] = [];
        while (
          runIndex < renderRuns.length
          && renderRuns[runIndex].kind === "vector-run"
        ) {
          vectorRuns.push(renderRuns[runIndex] as MergeVectorRun);
          runIndex += 1;
        }
        const vectorBounds = await renderVectorRunBlockInput(
          engine,
          surface,
          vectorRuns,
          drawEntries,
          view,
          backdropSeed,
          sceneDomain,
        );
        bounds = mergeDirtyRects(bounds, vectorBounds);
      }
    }
    await engine.waitForGpuCapped(`Render merge layer ${record.id}`, 60_000);
    releaseLayerBlendFoldScratch(surface);
    if (workingSurface && bounds) {
      await finalizeMergeWorkingSurface(
        engine,
        workingSurface,
        outputSurface,
        actionId,
      );
    }
    record.contentBounds = bounds ? { ...bounds } : null;
    record.hasContent = bounds !== null;
    record.storageTileMask.fill(0);
    if (bounds) markLayerStorageRect(record.storageTileMask, bounds);
    const hot = gpu.hot;
    if (!hot) throw new Error("The merge output is missing its hot texture.");
    const seed = bounds
      ? await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        record.storageTileMask.slice(),
        actionId,
        "history",
      )
      : null;
    return { record, gpu, seed, baseBounds: bounds ? { ...bounds } : null, plan };
  } catch (error) {
    try {
      await engine.waitForGpuCapped(`Drain failed merge layer ${record.id}`, 60_000);
    } catch {
      // Preserve the original merge failure.
    }
    releaseLayerBlendFoldScratch(surface);
    destroyLayerGpuResources(engine, gpu);
    throw error;
  } finally {
    backdropSeed?.uniformBuffer.destroy();
    engine.destroyMergedSurface(workingSurface);
  }
}

async function captureRasterInput(
  engine: BrushEngine,
  layerId: number,
  actionId: number,
  sceneIndex: number,
): Promise<LayerMergeHistoryInput> {
  const scene = requireMixedSceneStack(engine);
  const rasterLayerIndex = engine.layerStack.indexOfId(layerId);
  if (rasterLayerIndex < 0) throw new Error(`Raster ${layerId} is missing from the merge.`);
  const record = engine.layerStack.at(rasterLayerIndex);
  const gpu = engine.requireLayerGpu(layerId);
  let seed: DeletedLayerEntry["seed"] = null;
  if (record.hasContent) {
    if (gpu.hot) {
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        gpu.hot,
        coldStorageMaskForRecord(record),
        actionId,
        "history",
      );
    } else if (gpu.cold) {
      // Borrow the exact authority while the temporary input+output scene is
      // still renderable. Ownership moves to History only immediately before
      // this live layer is detached.
      seed = borrowLayerMergeColdSeed(gpu);
    } else if (gpu.compressed) {
      seed = await restoreColdStorageResources(
        engine,
        gpu.compressed,
        `Merge snapshot from compressed cold storage for layer ${layerId}`,
      );
    } else {
      throw new Error(`Raster ${layerId} has content but no hot/cold/compressed authority.`);
    }
  }
  const entry: DeletedLayerEntry = {
    layerRecord: record,
    rasterLayerIndex,
    sceneIndex,
    clippingParentId: record.clippingParentId,
    sceneClippingParentKey: scene.clippingParentKey(`raster:${layerId}`),
    sceneClippingChildKeys: scene.clippingChildrenKeys(`raster:${layerId}`),
    seed,
    baseBounds: record.contentBounds ? { ...record.contentBounds } : null,
  };
  return { kind: "raster", key: `raster:${layerId}`, entry };
}

async function attachOutput(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  preparedGpu?: LayerGpuResources,
): Promise<LayerGpuResources> {
  const scene = requireMixedSceneStack(engine);
  const entry = action.output;
  const fallbackLayerId = engine.layerStack.active.id;
  if (entry.baseTileMask.length !== entry.layerRecord.storageTileMask.length) {
    throw new Error("The merge checkpoint tile mask is incompatible with the document.");
  }
  entry.layerRecord.contentBounds = entry.baseBounds ? { ...entry.baseBounds } : null;
  entry.layerRecord.hasContent = entry.baseBounds !== null;
  entry.layerRecord.storageTileMask.set(entry.baseTileMask);
  const gpu = preparedGpu ?? (entry.seed
    ? await hydrateLayerFromSeed(engine, entry.layerRecord.id, entry.seed)
    : await allocateLayerGpuResources(
      engine,
      engine.layerFormat,
      `Redo empty merge output ${entry.layerRecord.id}`,
    ));
  let stackAttached = false;
  let sceneAttached = false;
  try {
    engine.layerStack.attach(entry.layerRecord, entry.rasterLayerIndex, true);
    stackAttached = true;
    engine.layerGpu.set(entry.layerRecord.id, gpu);
    scene.insertRasterAt(entry.layerRecord.id, entry.sceneIndex, false);
    sceneAttached = true;
    return gpu;
  } catch (error) {
    try {
      if (sceneAttached || scene.indexOfKey(`raster:${entry.layerRecord.id}`) >= 0) {
        scene.removeRaster(entry.layerRecord.id, fallbackLayerId);
      }
      const index = engine.layerStack.indexOfId(entry.layerRecord.id);
      if (stackAttached && index >= 0) engine.layerStack.remove(index);
      if (engine.layerGpu.get(entry.layerRecord.id) === gpu) {
        engine.layerGpu.delete(entry.layerRecord.id);
      }
      destroyLayerGpuResources(engine, gpu);
    } catch (rollbackError) {
      engine.latchDocumentStateInconsistent(
        "Attaching the merge output failed and compensation is incomplete: reload the page.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(`${first}; merge output attachment rollback failed: ${second}`);
    }
    throw error;
  }
}

interface StagedMergeRaster {
  readonly entry: DeletedLayerEntry;
  readonly gpu: LayerGpuResources;
  readonly borrowedColdTransferred: boolean;
}

function layerMergeFullTextureBytes(engine: BrushEngine): number {
  return engine.documentWidth * engine.documentHeight
    * (engine.layerFormat === "rgba16float" ? 8 : 4);
}

function layerMergeColdBytesForRecord(engine: BrushEngine, layerId: number): number {
  const record = engine.layerStack.byId(layerId);
  if (!record || !record.hasContent) return 0;
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  return countLayerStorageTiles(coldStorageMaskForRecord(record))
    * LAYER_STORAGE_TILE_WIDTH
    * LAYER_STORAGE_TILE_HEIGHT
    * bytesPerPixel;
}

function layerMergeCreateRequest(
  engine: BrushEngine,
  plan: ReturnType<typeof planMixedSceneLayerMerge>,
  mergeRequest: MergeMixedSceneItemsRequest,
): MemoryRequest {
  const full = layerMergeFullTextureBytes(engine);
  const inputSeedBytes = plan.rasterLayerIds.map((layerId) => {
    const record = engine.layerStack.byId(layerId);
    if (!record?.hasContent) return 0;
    const gpu = engine.requireLayerGpu(layerId);
    // A hot layer needs a separate History seed. A cold authority is borrowed
    // and transferred only at detach, so charging it twice would reject a safe
    // merge. A compressed authority has to be restored into a seed first.
    if (gpu.hot) return layerMergeColdBytesForRecord(engine, layerId);
    if (gpu.compressed) return gpu.compressed.rawBytes;
    if (gpu.cold) return 0;
    // The operation will subsequently reject the malformed authority as well;
    // use the full bound here so its admission can never be optimistic.
    return full;
  });
  let foldTransientBytes: number;
  if (
    engine.layerFormat === "rgba8unorm"
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
  ) {
    const drawEntries = new Map(
      mergeRequest.vectorDraws.map((entry) => [entry.key, entry]),
    );
    const contentBounds = mergeWorkingContentBounds(
      engine,
      plan,
      mergeRequest,
      drawEntries,
      fullDocumentView(engine),
    );
    if (!contentBounds) {
      foldTransientBytes = 0;
    } else {
      const allocation = alignedMergedSurfaceBounds(
        contentBounds,
        engine.documentWidth,
        64,
        64,
        engine.documentHeight,
      );
      const workingBytes = allocation.width * allocation.height * 8;
      const foldTileWidth = Math.min(LAYER_BLEND_FOLD_TILE_EXTENT, allocation.width);
      const foldTileHeight = Math.min(LAYER_BLEND_FOLD_TILE_EXTENT, allocation.height);
      const foldScratchBytes = foldTileWidth * foldTileHeight * 8 * 2;
      const containsClipping = plan.rasterLayerIds.some(
        (layerId) => engine.layerStack.clippingUnit(layerId).length > 1,
      );
      // A complete clipping unit may temporarily retain group, base,
      // document-mask and raw-matte surfaces while the outer working run is
      // alive. Four fold scratch pairs cover the outer run plus the
      // simultaneously live group, base and document-mask destinations.
      const clippingSurfaceBytes = containsClipping ? workingBytes * 4 : 0;
      const rasterPhaseBytes = full * 2
        + clippingSurfaceBytes
        + foldScratchBytes * (containsClipping ? 4 : 1);
      const hasVectorRuns = plan.vectorKeys.length > 0;
      const vectorChunk = vectorRasterChunkDimensions();
      const vectorRenderScratchBytes = hasVectorRuns
        ? vectorChunk.width * vectorChunk.height * 8
          * (VECTOR_TEXT_GPU_SAMPLE_COUNT + 1)
        : 0;
      const vectorPhaseBytes = hasVectorRuns
        // A contiguous semantic block retains one linear accumulator while a
        // cropped per-run source is rendered. The outer encoded working fold
        // and the linear block fold each retain their own scratch pair.
        ? workingBytes * 2 + vectorRenderScratchBytes + foldScratchBytes * 2
        : 0;
      foldTransientBytes = workingBytes + Math.max(rasterPhaseBytes, vectorPhaseBytes);
    }
  } else {
    const mergedFullBytes = mergedSurfaceMemoryBytes(
      { width: engine.documentWidth, height: engine.documentHeight },
      engine.layerFormat === "rgba16float" ? 8 : 4,
    ).totalBytes;
    foldTransientBytes = full * 2 + mergedFullBytes;
  }
  return planLayerMergeCreateMemory({
    fullLayerBytes: full,
    inputSeedBytes,
    outputSeedBytes: full,
    // One source may be rehydrated and baked while the output is folded. The
    // source is streamed, therefore this does not scale with selected layers.
    foldTransientBytes,
  });
}

async function reserveLayerMergeCreateMemory(
  engine: BrushEngine,
  plan: ReturnType<typeof planMixedSceneLayerMerge>,
  mergeRequest: MergeMixedSceneItemsRequest,
): Promise<MemoryReservation> {
  const request = layerMergeCreateRequest(engine, plan, mergeRequest);
  return engine.reservePlannedMemory(request);
}

function layerMergeHistoryRequest(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  delta: -1 | 1,
): MemoryRequest {
  const full = layerMergeFullTextureBytes(engine);
  if (delta > 0) {
    const missingOutputSeed = action.output.seed
      && isHistoryColdSeedHandle(action.output.seed)
      && !action.output.seed.resident
      ? action.output.seed.memoryBytes
      : 0;
    return {
      category: "layer-merge-redo",
      // Output hot remains; staged inputs are already in the committed ledger.
      steadyBytes: full,
      // One streamed seed, output hot and one outgoing freeze/hydration overlap.
      peakBytes: full * 2 + missingOutputSeed,
      priority: "normal",
    };
  }

  let clonedColdBytes = 0;
  let maximumMissingSeedBytes = 0;
  for (const input of action.inputs) {
    if (input.kind !== "raster" || !input.entry.seed) continue;
    clonedColdBytes += input.entry.seed.memoryBytes;
    if (isHistoryColdSeedHandle(input.entry.seed) && !input.entry.seed.resident) {
      maximumMissingSeedBytes = Math.max(
        maximumMissingSeedBytes,
        input.entry.seed.memoryBytes,
      );
    }
  }
  const referenceNeedsHot = action.referenceRasterLayerIdBefore !== null
    && action.referenceRasterLayerIdBefore !== action.activeRasterLayerIdBefore
    && action.inputs.some((input) => input.kind === "raster"
      && input.entry.layerRecord.id === action.referenceRasterLayerIdBefore);
  const hotDestinations = 1 + Number(referenceNeedsHot);
  const steadyBytes = clonedColdBytes + full * hotDestinations;
  return {
    category: "layer-merge-undo",
    steadyBytes,
    // All independent live cold authorities plus at most one streamed source,
    // active/reference hot targets and one bounded switch overlap.
    peakBytes: steadyBytes + maximumMissingSeedBytes + full,
    priority: "normal",
  };
}

async function reserveLayerMergeHistoryMemory(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  delta: -1 | 1,
  _allowOverride: boolean,
): Promise<MemoryReservation> {
  const request = layerMergeHistoryRequest(engine, action, delta);
  return engine.reservePlannedMemory(request);
}

async function prepareMergeInputGpu(
  engine: BrushEngine,
  entry: DeletedLayerEntry,
): Promise<{ gpu: LayerGpuResources; historyResidenceChanged: boolean }> {
  const seed = entry.seed;
  if (!seed) {
    return { gpu: createColdLayerGpuResources(), historyResidenceChanged: false };
  }
  await engine.historyLocalStorage.ensureLayerMergeSeedResident(seed);
  const cold = await cloneLayerColdStorageResources(
    engine,
    seed,
    `Clone cold merge Undo for layer ${entry.layerRecord.id}`,
  );
  return {
    gpu: { hot: null, cold, compressed: null, bake: null, bakeValid: false },
    historyResidenceChanged: engine.historyLocalStorage.demoteStoredLayerMergeSeed(seed),
  };
}

function attachPreparedMergeRaster(
  engine: BrushEngine,
  entry: DeletedLayerEntry,
  gpu: LayerGpuResources,
): void {
  const scene = requireMixedSceneStack(engine);
  const layerId = entry.layerRecord.id;
  const fallbackLayerId = engine.layerStack.active.id;
  if (engine.layerStack.indexOfId(layerId) >= 0 || engine.layerGpu.has(layerId)) {
    throw new Error(`Raster ${layerId} is already present during merge Undo.`);
  }
  entry.layerRecord.contentBounds = entry.baseBounds ? { ...entry.baseBounds } : null;
  entry.layerRecord.hasContent = entry.baseBounds !== null;
  let stackAttached = false;
  let sceneAttached = false;
  try {
    engine.layerStack.attach(entry.layerRecord, entry.rasterLayerIndex, true);
    stackAttached = true;
    engine.layerGpu.set(layerId, gpu);
    scene.insertRasterAt(layerId, entry.sceneIndex, false);
    sceneAttached = true;
  } catch (error) {
    if (sceneAttached || scene.indexOfKey(`raster:${layerId}`) >= 0) {
      try {
        scene.removeRaster(layerId, fallbackLayerId);
      } catch {
        // The outer structural transaction latches if compensation is incomplete.
      }
    }
    const index = engine.layerStack.indexOfId(layerId);
    if (stackAttached && index >= 0) engine.layerStack.remove(index);
    if (engine.layerGpu.get(layerId) === gpu) engine.layerGpu.delete(layerId);
    destroyLayerGpuResources(engine, gpu);
    throw error;
  }
}

function stageDetachMergeRaster(
  engine: BrushEngine,
  entry: DeletedLayerEntry,
  fallbackLayerId: number,
  transferBorrowedCold: boolean,
): StagedMergeRaster {
  const scene = requireMixedSceneStack(engine);
  const layerId = entry.layerRecord.id;
  const rasterLayerIndex = engine.layerStack.indexOfId(layerId);
  const sceneIndex = scene.indexOfKey(`raster:${layerId}`);
  if (rasterLayerIndex < 0 || sceneIndex < 0) {
    throw new Error(`Raster ${layerId} is unavailable for staged detachment.`);
  }
  const gpu = engine.requireLayerGpu(layerId);
  const borrowedColdTransferred = transferBorrowedCold
    ? transferBorrowedLayerMergeColdSeedForDetach(gpu, entry.seed)
    : false;
  let sceneRemoved = false;
  let stackRemoved = false;
  try {
    scene.removeRaster(layerId, fallbackLayerId);
    sceneRemoved = true;
    const detached = engine.layerStack.remove(rasterLayerIndex);
    stackRemoved = true;
    if (detached !== entry.layerRecord) throw new Error(`Inconsistent staged detachment for ${layerId}.`);
    engine.layerGpu.delete(layerId);
    return {
      entry: { ...entry, rasterLayerIndex, sceneIndex },
      gpu,
      borrowedColdTransferred,
    };
  } catch (error) {
    try {
      if (stackRemoved) engine.layerStack.attach(entry.layerRecord, rasterLayerIndex, true);
      if (engine.layerGpu.get(layerId) !== gpu) engine.layerGpu.set(layerId, gpu);
      if (sceneRemoved && scene.indexOfKey(`raster:${layerId}`) < 0) {
        scene.insertRasterAt(layerId, sceneIndex, false);
      }
      if (borrowedColdTransferred) {
        restoreBorrowedLayerMergeColdSeedAfterDetachFailure(gpu, entry.seed);
      }
    } catch (rollbackError) {
      engine.latchDocumentStateInconsistent(
        "Staged merge detachment failed and compensation is incomplete: reload the page.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${first}; staged detachment rollback failed: ${second}`);
    }
    throw error;
  }
}

function reattachStagedMergeRaster(engine: BrushEngine, staged: StagedMergeRaster): void {
  const scene = requireMixedSceneStack(engine);
  const { entry, gpu } = staged;
  const layerId = entry.layerRecord.id;
  if (staged.borrowedColdTransferred) {
    restoreBorrowedLayerMergeColdSeedAfterDetachFailure(gpu, entry.seed);
  }
  engine.layerStack.attach(entry.layerRecord, entry.rasterLayerIndex, true);
  engine.layerGpu.set(layerId, gpu);
  try {
    scene.insertRasterAt(layerId, entry.sceneIndex, false);
  } catch (error) {
    engine.layerGpu.delete(layerId);
    const index = engine.layerStack.indexOfId(layerId);
    if (index >= 0) engine.layerStack.remove(index);
    throw error;
  }
}

function removeVectorInput(
  engine: BrushEngine,
  input: Extract<LayerMergeHistoryInput, { kind: "vector" }>,
  selectedKey: MixedSceneItem["key"],
): void {
  const state = input.state;
  if (!state) throw new Error(`Vector snapshot ${input.key} has already been retired.`);
  requireMixedSceneStack(engine).restoreVectorHistoryState({
    key: state.key,
    index: -1,
    selectedKey,
    node: null,
  });
}

async function applyMergedState(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  preparedGpu?: LayerGpuResources,
  manageLayerSwitchBusy = true,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const originalActiveId = engine.layerStack.active.id;
  const originalReferenceId = engine.layerStack.referenceLayerId;
  const sceneState = scene.captureState(true);
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  const outputVisible = action.output.layerRecord.visible;
  const stagedInputs: StagedMergeRaster[] = [];
  let outputGpu: LayerGpuResources | null = null;
  let outputAttached = false;
  let historyResidenceChanged = false;
  if (manageLayerSwitchBusy) engine.layerSwitchBusy = true;
  try {
    engine.persistActiveLayerState();
    await engine.prepareActiveLayerForSwitch();
    // Keep the replacement hidden while it is attached. Presentation is already
    // frozen, so the final structure can be assembled before one activation.
    action.output.layerRecord.visible = false;
    if (!preparedGpu) {
      await engine.historyLocalStorage.ensureLayerMergeSeedResident(action.output.seed);
    }
    outputGpu = await attachOutput(engine, action, preparedGpu);
    outputAttached = true;
    if (!preparedGpu) {
      historyResidenceChanged = engine.historyLocalStorage.demoteStoredLayerMergeSeed(
        action.output.seed,
      );
    }
    action.output.layerRecord.visible = outputVisible;

    for (const input of [...action.inputs].reverse()) {
      if (input.kind === "vector") {
        removeVectorInput(engine, input, action.selectedKeyAfter);
      } else {
        const staged = stageDetachMergeRaster(
          engine,
          input.entry,
          action.activeRasterLayerIdAfter,
          Boolean(preparedGpu),
        );
        stagedInputs.push(staged);
      }
    }
    restoreReferenceLayerId(engine, action.referenceRasterLayerIdAfter);
    if (scene.indexOfKey(action.selectedKeyAfter) >= 0) scene.select(action.selectedKeyAfter);
    const outputIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdAfter);
    if (outputIndex < 0) throw new Error("The merge output was lost while detaching an input.");
    engine.layerStack.setActiveIndex(outputIndex);
    // The outgoing GPU authorities are staged and retained until commit, so the
    // activation must not look them up through their now-removed stack indices.
    await engine.activateLayer(outputIndex, "structural-history");
    engine.vectorTextPreviewExcludedNodeId = scene.selected.kind === "text"
      ? scene.selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.clearVectorTextPresentation();
    engine.publishActiveLayerChange();
    // The structural state is now committed and no rollback path needs the
    // detached live authorities. Destroy only here, never while detaching.
    for (const staged of stagedInputs) destroyLayerGpuResources(engine, staged.gpu);
    stagedInputs.length = 0;
  } catch (error) {
    try {
      action.output.layerRecord.visible = outputVisible;
      if (!engine.layerPresentationFrozen) {
        await engine.waitForIdle();
        engine.layerPresentationFrozen = true;
      }
      for (const staged of [...stagedInputs].reverse()) {
        reattachStagedMergeRaster(engine, staged);
      }
      scene.restoreState(sceneState, true);
      engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      const originalIndex = engine.layerStack.indexOfId(originalActiveId);
      if (originalIndex < 0) throw new Error("The original active raster cannot be restored.");
      engine.layerStack.setActiveIndex(originalIndex);
      if (outputAttached) {
        const outputIndex = engine.layerStack.indexOfId(action.output.layerRecord.id);
        if (outputIndex >= 0) {
          engine.layerStack.remove(outputIndex);
          const liveGpu = engine.layerGpu.get(action.output.layerRecord.id);
          engine.layerGpu.delete(action.output.layerRecord.id);
          if (liveGpu) destroyLayerGpuResources(engine, liveGpu);
        }
      } else if (
        preparedGpu
        && outputGpu === null
        && engine.layerGpu.get(action.output.layerRecord.id) !== preparedGpu
      ) {
        destroyLayerGpuResources(engine, preparedGpu);
      }
      restoreReferenceLayerId(engine, originalReferenceId);
      await engine.activateLayer(originalIndex, "structural-history");
    } catch (rollbackError) {
      engine.latchDocumentStateInconsistent(
        "Layer merge failed and rollback is incomplete: reload the page.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${first}; merge rollback failed: ${second}`);
    }
    throw error;
  } finally {
    action.output.layerRecord.visible = outputVisible;
    if (manageLayerSwitchBusy) engine.layerSwitchBusy = false;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.scheduleLayerColdCompression();
    if (historyResidenceChanged) engine.historyStorageResidenceChanged();
    publishMixedScene(engine);
    engine.publishStats();
  }
}

async function applyInputState(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const outputId = action.output.layerRecord.id;
  const outputIndex = engine.layerStack.indexOfId(outputId);
  if (outputIndex < 0) throw new Error("The merge output is missing during Undo.");
  if (action.payloadsRetiredBelowFloor) {
    throw new Error("Merge payloads have already been retired below the History floor.");
  }
  for (const input of action.inputs) {
    if (input.kind === "vector" && !input.state) {
      throw new Error(`Vector snapshot ${input.key} has already been retired.`);
    }
    if (input.kind === "raster" && input.entry.baseBounds && !input.entry.seed) {
      throw new Error(`Raster seed ${input.entry.layerRecord.id} has already been retired.`);
    }
  }
  const originalActiveId = engine.layerStack.active.id;
  const sceneState = scene.captureState(true);
  const previousReferenceId = engine.layerStack.referenceLayerId;
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  const outputVisible = action.output.layerRecord.visible;
  const attachedRaster: DeletedLayerEntry[] = [];
  let stagedOutput: StagedMergeRaster | null = null;
  let historyResidenceChanged = false;
  engine.layerSwitchBusy = true;
  try {
    await switchActiveForStructuralHistory(engine, outputIndex);
    engine.persistActiveLayerState();
    await engine.prepareActiveLayerForSwitch();
    // Hide the still-attached replacement while the restored inputs are
    // activated. The mandatory drain therefore presents the exact Undo state,
    // never output+inputs together.
    action.output.layerRecord.visible = false;
    for (const input of action.inputs) {
      if (input.kind === "raster") {
        const temporaryEntry = {
          ...input.entry,
          rasterLayerIndex: input.entry.rasterLayerIndex + 1,
          sceneIndex: input.entry.sceneIndex + 1,
        };
        const prepared = await prepareMergeInputGpu(engine, input.entry);
        historyResidenceChanged = prepared.historyResidenceChanged || historyResidenceChanged;
        attachPreparedMergeRaster(engine, temporaryEntry, prepared.gpu);
        attachedRaster.push(temporaryEntry);
      } else {
        const vectorState = input.state;
        if (!vectorState) throw new Error(`Vector snapshot ${input.key} is unavailable.`);
        scene.restoreVectorHistoryState(
          cloneHistoryStateAtOffset(vectorState, 1, action.selectedKeyBefore),
        );
      }
    }

    const restoredActiveIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
    const outgoingIndex = engine.layerStack.indexOfId(outputId);
    if (restoredActiveIndex < 0 || outgoingIndex < 0) {
      throw new Error("The active raster or output is unavailable during merge Undo.");
    }
    const referenceBefore = action.referenceRasterLayerIdBefore;
    if (referenceBefore !== null && referenceBefore !== action.activeRasterLayerIdBefore) {
      const referenceIndex = engine.layerStack.indexOfId(referenceBefore);
      if (referenceIndex < 0) throw new Error("The Reference raster to restore is unavailable.");
      const referenceRecord = engine.layerStack.at(referenceIndex);
      const referenceGpu = engine.requireLayerGpu(referenceBefore);
      await ensureActiveLayerHot(engine, referenceRecord);
      const supersededCold = referenceGpu.cold;
      referenceGpu.cold = null;
      referenceGpu.compressed = null;
      destroyLayerColdStorage(supersededCold);
    }
    restoreReferenceLayerId(engine, referenceBefore);
    engine.layerStack.setActiveIndex(restoredActiveIndex);
    await engine.activateLayer(outgoingIndex, "structural-history");
    await engine.waitForIdle();
    engine.layerPresentationFrozen = true;
    action.output.layerRecord.visible = outputVisible;
    stagedOutput = stageDetachMergeRaster(
      engine,
      action.output,
      action.activeRasterLayerIdBefore,
      false,
    );

    const activeAfterDetach = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
    if (activeAfterDetach < 0) throw new Error("The restored active raster was lost during Undo.");
    restoreReferenceLayerId(engine, action.referenceRasterLayerIdBefore);
    if (scene.indexOfKey(action.selectedKeyBefore) >= 0) scene.select(action.selectedKeyBefore);
    engine.layerStack.setActiveIndex(activeAfterDetach);
    await engine.activateLayer(activeAfterDetach, "structural-history");
    engine.vectorTextPreviewExcludedNodeId = scene.selected.kind === "text"
      ? scene.selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.clearVectorTextPresentation();
    engine.publishActiveLayerChange();
    destroyLayerGpuResources(engine, stagedOutput.gpu);
    stagedOutput = null;
  } catch (error) {
    try {
      action.output.layerRecord.visible = outputVisible;
      if (!engine.layerPresentationFrozen) {
        await engine.waitForIdle();
        engine.layerPresentationFrozen = true;
      }
      if (stagedOutput) {
        reattachStagedMergeRaster(engine, stagedOutput);
        stagedOutput = null;
      } else if (engine.layerStack.indexOfId(outputId) < 0) {
        throw new Error("The merge output was removed without staged rollback resources.");
      }
      for (const entry of [...attachedRaster].reverse()) {
        if (engine.layerStack.indexOfId(entry.layerRecord.id) >= 0) {
          await detachLayer(engine, entry.layerRecord.id, outputId);
        }
      }
      scene.restoreState(sceneState, true);
      engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      restoreReferenceLayerId(engine, previousReferenceId);
      const restoredOutputIndex = engine.layerStack.indexOfId(outputId);
      if (restoredOutputIndex < 0) throw new Error("The merge output cannot be restored.");
      engine.layerStack.setActiveIndex(restoredOutputIndex);
      await engine.activateLayer(restoredOutputIndex, "structural-history");
      if (originalActiveId !== outputId) {
        const originalIndex = engine.layerStack.indexOfId(originalActiveId);
        if (originalIndex < 0) throw new Error("The original active raster was lost during merge rollback.");
        await switchActiveForStructuralHistory(engine, originalIndex);
      }
    } catch (rollbackError) {
      engine.latchDocumentStateInconsistent(
        "Merge Undo failed and rollback is incomplete: reload the page.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${first}; merge Undo rollback failed: ${second}`);
    }
    throw error;
  } finally {
    action.output.layerRecord.visible = outputVisible;
    engine.layerSwitchBusy = false;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.scheduleLayerColdCompression();
    if (historyResidenceChanged) engine.historyStorageResidenceChanged();
    publishMixedScene(engine);
    engine.publishStats();
  }
}

export async function prepareAndApplyLayerMerge(
  engine: BrushEngine,
  request: MergeMixedSceneItemsRequest,
): Promise<PreparedLayerMerge> {
  if (!engine.initialized) throw new Error("The engine is not initialized.");
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const scene = requireMixedSceneStack(engine);
  const actionId = engine.nextHistoryActionId;
  let rendered: Awaited<ReturnType<typeof renderMergeOutput>> | null = null;
  const inputs: LayerMergeHistoryInput[] = [];
  let memoryReservation: MemoryReservation | null = null;
  let applied = false;
  let applyAttempted = false;
  let workbenchMayNeedRestore = false;
  try {
    await engine.waitForIdle();
    // The active record is intentionally lazy during painting; fold/cold
    // snapshot helpers consume record metadata, so publish it before planning.
    engine.persistActiveLayerState();
    workbenchMayNeedRestore = true;
    const memoryPlan = planMixedSceneLayerMerge(engine.layerStack, scene, request.keys);
    memoryReservation = await reserveLayerMergeCreateMemory(
      engine,
      memoryPlan,
      request,
    );
    rendered = await renderMergeOutput(engine, request, actionId);
    await restoreEffectsWorkbenchToActiveLayer(engine, "structural-history");
    workbenchMayNeedRestore = false;
    for (const item of rendered.plan.items) {
      const sceneIndex = scene.indexOfKey(item.key);
      if (item.kind === "raster") {
        inputs.push(await captureRasterInput(engine, item.rasterLayerId, actionId, sceneIndex));
      } else if (item.kind === "text" || item.kind === "svg") {
        inputs.push({
          kind: "vector",
          key: item.key,
          state: scene.captureVectorHistoryState(item.key),
        });
      } else {
        throw new Error("Image nodes are not supported by merge v1.");
      }
    }
    const outputKey = `raster:${rendered.record.id}` as const;
    const referenceBefore = engine.layerStack.referenceLayerId;
    const mergedRasterIds = new Set(rendered.plan.rasterLayerIds);
    const action: LayerMergeHistoryAction = {
      id: actionId,
      kind: "layer-merge",
      inputs,
      output: {
        layerRecord: rendered.record,
        rasterLayerIndex: rendered.plan.rasterLayerIndex,
        sceneIndex: rendered.plan.sceneIndex,
        clippingParentId: null,
        seed: rendered.seed,
        baseBounds: rendered.baseBounds,
        baseTileMask: rendered.record.storageTileMask.slice(),
      },
      selectedKeyBefore: scene.selected.key,
      selectedKeyAfter: outputKey,
      activeRasterLayerIdBefore: engine.layerStack.active.id,
      activeRasterLayerIdAfter: rendered.record.id,
      referenceRasterLayerIdBefore: referenceBefore,
      referenceRasterLayerIdAfter: referenceBefore !== null && mergedRasterIds.has(referenceBefore)
        ? rendered.record.id
        : referenceBefore,
      preservesParentPresentation: rendered.plan.preservesParentPresentation,
      payloadsRetiredBelowFloor: false,
    };
    applyAttempted = true;
    await applyMergedState(engine, action, rendered.gpu, false);
    applied = true;
    return {
      action,
      result: {
        layerId: rendered.record.id,
        itemCount: inputs.length,
        rasterInputCount: rendered.plan.rasterLayerIds.length,
        vectorInputCount: rendered.plan.vectorKeys.length,
        tileCount: countLayerStorageTiles(rendered.record.storageTileMask),
        preservesParentPresentation: rendered.plan.preservesParentPresentation,
      },
    };
  } finally {
    if (memoryReservation) {
      if (applied) engine.memoryReservations.settle(memoryReservation);
      else engine.memoryReservations.release(memoryReservation);
    }
    if (!applied) {
      for (const input of inputs) {
        if (input.kind !== "raster") continue;
        const liveGpu = engine.layerGpu.get(input.entry.layerRecord.id);
        if (layerMergeColdSeedIsLiveAuthority(liveGpu, input.entry.seed)) {
          // The action was never published and detach never took ownership.
          // Keep the exact seed on the live layer and do not destroy the same
          // object through unpublished-action cleanup.
          input.entry.seed = null;
          continue;
        }
        if (
          input.entry.seed
          && liveGpu
          && !liveGpu.hot
          && !liveGpu.cold
          && !liveGpu.compressed
        ) {
          // A cold-only input was transferred into the unpublished action.
          // Restore that exact authority instead of destroying the user's only
          // pixels when a later snapshot/allocation fails.
          liveGpu.cold = input.entry.seed;
          input.entry.seed = null;
        }
        destroyLayerColdStorage(input.entry.seed);
      }
      if (rendered) {
        destroyLayerColdStorage(rendered.seed);
        if (engine.layerStack.indexOfId(rendered.record.id) < 0) {
          const live = engine.layerGpu.get(rendered.record.id);
          if (live) engine.layerGpu.delete(rendered.record.id);
          destroyLayerGpuResources(engine, live ?? rendered.gpu);
        }
      }
      if (workbenchMayNeedRestore && !applyAttempted) {
        try {
          await restoreEffectsWorkbenchToActiveLayer(
            engine,
            "structural-history",
            true,
          );
        } catch {
          engine.latchDocumentStateInconsistent(
            "Merge preparation failed and the effects workbench cannot be restored: reload the page.",
          );
        }
      }
    }
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
  }
}

export async function applyLayerMergeHistory(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  delta: -1 | 1,
  allowMemoryOverride = false,
): Promise<void> {
  if (action.payloadsRetiredBelowFloor) {
    throw new Error("Merge payloads have already been retired below the History floor.");
  }
  // A durable seed may still have a disposable resident cache. Drop every such
  // cache before admission so the ledger describes the smallest authoritative
  // starting state. The transaction then streams at most one missing seed at a
  // time; live Undo layers receive independent cold authorities.
  if (engine.historyLocalStorage.demoteStoredLayerMergeSeeds(action)) {
    engine.historyStorageResidenceChanged();
  }
  const reservation = await reserveLayerMergeHistoryMemory(
    engine,
    action,
    delta,
    allowMemoryOverride,
  );
  let committed = false;
  try {
    if (delta < 0) await applyInputState(engine, action);
    else await applyMergedState(engine, action);
    committed = true;
  } finally {
    if (committed) engine.memoryReservations.settle(reservation);
    else engine.memoryReservations.release(reservation);
  }
}

export function destroyLayerMergeHistorySeeds(action: LayerMergeHistoryAction): void {
  for (const input of action.inputs) {
    if (input.kind === "raster") destroyLayerColdStorage(input.entry.seed);
  }
  destroyLayerColdStorage(action.output.seed);
}
