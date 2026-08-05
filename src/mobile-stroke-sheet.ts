import type { RasterStrokeStyle } from "./stroke-core";

type StrokePosition = RasterStrokeStyle["position"];
export type MobileStrokeSnap = "peek" | "expanded";

export interface MobileStrokeDragDecisionOptions {
  readonly startSnap: MobileStrokeSnap;
  readonly deltaY: number;
  readonly releaseVelocityY: number;
  readonly offsetPx: number;
  readonly peekOffsetPx: number;
}

export interface MobileStrokeSheetOptions {
  readonly mobileMediaQuery: MediaQueryList;
  readonly getStyle: () => RasterStrokeStyle;
  readonly applyStyle: (style: RasterStrokeStyle) => Promise<boolean>;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

const MOBILE_STROKE_MIN_PEEK_PX = 160;
const MOBILE_STROKE_MAX_PEEK_PX = 240;
const MOBILE_STROKE_PEEK_VIEWPORT_RATIO = 0.26;
const MOBILE_STROKE_CLOSE_DISTANCE_PX = 36;
const MOBILE_STROKE_CLOSE_FLICK_DISTANCE_PX = 28;
const MOBILE_STROKE_CLOSE_FLICK_VELOCITY_PX_PER_MS = 0.45;
const MOBILE_STROKE_EXPAND_DISTANCE_PX = 36;
const MOBILE_STROKE_EXPAND_FLICK_VELOCITY_PX_PER_MS = -0.45;

export function mobileStrokePeekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_STROKE_MAX_PEEK_PX,
    Math.max(MOBILE_STROKE_MIN_PEEK_PX, viewportHeight * MOBILE_STROKE_PEEK_VIEWPORT_RATIO),
  );
}

