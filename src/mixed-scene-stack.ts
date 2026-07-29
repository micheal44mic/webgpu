import {
  normalizeVectorTextCircleRadiusPercent,
  normalizeVectorTextDistortPoints,
  normalizeVectorTextTransformCurve,
  normalizeVectorTextTransformType,
  type VectorTextDistortPoints,
  type VectorTextTransformType,
} from "./vector-text-transform.ts";
import {
  cloneVectorSvgDocument,
  type VectorSvgDocument,
} from "./vector-svg-import.ts";

export const VECTOR_TEXT_OUTLINE_STRATEGY =
  "webgpu-clipper64-worker-outside-offset-aa-overlap1px-same-color-fused-round-bevel-miter4-v6" as const;

export const VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM = 0;
export const VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM = 100;
export const VECTOR_TEXT_OUTLINE_MITER_LIMIT = 4;

export type VectorTextOutlineJoin = "bevel" | "miter" | "round";

export const VECTOR_TEXT_BLOCK_SHADOW_STRATEGY =
  "webgpu-clipper64-worker-visible-swept-union-mesh-v5" as const;
export const VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MAXIMUM = 180;

export const VECTOR_TEXT_SINGLE_SHADOW_STRATEGY =
  "webgpu-slug-zero-blur-or-r8-separable-gaussian-v2" as const;
export const VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MAXIMUM = 180;
export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM = 0;
export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM = 300;

export const VECTOR_TEXT_INNER_SHADOW_STRATEGY =
  "webgpu-slug-analytic-fill-clip-zero-blur-or-r8-separable-gaussian-v1" as const;
export const VECTOR_TEXT_INNER_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_INNER_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_INNER_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_INNER_SHADOW_ANGLE_MAXIMUM = 180;
export const VECTOR_TEXT_INNER_SHADOW_BLUR_MINIMUM = 0;
export const VECTOR_TEXT_INNER_SHADOW_BLUR_MAXIMUM = 300;

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

export function vectorTextOutlineLocalReach(
  width: number,
  join: VectorTextOutlineJoin,
): number {
  const outsideWidth = normalizeVectorTextOutlineWidth(width);
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

export function normalizeVectorTextInnerShadowOpacity(opacity: number): number {
  return normalizeVectorTextSingleShadowOpacity(opacity);
}

export function normalizeVectorTextInnerShadowOffset(offset: number): number {
  return normalizeVectorTextSingleShadowOffset(offset);
}

export function normalizeVectorTextInnerShadowAngle(angle: number): number {
  return normalizeVectorTextSingleShadowAngle(angle);
}

export function normalizeVectorTextInnerShadowBlur(blur: number): number {
  return normalizeVectorTextSingleShadowBlur(blur);
}

export function vectorTextInnerShadowLocalVector(
  offset: number,
  angleDegrees: number,
): { x: number; y: number } {
  return vectorTextSingleShadowLocalVector(offset, angleDegrees);
}

export const MIXED_SCENE_STACK_STRATEGY =
  "heterogeneous-bottom-up-raster-vector-segmented-composition-selected-insertion-v4" as const;

export const VECTOR_TEXT_NODE_MAXIMUM = 64;
export const VECTOR_SVG_NODE_MAXIMUM = 64;

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
  }
  | {
    readonly key: `svg:${number}`;
    readonly kind: "svg";
    readonly svgNodeId: number;
  };

export type MixedSceneVectorItem = Exclude<MixedSceneItem, { readonly kind: "raster" }>;


