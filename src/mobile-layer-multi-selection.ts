export interface MobileLayerMergeSelectionItem<Key extends string = string> {
  readonly key: Key;
  /** Stable key of the raster clipping base, or null for ordinary items. */
  readonly clippingParentKey: Key | null;
}

export type MobileLayerMergeSelectionInvalidReason =
  | "minimum-two"
  | "missing-item"
  | "non-contiguous"
  | "partial-clipping-group";

export type MobileLayerMergeSelectionPlan<Key extends string = string> =
  | {
    readonly valid: true;
    /** Selected keys in the same bottom-to-top order as `items`. */
    readonly orderedKeys: readonly Key[];
    readonly reason: null;
    readonly reasonCode: null;
  }
  | {
    readonly valid: false;
    readonly orderedKeys: readonly Key[];
    readonly reason: string;
    readonly reasonCode: MobileLayerMergeSelectionInvalidReason;
  };

const MOBILE_LAYER_MERGE_REASON = {
  "minimum-two": "Select at least two layers.",
  "missing-item": "The selection contains a layer that is no longer available.",
  "non-contiguous": "Layers must be adjacent to merge them.",
  "partial-clipping-group":
    "Select the entire clipping group, including its base and masks.",
} as const satisfies Record<MobileLayerMergeSelectionInvalidReason, string>;

function invalidPlan<Key extends string>(
  reasonCode: MobileLayerMergeSelectionInvalidReason,
  orderedKeys: readonly Key[],
): MobileLayerMergeSelectionPlan<Key> {
  return {
    valid: false,
    orderedKeys,
    reason: MOBILE_LAYER_MERGE_REASON[reasonCode],
    reasonCode,
  };
}

/**
 * Validates the structural part of a destructive layer merge. Rendering rules
 * remain the merge engine's responsibility. A UI request must describe one
 * contiguous scene range and may not leave either half of a clipping unit
 * outside that range.
 */
export function buildMobileLayerMergeSelectionPlan<Key extends string>(
  items: readonly MobileLayerMergeSelectionItem<Key>[],
  selectedKeys: ReadonlySet<Key> | readonly Key[],
): MobileLayerMergeSelectionPlan<Key> {
  const selection = new Set<Key>(selectedKeys);
  const indexByKey = new Map<Key, number>();
  for (let index = 0; index < items.length; index += 1) {
    const key = items[index].key;
    if (indexByKey.has(key)) {
      throw new Error(`Duplicate mobile layer key ${key}.`);
    }
    indexByKey.set(key, index);
  }

  const orderedKeys = items
    .filter((item) => selection.has(item.key))
    .map((item) => item.key);
  if (selection.size !== orderedKeys.length) {
    return invalidPlan("missing-item", orderedKeys);
  }
  if (orderedKeys.length < 2) {
    return invalidPlan("minimum-two", orderedKeys);
  }

  const clippingGroups = new Map<Key, Set<Key>>();
  for (const item of items) {
    if (item.clippingParentKey === null) continue;
    if (!indexByKey.has(item.clippingParentKey)) {
      throw new Error(`Missing clipping parent ${item.clippingParentKey}.`);
    }
    const group = clippingGroups.get(item.clippingParentKey)
      ?? new Set<Key>([item.clippingParentKey]);
    group.add(item.key);
    clippingGroups.set(item.clippingParentKey, group);
  }
  for (const group of clippingGroups.values()) {
    let selectedInGroup = 0;
    for (const key of group) {
      if (selection.has(key)) selectedInGroup += 1;
    }
    if (selectedInGroup > 0 && selectedInGroup !== group.size) {
      return invalidPlan("partial-clipping-group", orderedKeys);
    }
  }

  const indices = orderedKeys.map((key) => indexByKey.get(key)!);
  if (indices[indices.length - 1] - indices[0] + 1 !== indices.length) {
    return invalidPlan("non-contiguous", orderedKeys);
  }
  return {
    valid: true,
    orderedKeys,
    reason: null,
    reasonCode: null,
  };
}

/** Confirms that one successful callback published the expected atomic replacement. */
export function mobileLayerMergeCompletionMatches<Key extends string>(
  beforeKeys: readonly Key[],
  selectedKeys: readonly Key[],
  afterKeys: readonly Key[],
  outputKey: Key,
): boolean {
  const firstIndex = beforeKeys.indexOf(selectedKeys[0]);
  if (
    selectedKeys.length < 2
    || firstIndex < 0
    || selectedKeys.some((key, index) => beforeKeys[firstIndex + index] !== key)
  ) {
    return false;
  }
  const expected = [...beforeKeys];
  expected.splice(firstIndex, selectedKeys.length, outputKey);
  return expected.length === afterKeys.length
    && expected.every((key, index) => afterKeys[index] === key);
}
