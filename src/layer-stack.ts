// Type-only imports: erased at runtime, so this module has no runtime
// dependencies and stays loadable outside the bundler. The style *values* are
// injected instead — see LayerStyleFactory.
import type { RasterStrokeStyle } from "./stroke-core";
import type { RasterBevelStyle } from "./bevel-core";
import type {
  RasterInnerShadowStyle,
  RasterOuterShadowStyle,
} from "./shadow-core";
import type { RasterColorOverlayStyle } from "./raster-color-overlay-core";
import type { LayerStorageTileMask } from "./layer-storage-study";
import type { LayerBlendMode } from "./layer-blend-modes";

export const LAYER_STACK_STRATEGY =
  "ordered-records-single-active-single-reference-per-layer-blend-mode-contiguous-raster-clipping-groups-monotonic-ids" as const;

/**
 * Each layer owns only its authoritative `LAYER_SIZE²` mip-0 texture. Display mips are
 * singular for the active layer and for the two fused surfaces around it, so
 * they do not scale linearly with the layer count. The cap is a guard against
 * an accidental loop allocating until the device refuses, not a product
 * decision — raising it is still a memory decision, so it lives here where the
 * cost is documented rather than being spread across call sites.
 */
export const LAYER_STACK_MAXIMUM = 16;

export interface LayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The CPU-side state of one layer. Deliberately holds no GPU objects: the
 * engine keeps those in a parallel structure keyed by `id`, so this module
 * stays pure and testable in Node.
 */
export interface LayerRecord {
  readonly id: number;
  name: string;
  visible: boolean;
  opacity: number;
  /** Non-destructive backdrop-dependent composition mode for this raster. */
  blendMode: LayerBlendMode;
  /**
   * A clipping layer remains an ordinary editable raster. Its final
   * premultiplied output is limited by the alpha of this parent raster.
   */
  clippingParentId: number | null;
  /** Conservative union of everything ever painted, in document space. */
  contentBounds: LayerRect | null;
  /**
   * Conservative 16×16 mask of raw-layer mutation tiles. It allocates 32 B of
   * CPU metadata per layer and selects the 256×256 GPU tiles retained while
   * this layer is inactive.
   */
  storageTileMask: LayerStorageTileMask;
  hasContent: boolean;
  /** Display-only continuous mip sampling after this raster has committed Noise. */
  noiseMipSmoothing: boolean;
  strokeStyle: RasterStrokeStyle;
  bevelStyle: RasterBevelStyle;
  outerShadowStyle: RasterOuterShadowStyle;
  innerShadowStyle: RasterInnerShadowStyle;
  colorOverlayStyle: RasterColorOverlayStyle;
}

export interface LayerClippingHistoryEntry {
  readonly layerId: number;
  readonly parentId: number | null;
}

export interface LayerEffectRendererRequirements {
  needsStrokeRenderer: boolean;
  needsBevelRenderer: boolean;
  needsOuterShadowRenderer: boolean;
  needsInnerShadowRenderer: boolean;
  needsColorOverlayRenderer: boolean;
  /** Color Overlay is analytic and owns no incremental scratch allocation. */
  colorOverlayScratchBytes: 0;
  strokeWidth: number;
}

/**
 * Smusso is composed by RasterStrokeRenderer even when the visible Traccia
 * style is disabled. Keeping this decision pure makes the otherwise easy-to-
 * miss "bevel only" lifecycle case executable in the Node verification.
 */
export function layerEffectRendererRequirements(
  strokeStyle: Pick<RasterStrokeStyle, "enabled" | "width">,
  bevelStyle: Pick<RasterBevelStyle, "enabled">,
  outerShadowStyle: Pick<RasterOuterShadowStyle, "enabled"> = { enabled: false },
  innerShadowStyle: Pick<RasterInnerShadowStyle, "enabled"> = { enabled: false },
  colorOverlayStyle: Pick<RasterColorOverlayStyle, "enabled" | "opacity"> = {
    enabled: false,
    opacity: 100,
  },
): LayerEffectRendererRequirements {
  const needsBevelRenderer = bevelStyle.enabled;
  const needsOuterShadowRenderer = outerShadowStyle.enabled;
  const needsInnerShadowRenderer = innerShadowStyle.enabled;
  const needsColorOverlayRenderer =
    colorOverlayStyle.enabled && colorOverlayStyle.opacity > 0;
  return {
    needsStrokeRenderer:
      (strokeStyle.enabled && strokeStyle.width > 0)
      || needsBevelRenderer
      || needsOuterShadowRenderer
      || needsInnerShadowRenderer
      || needsColorOverlayRenderer,
    needsBevelRenderer,
    needsOuterShadowRenderer,
    needsInnerShadowRenderer,
    needsColorOverlayRenderer,
    colorOverlayScratchBytes: 0,
    strokeWidth: strokeStyle.width,
  };
}

