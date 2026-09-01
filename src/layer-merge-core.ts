import { LAYER_STACK_MAXIMUM, type LayerStack } from "./layer-stack.ts";
import type {
  MixedSceneItem,
  MixedSceneStack,
  MixedSceneVectorKey,
} from "./mixed-scene-stack";
import type { VectorTextGpuDraw } from "./vector-text-types";

export const LAYER_MERGE_STRATEGY =
  "heterogeneous-contiguous-clipping-closed-transparent-backdrop-advanced-vector-post-composite-opacity-single-atomic-v3" as const;

export interface MixedSceneMergeVectorDraws {
  readonly key: Extract<MixedSceneVectorKey, `text:${number}` | `svg:${number}`>;
  /** Authored visibility used to preserve transparent semantic run boundaries. */
  readonly visible: boolean;
  /** Applied once after this node's unit-opacity draw program is composited. */
  readonly opacity: number;
  readonly draws: readonly VectorTextGpuDraw[];
}

export interface MergeMixedSceneItemsRequest {
  /** Exact bottom-up document order; the engine validates it again. */
  readonly keys: readonly MixedSceneItem["key"][];
  readonly vectorDraws: readonly MixedSceneMergeVectorDraws[];
  readonly name?: string;
}

export interface LayerMergePlan {
  readonly items: readonly MixedSceneItem[];
  readonly sceneIndex: number;
  readonly rasterLayerIndex: number;
  readonly rasterLayerIds: readonly number[];
  readonly vectorKeys: readonly MixedSceneVectorKey[];
  /** A single complete raster unit can keep its parent's outer opacity/mode. */
  readonly preservesParentPresentation: boolean;
  /** Parent modes are exact when the selected interval starts on transparency. */
  readonly bakesParentBlendModesFromTransparentBackdrop: boolean;
}

export type LayerMergeRenderRun =
  | {
    readonly kind: "vector-run";
    readonly items: readonly Extract<MixedSceneItem, { kind: "text" | "svg" }>[];
    /** Applied once after the complete run is resolved. */
    readonly opacity: number;
  }
  | {
    readonly kind: "raster";
    readonly item: Extract<MixedSceneItem, { kind: "raster" }>;
  }
  | {
    readonly kind: "image";
    readonly item: Extract<MixedSceneItem, { kind: "image" }>;
  };

/**
 * Match the live mixed-scene renderer: adjacent opaque text/SVG nodes share one
 * multisampled pass and one resolve. A visible translucent node is isolated so
 * its unit-opacity program can be composited once with the node opacity. Even
 * an empty visible node remains a boundary, while hidden/transparent nodes do
 * not interrupt an otherwise opaque run.
 */
