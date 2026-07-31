// Type-only imports: erased at runtime, so this module has no runtime
// dependencies and stays loadable outside the bundler. The style *values* are
// injected instead — see LayerStyleFactory.
import type { RasterStrokeStyle } from "./stroke-core";
import type { RasterBevelStyle } from "./bevel-core";
import type {
  RasterInnerShadowStyle,
  RasterOuterShadowStyle,
} from "./shadow-core";
import type { LayerStorageTileMask } from "./layer-storage-study";

export const LAYER_STACK_STRATEGY =
  "ordered-records-single-active-index-monotonic-ids" as const;

/**
 * Each layer owns only its authoritative 4096² mip-0 texture. Display mips are
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
  /** Conservative union of everything ever painted, in document space. */
  contentBounds: LayerRect | null;
  /**
   * Conservative 16×16 mask of raw-layer mutation tiles. It allocates 32 B of
   * CPU metadata per layer and selects the 256×256 GPU tiles retained while
   * this layer is inactive.
   */
  storageTileMask: LayerStorageTileMask;
  hasContent: boolean;
  strokeStyle: RasterStrokeStyle;
  bevelStyle: RasterBevelStyle;
  outerShadowStyle: RasterOuterShadowStyle;
  innerShadowStyle: RasterInnerShadowStyle;
}

export interface LayerEffectRendererRequirements {
  needsStrokeRenderer: boolean;
  needsBevelRenderer: boolean;
  needsOuterShadowRenderer: boolean;
  needsInnerShadowRenderer: boolean;
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
): LayerEffectRendererRequirements {
  const needsBevelRenderer = bevelStyle.enabled;
  const needsOuterShadowRenderer = outerShadowStyle.enabled;
  const needsInnerShadowRenderer = innerShadowStyle.enabled;
  return {
    needsStrokeRenderer:
      (strokeStyle.enabled && strokeStyle.width > 0)
      || needsBevelRenderer
      || needsOuterShadowRenderer
      || needsInnerShadowRenderer,
    needsBevelRenderer,
    needsOuterShadowRenderer,
    needsInnerShadowRenderer,
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
};

export class LayerStack {
  readonly strategy = LAYER_STACK_STRATEGY;

  private readonly records: LayerRecord[] = [];
  private readonly createStyles: LayerStyleFactory;
  private _activeIndex = 0;
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
    } = this.createStyles();
    return {
      id,
      name,
      visible: true,
      opacity: 1,
      contentBounds: null,
      storageTileMask: new Uint32Array(8),
      hasContent: false,
      strokeStyle,
      bevelStyle,
      outerShadowStyle,
      innerShadowStyle,
    };
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

  indexOfId(id: number): number {
    return this.records.findIndex((record) => record.id === id);
  }

  /**
   * Inserts above the active layer and selects it, which is what every editor
   * does and what the user expects after pressing "add".
   */
  add(name?: string): number {
    return this.insertAt(this._activeIndex + 1, name);
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
    this.records.splice(index, 0, this.createRecord(name ?? `Livello ${this.nextId}`));
    this._activeIndex = index;
    return index;
  }

  /** Reattaches the exact detached record retained by structural history. */
  attach(record: LayerRecord, index: number): number {
    if (this.records.length >= LAYER_STACK_MAXIMUM) {
      throw new Error(`Massimo ${LAYER_STACK_MAXIMUM} livelli raggiunto.`);
    }
    if (!Number.isInteger(index) || index < 0 || index > this.records.length) {
      throw new Error(`Indice reinserimento livello ${index} fuori intervallo.`);
    }
    if (this.indexOfId(record.id) >= 0) {
      throw new Error(`Livello ${record.id} già presente nello stack.`);
    }
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
    const [record] = this.records.splice(from, 1);
    this.records.splice(to, 0, record);
    this._activeIndex = this.indexOfId(activeId);
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
