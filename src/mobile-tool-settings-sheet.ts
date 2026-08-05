import {
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";

export type MobileToolSettingsKind =
  | "fill"
  | "selection"
  | "transform"
  | "text"
  | "text-warp"
  | "text-outline"
  | "text-drop-shadow"
  | "text-inner-shadow"
  | "text-block-shadow";
type MobileCanvasSettingsTool = "fill" | "selection" | "transform";

export interface MobileToolSettingsSheetOptions {
  readonly mobileMediaQuery: MediaQueryList;
  readonly selectCanvasTool: (tool: MobileCanvasSettingsTool) => boolean;
  readonly getSelectionStatus: () => string;
  readonly hasSelectedText: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

const MOBILE_TOOL_MIN_PEEK_PX = 160;
const MOBILE_TOOL_MAX_PEEK_PX = 240;
const MOBILE_TOOL_PEEK_VIEWPORT_RATIO = 0.26;

const MOBILE_TOOL_TITLES: Readonly<Record<MobileToolSettingsKind, string>> = {
  fill: "Fill",
  selection: "Selection",
  transform: "Transform",
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
    ["mobileTextWarpNone", "vectorTextTransformNone"],
    ["mobileTextWarpDistort", "vectorTextTransformDistort"],
    ["mobileTextWarpArch", "vectorTextTransformArch"],
    ["mobileTextWarpCircle", "vectorTextTransformCircle"],
    ["mobileTextWarpWave", "vectorTextTransformWave"],
  ].map(([mobileId, sourceId]) => ({
    mobile: requiredElement<HTMLButtonElement>(mobileId),
    sourceId,
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

  constructor(options: MobileToolSettingsSheetOptions) {
    this.options = options;
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("inert", "");
    this.bindEvents();
    this.transformStateObserver = new MutationObserver(() => {
      if (this.openState && this.activeKind === "transform") this.syncTransform();
    });
    this.transformStateObserver.observe(sourceControl<HTMLElement>("transformCommitBar"), {
      attributes: true,
      attributeFilter: ["hidden"],
    });
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
    if (this.openState && this.activeKind === kind) return;
    if (this.openState) this.close(false);
    this.options.beforeOpen();

    this.activeKind = kind;
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
    if (this.activeKind === "fill") this.syncFill();
    else if (this.activeKind === "selection") this.syncSelection();
    else if (this.activeKind === "transform") this.syncTransform();
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
        dispatchMirroredValue(this.textColor, "vectorTextColor", eventType);
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

    for (const { mobile, sourceId } of this.textWarpButtons) {
      mobile.addEventListener("click", () => {
        sourceControl<HTMLButtonElement>(sourceId).click();
        requestAnimationFrame(() => this.syncOpenState());
      });
    }
    this.textDistortReset.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("vectorTextDistortReset").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.textDistortEdit.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("vectorTextDistortEdit").click();
      requestAnimationFrame(() => this.syncOpenState());
    });

    for (const [mobile, sourceId] of [
      [this.selectionReplace, "selectionReplace"],
      [this.selectionAdd, "selectionAdd"],
      [this.selectionSubtract, "selectionSubtract"],
    ] as const) {
      mobile.addEventListener("click", () => {
        sourceControl<HTMLButtonElement>(sourceId).click();
        this.syncSelection();
      });
    }
    this.selectionColorApply.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("selectionColorApply").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.selectionClear.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("selectionClear").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.transformCancel.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("transformCancel").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.transformApply.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("transformApply").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.textAdd.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("addVectorText").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    for (const [mobile, sourceId] of [
      [this.textReset, "vectorTextReset"],
      [this.textDelete, "deleteVectorText"],
      [this.textRasterize, "vectorTextRasterize"],
    ] as const) {
      mobile.addEventListener("click", () => {
        sourceControl<HTMLButtonElement>(sourceId).click();
        requestAnimationFrame(() => this.syncOpenState());
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
    const commitBar = sourceControl<HTMLElement>("transformCommitBar");
    const cancel = sourceControl<HTMLButtonElement>("transformCancel");
    const apply = sourceControl<HTMLButtonElement>("transformApply");
    const transactionActive = !commitBar.hidden;
    this.transformCancel.disabled = !transactionActive || cancel.disabled;
    this.transformApply.disabled = !transactionActive || apply.disabled;
    this.transformHint.textContent = transactionActive
      ? "Preview active. Apply or cancel the transform."
      : "Select content on the canvas, then drag it to transform.";
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
    this.textColor.value = sourceColor.value;
    this.textColorControl.style.setProperty("--mobile-raster-effect-color", sourceColor.value);
    this.textColor.disabled = sourceColor.disabled;
    this.textAdd.disabled = sourceAdd.disabled;
    const hasSelectedText = this.options.hasSelectedText();
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
    for (const { mobile, sourceId } of this.textWarpButtons) {
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
