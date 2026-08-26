import type { VectorTextTransformGuide } from "./vector-text-font-geometry";
import type { VectorTextViewState } from "./vector-text-types";
import {
  isRasterLayerTransformNode,
  isTextNode,
  type TransformSceneNode,
} from "./mixed-scene-node";
import {
  sceneLayerToCanvas,
  sceneLocalToLayer,
  scenePointDistance,
  sceneRotationHandle,
  sceneTransformCorners,
  sceneTransformSideHandleCorners,
  sceneTransformSideMidpoints,
  type SceneTransformHandleHitRadii,
  type SceneLocalBounds,
  type ScenePoint,
} from "./scene-transform-geometry";
import {
  RASTER_WARP_RENDER_SUBDIVISIONS,
  normalizeRasterWarpBezierHandles,
  rasterDeformBoundaryIndices,
  rasterDeformGridSize,
  rasterWarpBezierHandleAnchorIndex,
  rasterWarpSurfaceSampler,
} from "./raster-deform-math";

export const SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX = 5;
export const SCENE_TRANSFORM_HIT_RADIUS_CSS_PX = 13;
export const SCENE_TRANSFORM_TOUCH_HIT_RADIUS_CSS_PX = 22;
export const SCENE_TRANSFORM_CORNER_HIT_RADIUS_CSS_PX = 18;
export const SCENE_TRANSFORM_SIDE_HANDLE_WIDTH_CSS_PX = 20;
export const SCENE_TRANSFORM_SIDE_HANDLE_HEIGHT_CSS_PX = 6;
const ROTATION_HANDLE_OFFSET_CSS_PX = 38;
const SCENE_BOUNDING_BOX_STROKE_STYLE = "#ff7a33";
const SCENE_BOUNDING_BOX_AUXILIARY_STROKE_STYLE = "rgba(255, 122, 51, 0.72)";
const SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE = "#ffffff";
const SCENE_BOUNDING_BOX_LINE_WIDTH_CSS_PX = 2;
const SCENE_BOUNDING_BOX_HANDLE_STROKE_WIDTH_CSS_PX = 1.75;
const SCENE_BOUNDING_BOX_SECONDARY_HANDLE_RADIUS_CSS_PX = 3.5;

function renderSceneBoundingBoxHandle(
  context: CanvasRenderingContext2D,
  point: Readonly<ScenePoint>,
  radius: number,
): void {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function renderSceneBoundingBoxSideHandle(
  context: CanvasRenderingContext2D,
  point: Readonly<ScenePoint>,
  tangent: Readonly<ScenePoint>,
  width: number,
  height: number,
): void {
  const points = sceneTransformSideHandleCorners(point, tangent, width, height);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fill();
  context.stroke();
}

export function sceneOverlayTransformHitRadii(
  view: Readonly<VectorTextViewState>,
  pointerType: string,
): SceneTransformHandleHitRadii {
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const cssRadius = pointerType === "touch"
    ? SCENE_TRANSFORM_TOUCH_HIT_RADIUS_CSS_PX
    : SCENE_TRANSFORM_HIT_RADIUS_CSS_PX;
  const radius = cssRadius * backingPerCssPixel;
  return { corner: radius, side: radius, rotation: radius };
}

export function sceneOverlayCorners(
  bounds: Readonly<SceneLocalBounds>,
  node: Readonly<TransformSceneNode>,
  view: Readonly<VectorTextViewState>,
): readonly ScenePoint[] {
  return sceneTransformCorners(bounds, node, view);
}

export function sceneOverlayRotationHandle(
  corners: readonly ScenePoint[],
  node: Readonly<TransformSceneNode>,
  view: Readonly<VectorTextViewState>,
): ScenePoint {
  return sceneRotationHandle(corners, node, view, ROTATION_HANDLE_OFFSET_CSS_PX);
}

export function sceneDistortCanvasPoints(
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
): readonly ScenePoint[] {
  if (!isTextNode(node) || !node.distortPoints) return [];
  return node.distortPoints.map((point) =>
    sceneLayerToCanvas(sceneLocalToLayer(point, node), view));
}

export function sceneRasterDeformCanvasPoints(
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
): readonly ScenePoint[] {
  if (
    !isRasterLayerTransformNode(node)
    || node.scope !== "layer"
    || node.mode === "affine"
  ) return [];
  return node.controlPoints.map((point) => sceneLayerToCanvas(point, view));
}

export function sceneRasterWarpBezierCanvasHandles(
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
): readonly ScenePoint[] {
  if (
    !isRasterLayerTransformNode(node)
    || node.scope !== "layer"
    || node.mode !== "warp"
  ) return [];
  const handles = normalizeRasterWarpBezierHandles(
    node.bezierHandles,
    node.controlPoints,
    node.gridSize,
  );
  return handles.map((point) => sceneLayerToCanvas(point, view));
}

export function sceneRasterDeformBoundaryCanvasPoints(
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
): readonly ScenePoint[] {
  const points = sceneRasterDeformCanvasPoints(view, node);
  if (!isRasterLayerTransformNode(node) || node.mode === "affine") return [];
  const size = rasterDeformGridSize(node.mode, node.gridSize);
  if (node.mode === "warp") {
    const steps = (size - 1) * RASTER_WARP_RENDER_SUBDIVISIONS;
    const handles = sceneRasterWarpBezierCanvasHandles(view, node);
    const sample = rasterWarpSurfaceSampler(points, size, handles);
    const boundary: ScenePoint[] = [];
    for (let step = 0; step < steps; step += 1) {
      boundary.push(sample(step / steps, 0));
    }
    for (let step = 0; step < steps; step += 1) {
      boundary.push(sample(1, step / steps));
    }
    for (let step = steps; step > 0; step -= 1) {
      boundary.push(sample(step / steps, 1));
    }
    for (let step = steps; step > 0; step -= 1) {
      boundary.push(sample(0, step / steps));
    }
    return boundary;
  }
  return rasterDeformBoundaryIndices(size).map((index) => points[index]);
}

export function clearSceneInteractionOverlay(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, view.canvasWidth, view.canvasHeight);
  context.restore();
}

