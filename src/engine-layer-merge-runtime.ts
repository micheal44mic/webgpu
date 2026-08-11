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
  LayerColdStorageResources,
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
import { renderVectorDrawsToTexture } from "./engine-vector-raster-runtime";
import { mergeDirtyRects } from "./engine-geometry";
import type { DirtyRect } from "./engine-stroke-types";
import {
  LAYER_STORAGE_TILE_SIZE,
  countLayerStorageTiles,
  markLayerStorageRect,
} from "./layer-storage-study";
import {
  alignedMergedSurfaceBounds,
  mergedSurfaceMemoryBytes,
} from "./merged-surface-bounds";
import type {
  MixedSceneItem,
  MixedSceneVectorHistoryState,
} from "./mixed-scene-stack";
import {
  type MergeMixedSceneItemsRequest,
  layerMergeRenderRuns,
  planMixedSceneLayerMerge,
} from "./layer-merge-core";
import { vectorTextGpuRunBounds } from "./engine-geometry";
import type { VectorTextViewState } from "./vector-text-types";
import {
  borrowLayerMergeColdSeed,
  layerMergeColdSeedIsLiveAuthority,
  restoreBorrowedLayerMergeColdSeedAfterDetachFailure,
  transferBorrowedLayerMergeColdSeedForDetach,
} from "./layer-merge-seed-ownership";
import {
  planMemoryAdmission,
  type MemoryReservation,
  type MemoryRequest,
} from "./memory-governor-core";
import { planLayerMergeCreateMemory } from "./layer-memory-admission-core";

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

