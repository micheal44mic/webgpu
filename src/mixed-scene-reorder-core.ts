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
    throw new Error("La scena mista contiene chiavi duplicate.");
  }
}

function assertRasterModel(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
): void {
  if (rasterLayers.length === 0) {
    throw new Error("Il riordino richiede almeno un livello raster.");
  }
  const ids = rasterLayers.map((entry) => entry.id);
  if (
    new Set(ids).size !== ids.length
    || ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    throw new Error("Gli id raster del riordino devono essere positivi e univoci.");
  }
  const sceneRasterIds = bottomUpKeys
    .map(rasterIdForKey)
    .filter((id): id is number => id !== null);
  if (!arraysEqual(sceneRasterIds, ids)) {
    throw new Error("LayerStack e scena mista hanno un ordine raster incoerente.");
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
      throw new Error(`Parent raster ${entry.clippingParentId} non valido.`);
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
      throw new Error(`Base raster ${parent.id} assente dal riordino.`);
    }
    const expected = [parent.id, ...children];
    expected.forEach((id, offset) => {
      if (
        rasterIds[rasterStart + offset] !== id
        || bottomUpKeys[sceneStart + offset] !== `raster:${id}`
      ) {
        throw new Error(
          `Il gruppo di clipping ${parent.id} deve restare consecutivo.`,
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

function movingBottomUpKeys(
  bottomUpKeys: readonly MixedSceneItem["key"][],
  rasterLayers: readonly MixedSceneRasterOrderEntry[],
  key: MixedSceneItem["key"],
): readonly MixedSceneItem["key"][] {
  if (!bottomUpKeys.includes(key)) {
    throw new Error(`Elemento scena ${key} inesistente.`);
  }
  const rasterId = rasterIdForKey(key);
  if (rasterId === null) return [key];
  const record = rasterLayers.find((entry) => entry.id === rasterId);
  if (!record) throw new Error(`Raster ${rasterId} assente dal LayerStack.`);
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
    throw new Error(`Nessuna destinazione valida per ${key}.`);
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
    throw new Error(`Slot di riordino ${targetTopFirstSlot} non valido per ${key}.`);
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
