import type { BrushEngine } from "./brush-engine";
import type { CanvasInputTool } from "./canvas-input-controller";
import {
  BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS,
  brushOutlineBoundingExtentCssPixels,
  brushOutlineRotationRadians,
  type BrushMaskOutline,
  type BrushOutlineSnapshot,
} from "./brush-outline-core";

export type BrushOutlineEnginePort = Pick<BrushEngine, "getBrushOutlineSnapshot">;

export interface BrushOutlineBrowser extends Window {
  readonly AbortController: typeof AbortController;
  readonly Path2D: typeof Path2D;
  readonly ResizeObserver: typeof ResizeObserver;
}

export interface BrushOutlineControllerOptions {
  readonly engine: BrushOutlineEnginePort;
  readonly browser: BrushOutlineBrowser;
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly getActiveTool: () => CanvasInputTool;
}

interface PointerPosition {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: string;
}

interface DirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const OUTLINE_PHYSICAL_PIXELS = 1;
const OUTLINE_CLEAR_MARGIN_CSS_PIXELS = 3;
const OVERSIZED_CENTER_MARK_CSS_PIXELS = 7;

function brushToolActive(tool: CanvasInputTool): boolean {
  return tool === "paint" || tool === "blend";
}

function clampPixelRatio(value: number): number {
  return Math.min(2, Math.max(1, Number.isFinite(value) ? value : 1));
}

export function snapBrushOutlineCssCoordinate(value: number, pixelRatio: number): number {
  return Math.round(value * pixelRatio) / pixelRatio;
}

