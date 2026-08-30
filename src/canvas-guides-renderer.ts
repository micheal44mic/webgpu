import type { EditorGuidePreferences } from "./editor-settings-storage";
import { rasterPixelViewEnabled } from "./raster-pixel-view";
import {
  sceneLayerToCanvas,
  type ScenePoint,
} from "./scene-transform-geometry";
import type { SceneSnapMatch } from "./scene-transform-snap";
import type { VectorTextViewState } from "./vector-text-types";

const MAX_GRID_LINES_PER_AXIS = 512;
const MAX_PIXEL_GRID_LINES_PER_AXIS = 4096;
const GRID_TARGET_SPACING_CSS_PX = 56;
const RULER_TARGET_SPACING_CSS_PX = 64;
const RULER_SIZE_CSS_PX = 26;

function niceStepAtLeast(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const normalized = value / exponent;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * exponent;
}

function cssAxisScale(
  axis: "x" | "y",
  view: Readonly<VectorTextViewState>,
): number {
  const backingX = view.canvasWidth / Math.max(1, view.cssWidth);
  const backingY = view.canvasHeight / Math.max(1, view.cssHeight);
  const canvasX = axis === "x" ? view.rotationCos : -view.rotationSin;
  const canvasY = axis === "x" ? view.rotationSin : view.rotationCos;
  return view.zoom * Math.hypot(canvasX / backingX, canvasY / backingY);
}

export function adaptiveCanvasGridStep(
  view: Readonly<VectorTextViewState>,
  targetSpacingCssPx = GRID_TARGET_SPACING_CSS_PX,
): number {
  const minimumScale = Math.max(
    1e-6,
    Math.min(cssAxisScale("x", view), cssAxisScale("y", view)),
  );
  return niceStepAtLeast(Math.max(1, targetSpacingCssPx) / minimumScale);
}

function canvasToLayer(
  point: Readonly<ScenePoint>,
  view: Readonly<VectorTextViewState>,
): ScenePoint {
  const deltaX = (point.x - view.canvasWidth * 0.5) / Math.max(1e-9, view.zoom);
  const deltaY = (point.y - view.canvasHeight * 0.5) / Math.max(1e-9, view.zoom);
  return {
    x: view.centerX + view.rotationCos * deltaX + view.rotationSin * deltaY,
    y: view.centerY - view.rotationSin * deltaX + view.rotationCos * deltaY,
  };
}

function visibleDocumentRange(
  view: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const corners = [
    { x: 0, y: 0 },
    { x: view.canvasWidth, y: 0 },
    { x: view.canvasWidth, y: view.canvasHeight },
    { x: 0, y: view.canvasHeight },
  ].map((point) => canvasToLayer(point, view));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    minX: Math.max(0, Math.min(...xs)),
    maxX: Math.min(documentWidth, Math.max(...xs)),
    minY: Math.max(0, Math.min(...ys)),
    maxY: Math.min(documentHeight, Math.max(...ys)),
  };
}

