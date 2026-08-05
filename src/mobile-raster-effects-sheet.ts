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

export type MobileRasterEffectKind =
  | "color-overlay"
  | "outer-shadow"
  | "inner-shadow"
  | "bevel";

export type MobileRasterEffectSnap = "peek" | "expanded";

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
  };

interface MobileRasterEffectSpec {
  readonly title: string;
  readonly expandable: boolean;
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

export const MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID = {
  rasterColorOverlayEnabled: "color-overlay",
  rasterOuterShadowEnabled: "outer-shadow",
  rasterInnerShadowEnabled: "inner-shadow",
  rasterBevelEnabled: "bevel",
} as const satisfies Record<string, MobileRasterEffectKind>;

export interface MobileRasterEffectsSheetOptions {
  readonly mobileMediaQuery: MediaQueryList;
  readonly getColorOverlayStyle: () => RasterColorOverlayStyle;
  readonly applyColorOverlayStyle: (style: RasterColorOverlayStyle) => Promise<boolean>;
  readonly getOuterShadowStyle: () => RasterOuterShadowStyle;
  readonly applyOuterShadowStyle: (style: RasterOuterShadowStyle) => Promise<boolean>;
  readonly getInnerShadowStyle: () => RasterInnerShadowStyle;
  readonly applyInnerShadowStyle: (style: RasterInnerShadowStyle) => Promise<boolean>;
  readonly getBevelStyle: () => RasterBevelStyle;
  readonly applyBevelStyle: (style: RasterBevelStyle) => Promise<boolean>;
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
}

const MOBILE_EFFECT_MIN_PEEK_PX = 160;
const MOBILE_EFFECT_MAX_PEEK_PX = 240;
const MOBILE_EFFECT_PEEK_VIEWPORT_RATIO = 0.26;
const MOBILE_EFFECT_CLOSE_DISTANCE_PX = 36;
const MOBILE_EFFECT_CLOSE_FLICK_DISTANCE_PX = 28;
const MOBILE_EFFECT_CLOSE_FLICK_VELOCITY_PX_PER_MS = 0.45;
const MOBILE_EFFECT_EXPAND_DISTANCE_PX = 36;
const MOBILE_EFFECT_EXPAND_FLICK_VELOCITY_PX_PER_MS = -0.45;

export function mobileRasterEffectPeekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_EFFECT_MAX_PEEK_PX,
    Math.max(MOBILE_EFFECT_MIN_PEEK_PX, viewportHeight * MOBILE_EFFECT_PEEK_VIEWPORT_RATIO),
  );
}

