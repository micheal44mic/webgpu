import {
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";
import {
  LAYER_BLEND_MODE_CATEGORIES,
  LAYER_BLEND_MODE_LABELS,
  type LayerBlendMode,
} from "./layer-blend-modes.ts";
import {
  cloneLayerTonalBlend,
  normalizeLayerTonalRange,
  type LayerCutoutMode,
  type LayerTonalBlend,
  type LayerTonalRange,
} from "./layer-composition.ts";
import type {
  VectorEffectEditorPatch,
  VectorEffectEditorSnapshot,
  VectorShadowKind,
  VectorTextEditorPatch,
  VectorTextEditorSnapshot,
  VectorTransformActionSnapshot,
} from "./vector-editor-contract";
import type { EditorToolSettingsKind } from "./editor-tools-contract";
import type { SceneLayerKey } from "./scene-layer-read-model";
import { brushColorCssHex } from "./brush-color.ts";

export type MobileToolSettingsKind =
  | EditorToolSettingsKind
  | "layer-options";
type MobileCanvasSettingsTool =
  | "fill"
  | "selection"
  | "transform"
  | "warp"
  | "perspective";
type MobileSelectionCombineMode = "replace" | "add" | "subtract";
export type MobileTextWarpMode = "none" | "distort" | "arch" | "circle" | "wave";

export interface MobileFillSettingsSnapshot {
  readonly tolerance: number;
  readonly color: string;
  readonly locked: boolean;
}

export interface MobileSelectionSettingsSnapshot {
  readonly method: "magic-wand" | "lasso" | "color-range";
  readonly tolerance: number;
  readonly color: string;
  readonly combineMode: MobileSelectionCombineMode;
  readonly locked: boolean;
  readonly previewing: boolean;
  readonly canInvert: boolean;
  readonly canClear: boolean;
  readonly status: string;
}

export interface MobileLayerOptionsSnapshot {
  readonly key: SceneLayerKey;
  readonly name: string;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode | null;
  readonly contentOpacity: number | null;
  readonly cutoutMode: LayerCutoutMode | null;
  readonly tonalBlend: LayerTonalBlend | null;
  readonly locked: boolean;
}

export interface MobileSvgStyleSnapshot {
  readonly id: number;
  readonly name: string;
  readonly paintColors: readonly string[];
  readonly locked: boolean;
}

export interface MobileToolSettingsSheetOptions {
  readonly root: ParentNode;
  readonly browser: Window;
  readonly document: Document;
  readonly selectCanvasTool: (tool: MobileCanvasSettingsTool) => boolean;
  readonly getFillSettings: () => MobileFillSettingsSnapshot;
  readonly setFillTolerance: (tolerance: number) => void;
  readonly setFillColor: (color: string) => void;
  readonly getSelectionSettings: () => MobileSelectionSettingsSnapshot;
  readonly setSelectionMethod: (method: MobileSelectionSettingsSnapshot["method"]) => void;
  readonly setSelectionTolerance: (tolerance: number) => void;
  readonly setSelectionColor: (color: string) => void;
  readonly previewSelectionColor: () => void;
  readonly finishSelectionColorPreview: () => void;
  readonly hasSelectedText: () => boolean;
  readonly hasSelectedVectorEffectTarget: () => boolean;
  readonly setSelectionCombineMode: (mode: MobileSelectionCombineMode) => void;
  readonly invertSelection: () => void;
  readonly clearSelection: () => void;
  readonly applyTransform: () => void;
  readonly cancelTransform: () => void;
  readonly getSelectedLayerOptions: () => MobileLayerOptionsSnapshot | null;
  readonly beginSelectedLayerOptionsEdit: () => boolean;
  readonly finishSelectedLayerOptionsEdit: () => void | Promise<boolean>;
  readonly setSelectedLayerOpacity: (
    key: SceneLayerKey,
    opacity: number,
  ) => void | Promise<void>;
  readonly setSelectedLayerBlendMode: (
    blendMode: LayerBlendMode,
  ) => void | Promise<void>;
  readonly setSelectedLayerContentOpacity: (
    key: SceneLayerKey,
    contentOpacity: number,
  ) => void | Promise<void>;
  readonly setSelectedLayerCutoutMode: (
    cutoutMode: LayerCutoutMode,
  ) => void | Promise<void>;
  readonly setSelectedLayerTonalBlend: (
    tonalBlend: LayerTonalBlend,
  ) => void | Promise<void>;
  readonly getSelectedSvgStyle: () => MobileSvgStyleSnapshot | null;
  readonly setSelectedSvgPaintColor: (index: number, color: string) => void;
  readonly beginSvgPaintEdit: () => boolean;
  readonly commitSvgPaintEdit: () => boolean;
  readonly rasterizeSelectedSvg: () => void;
  readonly getTextCreationColor: () => string;
  readonly getTextEditorSnapshot: () => VectorTextEditorSnapshot;
  readonly getVectorEffectEditorSnapshot: () => VectorEffectEditorSnapshot | null;
  readonly getTransformActionSnapshot: () => VectorTransformActionSnapshot;
  readonly updateSelectedTextProperties: (patch: VectorTextEditorPatch) => boolean;
  readonly updateSelectedVectorEffectProperties: (patch: VectorEffectEditorPatch) => boolean;
  readonly setSelectedVectorShadowEnabled: (
    kind: VectorShadowKind,
    enabled: boolean,
  ) => boolean;
  readonly beginSelectedVectorPropertyEdit: () => boolean;
  readonly commitSelectedVectorPropertyEdit: () => boolean;
  readonly createText: (color: string) => void;
  readonly resetText: () => void;
  readonly deleteText: () => void;
  readonly rasterizeText: () => void;
  readonly setTextWarpMode: (mode: MobileTextWarpMode) => boolean;
  readonly resetTextDistort: () => void;
  readonly toggleTextDistortEditing: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onClose: (kind: MobileToolSettingsKind) => void;
}

const MOBILE_TOOL_MIN_PEEK_PX = 160;
const MOBILE_TOOL_MAX_PEEK_PX = 240;
const MOBILE_TOOL_PEEK_VIEWPORT_RATIO = 0.26;
const MOBILE_LAYER_OPTIONS_MAX_VISIBLE_PX = 360;

const MOBILE_TOOL_TITLES: Readonly<Record<MobileToolSettingsKind, string>> = {
  fill: "Fill",
  selection: "Selection",
  transform: "Transform",
  warp: "Warp",
  perspective: "Perspective",
  "layer-options": "Layer Options",
  "svg-style": "SVG Style",
  text: "Text",
  "text-warp": "Warp",
  "text-outline": "Outline",
  "text-drop-shadow": "Drop Shadow",
  "text-inner-shadow": "Inner Shadow",
  "text-block-shadow": "Block Shadow",
};

const TEXT_SELECTION_REQUIRED_KINDS: ReadonlySet<MobileToolSettingsKind> = new Set([
  "text-warp",
]);

const VECTOR_EFFECT_SELECTION_REQUIRED_KINDS: ReadonlySet<MobileToolSettingsKind> = new Set([
  "text-outline",
  "text-drop-shadow",
  "text-inner-shadow",
  "text-block-shadow",
]);

const SELECTED_ITEM_REQUIRED_KINDS: ReadonlySet<MobileToolSettingsKind> = new Set([
  "layer-options",
  "svg-style",
]);

function isMobileCanvasSettingsTool(
  kind: MobileToolSettingsKind,
): kind is MobileCanvasSettingsTool {
  return kind === "fill"
    || kind === "selection"
    || kind === "transform"
    || kind === "warp"
    || kind === "perspective";
}

function requiredElement<T extends HTMLElement>(root: ParentNode, id: string): T {
  const rootElement = root as ParentNode & Partial<HTMLElement>;
  const result = rootElement.id === id
    ? rootElement as HTMLElement
    : root.querySelector<HTMLElement>(`#${id}`);
  if (!result) throw new Error(`Element #${id} was not found.`);
  return result as T;
}

function colorInputValue(value: string): string {
  try {
    return brushColorCssHex(value);
  } catch {
    return "#000000";
  }
}

function mobileBlendModeLabel(mode: LayerBlendMode): string {
  return LAYER_BLEND_MODE_LABELS[mode];
}

function mobileBlendCategoryLabel(id: string): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

type MobileLayerTonalRangeKind = keyof LayerTonalBlend;

interface MobileLayerTonalRangeElements {
  readonly root: HTMLElement;
  readonly output: HTMLOutputElement;
  readonly inputs: readonly [
    HTMLInputElement,
    HTMLInputElement,
    HTMLInputElement,
    HTMLInputElement,
  ];
  readonly valueOutputs: readonly [
    HTMLOutputElement,
    HTMLOutputElement,
    HTMLOutputElement,
    HTMLOutputElement,
  ];
}

function layerTonalRangeElements(
  root: ParentNode,
  prefix: "Current" | "Underlying",
): MobileLayerTonalRangeElements {
  const rangeRoot = requiredElement<HTMLElement>(root, `mobileLayerTonal${prefix}`);
  const inputs = [
    requiredElement<HTMLInputElement>(root, `mobileLayerTonal${prefix}0`),
    requiredElement<HTMLInputElement>(root, `mobileLayerTonal${prefix}1`),
    requiredElement<HTMLInputElement>(root, `mobileLayerTonal${prefix}2`),
    requiredElement<HTMLInputElement>(root, `mobileLayerTonal${prefix}3`),
  ] as const;
  const valueOutput = (input: HTMLInputElement): HTMLOutputElement => {
    const output = input.closest("label")?.querySelector<HTMLOutputElement>("output");
    if (!output) throw new Error(`Tonal output for #${input.id} was not found.`);
    return output;
  };
  const valueOutputs = [
    valueOutput(inputs[0]),
    valueOutput(inputs[1]),
    valueOutput(inputs[2]),
    valueOutput(inputs[3]),
  ] as const;
  return {
    root: rangeRoot,
    output: requiredElement<HTMLOutputElement>(root, `mobileLayerTonal${prefix}Out`),
    inputs,
    valueOutputs,
  };
}

export function mobileToolSettingsPeekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_TOOL_MAX_PEEK_PX,
    Math.max(MOBILE_TOOL_MIN_PEEK_PX, viewportHeight * MOBILE_TOOL_PEEK_VIEWPORT_RATIO),
  );
}

