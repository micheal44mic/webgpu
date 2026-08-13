import type { VectorTextNode } from "./scene-text-model";
import {
  moveVectorTextDistortPoint,
  type VectorTextDistortPoints,
} from "./vector-text-transform.ts";
import {
  closestSceneControlPoint,
  hitSceneTransformHandle,
  hitsSceneTransformBody,
  sceneLayerToLocal,
  scenePointDistance,
  type ScenePoint,
  type SceneTransformHandle,
} from "./scene-transform-geometry";
import {
  isRasterLayerTransformNode,
  isTextNode,
  type TransformSceneNode,
} from "./mixed-scene-node";
import {
  sceneDistortCanvasPoints,
  sceneOverlayRotationHandle,
  SCENE_TRANSFORM_HIT_RADIUS_CSS_PX,
} from "./scene-interaction-overlay";
import type { VectorTextViewState } from "./vector-text-types";

export type MixedSceneInteractionMode = "move" | "scale" | "rotate" | "pan" | "distort";

export interface MixedSceneActiveInteraction {
  pointerId: number;
  mode: MixedSceneInteractionMode;
  startClient: ScenePoint;
  startLayer: ScenePoint;
  startModel: TransformSceneNode;
  startDistance: number;
  startAngle: number;
  distortPointIndex: number | null;
  openedTransformSession: boolean;
}

export interface MixedSceneTouchNavigationGesture {
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
}

export function mixedSceneEventCanvasPoint(
  event: Pick<PointerEvent, "clientX" | "clientY">,
  canvas: HTMLCanvasElement,
): ScenePoint {
  const rectangle = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rectangle.left) / Math.max(1, rectangle.width) * canvas.width,
    y: (event.clientY - rectangle.top) / Math.max(1, rectangle.height) * canvas.height,
  };
}

export function mixedSceneTransformHandle(
  point: ScenePoint,
  corners: readonly ScenePoint[],
  view: VectorTextViewState,
  node: Readonly<TransformSceneNode>,
): SceneTransformHandle | "rotate" | null {
  if (isRasterLayerTransformNode(node) && node.scope === "selection") return null;
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const hitRadius = SCENE_TRANSFORM_HIT_RADIUS_CSS_PX * backingPerCssPixel;
  return hitSceneTransformHandle(
    point,
    corners,
    sceneOverlayRotationHandle(corners, node, view),
    hitRadius,
  );
}

export function hitsMixedSceneTransformBody(
  point: ScenePoint,
  corners: readonly ScenePoint[],
  view: VectorTextViewState,
  node: Readonly<TransformSceneNode>,
): boolean {
  const includeSelectionEdgeReach = isRasterLayerTransformNode(node)
    && node.scope === "selection";
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  return hitsSceneTransformBody(
    point,
    corners,
    includeSelectionEdgeReach ? 22 * backingPerCssPixel : 0,
  );
}

export function mixedSceneDistortPoint(
  point: ScenePoint,
  view: VectorTextViewState,
  node: Readonly<VectorTextNode>,
): number | null {
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const hitRadius = SCENE_TRANSFORM_HIT_RADIUS_CSS_PX * backingPerCssPixel;
  return closestSceneControlPoint(
    point,
    sceneDistortCanvasPoints(view, node),
    hitRadius,
  );
}

export function currentMixedSceneTouchGesture(
  contacts: ReadonlyMap<number, ScenePoint>,
): MixedSceneTouchNavigationGesture | null {
  if (contacts.size < 2) return null;
  const [first, second] = [...contacts.values()];
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  return {
    centerX: (first.x + second.x) * 0.5,
    centerY: (first.y + second.y) * 0.5,
    distance: Math.max(1e-6, Math.hypot(deltaX, deltaY)),
    angle: Math.atan2(deltaY, deltaX),
  };
}

export function movedMixedSceneDistortPoints(
  interaction: MixedSceneActiveInteraction,
  layerPoint: ScenePoint,
  lockAxis: boolean,
): VectorTextDistortPoints | null {
  if (!isTextNode(interaction.startModel)) return null;
  const startPoints = interaction.startModel.distortPoints;
  const pointIndex = interaction.distortPointIndex;
  if (!startPoints || pointIndex === null) return null;
  const startLocal = sceneLayerToLocal(interaction.startLayer, interaction.startModel);
  const currentLocal = sceneLayerToLocal(layerPoint, interaction.startModel);
  let deltaX = currentLocal.x - startLocal.x;
  let deltaY = currentLocal.y - startLocal.y;
  if (lockAxis) {
    if (Math.abs(deltaX) >= Math.abs(deltaY)) deltaY = 0;
    else deltaX = 0;
  }
  return moveVectorTextDistortPoint(startPoints, pointIndex, {
    x: startPoints[pointIndex].x + deltaX,
    y: startPoints[pointIndex].y + deltaY,
  });
}

export function mixedSceneTransformUpdate(
  interaction: MixedSceneActiveInteraction,
  layerPoint: ScenePoint,
): Partial<Pick<TransformSceneNode, "x" | "y" | "scale" | "rotation">> | null {
  if (interaction.mode === "move") {
    return {
      x: interaction.startModel.x + layerPoint.x - interaction.startLayer.x,
      y: interaction.startModel.y + layerPoint.y - interaction.startLayer.y,
    };
  }
  if (interaction.mode === "scale") {
    const distance = scenePointDistance(layerPoint, {
      x: interaction.startModel.x,
      y: interaction.startModel.y,
    });
    return {
      scale: Math.min(
        20,
        Math.max(0.05, interaction.startModel.scale * distance / interaction.startDistance),
      ),
    };
  }
  if (interaction.mode === "rotate") {
    const angle = Math.atan2(
      layerPoint.y - interaction.startModel.y,
      layerPoint.x - interaction.startModel.x,
    );
    return {
      rotation: interaction.startModel.rotation + angle - interaction.startAngle,
    };
  }
  return null;
}
