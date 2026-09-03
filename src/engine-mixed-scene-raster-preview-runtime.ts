import type { BrushEngine } from "./brush-engine";
import type { MixedSceneItem } from "./mixed-scene-stack";
import {
  mixedSceneRasterPreviewTransformsEqual,
  mixedSceneRasterSegmentUniformValues,
  normalizeMixedSceneRasterTransformPreview,
  type MixedSceneRasterTransformPreview,
  type NormalizedMixedSceneRasterTransformPreview,
} from "./mixed-scene-raster-transform-preview";

interface MixedSceneRasterPreviewState {
  requested: Map<number, NormalizedMixedSceneRasterTransformPreview>;
  requestedSignature: string;
  prepared: Map<number, NormalizedMixedSceneRasterTransformPreview>;
  preparedSignature: string;
  compositionLayerIds: ReadonlySet<number>;
  processing: Promise<void> | null;
}

const states = new WeakMap<BrushEngine, MixedSceneRasterPreviewState>();

function stateFor(engine: BrushEngine): MixedSceneRasterPreviewState {
  const existing = states.get(engine);
  if (existing) return existing;
  const created: MixedSceneRasterPreviewState = {
    requested: new Map(),
    requestedSignature: "",
    prepared: new Map(),
    preparedSignature: "",
    compositionLayerIds: new Set(),
    processing: null,
  };
  states.set(engine, created);
  return created;
}

function signatureFor(ids: Iterable<number>): string {
  return [...ids].sort((left, right) => left - right).join(",");
}

function copyTransforms(
  values: ReadonlyMap<number, NormalizedMixedSceneRasterTransformPreview>,
): Map<number, NormalizedMixedSceneRasterTransformPreview> {
  return new Map([...values].map(([id, value]) => [id, { ...value }]));
}

function normalizedPreviewMap(
  engine: BrushEngine,
  values: readonly MixedSceneRasterTransformPreview[],
): Map<number, NormalizedMixedSceneRasterTransformPreview> {
  const result = new Map<number, NormalizedMixedSceneRasterTransformPreview>();
  for (const value of values) {
    const normalized = normalizeMixedSceneRasterTransformPreview(value);
    if (result.has(normalized.rasterLayerId)) {
      throw new Error(`Raster ${normalized.rasterLayerId} has two preview transforms.`);
    }
    const item = engine.mixedSceneStack?.itemByKey(normalized.key);
    if (!item || item.kind !== "raster") {
      throw new Error(`Raster preview ${normalized.key} is missing from the mixed scene.`);
    }
    result.set(normalized.rasterLayerId, normalized);
  }
  return result;
}

function writePreparedPreviewUniforms(
  engine: BrushEngine,
  transforms: ReadonlyMap<number, NormalizedMixedSceneRasterTransformPreview>,
): void {
  for (const resources of engine.mixedSceneRasterSegments) {
    const layerId = resources.rasterLayerId;
    if (layerId === null) continue;
    const transform = transforms.get(layerId);
    if (!transform) continue;
    engine.device.queue.writeBuffer(
      resources.uniformBuffer,
      0,
      mixedSceneRasterSegmentUniformValues(
        resources.surface,
        resources.opacity,
        transform,
      ),
    );
    if (resources.documentCutoutBaseUniformBuffer && resources.documentCutoutBaseSurface) {
      engine.device.queue.writeBuffer(
        resources.documentCutoutBaseUniformBuffer,
        0,
        mixedSceneRasterSegmentUniformValues(
          resources.documentCutoutBaseSurface,
          1,
          transform,
        ),
      );
    }
    if (resources.documentCutoutMaskUniformBuffer && resources.documentCutoutMaskSurface) {
      engine.device.queue.writeBuffer(
        resources.documentCutoutMaskUniformBuffer,
        0,
        mixedSceneRasterSegmentUniformValues(
          resources.documentCutoutMaskSurface,
          1,
          transform,
        ),
      );
    }
  }
  engine.presentationCacheNeedsFullRebuild = true;
  engine.displayDirty = true;
  engine.requestRender();
}

async function restorePreparedStructureAfterFailure(
  engine: BrushEngine,
  state: MixedSceneRasterPreviewState,
  previousIds: ReadonlySet<number>,
  previousSignature: string,
  previousTransforms: ReadonlyMap<number, NormalizedMixedSceneRasterTransformPreview>,
): Promise<void> {
  state.compositionLayerIds = new Set(previousIds);
  state.requested = copyTransforms(previousTransforms);
  state.requestedSignature = previousSignature;
  state.prepared = copyTransforms(previousTransforms);
  state.preparedSignature = previousSignature;
  await engine.rebuildMergedLayerSurfaces(
    "layer-switch",
    engine.getVectorTextViewState(),
    { reuseUnchangedRasterRuns: true },
  );
  if (previousTransforms.size > 0) {
    writePreparedPreviewUniforms(engine, previousTransforms);
  }
}