/**
 * Produces a FRESH set of style objects for each new layer. It must be invoked
 * once per record: two records sharing one style object would mean editing the
 * bevel on one layer silently changed it on another, which is precisely what
 * per-layer effect state exists to prevent.
 */
export type LayerStyleFactory = () => {
  strokeStyle: RasterStrokeStyle;
  bevelStyle: RasterBevelStyle;
  outerShadowStyle: RasterOuterShadowStyle;
  innerShadowStyle: RasterInnerShadowStyle;
  colorOverlayStyle: RasterColorOverlayStyle;
};

export class LayerStack {
  readonly strategy = LAYER_STACK_STRATEGY;

  private readonly records: LayerRecord[] = [];
  private readonly createStyles: LayerStyleFactory;
  private _activeIndex = 0;
  private _referenceLayerId: number | null = null;
  private nextId = 1;

  constructor(createStyles: LayerStyleFactory) {
    this.createStyles = createStyles;
    this.records.push(this.createRecord("Livello 1"));
  }

  private createRecord(name: string): LayerRecord {
    const id = this.nextId;
    this.nextId += 1;
    const {
      strokeStyle,
      bevelStyle,
      outerShadowStyle,
      innerShadowStyle,
      colorOverlayStyle,
    } = this.createStyles();
    return {
      id,
      name,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      clippingParentId: null,
      contentBounds: null,
      storageTileMask: new Uint32Array(8),
      hasContent: false,
      noiseMipSmoothing: false,
      strokeStyle,
      bevelStyle,
      outerShadowStyle,
      innerShadowStyle,
      colorOverlayStyle,
    };
  }

  /**
   * Reserves a fresh stable id for a record prepared outside the live stack.
   * Failed asynchronous candidates deliberately burn their id: layer ids are
   * monotonic identities and must never be recycled after GPU work may have
   * observed them.
   */
  createDetachedRecord(name?: string): LayerRecord {
    return this.createRecord(name?.trim() || `Livello ${this.nextId}`);
  }

  /**
   * A clipping relationship is valid only inside this raster stack: the base
   * exists, stays strictly below every clipped raster and is not itself
   * clipped. A base and all of its clipped rasters are one consecutive unit;
   * no unrelated raster can be inserted between them. Checking a candidate
   * order before publishing it keeps failed attach/reorder operations atomic
   * instead of leaving a half-valid stack.
   */
  private assertClippingInvariants(records: readonly LayerRecord[]): void {
    const indexById = new Map<number, number>();
    records.forEach((record, index) => {
      if (indexById.has(record.id)) {
        throw new Error(`Livello ${record.id} duplicato nello stack.`);
      }
      indexById.set(record.id, index);
    });
    records.forEach((record, index) => {
      if (record.clippingParentId === null) {
        return;
      }
      const parentIndex = indexById.get(record.clippingParentId);
      if (parentIndex === undefined) {
        throw new Error(
          `Parent raster ${record.clippingParentId} del livello ${record.id} assente.`,
        );
      }
      if (parentIndex >= index) {
        throw new Error(
          `Il parent raster ${record.clippingParentId} deve restare sotto il livello ${record.id}.`,
        );
      }
      const parent = records[parentIndex];
      if (parent.clippingParentId !== null) {
        throw new Error(
          `Il parent raster ${parent.id} deve essere un livello base, non un ritaglio.`,
        );
      }
    });
    records.forEach((parent, parentIndex) => {
      if (parent.clippingParentId !== null) {
        return;
      }
      const dependentIndices: number[] = [];
      records.forEach((record, index) => {
        if (record.clippingParentId === parent.id) {
          dependentIndices.push(index);
        }
      });
      dependentIndices.forEach((dependentIndex, offset) => {
        if (dependentIndex !== parentIndex + offset + 1) {
          throw new Error(
            `Il gruppo di ritaglio del parent raster ${parent.id} deve restare consecutivo: `
              + "nessun raster estraneo può separare il parent dai suoi livelli ritagliati.",
          );
        }
      });
    });
  }

  get layers(): readonly LayerRecord[] {
    return this.records;
  }

  get count(): number {
    return this.records.length;
  }

  get activeIndex(): number {
    return this._activeIndex;
  }

  get active(): LayerRecord {
    return this.records[this._activeIndex];
  }

