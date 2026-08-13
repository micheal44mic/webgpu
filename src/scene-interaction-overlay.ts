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
  type SceneLocalBounds,
  type ScenePoint,
} from "./scene-transform-geometry";

export const SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX = 7;
export const SCENE_TRANSFORM_HIT_RADIUS_CSS_PX = 13;
const ROTATION_HANDLE_OFFSET_CSS_PX = 38;

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
  const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
  const anchorRadius = SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX * backingPerCssPixel;
  const bezierRadius = Math.max(3, 5 * backingPerCssPixel);
  context.save();
  context.lineWidth = lineWidth;
  context.setLineDash([]);

  context.strokeStyle = "rgba(141, 154, 255, 0.7)";
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

  context.strokeStyle = "#8d9aff";
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

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const radius = index < 6 ? anchorRadius : bezierRadius;
    context.fillStyle = index < 6 ? "#f7f8ff" : "#9aa6ff";
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
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
  const corners = sceneOverlayCorners(options.bounds, node, view);
  const rotationHandle = sceneOverlayRotationHandle(corners, node, view);
  const topCenter = {
    x: (corners[0].x + corners[1].x) * 0.5,
    y: (corners[0].y + corners[1].y) * 0.5,
  };
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
  const handleRadius = SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX * backingPerCssPixel;

  renderTransformGuide(context, view, node, options.transformGuide);
  context.save();
  context.strokeStyle = "#8d9aff";
  context.fillStyle = "#f7f8ff";
  context.lineWidth = lineWidth;
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
  for (const corner of corners) {
    context.beginPath();
    context.rect(
      corner.x - handleRadius,
      corner.y - handleRadius,
      handleRadius * 2,
      handleRadius * 2,
    );
    context.fill();
    context.stroke();
  }
  context.beginPath();
  context.arc(rotationHandle.x, rotationHandle.y, handleRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}