/**
 * Shared responsive view over explicit editor state and commands. It owns no
 * tool state and creates no rendering resources.
 */
export class MobileToolSettingsSheetController {
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly header: HTMLElement;
  readonly title: HTMLElement;
  readonly scroll: HTMLElement;
  readonly panels: HTMLElement[];

  private readonly fillTolerance: HTMLInputElement;
  private readonly fillToleranceOut: HTMLOutputElement;
  private readonly fillColorControl: HTMLElement;
  private readonly fillColor: HTMLInputElement;
  private readonly selectionMethod: HTMLSelectElement;
  private readonly selectionReplace: HTMLButtonElement;
  private readonly selectionAdd: HTMLButtonElement;
  private readonly selectionSubtract: HTMLButtonElement;
  private readonly selectionToleranceControl: HTMLElement;
  private readonly selectionToleranceHint: HTMLElement;
  private readonly selectionTolerance: HTMLInputElement;
  private readonly selectionToleranceOut: HTMLOutputElement;
  private readonly selectionColorControl: HTMLElement;
  private readonly selectionColor: HTMLInputElement;
  private readonly selectionInvert: HTMLButtonElement;
  private readonly selectionClear: HTMLButtonElement;
  private readonly selectionResult: HTMLElement;
  private readonly transformHint: HTMLElement;
  private readonly transformCancel: HTMLButtonElement;
  private readonly transformApply: HTMLButtonElement;
  private readonly layerOpacity: HTMLInputElement;
  private readonly layerOpacityOut: HTMLOutputElement;
  private readonly rasterLayerOptions: HTMLElement;
  private readonly layerBlendModeControl: HTMLElement;
  private readonly layerBlendMode: HTMLSelectElement;
  private readonly layerContentOpacity: HTMLInputElement;
  private readonly layerContentOpacityOut: HTMLOutputElement;
  private readonly layerCutoutMode: HTMLSelectElement;
  private readonly layerTonalCurrent: MobileLayerTonalRangeElements;
  private readonly layerTonalUnderlying: MobileLayerTonalRangeElements;
  private readonly svgStylePalette: HTMLElement;
  private readonly svgStyleRasterize: HTMLButtonElement;
  private readonly svgStyleStatus: HTMLElement;
  private readonly textValue: HTMLInputElement;
  private readonly textFontFamily: HTMLSelectElement;
  private readonly textFontSize: HTMLInputElement;
  private readonly textFontSizeOut: HTMLOutputElement;
  private readonly textColorControl: HTMLElement;
  private readonly textColor: HTMLInputElement;
  private readonly textAdd: HTMLButtonElement;
  private readonly textReset: HTMLButtonElement;
  private readonly textDelete: HTMLButtonElement;
  private readonly textRasterize: HTMLButtonElement;
  private readonly textWarpButtons = [
    ["mobileTextWarpNone", "none"],
    ["mobileTextWarpDistort", "distort"],
    ["mobileTextWarpArch", "arch"],
    ["mobileTextWarpCircle", "circle"],
    ["mobileTextWarpWave", "wave"],
  ] as const satisfies readonly (readonly [string, MobileTextWarpMode])[];
  private readonly textWarpButtonControls: Array<{
    readonly mobile: HTMLButtonElement;
    readonly mode: MobileTextWarpMode;
  }>;
  private readonly textWarpDistortControls: HTMLElement;
  private readonly textDistortReset: HTMLButtonElement;
  private readonly textDistortEdit: HTMLButtonElement;
  private readonly textDistortCommitActions: HTMLElement;
  private readonly textDistortCancel: HTMLButtonElement;
  private readonly textDistortApply: HTMLButtonElement;
  private readonly textWarpCurveControls: HTMLElement;
  private readonly textWarpCurve: HTMLInputElement;
  private readonly textWarpCurveOut: HTMLOutputElement;
  private readonly textWarpCircleControls: HTMLElement;
  private readonly textCircleRadius: HTMLInputElement;
  private readonly textCircleRadiusOut: HTMLOutputElement;
  private readonly textCircleInverted: HTMLInputElement;
  private readonly textOutlineWidth: HTMLInputElement;
  private readonly textOutlineWidthOut: HTMLOutputElement;
  private readonly textOutlineColorControl: HTMLElement;
  private readonly textOutlineColor: HTMLInputElement;
  private readonly textOutlineJoin: HTMLSelectElement;
  private readonly textDropShadowEnabled: HTMLInputElement;
  private readonly textDropShadowParameters: HTMLElement;
  private readonly textDropShadowColorControl: HTMLElement;
  private readonly textDropShadowColor: HTMLInputElement;
  private readonly textDropShadowOpacity: HTMLInputElement;
  private readonly textDropShadowOpacityOut: HTMLOutputElement;
  private readonly textDropShadowOffset: HTMLInputElement;
  private readonly textDropShadowOffsetOut: HTMLOutputElement;
  private readonly textDropShadowAngle: HTMLInputElement;
  private readonly textDropShadowAngleOut: HTMLOutputElement;
  private readonly textDropShadowBlur: HTMLInputElement;
  private readonly textDropShadowBlurOut: HTMLOutputElement;
  private readonly textInnerShadowEnabled: HTMLInputElement;
  private readonly textInnerShadowParameters: HTMLElement;
  private readonly textInnerShadowColorControl: HTMLElement;
  private readonly textInnerShadowColor: HTMLInputElement;
  private readonly textInnerShadowOpacity: HTMLInputElement;
  private readonly textInnerShadowOpacityOut: HTMLOutputElement;
  private readonly textInnerShadowOffset: HTMLInputElement;
  private readonly textInnerShadowOffsetOut: HTMLOutputElement;
  private readonly textInnerShadowAngle: HTMLInputElement;
  private readonly textInnerShadowAngleOut: HTMLOutputElement;
  private readonly textInnerShadowBlur: HTMLInputElement;
  private readonly textInnerShadowBlurOut: HTMLOutputElement;
  private readonly textBlockShadowEnabled: HTMLInputElement;
  private readonly textBlockShadowParameters: HTMLElement;
  private readonly textBlockShadowColorControl: HTMLElement;
  private readonly textBlockShadowColor: HTMLInputElement;
  private readonly textBlockShadowOpacity: HTMLInputElement;
  private readonly textBlockShadowOpacityOut: HTMLOutputElement;
  private readonly textBlockShadowOffset: HTMLInputElement;
  private readonly textBlockShadowOffsetOut: HTMLOutputElement;
  private readonly textBlockShadowAngle: HTMLInputElement;
  private readonly textBlockShadowAngleOut: HTMLOutputElement;
  private readonly textBlockShadowOutlineWidth: HTMLInputElement;
  private readonly textBlockShadowOutlineWidthOut: HTMLOutputElement;

  private openState = false;
  private activeKind: MobileToolSettingsKind | null = null;
  private snap: MobileBottomSheetSnap = "peek";
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragStartSnap: MobileBottomSheetSnap = "peek";
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
  private opener: HTMLElement | null = null;
  private readonly options: MobileToolSettingsSheetOptions;
  private pendingTextColor: string | null = null;
  private svgPaletteSignature = "";
  private svgPaintEditIndex: number | null = null;
  private vectorPropertyEditOpen = false;
  private layerOptionsDraft: {
    readonly key: SceneLayerKey;
    opacity?: number;
    blendMode?: LayerBlendMode;
    contentOpacity?: number;
    cutoutMode?: LayerCutoutMode;
  } | null = null;
  private layerTonalBlendDraft: {
    readonly key: string;
    readonly value: LayerTonalBlend;
  } | null = null;
  private readonly layerTonalKeyboardEdits = new Set<HTMLInputElement>();
  private readonly activeLayerRangeGestures = new Set<HTMLInputElement>();
  private readonly pendingLayerRangeUpdates = new Map<
    "opacity" | "content-opacity",
    { readonly key: SceneLayerKey; readonly value: number }
  >();
  private layerRangeUpdateFrame: number | null = null;
  private layerOptionsSyncFrame: number | null = null;
  private openRequestGeneration = 0;
  private layerOptionsClosePromise: Promise<boolean> | null = null;