  /** At most one raster layer can drive Fill connectivity for the document. */
  get referenceLayerId(): number | null {
    return this._referenceLayerId;
  }

  get reference(): LayerRecord | null {
    if (this._referenceLayerId === null) {
      return null;
    }
    const record = this.byId(this._referenceLayerId);
    if (!record) {
      throw new Error(
        `Invariante Riferimento violata: livello ${this._referenceLayerId} assente.`,
      );
    }
    return record;
  }

  setReferenceIndex(index: number | null): boolean {
    const nextId = index === null ? null : this.at(index).id;
    if (nextId === this._referenceLayerId) {
      return false;
    }
    this._referenceLayerId = nextId;
    return true;
  }

  at(index: number): LayerRecord {
    const record = this.records[index];
    if (!record) {
      throw new Error(`Indice livello ${index} fuori intervallo.`);
    }
    return record;
  }

  byId(id: number): LayerRecord | null {
    return this.records.find((record) => record.id === id) ?? null;
  }

  setClippingParent(index: number, parentId: number | null): boolean {
    const record = this.at(index);
    if (parentId !== null) {
      const parent = this.byId(parentId);
      if (!parent) {
        throw new Error(`Parent raster ${parentId} assente.`);
      }
      if (parent.id === record.id) {
        throw new Error("Un livello non può ritagliare sé stesso.");
      }
      if (parent.clippingParentId !== null) {
        throw new Error("Il parent deve essere un livello raster base.");
      }
      if (this.indexOfId(parent.id) >= index) {
        throw new Error("Il parent raster deve trovarsi sotto il livello ritagliato.");
      }
      if (this.clippingDependents(record.id).length > 0) {
        throw new Error(
          "Un livello base con ritagli collegati non può diventare a sua volta un ritaglio.",
        );
      }
    }
    if (record.clippingParentId === parentId) {
      return false;
    }
    const previousParentId = record.clippingParentId;
    record.clippingParentId = parentId;
    try {
      this.assertClippingInvariants(this.records);
    } catch (error) {
      record.clippingParentId = previousParentId;
      throw error;
    }
    return true;
  }

  /**
   * Toggles clipping on an existing raster without inserting or deleting it.
   *
   * Enabling joins the complete unit at `index` to the closest raster base
   * directly below it. This also merges two adjacent clipping groups, so a
   * base that already owns children can itself be turned into a mask without
   * losing those children. Disabling splits the group at `index`: the selected
   * raster becomes a new base and every sibling above it follows that new
   * base. This is the nearest-unclipped-layer behavior expected by a row-level
   * clipping toggle and makes the operation exactly reversible.
   */
  setClippingEnabled(index: number, enabled: boolean): boolean {
    const record = this.at(index);
    const currentlyEnabled = record.clippingParentId !== null;
    if (currentlyEnabled === enabled) {
      return false;
    }
    const previousParentIds = this.records.map((candidate) => candidate.clippingParentId);
    try {
      if (enabled) {
        if (index === 0) {
          throw new Error(
            "Per creare una maschera serve un livello raster immediatamente sotto.",
          );
        }
        const below = this.at(index - 1);
        const parentId = below.clippingParentId ?? below.id;
        const unit = [record, ...this.clippingDependents(record.id)];
        for (const member of unit) {
          member.clippingParentId = parentId;
        }
      } else {
        const previousParentId = record.clippingParentId;
        if (previousParentId === null) {
          return false;
        }
        record.clippingParentId = null;
        for (let siblingIndex = index + 1; siblingIndex < this.records.length; siblingIndex += 1) {
          const sibling = this.records[siblingIndex];
          if (sibling.clippingParentId === previousParentId) {
            sibling.clippingParentId = record.id;
          }
        }
      }
      this.assertClippingInvariants(this.records);
    } catch (error) {
      this.records.forEach((candidate, candidateIndex) => {
        candidate.clippingParentId = previousParentIds[candidateIndex];
      });
      throw error;
    }
    return true;
  }

  captureClippingHistoryState(): readonly LayerClippingHistoryEntry[] {
    return this.records.map((record) => ({
      layerId: record.id,
      parentId: record.clippingParentId,
    }));
  }

  private clippingHistoryCandidate(
    state: readonly LayerClippingHistoryEntry[],
  ): LayerRecord[] {
    const parentById = new Map(state.map((entry) => [entry.layerId, entry.parentId]));
    if (parentById.size !== state.length) {
      throw new Error("La cronologia clipping contiene livelli duplicati.");
    }
    for (const layerId of parentById.keys()) {
      if (!this.byId(layerId)) {
        throw new Error(`Il livello ${layerId} della cronologia clipping è assente.`);
      }
    }
    return this.records.map((record) => ({
      ...record,
      clippingParentId: parentById.has(record.id)
        ? parentById.get(record.id) ?? null
        : record.clippingParentId,
    }));
  }