export function layerMergeRenderRuns(
  items: readonly MixedSceneItem[],
  vectorDraws: readonly MixedSceneMergeVectorDraws[] = [],
): readonly LayerMergeRenderRun[] {
  const runs: LayerMergeRenderRun[] = [];
  const vectorDrawsByKey = new Map(vectorDraws.map((entry) => [entry.key, entry]));
  let pendingVectors: Extract<MixedSceneItem, { kind: "text" | "svg" }>[] = [];
  const flushVectors = (): void => {
    if (pendingVectors.length === 0) return;
    runs.push({ kind: "vector-run", items: pendingVectors, opacity: 1 });
    pendingVectors = [];
  };
  for (const item of items) {
    if (item.kind === "text" || item.kind === "svg") {
      const entry = vectorDrawsByKey.get(item.key);
      if (entry?.visible && entry.opacity > 0 && entry.opacity < 1) {
        flushVectors();
        runs.push({ kind: "vector-run", items: [item], opacity: entry.opacity });
        continue;
      }
      pendingVectors.push(item);
      continue;
    }
    flushVectors();
    if (item.kind === "raster") runs.push({ kind: "raster", item });
    else runs.push({ kind: "image", item });
  }
  flushVectors();
  return runs;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Pure conservative planner shared by the public API and verification tests. */
export function planMixedSceneLayerMerge(
  layerStack: LayerStack,
  scene: MixedSceneStack,
  keys: readonly MixedSceneItem["key"][],
): LayerMergePlan {
  if (keys.length < 2) {
    throw new Error("Select at least two consecutive items to merge.");
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error("The merge selection contains duplicate items.");
  }
  const sceneIndex = scene.indexOfKey(keys[0]);
  if (sceneIndex < 0) {
    throw new Error(`The first item, ${keys[0]}, is missing from the scene.`);
  }
  const interval = scene.items.slice(sceneIndex, sceneIndex + keys.length);
  if (!sameKeys(interval.map((item) => item.key), keys)) {
    throw new Error(
      "Items to merge must be contiguous and provided in bottom-to-top order.",
    );
  }
  if (interval.some((item) => item.kind === "image")) {
    throw new Error(
      "Merge v1 does not yet rasterize image nodes: select only raster, text, and SVG items.",
    );
  }
  if (interval.some((item) => scene.clippingGroupRequiresSegmentedComposition(item.key))) {
    throw new Error(
      "Merge does not yet support clipping groups containing editable text or SVG layers.",
    );
  }

  const selectedRasterIds = new Set(
    interval
      .filter((item): item is Extract<MixedSceneItem, { kind: "raster" }> => (
        item.kind === "raster"
      ))
      .map((item) => item.rasterLayerId),
  );
  const visitedParents = new Set<number>();
  const mutableUnits: ReturnType<LayerStack["clippingUnit"]>[] = [];
  for (const rasterId of selectedRasterIds) {
    const unit = layerStack.clippingUnit(rasterId);
    const parent = unit[0];
    if (visitedParents.has(parent.id)) continue;
    visitedParents.add(parent.id);
    const unitKeys = unit.map((record) => `raster:${record.id}` as const);
    if (!unit.every((record) => selectedRasterIds.has(record.id))) {
      throw new Error(
        `Clipping group ${parent.name} must be merged in full.`,
      );
    }
    const firstUnitSceneIndex = scene.indexOfKey(unitKeys[0]);
    const liveUnitKeys = scene.items
      .slice(firstUnitSceneIndex, firstUnitSceneIndex + unitKeys.length)
      .map((item) => item.key);
    if (firstUnitSceneIndex < 0 || !sameKeys(liveUnitKeys, unitKeys)) {
      throw new Error(
        `Clipping group ${parent.name} is not consecutive in the mixed scene.`,
      );
    }
    mutableUnits.push(unit);
  }
  const onlyOneCompleteRasterUnit = mutableUnits.length === 1
    && interval.every((item) => item.kind === "raster")
    && mutableUnits[0].length === interval.length;
  const bakesParentBlendModesFromTransparentBackdrop =
    !onlyOneCompleteRasterUnit && sceneIndex === 0;
  if (!onlyOneCompleteRasterUnit && !bakesParentBlendModesFromTransparentBackdrop) {
    const advancedParent = mutableUnits
      .map((unit) => unit[0])
      .find((record) => record.blendMode !== "normal");
    if (advancedParent) {
      throw new Error(
        `The ${advancedParent.blendMode} blend of ${advancedParent.name} depends on the external `
        + "backdrop. Merge that single complete unit or extend the selection to the bottom "
        + "of the document.",
      );
    }
  }

  const vectorKeys = interval
    .filter((item): item is Extract<MixedSceneItem, { kind: "text" | "svg" }> => (
      item.kind === "text" || item.kind === "svg"
    ))
    .map((item) => item.key);
  const rasterLayerIds = interval
    .filter((item): item is Extract<MixedSceneItem, { kind: "raster" }> => (
      item.kind === "raster"
    ))
    .map((item) => item.rasterLayerId);
  // A semantic-only interval can legally sit between two raster scene rows,
  // but replacing it with a raster must not split an existing clipping unit
  // in the raster-only stack. Reject before allocating/rasterizing anything.
  const rasterLayerIndex = scene.rasterIndexForSceneIndex(sceneIndex);
  const rasterAboveInsertion = rasterLayerIndex < layerStack.count
    ? layerStack.at(rasterLayerIndex)
    : null;
  if (rasterAboveInsertion && rasterAboveInsertion.clippingParentId !== null) {
    const parentIndex = layerStack.indexOfId(rasterAboveInsertion.clippingParentId);
    if (parentIndex >= 0 && parentIndex < rasterLayerIndex) {
      throw new Error(
        "The merge would insert the new raster inside an existing clipping group.",
      );
    }
  }
  const finalRasterCount = layerStack.count - rasterLayerIds.length + 1;
  if (finalRasterCount > LAYER_STACK_MAXIMUM) {
    throw new Error(
      `The merge would produce ${finalRasterCount} rasters, exceeding the limit of `
      + `${LAYER_STACK_MAXIMUM}. Include at least one raster in the selection.`,
    );
  }

  return {
    items: interval,
    sceneIndex,
    rasterLayerIndex,
    rasterLayerIds,
    vectorKeys,
    preservesParentPresentation: onlyOneCompleteRasterUnit,
    bakesParentBlendModesFromTransparentBackdrop,
  };
}