function fullDocumentView(engine: BrushEngine): VectorTextViewState {
  return {
    canvasWidth: engine.layerSize,
    canvasHeight: engine.layerSize,
    cssWidth: engine.layerSize,
    cssHeight: engine.layerSize,
    centerX: engine.layerSize * 0.5,
    centerY: engine.layerSize * 0.5,
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
  if (!hot) throw new Error("Texture hot del merge non disponibile.");
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  return {
    texture: hot.texture,
    samplingView: hot.samplingView,
    mipViews: [hot.view],
    mipDownsampleBindGroups: [],
    blendFoldBackdropScratchTexture: null,
    blendFoldBackdropScratchView: null,
    blendFoldScratchTexture: null,
    blendFoldScratchView: null,
    blendFoldUniformBuffer: null,
    blendFoldUniformStride: 0,
    blendFoldTileWidth: 0,
    blendFoldTileHeight: 0,
    bounds: { x: 0, y: 0, width: engine.layerSize, height: engine.layerSize },
    resolutionScale: 1,
    textureWidth: engine.layerSize,
    textureHeight: engine.layerSize,
    mip0MemoryBytes: engine.layerSize * engine.layerSize * bytesPerPixel,
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

async function renderVectorRunInput(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  items: readonly Extract<MixedSceneItem, { kind: "text" | "svg" }>[],
  drawEntries: ReadonlyMap<
    MergeMixedSceneItemsRequest["vectorDraws"][number]["key"],
    MergeMixedSceneItemsRequest["vectorDraws"][number]["draws"]
  >,
  view: VectorTextViewState,
): Promise<DirtyRect | null> {
  const scene = requireMixedSceneStack(engine);
  const draws: MergeMixedSceneItemsRequest["vectorDraws"][number]["draws"][number][] = [];
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
    const itemDraws = drawEntries.get(item.key) ?? [];
    if (itemDraws.length === 0) {
      throw new Error(`Il vettore visibile ${item.key} non contiene draw rasterizzabili.`);
    }
    visibleKeys.push(item.key);
    draws.push(...itemDraws);
  }
  if (draws.length === 0) return null;
  const runBounds = vectorTextGpuRunBounds(draws, view);
  const allocationBounds = alignedMergedSurfaceBounds(runBounds, engine.layerSize);
  const vectorSurface = allocateMergedSurface(
    engine,
    engine.layerFormat,
    "above",
    1,
    allocationBounds,
    1,
    false,
  );
  try {
    const rendered = await renderVectorDrawsToTexture(
      engine,
      draws,
      view,
      { texture: vectorSurface.texture, format: engine.layerFormat },
      vectorSurface.bounds,
    );
    await foldViewIntoMergedSurface(
      engine,
      surface,
      vectorSurface.samplingView,
      vectorSurface.bounds,
      1,
      vectorSurface.textureWidth,
      vectorSurface.textureHeight,
      1,
      rendered.bounds,
      "normal",
      "source-over",
      false,
      `Merge fold vector run ${visibleKeys.join(",")}`,
    );
    return rendered.bounds;
  } finally {
    engine.destroyMergedSurface(vectorSurface);
  }
}

async function renderSingleRasterUnitPreservingParent(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  rasterLayerId: number,
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
      return parent.contentBounds ? { ...parent.contentBounds } : { ...group.bounds };
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
      engine.layerSize,
      engine.layerSize,
      1,
      source.nonTransparentBounds,
      "normal",
      "source-over",
      false,
      `Merge preserve raster ${parent.id}`,
    );
    return { ...source.nonTransparentBounds };
  } finally {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
  }
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
  const drawEntries = new Map(request.vectorDraws.map((entry) => [entry.key, entry.draws]));
  if (drawEntries.size !== request.vectorDraws.length) {
    throw new Error("Draw vettoriali duplicati nella richiesta merge.");
  }
  for (const key of plan.vectorKeys) {
    if (!drawEntries.has(key as Extract<typeof key, `text:${number}` | `svg:${number}`>)) {
      throw new Error(`Draw vettoriali mancanti per ${key}.`);
    }
  }
  for (const key of drawEntries.keys()) {
    if (!plan.vectorKeys.includes(key)) {
      throw new Error(`Draw vettoriali estranei alla selezione: ${key}.`);
    }
  }

  const topName = itemName(engine, plan.items[plan.items.length - 1]);
  const record = engine.layerStack.createDetachedRecord(
    request.name?.trim() || `${topName} · uniti`,
  );
  const gpu = await allocateLayerGpuResources(
    engine,
    engine.layerFormat,
    `Output merge layer ${record.id}`,
  );
  const surface = outputFoldSurface(engine, gpu);
  clearOutputTexture(engine, surface);
  let bounds: DirtyRect | null = null;
  try {
    if (plan.preservesParentPresentation) {
      const parent = engine.layerStack.clippingUnit(plan.rasterLayerIds[0])[0];
      record.visible = parent.visible;
      record.opacity = parent.opacity;
      record.blendMode = parent.blendMode;
      bounds = await renderSingleRasterUnitPreservingParent(
        engine,
        surface,
        plan.rasterLayerIds[0],
      );
    } else {
      record.visible = true;
      record.opacity = 1;
      record.blendMode = "normal";
      const foldedRasterParents = new Set<number>();
      const view = fullDocumentView(engine);
      for (const run of layerMergeRenderRuns(plan.items)) {
        if (run.kind === "raster") {
          const unit = engine.layerStack.clippingUnit(run.item.rasterLayerId);
          const parent = unit[0];
          if (foldedRasterParents.has(parent.id)) continue;
          foldedRasterParents.add(parent.id);
          if (!parent.visible || parent.opacity <= 0 || !parent.hasContent) continue;
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
            );
          if (folded) bounds = mergeDirtyRects(bounds, layerCompositeVisualBounds(engine, parent));
          continue;
        }
        if (run.kind === "image") {
          throw new Error("Nodo immagine non supportato dal merge v1.");
        }
        const vectorBounds = await renderVectorRunInput(
          engine,
          surface,
          run.items,
          drawEntries,
          view,
        );
        bounds = mergeDirtyRects(bounds, vectorBounds);
      }
    }
    releaseLayerBlendFoldScratch(surface);
    await engine.waitForGpuCapped(`Render merge layer ${record.id}`, 60_000);
    record.contentBounds = bounds ? { ...bounds } : null;
    record.hasContent = bounds !== null;
    record.storageTileMask.fill(0);
    if (bounds) markLayerStorageRect(record.storageTileMask, bounds);
    const hot = gpu.hot;
    if (!hot) throw new Error("Output merge privo della texture hot.");
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
    releaseLayerBlendFoldScratch(surface);
    destroyLayerGpuResources(engine, gpu);
    throw error;
  }
}