export function resolveMobileRasterEffectDrag(
  options: MobileRasterEffectDragDecisionOptions,
): "closed" | MobileRasterEffectSnap {
  const closeFlick = options.deltaY >= MOBILE_EFFECT_CLOSE_FLICK_DISTANCE_PX
    && options.releaseVelocityY >= MOBILE_EFFECT_CLOSE_FLICK_VELOCITY_PX_PER_MS;

  if (options.startSnap === "peek") {
    if (options.deltaY >= MOBILE_EFFECT_CLOSE_DISTANCE_PX || closeFlick) {
      return "closed";
    }
    if (
      MOBILE_RASTER_EFFECT_SPECS[options.effectKind].expandable
      && (
        options.deltaY <= -MOBILE_EFFECT_EXPAND_DISTANCE_PX
        || options.releaseVelocityY <= MOBILE_EFFECT_EXPAND_FLICK_VELOCITY_PX_PER_MS
      )
    ) {
      return "expanded";
    }
    return "peek";
  }

  const fastCloseFromExpanded = options.deltaY >= Math.max(
    96,
    options.peekOffsetPx * 0.32,
  ) && options.releaseVelocityY >= 0.9;
  if (fastCloseFromExpanded) return "closed";
  if (
    options.offsetPx >= options.peekOffsetPx * 0.5
    || options.deltaY >= 72
  ) {
    return "peek";
  }
  return "expanded";
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Elemento #${id} non trovato.`);
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
  readonly sheet = requiredElement<HTMLElement>("mobileRasterEffectSheet");
  readonly handle = requiredElement<HTMLButtonElement>("mobileRasterEffectHandle");
  readonly title = requiredElement<HTMLElement>("mobileRasterEffectTitle");
  readonly enabledInput = requiredElement<HTMLInputElement>("mobileRasterEffectEnabled");
  readonly scroll = requiredElement<HTMLElement>("mobileRasterEffectScroll");
  readonly content = requiredElement<HTMLElement>("mobileRasterEffectContent");

  private openState = false;
  private activeKind: MobileRasterEffectKind | null = null;
  private snap: MobileRasterEffectSnap = "peek";
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragStartSnap: MobileRasterEffectSnap = "peek";
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
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
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private readonly descriptors = new Map<string, MobileRasterEffectControl>();
  private readonly options: MobileRasterEffectsSheetOptions;

  constructor(options: MobileRasterEffectsSheetOptions) {
    this.options = options;
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("inert", "");
    this.bindEvents();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get effectKind(): MobileRasterEffectKind | null {
    return this.activeKind;
  }

  open(kind: MobileRasterEffectKind): void {
    if (!this.options.mobileMediaQuery.matches) return;
    if (this.openState && this.activeKind === kind) return;
    if (this.openState) this.close(false);
    this.flushDraft();
    this.options.beforeOpen();

    this.activeKind = kind;
    this.openState = true;
    this.snap = "peek";
    this.sheet.dataset.effect = kind;
    this.sheet.dataset.state = "open";
    this.sheet.hidden = false;
    this.sheet.setAttribute("aria-hidden", "false");
    this.sheet.removeAttribute("inert");
    this.sheet.setAttribute("aria-label", `${MOBILE_RASTER_EFFECT_SPECS[kind].title} effect`);
    this.title.textContent = MOBILE_RASTER_EFFECT_SPECS[kind].title;
    this.renderControls(kind);

    const current = this.currentDraftOrStyle(kind);
    const openingStyle = current.enabled
      ? current
      : this.withProperty(kind, current, "enabled", true);
    this.sync(openingStyle);
    this.scroll.scrollTop = 0;
    this.snapTo("peek");
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.options.onOpenChange(true);

    if (!current.enabled) this.requestStyle(kind, openingStyle, false);
  }

  close(restoreFocus = false): void {
    if (!this.openState) return;
    this.flushDraft();
    this.openState = false;
    this.releaseDragCapture();
    this.sheet.classList.remove("is-open", "is-dragging");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.setAttribute("inert", "");
    this.handle.setAttribute("aria-expanded", "false");
    this.setOffset(this.closedOffset());
    this.options.onOpenChange(false);
    if (restoreFocus) this.handle.blur();
  }

  syncOpenStyle(): void {
    if (!this.openState || !this.activeKind) return;
    this.sync(this.currentDraftOrStyle(this.activeKind));
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
      if (!this.openState || !this.activeKind) return;
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      if (!MOBILE_RASTER_EFFECT_SPECS[this.activeKind].expandable) {
        this.close(true);
        return;
      }
      this.snapTo(this.snap === "peek" ? "expanded" : "peek");
    });

    this.enabledInput.addEventListener("change", () => {
      if (!this.activeKind) return;
      const current = this.currentDraftOrStyle(this.activeKind);
      const next = this.withProperty(
        this.activeKind,
        current,
        "enabled",
        this.enabledInput.checked,
      );
      this.sync(next);
      this.requestStyle(this.activeKind, next, false);
    });

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
            cancelAnimationFrame(this.applyFrame);
            this.applyFrame = null;
          }
          this.flushDraft();
        } else {
          // Some Safari/WebKit color pickers emit only `change`; ranges may do
          // the same under assistive input. Apply that value immediately when
          // there is no coalesced `input` draft to commit.
          this.handleControl(control, false);
        }
        return;
      }
      this.handleControl(control, false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.close(true);
    });
  }

  private renderControls(kind: MobileRasterEffectKind): void {
    this.controls.clear();
    this.descriptors.clear();
    const fragment = document.createDocumentFragment();
    for (const descriptor of MOBILE_RASTER_EFFECT_SPECS[kind].controls) {
      if (descriptor.type === "group") {
        const heading = document.createElement("h3");
        heading.className = "mobile-raster-effect-group";
        heading.textContent = descriptor.label;
        fragment.append(heading);
        continue;
      }
      const id = controlId(kind, descriptor.key);
      this.descriptors.set(descriptor.key, descriptor);
      if (descriptor.type === "range") {
        const label = document.createElement("label");
        label.className = "mobile-raster-effect-range";
        label.htmlFor = id;
        const name = document.createElement("span");
        name.textContent = descriptor.label;
        const output = document.createElement("output");
        output.htmlFor = id;
        output.dataset.mobileEffectOutput = descriptor.key;
        const input = document.createElement("input");
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
        const label = document.createElement("label");
        label.className = "mobile-raster-effect-select";
        label.htmlFor = id;
        const name = document.createElement("span");
        name.textContent = descriptor.label;
        const select = document.createElement("select");
        select.id = id;
        select.dataset.mobileEffectKey = descriptor.key;
        select.setAttribute("aria-label", descriptor.label);
        for (const [value, optionLabel] of descriptor.options) {
          const option = document.createElement("option");
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
        const label = document.createElement("label");
        label.className = "mobile-raster-effect-color";
        label.htmlFor = id;
        const name = document.createElement("span");
        name.textContent = descriptor.label;
        const disc = document.createElement("span");
        disc.className = "mobile-raster-effect-color-disc";
        const input = document.createElement("input");
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
      const label = document.createElement("label");
      label.className = "mobile-raster-effect-check";
      label.htmlFor = id;
      const input = document.createElement("input");
      input.id = id;
      input.type = "checkbox";
      input.dataset.mobileEffectKey = descriptor.key;
      const name = document.createElement("span");
      name.textContent = descriptor.label;
      label.append(input, name);
      fragment.append(label);
      this.controls.set(descriptor.key, input);
    }
    this.content.replaceChildren(fragment);
  }

  private handleControl(control: HTMLInputElement | HTMLSelectElement, coalesce: boolean): void {
    const kind = this.activeKind;
    const key = control.dataset.mobileEffectKey;
    if (!kind || !key || control.disabled) return;
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
    this.enabledInput.setAttribute("aria-label", `${MOBILE_RASTER_EFFECT_SPECS[kind].title} enabled`);

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
        cancelAnimationFrame(this.applyFrame);
        this.applyFrame = null;
      }
      this.flushDraft();
      return;
    }
    if (this.applyFrame !== null) return;
    this.applyFrame = requestAnimationFrame(() => {
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
          if (!accepted && this.openState && this.activeKind === kind) {
            this.sync(this.readStyle(kind));
          }
        }
      }
    })().finally(() => {
      this.applyLoop = null;
      if (this.pendingOrder.length > 0) this.startApplyLoop();
    });
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

  private peekHeight(): number {
    return mobileRasterEffectPeekHeight(window.innerHeight);
  }

  private peekOffset(): number {
    return Math.max(0, Math.round(this.closedOffset() - this.peekHeight()));
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight));
  }

  private setOffset(offsetPx: number): void {
    const closed = this.closedOffset();
    this.offsetPx = Math.min(closed, Math.max(0, offsetPx));
    this.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
    this.sheet.style.setProperty(
      "--mobile-raster-effect-visible-height",
      `${Math.max(0, Math.round(closed - this.offsetPx))}px`,
    );
  }

  private snapTo(snap: MobileRasterEffectSnap): void {
    if (!this.activeKind) return;
    this.snap = MOBILE_RASTER_EFFECT_SPECS[this.activeKind].expandable ? snap : "peek";
    this.sheet.dataset.snap = this.snap;
    const expanded = this.snap === "expanded";
    this.handle.setAttribute("aria-expanded", String(expanded));
    this.handle.setAttribute(
      "aria-label",
      MOBILE_RASTER_EFFECT_SPECS[this.activeKind].expandable
        ? `${expanded ? "Collapse" : "Expand"} ${MOBILE_RASTER_EFFECT_SPECS[this.activeKind].title} settings`
        : `Close ${MOBILE_RASTER_EFFECT_SPECS[this.activeKind].title} settings`,
    );
    this.setOffset(expanded ? 0 : this.peekOffset());
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
    if (event.pointerId !== this.dragPointerId || !this.activeKind) return;
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
    const expandable = MOBILE_RASTER_EFFECT_SPECS[this.activeKind].expandable;
    this.setOffset(
      this.dragStartOffsetPx + (expandable ? deltaY : Math.max(0, deltaY)),
    );
  }

  private finishDrag(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.dragPointerId || !this.activeKind) return;
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
    const decision = resolveMobileRasterEffectDrag({
      effectKind: this.activeKind,
      startSnap: this.dragStartSnap,
      deltaY,
      releaseVelocityY,
      offsetPx: this.offsetPx,
      peekOffsetPx: this.peekOffset(),
    });
    if (this.dragMoved && decision === "closed") {
      this.close(false);
      this.dragMoved = false;
      return;
    }
    if (this.dragMoved) this.snapTo(decision === "expanded" ? "expanded" : "peek");
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
