import type {
  MixedSceneClippingRelation,
  MixedSceneItem,
} from "./mixed-scene-stack";

/**
 * Pure document-order planner used by the mobile drag UI and by the engine
 * commit. It owns no DOM/GPU state: pointer movement may query targets without
 * touching textures, while pointer-up commits the exact same plan once.
 */
export const MIXED_SCENE_REORDER_STRATEGY =
  "top-first-removal-slot-atomic-clipping-unit-exact-order-v1" as const;

export interface MixedSceneRasterOrderEntry {
  readonly id: number;
  readonly clippingParentId: number | null;
}

export interface MixedSceneReorderTargets {
  /** Keys represented by the drag placeholder, in the UI's top-first order. */
  readonly movingKeys: readonly MixedSceneItem["key"][];
  /** Remaining rows, in top-first order, after extracting movingKeys. */
  readonly topFirstKeysWithoutMoving: readonly MixedSceneItem["key"][];
  /**
   * Valid insertion slots in topFirstKeysWithoutMoving. Zero is above every
   * remaining row; length is below every remaining row.
   */
  readonly validTargetTopFirstSlots: readonly number[];
}

export interface MixedSceneReorderPlan extends MixedSceneReorderTargets {
  readonly targetTopFirstSlot: number;
  readonly bottomUpKeys: readonly MixedSceneItem["key"][];
  readonly rasterLayerIds: readonly number[];
  readonly changed: boolean;
}

/** Compact history/rollback payload: stable ids only, never pixels or nodes. */
export interface MixedSceneOrderState {
  readonly bottomUpKeys: readonly MixedSceneItem["key"][];
  readonly rasterLayerIds: readonly number[];
  readonly clippingRelations?: readonly MixedSceneClippingRelation[];
}

export interface MixedSceneRasterInsertionPlan {
  /** Heterogeneous bottom-up insertion index. */
  readonly sceneIndex: number;
  /** Matching insertion index in the raster-only LayerStack. */
  readonly rasterLayerIndex: number;
}

/**
 * Checks whether a compact scene state is still applicable to the live
 * document. Newer states carry their clipping graph; older reorder-only states
 * use the current graph supplied by the caller.
 */
export function isMixedSceneOrderStateApplicable(
  target: MixedSceneOrderState,
  liveBottomUpKeys: readonly MixedSceneItem["key"][],
  liveRasterLayers: readonly MixedSceneRasterOrderEntry[],
  clippingRelations: readonly MixedSceneClippingRelation[] = [],
): boolean {
  const targetClippingRelations = target.clippingRelations ?? clippingRelations;
  const targetCarriesClippingGraph = target.clippingRelations !== undefined
    || clippingRelations.length > 0;
  const liveKeys = new Set(liveBottomUpKeys);
  const targetKeys = new Set(target.bottomUpKeys);
  if (
    liveKeys.size !== liveBottomUpKeys.length
    || targetKeys.size !== target.bottomUpKeys.length
    || target.bottomUpKeys.length !== liveBottomUpKeys.length
    || target.bottomUpKeys.some((key) => !liveKeys.has(key))
  ) {
    return false;
  }

  const liveRasterIds = new Set(liveRasterLayers.map((entry) => entry.id));
  const targetRasterIds = new Set(target.rasterLayerIds);
  if (
    liveRasterIds.size !== liveRasterLayers.length
    || targetRasterIds.size !== target.rasterLayerIds.length
    || target.rasterLayerIds.length !== liveRasterLayers.length
    || target.rasterLayerIds.some((id) => !liveRasterIds.has(id))
  ) {
    return false;
  }

  const liveRasterById = new Map(liveRasterLayers.map((entry) => [entry.id, entry]));
  const targetParentByChild = new Map(
    targetClippingRelations.map((relation) => [relation.childKey, relation.parentKey]),
  );
  const targetRasterOrder: MixedSceneRasterOrderEntry[] = [];
  for (const id of target.rasterLayerIds) {
    const entry = liveRasterById.get(id);
    if (!entry) return false;
    const parentKey = targetParentByChild.get(`raster:${id}`);
    const clippingParentId = targetCarriesClippingGraph
      ? parentKey?.startsWith("raster:")
        ? Number(parentKey.slice("raster:".length))
        : null
      : entry.clippingParentId;
    if (clippingParentId !== null && !Number.isInteger(clippingParentId)) {
      return false;
    }
    targetRasterOrder.push({ id, clippingParentId });
  }
  try {
    assertValidMixedSceneOrder(
      target.bottomUpKeys,
      targetRasterOrder,
      targetClippingRelations,
    );
    return true;
  } catch {
    return false;
  }
}

