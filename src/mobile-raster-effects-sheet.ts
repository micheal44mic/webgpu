import type { RasterBevelStyle } from "./bevel-core.ts";
import {
  rasterColorOverlayColorFromHex,
  rasterColorOverlayColorToHex,
  type RasterColorOverlayStyle,
} from "./raster-color-overlay-core.ts";
import type {
  RasterInnerShadowStyle,
  RasterOuterShadowStyle,
} from "./shadow-core.ts";
import {
  mobileBottomSheetPeekHeight,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";
import { MobileBottomSheetController } from "./mobile-bottom-sheet-controller.ts";
import type { NonDestructiveRasterEffectKind } from "./raster-effects-contract.ts";

export type MobileRasterEffectKind = Exclude<NonDestructiveRasterEffectKind, "stroke">;

export type MobileRasterEffectSnap = MobileBottomSheetSnap;

type MobileRasterEffectStyle =
  | RasterColorOverlayStyle
  | RasterOuterShadowStyle
  | RasterInnerShadowStyle
  | RasterBevelStyle;

type MobileRasterEffectControl =
  | {
    readonly type: "group";
    readonly label: string;
  }
  | {
    readonly type: "range";
    readonly key: string;
    readonly label: string;
    readonly minimum: number;
    readonly maximum: number;
    readonly step: number;
    readonly unit: "%" | "px" | "°";
    readonly decimals?: number;
  }
  | {
    readonly type: "select";
    readonly key: string;
    readonly label: string;
    readonly options: readonly (readonly [value: string, label: string])[];
  }
  | {
    readonly type: "color";
    readonly key: string;
    readonly label: string;
  }
  | {
    readonly type: "check";
    readonly key: string;
    readonly label: string;
    readonly description?: string;
  };

interface MobileRasterEffectSpec {
  readonly title: string;
  readonly expandable: boolean;
  readonly enabledLabel?: string;
  readonly controls: readonly MobileRasterEffectControl[];
}

interface VersionedMobileRasterEffectStyle {
  readonly version: number;
  readonly style: MobileRasterEffectStyle;
}

const SHADOW_BLEND_OPTIONS = [
  ["multiply", "Multiply"],
  ["normal", "Normal"],
] as const;

const CONTOUR_OPTIONS = [
  ["linear", "Linear"],
  ["cone", "Cone"],
  ["gaussian", "Gaussian"],
  ["ring", "Ring"],
] as const;

export const MOBILE_RASTER_EFFECT_SPECS = {
  "color-overlay": {
    title: "Color Overlay",
    expandable: true,
    controls: [
      { type: "color", key: "color", label: "Color" },
      {
        type: "range",
        key: "opacity",
        label: "Opacity",
        minimum: 0,
        maximum: 100,
        step: 1,
        unit: "%",
      },
      {
        type: "check",
        key: "uniformAlpha",
        label: "Use uniform alpha for all non-transparent pixels",
        description:
          "Every pixel with alpha above 0 uses the alpha set by Opacity. "
          + "Fully transparent pixels stay transparent.",
      },
    ],
  },
  "outer-shadow": {
    title: "Outer Shadow",
    expandable: true,
    controls: [
      { type: "select", key: "blendMode", label: "Blend Mode", options: SHADOW_BLEND_OPTIONS },
      { type: "color", key: "color", label: "Color" },
      {
        type: "range", key: "opacity", label: "Opacity",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      {
        type: "range", key: "angle", label: "Angle",
        minimum: 0, maximum: 359, step: 1, unit: "°",
      },
      {
        type: "range", key: "distance", label: "Distance",
        minimum: 0, maximum: 1024, step: 1, unit: "px",
      },
      {
        type: "range", key: "spread", label: "Spread",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      {
        type: "range", key: "size", label: "Size",
        minimum: 0, maximum: 250, step: 1, unit: "px",
      },
      { type: "select", key: "contour", label: "Contour", options: CONTOUR_OPTIONS },
      { type: "check", key: "contourAA", label: "Contour Anti-alias" },
      {
        type: "range", key: "noise", label: "Noise",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      { type: "check", key: "layerKnocksOut", label: "Layer Knocks Out Shadow" },
    ],
  },
  "inner-shadow": {
    title: "Inner Shadow",
    expandable: true,
    controls: [
      { type: "select", key: "blendMode", label: "Blend Mode", options: SHADOW_BLEND_OPTIONS },
      { type: "color", key: "color", label: "Color" },
      {
        type: "range", key: "opacity", label: "Opacity",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      {
        type: "range", key: "angle", label: "Angle",
        minimum: 0, maximum: 359, step: 1, unit: "°",
      },
      {
        type: "range", key: "distance", label: "Distance",
        minimum: 0, maximum: 1024, step: 1, unit: "px",
      },
      {
        type: "range", key: "choke", label: "Choke",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      {
        type: "range", key: "size", label: "Size",
        minimum: 0, maximum: 250, step: 1, unit: "px",
      },
      { type: "select", key: "contour", label: "Contour", options: CONTOUR_OPTIONS },
      { type: "check", key: "contourAA", label: "Contour Anti-alias" },
      {
        type: "range", key: "noise", label: "Noise",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
    ],
  },
  bevel: {
    title: "Bevel",
    expandable: true,
    controls: [
      { type: "group", label: "Structure" },
      {
        type: "select",
        key: "mode",
        label: "Mode",
        options: [
          ["inner", "Inner"],
          ["outer", "Outer"],
          ["emboss", "Emboss"],
          ["pillow", "Pillow"],
        ],
      },
      {
        type: "select",
        key: "technique",
        label: "Technique",
        options: [
          ["smooth", "Smooth"],
          ["chiselHard", "Chisel Hard"],
          ["chiselSoft", "Chisel Soft"],
        ],
      },
      {
        type: "select",
        key: "direction",
        label: "Direction",
        options: [["up", "Up"], ["down", "Down"]],
      },
      {
        type: "range", key: "size", label: "Size",
        minimum: 0.5, maximum: 250, step: 0.5, unit: "px", decimals: 1,
      },
      {
        type: "range", key: "soften", label: "Soften",
        minimum: 0, maximum: 64, step: 0.5, unit: "px", decimals: 1,
      },
      {
        type: "range", key: "depth", label: "Depth",
        minimum: 1, maximum: 1000, step: 1, unit: "%",
      },
      { type: "group", label: "Light" },
      {
        type: "range", key: "angle", label: "Light Angle",
        minimum: 0, maximum: 359, step: 1, unit: "°",
      },
      {
        type: "range", key: "altitude", label: "Light Altitude",
        minimum: 0, maximum: 90, step: 1, unit: "°",
      },
      {
        type: "select",
        key: "gloss",
        label: "Gloss",
        options: [
          ["linear", "Linear"],
          ["soft", "Soft"],
          ["gaussian", "Gaussian"],
          ["cone", "Cone"],
          ["ring", "Ring"],
        ],
      },
      { type: "check", key: "contourAA", label: "Gloss Anti-alias" },
      { type: "group", label: "Bevel Contour" },
      { type: "check", key: "bevelContourEnabled", label: "Enable Bevel Contour" },
      { type: "select", key: "bevelContour", label: "Contour", options: CONTOUR_OPTIONS },
      {
        type: "range", key: "bevelRange", label: "Contour Range",
        minimum: 1, maximum: 100, step: 1, unit: "%",
      },
      {
        type: "range", key: "fill", label: "Fill",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      { type: "group", label: "Highlight and Shadow" },
      { type: "color", key: "highlightColor", label: "Highlight Color" },
      {
        type: "range", key: "highlightOpacity", label: "Highlight Opacity",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
      { type: "color", key: "shadowColor", label: "Shadow Color" },
      {
        type: "range", key: "shadowOpacity", label: "Shadow Opacity",
        minimum: 0, maximum: 100, step: 1, unit: "%",
      },
    ],
  },
} as const satisfies Record<MobileRasterEffectKind, MobileRasterEffectSpec>;

export interface MobileRasterEffectsSheetOptions {
  readonly root: ParentNode;
  readonly browser: Window;
  readonly document: Document;
  readonly getColorOverlayStyle: () => RasterColorOverlayStyle;
  readonly applyColorOverlayStyle: (style: RasterColorOverlayStyle) => Promise<boolean>;
  readonly getOuterShadowStyle: () => RasterOuterShadowStyle;
  readonly applyOuterShadowStyle: (style: RasterOuterShadowStyle) => Promise<boolean>;
  readonly getInnerShadowStyle: () => RasterInnerShadowStyle;
  readonly applyInnerShadowStyle: (style: RasterInnerShadowStyle) => Promise<boolean>;
  readonly getBevelStyle: () => RasterBevelStyle;
  readonly applyBevelStyle: (style: RasterBevelStyle) => Promise<boolean>;
  /**
   * The token makes ownership explicit: a sheet may only finish the exact
   * layer/property transaction that it successfully opened.
   */
  readonly beginHistoryEdit: (kind: MobileRasterEffectKind) => number | null;
  readonly commitHistoryEdit: (token: number) => boolean;
  readonly cancelHistoryEdit: (token: number) => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

export interface MobileRasterEffectDragDecisionOptions {
  readonly effectKind: MobileRasterEffectKind;
  readonly startSnap: MobileRasterEffectSnap;
  readonly deltaY: number;
  readonly releaseVelocityY: number;
  readonly offsetPx: number;
  readonly peekOffsetPx: number;
  readonly minimizedOffsetPx: number;
}

export function mobileRasterEffectPeekHeight(viewportHeight: number): number {
  return mobileBottomSheetPeekHeight(viewportHeight);
}

export function resolveMobileRasterEffectDrag(
  options: MobileRasterEffectDragDecisionOptions,
): "closed" | MobileRasterEffectSnap {
  return resolveMobileBottomSheetDrag(options);
}

function requiredElement<T extends HTMLElement>(root: ParentNode, id: string): T {
  const rootElement = root as ParentNode & Partial<HTMLElement>;
  const result = rootElement.id === id
    ? rootElement as HTMLElement
    : root.querySelector<HTMLElement>(`#${id}`);
  if (!result) throw new Error(`Element #${id} was not found.`);
  return result as T;
}

function copiedEffectStyle(
  kind: MobileRasterEffectKind,
  style: MobileRasterEffectStyle,
): MobileRasterEffectStyle {
  if (kind === "color-overlay") {
    const value = style as RasterColorOverlayStyle;
    return { ...value, color: [value.color[0], value.color[1], value.color[2]] };
  }
  if (kind === "outer-shadow") {
    const value = style as RasterOuterShadowStyle;
    return { ...value, color: [value.color[0], value.color[1], value.color[2]] };
  }
  if (kind === "inner-shadow") {
    const value = style as RasterInnerShadowStyle;
    return { ...value, color: [value.color[0], value.color[1], value.color[2]] };
  }
  const value = style as RasterBevelStyle;
  return {
    ...value,
    highlightColor: [
      value.highlightColor[0],
      value.highlightColor[1],
      value.highlightColor[2],
    ],
    shadowColor: [value.shadowColor[0], value.shadowColor[1], value.shadowColor[2]],
  };
}

function simpleColorToHex(color: readonly number[]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

function simpleColorFromHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const packed = Number.parseInt(match[1], 16);
  return [
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
  ];
}

function styleRecord(style: MobileRasterEffectStyle): Record<string, unknown> {
  return style as unknown as Record<string, unknown>;
}

function controlId(kind: MobileRasterEffectKind, key: string): string {
  return `mobileRasterEffect-${kind}-${key}`;
}

function controlDescriptionId(
  kind: MobileRasterEffectKind,
  key: string,
): string {
  return `${controlId(kind, key)}-help`;
}

function formatRangeValue(
  value: number,
  control: Extract<MobileRasterEffectControl, { type: "range" }>,
): string {
  const decimals = control.decimals ?? 0;
  const formatted = value.toFixed(decimals).replace(/\.0$/, "");
  return `${formatted}${control.unit === "°" ? "" : " "}${control.unit}`;
}

/**
 * One mobile view over the four existing raster-effect style records. The
 * controller owns no renderer, texture, history or persistent effect state;
 * pending copies only serialize latest-only UI writes to BrushEngine.
 */
export class MobileRasterEffectsSheetController {
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly header: HTMLElement;
  readonly title: HTMLElement;
  readonly enabledControl: HTMLElement;
  readonly enabledInput: HTMLInputElement;
  readonly enabledLabel: HTMLElement;
  readonly scroll: HTMLElement;
  readonly content: HTMLElement;

  private readonly sheetState: MobileBottomSheetController;
  private activeKind: MobileRasterEffectKind | null = null;
  private applyFrame: number | null = null;
  private draft: (
    {
      kind: MobileRasterEffectKind;
      inputKey: string | null;
    } & VersionedMobileRasterEffectStyle
  ) | null = null;
  /**
   * Latest UI value, including an apply which is currently awaiting the
   * authoritative engine. This prevents a second edit from rebuilding its
   * draft from stale engine state while the first async write is in flight.
   */
  private readonly optimisticByKind = new Map<
    MobileRasterEffectKind,
    VersionedMobileRasterEffectStyle
  >();
  private readonly pendingByKind = new Map<
    MobileRasterEffectKind,
    VersionedMobileRasterEffectStyle
  >();
  private readonly pendingOrder: MobileRasterEffectKind[] = [];
  private nextStyleVersion = 1;
  private applyLoop: Promise<void> | null = null;
  private historyEditToken: number | null = null;
  private historyEditKind: MobileRasterEffectKind | null = null;
  private historyFinishRequested = false;
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private readonly descriptors = new Map<string, MobileRasterEffectControl>();
  private readonly options: MobileRasterEffectsSheetOptions;

  constructor(options: MobileRasterEffectsSheetOptions) {
    this.options = options;
    this.sheet = requiredElement<HTMLElement>(options.root, "mobileRasterEffectSheet");
    this.handle = requiredElement<HTMLButtonElement>(options.root, "mobileRasterEffectHandle");
    this.header = requiredElement<HTMLElement>(options.root, "mobileRasterEffectHeader");
    this.title = requiredElement<HTMLElement>(options.root, "mobileRasterEffectTitle");
    this.enabledControl = requiredElement<HTMLElement>(options.root, "mobileRasterEffectEnabledControl");
    this.enabledInput = requiredElement<HTMLInputElement>(options.root, "mobileRasterEffectEnabled");
    this.enabledLabel = requiredElement<HTMLElement>(options.root, "mobileRasterEffectEnabledLabel");
    this.scroll = requiredElement<HTMLElement>(options.root, "mobileRasterEffectScroll");
    this.content = requiredElement<HTMLElement>(options.root, "mobileRasterEffectContent");
    this.sheetState = new MobileBottomSheetController({
      browser: options.browser,
      document: options.document,
      sheet: this.sheet,
      handle: this.handle,
      header: this.header,
      accessibilityRegions: [this.scroll, this.enabledControl],
      peekHeight: mobileRasterEffectPeekHeight,
      label: () => this.activeKind
        ? MOBILE_RASTER_EFFECT_SPECS[this.activeKind].title
        : "Effect",
      onCloseRequest: () => this.close(false),
      visibleHeightCssProperty: "--mobile-raster-effect-visible-height",
    });
    this.bindEvents();
    this.options.document.addEventListener("visibilitychange", () => {
      if (this.options.document.visibilityState !== "visible") this.requestHistoryEditFinish();
    });
    this.options.browser.addEventListener("pagehide", () => this.requestHistoryEditFinish());
    this.options.browser.addEventListener("blur", () => this.requestHistoryEditFinish());
  }

  get isOpen(): boolean {
    return this.sheetState.isOpen;
  }

  get effectKind(): MobileRasterEffectKind | null {
    return this.activeKind;
  }

  open(kind: MobileRasterEffectKind, opener: HTMLElement | null = null): void {
    if (this.isOpen && this.activeKind === kind) return;
    if (this.isOpen) this.close(false);
    this.flushDraft();
    this.options.beforeOpen();

    this.activeKind = kind;
    this.sheet.dataset.effect = kind;
    const spec: MobileRasterEffectSpec = MOBILE_RASTER_EFFECT_SPECS[kind];
    this.sheet.setAttribute("aria-label", `${spec.title} effect`);
    this.title.textContent = spec.title;
    this.enabledLabel.textContent = spec.enabledLabel ?? "Enabled";
    this.enabledInput.removeAttribute("aria-describedby");
    this.renderControls(kind);

    const current = this.currentDraftOrStyle(kind);
    const openingStyle = current.enabled
      ? current
      : this.withProperty(kind, current, "enabled", true);
    this.sync(openingStyle);
    this.scroll.scrollTop = 0;
    this.sheetState.open(opener);
    this.options.onOpenChange(true);

    if (!current.enabled) {
      if (this.beginHistoryEdit()) {
        this.requestStyle(kind, openingStyle, false);
        this.requestHistoryEditFinish();
      } else {
        this.sync(current);
      }
    }
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    this.flushDraft();
    this.requestHistoryEditFinish();
    this.sheetState.close(restoreFocus);
    this.options.onOpenChange(false);
  }

  syncOpenStyle(): void {
    if (!this.isOpen || !this.activeKind) return;
    this.sync(this.currentDraftOrStyle(this.activeKind));
  }

  handleResize(): void {
    this.sheetState.handleResize();
  }

  private bindEvents(): void {
    this.enabledInput.addEventListener("pointerdown", () => this.beginHistoryEdit());
    this.enabledInput.addEventListener("focus", () => this.beginHistoryEdit());
    this.enabledInput.addEventListener("blur", () => this.requestHistoryEditFinish());
    this.enabledInput.addEventListener("change", () => {
      if (!this.activeKind) return;
      if (!this.beginHistoryEdit()) {
        this.sync(this.currentDraftOrStyle(this.activeKind));
        return;
      }
      const current = this.currentDraftOrStyle(this.activeKind);
      const next = this.withProperty(
        this.activeKind,
        current,
        "enabled",
        this.enabledInput.checked,
      );
      this.sync(next);
      this.requestStyle(this.activeKind, next, false);
      this.requestHistoryEditFinish();
    });

    this.content.addEventListener("pointerdown", (event) => {
      const control = event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        this.beginHistoryEdit();
      }
    });
    this.content.addEventListener("focusin", (event) => {
      const control = event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        this.beginHistoryEdit();
      }
    });
    this.content.addEventListener("focusout", () => this.requestHistoryEditFinish());
    this.content.addEventListener("pointercancel", () => this.requestHistoryEditFinish());

    this.content.addEventListener("input", (event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement)) return;
      if (control.type !== "range" && control.type !== "color") return;
      this.handleControl(control, true);
    });
    this.content.addEventListener("change", (event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
      if (control instanceof HTMLInputElement && (control.type === "range" || control.type === "color")) {
        const key = control.dataset.mobileEffectKey;
        const matchingInputDraft = Boolean(
          key
          && this.draft?.kind === this.activeKind
          && this.draft.inputKey === key,
        );
        if (matchingInputDraft) {
          if (this.applyFrame !== null) {
            this.options.browser.cancelAnimationFrame(this.applyFrame);
            this.applyFrame = null;
          }
          this.flushDraft();
        } else {
          // Some Safari/WebKit color pickers emit only `change`; ranges may do
          // the same under assistive input. Apply that value immediately when
          // there is no coalesced `input` draft to commit.
          this.handleControl(control, false);
        }
        this.requestHistoryEditFinish();
        return;
      }
      this.handleControl(control, false);
      this.requestHistoryEditFinish();
    });

    this.options.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.isOpen) return;
      event.preventDefault();
      this.close(true);
    });
  }

  private renderControls(kind: MobileRasterEffectKind): void {
    this.controls.clear();
    this.descriptors.clear();
    const fragment = this.options.document.createDocumentFragment();
    const spec: MobileRasterEffectSpec = MOBILE_RASTER_EFFECT_SPECS[kind];
    for (const descriptor of spec.controls) {
      if (descriptor.type === "group") {
        const heading = this.options.document.createElement("h3");
        heading.className = "mobile-raster-effect-group";
        heading.textContent = descriptor.label;
        fragment.append(heading);
        continue;
      }
      const id = controlId(kind, descriptor.key);
      this.descriptors.set(descriptor.key, descriptor);
      if (descriptor.type === "range") {
        const label = this.options.document.createElement("label");
        label.className = "mobile-raster-effect-range";
        label.htmlFor = id;
        const name = this.options.document.createElement("span");
        name.textContent = descriptor.label;
        const output = this.options.document.createElement("output");
        output.htmlFor = id;
        output.dataset.mobileEffectOutput = descriptor.key;
        const input = this.options.document.createElement("input");
        input.id = id;
        input.type = "range";
        input.min = String(descriptor.minimum);
        input.max = String(descriptor.maximum);
        input.step = String(descriptor.step);
        input.dataset.mobileEffectKey = descriptor.key;
        input.setAttribute("aria-label", descriptor.label);
        label.append(name, output, input);
        fragment.append(label);
        this.controls.set(descriptor.key, input);
        continue;
      }
      if (descriptor.type === "select") {
        const label = this.options.document.createElement("label");
        label.className = "mobile-raster-effect-select";
        label.htmlFor = id;
        const name = this.options.document.createElement("span");
        name.textContent = descriptor.label;
        const select = this.options.document.createElement("select");
        select.id = id;
        select.dataset.mobileEffectKey = descriptor.key;
        select.setAttribute("aria-label", descriptor.label);
        for (const [value, optionLabel] of descriptor.options) {
          const option = this.options.document.createElement("option");
          option.value = value;
          option.textContent = optionLabel;
          select.append(option);
        }
        label.append(name, select);
        fragment.append(label);
        this.controls.set(descriptor.key, select);
        continue;
      }
      if (descriptor.type === "color") {
        const label = this.options.document.createElement("label");
        label.className = "mobile-raster-effect-color";
        label.htmlFor = id;
        const name = this.options.document.createElement("span");
        name.textContent = descriptor.label;
        const disc = this.options.document.createElement("span");
        disc.className = "mobile-raster-effect-color-disc";
        const input = this.options.document.createElement("input");
        input.id = id;
        input.type = "color";
        input.dataset.mobileEffectKey = descriptor.key;
        input.setAttribute("aria-label", descriptor.label);
        disc.append(input);
        label.append(name, disc);
        fragment.append(label);
        this.controls.set(descriptor.key, input);
        continue;
      }
      const label = this.options.document.createElement("label");
      label.className = "mobile-raster-effect-check";
      label.htmlFor = id;
      const input = this.options.document.createElement("input");
      input.id = id;
      input.type = "checkbox";
      input.dataset.mobileEffectKey = descriptor.key;
      input.setAttribute("aria-label", descriptor.label);
      const name = this.options.document.createElement("span");
      name.textContent = descriptor.label;
      label.append(input, name);
      if (descriptor.description) {
        const field = this.options.document.createElement("div");
        field.className = "mobile-raster-effect-check-field";
        const helper = this.options.document.createElement("p");
        helper.id = controlDescriptionId(kind, descriptor.key);
        helper.className = "mobile-raster-effect-check-help";
        helper.textContent = descriptor.description;
        input.setAttribute("aria-describedby", helper.id);
        field.append(label, helper);
        fragment.append(field);
      } else {
        fragment.append(label);
      }
      this.controls.set(descriptor.key, input);
    }
    this.content.replaceChildren(fragment);
  }

  private handleControl(control: HTMLInputElement | HTMLSelectElement, coalesce: boolean): void {
    const kind = this.activeKind;
    const key = control.dataset.mobileEffectKey;
    if (!kind || !key || control.disabled) return;
    if (!this.beginHistoryEdit()) {
      this.sync(this.currentDraftOrStyle(kind));
      return;
    }
    const descriptor = this.descriptors.get(key);
    if (!descriptor || descriptor.type === "group") return;
    let value: unknown;
    if (descriptor.type === "range") {
      value = Number(control.value);
      if (!Number.isFinite(value)) return;
    } else if (descriptor.type === "check") {
      if (!(control instanceof HTMLInputElement)) return;
      value = control.checked;
    } else if (descriptor.type === "color") {
      if (!(control instanceof HTMLInputElement)) return;
      value = kind === "color-overlay"
        ? rasterColorOverlayColorFromHex(control.value)
        : simpleColorFromHex(control.value);
      if (!value) return;
    } else {
      value = control.value;
    }

    const current = this.currentDraftOrStyle(kind);
    let next = this.withProperty(kind, current, key, value);
    if (kind === "outer-shadow" && key === "blendMode" && value === "multiply") {
      next = this.withProperty(kind, next, "color", [0, 0, 0]);
    }
    this.sync(next);
    this.requestStyle(kind, next, coalesce, key);
  }

  private sync(style: MobileRasterEffectStyle): void {
    if (!this.activeKind) return;
    const kind = this.activeKind;
    const record = styleRecord(style);
    this.enabledInput.checked = style.enabled;
    const spec: MobileRasterEffectSpec = MOBILE_RASTER_EFFECT_SPECS[kind];
    this.enabledInput.setAttribute(
      "aria-label",
      spec.enabledLabel ?? `${spec.title} enabled`,
    );

    for (const descriptor of MOBILE_RASTER_EFFECT_SPECS[kind].controls) {
      if (descriptor.type === "group") continue;
      const control = this.controls.get(descriptor.key);
      if (!control) continue;
      const value = record[descriptor.key];
      if (descriptor.type === "range") {
        const numeric = Number(value);
        control.value = String(numeric);
        const formatted = formatRangeValue(numeric, descriptor);
        const output = this.content.querySelector<HTMLOutputElement>(
          `[data-mobile-effect-output="${descriptor.key}"]`,
        );
        if (output) output.value = formatted;
        control.setAttribute("aria-valuetext", formatted);
      } else if (descriptor.type === "select") {
        control.value = String(value);
      } else if (descriptor.type === "check") {
        if (control instanceof HTMLInputElement) control.checked = value === true;
      } else if (control instanceof HTMLInputElement) {
        const color = kind === "color-overlay"
          ? rasterColorOverlayColorToHex(value as RasterColorOverlayStyle["color"])
          : simpleColorToHex(value as readonly number[]);
        control.value = color;
        const disc = control.closest<HTMLElement>(".mobile-raster-effect-color")
          ?.querySelector<HTMLElement>(".mobile-raster-effect-color-disc");
        disc?.style.setProperty("--mobile-raster-effect-color", color);
        control.setAttribute("aria-label", `${descriptor.label} ${color}`);
      }
    }
    this.syncAvailability(style);
  }

  private syncAvailability(style: MobileRasterEffectStyle): void {
    const kind = this.activeKind;
    if (!kind) return;
    const record = styleRecord(style);
    for (const [key, control] of this.controls) {
      const outerMultiplyColor = kind === "outer-shadow"
        && key === "color"
        && record.blendMode === "multiply";
      const inactiveBevelContour = kind === "bevel"
        && (key === "bevelContour" || key === "bevelRange")
        && record.bevelContourEnabled !== true;
      control.disabled = !style.enabled || outerMultiplyColor || inactiveBevelContour;
    }
    this.content.classList.toggle("is-disabled", !style.enabled);
  }

  private readStyle(kind: MobileRasterEffectKind): MobileRasterEffectStyle {
    if (kind === "color-overlay") return copiedEffectStyle(kind, this.options.getColorOverlayStyle());
    if (kind === "outer-shadow") return copiedEffectStyle(kind, this.options.getOuterShadowStyle());
    if (kind === "inner-shadow") return copiedEffectStyle(kind, this.options.getInnerShadowStyle());
    return copiedEffectStyle(kind, this.options.getBevelStyle());
  }

  private currentDraftOrStyle(kind: MobileRasterEffectKind): MobileRasterEffectStyle {
    if (this.draft?.kind === kind) return copiedEffectStyle(kind, this.draft.style);
    const optimistic = this.optimisticByKind.get(kind);
    return optimistic ? copiedEffectStyle(kind, optimistic.style) : this.readStyle(kind);
  }

  private withProperty(
    kind: MobileRasterEffectKind,
    style: MobileRasterEffectStyle,
    key: string,
    value: unknown,
  ): MobileRasterEffectStyle {
    return {
      ...copiedEffectStyle(kind, style),
      [key]: value,
    } as MobileRasterEffectStyle;
  }

  private requestStyle(
    kind: MobileRasterEffectKind,
    style: MobileRasterEffectStyle,
    coalesceToFrame: boolean,
    inputKey: string | null = null,
  ): void {
    const versioned = {
      version: this.nextStyleVersion,
      style: copiedEffectStyle(kind, style),
    };
    this.nextStyleVersion += 1;
    this.draft = {
      kind,
      inputKey: coalesceToFrame ? inputKey : null,
      ...versioned,
    };
    this.optimisticByKind.set(kind, versioned);
    if (!coalesceToFrame) {
      if (this.applyFrame !== null) {
        this.options.browser.cancelAnimationFrame(this.applyFrame);
        this.applyFrame = null;
      }
      this.flushDraft();
      return;
    }
    if (this.applyFrame !== null) return;
    this.applyFrame = this.options.browser.requestAnimationFrame(() => {
      this.applyFrame = null;
      this.flushDraft();
    });
  }

  private flushDraft(): void {
    const draft = this.draft;
    if (!draft) return;
    this.draft = null;
    if (this.pendingByKind.has(draft.kind)) {
      this.pendingByKind.set(draft.kind, {
        version: draft.version,
        style: copiedEffectStyle(draft.kind, draft.style),
      });
    } else {
      this.pendingByKind.set(draft.kind, {
        version: draft.version,
        style: copiedEffectStyle(draft.kind, draft.style),
      });
      this.pendingOrder.push(draft.kind);
    }
    this.startApplyLoop();
  }

  private startApplyLoop(): void {
    if (this.applyLoop) return;
    this.applyLoop = (async () => {
      while (this.pendingOrder.length > 0) {
        const kind = this.pendingOrder.shift();
        if (!kind) continue;
        const pending = this.pendingByKind.get(kind);
        this.pendingByKind.delete(kind);
        if (!pending) continue;
        let accepted = false;
        try {
          accepted = await this.applyStyle(kind, pending.style);
        } catch {
          accepted = false;
        }
        const latest = this.optimisticByKind.get(kind);
        const newerQueued = this.pendingByKind.get(kind);
        if (latest?.version === pending.version && !newerQueued) {
          this.optimisticByKind.delete(kind);
          if (!accepted && this.isOpen && this.activeKind === kind) {
            this.sync(this.readStyle(kind));
          }
        }
      }
    })().finally(() => {
      this.applyLoop = null;
      if (this.pendingOrder.length > 0) this.startApplyLoop();
      else this.commitHistoryEditIfIdle();
    });
  }

  private beginHistoryEdit(): boolean {
    if (!this.activeKind) return false;
    if (this.historyEditToken !== null) {
      if (this.historyEditKind !== this.activeKind) return false;
      this.historyFinishRequested = false;
      return true;
    }
    const token = this.options.beginHistoryEdit(this.activeKind);
    if (token === null) return false;
    this.historyEditToken = token;
    this.historyEditKind = this.activeKind;
    this.historyFinishRequested = false;
    return true;
  }

  private requestHistoryEditFinish(): void {
    if (this.historyEditToken === null) return;
    this.historyFinishRequested = true;
    if (this.applyFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.applyFrame);
      this.applyFrame = null;
      this.flushDraft();
    }
    this.commitHistoryEditIfIdle();
  }

  private commitHistoryEditIfIdle(): void {
    if (
      this.historyEditToken === null
      || !this.historyFinishRequested
      || this.applyLoop
      || this.draft
      || this.pendingOrder.length > 0
      || this.pendingByKind.size > 0
    ) return;
    const token = this.historyEditToken;
    this.historyEditToken = null;
    this.historyEditKind = null;
    this.historyFinishRequested = false;
    if (!this.options.commitHistoryEdit(token)) {
      // A stale token must never finish somebody else's transaction. Cancel is
      // deliberately token-checked by the engine as well, so this is harmless
      // if the transaction was already reset during teardown.
      this.options.cancelHistoryEdit(token);
    }
  }

  private applyStyle(
    kind: MobileRasterEffectKind,
    style: MobileRasterEffectStyle,
  ): Promise<boolean> {
    if (kind === "color-overlay") {
      return this.options.applyColorOverlayStyle(style as RasterColorOverlayStyle);
    }
    if (kind === "outer-shadow") {
      return this.options.applyOuterShadowStyle(style as RasterOuterShadowStyle);
    }
    if (kind === "inner-shadow") {
      return this.options.applyInnerShadowStyle(style as RasterInnerShadowStyle);
    }
    return this.options.applyBevelStyle(style as RasterBevelStyle);
  }

}
