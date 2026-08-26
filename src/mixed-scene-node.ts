import type { MixedSceneSnapshot, RasterTransformSnapshot } from "./engine-types";
import type { RasterImageNode } from "./scene-image-model";
import { cloneVectorSvgNode, type VectorSvgNode } from "./scene-svg-model";
import { cloneVectorTextNode, type VectorTextNode } from "./scene-text-model";
import type { SceneLocalBounds } from "./scene-transform-geometry";

export type VectorDrawableNode = VectorTextNode | VectorSvgNode;
export type VectorSceneNode = VectorDrawableNode | RasterImageNode;

export interface RasterLayerTransformNode extends RasterTransformSnapshot {
  kind: "raster-layer";
  id: number;
  name: string;
}

/** Presentation-only aggregate used while exact scene items are transformed together. */
export interface SceneGroupTransformNode {
  readonly kind: "group-transform";
  readonly id: -1;
  readonly name: string;
  readonly keys: readonly MixedSceneSnapshot["selectedKey"][];
  readonly anchorKey: MixedSceneSnapshot["selectedKey"];
  readonly localBounds: SceneLocalBounds;
  x: number;
  y: number;
  /** @deprecated Compatibility alias for `scaleX`. */
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export type TransformSceneNode =
  | VectorSceneNode
  | RasterLayerTransformNode
  | SceneGroupTransformNode;

export type VectorSceneNodeUpdate =
  | Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>
  | Partial<Omit<VectorSvgNode, "id" | "document" | "visible" | "opacity">>
  | Partial<Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">>;

export function isTextNode(
  node: Readonly<TransformSceneNode>,
): node is Readonly<VectorTextNode> {
  return node.kind === "text";
}

export function isSvgNode(
  node: Readonly<TransformSceneNode>,
): node is Readonly<VectorSvgNode> {
  return node.kind === "svg";
}

export function isImageNode(
  node: Readonly<TransformSceneNode>,
): node is Readonly<RasterImageNode> {
  return node.kind === "image";
}

export function isRasterLayerTransformNode(
  node: Readonly<TransformSceneNode>,
): node is Readonly<RasterLayerTransformNode> {
  return node.kind === "raster-layer";
}

export function isSceneGroupTransformNode(
  node: Readonly<TransformSceneNode>,
): node is Readonly<SceneGroupTransformNode> {
  return node.kind === "group-transform";
}

export function vectorNodeKey(
  node: Readonly<VectorSceneNode>,
): `text:${number}` | `svg:${number}` | `image:${number}` {
  return node.kind === "text"
    ? `text:${node.id}`
    : node.kind === "svg"
      ? `svg:${node.id}`
      : `image:${node.id}`;
}

export function copyVectorSceneNode(node: Readonly<VectorSceneNode>): VectorSceneNode {
  return isTextNode(node)
    ? cloneVectorTextNode(node)
    : isSvgNode(node)
      ? cloneVectorSvgNode(node)
      : { ...node, document: { ...node.document } };
}

export function transformNodeKey(
  node: Readonly<TransformSceneNode>,
): MixedSceneSnapshot["selectedKey"] {
  return isSceneGroupTransformNode(node)
    ? node.anchorKey
    : isRasterLayerTransformNode(node)
    ? `raster:${node.layerId}`
    : vectorNodeKey(node);
}

export function copyTransformNode(node: Readonly<TransformSceneNode>): TransformSceneNode {
  return isSceneGroupTransformNode(node)
    ? {
      ...node,
      keys: [...node.keys],
      localBounds: { ...node.localBounds },
    }
    : isRasterLayerTransformNode(node)
    ? {
      ...node,
      controlPoints: node.controlPoints.map((point) => ({ ...point })),
      bezierHandles: node.bezierHandles.map((point) => ({ ...point })),
      sourceBounds: { ...node.sourceBounds },
      sourcePivot: node.sourcePivot ? { ...node.sourcePivot } : undefined,
      resultBounds: node.resultBounds ? { ...node.resultBounds } : null,
    }
    : copyVectorSceneNode(node);
}
