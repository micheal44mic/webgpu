import type { MixedSceneItem } from "./mixed-scene-stack";

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
}

export interface MixedSceneRasterInsertionPlan {
  /** Heterogeneous bottom-up insertion index. */
  readonly sceneIndex: number;
  /** Matching insertion index in the raster-only LayerStack. */
  readonly rasterLayerIndex: number;
}

/**
 * Checks whether a compact history order is still applicable to the live
 * document. Clipping membership is deliberately read from the current raster
 * records: clipping changes are not journalled, so an old permutation that
 * would now split a clipping unit must be refused before Undo/Redo starts.
 */
export function isMixedSceneOrderStateApplicable(
  target: MixedSceneOrderState,
  liveBottomUpKeys: readonly MixedSceneItem["key"][],
  liveRasterLayers: readonly MixedSceneRasterOrderEntry[],
): boolean {
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
  const targetRasterOrder: MixedSceneRasterOrderEntry[] = [];
  for (const id of target.rasterLayerIds) {
    const entry = liveRasterById.get(id);
    if (!entry) return false;
    targetRasterOrder.push(entry);
  }
  try {
    assertValidMixedSceneOrder(target.bottomUpKeys, targetRasterOrder);
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

/**
 * Validates both raster-only and heterogeneous clipping invariants. A base and
 * every child are consecutive not only among raster records, but also among
 * scene rows: text/SVG/image can never be dropped inside a clipping unit.
 */
function assertClippingOrder(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayersById: ReadonlyMap<number, MixedSceneRasterOrderEntry>,
): void {
  const rasterIds = bottomUpKeys
    .map(rasterIdForKey)
    .filter((id): id is number => id !== null);
  const rasterIndexById = new Map(rasterIds.map((id, index) => [id, index]));
  const sceneIndexByRasterId = new Map<number, number>();
  bottomUpKeys.forEach((key, index) => {
    const id = rasterIdForKey(key);
    if (id !== null) sceneIndexByRasterId.set(id, index);
  });

  for (const entry of rasterLayersById.values()) {
    if (entry.clippingParentId === null) continue;
    const parent = rasterLayersById.get(entry.clippingParentId);
    if (!parent || parent.clippingParentId !== null) {
      throw new Error(`Invalid raster parent ${entry.clippingParentId}.`);
    }
  }

  for (const parent of rasterLayersById.values()) {
    if (parent.clippingParentId !== null) continue;
    const children = rasterIds.filter((id) =>
      rasterLayersById.get(id)?.clippingParentId === parent.id
    );
    if (children.length === 0) continue;
    const rasterStart = rasterIndexById.get(parent.id);
    const sceneStart = sceneIndexByRasterId.get(parent.id);
    if (rasterStart === undefined || sceneStart === undefined) {
      throw new Error(`Base raster ${parent.id} is missing from the reorder model.`);
    }
    const expected = [parent.id, ...children];
    expected.forEach((id, offset) => {
      if (
        rasterIds[rasterStart + offset] !== id
        || bottomUpKeys[sceneStart + offset] !== `raster:${id}`
      ) {
        throw new Error(
          `Clipping group ${parent.id} must remain consecutive.`,
        );
      }
    });
  }
}

export function assertValidMixedSceneOrder(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
): void {
  assertUniqueKeys(bottomUpKeys);
  assertRasterModel(bottomUpKeys, rasterLayers);
  assertClippingOrder(
    bottomUpKeys,
    new Map(rasterLayers.map((entry) => [entry.id, entry])),
  );
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
): MixedSceneRasterInsertionPlan {
  assertValidMixedSceneOrder(bottomUpKeys, rasterLayers);
  const selectedSceneIndex = bottomUpKeys.indexOf(selectedKey);
  if (selectedSceneIndex < 0) {
    throw new Error(`Scene item ${selectedKey} does not exist.`);
  }
  const rasterById = new Map(rasterLayers.map((entry) => [entry.id, entry]));
  const selectedRasterId = rasterIdForKey(selectedKey);
  let sceneIndex = selectedSceneIndex + 1;

  if (clippingParentId !== null || selectedRasterId !== null) {
    const anchorId = clippingParentId ?? selectedRasterId;
    if (anchorId === null) {
      throw new Error("The raster insertion anchor is missing.");
    }
    const anchor = rasterById.get(anchorId);
    if (!anchor) throw new Error(`Raster ${anchorId} is missing from LayerStack.`);
    const parentId = clippingParentId ?? anchor.clippingParentId ?? anchor.id;
    const parent = rasterById.get(parentId);
    if (!parent || parent.clippingParentId !== null) {
      throw new Error(`Invalid raster parent ${parentId}.`);
    }
    const unitIds = [
      parent.id,
      ...rasterLayers
        .filter((entry) => entry.clippingParentId === parent.id)
        .map((entry) => entry.id),
    ];
    const lastKey = `raster:${unitIds[unitIds.length - 1]}` as const;
    const lastSceneIndex = bottomUpKeys.indexOf(lastKey);
    if (lastSceneIndex < 0) {
      throw new Error(`Raster group ${parent.id} is missing from the scene.`);
    }
    sceneIndex = lastSceneIndex + 1;
  }

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
  assertValidMixedSceneOrder(candidateKeys, candidateRasterLayers);
  return { sceneIndex, rasterLayerIndex };
}

function movingBottomUpKeys(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  key: MixedSceneItem["key"],
): readonly MixedSceneItem["key"][] {
  if (!bottomUpKeys.includes(key)) {
    throw new Error(`Scene item ${key} does not exist.`);
  }
  const rasterId = rasterIdForKey(key);
  if (rasterId === null) return [key];
  const record = rasterLayers.find((entry) => entry.id === rasterId);
  if (!record) throw new Error(`Raster ${rasterId} is missing from LayerStack.`);
  if (record.clippingParentId !== null) return [key];
  return [
    key,
    ...rasterLayers
      .filter((entry) => entry.clippingParentId === rasterId)
      .map((entry) => `raster:${entry.id}` as const),
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
): MixedSceneReorderTargets {
  assertValidMixedSceneOrder(bottomUpKeys, rasterLayers);
  const rasterLayersById = new Map(rasterLayers.map((entry) => [entry.id, entry]));

  const movingBottomUp = movingBottomUpKeys(bottomUpKeys, rasterLayers, key);
  const movingSet = new Set(movingBottomUp);
  const movingKeys = [...movingBottomUp].reverse();
  const topFirstKeysWithoutMoving = [...bottomUpKeys]
    .reverse()
    .filter((candidate) => !movingSet.has(candidate));
  const validTargetTopFirstSlots: number[] = [];
  for (let slot = 0; slot <= topFirstKeysWithoutMoving.length; slot += 1) {
    const candidate = candidateForSlot(topFirstKeysWithoutMoving, movingKeys, slot);
    try {
      assertClippingOrder(candidate, rasterLayersById);
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
): MixedSceneReorderPlan {
  const targets = mixedSceneReorderTargets(bottomUpKeys, rasterLayers, key);
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