function clippedDirtyRect(
  centerX: number,
  centerY: number,
  diameter: number,
  width: number,
  height: number,
): DirtyRect {
  const halfExtent = Math.max(BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS, diameter)
    * Math.SQRT1_2
    + OUTLINE_CLEAR_MARGIN_CSS_PIXELS;
  const left = Math.max(0, Math.floor(centerX - halfExtent));
  const top = Math.max(0, Math.floor(centerY - halfExtent));
  const right = Math.min(width, Math.ceil(centerX + halfExtent));
  const bottom = Math.min(height, Math.ceil(centerY + halfExtent));
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Owns the canvas decoration only. Painting remains entirely in BrushEngine;
 * this controller consumes its cached, post-polarity alpha boundary.
 */
export class BrushOutlineController {
  private readonly abortController: AbortController;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver;
  private pointer: PointerPosition | null = null;
  private previousPointer: PointerPosition | null = null;
  private pointerDirectionRadians: number | null = null;
  private lastViewRotationRadians: number | null = null;
  private frame: number | null = null;
  private dirtyRect: DirtyRect | null = null;
  private pixelRatio = 1;
  private cachedOutline: BrushMaskOutline | null = null;
  private cachedOutlinePath: Path2D | null = null;
  private circlePath: Path2D | null = null;
  private disposed = false;

  constructor(private readonly options: BrushOutlineControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.context = options.overlay.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    options.overlay.hidden = true;
    const signal = this.abortController.signal;
    options.canvas.addEventListener("pointerenter", this.handlePointer, { signal });
    options.canvas.addEventListener("pointermove", this.handlePointer, { signal });
    options.canvas.addEventListener("pointerdown", this.handlePointer, { signal });
    options.canvas.addEventListener("pointerup", this.handlePointer, { signal });
    options.canvas.addEventListener("pointercancel", this.hideForPointerEnd, { signal });
    options.canvas.addEventListener("pointerleave", this.hideForPointerEnd, { signal });
    options.canvas.addEventListener("lostpointercapture", this.handleLostCapture, { signal });
    options.browser.addEventListener("keydown", this.handleKeyChange, { signal });
    options.browser.addEventListener("keyup", this.handleKeyChange, { signal });
    options.browser.addEventListener("blur", this.hideForPointerEnd, { signal });
    this.resizeObserver = new options.browser.ResizeObserver(() => {
      this.resizeBackingStore();
      this.scheduleRender();
    });
    this.resizeObserver.observe(options.canvas);
    this.resizeBackingStore();
  }

  notifyEngineUpdate(): void {
    this.scheduleRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.resizeObserver.disconnect();
    if (this.frame !== null) {
      this.options.browser.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.hide();
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.hideForPointerEnd();
      return;
    }
    const next: PointerPosition = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    };
    const previous = this.previousPointer;
    if (previous && previous.pointerType === next.pointerType) {
      const deltaX = next.clientX - previous.clientX;
      const deltaY = next.clientY - previous.clientY;
      if (Math.hypot(deltaX, deltaY) >= 1) {
        this.pointerDirectionRadians = Math.atan2(deltaY, deltaX);
      }
    }
    this.pointer = next;
    this.previousPointer = next;
    this.scheduleRender();
  };

  private readonly hideForPointerEnd = (): void => {
    this.pointer = null;
    this.previousPointer = null;
    this.pointerDirectionRadians = null;
    this.hide();
  };

  private readonly handleLostCapture = (): void => {
    if (!this.pointer) this.hide();
  };

  private readonly handleKeyChange = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== "r") return;
    if (event.type === "keydown") this.hide();
    else this.scheduleRender();
  };

  private scheduleRender(): void {
    if (this.disposed || !this.pointer || this.frame !== null) return;
    this.frame = this.options.browser.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private resizeBackingStore(): void {
    const rectangle = this.options.canvas.getBoundingClientRect();
    this.pixelRatio = clampPixelRatio(this.options.browser.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rectangle.width * this.pixelRatio));
    const height = Math.max(1, Math.round(rectangle.height * this.pixelRatio));
    if (this.options.overlay.width === width && this.options.overlay.height === height) return;
    this.options.overlay.width = width;
    this.options.overlay.height = height;
    this.dirtyRect = null;
  }

  private clearPrevious(): void {
    if (!this.context || !this.dirtyRect) return;
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.context.clearRect(
      this.dirtyRect.x,
      this.dirtyRect.y,
      this.dirtyRect.width,
      this.dirtyRect.height,
    );
    this.dirtyRect = null;
  }

  private hide(): void {
    this.clearPrevious();
    this.options.overlay.hidden = true;
    delete this.options.overlay.dataset.brushOutlineKind;
    delete this.options.overlay.dataset.brushOutlineDiameter;
    delete this.options.overlay.dataset.brushOutlinePrecision;
    delete this.options.overlay.dataset.brushOutlineRenderer;
    this.options.canvas.classList.remove("brush-outline-active");
  }

  private compileOutline(outline: BrushMaskOutline): Path2D {
    if (this.cachedOutline === outline && this.cachedOutlinePath) return this.cachedOutlinePath;
    const path = new this.options.browser.Path2D();
    for (const points of outline.paths) {
      if (points.length < 6) continue;
      path.moveTo(points[0], points[1]);
      for (let index = 2; index < points.length; index += 2) {
        path.lineTo(points[index], points[index + 1]);
      }
      path.closePath();
    }
    this.cachedOutline = outline;
    this.cachedOutlinePath = path;
    return path;
  }

  private unitCirclePath(): Path2D {
    if (this.circlePath) return this.circlePath;
    const path = new this.options.browser.Path2D();
    path.ellipse(0, 0, 0.5, 0.5, 0, 0, Math.PI * 2);
    this.circlePath = path;
    return path;
  }

  private strokePath(
    path: Path2D,
    centerX: number,
    centerY: number,
    diameter: number,
    rotationRadians: number,
  ): void {
    const context = this.context;
    if (!context) return;
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.translate(
      snapBrushOutlineCssCoordinate(centerX, this.pixelRatio),
      snapBrushOutlineCssCoordinate(centerY, this.pixelRatio),
    );
    context.rotate(rotationRadians);
    context.scale(diameter, diameter);
    context.lineCap = "square";
    context.lineJoin = "miter";
    context.setLineDash([]);
    context.strokeStyle = "rgb(255 255 255)";
    context.lineWidth = OUTLINE_PHYSICAL_PIXELS / this.pixelRatio / diameter;
    context.stroke(path);
    context.restore();
  }

  private strokeCenterMark(centerX: number, centerY: number): void {
    const context = this.context;
    if (!context) return;
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    const snappedX = snapBrushOutlineCssCoordinate(centerX, this.pixelRatio);
    const snappedY = snapBrushOutlineCssCoordinate(centerY, this.pixelRatio);
    context.beginPath();
    context.moveTo(snappedX - OVERSIZED_CENTER_MARK_CSS_PIXELS, snappedY);
    context.lineTo(snappedX + OVERSIZED_CENTER_MARK_CSS_PIXELS, snappedY);
    context.moveTo(snappedX, snappedY - OVERSIZED_CENTER_MARK_CSS_PIXELS);
    context.lineTo(snappedX, snappedY + OVERSIZED_CENTER_MARK_CSS_PIXELS);
    context.lineCap = "square";
    context.lineWidth = OUTLINE_PHYSICAL_PIXELS / this.pixelRatio;
    context.strokeStyle = "rgb(255 255 255)";
    context.stroke();
    context.restore();
  }

  private render(): void {
    const pointer = this.pointer;
    const canvas = this.options.canvas;
    if (
      !pointer
      || !this.context
      || !brushToolActive(this.options.getActiveTool())
      || canvas.classList.contains("panning")
      || canvas.classList.contains("rotating")
      || canvas.classList.contains("rotation-ready")
    ) {
      this.hide();
      return;
    }
    this.resizeBackingStore();
    const snapshot: BrushOutlineSnapshot = this.options.engine.getBrushOutlineSnapshot();
    if (
      snapshot.kind === "unavailable"
      || !Number.isFinite(snapshot.diameterCssPixels)
      || snapshot.diameterCssPixels <= 0
    ) {
      this.hide();
      return;
    }
    if (
      this.lastViewRotationRadians !== null
      && this.lastViewRotationRadians !== snapshot.viewRotationRadians
    ) {
      this.pointerDirectionRadians = null;
    }
    this.lastViewRotationRadians = snapshot.viewRotationRadians;

    const rectangle = canvas.getBoundingClientRect();
    const centerX = pointer.clientX - rectangle.left;
    const centerY = pointer.clientY - rectangle.top;
    const exactDiameter = snapshot.diameterCssPixels;
    const outline = snapshot.kind === "shape" ? snapshot.outline : null;
    if (snapshot.kind === "shape" && (!outline || outline.paths.length === 0)) {
      // Krita returns an empty decoration for an entirely transparent tip.
      // Leaving the overlay inactive also keeps the browser's native cursor
      // available, so the pointer never becomes unusable.
      this.hide();
      return;
    }
    const hasShapeBoundary = outline !== null;
    const shapeRotation = hasShapeBoundary
      ? brushOutlineRotationRadians(
        snapshot.followsStroke,
        snapshot.viewRotationRadians,
        this.pointerDirectionRadians,
      )
      : 0;
    const exactBoundingExtent = hasShapeBoundary
      ? brushOutlineBoundingExtentCssPixels(outline, exactDiameter, shapeRotation)
      : exactDiameter * 2;
    const useMinimumCircle = exactBoundingExtent < BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS;
    const oversized = exactBoundingExtent > rectangle.width + rectangle.height;
    const diameter = useMinimumCircle
      ? BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS
      : exactDiameter;
    const usesShapePath = !useMinimumCircle && hasShapeBoundary;
    const path = usesShapePath && outline
      ? this.compileOutline(outline)
      : this.unitCirclePath();
    const rotation = usesShapePath ? shapeRotation : 0;

    this.clearPrevious();
    this.strokePath(path, centerX, centerY, diameter, rotation);
    if (oversized) this.strokeCenterMark(centerX, centerY);
    this.dirtyRect = clippedDirtyRect(
      centerX,
      centerY,
      Math.max(
        diameter,
        oversized
          ? OVERSIZED_CENTER_MARK_CSS_PIXELS * 2
            + OUTLINE_PHYSICAL_PIXELS / this.pixelRatio
          : 0,
      ),
      rectangle.width,
      rectangle.height,
    );
    this.options.overlay.hidden = false;
    this.options.overlay.dataset.brushOutlineKind = oversized
      ? "oversized-with-center"
      : usesShapePath
        ? "shape-alpha"
        : "circle";
    this.options.overlay.dataset.brushOutlineDiameter = exactDiameter.toFixed(3);
    this.options.overlay.dataset.brushOutlinePrecision = outline
      ? (outline.precise ? "precise" : "bounded")
      : "analytic";
    this.options.overlay.dataset.brushOutlineRenderer = "krita-alpha-boundary";
    canvas.classList.add("brush-outline-active");
  }
}