export function resolveMobileStrokeDrag(
  options: MobileStrokeDragDecisionOptions,
): "closed" | MobileStrokeSnap {
  const closeFlick = options.deltaY >= MOBILE_STROKE_CLOSE_FLICK_DISTANCE_PX
    && options.releaseVelocityY >= MOBILE_STROKE_CLOSE_FLICK_VELOCITY_PX_PER_MS;

  if (options.startSnap === "peek") {
    if (options.deltaY >= MOBILE_STROKE_CLOSE_DISTANCE_PX || closeFlick) {
      return "closed";
    }
    if (
      options.deltaY <= -MOBILE_STROKE_EXPAND_DISTANCE_PX
      || options.releaseVelocityY <= MOBILE_STROKE_EXPAND_FLICK_VELOCITY_PX_PER_MS
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
  readonly sheet = requiredElement<HTMLElement>("mobileStrokeSheet");
  readonly handle = requiredElement<HTMLButtonElement>("mobileStrokeHandle");
  readonly colorControl = requiredElement<HTMLLabelElement>("mobileStrokeColor");
  readonly colorInput = requiredElement<HTMLInputElement>("mobileStrokeColorInput");
  readonly alignmentButton = requiredElement<HTMLButtonElement>(
    "mobileStrokeAlignmentButton",
  );
  readonly alignmentMenu = requiredElement<HTMLElement>("mobileStrokeAlignmentMenu");
  readonly alignmentValue = requiredElement<HTMLElement>("mobileStrokeAlignmentValue");
  readonly widthInput = requiredElement<HTMLInputElement>("mobileStrokeWidthInput");
  readonly widthOutput = requiredElement<HTMLOutputElement>("mobileStrokeWidthOut");
  readonly alignmentOptions = Array.from(
    this.alignmentMenu.querySelectorAll<HTMLButtonElement>("[data-stroke-alignment]"),
  );

  private openState = false;
  private snap: MobileStrokeSnap = "peek";
  private alignmentOpen = false;
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragStartSnap: MobileStrokeSnap = "peek";
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
  private applyFrame: number | null = null;
  private pendingStyle: RasterStrokeStyle | null = null;
  private applyLoop: Promise<void> | null = null;
  private readonly options: MobileStrokeSheetOptions;

  constructor(options: MobileStrokeSheetOptions) {
    this.options = options;
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("inert", "");
    this.bindEvents();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (this.openState || !this.options.mobileMediaQuery.matches) return;
    this.options.beforeOpen();
    this.openState = true;
    this.sheet.hidden = false;
    this.sheet.dataset.state = "open";
    this.sheet.setAttribute("aria-hidden", "false");
    this.sheet.removeAttribute("inert");
    this.sync(this.options.getStyle());
    this.snap = "peek";
    this.snapTo("peek");
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.options.onOpenChange(true);

    const current = this.options.getStyle();
    if (!current.enabled) {
      this.requestStyle({ ...copiedStyle(current), enabled: true }, false);
    }
  }

  close(restoreFocus = false): void {
    if (!this.openState) return;
    this.openState = false;
    this.closeAlignmentMenu(false);
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

  sync(style = this.options.getStyle()): void {
    const color = colorToHex(style.color);
    this.colorInput.value = color;
    this.colorControl.style.setProperty("--mobile-stroke-color", color);
    this.colorInput.setAttribute("aria-label", `Stroke color ${color}`);
    this.syncWidth(style.width);
    this.syncPosition(style.position);
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
      this.snapTo(this.snap === "peek" ? "expanded" : "peek");
    });

    this.colorInput.addEventListener("input", () => this.handleColorInput());
    this.colorInput.addEventListener("change", () => this.handleColorInput());
    this.widthInput.addEventListener("input", () => this.handleWidthInput());
    this.widthInput.addEventListener("change", () => this.handleWidthInput());

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
        const current = this.pendingStyle ?? this.options.getStyle();
        this.syncPosition(position);
        this.closeAlignmentMenu(false);
        this.alignmentButton.focus({ preventScroll: true });
        this.requestStyle({ ...copiedStyle(current), position }, false);
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

    document.addEventListener("pointerdown", (event) => {
      if (!this.alignmentOpen || !(event.target instanceof Node)) return;
      if (
        this.alignmentButton.contains(event.target)
        || this.alignmentMenu.contains(event.target)
      ) {
        return;
      }
      this.closeAlignmentMenu(false);
    }, true);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
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
        cancelAnimationFrame(this.applyFrame);
        this.applyFrame = null;
      }
      this.startApplyLoop();
      return;
    }
    if (this.applyFrame !== null) return;
    this.applyFrame = requestAnimationFrame(() => {
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
    });
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
    if (!this.openState) return;
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

  private peekHeight(): number {
    return mobileStrokePeekHeight(window.innerHeight);
  }

  private peekOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight - this.peekHeight()));
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight));
  }

  private setOffset(offsetPx: number): void {
    this.offsetPx = Math.min(this.closedOffset(), Math.max(0, offsetPx));
    this.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
  }

  private snapTo(snap: MobileStrokeSnap): void {
    this.snap = snap;
    this.sheet.dataset.snap = snap;
    const expanded = snap === "expanded";
    this.handle.setAttribute("aria-expanded", String(expanded));
    this.handle.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} Stroke settings`,
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
    this.setOffset(this.dragStartOffsetPx + deltaY);
  }

  private finishDrag(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.dragPointerId) return;
    if (this.handle.hasPointerCapture(event.pointerId)) {
      this.handle.releasePointerCapture(event.pointerId);
    }
    this.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const velocityAge = performance.now() - this.dragLastTime;
    const releaseVelocity = velocityAge <= 100 ? this.dragVelocityY : 0;
    this.dragPointerId = null;
    if (cancelled) {
      this.snapTo(this.dragStartSnap);
      this.dragMoved = false;
      return;
    }
    const decision = resolveMobileStrokeDrag({
      startSnap: this.dragStartSnap,
      deltaY,
      releaseVelocityY: releaseVelocity,
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
