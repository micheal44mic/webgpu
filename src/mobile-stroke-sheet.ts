import type { RasterStrokeStyle } from "./stroke-core";
import {
  mobileBottomSheetPeekHeight,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetDragDecisionOptions,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";
import { MobileBottomSheetController } from "./mobile-bottom-sheet-controller.ts";

type StrokePosition = RasterStrokeStyle["position"];
export type MobileStrokeSnap = MobileBottomSheetSnap;
export type MobileStrokeDragDecisionOptions = MobileBottomSheetDragDecisionOptions;

export interface MobileStrokeSheetOptions {
  readonly root: ParentNode;
  readonly browser: Window;
  readonly document: Document;
  readonly getStyle: () => RasterStrokeStyle;
  readonly applyStyle: (style: RasterStrokeStyle) => Promise<boolean>;
  readonly beginHistoryEdit: () => number | null;
  readonly commitHistoryEdit: (token: number) => boolean;
  readonly cancelHistoryEdit: (token: number) => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function mobileStrokePeekHeight(viewportHeight: number): number {
  return mobileBottomSheetPeekHeight(viewportHeight);
}

export function resolveMobileStrokeDrag(
  options: MobileStrokeDragDecisionOptions,
): "closed" | MobileStrokeSnap {
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

function copiedStyle(style: RasterStrokeStyle): RasterStrokeStyle {
  return {
    enabled: style.enabled,
    width: style.width,
    position: style.position,
    color: [style.color[0], style.color[1], style.color[2], style.color[3]],
  };
}

function colorToHex(color: RasterStrokeStyle["color"]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

function colorFromHex(value: string): RasterStrokeStyle["color"] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const packed = Number.parseInt(match[1], 16);
  return [
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
    1,
  ];
}

function isStrokePosition(value: string | undefined): value is StrokePosition {
  return value === "outside" || value === "inside" || value === "center";
}

function positionLabel(position: StrokePosition): string {
  if (position === "inside") return "Inside";
  if (position === "center") return "Centered";
  return "Outside";
}

/**
 * Mobile-only controller for the raster Stroke effect. It only mirrors and
 * mutates BrushEngine's authoritative RasterStrokeStyle; it never owns a
 * renderer, texture or second effect state.
 */
export class MobileStrokeSheetController {
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly header: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly colorControl: HTMLLabelElement;
  readonly colorInput: HTMLInputElement;
  readonly alignmentButton: HTMLButtonElement;
  readonly alignmentMenu: HTMLElement;
  readonly alignmentValue: HTMLElement;
  readonly widthInput: HTMLInputElement;
  readonly widthOutput: HTMLOutputElement;
  readonly alignmentOptions: HTMLButtonElement[];

  private readonly sheetState: MobileBottomSheetController;
  private alignmentOpen = false;
  private applyFrame: number | null = null;
  private pendingStyle: RasterStrokeStyle | null = null;
  private applyLoop: Promise<void> | null = null;
  private historyEditToken: number | null = null;
  private historyFinishRequested = false;
  private readonly options: MobileStrokeSheetOptions;

  constructor(options: MobileStrokeSheetOptions) {
    this.options = options;
    this.sheet = requiredElement<HTMLElement>(options.root, "mobileStrokeSheet");
    this.handle = requiredElement<HTMLButtonElement>(options.root, "mobileStrokeHandle");
    this.header = requiredElement<HTMLElement>(options.root, "mobileStrokeHeader");
    this.controlsRegion = requiredElement<HTMLElement>(options.root, "mobileStrokeControlsRegion");
    this.colorControl = requiredElement<HTMLLabelElement>(options.root, "mobileStrokeColor");
    this.colorInput = requiredElement<HTMLInputElement>(options.root, "mobileStrokeColorInput");
    this.alignmentButton = requiredElement<HTMLButtonElement>(options.root, "mobileStrokeAlignmentButton");
    this.alignmentMenu = requiredElement<HTMLElement>(options.root, "mobileStrokeAlignmentMenu");
    this.alignmentValue = requiredElement<HTMLElement>(options.root, "mobileStrokeAlignmentValue");
    this.widthInput = requiredElement<HTMLInputElement>(options.root, "mobileStrokeWidthInput");
    this.widthOutput = requiredElement<HTMLOutputElement>(options.root, "mobileStrokeWidthOut");
    this.alignmentOptions = Array.from(
      this.alignmentMenu.querySelectorAll<HTMLButtonElement>("[data-stroke-alignment]"),
    );
    this.sheetState = new MobileBottomSheetController({
      browser: options.browser,
      document: options.document,
      sheet: this.sheet,
      handle: this.handle,
      header: this.header,
      accessibilityRegions: [this.controlsRegion],
      peekHeight: mobileStrokePeekHeight,
      label: () => "Stroke",
      onCloseRequest: () => this.close(false),
      beforeMinimizedFocus: () => this.closeAlignmentMenu(false),
    });
    this.bindEvents();
    options.document.addEventListener("visibilitychange", () => {
      if (options.document.visibilityState !== "visible") this.requestHistoryEditFinish();
    });
    options.browser.addEventListener("pagehide", () => this.requestHistoryEditFinish());
    options.browser.addEventListener("blur", () => this.requestHistoryEditFinish());
  }

  get isOpen(): boolean {
    return this.sheetState.isOpen;
  }

  open(opener: HTMLElement | null = null): void {
    if (this.isOpen) return;
    this.options.beforeOpen();
    this.sync(this.options.getStyle());
    this.sheetState.open(opener);
    this.options.onOpenChange(true);

    const current = this.options.getStyle();
    if (!current.enabled) {
      if (this.beginHistoryEdit()) {
        this.requestStyle({ ...copiedStyle(current), enabled: true }, false);
        this.requestHistoryEditFinish();
      } else {
        this.sync(current);
      }
    }
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    this.requestHistoryEditFinish();
    this.closeAlignmentMenu(false);
    this.sheetState.close(restoreFocus);
    this.options.onOpenChange(false);
  }

  sync(style = this.options.getStyle()): void {
    const color = colorToHex(style.color);
    this.colorInput.value = color;
    this.colorControl.style.setProperty("--mobile-stroke-color", color);
    this.colorInput.setAttribute("aria-label", `Stroke color ${color}`);
    this.syncWidth(style.width);
    this.syncPosition(style.position);
  }

  handleResize(): void {
    this.sheetState.handleResize();
  }

  private bindEvents(): void {
    for (const control of [this.colorInput, this.widthInput]) {
      control.addEventListener("pointerdown", () => this.beginHistoryEdit());
      control.addEventListener("focus", () => this.beginHistoryEdit());
      control.addEventListener("blur", () => this.requestHistoryEditFinish());
      control.addEventListener("pointercancel", () => this.requestHistoryEditFinish());
    }
    this.colorInput.addEventListener("input", () => {
      if (!this.beginHistoryEdit()) {
        this.sync();
        return;
      }
      this.handleColorInput();
    });
    this.colorInput.addEventListener("change", () => {
      if (!this.beginHistoryEdit()) {
        this.sync();
        return;
      }
      this.handleColorInput();
      this.requestHistoryEditFinish();
    });
    this.widthInput.addEventListener("input", () => {
      if (!this.beginHistoryEdit()) {
        this.sync();
        return;
      }
      this.handleWidthInput();
    });
    this.widthInput.addEventListener("change", () => {
      if (!this.beginHistoryEdit()) {
        this.sync();
        return;
      }
      this.handleWidthInput();
      this.requestHistoryEditFinish();
    });

    this.alignmentButton.addEventListener("click", () => {
      this.setAlignmentMenuOpen(!this.alignmentOpen);
    });
    this.alignmentButton.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.setAlignmentMenuOpen(true);
    });
    for (const option of this.alignmentOptions) {
      option.addEventListener("click", () => {
        const position = option.dataset.strokeAlignment;
        if (!isStrokePosition(position)) return;
        if (!this.beginHistoryEdit()) {
          this.sync();
          return;
        }
        const current = this.pendingStyle ?? this.options.getStyle();
        this.syncPosition(position);
        this.closeAlignmentMenu(false);
        this.alignmentButton.focus({ preventScroll: true });
        this.requestStyle({ ...copiedStyle(current), position }, false);
        this.requestHistoryEditFinish();
      });
      option.addEventListener("keydown", (event) => {
        const currentIndex = this.alignmentOptions.indexOf(option);
        let nextIndex: number | null = null;
        if (event.key === "ArrowDown") {
          nextIndex = (currentIndex + 1) % this.alignmentOptions.length;
        } else if (event.key === "ArrowUp") {
          nextIndex = (
            currentIndex - 1 + this.alignmentOptions.length
          ) % this.alignmentOptions.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = this.alignmentOptions.length - 1;
        }
        if (nextIndex === null) return;
        event.preventDefault();
        this.alignmentOptions[nextIndex]?.focus({ preventScroll: true });
      });
    }

    this.options.document.addEventListener("pointerdown", (event) => {
      if (!this.alignmentOpen || !(event.target instanceof Node)) return;
      if (
        this.alignmentButton.contains(event.target)
        || this.alignmentMenu.contains(event.target)
      ) {
        return;
      }
      this.closeAlignmentMenu(false);
    }, true);

    this.options.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.isOpen) return;
      event.preventDefault();
      if (this.alignmentOpen) {
        this.closeAlignmentMenu(true);
      } else {
        this.close(true);
      }
    });
  }

  private handleColorInput(): void {
    const color = colorFromHex(this.colorInput.value);
    if (!color) return;
    const current = this.pendingStyle ?? this.options.getStyle();
    this.colorControl.style.setProperty("--mobile-stroke-color", this.colorInput.value);
    this.colorInput.setAttribute("aria-label", `Stroke color ${this.colorInput.value}`);
    this.requestStyle({ ...copiedStyle(current), color }, true);
  }

  private handleWidthInput(): void {
    const minimum = Number(this.widthInput.min);
    const maximum = Number(this.widthInput.max);
    const rawWidth = Number(this.widthInput.value);
    if (!Number.isFinite(rawWidth)) return;
    const width = Math.min(maximum, Math.max(minimum, rawWidth));
    const current = this.pendingStyle ?? this.options.getStyle();
    this.syncWidth(width);
    this.requestStyle({ ...copiedStyle(current), width }, true);
  }

  private requestStyle(style: RasterStrokeStyle, coalesceToFrame: boolean): void {
    this.pendingStyle = copiedStyle(style);
    if (!coalesceToFrame) {
      if (this.applyFrame !== null) {
        this.options.browser.cancelAnimationFrame(this.applyFrame);
        this.applyFrame = null;
      }
      this.startApplyLoop();
      return;
    }
    if (this.applyFrame !== null) return;
    this.applyFrame = this.options.browser.requestAnimationFrame(() => {
      this.applyFrame = null;
      this.startApplyLoop();
    });
  }

  private startApplyLoop(): void {
    if (this.applyLoop) return;
    this.applyLoop = (async () => {
      while (this.pendingStyle) {
        const style = this.pendingStyle;
        this.pendingStyle = null;
        const accepted = await this.options.applyStyle(style);
        if (!accepted && !this.pendingStyle) {
          this.sync(this.options.getStyle());
        }
      }
    })().finally(() => {
      this.applyLoop = null;
      if (this.pendingStyle) this.startApplyLoop();
      else this.commitHistoryEditIfIdle();
    });
  }

  private beginHistoryEdit(): boolean {
    if (this.historyEditToken !== null) {
      this.historyFinishRequested = false;
      return true;
    }
    const token = this.options.beginHistoryEdit();
    if (token === null) return false;
    this.historyEditToken = token;
    this.historyFinishRequested = false;
    return true;
  }

  private requestHistoryEditFinish(): void {
    if (this.historyEditToken === null) return;
    this.historyFinishRequested = true;
    if (this.applyFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.applyFrame);
      this.applyFrame = null;
      this.startApplyLoop();
    }
    this.commitHistoryEditIfIdle();
  }

  private commitHistoryEditIfIdle(): void {
    if (
      this.historyEditToken === null
      || !this.historyFinishRequested
      || this.applyLoop
      || this.pendingStyle
    ) return;
    const token = this.historyEditToken;
    this.historyEditToken = null;
    this.historyFinishRequested = false;
    if (!this.options.commitHistoryEdit(token)) {
      this.options.cancelHistoryEdit(token);
    }
  }

  private syncPosition(position: StrokePosition): void {
    this.alignmentButton.dataset.strokeAlignment = position;
    const label = positionLabel(position);
    this.alignmentValue.textContent = label;
    this.alignmentButton.setAttribute("aria-label", `Stroke alignment: ${label}`);
    for (const option of this.alignmentOptions) {
      const selected = option.dataset.strokeAlignment === position;
      option.setAttribute("aria-selected", String(selected));
      option.classList.toggle("is-selected", selected);
    }
  }

  private syncWidth(width: number): void {
    const rounded = Math.round(width);
    this.widthInput.value = String(rounded);
    this.widthOutput.value = `${rounded} px`;
    this.widthInput.setAttribute(
      "aria-valuetext",
      `${rounded} ${rounded === 1 ? "pixel" : "pixels"}`,
    );
  }

  private setAlignmentMenuOpen(open: boolean): void {
    if (!this.isOpen) return;
    this.alignmentOpen = open;
    this.alignmentButton.setAttribute("aria-expanded", String(open));
    this.alignmentMenu.hidden = !open;
    this.alignmentMenu.classList.toggle("is-open", open);
    if (open) {
      const selected = this.alignmentOptions.find(
        (option) => option.getAttribute("aria-selected") === "true",
      );
      selected?.focus({ preventScroll: true });
    }
  }

  private closeAlignmentMenu(restoreFocus: boolean): void {
    if (!this.alignmentOpen) return;
    this.alignmentOpen = false;
    this.alignmentButton.setAttribute("aria-expanded", "false");
    this.alignmentMenu.hidden = true;
    this.alignmentMenu.classList.remove("is-open");
    if (restoreFocus) this.alignmentButton.focus({ preventScroll: true });
  }

}