export interface VectorTextNode {
  readonly id: number;
  name: string;
  visible: boolean;
  opacity: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  transformType: VectorTextTransformType;
  transformCurve: number;
  circleRadiusPercent: number;
  circleInverted: boolean;
  distortPoints: VectorTextDistortPoints | null;
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
  innerShadowEnabled: boolean;
  innerShadowColor: string;
  innerShadowOpacity: number;
  innerShadowOffset: number;
  innerShadowAngle: number;
  innerShadowBlur: number;
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
  transformType?: VectorTextTransformType;
  transformCurve?: number;
  circleRadiusPercent?: number;
  circleInverted?: boolean;
  distortPoints?: VectorTextDistortPoints | null;
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
  innerShadowEnabled: boolean;
  innerShadowColor: string;
  innerShadowOpacity: number;
  innerShadowOffset: number;
  innerShadowAngle: number;
  innerShadowBlur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface VectorSvgNode {
  readonly id: number;
  name: string;
  visible: boolean;
  opacity: number;
  document: VectorSvgDocument;
  paintColors: string[];
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
  innerShadowEnabled: boolean;
  innerShadowColor: string;
  innerShadowOpacity: number;
  innerShadowOffset: number;
  innerShadowAngle: number;
  innerShadowBlur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface VectorSvgNodeSeed {
  document: VectorSvgDocument;
  paintColors?: readonly string[];
  outlineWidth?: number;
  outlineColor?: string;
  outlineJoin?: VectorTextOutlineJoin;
  blockShadowEnabled?: boolean;
  blockShadowColor?: string;
  blockShadowOpacity?: number;
  blockShadowOffset?: number;
  blockShadowAngle?: number;
  blockShadowOutlineWidth?: number;
  singleShadowEnabled?: boolean;
  singleShadowColor?: string;
  singleShadowOpacity?: number;
  singleShadowOffset?: number;
  singleShadowAngle?: number;
  singleShadowBlur?: number;
  innerShadowEnabled?: boolean;
  innerShadowColor?: string;
  innerShadowOpacity?: number;
  innerShadowOffset?: number;
  innerShadowAngle?: number;
  innerShadowBlur?: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export function cloneVectorSvgNode(node: Readonly<VectorSvgNode>): VectorSvgNode {
  return {
    ...node,
    document: cloneVectorSvgDocument(node.document),
    paintColors: [...node.paintColors],
  };
}

export function cloneVectorTextNode(
  node: Readonly<VectorTextNode>,
): VectorTextNode {
  return {
    ...node,
    distortPoints: normalizeVectorTextDistortPoints(node.distortPoints),
  };
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
    readonly items: readonly MixedSceneVectorItem[];
  };

export interface MixedSceneState {
  readonly items: readonly MixedSceneItem[];
  readonly textNodes: readonly VectorTextNode[];
  readonly selectedKey: MixedSceneItem["key"];
  readonly svgNodes: readonly VectorSvgNode[];
  readonly nextTextNodeId: number;
  readonly nextSvgNodeId: number;
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

function svgItem(svgNodeId: number): MixedSceneItem & { kind: "svg" } {
  return {
    key: `svg:${svgNodeId}`,
    kind: "svg",
    svgNodeId,
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
  private readonly svgNodes = new Map<number, VectorSvgNode>();
  private nextTextNodeId = 1;

  private nextSvgNodeId = 1;
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

  get svgCount(): number {
    return this.svgNodes.size;
  }

  get vectorCount(): number {
    return this.textNodes.size + this.svgNodes.size;
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

  svgById(id: number): VectorSvgNode {
    const node = this.svgNodes.get(id);
    if (!node) {
      throw new Error(`SVG ${id} inesistente.`);
    }
    return node;
  }

  indexOfKey(key: MixedSceneItem["key"]): number {
    return this.orderedItems.findIndex((item) => item.key === key);
  }

  captureState(): MixedSceneState {
    return {
      items: this.orderedItems.map((item) => ({ ...item })),
      textNodes: [...this.textNodes.values()].map(cloneVectorTextNode),
      svgNodes: [...this.svgNodes.values()].map(cloneVectorSvgNode),
      selectedKey: this.selectedKey,
      nextTextNodeId: this.nextTextNodeId,
      nextSvgNodeId: this.nextSvgNodeId,
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
      this.textNodes.set(node.id, {
        ...node,
        transformType: normalizeVectorTextTransformType(node.transformType),
        transformCurve: normalizeVectorTextTransformCurve(node.transformCurve),
        circleRadiusPercent: normalizeVectorTextCircleRadiusPercent(
          node.circleRadiusPercent,
        ),
        circleInverted: node.circleInverted === true,
        distortPoints: normalizeVectorTextDistortPoints(node.distortPoints),
      });
    }
    this.svgNodes.clear();
    for (const node of state.svgNodes) {
      this.svgNodes.set(node.id, cloneVectorSvgNode(node));
    }
    this.selectedKey = state.selectedKey;
    this.nextTextNodeId = state.nextTextNodeId;
    this.nextSvgNodeId = state.nextSvgNodeId;
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
      transformType: normalizeVectorTextTransformType(seed.transformType),
      transformCurve: normalizeVectorTextTransformCurve(seed.transformCurve),
      circleRadiusPercent: normalizeVectorTextCircleRadiusPercent(
        seed.circleRadiusPercent,
      ),
      circleInverted: seed.circleInverted === true,
      distortPoints: normalizeVectorTextDistortPoints(seed.distortPoints),
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
      innerShadowEnabled: seed.innerShadowEnabled,
      innerShadowColor: seed.innerShadowColor,
      innerShadowOpacity: normalizeVectorTextInnerShadowOpacity(
        seed.innerShadowOpacity,
      ),
      innerShadowOffset: normalizeVectorTextInnerShadowOffset(
        seed.innerShadowOffset,
      ),
      innerShadowAngle: normalizeVectorTextInnerShadowAngle(seed.innerShadowAngle),
      innerShadowBlur: normalizeVectorTextInnerShadowBlur(seed.innerShadowBlur),
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

  addSvgAboveSelection(seed: VectorSvgNodeSeed, name?: string): VectorSvgNode {
    if (this.svgNodes.size >= VECTOR_SVG_NODE_MAXIMUM) {
      throw new Error(`Massimo ${VECTOR_SVG_NODE_MAXIMUM} SVG raggiunto.`);
    }
    const id = this.nextSvgNodeId;
    this.nextSvgNodeId += 1;
    const documentValue = cloneVectorSvgDocument(seed.document);
    const paintColors = documentValue.paints.map((paint, index) => (
      seed.paintColors?.[index] ?? paint.color
    ));
    const node: VectorSvgNode = {
      id,
      name: name?.trim() || documentValue.sourceName || `SVG ${id}`,
      visible: true,
      opacity: 1,
      document: documentValue,
      paintColors,
      outlineWidth: normalizeVectorTextOutlineWidth(seed.outlineWidth ?? 0),
      outlineColor: seed.outlineColor ?? "#111111",
      outlineJoin: normalizeVectorTextOutlineJoin(seed.outlineJoin ?? "round"),
      blockShadowEnabled: seed.blockShadowEnabled === true,
      blockShadowColor: seed.blockShadowColor ?? "#727272",
      blockShadowOpacity: normalizeVectorTextBlockShadowOpacity(seed.blockShadowOpacity ?? 1),
      blockShadowOffset: normalizeVectorTextBlockShadowOffset(seed.blockShadowOffset ?? 23),
      blockShadowAngle: normalizeVectorTextBlockShadowAngle(seed.blockShadowAngle ?? -104),
      blockShadowOutlineWidth: normalizeVectorTextOutlineWidth(seed.blockShadowOutlineWidth ?? 0),
      singleShadowEnabled: seed.singleShadowEnabled === true,
      singleShadowColor: seed.singleShadowColor ?? "#000000",
      singleShadowOpacity: normalizeVectorTextSingleShadowOpacity(seed.singleShadowOpacity ?? 0.55),
      singleShadowOffset: normalizeVectorTextSingleShadowOffset(seed.singleShadowOffset ?? 24),
      singleShadowAngle: normalizeVectorTextSingleShadowAngle(seed.singleShadowAngle ?? -135),
      singleShadowBlur: normalizeVectorTextSingleShadowBlur(seed.singleShadowBlur ?? 12),
      innerShadowEnabled: seed.innerShadowEnabled === true,
      innerShadowColor: seed.innerShadowColor ?? "#000000",
      innerShadowOpacity: normalizeVectorTextInnerShadowOpacity(seed.innerShadowOpacity ?? 0.55),
      innerShadowOffset: normalizeVectorTextInnerShadowOffset(seed.innerShadowOffset ?? 12),
      innerShadowAngle: normalizeVectorTextInnerShadowAngle(seed.innerShadowAngle ?? -135),
      innerShadowBlur: normalizeVectorTextInnerShadowBlur(seed.innerShadowBlur ?? 12),
      x: seed.x,
      y: seed.y,
      scale: seed.scale,
      rotation: seed.rotation,
    };
    const selectedIndex = this.indexOfKey(this.selectedKey);
    this.orderedItems.splice(selectedIndex + 1, 0, svgItem(id));
    this.svgNodes.set(id, node);
    this.selectedKey = `svg:${id}`;
    return node;
  }

  deleteSvg(id: number, fallbackRasterLayerId: number): VectorSvgNode {
    const node = this.svgById(id);
    const key = `svg:${id}` as const;
    const index = this.indexOfKey(key);
    if (index < 0) throw new Error(`Elemento SVG ${id} assente dalla pila.`);
    this.orderedItems.splice(index, 1);
    this.svgNodes.delete(id);
    if (this.selectedKey === key) {
      const fallbackKey = `raster:${fallbackRasterLayerId}` as const;
      this.itemByKey(fallbackKey);
      this.selectedKey = fallbackKey;
    }
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
    if (update.transformType !== undefined) {
      node.transformType = normalizeVectorTextTransformType(update.transformType);
    }
    if (update.transformCurve !== undefined) {
      node.transformCurve = normalizeVectorTextTransformCurve(update.transformCurve);
    }
    if (update.circleRadiusPercent !== undefined) {
      node.circleRadiusPercent = normalizeVectorTextCircleRadiusPercent(
        update.circleRadiusPercent,
      );
    }
    if (update.circleInverted !== undefined) {
      node.circleInverted = update.circleInverted === true;
    }
    if (update.distortPoints !== undefined) {
      node.distortPoints = normalizeVectorTextDistortPoints(update.distortPoints);
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
    if (update.innerShadowEnabled !== undefined) {
      node.innerShadowEnabled = update.innerShadowEnabled;
    }
    if (update.innerShadowColor !== undefined) {
      node.innerShadowColor = update.innerShadowColor;
    }
    if (update.innerShadowOpacity !== undefined) {
      node.innerShadowOpacity = normalizeVectorTextInnerShadowOpacity(
        update.innerShadowOpacity,
      );
    }
    if (update.innerShadowOffset !== undefined) {
      node.innerShadowOffset = normalizeVectorTextInnerShadowOffset(
        update.innerShadowOffset,
      );
    }
    if (update.innerShadowAngle !== undefined) {
      node.innerShadowAngle = normalizeVectorTextInnerShadowAngle(
        update.innerShadowAngle,
      );
    }
    if (update.innerShadowBlur !== undefined) {
      node.innerShadowBlur = normalizeVectorTextInnerShadowBlur(
        update.innerShadowBlur,
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

  moveSvg(id: number, delta: -1 | 1): boolean {
    this.svgById(id);
    const key = `svg:${id}` as const;
    const from = this.indexOfKey(key);
    const to = from + delta;
    if (to < 0 || to >= this.orderedItems.length) return false;
    const [item] = this.orderedItems.splice(from, 1);
    this.orderedItems.splice(to, 0, item);
    return true;
  }

  setSvgVisibility(id: number, visible: boolean): boolean {
    const node = this.svgById(id);
    if (node.visible === visible) return false;
    node.visible = visible;
    return true;
  }

  setSvgOpacity(id: number, opacity: number): boolean {
    const node = this.svgById(id);
    const normalized = clampOpacity(opacity);
    if (node.opacity === normalized) return false;
    node.opacity = normalized;
    return true;
  }

  updateSvg(
    id: number,
    update: Partial<Omit<VectorSvgNode, "id" | "document">>,
  ): VectorSvgNode {
    const node = this.svgById(id);
    if (update.name !== undefined) node.name = update.name;
    if (update.visible !== undefined) node.visible = update.visible;
    if (update.opacity !== undefined) node.opacity = clampOpacity(update.opacity);
    if (update.paintColors !== undefined) {
      node.paintColors = node.document.paints.map((paint, index) => (
        update.paintColors?.[index] ?? node.paintColors[index] ?? paint.color
      ));
    }
    if (update.outlineWidth !== undefined) node.outlineWidth = normalizeVectorTextOutlineWidth(update.outlineWidth);
    if (update.outlineColor !== undefined) node.outlineColor = update.outlineColor;
    if (update.outlineJoin !== undefined) node.outlineJoin = normalizeVectorTextOutlineJoin(update.outlineJoin);
    if (update.blockShadowEnabled !== undefined) node.blockShadowEnabled = update.blockShadowEnabled;
    if (update.blockShadowColor !== undefined) node.blockShadowColor = update.blockShadowColor;
    if (update.blockShadowOpacity !== undefined) node.blockShadowOpacity = normalizeVectorTextBlockShadowOpacity(update.blockShadowOpacity);
    if (update.blockShadowOffset !== undefined) node.blockShadowOffset = normalizeVectorTextBlockShadowOffset(update.blockShadowOffset);
    if (update.blockShadowAngle !== undefined) node.blockShadowAngle = normalizeVectorTextBlockShadowAngle(update.blockShadowAngle);
    if (update.blockShadowOutlineWidth !== undefined) node.blockShadowOutlineWidth = normalizeVectorTextOutlineWidth(update.blockShadowOutlineWidth);
    if (update.singleShadowEnabled !== undefined) node.singleShadowEnabled = update.singleShadowEnabled;
    if (update.singleShadowColor !== undefined) node.singleShadowColor = update.singleShadowColor;
    if (update.singleShadowOpacity !== undefined) node.singleShadowOpacity = normalizeVectorTextSingleShadowOpacity(update.singleShadowOpacity);
    if (update.singleShadowOffset !== undefined) node.singleShadowOffset = normalizeVectorTextSingleShadowOffset(update.singleShadowOffset);
    if (update.singleShadowAngle !== undefined) node.singleShadowAngle = normalizeVectorTextSingleShadowAngle(update.singleShadowAngle);
    if (update.singleShadowBlur !== undefined) node.singleShadowBlur = normalizeVectorTextSingleShadowBlur(update.singleShadowBlur);
    if (update.innerShadowEnabled !== undefined) node.innerShadowEnabled = update.innerShadowEnabled;
    if (update.innerShadowColor !== undefined) node.innerShadowColor = update.innerShadowColor;
    if (update.innerShadowOpacity !== undefined) node.innerShadowOpacity = normalizeVectorTextInnerShadowOpacity(update.innerShadowOpacity);
    if (update.innerShadowOffset !== undefined) node.innerShadowOffset = normalizeVectorTextInnerShadowOffset(update.innerShadowOffset);
    if (update.innerShadowAngle !== undefined) node.innerShadowAngle = normalizeVectorTextInnerShadowAngle(update.innerShadowAngle);
    if (update.innerShadowBlur !== undefined) node.innerShadowBlur = normalizeVectorTextInnerShadowBlur(update.innerShadowBlur);
    if (update.x !== undefined) node.x = update.x;
    if (update.y !== undefined) node.y = update.y;
    if (update.scale !== undefined) node.scale = update.scale;
    if (update.rotation !== undefined) node.rotation = update.rotation;
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
    let textRun: MixedSceneVectorItem[] = [];
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
        key: `text-run:${items.map((item) => item.key).join(",")}`,
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