  constructor(options: MobileToolSettingsSheetOptions) {
    this.options = options;
    this.sheet = requiredElement<HTMLElement>(options.root, "mobileToolSettingsSheet");
    this.handle = requiredElement<HTMLButtonElement>(options.root, "mobileToolSettingsHandle");
    this.header = requiredElement<HTMLElement>(options.root, "mobileToolSettingsHeader");
    this.title = requiredElement<HTMLElement>(options.root, "mobileToolSettingsTitle");
    this.scroll = requiredElement<HTMLElement>(options.root, "mobileToolSettingsScroll");
    this.fillTolerance = requiredElement<HTMLInputElement>(options.root, "mobileFillTolerance");
    this.fillToleranceOut = requiredElement<HTMLOutputElement>(options.root, "mobileFillToleranceOut");
    this.fillColorControl = requiredElement<HTMLElement>(options.root, "mobileFillColorControl");
    this.fillColor = requiredElement<HTMLInputElement>(options.root, "mobileFillColor");
    this.selectionMethod = requiredElement<HTMLSelectElement>(options.root, "mobileSelectionMethod");
    this.selectionReplace = requiredElement<HTMLButtonElement>(options.root, "mobileSelectionReplace");
    this.selectionAdd = requiredElement<HTMLButtonElement>(options.root, "mobileSelectionAdd");
    this.selectionSubtract = requiredElement<HTMLButtonElement>(options.root, "mobileSelectionSubtract");
    this.selectionToleranceControl = requiredElement<HTMLElement>(options.root, "mobileSelectionToleranceControl");
    this.selectionToleranceHint = requiredElement<HTMLElement>(options.root, "mobileSelectionToleranceHint");
    this.selectionTolerance = requiredElement<HTMLInputElement>(options.root, "mobileSelectionTolerance");
    this.selectionToleranceOut = requiredElement<HTMLOutputElement>(options.root, "mobileSelectionToleranceOut");
    this.selectionColorControl = requiredElement<HTMLElement>(options.root, "mobileSelectionColorControl");
    this.selectionColor = requiredElement<HTMLInputElement>(options.root, "mobileSelectionColor");
    this.selectionInvert = requiredElement<HTMLButtonElement>(options.root, "mobileSelectionInvert");
    this.selectionClear = requiredElement<HTMLButtonElement>(options.root, "mobileSelectionClear");
    this.selectionResult = requiredElement<HTMLElement>(options.root, "mobileSelectionResult");
    this.transformHint = requiredElement<HTMLElement>(options.root, "mobileTransformHint");
    this.transformCancel = requiredElement<HTMLButtonElement>(options.root, "mobileTransformCancel");
    this.transformApply = requiredElement<HTMLButtonElement>(options.root, "mobileTransformApply");
    this.layerOpacity = requiredElement<HTMLInputElement>(options.root, "mobileLayerOpacity");
    this.layerOpacityOut = requiredElement<HTMLOutputElement>(options.root, "mobileLayerOpacityOut");
    this.rasterLayerOptions = requiredElement<HTMLElement>(options.root, "mobileRasterLayerOptions");
    this.layerBlendModeControl = requiredElement<HTMLElement>(options.root, "mobileLayerBlendModeControl");
    this.layerBlendMode = requiredElement<HTMLSelectElement>(options.root, "mobileLayerBlendMode");
    this.layerContentOpacity = requiredElement<HTMLInputElement>(options.root, "mobileLayerContentOpacity");
    this.layerContentOpacityOut = requiredElement<HTMLOutputElement>(options.root, "mobileLayerContentOpacityOut");
    this.layerCutoutMode = requiredElement<HTMLSelectElement>(options.root, "mobileLayerCutoutMode");
    this.layerTonalCurrent = layerTonalRangeElements(options.root, "Current");
    this.layerTonalUnderlying = layerTonalRangeElements(options.root, "Underlying");
    this.svgStylePalette = requiredElement<HTMLElement>(options.root, "mobileSvgStylePalette");
    this.svgStyleRasterize = requiredElement<HTMLButtonElement>(options.root, "mobileSvgStyleRasterize");
    this.svgStyleStatus = requiredElement<HTMLElement>(options.root, "mobileSvgStyleStatus");
    this.textValue = requiredElement<HTMLInputElement>(options.root, "mobileTextValue");
    this.textFontFamily = requiredElement<HTMLSelectElement>(options.root, "mobileTextFontFamily");
    this.textFontSize = requiredElement<HTMLInputElement>(options.root, "mobileTextFontSize");
    this.textFontSizeOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextFontSizeOut");
    this.textColorControl = requiredElement<HTMLElement>(options.root, "mobileTextColorControl");
    this.textColor = requiredElement<HTMLInputElement>(options.root, "mobileTextColor");
    this.textAdd = requiredElement<HTMLButtonElement>(options.root, "mobileTextAdd");
    this.textReset = requiredElement<HTMLButtonElement>(options.root, "mobileTextReset");
    this.textDelete = requiredElement<HTMLButtonElement>(options.root, "mobileTextDelete");
    this.textRasterize = requiredElement<HTMLButtonElement>(options.root, "mobileTextRasterize");
    this.textWarpDistortControls = requiredElement<HTMLElement>(options.root, "mobileTextWarpDistortControls");
    this.textDistortReset = requiredElement<HTMLButtonElement>(options.root, "mobileTextDistortReset");
    this.textDistortEdit = requiredElement<HTMLButtonElement>(options.root, "mobileTextDistortEdit");
    this.textDistortCommitActions = requiredElement<HTMLElement>(options.root, "mobileTextDistortCommitActions");
    this.textDistortCancel = requiredElement<HTMLButtonElement>(options.root, "mobileTextDistortCancel");
    this.textDistortApply = requiredElement<HTMLButtonElement>(options.root, "mobileTextDistortApply");
    this.textWarpCurveControls = requiredElement<HTMLElement>(options.root, "mobileTextWarpCurveControls");
    this.textWarpCurve = requiredElement<HTMLInputElement>(options.root, "mobileTextWarpCurve");
    this.textWarpCurveOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextWarpCurveOut");
    this.textWarpCircleControls = requiredElement<HTMLElement>(options.root, "mobileTextWarpCircleControls");
    this.textCircleRadius = requiredElement<HTMLInputElement>(options.root, "mobileTextCircleRadius");
    this.textCircleRadiusOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextCircleRadiusOut");
    this.textCircleInverted = requiredElement<HTMLInputElement>(options.root, "mobileTextCircleInverted");
    this.textOutlineWidth = requiredElement<HTMLInputElement>(options.root, "mobileTextOutlineWidth");
    this.textOutlineWidthOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextOutlineWidthOut");
    this.textOutlineColorControl = requiredElement<HTMLElement>(options.root, "mobileTextOutlineColorControl");
    this.textOutlineColor = requiredElement<HTMLInputElement>(options.root, "mobileTextOutlineColor");
    this.textOutlineJoin = requiredElement<HTMLSelectElement>(options.root, "mobileTextOutlineJoin");
    this.textDropShadowEnabled = requiredElement<HTMLInputElement>(options.root, "mobileTextDropShadowEnabled");
    this.textDropShadowParameters = requiredElement<HTMLElement>(options.root, "mobileTextDropShadowParameters");
    this.textDropShadowColorControl = requiredElement<HTMLElement>(options.root, "mobileTextDropShadowColorControl");
    this.textDropShadowColor = requiredElement<HTMLInputElement>(options.root, "mobileTextDropShadowColor");
    this.textDropShadowOpacity = requiredElement<HTMLInputElement>(options.root, "mobileTextDropShadowOpacity");
    this.textDropShadowOpacityOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextDropShadowOpacityOut");
    this.textDropShadowOffset = requiredElement<HTMLInputElement>(options.root, "mobileTextDropShadowOffset");
    this.textDropShadowOffsetOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextDropShadowOffsetOut");
    this.textDropShadowAngle = requiredElement<HTMLInputElement>(options.root, "mobileTextDropShadowAngle");
    this.textDropShadowAngleOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextDropShadowAngleOut");
    this.textDropShadowBlur = requiredElement<HTMLInputElement>(options.root, "mobileTextDropShadowBlur");
    this.textDropShadowBlurOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextDropShadowBlurOut");
    this.textInnerShadowEnabled = requiredElement<HTMLInputElement>(options.root, "mobileTextInnerShadowEnabled");
    this.textInnerShadowParameters = requiredElement<HTMLElement>(options.root, "mobileTextInnerShadowParameters");
    this.textInnerShadowColorControl = requiredElement<HTMLElement>(options.root, "mobileTextInnerShadowColorControl");
    this.textInnerShadowColor = requiredElement<HTMLInputElement>(options.root, "mobileTextInnerShadowColor");
    this.textInnerShadowOpacity = requiredElement<HTMLInputElement>(options.root, "mobileTextInnerShadowOpacity");
    this.textInnerShadowOpacityOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextInnerShadowOpacityOut");
    this.textInnerShadowOffset = requiredElement<HTMLInputElement>(options.root, "mobileTextInnerShadowOffset");
    this.textInnerShadowOffsetOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextInnerShadowOffsetOut");
    this.textInnerShadowAngle = requiredElement<HTMLInputElement>(options.root, "mobileTextInnerShadowAngle");
    this.textInnerShadowAngleOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextInnerShadowAngleOut");
    this.textInnerShadowBlur = requiredElement<HTMLInputElement>(options.root, "mobileTextInnerShadowBlur");
    this.textInnerShadowBlurOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextInnerShadowBlurOut");
    this.textBlockShadowEnabled = requiredElement<HTMLInputElement>(options.root, "mobileTextBlockShadowEnabled");
    this.textBlockShadowParameters = requiredElement<HTMLElement>(options.root, "mobileTextBlockShadowParameters");
    this.textBlockShadowColorControl = requiredElement<HTMLElement>(options.root, "mobileTextBlockShadowColorControl");
    this.textBlockShadowColor = requiredElement<HTMLInputElement>(options.root, "mobileTextBlockShadowColor");
    this.textBlockShadowOpacity = requiredElement<HTMLInputElement>(options.root, "mobileTextBlockShadowOpacity");
    this.textBlockShadowOpacityOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextBlockShadowOpacityOut");
    this.textBlockShadowOffset = requiredElement<HTMLInputElement>(options.root, "mobileTextBlockShadowOffset");
    this.textBlockShadowOffsetOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextBlockShadowOffsetOut");
    this.textBlockShadowAngle = requiredElement<HTMLInputElement>(options.root, "mobileTextBlockShadowAngle");
    this.textBlockShadowAngleOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextBlockShadowAngleOut");
    this.textBlockShadowOutlineWidth = requiredElement<HTMLInputElement>(options.root, "mobileTextBlockShadowOutlineWidth");
    this.textBlockShadowOutlineWidthOut = requiredElement<HTMLOutputElement>(options.root, "mobileTextBlockShadowOutlineWidthOut");
    this.panels = Array.from(
      this.scroll.querySelectorAll<HTMLElement>("[data-mobile-tool-settings-panel]"),
    );
    this.textWarpButtonControls = this.textWarpButtons.map(([mobileId, mode]) => ({
      mobile: requiredElement<HTMLButtonElement>(options.root, mobileId),
      mode,
    }));
    for (const category of LAYER_BLEND_MODE_CATEGORIES) {
      const group = options.document.createElement("optgroup");
      group.label = mobileBlendCategoryLabel(category.id);
      for (const mode of category.modes) {
        const option = options.document.createElement("option");
        option.value = mode;
        option.textContent = mobileBlendModeLabel(mode);
        group.append(option);
      }
      this.layerBlendMode.append(group);
    }
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("inert", "");
    this.bindEvents();
    options.document.addEventListener("visibilitychange", () => {
      if (options.document.visibilityState !== "visible") this.commitOpenHistoryEdits();
    });
    options.browser.addEventListener("pagehide", () => {
      if (this.openState && this.activeKind === "layer-options") {
        this.close(false);
      } else {
        this.commitOpenHistoryEdits();
      }
    });
    options.browser.addEventListener("blur", () => this.commitOpenHistoryEdits());
  }

