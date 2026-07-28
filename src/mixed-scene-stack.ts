export const VECTOR_TEXT_OUTLINE_STRATEGY =
  "canvas2d-glyph-stroke-semantic-viewport-zero-document-cache-v2" as const;

export const VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM = 0;
export const VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM = 100;
export const VECTOR_TEXT_OUTLINE_MITER_LIMIT = 4;

export type VectorTextOutlineJoin = "bevel" | "miter" | "round";

export const VECTOR_TEXT_BLOCK_SHADOW_STRATEGY =
  "paint-webgpu-m1-shadow3d-v2-single-extruded-vector-silhouette" as const;
export const VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MAXIMUM = 180;

export const VECTOR_TEXT_SINGLE_SHADOW_STRATEGY =
  "paint-webgpu-m1-shadow3d-v2-single-offset-mask-with-blur" as const;
export const VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MAXIMUM = 180;
export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM = 0;
export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM = 300;

export function normalizeVectorTextOutlineWidth(width: number): number {
  const finite = Number.isFinite(width) ? width : VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM;
  return Math.min(
    VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
    Math.max(VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM, finite),
  );
}

export function normalizeVectorTextOutlineJoin(
  join: VectorTextOutlineJoin,
): VectorTextOutlineJoin {
  return join === "bevel" || join === "miter" || join === "round"
    ? join
    : "round";
}

export function vectorTextOutlineCanvasLineWidth(width: number): number {
  // Canvas2D centra lo stroke sul contorno del glifo. Raddoppiare qui fa sì
  // che il valore UI descriva lo spessore realmente visibile fuori dal fill.
  return normalizeVectorTextOutlineWidth(width) * 2;
}

export function vectorTextOutlineLocalReach(
  width: number,
  join: VectorTextOutlineJoin,
): number {
  const outsideWidth = vectorTextOutlineCanvasLineWidth(width) * 0.5;
  return normalizeVectorTextOutlineJoin(join) === "miter"
    ? outsideWidth * VECTOR_TEXT_OUTLINE_MITER_LIMIT
    : outsideWidth;
}

export function normalizeVectorTextBlockShadowOpacity(opacity: number): number {
  const finite = Number.isFinite(opacity) ? opacity : 1;
  return Math.min(1, Math.max(0, finite));
}

export function normalizeVectorTextBlockShadowOffset(offset: number): number {
  const finite = Number.isFinite(offset)
    ? offset
    : VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM;
  return Math.min(
    VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MAXIMUM,
    Math.max(VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM, finite),
  );
}

export function normalizeVectorTextBlockShadowAngle(angle: number): number {
  const finite = Number.isFinite(angle) ? angle : 0;
  return Math.min(
    VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MAXIMUM,
    Math.max(VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MINIMUM, finite),
  );
}

export function vectorTextBlockShadowLocalReach(
  _fontSize: number,
  offset: number,
): number {
  return normalizeVectorTextBlockShadowOffset(offset);
}

export function vectorTextBlockShadowLocalVector(
  fontSize: number,
  offset: number,
  angleDegrees: number,
): { x: number; y: number } {
  const reach = vectorTextBlockShadowLocalReach(fontSize, offset);
  const angleRadians = normalizeVectorTextBlockShadowAngle(angleDegrees)
    * Math.PI / 180;
  return {
    x: Math.cos(angleRadians) * reach,
    // Kittl espone l'angolo in coordinate cartesiane: gli angoli negativi
    // puntano verso il basso nel canvas, il cui asse Y cresce verso il basso.
    y: -Math.sin(angleRadians) * reach,
  };
}

export function normalizeVectorTextSingleShadowOpacity(opacity: number): number {
  return normalizeVectorTextBlockShadowOpacity(opacity);
}

export function normalizeVectorTextSingleShadowOffset(offset: number): number {
  const finite = Number.isFinite(offset)
    ? offset
    : VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM;
  return Math.min(
    VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MAXIMUM,
    Math.max(VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM, finite),
  );
}

export function normalizeVectorTextSingleShadowAngle(angle: number): number {
  const finite = Number.isFinite(angle) ? angle : 0;
  return Math.min(
    VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MAXIMUM,
    Math.max(VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MINIMUM, finite),
  );
}

export function normalizeVectorTextSingleShadowBlur(blur: number): number {
  const finite = Number.isFinite(blur)
    ? blur
    : VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM;
  return Math.min(
    VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
    Math.max(VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM, finite),
  );
}

