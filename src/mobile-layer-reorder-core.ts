export const MOBILE_LAYER_REORDER_HOLD_MS = 320;
export const MOBILE_LAYER_REORDER_SLOP_PX = 8;
export const MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX = 36;
export const MOBILE_LAYER_REORDER_AUTO_SCROLL_MAX_PX_PER_SECOND = 520;

export interface MobileLayerReorderItem {
  readonly key: string;
  /** Raster clipping parent in the same top-first list, or null. */
  readonly clippingParentKey: string | null;
}

export interface MobileLayerReorderPlan {
  readonly selectedKey: string;
  readonly draggedKeys: readonly string[];
  readonly remainingKeys: readonly string[];
  readonly validSlots: readonly number[];
  /** Slot in `remainingKeys` that recreates the current document order. */
  readonly originalSlot: number;
}

function assertUniqueItems(items: readonly MobileLayerReorderItem[]): void {
  const keys = new Set<string>();
  for (const item of items) {
    if (keys.has(item.key)) {
      throw new Error(`Duplicate mobile layer key ${item.key}.`);
    }
    keys.add(item.key);
  }
  for (const item of items) {
    if (item.clippingParentKey !== null && !keys.has(item.clippingParentKey)) {
      throw new Error(`Missing clipping parent ${item.clippingParentKey}.`);
    }
  }
}

function clippingRoot(
  item: MobileLayerReorderItem,
  childParentKeys: ReadonlySet<string>,
): string {
  if (item.clippingParentKey !== null) return item.clippingParentKey;
  return childParentKeys.has(item.key) ? item.key : `single:${item.key}`;
}

/**
 * Creates the top-first, UI-only reorder plan. A clipping base moves together
 * with all of its masks; an individual mask may only change order inside its
 * existing clipping group. Ordinary raster/vector items can be inserted only
 * at boundaries that do not split a clipping group.
 */
export function buildMobileLayerReorderPlan(
  items: readonly MobileLayerReorderItem[],
  selectedKey: string,
): MobileLayerReorderPlan | null {
  assertUniqueItems(items);
  const selectedIndex = items.findIndex((item) => item.key === selectedKey);
  if (selectedIndex < 0) return null;
  const selected = items[selectedIndex];
  const childParentKeys = new Set(
    items.flatMap((item) => item.clippingParentKey === null ? [] : [item.clippingParentKey]),
  );

  let draggedItems: readonly MobileLayerReorderItem[];
  if (selected.clippingParentKey === null && childParentKeys.has(selected.key)) {
    draggedItems = items.filter(
      (item) => item.key === selected.key || item.clippingParentKey === selected.key,
    );
  } else {
    draggedItems = [selected];
  }
  const draggedKeys = draggedItems.map((item) => item.key);
  const draggedKeySet = new Set(draggedKeys);
  const remaining = items.filter((item) => !draggedKeySet.has(item.key));
  const remainingKeys = remaining.map((item) => item.key);
  const originalSlot = items
    .slice(0, Math.min(...draggedItems.map((item) => items.indexOf(item))))
    .filter((item) => !draggedKeySet.has(item.key)).length;

  let validSlots: number[] = [];
  if (selected.clippingParentKey !== null) {
    const parentIndex = remaining.findIndex(
      (item) => item.key === selected.clippingParentKey,
    );
    if (parentIndex < 0) return null;
    let groupStart = parentIndex;
    while (
      groupStart > 0
      && remaining[groupStart - 1].clippingParentKey === selected.clippingParentKey
    ) {
      groupStart -= 1;
    }
    // The parent is the bottom-most item in a top-first clipping group. Slots
    // from groupStart through parentIndex insert the mask above that parent.
    for (let slot = groupStart; slot <= parentIndex; slot += 1) {
      validSlots.push(slot);
    }
  } else {
    for (let slot = 0; slot <= remaining.length; slot += 1) {
      const above = slot > 0 ? remaining[slot - 1] : null;
      const below = slot < remaining.length ? remaining[slot] : null;
      if (
        above
        && below
        && clippingRoot(above, childParentKeys) === clippingRoot(below, childParentKeys)
      ) {
        continue;
      }
      validSlots.push(slot);
    }
  }

  if (!validSlots.includes(originalSlot)) {
    validSlots = [...validSlots, originalSlot].sort((a, b) => a - b);
  }
  return {
    selectedKey,
    draggedKeys,
    remainingKeys,
    validSlots,
    originalSlot,
  };
}

export function mobileLayerReorderMovementExceeded(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) > MOBILE_LAYER_REORDER_SLOP_PX;
}

/** Pointer-up fallback for browsers that throttle the hold timer. */
export function mobileLayerReorderHoldReached(
  startTime: number,
  currentTime: number,
): boolean {
  return currentTime - startTime >= MOBILE_LAYER_REORDER_HOLD_MS;
}

export interface MobileLayerReorderRowGeometry {
  readonly key: string;
  readonly top: number;
  readonly bottom: number;
}

/** Chooses the nearest valid insertion boundary in viewport CSS pixels. */
export function mobileLayerReorderDropSlot(
  clientY: number,
  plan: MobileLayerReorderPlan,
  rows: readonly MobileLayerReorderRowGeometry[],
): number {
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  const remainingRows = plan.remainingKeys
    .map((key) => byKey.get(key) ?? null)
    .filter((row): row is MobileLayerReorderRowGeometry => row !== null);
  if (remainingRows.length !== plan.remainingKeys.length) return plan.originalSlot;
  let nearestSlot = plan.originalSlot;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const slot of plan.validSlots) {
    const boundary = slot === 0
      ? remainingRows[0]?.top ?? clientY
      : slot === remainingRows.length
        ? remainingRows[remainingRows.length - 1]?.bottom ?? clientY
        : (remainingRows[slot - 1].bottom + remainingRows[slot].top) / 2;
    const distance = Math.abs(clientY - boundary);
    if (distance < nearestDistance) {
      nearestSlot = slot;
      nearestDistance = distance;
    }
  }
  return nearestSlot;
}

export function mobileLayerReorderAutoScrollVelocity(
  clientY: number,
  scrollTop: number,
  scrollBottom: number,
): number {
  if (clientY < scrollTop + MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX) {
    const strength = Math.min(
      1,
      Math.max(0, (scrollTop + MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX - clientY)
        / MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX),
    );
    return -MOBILE_LAYER_REORDER_AUTO_SCROLL_MAX_PX_PER_SECOND * strength;
  }
  if (clientY > scrollBottom - MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX) {
    const strength = Math.min(
      1,
      Math.max(0, (clientY - (scrollBottom - MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX))
        / MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX),
    );
    return MOBILE_LAYER_REORDER_AUTO_SCROLL_MAX_PX_PER_SECOND * strength;
  }
  return 0;
}

export function mobileLayerReorderKeysAtSlot(
  plan: MobileLayerReorderPlan,
  slot: number,
): readonly string[] {
  if (!plan.validSlots.includes(slot)) {
    throw new Error(`Invalid mobile layer reorder slot ${slot}.`);
  }
  const result = [...plan.remainingKeys];
  result.splice(slot, 0, ...plan.draggedKeys);
  return result;
}