async function captureRasterInput(
  engine: BrushEngine,
  layerId: number,
  actionId: number,
  sceneIndex: number,
): Promise<LayerMergeHistoryInput> {
  const rasterLayerIndex = engine.layerStack.indexOfId(layerId);
  if (rasterLayerIndex < 0) throw new Error(`Raster ${layerId} assente dal merge.`);
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
        `Snapshot merge da cold compresso livello ${layerId}`,
      );
    } else {
      throw new Error(`Raster ${layerId} con contenuto privo di autorità hot/cold/compressed.`);
    }
  }
  const entry: DeletedLayerEntry = {
    layerRecord: record,
    rasterLayerIndex,
    sceneIndex,
    clippingParentId: record.clippingParentId,
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
    throw new Error("Maschera tile del checkpoint merge incompatibile con il documento.");
  }
  entry.layerRecord.contentBounds = entry.baseBounds ? { ...entry.baseBounds } : null;
  entry.layerRecord.hasContent = entry.baseBounds !== null;
  entry.layerRecord.storageTileMask.set(entry.baseTileMask);
  const gpu = preparedGpu ?? (entry.seed
    ? await hydrateLayerFromSeed(engine, entry.layerRecord.id, entry.seed)
    : await allocateLayerGpuResources(
      engine,
      engine.layerFormat,
      `Redo output merge vuoto ${entry.layerRecord.id}`,
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
        "Attach output merge fallito e compensazione incompleta: ricarica la pagina.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(`${first}; rollback attach output fallito: ${second}`);
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
  return engine.layerSize * engine.layerSize * (engine.layerFormat === "rgba16float" ? 8 : 4);
}

function layerMergeCompressedCpuBytes(engine: BrushEngine): number {
  let bytes = 0;
  for (const gpu of engine.layerGpu.values()) bytes += gpu.compressed?.storedBytes ?? 0;
  return bytes;
}

function layerMergeColdBytesForRecord(engine: BrushEngine, layerId: number): number {
  const record = engine.layerStack.byId(layerId);
  if (!record || !record.hasContent) return 0;
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  return countLayerStorageTiles(coldStorageMaskForRecord(record))
    * LAYER_STORAGE_TILE_SIZE
    * LAYER_STORAGE_TILE_SIZE
    * bytesPerPixel;
}

function layerMergeCreateRequest(
  engine: BrushEngine,
  plan: ReturnType<typeof planMixedSceneLayerMerge>,
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
  const mergedFullBytes = mergedSurfaceMemoryBytes(
    { width: engine.layerSize, height: engine.layerSize },
    engine.layerFormat === "rgba16float" ? 8 : 4,
  ).totalBytes;
  return planLayerMergeCreateMemory({
    fullLayerBytes: full,
    inputSeedBytes,
    outputSeedBytes: full,
    // One source may be rehydrated and baked while the output is folded. The
    // source is streamed, therefore this does not scale with selected layers.
    foldTransientBytes: full * 2 + mergedFullBytes,
  });
}

function reserveLayerMergeCreateMemory(
  engine: BrushEngine,
  plan: ReturnType<typeof planMixedSceneLayerMerge>,
): MemoryReservation {
  const request = layerMergeCreateRequest(engine, plan);
  const decision = planMemoryAdmission(
    {
      committedBytes: engine.gpuResourceRegistry.snapshot().currentBytes,
      reservedBytes: engine.memoryReservations.pendingBytes,
      reclaimableBytes: 0,
      inFlightBytes: layerMergeCompressedCpuBytes(engine),
    },
    engine.memoryGovernorLimits,
    request,
  );
  if (decision.outcome !== "admit") {
    const requiredMiB = request.peakBytes / (1024 * 1024);
    const headroomMiB = Math.max(0, decision.ceilingBytes - decision.usedBytes) / (1024 * 1024);
    throw new Error(
      "Memoria insufficiente per unire i livelli: "
      + `${requiredMiB.toFixed(1)} MiB richiesti, ${headroomMiB.toFixed(1)} MiB disponibili. `
      + "Riduci la selezione o attendi che la cronologia scarichi le copie locali.",
    );
  }
  return engine.memoryReservations.reserve(request);
}

function layerMergeHistoryRequest(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  delta: -1 | 1,
): MemoryRequest {
  const full = layerMergeFullTextureBytes(engine);
  if (delta > 0) {
    return {
      category: "layer-merge-redo",
      // Output hot remains; staged inputs are already in the committed ledger.
      steadyBytes: full,
      // Stored pixels stream directly into output hot; only one outgoing
      // freeze/hydration may overlap it.
      peakBytes: full * 2,
      priority: "normal",
    };
  }

  let clonedColdBytes = 0;
  for (const input of action.inputs) {
    if (input.kind !== "raster" || !input.entry.seed) continue;
    clonedColdBytes += input.entry.seed.memoryBytes;
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
    // Each stored seed becomes its final live cold authority directly; only
    // the bounded active/reference switch overlap is additional.
    peakBytes: steadyBytes + full,
    priority: "normal",
  };
}

function reserveLayerMergeHistoryMemory(
  engine: BrushEngine,
  action: LayerMergeHistoryAction,
  delta: -1 | 1,
): MemoryReservation {
  const request = layerMergeHistoryRequest(engine, action, delta);
  const current = engine.gpuResourceRegistry.snapshot().currentBytes;
  const decision = planMemoryAdmission(
    {
      committedBytes: current,
      reservedBytes: engine.memoryReservations.pendingBytes,
      reclaimableBytes: 0,
      inFlightBytes: layerMergeCompressedCpuBytes(engine),
    },
    engine.memoryGovernorLimits,
    request,
  );
  if (decision.outcome !== "admit") {
    const requiredMiB = request.peakBytes / (1024 * 1024);
    const headroomMiB = Math.max(0, decision.ceilingBytes - decision.usedBytes) / (1024 * 1024);
    throw new Error(
      `Memoria insufficiente per ${delta < 0 ? "Undo" : "Redo"} merge: `
      + `${requiredMiB.toFixed(1)} MiB richiesti, ${headroomMiB.toFixed(1)} MiB disponibili.`,
    );
  }
  return engine.memoryReservations.reserve(request);
}

async function prepareMergeInputGpu(
  engine: BrushEngine,
  entry: DeletedLayerEntry,
): Promise<{ gpu: LayerGpuResources; historyResidenceChanged: boolean }> {
  const seed = entry.seed;
  if (!seed) {
    return { gpu: createColdLayerGpuResources(), historyResidenceChanged: false };
  }
  const restored = await engine.historyLocalStorage
    .restoreStoredColdSeedForDetachedReplay(seed);
  if (restored) {
    return {
      gpu: { hot: null, cold: restored, compressed: null, bake: null, bakeValid: false },
      historyResidenceChanged: false,
    };
  }
  await engine.historyLocalStorage.ensureLayerMergeSeedResident(seed);
  const cold = await cloneLayerColdStorageResources(
    engine,
    seed,
    `Clone cold Undo merge livello ${entry.layerRecord.id}`,
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
    throw new Error(`Raster ${layerId} già presente durante Undo merge.`);
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
    throw new Error(`Raster ${layerId} non disponibile per lo stacco staged.`);
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
    if (detached !== entry.layerRecord) throw new Error(`Stacco staged ${layerId} incoerente.`);
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
        "Stacco staged merge fallito e compensazione incompleta: ricarica la pagina.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${first}; rollback stacco staged fallito: ${second}`);
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
  if (!state) throw new Error(`Snapshot vettoriale ${input.key} già ritirato.`);
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
  if (manageLayerSwitchBusy) engine.layerSwitchBusy = true;
  try {
    engine.persistActiveLayerState();
    await engine.prepareActiveLayerForSwitch();
    // The replacement coexists briefly with its inputs while the active
    // workbench is retargeted. Keeping it invisible makes that drain render
    // the exact pre-merge stack instead of a double-composited frame.
    action.output.layerRecord.visible = false;
    outputGpu = await attachOutput(engine, action, preparedGpu);
    outputAttached = true;
    const outgoingIndex = engine.layerStack.indexOfId(originalActiveId);
    if (outgoingIndex < 0) throw new Error("Raster attivo perso prima del merge.");
    await engine.activateLayer(outgoingIndex, "structural-history");
    await engine.waitForIdle();
    engine.layerPresentationFrozen = true;
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
    if (outputIndex < 0) throw new Error("Output merge perso durante lo stacco input.");
    engine.layerStack.setActiveIndex(outputIndex);
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
      if (originalIndex < 0) throw new Error("Raster attivo originale non ripristinabile.");
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
        "Merge livelli fallito e rollback incompleto: ricarica la pagina.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${first}; rollback merge fallito: ${second}`);
    }
    throw error;
  } finally {
    action.output.layerRecord.visible = outputVisible;
    if (manageLayerSwitchBusy) engine.layerSwitchBusy = false;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.scheduleLayerColdCompression();
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
  if (outputIndex < 0) throw new Error("Output merge assente durante Undo.");
  if (action.payloadsRetiredBelowFloor) {
    throw new Error("Payload merge già ritirati sotto il floor History.");
  }
  for (const input of action.inputs) {
    if (input.kind === "vector" && !input.state) {
      throw new Error(`Snapshot vettoriale ${input.key} già ritirato.`);
    }
    if (input.kind === "raster" && input.entry.baseBounds && !input.entry.seed) {
      throw new Error(`Seed raster ${input.entry.layerRecord.id} già ritirato.`);
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
        if (!vectorState) throw new Error(`Snapshot vettoriale ${input.key} non disponibile.`);
        scene.restoreVectorHistoryState(
          cloneHistoryStateAtOffset(vectorState, 1, action.selectedKeyBefore),
        );
      }
    }

    const restoredActiveIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
    const outgoingIndex = engine.layerStack.indexOfId(outputId);
    if (restoredActiveIndex < 0 || outgoingIndex < 0) {
      throw new Error("Raster attivo o output non disponibile durante Undo merge.");
    }
    const referenceBefore = action.referenceRasterLayerIdBefore;
    if (referenceBefore !== null && referenceBefore !== action.activeRasterLayerIdBefore) {
      const referenceIndex = engine.layerStack.indexOfId(referenceBefore);
      if (referenceIndex < 0) throw new Error("Raster Reference da ripristinare non disponibile.");
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
    if (activeAfterDetach < 0) throw new Error("Raster attivo ripristinato perso durante Undo.");
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
        throw new Error("Output merge rimosso senza risorse staged per il rollback.");
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
      if (restoredOutputIndex < 0) throw new Error("Output merge non ripristinabile.");
      engine.layerStack.setActiveIndex(restoredOutputIndex);
      await engine.activateLayer(restoredOutputIndex, "structural-history");
      if (originalActiveId !== outputId) {
        const originalIndex = engine.layerStack.indexOfId(originalActiveId);
        if (originalIndex < 0) throw new Error("Raster attivo originale perso nel rollback merge.");
        await switchActiveForStructuralHistory(engine, originalIndex);
      }
    } catch (rollbackError) {
      engine.latchDocumentStateInconsistent(
        "Undo merge fallito e rollback incompleto: ricarica la pagina.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${first}; rollback Undo merge fallito: ${second}`);
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
  if (!engine.initialized) throw new Error("Il motore non è inizializzato.");
  engine.assertLayerSwitchAllowed();
  const scene = requireMixedSceneStack(engine);
  if (!engine.admitHistoryPayloadMutation()) {
    throw new Error("Merge rinviato durante il salvataggio della cronologia locale.");
  }
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
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
    memoryReservation = reserveLayerMergeCreateMemory(engine, memoryPlan);
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
        throw new Error("Nodo immagine non supportato dal merge v1.");
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
            "Preparazione merge fallita e banco effetti non ripristinabile: ricarica la pagina.",
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
): Promise<void> {
  if (action.payloadsRetiredBelowFloor) {
    throw new Error("Payload merge gia' ritirati sotto il floor History.");
  }
  // A durable seed may still have a disposable resident cache. Drop every such
  // cache before admission so the ledger describes the smallest authoritative
  // starting state. The transaction then streams at most one missing seed at a
  // time; live Undo layers receive independent cold authorities.
  if (engine.historyLocalStorage.demoteStoredLayerMergeSeeds(action)) {
    engine.historyStorageResidenceChanged();
  }
  const reservation = reserveLayerMergeHistoryMemory(engine, action, delta);
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