async function processStructuralRequests(
  engine: BrushEngine,
  state: MixedSceneRasterPreviewState,
): Promise<void> {
  while (state.preparedSignature !== state.requestedSignature) {
    await engine.waitForIdle();
    const targetTransforms = copyTransforms(state.requested);
    const targetSignature = state.requestedSignature;
    const targetIds = new Set(targetTransforms.keys());
    const previousIds = state.compositionLayerIds;
    const previousSignature = state.preparedSignature;
    const previousTransforms = copyTransforms(state.prepared);
    state.compositionLayerIds = targetIds;
    try {
      await engine.rebuildMergedLayerSurfaces(
        "layer-switch",
        engine.getVectorTextViewState(),
        { reuseUnchangedRasterRuns: true },
      );
    } catch (error) {
      try {
        await restorePreparedStructureAfterFailure(
          engine,
          state,
          previousIds,
          previousSignature,
          previousTransforms,
        );
      } catch (restoreError) {
        engine.latchDocumentStateInconsistent(
          "The raster transform preview could not restore its presentation. Reload before continuing.",
          restoreError,
        );
      }
      throw error;
    }
    state.prepared = targetTransforms;
    state.preparedSignature = targetSignature;
    if (targetSignature === state.requestedSignature) {
      state.prepared = copyTransforms(state.requested);
      if (state.prepared.size > 0) {
        writePreparedPreviewUniforms(engine, state.prepared);
      } else {
        engine.presentationCacheNeedsFullRebuild = true;
        engine.displayDirty = true;
        engine.requestRender();
      }
    }
  }
}

/**
 * Starts or updates a non-destructive raster presentation. Changing the exact
 * set of keys rebuilds segment boundaries once; changing only affine values
 * writes uniforms and requests a frame without rebuilding raster surfaces.
 */
export function setMixedSceneRasterTransformPreview(
  engine: BrushEngine,
  values: readonly MixedSceneRasterTransformPreview[],
): Promise<void> {
  const state = stateFor(engine);
  const next = normalizedPreviewMap(engine, values);
  const valuesChanged = !mixedSceneRasterPreviewTransformsEqual(state.requested, next);
  const nextSignature = signatureFor(next.keys());
  state.requested = next;
  state.requestedSignature = nextSignature;

  if (nextSignature === state.preparedSignature) {
    if (valuesChanged && next.size > 0) {
      state.prepared = copyTransforms(next);
      writePreparedPreviewUniforms(engine, next);
    }
    return state.processing ?? Promise.resolve();
  }
  if (!state.processing) {
    state.processing = processStructuralRequests(engine, state).finally(() => {
      state.processing = null;
    });
  }
  return state.processing;
}

export function clearMixedSceneRasterTransformPreview(engine: BrushEngine): Promise<void> {
  return setMixedSceneRasterTransformPreview(engine, []);
}

/** Uniform-only hot path. The exact key set must have been prepared first. */
export function updateMixedSceneRasterTransformPreview(
  engine: BrushEngine,
  values: readonly MixedSceneRasterTransformPreview[],
): void {
  const state = stateFor(engine);
  const next = normalizedPreviewMap(engine, values);
  const signature = signatureFor(next.keys());
  if (
    state.processing
    || signature !== state.preparedSignature
    || signature !== state.requestedSignature
  ) {
    throw new Error(
      "The raster transform preview key set must be prepared before a live update.",
    );
  }
  if (mixedSceneRasterPreviewTransformsEqual(state.prepared, next)) return;
  state.requested = next;
  state.prepared = copyTransforms(next);
  if (next.size > 0) writePreparedPreviewUniforms(engine, next);
}

/** IDs used by the currently published or in-flight composition plan. */
export function mixedSceneRasterTransformPreviewCompositionLayerIds(
  engine: BrushEngine,
): ReadonlySet<number> {
  return stateFor(engine).compositionLayerIds;
}

/** The published transform whose values were last written to segment uniforms. */
export function mixedScenePreparedRasterTransformPreview(
  engine: BrushEngine,
  layerId: number,
): Readonly<NormalizedMixedSceneRasterTransformPreview> | null {
  return stateFor(engine).prepared.get(layerId) ?? null;
}

export function mixedSceneRasterTransformPreviewUsesSegmentedClipping(
  engine: BrushEngine,
  key: MixedSceneItem["key"],
): boolean {
  const scene = engine.mixedSceneStack;
  if (!scene) return false;
  const group = scene.clippingGroupKeys(key);
  if (group.length <= 1) return false;
  const selected = stateFor(engine).compositionLayerIds;
  return group.some((candidate) => {
    const item = scene.itemByKey(candidate);
    return item.kind === "raster" && selected.has(item.rasterLayerId);
  });
}

export function mixedSceneRasterTransformPreviewHasSegmentedClipping(
  engine: BrushEngine,
): boolean {
  const scene = engine.mixedSceneStack;
  if (!scene) return false;
  return [...stateFor(engine).compositionLayerIds].some((layerId) =>
    scene.clippingGroupKeys(`raster:${layerId}`).length > 1
  );
}