  isClippingHistoryStateApplicable(
    state: readonly LayerClippingHistoryEntry[],
  ): boolean {
    try {
      this.assertClippingInvariants(this.clippingHistoryCandidate(state));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restores the captured clipping graph atomically by stable layer id while
   * preserving layers added after the action was recorded.
   * Assigning every parent before validating is essential: replaying the
   * entries one by one can temporarily break a group even when the final
   * historical state is valid.
   */
  restoreClippingHistoryState(
    state: readonly LayerClippingHistoryEntry[],
  ): boolean {
    const candidate = this.clippingHistoryCandidate(state);
    this.assertClippingInvariants(candidate);
    const previous = this.records.map((record) => record.clippingParentId);
    const changed = this.records.some(
      (record, index) => previous[index] !== candidate[index].clippingParentId,
    );
    if (!changed) return false;
    try {
      this.records.forEach((record, index) => {
        record.clippingParentId = candidate[index].clippingParentId;
      });
      return true;
    } catch (error) {
      this.records.forEach((record, index) => {
        record.clippingParentId = previous[index] ?? null;
      });
      throw error;
    }
  }

  clippingParent(record: Readonly<LayerRecord>): LayerRecord | null {
    if (record.clippingParentId === null) {
      return null;
    }
    const parent = this.byId(record.clippingParentId);
    if (!parent) {
      throw new Error(
        `Parent raster ${record.clippingParentId} del livello ${record.id} assente.`,
      );
    }
    if (parent.clippingParentId !== null) {
      throw new Error(
        `Il parent raster ${parent.id} del livello ${record.id} non è un livello base.`,
      );
    }
    const recordIndex = this.indexOfId(record.id);
    if (recordIndex >= 0 && this.indexOfId(parent.id) >= recordIndex) {
      throw new Error(
        `Il parent raster ${parent.id} deve restare sotto il livello ${record.id}.`,
      );
    }
    return parent;
  }

  clippingDependents(parentId: number): readonly LayerRecord[] {
    return this.records.filter((record) => record.clippingParentId === parentId);
  }

  /**
   * Returns the atomic raster-order unit containing `recordOrId`: either one
   * ordinary raster, or the clipping base followed by every clipped child in
   * bottom-to-top order. The returned array is fresh; the records retain their
   * stable identities.
   */
  clippingUnit(
    recordOrId: Readonly<LayerRecord> | number,
  ): readonly LayerRecord[] {
    const id = typeof recordOrId === "number" ? recordOrId : recordOrId.id;
    const record = this.byId(id);
    if (!record) {
      throw new Error(`Livello ${id} assente dallo stack.`);
    }
    const parent = record.clippingParentId === null
      ? record
      : this.clippingParent(record);
    if (!parent) {
      throw new Error(`Parent raster del livello ${record.id} assente.`);
    }
    return [parent, ...this.clippingDependents(parent.id)];
  }

  indexOfId(id: number): number {
    return this.records.findIndex((record) => record.id === id);
  }

  /**
   * Inserts above the active clipping unit and selects it. For an ordinary
   * raster the unit has one member, preserving the usual "insert above the
   * selection" behavior. Treating a clipping group atomically prevents the
   * transient unlinked record created by Add from splitting an existing group;
   * it can then be attached as the new top child in a second atomic operation.
   */
  add(name?: string): number {
    const unit = this.clippingUnit(this.active);
    const lastIndex = this.indexOfId(unit[unit.length - 1].id);
    return this.insertAt(lastIndex + 1, name);
  }

  insertAt(index: number, name?: string): number {
    if (this.records.length >= LAYER_STACK_MAXIMUM) {
      throw new Error(
        `Massimo ${LAYER_STACK_MAXIMUM} livelli raggiunto.`,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index > this.records.length) {
      throw new Error(`Indice inserimento livello ${index} fuori intervallo.`);
    }
    const previousNextId = this.nextId;
    const record = this.createRecord(name ?? `Livello ${this.nextId}`);
    const candidate = [...this.records];
    candidate.splice(index, 0, record);
    try {
      this.assertClippingInvariants(candidate);
    } catch (error) {
      this.nextId = previousNextId;
      throw error;
    }
    this.records.splice(index, 0, record);
    this._activeIndex = index;
    return index;
  }

  /** Reattaches the exact detached record retained by structural history. */
  attach(record: LayerRecord, index: number, allowTemporaryReplacementOverflow = false): number {
    const maximum = LAYER_STACK_MAXIMUM + Number(allowTemporaryReplacementOverflow);
    if (this.records.length >= maximum) {
      throw new Error(
        allowTemporaryReplacementOverflow
          ? `Il rimpiazzo temporaneo non può superare ${maximum} livelli.`
          : `Massimo ${LAYER_STACK_MAXIMUM} livelli raggiunto.`,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index > this.records.length) {
      throw new Error(`Indice reinserimento livello ${index} fuori intervallo.`);
    }
    if (this.indexOfId(record.id) >= 0) {
      throw new Error(`Livello ${record.id} già presente nello stack.`);
    }
    const candidate = [...this.records];
    candidate.splice(index, 0, record);
    this.assertClippingInvariants(candidate);
    this.records.splice(index, 0, record);
    this._activeIndex = index;
    this.nextId = Math.max(this.nextId, record.id + 1);
    return index;
  }

  /**
   * Removing the active layer selects the one below it when there is one, so
   * the selection never lands outside the stack and never silently jumps to the
   * top of the document.
   */
  remove(index: number): LayerRecord {
    if (this.records.length <= 1) {
      throw new Error("Non è possibile eliminare l'ultimo livello.");
    }
    const removed = this.at(index);
    this.records.splice(index, 1);
    // A deleted base cannot leave serializable ids pointing at a layer that no
    // longer exists. Its former clipped rasters remain ordinary editable
    // rasters; deleting a clipped raster itself keeps its parent id on the
    // detached history record so an exact reattach can restore the relation.
    for (const record of this.records) {
      if (record.clippingParentId === removed.id) {
        record.clippingParentId = null;
      }
    }
    if (removed.id === this._referenceLayerId) {
      this._referenceLayerId = null;
    }
    if (this._activeIndex > index) {
      this._activeIndex -= 1;
    } else if (this._activeIndex === index) {
      this._activeIndex = Math.max(0, index - 1);
    }
    return removed;
  }

  setActiveIndex(index: number): boolean {
    this.at(index);
    if (index === this._activeIndex) {
      return false;
    }
    this._activeIndex = index;
    return true;
  }

  /** Reorder, keeping the same record selected rather than the same slot. */
  move(from: number, to: number): boolean {
    this.at(from);
    if (to < 0 || to >= this.records.length) {
      throw new Error(`Destinazione livello ${to} fuori intervallo.`);
    }
    if (from === to) {
      return false;
    }
    const activeId = this.active.id;
    const candidate = [...this.records];
    const [record] = candidate.splice(from, 1);
    candidate.splice(to, 0, record);
    this.assertClippingInvariants(candidate);
    this.records.splice(0, this.records.length, ...candidate);
    this._activeIndex = this.indexOfId(activeId);
    return true;
  }

  /**
   * Publishes an exact permutation produced by the heterogeneous scene-order
   * planner. Record identity, active raster and reference raster are preserved
   * by id; only the order array changes. This is also the rollback primitive
   * for a failed mixed-scene composition rebuild.
   */
  reorderByIds(bottomUpIds: readonly number[]): boolean {
    if (bottomUpIds.length !== this.records.length) {
      throw new Error("Il riordino raster deve contenere tutti i livelli.");
    }
    if (new Set(bottomUpIds).size !== bottomUpIds.length) {
      throw new Error("Il riordino raster contiene id duplicati.");
    }
    const recordsById = new Map(this.records.map((record) => [record.id, record]));
    const candidate = bottomUpIds.map((id) => {
      const record = recordsById.get(id);
      if (!record) throw new Error(`Livello ${id} assente dal riordino raster.`);
      return record;
    });
    const activeId = this.active.id;
    const changed = candidate.some((record, index) => record !== this.records[index]);
    if (!changed) return false;
    this.assertClippingInvariants(candidate);
    this.records.splice(0, this.records.length, ...candidate);
    this._activeIndex = this.indexOfId(activeId);
    // _referenceLayerId is identity-based and deliberately stays untouched.
    return true;
  }

  /** Layers strictly below the active one, bottom-up. */
  below(): readonly LayerRecord[] {
    return this.records.slice(0, this._activeIndex);
  }

  /** Layers strictly above the active one, bottom-up. */
  above(): readonly LayerRecord[] {
    return this.records.slice(this._activeIndex + 1);
  }

  anyHasContent(): boolean {
    return this.records.some((record) => record.hasContent);
  }
}