export function vectorTextSingleShadowLocalVector(
  offset: number,
  angleDegrees: number,
): { x: number; y: number } {
  const reach = normalizeVectorTextSingleShadowOffset(offset);
  const angleRadians = normalizeVectorTextSingleShadowAngle(angleDegrees)
    * Math.PI / 180;
  return {
    x: Math.cos(angleRadians) * reach,
    y: -Math.sin(angleRadians) * reach,
  };
}

export const MIXED_SCENE_STACK_STRATEGY =
  "heterogeneous-bottom-up-raster-text-segmented-composition-selected-insertion-v3" as const;

export const VECTOR_TEXT_NODE_MAXIMUM = 64;

export type MixedSceneItem =
  | {
    readonly key: `raster:${number}`;
    readonly kind: "raster";
    readonly rasterLayerId: number;
  }
  | {
    readonly key: `text:${number}`;
    readonly kind: "text";
    readonly textNodeId: number;
  };

export interface VectorTextNode {
  readonly id: number;
  name: string;
  visible: boolean;
  opacity: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  outlineWidth: number;
  outlineColor: string;
  outlineJoin: VectorTextOutlineJoin;
  blockShadowEnabled: boolean;
  blockShadowColor: string;
  blockShadowOpacity: number;
  blockShadowOffset: number;
  blockShadowAngle: number;
  blockShadowOutlineWidth: number;
  singleShadowEnabled: boolean;
  singleShadowColor: string;
  singleShadowOpacity: number;
  singleShadowOffset: number;
  singleShadowAngle: number;
  singleShadowBlur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface VectorTextNodeSeed {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  outlineWidth: number;
  outlineColor: string;
  outlineJoin: VectorTextOutlineJoin;
  blockShadowEnabled: boolean;
  blockShadowColor: string;
  blockShadowOpacity: number;
  blockShadowOffset: number;
  blockShadowAngle: number;
  blockShadowOutlineWidth: number;
  singleShadowEnabled: boolean;
  singleShadowColor: string;
  singleShadowOpacity: number;
  singleShadowOffset: number;
  singleShadowAngle: number;
  singleShadowBlur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface MixedScenePartition {
  below: readonly MixedSceneItem[];
  activeRaster: MixedSceneItem & { kind: "raster" };
  above: readonly MixedSceneItem[];
}

export type MixedSceneCompositionSegment =
  | {
    readonly key: `raster-run:${string}`;
    readonly kind: "raster-run";
    readonly items: readonly (MixedSceneItem & { kind: "raster" })[];
  }
  | {
    readonly key: `active-raster:${number}`;
    readonly kind: "active-raster";
    readonly item: MixedSceneItem & { kind: "raster" };
  }
  | {
    readonly key: `text-run:${string}`;
    readonly kind: "text-run";
    readonly items: readonly (MixedSceneItem & { kind: "text" })[];
  };

export interface MixedSceneState {
  readonly items: readonly MixedSceneItem[];
  readonly textNodes: readonly VectorTextNode[];
  readonly selectedKey: MixedSceneItem["key"];
  readonly nextTextNodeId: number;
}

function rasterItem(rasterLayerId: number): MixedSceneItem & { kind: "raster" } {
  return {
    key: `raster:${rasterLayerId}`,
    kind: "raster",
    rasterLayerId,
  };
}

function textItem(textNodeId: number): MixedSceneItem & { kind: "text" } {
  return {
    key: `text:${textNodeId}`,
    kind: "text",
    textNodeId,
  };
}

function clampOpacity(opacity: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
}

export class MixedSceneStack {
  readonly strategy = MIXED_SCENE_STACK_STRATEGY;

  private readonly orderedItems: MixedSceneItem[];
  private readonly textNodes = new Map<number, VectorTextNode>();
  private selectedKey: MixedSceneItem["key"];
  private nextTextNodeId = 1;

  constructor(rasterLayerIds: readonly number[]) {
    if (rasterLayerIds.length === 0) {
      throw new Error("La scena mista richiede almeno un livello raster.");
    }
    const uniqueIds = new Set(rasterLayerIds);
    if (
      uniqueIds.size !== rasterLayerIds.length
      || rasterLayerIds.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new Error("Gli id raster iniziali devono essere positivi e univoci.");
    }
    this.orderedItems = rasterLayerIds.map(rasterItem);
    this.selectedKey = this.orderedItems[0].key;
  }

  get items(): readonly MixedSceneItem[] {
    return this.orderedItems;
  }

  get selected(): MixedSceneItem {
    return this.itemByKey(this.selectedKey);
  }

  get textCount(): number {
    return this.textNodes.size;
  }

  itemByKey(key: MixedSceneItem["key"]): MixedSceneItem {
    const item = this.orderedItems.find((candidate) => candidate.key === key);
    if (!item) {
      throw new Error(`Elemento scena ${key} inesistente.`);
    }
    return item;
  }

  textById(id: number): VectorTextNode {
    const node = this.textNodes.get(id);
    if (!node) {
      throw new Error(`Testo ${id} inesistente.`);
    }
    return node;
  }

  indexOfKey(key: MixedSceneItem["key"]): number {
    return this.orderedItems.findIndex((item) => item.key === key);
  }

  captureState(): MixedSceneState {
    return {
      items: this.orderedItems.map((item) => ({ ...item })),
      textNodes: [...this.textNodes.values()].map((node) => ({ ...node })),
      selectedKey: this.selectedKey,
      nextTextNodeId: this.nextTextNodeId,
    };
  }

  restoreState(state: MixedSceneState): void {
    this.orderedItems.splice(
      0,
      this.orderedItems.length,
      ...state.items.map((item) => ({ ...item })),
    );
    this.textNodes.clear();
    for (const node of state.textNodes) {
      this.textNodes.set(node.id, { ...node });
    }
    this.selectedKey = state.selectedKey;
    this.nextTextNodeId = state.nextTextNodeId;
  }

  select(key: MixedSceneItem["key"]): boolean {
    this.itemByKey(key);
    if (key === this.selectedKey) {
      return false;
    }
    this.selectedKey = key;
    return true;
  }

  addTextAboveSelection(seed: VectorTextNodeSeed, name?: string): VectorTextNode {
    if (this.textNodes.size >= VECTOR_TEXT_NODE_MAXIMUM) {
      throw new Error(`Massimo ${VECTOR_TEXT_NODE_MAXIMUM} testi raggiunto.`);
    }
    const id = this.nextTextNodeId;
    this.nextTextNodeId += 1;
    const node: VectorTextNode = {
      id,
      name: name?.trim() || `Testo ${id}`,
      visible: true,
      opacity: 1,
      text: seed.text,
      fontFamily: seed.fontFamily,
      fontSize: seed.fontSize,
      color: seed.color,
      outlineWidth: normalizeVectorTextOutlineWidth(seed.outlineWidth),
      outlineColor: seed.outlineColor,
      outlineJoin: normalizeVectorTextOutlineJoin(seed.outlineJoin),
      blockShadowEnabled: seed.blockShadowEnabled,
      blockShadowColor: seed.blockShadowColor,
      blockShadowOpacity: normalizeVectorTextBlockShadowOpacity(
        seed.blockShadowOpacity,
      ),
      blockShadowOffset: normalizeVectorTextBlockShadowOffset(
        seed.blockShadowOffset,
      ),
      blockShadowAngle: normalizeVectorTextBlockShadowAngle(seed.blockShadowAngle),
      blockShadowOutlineWidth: normalizeVectorTextOutlineWidth(
        seed.blockShadowOutlineWidth,
      ),
      singleShadowEnabled: seed.singleShadowEnabled,
      singleShadowColor: seed.singleShadowColor,
      singleShadowOpacity: normalizeVectorTextSingleShadowOpacity(
        seed.singleShadowOpacity,
      ),
      singleShadowOffset: normalizeVectorTextSingleShadowOffset(
        seed.singleShadowOffset,
      ),
      singleShadowAngle: normalizeVectorTextSingleShadowAngle(
        seed.singleShadowAngle,
      ),
      singleShadowBlur: normalizeVectorTextSingleShadowBlur(
        seed.singleShadowBlur,
      ),
      x: seed.x,
      y: seed.y,
      scale: seed.scale,
      rotation: seed.rotation,
    };
    const selectedIndex = this.indexOfKey(this.selectedKey);
    this.orderedItems.splice(selectedIndex + 1, 0, textItem(id));
    this.textNodes.set(id, node);
    this.selectedKey = `text:${id}`;
    return node;
  }

  deleteText(id: number, fallbackRasterLayerId: number): VectorTextNode {
    const node = this.textById(id);
    const key = `text:${id}` as const;
    const index = this.indexOfKey(key);
    if (index < 0) {
      throw new Error(`Elemento testo ${id} assente dalla pila.`);
    }
    this.orderedItems.splice(index, 1);
    this.textNodes.delete(id);
    if (this.selectedKey === key) {
      const fallbackKey = `raster:${fallbackRasterLayerId}` as const;
      this.itemByKey(fallbackKey);
      this.selectedKey = fallbackKey;
    }
    return node;
  }

  /**
   * Inserts the new raster immediately above the one scene item the user
   * selected. The raster-only LayerStack still owns storage and active paint
   * residency; this heterogeneous order is the visual document order.
   */
  addRasterAboveSelection(newRasterLayerId: number): MixedSceneItem {
    if (this.indexOfKey(`raster:${newRasterLayerId}`) >= 0) {
      throw new Error(`Raster ${newRasterLayerId} già presente nella scena.`);
    }
    const selectedIndex = this.indexOfKey(this.selectedKey);
    const item = rasterItem(newRasterLayerId);
    this.orderedItems.splice(selectedIndex + 1, 0, item);
    this.selectedKey = item.key;
    return item;
  }

  removeRaster(rasterLayerId: number, fallbackRasterLayerId: number): MixedSceneItem {
    const key = `raster:${rasterLayerId}` as const;
    const index = this.indexOfKey(key);
    if (index < 0) {
      throw new Error(`Raster ${rasterLayerId} assente dalla scena.`);
    }
    const [removed] = this.orderedItems.splice(index, 1);
    if (this.selectedKey === key) {
      const fallbackKey = `raster:${fallbackRasterLayerId}` as const;
      this.itemByKey(fallbackKey);
      this.selectedKey = fallbackKey;
    }
    return removed;
  }

  moveText(id: number, delta: -1 | 1): boolean {
    this.textById(id);
    const key = `text:${id}` as const;
    const from = this.indexOfKey(key);
    const to = from + delta;
    if (to < 0 || to >= this.orderedItems.length) {
      return false;
    }
    const [item] = this.orderedItems.splice(from, 1);
    this.orderedItems.splice(to, 0, item);
    return true;
  }

  setTextVisibility(id: number, visible: boolean): boolean {
    const node = this.textById(id);
    if (node.visible === visible) {
      return false;
    }
    node.visible = visible;
    return true;
  }

  setTextOpacity(id: number, opacity: number): boolean {
    const node = this.textById(id);
    const normalized = clampOpacity(opacity);
    if (node.opacity === normalized) {
      return false;
    }
    node.opacity = normalized;
    return true;
  }

  updateText(id: number, update: Partial<Omit<VectorTextNode, "id">>): VectorTextNode {
    const node = this.textById(id);
    if (update.name !== undefined) {
      node.name = update.name;
    }
    if (update.visible !== undefined) {
      node.visible = update.visible;
    }
    if (update.opacity !== undefined) {
      node.opacity = clampOpacity(update.opacity);
    }
    if (update.text !== undefined) {
      node.text = update.text;
    }
    if (update.fontFamily !== undefined) {
      node.fontFamily = update.fontFamily;
    }
    if (update.fontSize !== undefined) {
      node.fontSize = update.fontSize;
    }
    if (update.color !== undefined) {
      node.color = update.color;
    }
    if (update.outlineWidth !== undefined) {
      node.outlineWidth = normalizeVectorTextOutlineWidth(update.outlineWidth);
    }
    if (update.outlineColor !== undefined) {
      node.outlineColor = update.outlineColor;
    }
    if (update.outlineJoin !== undefined) {
      node.outlineJoin = normalizeVectorTextOutlineJoin(update.outlineJoin);
    }
    if (update.blockShadowEnabled !== undefined) {
      node.blockShadowEnabled = update.blockShadowEnabled;
    }
    if (update.blockShadowColor !== undefined) {
      node.blockShadowColor = update.blockShadowColor;
    }
    if (update.blockShadowOpacity !== undefined) {
      node.blockShadowOpacity = normalizeVectorTextBlockShadowOpacity(
        update.blockShadowOpacity,
      );
    }
    if (update.blockShadowOffset !== undefined) {
      node.blockShadowOffset = normalizeVectorTextBlockShadowOffset(
        update.blockShadowOffset,
      );
    }
    if (update.blockShadowAngle !== undefined) {
      node.blockShadowAngle = normalizeVectorTextBlockShadowAngle(
        update.blockShadowAngle,
      );
    }
    if (update.blockShadowOutlineWidth !== undefined) {
      node.blockShadowOutlineWidth = normalizeVectorTextOutlineWidth(
        update.blockShadowOutlineWidth,
      );
    }
    if (update.singleShadowEnabled !== undefined) {
      node.singleShadowEnabled = update.singleShadowEnabled;
    }
    if (update.singleShadowColor !== undefined) {
      node.singleShadowColor = update.singleShadowColor;
    }
    if (update.singleShadowOpacity !== undefined) {
      node.singleShadowOpacity = normalizeVectorTextSingleShadowOpacity(
        update.singleShadowOpacity,
      );
    }
    if (update.singleShadowOffset !== undefined) {
      node.singleShadowOffset = normalizeVectorTextSingleShadowOffset(
        update.singleShadowOffset,
      );
    }
    if (update.singleShadowAngle !== undefined) {
      node.singleShadowAngle = normalizeVectorTextSingleShadowAngle(
        update.singleShadowAngle,
      );
    }
    if (update.singleShadowBlur !== undefined) {
      node.singleShadowBlur = normalizeVectorTextSingleShadowBlur(
        update.singleShadowBlur,
      );
    }
    if (update.x !== undefined) {
      node.x = update.x;
    }
    if (update.y !== undefined) {
      node.y = update.y;
    }
    if (update.scale !== undefined) {
      node.scale = update.scale;
    }
    if (update.rotation !== undefined) {
      node.rotation = update.rotation;
    }
    return node;
  }

  partitionAroundRaster(activeRasterLayerId: number): MixedScenePartition {
    const key = `raster:${activeRasterLayerId}` as const;
    const index = this.indexOfKey(key);
    if (index < 0) {
      throw new Error(`Raster attivo ${activeRasterLayerId} assente dalla scena.`);
    }
    const activeRaster = this.orderedItems[index];
    if (activeRaster.kind !== "raster") {
      throw new Error(`Elemento ${key} non è raster.`);
    }
    return {
      below: this.orderedItems.slice(0, index),
      activeRaster,
      above: this.orderedItems.slice(index + 1),
    };
  }

  /**
   * Produces the exact bottom-up scene order while extracting the one raster
   * that remains hot and editable. Adjacent inactive rasters and adjacent text
   * nodes are grouped, but a raster/text boundary is never flattened away.
   */
  compositionSegments(activeRasterLayerId: number): readonly MixedSceneCompositionSegment[] {
    const activeKey = `raster:${activeRasterLayerId}` as const;
    const activeItem = this.itemByKey(activeKey);
    if (activeItem.kind !== "raster") {
      throw new Error(`Elemento ${activeKey} non è raster.`);
    }

    const segments: MixedSceneCompositionSegment[] = [];
    let rasterRun: (MixedSceneItem & { kind: "raster" })[] = [];
    let textRun: (MixedSceneItem & { kind: "text" })[] = [];
    const flushRasterRun = () => {
      if (rasterRun.length === 0) {
        return;
      }
      const items = rasterRun;
      rasterRun = [];
      segments.push({
        key: `raster-run:${items.map((item) => item.rasterLayerId).join(",")}`,
        kind: "raster-run",
        items,
      });
    };
    const flushTextRun = () => {
      if (textRun.length === 0) {
        return;
      }
      const items = textRun;
      textRun = [];
      segments.push({
        key: `text-run:${items.map((item) => item.textNodeId).join(",")}`,
        kind: "text-run",
        items,
      });
    };

    for (const item of this.orderedItems) {
      if (item.kind === "raster" && item.rasterLayerId === activeRasterLayerId) {
        flushRasterRun();
        flushTextRun();
        segments.push({
          key: `active-raster:${item.rasterLayerId}`,
          kind: "active-raster",
          item,
        });
      } else if (item.kind === "raster") {
        flushTextRun();
        rasterRun.push(item);
      } else {
        flushRasterRun();
        textRun.push(item);
      }
    }
    flushRasterRun();
    flushTextRun();

    if (!segments.some((segment) => segment.kind === "active-raster")) {
      throw new Error(`Raster attivo ${activeRasterLayerId} assente dalla composizione.`);
    }
    return segments;
  }
}