function documentPath(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number,
): void {
  const corners = [
    sceneLayerToCanvas({ x: 0, y: 0 }, view),
    sceneLayerToCanvas({ x: documentWidth, y: 0 }, view),
    sceneLayerToCanvas({ x: documentWidth, y: documentHeight }, view),
    sceneLayerToCanvas({ x: 0, y: documentHeight }, view),
  ];
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
  context.closePath();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number,
  step: number,
): void {
  const range = visibleDocumentRange(view, documentWidth, documentHeight);
  if (range.maxX < range.minX || range.maxY < range.minY) return;
  const backing = Math.max(1, Math.min(
    view.canvasWidth / Math.max(1, view.cssWidth),
    view.canvasHeight / Math.max(1, view.cssHeight),
  ));
  context.save();
  documentPath(context, view, documentWidth, documentHeight);
  context.clip();
  context.lineWidth = Math.max(1, backing * 0.6);

  const drawAxis = (axis: "x" | "y", minimum: number, maximum: number): void => {
    const first = Math.ceil(minimum / step);
    const last = Math.floor(maximum / step);
    const count = Math.min(MAX_GRID_LINES_PER_AXIS, Math.max(0, last - first + 1));
    for (let offset = 0; offset < count; offset += 1) {
      const index = first + offset;
      const position = index * step;
      const major = index % 5 === 0;
      context.strokeStyle = major
        ? "rgba(188, 198, 214, 0.23)"
        : "rgba(188, 198, 214, 0.11)";
      const start = axis === "x"
        ? sceneLayerToCanvas({ x: position, y: 0 }, view)
        : sceneLayerToCanvas({ x: 0, y: position }, view);
      const end = axis === "x"
        ? sceneLayerToCanvas({ x: position, y: documentHeight }, view)
        : sceneLayerToCanvas({ x: documentWidth, y: position }, view);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
  };
  drawAxis("x", range.minX, range.maxX);
  drawAxis("y", range.minY, range.maxY);
  context.restore();
}

function drawPixelGrid(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number,
): void {
  const range = visibleDocumentRange(view, documentWidth, documentHeight);
  if (range.maxX < range.minX || range.maxY < range.minY) return;
  const firstX = Math.ceil(range.minX);
  const lastX = Math.floor(range.maxX);
  const firstY = Math.ceil(range.minY);
  const lastY = Math.floor(range.maxY);
  const lineCountX = Math.max(0, lastX - firstX + 1);
  const lineCountY = Math.max(0, lastY - firstY + 1);
  if (lineCountX === 0 && lineCountY === 0) return;
  if (
    lineCountX > MAX_PIXEL_GRID_LINES_PER_AXIS
    || lineCountY > MAX_PIXEL_GRID_LINES_PER_AXIS
  ) return;
  const backing = Math.max(1, Math.min(
    view.canvasWidth / Math.max(1, view.cssWidth),
    view.canvasHeight / Math.max(1, view.cssHeight),
  ));
  context.save();
  documentPath(context, view, documentWidth, documentHeight);
  context.clip();
  context.strokeStyle = "rgba(132, 136, 144, 0.46)";
  context.lineWidth = Math.max(1, backing * 0.55);
  context.setLineDash([]);
  context.beginPath();
  for (let x = firstX; x <= lastX; x += 1) {
    const start = sceneLayerToCanvas({ x, y: 0 }, view);
    const end = sceneLayerToCanvas({ x, y: documentHeight }, view);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  for (let y = firstY; y <= lastY; y += 1) {
    const start = sceneLayerToCanvas({ x: 0, y }, view);
    const end = sceneLayerToCanvas({ x: documentWidth, y }, view);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  context.stroke();
  context.restore();
}

function drawSmartGuides(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number,
  guides: readonly SceneSnapMatch[],
): void {
  if (guides.length === 0) return;
  const backing = Math.max(1, Math.min(
    view.canvasWidth / Math.max(1, view.cssWidth),
    view.canvasHeight / Math.max(1, view.cssHeight),
  ));
  const reach = Math.max(documentWidth, documentHeight, 1) * 4;
  context.save();
  context.lineWidth = Math.max(1, 1.25 * backing);
  context.setLineDash([5 * backing, 3 * backing]);
  for (const guide of guides) {
    context.strokeStyle = guide.kind === "grid"
      ? "rgba(107, 196, 255, 0.96)"
      : "rgba(255, 116, 75, 0.98)";
    const start = guide.axis === "x"
      ? sceneLayerToCanvas({ x: guide.position, y: -reach }, view)
      : sceneLayerToCanvas({ x: -reach, y: guide.position }, view);
    const end = guide.axis === "x"
      ? sceneLayerToCanvas({ x: guide.position, y: reach }, view)
      : sceneLayerToCanvas({ x: reach, y: guide.position }, view);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  context.restore();
}

function drawSymmetryAxis(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number,
  angleDegrees: number,
): void {
  const backing = Math.max(1, Math.min(
    view.canvasWidth / Math.max(1, view.cssWidth),
    view.canvasHeight / Math.max(1, view.cssHeight),
  ));
  const angleRadians = angleDegrees * Math.PI / 180;
  const rawDirectionX = Math.cos(angleRadians);
  const rawDirectionY = Math.sin(angleRadians);
  const directionX = Math.abs(rawDirectionX) < 1e-12 ? 0 : rawDirectionX;
  const directionY = Math.abs(rawDirectionY) < 1e-12 ? 0 : rawDirectionY;
  const centerX = documentWidth * 0.5;
  const centerY = documentHeight * 0.5;
  const halfReach = Math.min(
    directionX === 0 ? Number.POSITIVE_INFINITY : centerX / Math.abs(directionX),
    directionY === 0 ? Number.POSITIVE_INFINITY : centerY / Math.abs(directionY),
  );
  const start = sceneLayerToCanvas({
    x: centerX - directionX * halfReach,
    y: centerY - directionY * halfReach,
  }, view);
  const end = sceneLayerToCanvas({
    x: centerX + directionX * halfReach,
    y: centerY + directionY * halfReach,
  }, view);

  context.save();
  documentPath(context, view, documentWidth, documentHeight);
  context.clip();
  context.strokeStyle = "#dd5c35";
  context.lineWidth = Math.max(1, 1.5 * backing);
  context.setLineDash([8 * backing, 4 * backing]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function formatRulerValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10000) return `${Math.round(value / 1000)}k`;
  if (absolute >= 10) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function drawHorizontalRuler(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  top: number,
  bottom: number,
  leftInset: number,
  backingX: number,
  backingY: number,
): void {
  const useX = Math.abs(view.rotationCos) >= Math.abs(view.rotationSin);
  const derivative = (useX ? view.rotationCos : -view.rotationSin)
    / Math.max(1e-9, view.zoom);
  if (Math.abs(derivative) < 1e-9) return;
  const startPoint = canvasToLayer({ x: leftInset, y: bottom }, view);
  const startCoordinate = useX ? startPoint.x : startPoint.y;
  const endCoordinate = startCoordinate + derivative * (view.canvasWidth - leftInset);
  const step = niceStepAtLeast(
    RULER_TARGET_SPACING_CSS_PX * backingX * Math.abs(derivative),
  );
  const minimum = Math.min(startCoordinate, endCoordinate);
  const maximum = Math.max(startCoordinate, endCoordinate);
  const first = Math.ceil(minimum / step);
  const last = Math.floor(maximum / step);
  const count = Math.min(128, Math.max(0, last - first + 1));
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let offset = 0; offset < count; offset += 1) {
    const value = (first + offset) * step;
    const x = leftInset + (value - startCoordinate) / derivative;
    if (x < leftInset || x > view.canvasWidth) continue;
    context.beginPath();
    context.moveTo(x, bottom);
    context.lineTo(x, bottom - 6 * backingY);
    context.stroke();
    context.fillText(
      `${useX ? "" : "Y "}${formatRulerValue(value)}`,
      x,
      top + 3 * backingY,
      56 * backingX,
    );
  }
}

function drawVerticalRuler(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  left: number,
  right: number,
  topInset: number,
  backingX: number,
  backingY: number,
): void {
  const useY = Math.abs(view.rotationCos) >= Math.abs(view.rotationSin);
  const derivative = (useY ? view.rotationCos : view.rotationSin)
    / Math.max(1e-9, view.zoom);
  if (Math.abs(derivative) < 1e-9) return;
  const startPoint = canvasToLayer({ x: right, y: topInset }, view);
  const startCoordinate = useY ? startPoint.y : startPoint.x;
  const endCoordinate = startCoordinate + derivative * (view.canvasHeight - topInset);
  const step = niceStepAtLeast(
    RULER_TARGET_SPACING_CSS_PX * backingY * Math.abs(derivative),
  );
  const minimum = Math.min(startCoordinate, endCoordinate);
  const maximum = Math.max(startCoordinate, endCoordinate);
  const first = Math.ceil(minimum / step);
  const last = Math.floor(maximum / step);
  const count = Math.min(128, Math.max(0, last - first + 1));
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (let offset = 0; offset < count; offset += 1) {
    const value = (first + offset) * step;
    const y = topInset + (value - startCoordinate) / derivative;
    if (y < topInset || y > view.canvasHeight) continue;
    context.beginPath();
    context.moveTo(right, y);
    context.lineTo(right - 6 * backingX, y);
    context.stroke();
    context.fillText(
      `${useY ? "" : "X "}${formatRulerValue(value)}`,
      left + 3 * backingX,
      y,
      Math.max(1, right - left - 9 * backingX),
    );
  }
}

function drawRulers(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  viewportInsetsCss: Readonly<{ top: number; left: number }>,
): void {
  const backingX = view.canvasWidth / Math.max(1, view.cssWidth);
  const backingY = view.canvasHeight / Math.max(1, view.cssHeight);
  const width = RULER_SIZE_CSS_PX * backingX;
  const height = RULER_SIZE_CSS_PX * backingY;
  const left = Math.min(
    Math.max(0, viewportInsetsCss.left * backingX),
    Math.max(0, view.canvasWidth - width),
  );
  const top = Math.min(
    Math.max(0, viewportInsetsCss.top * backingY),
    Math.max(0, view.canvasHeight - height),
  );
  const right = left + width;
  const bottom = top + height;
  context.save();
  context.fillStyle = "rgba(17, 20, 25, 0.94)";
  context.fillRect(left, top, view.canvasWidth - left, height);
  context.fillRect(left, top, width, view.canvasHeight - top);
  context.strokeStyle = "rgba(201, 208, 220, 0.58)";
  context.lineWidth = Math.max(1, Math.min(backingX, backingY) * 0.7);
  context.font = `${Math.max(9, 9 * Math.min(backingX, backingY))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.fillStyle = "rgba(232, 236, 243, 0.9)";
  drawHorizontalRuler(context, view, top, bottom, right, backingX, backingY);
  drawVerticalRuler(context, view, left, right, bottom, backingX, backingY);
  context.fillStyle = "#181c22";
  context.fillRect(left, top, width, height);
  context.strokeRect(left, top, width, height);
  context.fillStyle = "rgba(232, 236, 243, 0.78)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    "px",
    left + width * 0.5,
    top + height * 0.5,
    width - 4 * backingX,
  );
  context.restore();
}

export interface RenderCanvasGuidesOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly view: Readonly<VectorTextViewState>;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly preferences: Readonly<EditorGuidePreferences>;
  readonly smartGuides?: readonly SceneSnapMatch[];
  readonly viewportInsetsCss?: Readonly<{ top: number; left: number }>;
}

export function renderCanvasGuides(options: Readonly<RenderCanvasGuidesOptions>): void {
  const { canvas, context, view, preferences } = options;
  const smartGuides = options.smartGuides ?? [];
  const symmetryEnabled = preferences.symmetryEnabled;
  const pixelGridVisible = preferences.pixelGrid && rasterPixelViewEnabled(view.zoom);
  const visible = preferences.rulers
    || preferences.grid
    || pixelGridVisible
    || symmetryEnabled
    || smartGuides.length > 0;
  canvas.hidden = !visible;
  if (!visible) {
    // Resizing releases the full viewport backing store when every guide is off.
    if (canvas.width !== 1) canvas.width = 1;
    if (canvas.height !== 1) canvas.height = 1;
    context.clearRect(0, 0, 1, 1);
    return;
  }
  // Guide geometry is UI, so one backing pixel per CSS pixel is sufficient.
  // Keeping it independent from Retina/WebGPU backing resolution avoids a
  // second full-DPR viewport allocation (4x the bytes at DPR 2).
  const targetWidth = Math.max(1, Math.round(view.cssWidth));
  const targetHeight = Math.max(1, Math.round(view.cssHeight));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(
    targetWidth / Math.max(1, view.canvasWidth),
    0,
    0,
    targetHeight / Math.max(1, view.canvasHeight),
    0,
    0,
  );
  if (pixelGridVisible) {
    drawPixelGrid(
      context,
      view,
      options.documentWidth,
      options.documentHeight,
    );
  }
  if (preferences.grid) {
    const step = adaptiveCanvasGridStep(view);
    if (!pixelGridVisible || step !== 1) {
      drawGrid(
        context,
        view,
        options.documentWidth,
        options.documentHeight,
        step,
      );
    }
  }
  if (symmetryEnabled) {
    drawSymmetryAxis(
      context,
      view,
      options.documentWidth,
      options.documentHeight,
      preferences.symmetryAngleDegrees,
    );
  }
  drawSmartGuides(
    context,
    view,
    options.documentWidth,
    options.documentHeight,
    smartGuides,
  );
  if (preferences.rulers) {
    drawRulers(
      context,
      view,
      options.viewportInsetsCss ?? { top: 0, left: 0 },
    );
  }
}