  get isOpen(): boolean {
    return this.openState;
  }

  commitOpenHistoryEdits(): void {
    this.finishLayerTonalBlendEdit();
    this.finishSvgPaintEdit();
    this.finishVectorPropertyEdit();
  }

  get toolKind(): MobileToolSettingsKind | null {
    return this.activeKind;
  }

  open(kind: MobileToolSettingsKind, opener: HTMLElement | null = null): void {
    const requestGeneration = ++this.openRequestGeneration;
    void this.openWhenReady(kind, opener, requestGeneration);
  }

  discardLayerOptionsDraft(): void {
    this.layerOptionsDraft = null;
    this.layerTonalBlendDraft = null;
    this.layerTonalKeyboardEdits.clear();
    this.requestLayerOptionsSync();
  }

  private selectedTargetAvailable(kind: MobileToolSettingsKind): boolean {
    if (TEXT_SELECTION_REQUIRED_KINDS.has(kind) && !this.options.hasSelectedText()) {
      return false;
    }
    if (
      VECTOR_EFFECT_SELECTION_REQUIRED_KINDS.has(kind)
      && !this.options.hasSelectedVectorEffectTarget()
    ) return false;
    if (SELECTED_ITEM_REQUIRED_KINDS.has(kind)) {
      const available = kind === "layer-options"
        ? this.options.getSelectedLayerOptions() !== null
        : this.options.getSelectedSvgStyle() !== null;
      if (!available) return false;
    }
    return true;
  }

  private async openWhenReady(
    kind: MobileToolSettingsKind,
    opener: HTMLElement | null,
    requestGeneration: number,
  ): Promise<void> {
    if (!this.selectedTargetAvailable(kind)) return;
    if (this.openState && this.activeKind === kind) return;
    if (this.openState) this.closeCurrent(false);
    const pendingClose = this.layerOptionsClosePromise;
    if (pendingClose) {
      try {
        await pendingClose;
      } catch {
        return;
      }
    }
    if (
      requestGeneration !== this.openRequestGeneration
      || !this.selectedTargetAvailable(kind)
    ) return;
    if (isMobileCanvasSettingsTool(kind) && !this.options.selectCanvasTool(kind)) return;
    this.options.beforeOpen();
    if (kind === "layer-options" && !this.options.beginSelectedLayerOptionsEdit()) return;

    this.activeKind = kind;
    if (kind === "text") {
      this.pendingTextColor = this.options.hasSelectedText()
        ? null
        : this.options.getTextCreationColor();
    }
    this.opener = opener;
    this.openState = true;
    const initialSnap: MobileBottomSheetSnap = kind === "warp" || kind === "perspective"
      ? "minimized"
      : "peek";
    this.snap = initialSnap;
    this.sheet.dataset.tool = kind;
    this.sheet.dataset.state = "open";
    this.sheet.hidden = false;
    this.sheet.setAttribute("aria-hidden", "false");
    this.sheet.removeAttribute("inert");
    this.sheet.setAttribute("aria-label", `${MOBILE_TOOL_TITLES[kind]} settings`);
    this.title.textContent = MOBILE_TOOL_TITLES[kind];
    for (const panel of this.panels) {
      const panelKinds = panel.dataset.mobileToolSettingsPanel?.split(/\s+/) ?? [];
      panel.hidden = !panelKinds.includes(kind);
    }
    this.syncOpenState();
    this.scroll.scrollTop = 0;
    this.snapTo(initialSnap);
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.options.onOpenChange(true);
  }

  close(restoreFocus = false): void {
    this.openRequestGeneration += 1;
    this.closeCurrent(restoreFocus);
  }

  /** Invalidates a queued open and waits for document-owned edits to close. */
  async settleDocumentEdits(): Promise<void> {
    this.close(false);
    this.commitOpenHistoryEdits();
    while (this.layerOptionsClosePromise) {
      await this.layerOptionsClosePromise;
    }
    if (this.openState) {
      throw new Error("Tool settings are still finishing.");
    }
  }

  private closeCurrent(restoreFocus: boolean): void {
    if (!this.openState) return;
    const closedKind = this.activeKind;
    if (closedKind === "layer-options") this.flushLayerRangeUpdates();
    this.commitOpenHistoryEdits();
    if (closedKind === "layer-options") {
      this.layerOptionsDraft = null;
      this.layerTonalBlendDraft = null;
      this.layerTonalKeyboardEdits.clear();
      this.activeLayerRangeGestures.clear();
    }
    this.openState = false;
    this.releaseDragCapture();
    const activeElement = this.options.document.activeElement;
    if (activeElement instanceof HTMLElement && this.sheet.contains(activeElement)) {
      if (restoreFocus && this.opener?.isConnected) {
        this.opener.focus({ preventScroll: true });
      } else {
        activeElement.blur();
      }
    }
    this.sheet.classList.remove("is-open", "is-dragging");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.setAttribute("inert", "");
    this.handle.setAttribute("aria-expanded", "false");
    this.setOffset(this.closedOffset());
    this.options.onOpenChange(false);
    this.opener = null;
    if (closedKind === "layer-options") {
      const finish = Promise.resolve().then(async () => (
        await this.options.finishSelectedLayerOptionsEdit() === true
      ));
      this.layerOptionsClosePromise = finish;
      finish.then(
        () => {
          if (this.layerOptionsClosePromise === finish) {
            this.layerOptionsClosePromise = null;
          }
        },
        (error) => {
          if (this.layerOptionsClosePromise === finish) {
            this.layerOptionsClosePromise = null;
          }
          console.error("Layer options could not be committed.", error);
          this.requestLayerOptionsSync();
        },
      );
    }
    if (closedKind) this.options.onClose(closedKind);
  }

  syncOpenState(): void {
    if (!this.openState || !this.activeKind) return;
    if (
      TEXT_SELECTION_REQUIRED_KINDS.has(this.activeKind)
      && !this.options.hasSelectedText()
    ) {
      this.close(false);
      return;
    }
    if (
      VECTOR_EFFECT_SELECTION_REQUIRED_KINDS.has(this.activeKind)
      && !this.options.hasSelectedVectorEffectTarget()
    ) {
      this.close(false);
      return;
    }
    if (
      (this.activeKind === "layer-options" && !this.options.getSelectedLayerOptions())
      || (this.activeKind === "svg-style" && !this.options.getSelectedSvgStyle())
    ) {
      this.close(false);
      return;
    }
    if (this.activeKind === "fill") this.syncFill();
    else if (this.activeKind === "selection") this.syncSelection();
    else if (
      this.activeKind === "transform"
      || this.activeKind === "warp"
      || this.activeKind === "perspective"
    ) this.syncTransform();
    else if (this.activeKind === "layer-options") this.syncLayerOptions();
    else if (this.activeKind === "svg-style") this.syncSvgStyle();
    else if (this.activeKind === "text") this.syncText();
    else if (this.activeKind === "text-warp") this.syncTextWarp();
    else if (this.activeKind === "text-outline") this.syncTextOutline();
    else if (this.activeKind === "text-drop-shadow") this.syncTextDropShadow();
    else if (this.activeKind === "text-inner-shadow") this.syncTextInnerShadow();
    else this.syncTextBlockShadow();
  }

  handleResize(): void {
    if (!this.openState || this.dragPointerId !== null) return;
    this.snapTo(this.snap);
  }

