import {
  sceneLayerToLocal,
  type SceneLocalBounds,
  type ScenePoint,
  type SceneTransform,
  type SceneTransformSideHandle,
} from "./scene-transform-geometry.ts";

export interface SceneAxisTransform extends SceneTransform {
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface SceneAxisTransformUpdate {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
}

export function transformSceneGroupMember(
  base: Readonly<SceneAxisTransform>,
  current: Readonly<SceneAxisTransform>,
  member: Readonly<SceneAxisTransform>,
): SceneAxisTransformUpdate {
  const cosine = Math.cos(current.rotation);
  const sine = Math.sin(current.rotation);
  const offsetX = (member.x - base.x) * current.scaleX;
  const offsetY = (member.y - base.y) * current.scaleY;
  const scaleX = member.scaleX * current.scaleX;
  const scaleY = member.scaleY * current.scaleY;
  return {
    x: current.x + cosine * offsetX - sine * offsetY,
    y: current.y + sine * offsetX + cosine * offsetY,
    scale: member.scale * current.scaleX,
    scaleX,
    scaleY,
    rotation: member.rotation + current.rotation,
  };
}

export interface SceneSideScaleInput {
  readonly start: Readonly<SceneAxisTransform>;
  readonly bounds: Readonly<SceneLocalBounds>;
  readonly handle: SceneTransformSideHandle;
  readonly pointer: Readonly<ScenePoint>;
  readonly minimumScale: number;
  readonly maximumScale: number;
  /** Keeps the local bounds center fixed so both opposite sides move together. */
  readonly centered?: boolean;
}

/** One-axis resize, optionally centered so opposite sides move together. */
export function sceneSideScaleUpdate(
  input: Readonly<SceneSideScaleInput>,
): SceneAxisTransformUpdate | null {
  const { start, bounds, handle } = input;
  const local = sceneLayerToLocal(input.pointer, start);
  const horizontal = handle === "east" || handle === "west";
  const moving = horizontal
    ? handle === "east" ? bounds.right : bounds.left
    : handle === "south" ? bounds.bottom : bounds.top;
  const fixed = horizontal
    ? handle === "east" ? bounds.left : bounds.right
    : handle === "south" ? bounds.top : bounds.bottom;
  const anchor = input.centered ? (moving + fixed) * 0.5 : fixed;
  const pointerCoordinate = horizontal ? local.x : local.y;
  const denominator = moving - anchor;
  if (Math.abs(denominator) <= Number.EPSILON) return null;
  const rawFactor = (pointerCoordinate - anchor) / denominator;
  const startAxisScale = horizontal ? start.scaleX : start.scaleY;
  const nextAxisScale = Math.min(
    input.maximumScale,
    Math.max(input.minimumScale, startAxisScale * rawFactor),
  );
  const cosine = Math.cos(start.rotation);
  const sine = Math.sin(start.rotation);
  if (horizontal) {
    const localShiftX = (start.scaleX - nextAxisScale) * anchor;
    return {
      x: start.x + cosine * localShiftX,
      y: start.y + sine * localShiftX,
      scale: nextAxisScale,
      scaleX: nextAxisScale,
      scaleY: start.scaleY,
      rotation: start.rotation,
    };
  }
  const localShiftY = (start.scaleY - nextAxisScale) * anchor;
  return {
    x: start.x - sine * localShiftY,
    y: start.y + cosine * localShiftY,
    scale: start.scaleX,
    scaleX: start.scaleX,
    scaleY: nextAxisScale,
    rotation: start.rotation,
  };
}
