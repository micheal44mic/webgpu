import {
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";
import {
  LAYER_BLEND_MODE_CATEGORIES,
  type LayerBlendMode,
} from "./layer-blend-modes.ts";

export type MobileToolSettingsKind =
  | "fill"
  | "selection"
  | "transform"
  | "layer-options"
  | "svg-style"
  | "text"
  | "text-warp"
  | "text-outline"
  | "text-drop-shadow"
  | "text-inner-shadow"
  | "text-block-shadow";
type MobileCanvasSettingsTool = "fill" | "selection" | "transform";
type MobileSelectionCombineMode = "replace" | "add" | "subtract";
export type MobileTextWarpMode = "none" | "distort" | "arch" | "circle" | "wave";

export interface MobileLayerOptionsSnapshot {
  readonly key: string;
  readonly name: string;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode | null;
  readonly locked: boolean;
}

export interface MobileSvgStyleSnapshot {
  readonly id: number;
  readonly name: string;
  readonly paintColors: readonly string[];
  readonly locked: boolean;
}

export interface MobileToolSettingsSheetOptions {
  readonly mobileMediaQuery: MediaQueryList;
  readonly selectCanvasTool: (tool: MobileCanvasSettingsTool) => boolean;
  readonly getSelectionStatus: () => string;
  readonly hasSelectedText: () => boolean;
  readonly setSelectionCombineMode: (mode: MobileSelectionCombineMode) => void;
  readonly applySelectionColor: () => void;
  readonly clearSelection: () => void;
  readonly applyTransform: () => void;
  readonly cancelTransform: () => void;
  readonly getSelectedLayerOptions: () => MobileLayerOptionsSnapshot | null;
  readonly setSelectedLayerOpacity: (opacity: number) => void;
  readonly setSelectedLayerBlendMode: (blendMode: LayerBlendMode) => void;
  readonly getSelectedSvgStyle: () => MobileSvgStyleSnapshot | null;
  readonly setSelectedSvgPaintColor: (index: number, color: string) => void;
  readonly beginSvgPaintEdit: () => void;
  readonly commitSvgPaintEdit: () => void;
  readonly rasterizeSelectedSvg: () => void;
  readonly getTextCreationColor: () => string;
  readonly createText: (color: string) => void;
  readonly resetText: () => void;
  readonly deleteText: () => void;
  readonly rasterizeText: () => void;
  readonly setTextWarpMode: (mode: MobileTextWarpMode) => void;
  readonly resetTextDistort: () => void;
  readonly toggleTextDistortEditing: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

const MOBILE_TOOL_MIN_PEEK_PX = 160;
const MOBILE_TOOL_MAX_PEEK_PX = 240;
const MOBILE_TOOL_PEEK_VIEWPORT_RATIO = 0.26;
const MOBILE_LAYER_OPTIONS_MAX_VISIBLE_PX = 288;

const MOBILE_TOOL_TITLES: Readonly<Record<MobileToolSettingsKind, string>> = {
  fill: "Fill",
  selection: "Selection",
  transform: "Transform",
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
  return kind === "fill" || kind === "selection" || kind === "transform";
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Elemento #${id} non trovato.`);
  return result as T;
}

function sourceControl<T extends HTMLElement>(id: string): T {
  return requiredElement<T>(id);
}

function dispatchMirroredValue(
  mobile: HTMLInputElement | HTMLSelectElement,
  sourceId: string,
  eventType: "input" | "change",
): void {
  const source = sourceControl<HTMLInputElement | HTMLSelectElement>(sourceId);
  source.value = mobile.value;
  source.dispatchEvent(new Event(eventType, { bubbles: true }));
}

function dispatchMirroredChecked(
  mobile: HTMLInputElement,
  sourceId: string,
): void {
  const source = sourceControl<HTMLInputElement>(sourceId);
  source.checked = mobile.checked;
  source.dispatchEvent(new Event("change", { bubbles: true }));
}

function dispatchSourceLifecycle(sourceId: string, eventType: string): void {
  sourceControl<HTMLElement>(sourceId).dispatchEvent(new Event(eventType, { bubbles: true }));
}

function bindMirroredHistoryControl(mobile: HTMLElement, sourceId: string): void {
  mobile.addEventListener("pointerdown", () => dispatchSourceLifecycle(sourceId, "pointerdown"));
  mobile.addEventListener("focus", () => dispatchSourceLifecycle(sourceId, "focus"));
  mobile.addEventListener("blur", () => dispatchSourceLifecycle(sourceId, "blur"));
  if (mobile instanceof HTMLInputElement && mobile.type === "range") {
    mobile.addEventListener("pointerup", () => dispatchSourceLifecycle(sourceId, "pointerup"));
    mobile.addEventListener("pointercancel", () => dispatchSourceLifecycle(sourceId, "pointercancel"));
    mobile.addEventListener("keydown", () => dispatchSourceLifecycle(sourceId, "keydown"));
    mobile.addEventListener("keyup", () => dispatchSourceLifecycle(sourceId, "keyup"));
  }
}

function colorInputValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

function mobileBlendModeLabel(mode: LayerBlendMode): string {
  if (mode === "add") return "Add (Linear Dodge)";
  if (mode === "shade") return "Shade (Provisional)";
  return mode
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function mobileBlendCategoryLabel(id: string): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

export function mobileToolSettingsPeekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_TOOL_MAX_PEEK_PX,
    Math.max(MOBILE_TOOL_MIN_PEEK_PX, viewportHeight * MOBILE_TOOL_PEEK_VIEWPORT_RATIO),
  );
}

/**
 * A mobile-only view over settings and actions which already exist elsewhere
 * in the app. It owns no tool state and creates no rendering resources.
 */
export class MobileToolSettingsSheetController {
  readonly sheet = requiredElement<HTMLElement>("mobileToolSettingsSheet");
  readonly handle = requiredElement<HTMLButtonElement>("mobileToolSettingsHandle");
  readonly header = requiredElement<HTMLElement>("mobileToolSettingsHeader");
  readonly title = requiredElement<HTMLElement>("mobileToolSettingsTitle");
  readonly scroll = requiredElement<HTMLElement>("mobileToolSettingsScroll");
  readonly panels = Array.from(
    this.scroll.querySelectorAll<HTMLElement>("[data-mobile-tool-settings-panel]"),
  );

  private readonly fillTolerance = requiredElement<HTMLInputElement>("mobileFillTolerance");
  private readonly fillToleranceOut = requiredElement<HTMLOutputElement>(
    "mobileFillToleranceOut",
  );
  private readonly selectionMethod = requiredElement<HTMLSelectElement>(
    "mobileSelectionMethod",
  );
  private readonly selectionReplace = requiredElement<HTMLButtonElement>(
    "mobileSelectionReplace",
  );
  private readonly selectionAdd = requiredElement<HTMLButtonElement>("mobileSelectionAdd");
  private readonly selectionSubtract = requiredElement<HTMLButtonElement>(
    "mobileSelectionSubtract",
  );
  private readonly selectionToleranceControl = requiredElement<HTMLElement>(
    "mobileSelectionToleranceControl",
  );
  private readonly selectionTolerance = requiredElement<HTMLInputElement>(
    "mobileSelectionTolerance",
  );
  private readonly selectionToleranceOut = requiredElement<HTMLOutputElement>(
    "mobileSelectionToleranceOut",
  );
  private readonly selectionColorControl = requiredElement<HTMLElement>(
    "mobileSelectionColorControl",
  );
  private readonly selectionColor = requiredElement<HTMLInputElement>("mobileSelectionColor");
  private readonly selectionColorApply = requiredElement<HTMLButtonElement>(
    "mobileSelectionColorApply",
  );
  private readonly selectionClear = requiredElement<HTMLButtonElement>("mobileSelectionClear");
  private readonly selectionResult = requiredElement<HTMLElement>("mobileSelectionResult");
  private readonly transformHint = requiredElement<HTMLElement>("mobileTransformHint");
  private readonly transformCancel = requiredElement<HTMLButtonElement>("mobileTransformCancel");
  private readonly transformApply = requiredElement<HTMLButtonElement>("mobileTransformApply");
  private readonly layerOpacity = requiredElement<HTMLInputElement>("mobileLayerOpacity");
  private readonly layerOpacityOut = requiredElement<HTMLOutputElement>(
    "mobileLayerOpacityOut",
  );
  private readonly layerBlendModeControl = requiredElement<HTMLElement>(
    "mobileLayerBlendModeControl",
  );
  private readonly layerBlendMode = requiredElement<HTMLSelectElement>("mobileLayerBlendMode");
  private readonly svgStylePalette = requiredElement<HTMLElement>("mobileSvgStylePalette");
  private readonly svgStyleRasterize = requiredElement<HTMLButtonElement>(
    "mobileSvgStyleRasterize",
  );
  private readonly svgStyleStatus = requiredElement<HTMLElement>("mobileSvgStyleStatus");
  private readonly textValue = requiredElement<HTMLInputElement>("mobileTextValue");
  private readonly textFontFamily = requiredElement<HTMLSelectElement>("mobileTextFontFamily");
  private readonly textFontSize = requiredElement<HTMLInputElement>("mobileTextFontSize");
  private readonly textFontSizeOut = requiredElement<HTMLOutputElement>("mobileTextFontSizeOut");
  private readonly textColorControl = requiredElement<HTMLElement>("mobileTextColorControl");
  private readonly textColor = requiredElement<HTMLInputElement>("mobileTextColor");
  private readonly textAdd = requiredElement<HTMLButtonElement>("mobileTextAdd");
  private readonly textReset = requiredElement<HTMLButtonElement>("mobileTextReset");
  private readonly textDelete = requiredElement<HTMLButtonElement>("mobileTextDelete");
  private readonly textRasterize = requiredElement<HTMLButtonElement>("mobileTextRasterize");
  private readonly textWarpButtons = [
    ["mobileTextWarpNone", "vectorTextTransformNone", "none"],
    ["mobileTextWarpDistort", "vectorTextTransformDistort", "distort"],
    ["mobileTextWarpArch", "vectorTextTransformArch", "arch"],
    ["mobileTextWarpCircle", "vectorTextTransformCircle", "circle"],
    ["mobileTextWarpWave", "vectorTextTransformWave", "wave"],
  ] as const satisfies readonly (readonly [string, string, MobileTextWarpMode])[];
  private readonly textWarpButtonControls = this.textWarpButtons.map(([
    mobileId,
    sourceId,
    mode,
  ]) => ({
    mobile: requiredElement<HTMLButtonElement>(mobileId),
    sourceId,
    mode,
  }));
  private readonly textWarpDistortControls = requiredElement<HTMLElement>(
    "mobileTextWarpDistortControls",
  );
  private readonly textDistortReset = requiredElement<HTMLButtonElement>(
    "mobileTextDistortReset",
  );
  private readonly textDistortEdit = requiredElement<HTMLButtonElement>(
    "mobileTextDistortEdit",
  );
  private readonly textDistortCommitActions = requiredElement<HTMLElement>(
    "mobileTextDistortCommitActions",
  );
  private readonly textDistortCancel = requiredElement<HTMLButtonElement>(
    "mobileTextDistortCancel",
  );
  private readonly textDistortApply = requiredElement<HTMLButtonElement>(
    "mobileTextDistortApply",
  );
  private readonly textWarpCurveControls = requiredElement<HTMLElement>(
    "mobileTextWarpCurveControls",
  );
  private readonly textWarpCurve = requiredElement<HTMLInputElement>("mobileTextWarpCurve");
  private readonly textWarpCurveOut = requiredElement<HTMLOutputElement>(
    "mobileTextWarpCurveOut",
  );
  private readonly textWarpCircleControls = requiredElement<HTMLElement>(
    "mobileTextWarpCircleControls",
  );
  private readonly textCircleRadius = requiredElement<HTMLInputElement>(
    "mobileTextCircleRadius",
  );
  private readonly textCircleRadiusOut = requiredElement<HTMLOutputElement>(
    "mobileTextCircleRadiusOut",
  );
  private readonly textCircleInverted = requiredElement<HTMLInputElement>(
    "mobileTextCircleInverted",
  );
  private readonly textOutlineWidth = requiredElement<HTMLInputElement>(
    "mobileTextOutlineWidth",
  );
  private readonly textOutlineWidthOut = requiredElement<HTMLOutputElement>(
    "mobileTextOutlineWidthOut",
  );
  private readonly textOutlineColorControl = requiredElement<HTMLElement>(
    "mobileTextOutlineColorControl",
  );
  private readonly textOutlineColor = requiredElement<HTMLInputElement>(
    "mobileTextOutlineColor",
  );
  private readonly textOutlineJoin = requiredElement<HTMLSelectElement>(
    "mobileTextOutlineJoin",
  );
  private readonly textDropShadowEnabled = requiredElement<HTMLInputElement>(
    "mobileTextDropShadowEnabled",
  );
  private readonly textDropShadowParameters = requiredElement<HTMLElement>(
    "mobileTextDropShadowParameters",
  );
  private readonly textDropShadowColorControl = requiredElement<HTMLElement>(
    "mobileTextDropShadowColorControl",
  );
  private readonly textDropShadowColor = requiredElement<HTMLInputElement>(
    "mobileTextDropShadowColor",
  );
  private readonly textDropShadowOpacity = requiredElement<HTMLInputElement>(
    "mobileTextDropShadowOpacity",
  );
  private readonly textDropShadowOpacityOut = requiredElement<HTMLOutputElement>(
    "mobileTextDropShadowOpacityOut",
  );
  private readonly textDropShadowOffset = requiredElement<HTMLInputElement>(
    "mobileTextDropShadowOffset",
  );
  private readonly textDropShadowOffsetOut = requiredElement<HTMLOutputElement>(
    "mobileTextDropShadowOffsetOut",
  );
  private readonly textDropShadowAngle = requiredElement<HTMLInputElement>(
    "mobileTextDropShadowAngle",
  );
  private readonly textDropShadowAngleOut = requiredElement<HTMLOutputElement>(
    "mobileTextDropShadowAngleOut",
  );
  private readonly textDropShadowBlur = requiredElement<HTMLInputElement>(
    "mobileTextDropShadowBlur",
  );
  private readonly textDropShadowBlurOut = requiredElement<HTMLOutputElement>(
    "mobileTextDropShadowBlurOut",
  );
  private readonly textInnerShadowEnabled = requiredElement<HTMLInputElement>(
    "mobileTextInnerShadowEnabled",
  );
  private readonly textInnerShadowParameters = requiredElement<HTMLElement>(
    "mobileTextInnerShadowParameters",
  );
  private readonly textInnerShadowColorControl = requiredElement<HTMLElement>(
    "mobileTextInnerShadowColorControl",
  );
  private readonly textInnerShadowColor = requiredElement<HTMLInputElement>(
    "mobileTextInnerShadowColor",
  );
  private readonly textInnerShadowOpacity = requiredElement<HTMLInputElement>(
    "mobileTextInnerShadowOpacity",
  );
  private readonly textInnerShadowOpacityOut = requiredElement<HTMLOutputElement>(
    "mobileTextInnerShadowOpacityOut",
  );
  private readonly textInnerShadowOffset = requiredElement<HTMLInputElement>(
    "mobileTextInnerShadowOffset",
  );
  private readonly textInnerShadowOffsetOut = requiredElement<HTMLOutputElement>(
    "mobileTextInnerShadowOffsetOut",
  );
  private readonly textInnerShadowAngle = requiredElement<HTMLInputElement>(
    "mobileTextInnerShadowAngle",
  );
  private readonly textInnerShadowAngleOut = requiredElement<HTMLOutputElement>(
    "mobileTextInnerShadowAngleOut",
  );
  private readonly textInnerShadowBlur = requiredElement<HTMLInputElement>(
    "mobileTextInnerShadowBlur",
  );
  private readonly textInnerShadowBlurOut = requiredElement<HTMLOutputElement>(
    "mobileTextInnerShadowBlurOut",
  );
  private readonly textBlockShadowEnabled = requiredElement<HTMLInputElement>(
    "mobileTextBlockShadowEnabled",
  );
  private readonly textBlockShadowParameters = requiredElement<HTMLElement>(
    "mobileTextBlockShadowParameters",
  );
  private readonly textBlockShadowColorControl = requiredElement<HTMLElement>(
    "mobileTextBlockShadowColorControl",
  );
  private readonly textBlockShadowColor = requiredElement<HTMLInputElement>(
    "mobileTextBlockShadowColor",
  );
  private readonly textBlockShadowOpacity = requiredElement<HTMLInputElement>(
    "mobileTextBlockShadowOpacity",
  );
  private readonly textBlockShadowOpacityOut = requiredElement<HTMLOutputElement>(
    "mobileTextBlockShadowOpacityOut",
  );
  private readonly textBlockShadowOffset = requiredElement<HTMLInputElement>(
    "mobileTextBlockShadowOffset",
  );
  private readonly textBlockShadowOffsetOut = requiredElement<HTMLOutputElement>(
    "mobileTextBlockShadowOffsetOut",
  );
  private readonly textBlockShadowAngle = requiredElement<HTMLInputElement>(
    "mobileTextBlockShadowAngle",
  );
  private readonly textBlockShadowAngleOut = requiredElement<HTMLOutputElement>(
    "mobileTextBlockShadowAngleOut",
  );
  private readonly textBlockShadowOutlineWidth = requiredElement<HTMLInputElement>(
    "mobileTextBlockShadowOutlineWidth",
  );
  private readonly textBlockShadowOutlineWidthOut = requiredElement<HTMLOutputElement>(
    "mobileTextBlockShadowOutlineWidthOut",
  );

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
  private readonly transformStateObserver: MutationObserver;
  private pendingTextColor: string | null = null;
  private svgPaletteSignature = "";
  private svgPaintEditIndex: number | null = null;

  constructor(options: MobileToolSettingsSheetOptions) {
    this.options = options;
    for (const category of LAYER_BLEND_MODE_CATEGORIES) {
      const group = document.createElement("optgroup");
      group.label = mobileBlendCategoryLabel(category.id);
      for (const mode of category.modes) {
        const option = document.createElement("option");
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
    this.transformStateObserver = new MutationObserver(() => {
      if (!this.openState) return;
      if (this.activeKind === "transform") this.syncTransform();
      else if (this.activeKind === "text-warp") this.syncTextWarp();
    });
    this.transformStateObserver.observe(sourceControl<HTMLElement>("transformCommitBar"), {
      attributes: true,
      attributeFilter: ["hidden"],
    });
    for (const sourceId of ["transformCancel", "transformApply"] as const) {
      this.transformStateObserver.observe(sourceControl<HTMLButtonElement>(sourceId), {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    }
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get toolKind(): MobileToolSettingsKind | null {
    return this.activeKind;
  }

  open(kind: MobileToolSettingsKind, opener: HTMLElement | null = null): void {
    if (!this.options.mobileMediaQuery.matches) return;
    if (isMobileCanvasSettingsTool(kind) && !this.options.selectCanvasTool(kind)) return;
    if (TEXT_SELECTION_REQUIRED_KINDS.has(kind) && !this.options.hasSelectedText()) return;
    if (SELECTED_ITEM_REQUIRED_KINDS.has(kind)) {
      const available = kind === "layer-options"
        ? this.options.getSelectedLayerOptions() !== null
        : this.options.getSelectedSvgStyle() !== null;
      if (!available) return;
    }
    if (this.openState && this.activeKind === kind) return;
    if (this.openState) this.close(false);
    this.options.beforeOpen();

    this.activeKind = kind;
    if (kind === "text") {
      this.pendingTextColor = this.options.hasSelectedText()
        ? null
        : this.options.getTextCreationColor();
    }
    this.opener = opener;
    this.openState = true;
    this.snap = "peek";
    this.sheet.dataset.tool = kind;
    this.sheet.dataset.state = "open";
    this.sheet.hidden = false;
    this.sheet.setAttribute("aria-hidden", "false");
    this.sheet.removeAttribute("inert");
    this.sheet.setAttribute("aria-label", `${MOBILE_TOOL_TITLES[kind]} settings`);
    this.title.textContent = MOBILE_TOOL_TITLES[kind];
    for (const panel of this.panels) {
      panel.hidden = panel.dataset.mobileToolSettingsPanel !== kind;
    }
    this.syncOpenState();
    this.scroll.scrollTop = 0;
    this.snapTo("peek");
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.options.onOpenChange(true);
  }

  close(restoreFocus = false): void {
    if (!this.openState) return;
    this.finishSvgPaintEdit();
    this.openState = false;
    this.releaseDragCapture();
    const activeElement = document.activeElement;
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
      (this.activeKind === "layer-options" && !this.options.getSelectedLayerOptions())
      || (this.activeKind === "svg-style" && !this.options.getSelectedSvgStyle())
    ) {
      this.close(false);
      return;
    }
    if (this.activeKind === "fill") this.syncFill();
    else if (this.activeKind === "selection") this.syncSelection();
    else if (this.activeKind === "transform") this.syncTransform();
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
        dispatchMirroredValue(this.fillTolerance, "fillTolerance", eventType);
        this.syncFill();
      });
      this.selectionTolerance.addEventListener(eventType, () => {
        dispatchMirroredValue(this.selectionTolerance, "selectionTolerance", eventType);
        this.syncSelection();
      });
      this.selectionColor.addEventListener(eventType, () => {
        dispatchMirroredValue(this.selectionColor, "selectionColor", eventType);
        this.selectionColorControl.style.setProperty(
          "--mobile-raster-effect-color",
          this.selectionColor.value,
        );
      });
      this.textValue.addEventListener(eventType, () => {
        dispatchMirroredValue(this.textValue, "vectorTextValue", eventType);
      });
      this.textFontSize.addEventListener(eventType, () => {
        dispatchMirroredValue(this.textFontSize, "vectorTextFontSize", eventType);
        this.syncText();
      });
      this.textColor.addEventListener(eventType, () => {
        if (this.options.hasSelectedText()) {
          dispatchMirroredValue(this.textColor, "vectorTextColor", eventType);
        } else {
          this.pendingTextColor = this.textColor.value;
        }
        this.textColorControl.style.setProperty(
          "--mobile-raster-effect-color",
          this.textColor.value,
        );
      });
      for (const [mobile, sourceId] of [
        [this.textWarpCurve, "vectorTextTransformCurve"],
        [this.textCircleRadius, "vectorTextCircleRadius"],
        [this.textOutlineWidth, "vectorTextOutlineWidth"],
        [this.textOutlineColor, "vectorTextOutlineColor"],
        [this.textDropShadowColor, "vectorTextSingleShadowColor"],
        [this.textDropShadowOpacity, "vectorTextSingleShadowOpacity"],
        [this.textDropShadowOffset, "vectorTextSingleShadowOffset"],
        [this.textDropShadowAngle, "vectorTextSingleShadowAngle"],
        [this.textDropShadowBlur, "vectorTextSingleShadowBlur"],
        [this.textInnerShadowColor, "vectorTextInnerShadowColor"],
        [this.textInnerShadowOpacity, "vectorTextInnerShadowOpacity"],
        [this.textInnerShadowOffset, "vectorTextInnerShadowOffset"],
        [this.textInnerShadowAngle, "vectorTextInnerShadowAngle"],
        [this.textInnerShadowBlur, "vectorTextInnerShadowBlur"],
        [this.textBlockShadowColor, "vectorTextBlockShadowColor"],
        [this.textBlockShadowOpacity, "vectorTextBlockShadowOpacity"],
        [this.textBlockShadowOffset, "vectorTextBlockShadowOffset"],
        [this.textBlockShadowAngle, "vectorTextBlockShadowAngle"],
        [this.textBlockShadowOutlineWidth, "vectorTextBlockShadowOutlineWidth"],
      ] as const) {
        mobile.addEventListener(eventType, () => {
          dispatchMirroredValue(mobile, sourceId, eventType);
          this.syncOpenState();
        });
      }
    }
    this.selectionMethod.addEventListener("change", () => {
      dispatchMirroredValue(this.selectionMethod, "selectionMethod", "change");
      this.syncSelection();
    });
    this.textFontFamily.addEventListener("change", () => {
      dispatchMirroredValue(this.textFontFamily, "vectorTextFontFamily", "change");
      this.syncText();
    });
    this.textOutlineJoin.addEventListener("change", () => {
      dispatchMirroredValue(this.textOutlineJoin, "vectorTextOutlineJoin", "change");
      this.syncTextOutline();
    });
    this.textCircleInverted.addEventListener("change", () => {
      dispatchMirroredChecked(this.textCircleInverted, "vectorTextCircleInverted");
      this.syncTextWarp();
    });
    for (const [mobile, sourceId] of [
      [this.textDropShadowEnabled, "vectorTextSingleShadowEnabled"],
      [this.textInnerShadowEnabled, "vectorTextInnerShadowEnabled"],
      [this.textBlockShadowEnabled, "vectorTextBlockShadowEnabled"],
    ] as const) {
      mobile.addEventListener("change", () => {
        dispatchMirroredChecked(mobile, sourceId);
        requestAnimationFrame(() => this.syncOpenState());
      });
    }

    for (const { mobile, mode } of this.textWarpButtonControls) {
      mobile.addEventListener("click", () => {
        this.runAction(() => this.options.setTextWarpMode(mode));
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
        this.runAction(() => this.options.setSelectionCombineMode(mode));
      });
    }
    this.selectionColorApply.addEventListener("click", () => {
      this.runAction(() => this.options.applySelectionColor());
    });
    this.selectionClear.addEventListener("click", () => {
      this.runAction(() => this.options.clearSelection());
    });
    this.transformCancel.addEventListener("click", () => {
      this.runAction(() => this.options.cancelTransform());
    });
    this.transformApply.addEventListener("click", () => {
      this.runAction(() => this.options.applyTransform());
    });
    this.layerOpacity.addEventListener("input", () => {
      this.layerOpacityOut.value = `${Math.round(Number(this.layerOpacity.value))}%`;
    });
    this.layerOpacity.addEventListener("change", () => {
      this.runAction(() => this.options.setSelectedLayerOpacity(
        Number(this.layerOpacity.value) / 100,
      ));
    });
    this.layerBlendMode.addEventListener("change", () => {
      this.runAction(() => this.options.setSelectedLayerBlendMode(
        this.layerBlendMode.value as LayerBlendMode,
      ));
    });
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

    for (const [mobile, sourceId] of [
      [this.textValue, "vectorTextValue"],
      [this.textFontFamily, "vectorTextFontFamily"],
      [this.textFontSize, "vectorTextFontSize"],
      [this.textColor, "vectorTextColor"],
      [this.textWarpCurve, "vectorTextTransformCurve"],
      [this.textCircleRadius, "vectorTextCircleRadius"],
      [this.textCircleInverted, "vectorTextCircleInverted"],
      [this.textOutlineWidth, "vectorTextOutlineWidth"],
      [this.textOutlineColor, "vectorTextOutlineColor"],
      [this.textOutlineJoin, "vectorTextOutlineJoin"],
      [this.textDropShadowEnabled, "vectorTextSingleShadowEnabled"],
      [this.textDropShadowColor, "vectorTextSingleShadowColor"],
      [this.textDropShadowOpacity, "vectorTextSingleShadowOpacity"],
      [this.textDropShadowOffset, "vectorTextSingleShadowOffset"],
      [this.textDropShadowAngle, "vectorTextSingleShadowAngle"],
      [this.textDropShadowBlur, "vectorTextSingleShadowBlur"],
      [this.textInnerShadowEnabled, "vectorTextInnerShadowEnabled"],
      [this.textInnerShadowColor, "vectorTextInnerShadowColor"],
      [this.textInnerShadowOpacity, "vectorTextInnerShadowOpacity"],
      [this.textInnerShadowOffset, "vectorTextInnerShadowOffset"],
      [this.textInnerShadowAngle, "vectorTextInnerShadowAngle"],
      [this.textInnerShadowBlur, "vectorTextInnerShadowBlur"],
      [this.textBlockShadowEnabled, "vectorTextBlockShadowEnabled"],
      [this.textBlockShadowColor, "vectorTextBlockShadowColor"],
      [this.textBlockShadowOpacity, "vectorTextBlockShadowOpacity"],
      [this.textBlockShadowOffset, "vectorTextBlockShadowOffset"],
      [this.textBlockShadowAngle, "vectorTextBlockShadowAngle"],
      [this.textBlockShadowOutlineWidth, "vectorTextBlockShadowOutlineWidth"],
    ] as const) {
      bindMirroredHistoryControl(mobile, sourceId);
    }

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.close(true);
    });
  }

  private syncAfterAction(): void {
    this.syncOpenState();
    requestAnimationFrame(() => this.syncOpenState());
  }

  private runAction(action: () => void): void {
    action();
    this.syncAfterAction();
  }

  private syncFill(): void {
    const source = sourceControl<HTMLInputElement>("fillTolerance");
    this.fillTolerance.value = source.value;
    this.fillTolerance.disabled = source.disabled;
    this.fillToleranceOut.value = `${Number(source.value).toFixed(1)}%`;
  }

  private syncSelection(): void {
    const sourceMethod = sourceControl<HTMLSelectElement>("selectionMethod");
    const sourceTolerance = sourceControl<HTMLInputElement>("selectionTolerance");
    const sourceColor = sourceControl<HTMLInputElement>("selectionColor");
    this.selectionMethod.value = sourceMethod.value;
    this.selectionMethod.disabled = sourceMethod.disabled;
    this.selectionTolerance.value = sourceTolerance.value;
    this.selectionTolerance.disabled = sourceTolerance.disabled;
    this.selectionToleranceOut.value = `${Math.round(Number(sourceTolerance.value))}/255`;
    this.selectionColor.value = sourceColor.value;
    this.selectionColorControl.style.setProperty("--mobile-raster-effect-color", sourceColor.value);
    this.selectionColor.disabled = sourceColor.disabled;
    const colorRange = sourceMethod.value === "color-range";
    const lasso = sourceMethod.value === "lasso";
    this.selectionToleranceControl.hidden = lasso;
    this.selectionColorControl.hidden = !colorRange;
    this.selectionColorApply.hidden = !colorRange;
    for (const [mobile, sourceId] of [
      [this.selectionReplace, "selectionReplace"],
      [this.selectionAdd, "selectionAdd"],
      [this.selectionSubtract, "selectionSubtract"],
    ] as const) {
      const source = sourceControl<HTMLButtonElement>(sourceId);
      mobile.setAttribute("aria-pressed", source.getAttribute("aria-pressed") ?? "false");
      mobile.disabled = source.disabled;
    }
    this.selectionColorApply.disabled = sourceControl<HTMLButtonElement>(
      "selectionColorApply",
    ).disabled;
    this.selectionClear.disabled = sourceControl<HTMLButtonElement>("selectionClear").disabled;
    this.selectionResult.textContent = this.options.getSelectionStatus();
  }

  private syncTransform(): void {
    const transactionActive = this.syncTransformActions(
      this.transformCancel,
      this.transformApply,
    );
    this.transformHint.textContent = transactionActive
      ? "Preview active. Apply or cancel the transform."
      : "Select content on the canvas, then drag it to transform.";
  }

  private syncTransformActions(
    cancelTarget: HTMLButtonElement,
    applyTarget: HTMLButtonElement,
  ): boolean {
    const commitBar = sourceControl<HTMLElement>("transformCommitBar");
    const cancel = sourceControl<HTMLButtonElement>("transformCancel");
    const apply = sourceControl<HTMLButtonElement>("transformApply");
    const transactionActive = !commitBar.hidden;
    cancelTarget.disabled = !transactionActive || cancel.disabled;
    applyTarget.disabled = !transactionActive || apply.disabled;
    return transactionActive;
  }

  private syncLayerOptions(): void {
    const snapshot = this.options.getSelectedLayerOptions();
    if (!snapshot) return;
    const opacity = Math.min(1, Math.max(0, snapshot.opacity));
    this.layerOpacity.value = String(Math.round(opacity * 100));
    this.layerOpacityOut.value = `${Math.round(opacity * 100)}%`;
    this.layerOpacity.disabled = snapshot.locked;
    this.layerOpacity.setAttribute("aria-label", `Opacity for ${snapshot.name}`);
    this.layerBlendModeControl.hidden = snapshot.blendMode === null;
    if (snapshot.blendMode !== null) {
      this.layerBlendMode.value = snapshot.blendMode;
      this.layerBlendMode.disabled = snapshot.locked;
      this.layerBlendMode.setAttribute("aria-label", `Blend mode for ${snapshot.name}`);
    }
  }

  private startSvgPaintEdit(index: number): void {
    if (this.svgPaintEditIndex === index) return;
    this.finishSvgPaintEdit();
    this.svgPaintEditIndex = index;
    this.options.beginSvgPaintEdit();
  }

  private finishSvgPaintEdit(): void {
    if (this.svgPaintEditIndex === null) return;
    this.svgPaintEditIndex = null;
    this.options.commitSvgPaintEdit();
  }

  private rebuildSvgPalette(snapshot: MobileSvgStyleSnapshot): void {
    this.finishSvgPaintEdit();
    this.svgStylePalette.replaceChildren(...snapshot.paintColors.map((color, index) => {
      const label = document.createElement("label");
      label.className = "mobile-raster-effect-color";
      const title = document.createElement("span");
      title.textContent = snapshot.paintColors.length === 1
        ? "Color"
        : `Color ${index + 1}`;
      const disc = document.createElement("span");
      disc.className = "mobile-raster-effect-color-disc";
      const input = document.createElement("input");
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
        label.style.setProperty("--mobile-raster-effect-color", input.value);
        this.options.setSelectedSvgPaintColor(index, input.value);
        this.finishSvgPaintEdit();
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
      if (document.activeElement !== input) input.value = value;
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
    const sourceValue = sourceControl<HTMLInputElement>("vectorTextValue");
    const sourceFont = sourceControl<HTMLSelectElement>("vectorTextFontFamily");
    const sourceSize = sourceControl<HTMLInputElement>("vectorTextFontSize");
    const sourceColor = sourceControl<HTMLInputElement>("vectorTextColor");
    const sourceAdd = sourceControl<HTMLButtonElement>("addVectorText");
    this.textValue.value = sourceValue.value;
    this.textValue.disabled = sourceValue.disabled;
    this.textFontFamily.value = sourceFont.value;
    this.textFontFamily.disabled = sourceFont.disabled;
    this.textFontSize.value = sourceSize.value;
    this.textFontSize.disabled = sourceSize.disabled;
    this.textFontSizeOut.value = `${Math.round(Number(sourceSize.value))} px`;
    const hasSelectedText = this.options.hasSelectedText();
    const textColor = hasSelectedText
      ? sourceColor.value
      : this.pendingTextColor ?? this.options.getTextCreationColor();
    this.textColor.value = colorInputValue(textColor);
    this.textColorControl.style.setProperty("--mobile-raster-effect-color", this.textColor.value);
    this.textColor.disabled = hasSelectedText ? sourceColor.disabled : sourceAdd.disabled;
    this.textAdd.disabled = sourceAdd.disabled;
    this.textReset.disabled = !hasSelectedText
      || sourceControl<HTMLButtonElement>("vectorTextReset").disabled;
    this.textDelete.disabled = !hasSelectedText
      || sourceControl<HTMLButtonElement>("deleteVectorText").disabled;
    this.textRasterize.disabled = !hasSelectedText
      || sourceControl<HTMLButtonElement>("vectorTextRasterize").disabled;
  }

  private syncMirroredRange(
    mobile: HTMLInputElement,
    output: HTMLOutputElement,
    sourceId: string,
    format: (value: number) => string,
  ): void {
    const source = sourceControl<HTMLInputElement>(sourceId);
    mobile.value = source.value;
    mobile.disabled = source.disabled;
    output.value = format(Number(source.value));
  }

  private syncMirroredColor(
    mobile: HTMLInputElement,
    control: HTMLElement,
    sourceId: string,
  ): void {
    const source = sourceControl<HTMLInputElement>(sourceId);
    mobile.value = source.value;
    mobile.disabled = source.disabled;
    control.style.setProperty("--mobile-raster-effect-color", source.value);
  }

  private syncTextWarp(): void {
    let activeSourceId = "vectorTextTransformNone";
    for (const { mobile, sourceId } of this.textWarpButtonControls) {
      const source = sourceControl<HTMLButtonElement>(sourceId);
      const pressed = source.getAttribute("aria-pressed") === "true";
      mobile.setAttribute("aria-pressed", String(pressed));
      mobile.disabled = source.disabled;
      if (pressed) activeSourceId = sourceId;
    }
    this.textWarpDistortControls.hidden = activeSourceId !== "vectorTextTransformDistort";
    this.textWarpCurveControls.hidden = activeSourceId !== "vectorTextTransformArch"
      && activeSourceId !== "vectorTextTransformWave";
    this.textWarpCircleControls.hidden = activeSourceId !== "vectorTextTransformCircle";
    const sourceDistortReset = sourceControl<HTMLButtonElement>("vectorTextDistortReset");
    const sourceDistortEdit = sourceControl<HTMLButtonElement>("vectorTextDistortEdit");
    this.textDistortReset.disabled = sourceDistortReset.disabled;
    this.textDistortEdit.disabled = sourceDistortEdit.disabled;
    const editing = sourceDistortEdit.getAttribute("aria-pressed") === "true";
    this.textDistortEdit.setAttribute("aria-pressed", String(editing));
    this.textDistortEdit.textContent = editing ? "Done" : "Edit";
    this.textDistortCommitActions.hidden = !this.syncTransformActions(
      this.textDistortCancel,
      this.textDistortApply,
    );
    this.syncMirroredRange(
      this.textWarpCurve,
      this.textWarpCurveOut,
      "vectorTextTransformCurve",
      (value) => `${Math.round(value)}%`,
    );
    this.syncMirroredRange(
      this.textCircleRadius,
      this.textCircleRadiusOut,
      "vectorTextCircleRadius",
      (value) => `${Math.round(value)}%`,
    );
    const sourceInverted = sourceControl<HTMLInputElement>("vectorTextCircleInverted");
    this.textCircleInverted.checked = sourceInverted.checked;
    this.textCircleInverted.disabled = sourceInverted.disabled;
  }

  private syncTextOutline(): void {
    this.syncMirroredRange(
      this.textOutlineWidth,
      this.textOutlineWidthOut,
      "vectorTextOutlineWidth",
      (value) => `${Math.round(value)} px`,
    );
    this.syncMirroredColor(
      this.textOutlineColor,
      this.textOutlineColorControl,
      "vectorTextOutlineColor",
    );
    const sourceJoin = sourceControl<HTMLSelectElement>("vectorTextOutlineJoin");
    this.textOutlineJoin.value = sourceJoin.value;
    this.textOutlineJoin.disabled = sourceJoin.disabled;
  }

  private syncTextShadow(
    enabled: HTMLInputElement,
    parameters: HTMLElement,
    colorControl: HTMLElement,
    color: HTMLInputElement,
    sourceEnabledId: string,
    sourceColorId: string,
    ranges: readonly {
      mobile: HTMLInputElement;
      output: HTMLOutputElement;
      sourceId: string;
      format: (value: number) => string;
    }[],
  ): void {
    const sourceEnabled = sourceControl<HTMLInputElement>(sourceEnabledId);
    enabled.checked = sourceEnabled.checked;
    enabled.disabled = sourceEnabled.disabled;
    parameters.hidden = !sourceEnabled.checked;
    this.syncMirroredColor(color, colorControl, sourceColorId);
    for (const range of ranges) {
      this.syncMirroredRange(
        range.mobile,
        range.output,
        range.sourceId,
        range.format,
      );
    }
  }

  private syncTextDropShadow(): void {
    this.syncTextShadow(
      this.textDropShadowEnabled,
      this.textDropShadowParameters,
      this.textDropShadowColorControl,
      this.textDropShadowColor,
      "vectorTextSingleShadowEnabled",
      "vectorTextSingleShadowColor",
      [
        {
          mobile: this.textDropShadowOpacity,
          output: this.textDropShadowOpacityOut,
          sourceId: "vectorTextSingleShadowOpacity",
          format: (value) => `${Math.round(value)}%`,
        },
        {
          mobile: this.textDropShadowOffset,
          output: this.textDropShadowOffsetOut,
          sourceId: "vectorTextSingleShadowOffset",
          format: (value) => String(Math.round(value)),
        },
        {
          mobile: this.textDropShadowAngle,
          output: this.textDropShadowAngleOut,
          sourceId: "vectorTextSingleShadowAngle",
          format: (value) => `${Math.round(value)}°`,
        },
        {
          mobile: this.textDropShadowBlur,
          output: this.textDropShadowBlurOut,
          sourceId: "vectorTextSingleShadowBlur",
          format: (value) => String(Math.round(value)),
        },
      ],
    );
  }

  private syncTextInnerShadow(): void {
    this.syncTextShadow(
      this.textInnerShadowEnabled,
      this.textInnerShadowParameters,
      this.textInnerShadowColorControl,
      this.textInnerShadowColor,
      "vectorTextInnerShadowEnabled",
      "vectorTextInnerShadowColor",
      [
        {
          mobile: this.textInnerShadowOpacity,
          output: this.textInnerShadowOpacityOut,
          sourceId: "vectorTextInnerShadowOpacity",
          format: (value) => `${Math.round(value)}%`,
        },
        {
          mobile: this.textInnerShadowOffset,
          output: this.textInnerShadowOffsetOut,
          sourceId: "vectorTextInnerShadowOffset",
          format: (value) => String(Math.round(value)),
        },
        {
          mobile: this.textInnerShadowAngle,
          output: this.textInnerShadowAngleOut,
          sourceId: "vectorTextInnerShadowAngle",
          format: (value) => `${Math.round(value)}°`,
        },
        {
          mobile: this.textInnerShadowBlur,
          output: this.textInnerShadowBlurOut,
          sourceId: "vectorTextInnerShadowBlur",
          format: (value) => String(Math.round(value)),
        },
      ],
    );
  }

  private syncTextBlockShadow(): void {
    this.syncTextShadow(
      this.textBlockShadowEnabled,
      this.textBlockShadowParameters,
      this.textBlockShadowColorControl,
      this.textBlockShadowColor,
      "vectorTextBlockShadowEnabled",
      "vectorTextBlockShadowColor",
      [
        {
          mobile: this.textBlockShadowOpacity,
          output: this.textBlockShadowOpacityOut,
          sourceId: "vectorTextBlockShadowOpacity",
          format: (value) => `${Math.round(value)}%`,
        },
        {
          mobile: this.textBlockShadowOffset,
          output: this.textBlockShadowOffsetOut,
          sourceId: "vectorTextBlockShadowOffset",
          format: (value) => String(Math.round(value)),
        },
        {
          mobile: this.textBlockShadowAngle,
          output: this.textBlockShadowAngleOut,
          sourceId: "vectorTextBlockShadowAngle",
          format: (value) => `${Math.round(value)}°`,
        },
        {
          mobile: this.textBlockShadowOutlineWidth,
          output: this.textBlockShadowOutlineWidthOut,
          sourceId: "vectorTextBlockShadowOutlineWidth",
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
      Math.round(this.closedOffset() - mobileToolSettingsPeekHeight(window.innerHeight)),
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
    const activeElement = document.activeElement;
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
    this.dragLastTime = performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.sheet.classList.add("is-dragging");
    this.handle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const now = performance.now();
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
    const velocityAge = performance.now() - this.dragLastTime;
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