  private bindEvents(): void {
    this.handle.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.handle.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.handle.addEventListener("pointerup", (event) => this.finishDrag(event));
    this.handle.addEventListener("pointercancel", (event) => this.finishDrag(event, true));
    this.handle.addEventListener("click", () => {
      if (!this.openState) return;
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      this.snapTo(nextMobileBottomSheetTapSnap(this.snap));
    });

    for (const eventType of ["input", "change"] as const) {
      this.fillTolerance.addEventListener(eventType, () => {
        this.options.setFillTolerance(Number(this.fillTolerance.value));
        this.syncFill();
      });
      this.fillColor.addEventListener(eventType, () => {
        this.options.setFillColor(this.fillColor.value);
        this.fillColorControl.style.setProperty(
          "--mobile-raster-effect-color",
          this.fillColor.value,
        );
      });
    }
    const previewSelectionColor = (): void => {
      if (this.selectionMethod.value === "color-range") {
        this.options.previewSelectionColor();
      }
    };
    this.selectionTolerance.addEventListener("input", () => {
      this.options.setSelectionTolerance(Number(this.selectionTolerance.value));
      previewSelectionColor();
      this.syncSelection();
    });
    this.selectionTolerance.addEventListener("change", () => {
      this.options.setSelectionTolerance(Number(this.selectionTolerance.value));
      previewSelectionColor();
      this.options.finishSelectionColorPreview();
      this.syncSelection();
    });
    this.selectionColor.addEventListener("input", () => {
      this.options.setSelectionColor(this.selectionColor.value);
      this.selectionColorControl.style.setProperty(
        "--mobile-raster-effect-color",
        this.selectionColor.value,
      );
      previewSelectionColor();
    });
    this.selectionColor.addEventListener("change", () => {
      this.options.setSelectionColor(this.selectionColor.value);
      previewSelectionColor();
      this.options.finishSelectionColorPreview();
    });
    this.textValue.addEventListener("input", () => {
      this.updateTextProperties({ text: this.textValue.value });
    });
    this.textFontSize.addEventListener("input", () => {
      this.updateTextProperties({ fontSize: Number(this.textFontSize.value) });
      this.textFontSizeOut.value = `${Math.round(Number(this.textFontSize.value))} px`;
    });
    this.textColor.addEventListener("input", () => {
      if (this.options.hasSelectedText()) {
        this.updateTextProperties({ color: this.textColor.value });
      } else {
        this.pendingTextColor = this.textColor.value;
      }
      this.textColorControl.style.setProperty(
        "--mobile-raster-effect-color",
        this.textColor.value,
      );
    });
    this.textWarpCurve.addEventListener("input", () => {
      this.updateTextProperties({ transformCurve: Number(this.textWarpCurve.value) });
      this.textWarpCurveOut.value = `${Math.round(Number(this.textWarpCurve.value))}%`;
    });
    this.textCircleRadius.addEventListener("input", () => {
      this.updateTextProperties({ circleRadiusPercent: Number(this.textCircleRadius.value) });
      this.textCircleRadiusOut.value = `${Math.round(Number(this.textCircleRadius.value))}%`;
    });
    for (const [control, patch] of [
      [this.textOutlineWidth, () => ({ outlineWidth: Number(this.textOutlineWidth.value) })],
      [this.textOutlineColor, () => ({ outlineColor: this.textOutlineColor.value })],
      [this.textDropShadowColor, () => ({ singleShadowColor: this.textDropShadowColor.value })],
      [this.textDropShadowOpacity, () => ({ singleShadowOpacity: Number(this.textDropShadowOpacity.value) / 100 })],
      [this.textDropShadowOffset, () => ({ singleShadowOffset: Number(this.textDropShadowOffset.value) })],
      [this.textDropShadowAngle, () => ({ singleShadowAngle: Number(this.textDropShadowAngle.value) })],
      [this.textDropShadowBlur, () => ({ singleShadowBlur: Number(this.textDropShadowBlur.value) })],
      [this.textInnerShadowColor, () => ({ innerShadowColor: this.textInnerShadowColor.value })],
      [this.textInnerShadowOpacity, () => ({ innerShadowOpacity: Number(this.textInnerShadowOpacity.value) / 100 })],
      [this.textInnerShadowOffset, () => ({ innerShadowOffset: Number(this.textInnerShadowOffset.value) })],
      [this.textInnerShadowAngle, () => ({ innerShadowAngle: Number(this.textInnerShadowAngle.value) })],
      [this.textInnerShadowBlur, () => ({ innerShadowBlur: Number(this.textInnerShadowBlur.value) })],
      [this.textBlockShadowColor, () => ({ blockShadowColor: this.textBlockShadowColor.value })],
      [this.textBlockShadowOpacity, () => ({ blockShadowOpacity: Number(this.textBlockShadowOpacity.value) / 100 })],
      [this.textBlockShadowOffset, () => ({ blockShadowOffset: Number(this.textBlockShadowOffset.value) })],
      [this.textBlockShadowAngle, () => ({ blockShadowAngle: Number(this.textBlockShadowAngle.value) })],
      [this.textBlockShadowOutlineWidth, () => ({ blockShadowOutlineWidth: Number(this.textBlockShadowOutlineWidth.value) })],
    ] as const) {
      control.addEventListener("input", () => {
        this.updateVectorEffectProperties(patch());
        this.syncOpenState();
      });
    }
    this.selectionMethod.addEventListener("change", () => {
      this.options.finishSelectionColorPreview();
      this.options.setSelectionMethod(
        this.selectionMethod.value as MobileSelectionSettingsSnapshot["method"],
      );
      this.syncSelection();
    });
    this.textFontFamily.addEventListener("change", () => {
      this.updateTextProperties({ fontFamily: this.textFontFamily.value });
      this.syncText();
    });
    this.textOutlineJoin.addEventListener("change", () => {
      this.updateVectorEffectProperties({
        outlineJoin: this.textOutlineJoin.value as VectorEffectEditorSnapshot["outlineJoin"],
      });
      this.syncTextOutline();
    });
    this.textCircleInverted.addEventListener("change", () => {
      this.updateTextProperties({ circleInverted: this.textCircleInverted.checked });
      this.syncTextWarp();
    });
    for (const [mobile, kind] of [
      [this.textDropShadowEnabled, "single"],
      [this.textInnerShadowEnabled, "inner"],
      [this.textBlockShadowEnabled, "block"],
    ] as const) {
      mobile.addEventListener("change", () => {
        if (this.startVectorPropertyEdit()) {
          this.options.setSelectedVectorShadowEnabled(kind, mobile.checked);
        }
        this.options.browser.requestAnimationFrame(() => this.syncOpenState());
      });
    }

    for (const { mobile, mode } of this.textWarpButtonControls) {
      mobile.addEventListener("click", () => {
        const editing = this.options.setTextWarpMode(mode);
        this.syncAfterAction();
        this.snapTo(editing ? "minimized" : "peek");
      });
    }
    this.textDistortReset.addEventListener("click", () => {
      this.runAction(() => this.options.resetTextDistort());
    });
    this.textDistortEdit.addEventListener("click", () => {
      const editing = this.options.toggleTextDistortEditing();
      this.syncAfterAction();
      this.snapTo(editing ? "minimized" : "peek");
    });
    this.textDistortCancel.addEventListener("click", () => {
      this.runAction(() => this.options.cancelTransform());
    });
    this.textDistortApply.addEventListener("click", () => {
      this.runAction(() => this.options.applyTransform());
    });

    for (const [mobile, mode] of [
      [this.selectionReplace, "replace"],
      [this.selectionAdd, "add"],
      [this.selectionSubtract, "subtract"],
    ] as const) {
      mobile.addEventListener("click", () => {
        this.options.finishSelectionColorPreview();
        this.runAction(() => this.options.setSelectionCombineMode(mode));
      });
    }
    this.selectionInvert.addEventListener("click", () => {
      this.options.finishSelectionColorPreview();
      this.runAction(() => this.options.invertSelection());
    });
    this.selectionClear.addEventListener("click", () => {
      this.options.finishSelectionColorPreview();
      this.runAction(() => this.options.clearSelection());
    });
    this.transformCancel.addEventListener("click", () => {
      this.runAction(() => this.options.cancelTransform());
    });
    this.transformApply.addEventListener("click", () => {
      this.runAction(() => this.options.applyTransform());
    });
    this.bindLayerRange(
      this.layerOpacity,
      this.layerOpacityOut,
      "opacity",
    );
    this.bindLayerRange(
      this.layerContentOpacity,
      this.layerContentOpacityOut,
      "content-opacity",
    );
    this.layerBlendMode.addEventListener("change", () => {
      this.stageLayerOptionsDraft({
        blendMode: this.layerBlendMode.value as LayerBlendMode,
      });
      this.runLayerOptionAction(() => this.options.setSelectedLayerBlendMode(
        this.layerBlendMode.value as LayerBlendMode,
      ));
    });
    this.layerCutoutMode.addEventListener("change", () => {
      this.stageLayerOptionsDraft({
        cutoutMode: this.layerCutoutMode.value as LayerCutoutMode,
      });
      this.runLayerOptionAction(() => this.options.setSelectedLayerCutoutMode(
        this.layerCutoutMode.value as LayerCutoutMode,
      ));
    });
    for (const [kind, elements] of [
      ["current", this.layerTonalCurrent],
      ["underlying", this.layerTonalUnderlying],
    ] as const) {
      elements.inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
          this.updateLayerTonalBlendDraft(kind, index, Number(input.value));
        });
        input.addEventListener("change", () => {
          if (!this.layerTonalKeyboardEdits.has(input)) {
            this.finishLayerTonalBlendEdit();
          }
        });
        input.addEventListener("pointercancel", () => this.finishLayerTonalBlendEdit());
        input.addEventListener("keydown", (event) => {
          if (
            event.key === "ArrowLeft"
            || event.key === "ArrowRight"
            || event.key === "ArrowUp"
            || event.key === "ArrowDown"
            || event.key === "Home"
            || event.key === "End"
            || event.key === "PageUp"
            || event.key === "PageDown"
          ) {
            this.layerTonalKeyboardEdits.add(input);
          }
        });
        input.addEventListener("keyup", () => {
          if (!this.layerTonalKeyboardEdits.delete(input)) return;
          this.finishLayerTonalBlendEdit();
        });
        input.addEventListener("blur", () => {
          this.layerTonalKeyboardEdits.delete(input);
          this.finishLayerTonalBlendEdit();
        });
      });
    }
    this.svgStyleRasterize.addEventListener("click", () => {
      this.runAction(() => this.options.rasterizeSelectedSvg());
    });
    this.textAdd.addEventListener("click", () => {
      const color = this.pendingTextColor ?? this.textColor.value;
      this.pendingTextColor = null;
      this.runAction(() => this.options.createText(color));
    });
    for (const [mobile, action] of [
      [this.textReset, this.options.resetText],
      [this.textDelete, this.options.deleteText],
      [this.textRasterize, this.options.rasterizeText],
    ] as const) {
      mobile.addEventListener("click", () => {
        this.runAction(action);
      });
    }

    for (const mobile of [
      this.textValue, this.textFontFamily, this.textFontSize, this.textColor,
      this.textWarpCurve, this.textCircleRadius, this.textCircleInverted,
      this.textOutlineWidth, this.textOutlineColor, this.textOutlineJoin,
      this.textDropShadowEnabled, this.textDropShadowColor,
      this.textDropShadowOpacity, this.textDropShadowOffset,
      this.textDropShadowAngle, this.textDropShadowBlur,
      this.textInnerShadowEnabled, this.textInnerShadowColor,
      this.textInnerShadowOpacity, this.textInnerShadowOffset,
      this.textInnerShadowAngle, this.textInnerShadowBlur,
      this.textBlockShadowEnabled, this.textBlockShadowColor,
      this.textBlockShadowOpacity, this.textBlockShadowOffset,
      this.textBlockShadowAngle, this.textBlockShadowOutlineWidth,
    ]) {
      this.bindVectorHistoryControl(mobile);
    }

    this.options.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.close(true);
    });
  }

  private syncAfterAction(): void {
    this.syncOpenState();
    this.options.browser.requestAnimationFrame(() => this.syncOpenState());
  }

  private runAction(action: () => void): void {
    action();
    this.syncAfterAction();
  }

  private runLayerOptionAction(action: () => void | Promise<void>): void {
    const result = action();
    if (result) {
      void result.then(
        () => this.requestLayerOptionsSync(),
        () => this.requestLayerOptionsSync(),
      );
      return;
    }
    this.requestLayerOptionsSync();
  }

  private bindLayerRange(
    input: HTMLInputElement,
    output: HTMLOutputElement,
    field: "opacity" | "content-opacity",
  ): void {
    const publish = (): void => {
      const percent = Math.min(100, Math.max(0, Number(input.value)));
      output.value = `${Math.round(percent)}%`;
      const patch = field === "opacity"
        ? { opacity: percent / 100 }
        : { contentOpacity: percent / 100 };
      this.stageLayerOptionsDraft(patch);
      const key = this.layerOptionsDraft?.key;
      if (!key) return;
      this.pendingLayerRangeUpdates.set(field, { key, value: percent / 100 });
      this.requestLayerRangeUpdate();
    };
    const beginGesture = (): void => {
      this.activeLayerRangeGestures.add(input);
    };
    const finishGesture = (): void => {
      this.activeLayerRangeGestures.delete(input);
      this.flushLayerRangeUpdates();
    };
    input.addEventListener("input", publish);
    input.addEventListener("pointerdown", beginGesture);
    input.addEventListener("pointerup", finishGesture);
    input.addEventListener("pointercancel", finishGesture);
    input.addEventListener("lostpointercapture", finishGesture);
    input.addEventListener("change", finishGesture);
    input.addEventListener("keydown", beginGesture);
    input.addEventListener("keyup", finishGesture);
    input.addEventListener("blur", finishGesture);
  }

  private requestLayerRangeUpdate(): void {
    if (this.layerRangeUpdateFrame !== null) return;
    this.layerRangeUpdateFrame = this.options.browser.requestAnimationFrame(() => {
      this.layerRangeUpdateFrame = null;
      this.flushLayerRangeUpdates();
    });
  }

  private flushLayerRangeUpdates(): void {
    if (this.layerRangeUpdateFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.layerRangeUpdateFrame);
      this.layerRangeUpdateFrame = null;
    }
    const updates = [...this.pendingLayerRangeUpdates.entries()];
    this.pendingLayerRangeUpdates.clear();
    for (const [field, update] of updates) {
      const result = field === "opacity"
        ? this.options.setSelectedLayerOpacity(update.key, update.value)
        : this.options.setSelectedLayerContentOpacity(update.key, update.value);
      if (result) {
        // SceneEditorController already schedules the authoritative UI refresh
        // once its latest-only queue drains. Avoid a second full stats snapshot
        // for the same slider frame.
        void result.catch(() => this.requestLayerOptionsSync());
      } else {
        this.requestLayerOptionsSync();
      }
    }
  }

  private requestLayerOptionsSync(): void {
    if (this.layerOptionsSyncFrame !== null) return;
    this.layerOptionsSyncFrame = this.options.browser.requestAnimationFrame(() => {
      this.layerOptionsSyncFrame = null;
      this.syncOpenState();
    });
  }

  private startVectorPropertyEdit(): boolean {
    if (this.vectorPropertyEditOpen) return true;
    this.vectorPropertyEditOpen = this.options.beginSelectedVectorPropertyEdit();
    return this.vectorPropertyEditOpen;
  }

  private finishVectorPropertyEdit(): void {
    if (!this.vectorPropertyEditOpen) return;
    this.vectorPropertyEditOpen = false;
    this.options.commitSelectedVectorPropertyEdit();
  }

  private updateTextProperties(patch: VectorTextEditorPatch): void {
    if (!this.startVectorPropertyEdit()) return;
    this.options.updateSelectedTextProperties(patch);
  }

  private updateVectorEffectProperties(patch: VectorEffectEditorPatch): void {
    if (!this.startVectorPropertyEdit()) return;
    this.options.updateSelectedVectorEffectProperties(patch);
  }

  private bindVectorHistoryControl(control: HTMLElement): void {
    const begin = () => { this.startVectorPropertyEdit(); };
    const commit = () => { this.finishVectorPropertyEdit(); };
    control.addEventListener("focus", begin);
    control.addEventListener("pointerdown", begin);
    if (control instanceof HTMLInputElement && control.type === "range") {
      control.addEventListener("pointerup", commit);
      control.addEventListener("pointercancel", commit);
      control.addEventListener("keydown", begin);
      control.addEventListener("keyup", commit);
      control.addEventListener("blur", commit);
      return;
    }
    control.addEventListener("change", commit);
    control.addEventListener("blur", commit);
  }

  private syncFill(): void {
    const snapshot = this.options.getFillSettings();
    this.fillTolerance.value = String(snapshot.tolerance);
    this.fillTolerance.disabled = snapshot.locked;
    this.fillToleranceOut.value = `${snapshot.tolerance.toFixed(1)}%`;
    this.fillColor.value = colorInputValue(snapshot.color);
    this.fillColorControl.style.setProperty(
      "--mobile-raster-effect-color",
      this.fillColor.value,
    );
    this.fillColor.disabled = snapshot.locked;
  }

  private syncSelection(): void {
    const snapshot = this.options.getSelectionSettings();
    this.selectionMethod.value = snapshot.method;
    this.selectionMethod.disabled = snapshot.locked || snapshot.previewing;
    this.selectionTolerance.value = String(snapshot.tolerance);
    this.selectionTolerance.disabled = snapshot.locked;
    this.selectionToleranceOut.value = `${snapshot.tolerance}/255`;
    this.selectionColor.value = colorInputValue(snapshot.color);
    this.selectionColorControl.style.setProperty(
      "--mobile-raster-effect-color",
      this.selectionColor.value,
    );
    this.selectionColor.disabled = snapshot.locked;
    const colorRange = snapshot.method === "color-range";
    const lasso = snapshot.method === "lasso";
    this.selectionToleranceControl.hidden = lasso;
    this.selectionToleranceHint.hidden = lasso;
    this.selectionColorControl.hidden = !colorRange;
    for (const [mobile, mode] of [
      [this.selectionReplace, "replace"],
      [this.selectionAdd, "add"],
      [this.selectionSubtract, "subtract"],
    ] as const) {
      mobile.setAttribute("aria-pressed", String(snapshot.combineMode === mode));
      mobile.disabled = snapshot.locked || snapshot.previewing;
    }
    this.selectionInvert.disabled = !snapshot.canInvert || snapshot.previewing;
    this.selectionClear.disabled = !snapshot.canClear;
    this.selectionResult.textContent = snapshot.status;
  }

  private syncTransform(): void {
    const actionSnapshot = this.options.getTransformActionSnapshot();
    const transactionActive = this.syncTransformActions(
      this.transformCancel,
      this.transformApply,
      actionSnapshot,
    );
    const kind = this.activeKind;
    this.transformHint.textContent = actionSnapshot.preparing
      ? `Preparing ${kind === "warp" ? "Warp" : kind === "perspective" ? "Perspective" : "Transform"} on the GPU…`
      : transactionActive
      ? kind === "warp"
        ? "Drag any cell, even beyond the frame: that cell bends most while nearby cells follow smoothly. Each corner has two independent Bézier handles for curving its edges."
        : kind === "perspective"
          ? "Drag any corner independently to set the perspective."
          : "Preview active. Apply or cancel the transform."
      : kind === "warp"
        ? "Select a raster layer, then drag anywhere inside its Warp grid."
        : kind === "perspective"
          ? "Select a raster layer, then drag its four perspective corners."
          : "Select content on the canvas, then drag it to transform.";
  }

  private syncTransformActions(
    cancelTarget: HTMLButtonElement,
    applyTarget: HTMLButtonElement,
    snapshot = this.options.getTransformActionSnapshot(),
  ): boolean {
    cancelTarget.disabled = !snapshot.canCancel;
    applyTarget.disabled = !snapshot.canApply;
    return snapshot.active;
  }

  private stageLayerOptionsDraft(patch: {
    readonly opacity?: number;
    readonly blendMode?: LayerBlendMode;
    readonly contentOpacity?: number;
    readonly cutoutMode?: LayerCutoutMode;
  }): void {
    if (!this.layerOptionsDraft) return;
    this.layerOptionsDraft = { ...this.layerOptionsDraft, ...patch };
  }

  private syncLayerOptions(): void {
    const snapshot = this.options.getSelectedLayerOptions();
    if (!snapshot) return;
    if (this.layerOptionsDraft?.key !== snapshot.key) {
      this.layerOptionsDraft = { key: snapshot.key };
    }
    const draft = this.layerOptionsDraft;
    const opacity = Math.min(1, Math.max(0, draft?.opacity ?? snapshot.opacity));
    if (!this.activeLayerRangeGestures.has(this.layerOpacity)) {
      this.layerOpacity.value = String(Math.round(opacity * 100));
    }
    this.layerOpacityOut.value = `${Math.round(opacity * 100)}%`;
    this.layerOpacity.disabled = snapshot.locked;
    this.layerOpacity.setAttribute("aria-label", `Opacity for ${snapshot.name}`);
    const rasterOptionsAvailable = snapshot.blendMode !== null
      && snapshot.contentOpacity !== null
      && snapshot.cutoutMode !== null
      && snapshot.tonalBlend !== null;
    this.rasterLayerOptions.hidden = !rasterOptionsAvailable;
    this.layerBlendModeControl.hidden = !rasterOptionsAvailable;
    if (!rasterOptionsAvailable) {
      this.layerTonalBlendDraft = null;
      this.layerTonalKeyboardEdits.clear();
      return;
    }

    this.layerBlendMode.value = draft?.blendMode ?? snapshot.blendMode!;
    this.layerBlendMode.disabled = snapshot.locked;
    this.layerBlendMode.setAttribute("aria-label", `Blend mode for ${snapshot.name}`);

    const contentOpacity = Math.min(
      1,
      Math.max(0, draft?.contentOpacity ?? snapshot.contentOpacity!),
    );
    if (!this.activeLayerRangeGestures.has(this.layerContentOpacity)) {
      this.layerContentOpacity.value = String(Math.round(contentOpacity * 100));
    }
    this.layerContentOpacityOut.value = `${Math.round(contentOpacity * 100)}%`;
    this.layerContentOpacity.disabled = snapshot.locked;
    this.layerContentOpacity.setAttribute("aria-label", `Fill for ${snapshot.name}`);

    this.layerCutoutMode.value = draft?.cutoutMode ?? snapshot.cutoutMode!;
    this.layerCutoutMode.disabled = snapshot.locked;
    this.layerCutoutMode.setAttribute("aria-label", `Knockout for ${snapshot.name}`);

    if (this.layerTonalBlendDraft?.key !== snapshot.key) {
      this.layerTonalBlendDraft = null;
      this.layerTonalKeyboardEdits.clear();
    }
    const tonalBlend = this.layerTonalBlendDraft?.value ?? snapshot.tonalBlend!;
    this.syncLayerTonalRange(
      this.layerTonalCurrent,
      tonalBlend.current,
      "Current Layer",
      snapshot.name,
      snapshot.locked,
    );
    this.syncLayerTonalRange(
      this.layerTonalUnderlying,
      tonalBlend.underlying,
      "Underlying Layer",
      snapshot.name,
      snapshot.locked,
    );
  }

  private updateLayerTonalBlendDraft(
    kind: MobileLayerTonalRangeKind,
    index: number,
    value: number,
  ): void {
    const snapshot = this.options.getSelectedLayerOptions();
    if (
      !snapshot
      || snapshot.locked
      || snapshot.tonalBlend === null
      || snapshot.contentOpacity === null
      || snapshot.cutoutMode === null
    ) return;
    const base = this.layerTonalBlendDraft?.key === snapshot.key
      ? this.layerTonalBlendDraft.value
      : cloneLayerTonalBlend(snapshot.tonalBlend);
    const candidate = [...base[kind]];
    candidate[index] = value;
    const range = normalizeLayerTonalRange(candidate);
    const tonalBlend: LayerTonalBlend = kind === "current"
      ? { current: range, underlying: base.underlying }
      : { current: base.current, underlying: range };
    this.layerTonalBlendDraft = { key: snapshot.key, value: tonalBlend };
    this.syncLayerTonalRange(
      kind === "current" ? this.layerTonalCurrent : this.layerTonalUnderlying,
      range,
      kind === "current" ? "Current Layer" : "Underlying Layer",
      snapshot.name,
      false,
    );
    this.runLayerOptionAction(() => this.options.setSelectedLayerTonalBlend(
      cloneLayerTonalBlend(tonalBlend),
    ));
  }

  private finishLayerTonalBlendEdit(): void {
    if (!this.layerTonalBlendDraft) return;
    this.requestLayerOptionsSync();
  }

  private syncLayerTonalRange(
    elements: MobileLayerTonalRangeElements,
    value: LayerTonalRange,
    label: "Current Layer" | "Underlying Layer",
    layerName: string,
    locked: boolean,
  ): void {
    const stopLabels = [
      "shadows hidden to",
      "shadows visible from",
      "highlights visible to",
      "highlights hidden from",
    ] as const;
    const minimums = [0, value[0], value[1], value[2]] as const;
    const maximums = [value[1], value[2], value[3], 255] as const;
    elements.output.value = `${value[0]} / ${value[1]} — ${value[2]} / ${value[3]}`;
    elements.root.setAttribute("aria-disabled", String(locked));
    value.forEach((stop, index) => {
      const input = elements.inputs[index];
      const output = elements.valueOutputs[index];
      input.min = String(minimums[index]);
      input.max = String(maximums[index]);
      input.value = String(stop);
      input.disabled = locked;
      input.setAttribute("aria-label", `${label} ${stopLabels[index]} for ${layerName}`);
      output.value = String(stop);
      elements.root.style.setProperty(
        `--mobile-layer-tonal-stop-${index}`,
        `${(stop / 255 * 100).toFixed(3)}%`,
      );
    });
  }

  private startSvgPaintEdit(index: number): void {
    if (this.svgPaintEditIndex === index) return;
    this.finishSvgPaintEdit();
    if (this.options.beginSvgPaintEdit()) this.svgPaintEditIndex = index;
  }

  private finishSvgPaintEdit(): void {
    if (this.svgPaintEditIndex === null) return;
    this.svgPaintEditIndex = null;
    this.options.commitSvgPaintEdit();
  }

  private rebuildSvgPalette(snapshot: MobileSvgStyleSnapshot): void {
    this.finishSvgPaintEdit();
    this.svgStylePalette.replaceChildren(...snapshot.paintColors.map((color, index) => {
      const label = this.options.document.createElement("label");
      label.className = "mobile-raster-effect-color";
      const title = this.options.document.createElement("span");
      title.textContent = snapshot.paintColors.length === 1
        ? "Color"
        : `Color ${index + 1}`;
      const disc = this.options.document.createElement("span");
      disc.className = "mobile-raster-effect-color-disc";
      const input = this.options.document.createElement("input");
      input.type = "color";
      input.value = colorInputValue(color);
      input.disabled = snapshot.locked;
      input.dataset.svgPaintIndex = String(index);
      label.style.setProperty("--mobile-raster-effect-color", input.value);
      input.addEventListener("pointerdown", () => this.startSvgPaintEdit(index));
      input.addEventListener("focus", () => this.startSvgPaintEdit(index));
      input.addEventListener("input", () => {
        this.startSvgPaintEdit(index);
        label.style.setProperty("--mobile-raster-effect-color", input.value);
        this.options.setSelectedSvgPaintColor(index, input.value);
      });
      input.addEventListener("change", () => {
        this.startSvgPaintEdit(index);
        try {
          label.style.setProperty("--mobile-raster-effect-color", input.value);
          this.options.setSelectedSvgPaintColor(index, input.value);
        } finally {
          this.finishSvgPaintEdit();
        }
      });
      input.addEventListener("blur", () => this.finishSvgPaintEdit());
      input.addEventListener("pointercancel", () => this.finishSvgPaintEdit());
      disc.append(input);
      label.append(title, disc);
      return label;
    }));
  }

  private syncSvgStyle(): void {
    const snapshot = this.options.getSelectedSvgStyle();
    if (!snapshot) return;
    const signature = `${snapshot.id}:${snapshot.paintColors.length}`;
    if (signature !== this.svgPaletteSignature) {
      this.svgPaletteSignature = signature;
      this.rebuildSvgPalette(snapshot);
    }
    const inputs = this.svgStylePalette.querySelectorAll<HTMLInputElement>(
      "input[data-svg-paint-index]",
    );
    inputs.forEach((input, index) => {
      const value = colorInputValue(snapshot.paintColors[index] ?? "#000000");
      if (this.options.document.activeElement !== input) input.value = value;
      input.disabled = snapshot.locked;
      input.closest<HTMLElement>(".mobile-raster-effect-color")
        ?.style.setProperty("--mobile-raster-effect-color", input.value);
    });
    this.svgStyleRasterize.disabled = snapshot.locked;
    this.svgStyleStatus.textContent = snapshot.paintColors.length === 0
      ? `${snapshot.name} has no editable paint colors.`
      : `${snapshot.name} · ${snapshot.paintColors.length} editable `
        + `${snapshot.paintColors.length === 1 ? "color" : "colors"}`;
  }

  private syncText(): void {
    const snapshot = this.options.getTextEditorSnapshot();
    this.textValue.value = snapshot.text;
    this.textValue.disabled = !snapshot.selected || snapshot.locked;
    this.textFontFamily.value = snapshot.fontFamily;
    this.textFontFamily.disabled = !snapshot.selected || snapshot.locked;
    this.textFontSize.value = String(snapshot.fontSize);
    this.textFontSize.disabled = !snapshot.selected || snapshot.locked;
    this.textFontSizeOut.value = `${Math.round(snapshot.fontSize)} px`;
    const textColor = snapshot.selected
      ? snapshot.color
      : this.pendingTextColor ?? this.options.getTextCreationColor();
    this.textColor.value = colorInputValue(textColor);
    this.textColorControl.style.setProperty("--mobile-raster-effect-color", this.textColor.value);
    this.textColor.disabled = snapshot.selected ? snapshot.locked : !snapshot.canCreate;
    this.textAdd.disabled = !snapshot.canCreate;
    this.textReset.disabled = !snapshot.canReset;
    this.textDelete.disabled = !snapshot.canDelete;
    this.textRasterize.disabled = !snapshot.canRasterize;
  }

  private syncRange(
    mobile: HTMLInputElement,
    output: HTMLOutputElement,
    value: number,
    locked: boolean,
    format: (value: number) => string,
  ): void {
    mobile.value = String(value);
    mobile.disabled = locked;
    output.value = format(value);
  }

  private syncColor(
    mobile: HTMLInputElement,
    control: HTMLElement,
    value: string,
    locked: boolean,
  ): void {
    mobile.value = colorInputValue(value);
    mobile.disabled = locked;
    control.style.setProperty("--mobile-raster-effect-color", mobile.value);
  }

  private syncTextWarp(): void {
    const snapshot = this.options.getTextEditorSnapshot();
    const locked = !snapshot.selected || snapshot.locked;
    for (const { mobile, mode } of this.textWarpButtonControls) {
      const pressed = snapshot.transformType === mode;
      mobile.setAttribute("aria-pressed", String(pressed));
      mobile.disabled = locked;
    }
    this.textWarpDistortControls.hidden = snapshot.transformType !== "distort";
    this.textWarpCurveControls.hidden = snapshot.transformType !== "arch"
      && snapshot.transformType !== "wave";
    this.textWarpCircleControls.hidden = snapshot.transformType !== "circle";
    this.textDistortReset.disabled = locked;
    this.textDistortEdit.disabled = locked;
    this.textDistortEdit.setAttribute("aria-pressed", String(snapshot.distortEditing));
    this.textDistortEdit.textContent = snapshot.distortEditing ? "Done" : "Edit";
    this.textDistortCommitActions.hidden = !this.syncTransformActions(
      this.textDistortCancel,
      this.textDistortApply,
    );
    this.syncRange(
      this.textWarpCurve,
      this.textWarpCurveOut,
      snapshot.transformCurve,
      locked,
      (value) => `${Math.round(value)}%`,
    );
    this.syncRange(
      this.textCircleRadius,
      this.textCircleRadiusOut,
      snapshot.circleRadiusPercent,
      locked,
      (value) => `${Math.round(value)}%`,
    );
    this.textCircleInverted.checked = snapshot.circleInverted;
    this.textCircleInverted.disabled = locked;
  }

  private syncTextOutline(): void {
    const snapshot = this.options.getVectorEffectEditorSnapshot();
    if (!snapshot) return;
    this.syncRange(
      this.textOutlineWidth,
      this.textOutlineWidthOut,
      snapshot.outlineWidth,
      snapshot.locked,
      (value) => `${Math.round(value)} px`,
    );
    this.syncColor(
      this.textOutlineColor,
      this.textOutlineColorControl,
      snapshot.outlineColor,
      snapshot.locked,
    );
    this.textOutlineJoin.value = snapshot.outlineJoin;
    this.textOutlineJoin.disabled = snapshot.locked;
  }

  private syncTextShadow(
    enabled: HTMLInputElement,
    parameters: HTMLElement,
    colorControl: HTMLElement,
    color: HTMLInputElement,
    enabledValue: boolean,
    colorValue: string,
    locked: boolean,
    ranges: readonly {
      mobile: HTMLInputElement;
      output: HTMLOutputElement;
      value: number;
      format: (value: number) => string;
    }[],
  ): void {
    enabled.checked = enabledValue;
    enabled.disabled = locked;
    parameters.hidden = !enabledValue;
    this.syncColor(color, colorControl, colorValue, locked);
    for (const range of ranges) {
      this.syncRange(
        range.mobile,
        range.output,
        range.value,
        locked,
        range.format,
      );
    }
  }

  private syncTextDropShadow(): void {
    const snapshot = this.options.getVectorEffectEditorSnapshot();
    if (!snapshot) return;
    this.syncTextShadow(
      this.textDropShadowEnabled,
      this.textDropShadowParameters,
      this.textDropShadowColorControl,
      this.textDropShadowColor,
      snapshot.singleShadowEnabled,
      snapshot.singleShadowColor,
      snapshot.locked,
      [
        {
          mobile: this.textDropShadowOpacity,
          output: this.textDropShadowOpacityOut,
          value: snapshot.singleShadowOpacity * 100,
          format: (value) => `${Math.round(value)}%`,
        },
        {
          mobile: this.textDropShadowOffset,
          output: this.textDropShadowOffsetOut,
          value: snapshot.singleShadowOffset,
          format: (value) => String(Math.round(value)),
        },
        {
          mobile: this.textDropShadowAngle,
          output: this.textDropShadowAngleOut,
          value: snapshot.singleShadowAngle,
          format: (value) => `${Math.round(value)}°`,
        },
        {
          mobile: this.textDropShadowBlur,
          output: this.textDropShadowBlurOut,
          value: snapshot.singleShadowBlur,
          format: (value) => String(Math.round(value)),
        },
      ],
    );
  }

  private syncTextInnerShadow(): void {
    const snapshot = this.options.getVectorEffectEditorSnapshot();
    if (!snapshot) return;
    this.syncTextShadow(
      this.textInnerShadowEnabled,
      this.textInnerShadowParameters,
      this.textInnerShadowColorControl,
      this.textInnerShadowColor,
      snapshot.innerShadowEnabled,
      snapshot.innerShadowColor,
      snapshot.locked,
      [
        {
          mobile: this.textInnerShadowOpacity,
          output: this.textInnerShadowOpacityOut,
          value: snapshot.innerShadowOpacity * 100,
          format: (value) => `${Math.round(value)}%`,
        },
        {
          mobile: this.textInnerShadowOffset,
          output: this.textInnerShadowOffsetOut,
          value: snapshot.innerShadowOffset,
          format: (value) => String(Math.round(value)),
        },
        {
          mobile: this.textInnerShadowAngle,
          output: this.textInnerShadowAngleOut,
          value: snapshot.innerShadowAngle,
          format: (value) => `${Math.round(value)}°`,
        },
        {
          mobile: this.textInnerShadowBlur,
          output: this.textInnerShadowBlurOut,
          value: snapshot.innerShadowBlur,
          format: (value) => String(Math.round(value)),
        },
      ],
    );
  }

  private syncTextBlockShadow(): void {
    const snapshot = this.options.getVectorEffectEditorSnapshot();
    if (!snapshot) return;
    this.syncTextShadow(
      this.textBlockShadowEnabled,
      this.textBlockShadowParameters,
      this.textBlockShadowColorControl,
      this.textBlockShadowColor,
      snapshot.blockShadowEnabled,
      snapshot.blockShadowColor,
      snapshot.locked,
      [
        {
          mobile: this.textBlockShadowOpacity,
          output: this.textBlockShadowOpacityOut,
          value: snapshot.blockShadowOpacity * 100,
          format: (value) => `${Math.round(value)}%`,
        },
        {
          mobile: this.textBlockShadowOffset,
          output: this.textBlockShadowOffsetOut,
          value: snapshot.blockShadowOffset,
          format: (value) => String(Math.round(value)),
        },
        {
          mobile: this.textBlockShadowAngle,
          output: this.textBlockShadowAngleOut,
          value: snapshot.blockShadowAngle,
          format: (value) => `${Math.round(value)}°`,
        },
        {
          mobile: this.textBlockShadowOutlineWidth,
          output: this.textBlockShadowOutlineWidthOut,
          value: snapshot.blockShadowOutlineWidth,
          format: (value) => `${Math.round(value)} px`,
        },
      ],
    );
  }

  private peekOffset(): number {
    if (this.activeKind === "layer-options") {
      const contentHeight = this.handle.offsetHeight
        + this.header.offsetHeight
        + this.scroll.scrollHeight;
      const visibleHeight = Math.min(
        this.closedOffset(),
        Math.max(
          this.handle.offsetHeight + this.header.offsetHeight,
          Math.min(MOBILE_LAYER_OPTIONS_MAX_VISIBLE_PX, contentHeight),
        ),
      );
      return Math.max(0, Math.round(this.closedOffset() - visibleHeight));
    }
    return Math.max(
      0,
      Math.round(
        this.closedOffset() - mobileToolSettingsPeekHeight(this.options.browser.innerHeight),
      ),
    );
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight));
  }

  private minimizedOffset(): number {
    const visibleHeight = Math.round(this.handle.offsetHeight + this.header.offsetHeight);
    return Math.max(0, this.closedOffset() - visibleHeight);
  }

  private setOffset(offsetPx: number): void {
    const closed = this.closedOffset();
    this.offsetPx = Math.min(closed, Math.max(0, offsetPx));
    this.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
    this.sheet.style.setProperty(
      "--mobile-tool-settings-visible-height",
      `${Math.max(0, Math.round(closed - this.offsetPx))}px`,
    );
  }

  private snapTo(snap: MobileBottomSheetSnap): void {
    if (!this.activeKind) return;
    this.snap = snap;
    this.sheet.dataset.snap = snap;
    const minimized = snap === "minimized";
    const expanded = snap === "expanded";
    this.setMinimizedAccessibility(minimized);
    this.handle.setAttribute("aria-expanded", String(expanded));
    this.handle.setAttribute(
      "aria-label",
      `${minimized ? "Restore" : expanded ? "Collapse" : "Expand"} ${MOBILE_TOOL_TITLES[this.activeKind]} settings`,
    );
    this.setOffset(expanded ? 0 : minimized ? this.minimizedOffset() : this.peekOffset());
  }

  private setMinimizedAccessibility(minimized: boolean): void {
    const activeElement = this.options.document.activeElement;
    if (
      minimized
      && activeElement instanceof HTMLElement
      && this.scroll.contains(activeElement)
    ) {
      this.handle.focus({ preventScroll: true });
    }
    this.scroll.toggleAttribute("inert", minimized);
    this.scroll.setAttribute("aria-hidden", String(minimized));
  }

  private startDrag(event: PointerEvent): void {
    if (!this.openState || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragStartSnap = this.snap;
    this.dragLastY = event.clientY;
    this.dragLastTime = this.options.browser.performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.sheet.classList.add("is-dragging");
    this.handle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const now = this.options.browser.performance.now();
    const elapsed = now - this.dragLastTime;
    if (elapsed > 0 && elapsed <= 120) {
      const immediate = (event.clientY - this.dragLastY) / elapsed;
      this.dragVelocityY = this.dragVelocityY === 0
        ? immediate
        : this.dragVelocityY * 0.35 + immediate * 0.65;
    } else if (elapsed > 120) {
      this.dragVelocityY = 0;
    }
    this.dragLastY = event.clientY;
    this.dragLastTime = now;
    const deltaY = event.clientY - this.dragStartY;
    if (Math.abs(deltaY) >= 4) this.dragMoved = true;
    const maximumOffset = this.dragStartSnap === "minimized"
      ? this.closedOffset()
      : this.minimizedOffset();
    this.setOffset(Math.min(maximumOffset, this.dragStartOffsetPx + deltaY));
  }

  private finishDrag(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.dragPointerId) return;
    if (this.handle.hasPointerCapture(event.pointerId)) {
      this.handle.releasePointerCapture(event.pointerId);
    }
    this.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const velocityAge = this.options.browser.performance.now() - this.dragLastTime;
    const releaseVelocityY = velocityAge <= 100 ? this.dragVelocityY : 0;
    this.dragPointerId = null;
    if (cancelled) {
      this.snapTo(this.dragStartSnap);
      this.dragMoved = false;
      return;
    }
    const decision = resolveMobileBottomSheetDrag({
      startSnap: this.dragStartSnap,
      deltaY,
      releaseVelocityY,
      offsetPx: this.offsetPx,
      peekOffsetPx: this.peekOffset(),
      minimizedOffsetPx: this.minimizedOffset(),
    });
    if (this.dragMoved && decision === "closed") {
      this.close(false);
      this.dragMoved = false;
      return;
    }
    if (this.dragMoved && decision !== "closed") this.snapTo(decision);
  }

  private releaseDragCapture(): void {
    if (
      this.dragPointerId !== null
      && this.handle.hasPointerCapture(this.dragPointerId)
    ) {
      this.handle.releasePointerCapture(this.dragPointerId);
    }
    this.dragPointerId = null;
    this.dragMoved = false;
  }
}
