import type { MixedSceneSnapshot, RasterTransformSnapshot } from "./engine-types";
import type { RasterImageNode } from "./scene-image-model";
import { cloneVectorSvgNode, type VectorSvgNode } from "./scene-svg-model";
import { cloneVectorTextNode, type VectorTextNode } from "./scene-text-model";

export type VectorDrawableNode = VectorTextNode | VectorSvgNode;
export type VectorSceneNode = VectorDrawableNode | RasterImageNode;

export interface RasterLayerTransformNode extends RasterTransformSnapshot {
  kind: "raster-layer";
  id: number;
  name: string;
}

export type TransformSceneNode = VectorSceneNode | RasterLayerTransformNode;

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
  return isRasterLayerTransformNode(node)
    ? `raster:${node.layerId}`
    : vectorNodeKey(node);
}

export function copyTransformNode(node: Readonly<TransformSceneNode>): TransformSceneNode {
  return isRasterLayerTransformNode(node)
    ? {
      ...node,
      controlPoints: node.controlPoints.map((point) => ({ ...point })),
      bezierHandles: node.bezierHandles.map((point) => ({ ...point })),
      sourceBounds: { ...node.sourceBounds },
      resultBounds: node.resultBounds ? { ...node.resultBounds } : null,
    }
    : copyVectorSceneNode(node);
}