function rasterIdForKey(key: MixedSceneItem["key"]): number | null {
  if (!key.startsWith("raster:")) return null;
  const id = Number(key.slice("raster:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertUniqueKeys(keys: readonly MixedSceneItem["key"][]): void {
  if (new Set(keys).size !== keys.length) {
    throw new Error("The mixed scene contains duplicate keys.");
  }
}

function assertRasterModel(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
): void {
  if (rasterLayers.length === 0) {
    throw new Error("Reordering requires at least one raster layer.");
  }
  const ids = rasterLayers.map((entry) => entry.id);
  if (
    new Set(ids).size !== ids.length
    || ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    throw new Error("Raster IDs in the reorder model must be positive and unique.");
  }
  const sceneRasterIds = bottomUpKeys
    .map(rasterIdForKey)
    .filter((id): id is number => id !== null);
  if (!arraysEqual(sceneRasterIds, ids)) {
    throw new Error("LayerStack and the mixed scene have inconsistent raster order.");
  }
}

interface MixedSceneClippingModel {
  readonly parentByChild: ReadonlyMap<
    MixedSceneItem["key"],
    MixedSceneItem["key"]
  >;
  readonly childrenByParent: ReadonlyMap<
    MixedSceneItem["key"],
    readonly MixedSceneItem["key"][]
  >;
}

function isClippingCapableKey(
  key: MixedSceneItem["key"],
): key is Extract<
  MixedSceneItem["key"],
  `raster:${number}` | `text:${number}` | `svg:${number}`
> {
  return key.startsWith("raster:")
    || key.startsWith("text:")
    || key.startsWith("svg:");
}

/**
 * Builds one authoritative clipping graph from the retained raster projection
 * and the heterogeneous scene relations. Matching raster-to-raster entries are
 * intentionally deduplicated; any disagreement is a structural error rather
 * than a last-writer-wins choice.
 */
function mixedSceneClippingModel(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  clippingRelations: readonly MixedSceneClippingRelation[],
): MixedSceneClippingModel {
  const keySet = new Set(bottomUpKeys);
  const parentByChild = new Map<
    MixedSceneItem["key"],
    MixedSceneItem["key"]
  >();
  const addRelation = (
    childKey: MixedSceneItem["key"],
    parentKey: MixedSceneItem["key"],
    source: "raster" | "scene",
  ): void => {
    if (!keySet.has(childKey)) {
      throw new Error(`Clipping child ${childKey} is missing from the scene.`);
    }
    if (!keySet.has(parentKey)) {
      throw new Error(`Clipping base ${parentKey} is missing from the scene.`);
    }
    if (!isClippingCapableKey(childKey) || !isClippingCapableKey(parentKey)) {
      throw new Error("Only raster, text, and SVG layers can participate in clipping.");
    }
    const existing = parentByChild.get(childKey);
    if (existing !== undefined) {
      if (existing !== parentKey) {
        throw new Error(
          `Clipping child ${childKey} has conflicting bases ${existing} and ${parentKey}.`,
        );
      }
      if (source === "scene") {
        // One equal raster projection plus one generic relation is expected.
        // Equal generic duplicates, however, are malformed input.
        return;
      }
      throw new Error(`Clipping child ${childKey} has more than one base.`);
    }
    parentByChild.set(childKey, parentKey);
  };

  for (const layer of rasterLayers) {
    if (layer.clippingParentId === null) continue;
    addRelation(
      `raster:${layer.id}`,
      `raster:${layer.clippingParentId}`,
      "raster",
    );
  }
  const genericChildren = new Set<MixedSceneItem["key"]>();
  for (const relation of clippingRelations) {
    if (genericChildren.has(relation.childKey)) {
      throw new Error(`Clipping child ${relation.childKey} has more than one scene relation.`);
    }
    genericChildren.add(relation.childKey);
    addRelation(relation.childKey, relation.parentKey, "scene");
  }

  for (const [childKey, parentKey] of parentByChild) {
    if (childKey === parentKey || parentByChild.has(parentKey)) {
      throw new Error("Clipping chains are not supported.");
    }
  }

  const childrenByParent = new Map<
    MixedSceneItem["key"],
    MixedSceneItem["key"][]
  >();
  for (const key of bottomUpKeys) {
    const parentKey = parentByChild.get(key);
    if (parentKey === undefined) continue;
    const children = childrenByParent.get(parentKey) ?? [];
    children.push(key);
    childrenByParent.set(parentKey, children);
  }
  return { parentByChild, childrenByParent };
}

/**
 * Validates both raster-only and heterogeneous clipping invariants. A base and
 * every child are consecutive not only among raster records, but also among
 * scene rows: text/SVG/image can never be dropped inside a clipping unit.
 */
function assertClippingOrder(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  clippingRelations: readonly MixedSceneClippingRelation[] = [],
): MixedSceneClippingModel {
  const model = mixedSceneClippingModel(
    bottomUpKeys,
    rasterLayers,
    clippingRelations,
  );
  const indexByKey = new Map(
    bottomUpKeys.map((key, index) => [key, index] as const),
  );
  for (const [parentKey, children] of model.childrenByParent) {
    const parentIndex = indexByKey.get(parentKey);
    if (parentIndex === undefined) {
      throw new Error(`Clipping base ${parentKey} is missing from the reorder model.`);
    }
    children.forEach((childKey, offset) => {
      if (bottomUpKeys[parentIndex + offset + 1] !== childKey) {
        throw new Error(`Clipping group ${parentKey} must remain consecutive.`);
      }
    });
  }
  return model;
}

export function assertValidMixedSceneOrder(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  clippingRelations: readonly MixedSceneClippingRelation[] = [],
): void {
  assertUniqueKeys(bottomUpKeys);
  assertRasterModel(bottomUpKeys, rasterLayers);
  assertClippingOrder(bottomUpKeys, rasterLayers, clippingRelations);
}

/**
 * Plans Add from one authoritative heterogeneous slot. Deriving the two
 * indices independently can put the same raster on opposite sides of a vector
 * in MixedSceneStack and LayerStack, after which reorder and History cannot
 * validate either model.
 */
export function planMixedSceneRasterInsertion(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  selectedKey: MixedSceneItem["key"],
  clippingParentId: number | null,
  clippingRelations: readonly MixedSceneClippingRelation[] = [],
): MixedSceneRasterInsertionPlan {
  assertValidMixedSceneOrder(bottomUpKeys, rasterLayers, clippingRelations);
  const selectedSceneIndex = bottomUpKeys.indexOf(selectedKey);
  if (selectedSceneIndex < 0) {
    throw new Error(`Scene item ${selectedKey} does not exist.`);
  }
  const rasterById = new Map(rasterLayers.map((entry) => [entry.id, entry]));
  const clipping = assertClippingOrder(
    bottomUpKeys,
    rasterLayers,
    clippingRelations,
  );
  let baseKey = clipping.parentByChild.get(selectedKey) ?? selectedKey;
  if (clippingParentId !== null) {
    const parent = rasterById.get(clippingParentId);
    if (!parent || parent.clippingParentId !== null) {
      throw new Error(`Invalid raster parent ${clippingParentId}.`);
    }
    baseKey = `raster:${parent.id}`;
  }
  const unit = [baseKey, ...(clipping.childrenByParent.get(baseKey) ?? [])];
  const lastSceneIndex = bottomUpKeys.indexOf(unit[unit.length - 1]);
  if (lastSceneIndex < 0) {
    throw new Error(`Clipping unit ${baseKey} is missing from the scene.`);
  }
  const sceneIndex = lastSceneIndex + 1;

  const rasterLayerIndex = bottomUpKeys
    .slice(0, sceneIndex)
    .reduce((count, key) => count + Number(rasterIdForKey(key) !== null), 0);
  const maximumRasterId = Math.max(0, ...rasterLayers.map((entry) => entry.id));
  if (maximumRasterId >= Number.MAX_SAFE_INTEGER) {
    throw new Error("No diagnostic raster ID is available to validate the insertion.");
  }
  const candidateId = maximumRasterId + 1;
  const candidateKeys = [...bottomUpKeys];
  candidateKeys.splice(sceneIndex, 0, `raster:${candidateId}` as const);
  const candidateRasterLayers = [...rasterLayers];
  candidateRasterLayers.splice(rasterLayerIndex, 0, {
    id: candidateId,
    clippingParentId,
  });
  assertValidMixedSceneOrder(
    candidateKeys,
    candidateRasterLayers,
    clippingRelations,
  );
  return { sceneIndex, rasterLayerIndex };
}

function movingBottomUpKeys(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  key: MixedSceneItem["key"],
  clipping: MixedSceneClippingModel,
): readonly MixedSceneItem["key"][] {
  if (!bottomUpKeys.includes(key)) {
    throw new Error(`Scene item ${key} does not exist.`);
  }
  if (clipping.parentByChild.has(key)) return [key];
  return [
    key,
    ...(clipping.childrenByParent.get(key) ?? []),
  ];
}

function candidateForSlot(
  topFirstKeysWithoutMoving: readonly MixedSceneItem["key"][],
  movingKeys: readonly MixedSceneItem["key"][],
  targetTopFirstSlot: number,
): readonly MixedSceneItem["key"][] {
  return [
    ...topFirstKeysWithoutMoving.slice(0, targetTopFirstSlot),
    ...movingKeys,
    ...topFirstKeysWithoutMoving.slice(targetTopFirstSlot),
  ].reverse();
}

export function mixedSceneReorderTargets(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  key: MixedSceneItem["key"],
  clippingRelations: readonly MixedSceneClippingRelation[] = [],
): MixedSceneReorderTargets {
  assertValidMixedSceneOrder(bottomUpKeys, rasterLayers, clippingRelations);
  const clipping = assertClippingOrder(
    bottomUpKeys,
    rasterLayers,
    clippingRelations,
  );

  const movingBottomUp = movingBottomUpKeys(bottomUpKeys, key, clipping);
  const movingSet = new Set(movingBottomUp);
  const movingKeys = [...movingBottomUp].reverse();
  const topFirstKeysWithoutMoving = [...bottomUpKeys]
    .reverse()
    .filter((candidate) => !movingSet.has(candidate));
  const validTargetTopFirstSlots: number[] = [];
  for (let slot = 0; slot <= topFirstKeysWithoutMoving.length; slot += 1) {
    const candidate = candidateForSlot(topFirstKeysWithoutMoving, movingKeys, slot);
    try {
      assertClippingOrder(candidate, rasterLayers, clippingRelations);
      validTargetTopFirstSlots.push(slot);
    } catch {
      // Invalid drop gaps remain absent from the UI model and never reach GPU.
    }
  }
  if (validTargetTopFirstSlots.length === 0) {
    throw new Error(`No valid destination is available for ${key}.`);
  }
  return {
    movingKeys,
    topFirstKeysWithoutMoving,
    validTargetTopFirstSlots,
  };
}

export function planMixedSceneReorder(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  key: MixedSceneItem["key"],
  targetTopFirstSlot: number,
  clippingRelations: readonly MixedSceneClippingRelation[] = [],
): MixedSceneReorderPlan {
  const targets = mixedSceneReorderTargets(
    bottomUpKeys,
    rasterLayers,
    key,
    clippingRelations,
  );
  if (
    !Number.isInteger(targetTopFirstSlot)
    || !targets.validTargetTopFirstSlots.includes(targetTopFirstSlot)
  ) {
    throw new Error(`Invalid reorder slot ${targetTopFirstSlot} for ${key}.`);
  }
  const reorderedBottomUpKeys = candidateForSlot(
    targets.topFirstKeysWithoutMoving,
    targets.movingKeys,
    targetTopFirstSlot,
  );
  const rasterLayerIds = reorderedBottomUpKeys
    .map(rasterIdForKey)
    .filter((id): id is number => id !== null);
  return {
    ...targets,
    targetTopFirstSlot,
    bottomUpKeys: reorderedBottomUpKeys,
    rasterLayerIds,
    changed: !arraysEqual(reorderedBottomUpKeys, bottomUpKeys),
  };
}