function renderTransformGuide(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
  guide: VectorTextTransformGuide | null,
): void {
  if (!isTextNode(node) || !guide) return;
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
  const markerRadius = Math.max(2, 3 * backingPerCssPixel);
  context.save();
  context.strokeStyle = "rgba(103, 126, 255, 0.92)";
  context.fillStyle = "#6f83ff";
  context.lineWidth = lineWidth;
  context.setLineDash([5 * backingPerCssPixel, 4 * backingPerCssPixel]);
  if (guide.kind === "curve") {
    const points = guide.points.map((point) =>
      sceneLayerToCanvas(sceneLocalToLayer(point, node), view));
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
    context.setLineDash([]);
    for (const index of [0, 16, 32, 48, 64]) {
      const point = points[index];
      if (!point) continue;
      context.beginPath();
      context.arc(point.x, point.y, markerRadius, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    const center = sceneLayerToCanvas(
      sceneLocalToLayer({ x: guide.centerX, y: guide.centerY }, node),
      view,
    );
    const edge = sceneLayerToCanvas(
      sceneLocalToLayer({
        x: guide.centerX + guide.radius,
        y: guide.centerY,
      }, node),
      view,
    );
    const radius = scenePointDistance(center, edge);
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(center.x, center.y, markerRadius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function renderDistortOverlay(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
): void {
  const points = sceneDistortCanvasPoints(view, node);
  if (points.length !== 10) return;
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const lineWidth = Math.max(
    1,
    SCENE_BOUNDING_BOX_LINE_WIDTH_CSS_PX * backingPerCssPixel,
  );
  const handleStrokeWidth = Math.max(
    1,
    SCENE_BOUNDING_BOX_HANDLE_STROKE_WIDTH_CSS_PX * backingPerCssPixel,
  );
  const anchorRadius = SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX * backingPerCssPixel;
  const bezierRadius = Math.max(
    2.5,
    SCENE_BOUNDING_BOX_SECONDARY_HANDLE_RADIUS_CSS_PX * backingPerCssPixel,
  );
  context.save();
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);

  context.strokeStyle = SCENE_BOUNDING_BOX_AUXILIARY_STROKE_STYLE;
  context.beginPath();
  context.moveTo(points[1].x, points[1].y);
  context.lineTo(points[6].x, points[6].y);
  context.moveTo(points[1].x, points[1].y);
  context.lineTo(points[7].x, points[7].y);
  context.moveTo(points[4].x, points[4].y);
  context.lineTo(points[8].x, points[8].y);
  context.moveTo(points[4].x, points[4].y);
  context.lineTo(points[9].x, points[9].y);
  context.stroke();

  context.strokeStyle = SCENE_BOUNDING_BOX_STROKE_STYLE;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  context.bezierCurveTo(
    points[0].x,
    points[0].y,
    points[6].x,
    points[6].y,
    points[1].x,
    points[1].y,
  );
  context.bezierCurveTo(
    points[7].x,
    points[7].y,
    points[2].x,
    points[2].y,
    points[2].x,
    points[2].y,
  );
  context.lineTo(points[3].x, points[3].y);
  context.bezierCurveTo(
    points[3].x,
    points[3].y,
    points[9].x,
    points[9].y,
    points[4].x,
    points[4].y,
  );
  context.bezierCurveTo(
    points[8].x,
    points[8].y,
    points[5].x,
    points[5].y,
    points[5].x,
    points[5].y,
  );
  context.closePath();
  context.stroke();

  context.fillStyle = SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE;
  context.strokeStyle = SCENE_BOUNDING_BOX_STROKE_STYLE;
  context.lineWidth = handleStrokeWidth;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const radius = index < 6 ? anchorRadius : bezierRadius;
    renderSceneBoundingBoxHandle(context, point, radius);
  }
  context.restore();
}

function renderRasterDeformOverlay(
  context: CanvasRenderingContext2D,
  view: Readonly<VectorTextViewState>,
  node: Readonly<TransformSceneNode>,
): void {
  if (!isRasterLayerTransformNode(node) || node.mode === "affine") return;
  const points = sceneRasterDeformCanvasPoints(view, node);
  const size = rasterDeformGridSize(node.mode, node.gridSize);
  if (points.length !== size * size) return;
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const lineWidth = Math.max(
    1,
    SCENE_BOUNDING_BOX_LINE_WIDTH_CSS_PX * backingPerCssPixel,
  );
  const handleStrokeWidth = Math.max(
    1,
    SCENE_BOUNDING_BOX_HANDLE_STROKE_WIDTH_CSS_PX * backingPerCssPixel,
  );
  const handleRadius = SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX * backingPerCssPixel;
  const secondaryHandleRadius = Math.max(
    2.5,
    SCENE_BOUNDING_BOX_SECONDARY_HANDLE_RADIUS_CSS_PX * backingPerCssPixel,
  );
  const bezierHandles = node.mode === "warp"
    ? sceneRasterWarpBezierCanvasHandles(view, node)
    : [];
  context.save();
  context.strokeStyle = SCENE_BOUNDING_BOX_STROKE_STYLE;
  context.fillStyle = SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);
  context.beginPath();
  if (node.mode === "warp") {
    const steps = (size - 1) * RASTER_WARP_RENDER_SUBDIVISIONS;
    const sample = rasterWarpSurfaceSampler(points, size, bezierHandles);
    for (let row = 0; row < size; row += 1) {
      for (let step = 0; step <= steps; step += 1) {
        const point = sample(step / steps, row / (size - 1));
        if (step === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
    }
    for (let column = 0; column < size; column += 1) {
      for (let step = 0; step <= steps; step += 1) {
        const point = sample(column / (size - 1), step / steps);
        if (step === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
    }
  } else {
    for (let row = 0; row < size; row += 1) {
      context.moveTo(points[row * size].x, points[row * size].y);
      for (let column = 1; column < size; column += 1) {
        const point = points[row * size + column];
        context.lineTo(point.x, point.y);
      }
    }
    for (let column = 0; column < size; column += 1) {
      context.moveTo(points[column].x, points[column].y);
      for (let row = 1; row < size; row += 1) {
        const point = points[row * size + column];
        context.lineTo(point.x, point.y);
      }
    }
  }
  context.stroke();
  if (node.mode === "warp" && bezierHandles.length === 8) {
    context.strokeStyle = SCENE_BOUNDING_BOX_AUXILIARY_STROKE_STYLE;
    context.lineWidth = lineWidth;
    context.beginPath();
    for (let index = 0; index < bezierHandles.length; index += 1) {
      const anchor = points[rasterWarpBezierHandleAnchorIndex(size, index)];
      const handle = bezierHandles[index];
      context.moveTo(anchor.x, anchor.y);
      context.lineTo(handle.x, handle.y);
    }
    context.stroke();
    context.fillStyle = SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE;
    context.strokeStyle = SCENE_BOUNDING_BOX_STROKE_STYLE;
    context.lineWidth = handleStrokeWidth;
    for (const handle of bezierHandles) {
      renderSceneBoundingBoxHandle(context, handle, secondaryHandleRadius);
    }
  }
  context.fillStyle = SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE;
  context.strokeStyle = SCENE_BOUNDING_BOX_STROKE_STYLE;
  context.lineWidth = handleStrokeWidth;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const row = Math.floor(index / size);
    const column = index % size;
    const corner = (row === 0 || row === size - 1)
      && (column === 0 || column === size - 1);
    const radius = corner || node.mode === "perspective"
      ? handleRadius
      : secondaryHandleRadius;
    renderSceneBoundingBoxHandle(context, point, radius);
  }
  context.restore();
}

export interface RenderSceneInteractionOverlayOptions {
  readonly context: CanvasRenderingContext2D;
  readonly view: Readonly<VectorTextViewState>;
  readonly node: Readonly<TransformSceneNode>;
  readonly bounds: Readonly<SceneLocalBounds>;
  readonly distortEditingNodeId: number | null;
  readonly transformGuide: VectorTextTransformGuide | null;
}

export function renderSceneInteractionOverlay(
  options: Readonly<RenderSceneInteractionOverlayOptions>,
): void {
  const { context, view, node } = options;
  clearSceneInteractionOverlay(context, view);
  if (
    isTextNode(node)
    && node.transformType === "distort"
    && node.distortPoints
    && options.distortEditingNodeId === node.id
  ) {
    renderDistortOverlay(context, view, node);
    return;
  }
  if (
    isRasterLayerTransformNode(node)
    && node.scope === "layer"
    && node.mode !== "affine"
  ) {
    renderRasterDeformOverlay(context, view, node);
    return;
  }
  const corners = sceneOverlayCorners(options.bounds, node, view);
  const rotationHandle = sceneOverlayRotationHandle(corners, node, view);
  const topCenter = {
    x: (corners[0].x + corners[1].x) * 0.5,
    y: (corners[0].y + corners[1].y) * 0.5,
  };
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const lineWidth = Math.max(
    1,
    SCENE_BOUNDING_BOX_LINE_WIDTH_CSS_PX * backingPerCssPixel,
  );
  const handleStrokeWidth = Math.max(
    1,
    SCENE_BOUNDING_BOX_HANDLE_STROKE_WIDTH_CSS_PX * backingPerCssPixel,
  );
  const handleRadius = SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX * backingPerCssPixel;
  const sideHandleWidth = SCENE_TRANSFORM_SIDE_HANDLE_WIDTH_CSS_PX
    * backingPerCssPixel;
  const sideHandleHeight = SCENE_TRANSFORM_SIDE_HANDLE_HEIGHT_CSS_PX
    * backingPerCssPixel;

  renderTransformGuide(context, view, node, options.transformGuide);
  context.save();
  context.strokeStyle = SCENE_BOUNDING_BOX_STROKE_STYLE;
  context.fillStyle = SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index += 1) {
    context.lineTo(corners[index].x, corners[index].y);
  }
  context.closePath();
  context.stroke();

  if (isRasterLayerTransformNode(node) && node.scope === "selection") {
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(topCenter.x, topCenter.y);
  context.lineTo(rotationHandle.x, rotationHandle.y);
  context.stroke();
  context.lineWidth = handleStrokeWidth;
  const sideMidpoints = sceneTransformSideMidpoints(corners);
  for (let index = 0; index < sideMidpoints.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    renderSceneBoundingBoxSideHandle(
      context,
      sideMidpoints[index],
      { x: end.x - start.x, y: end.y - start.y },
      sideHandleWidth,
      sideHandleHeight,
    );
  }
  for (const corner of corners) {
    renderSceneBoundingBoxHandle(context, corner, handleRadius);
  }
  renderSceneBoundingBoxHandle(context, rotationHandle, handleRadius);
  context.restore();
}
