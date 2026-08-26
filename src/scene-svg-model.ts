import {
  cloneVectorSvgDocument,
  type VectorSvgDocument,
} from "./vector-svg-import.ts";
import type { VectorTextOutlineJoin } from "./scene-vector-effects.ts";
import {
  cloneVectorShapeDefinition,
  type VectorShapeDefinition,
} from "./vector-shape-core.ts";

export interface VectorSvgNode {
  readonly id: number;
  readonly kind: "svg";
  name: string;
  visible: boolean;
  opacity: number;
  document: VectorSvgDocument;
  /** Present for internally generated geometry that remains parametrically editable. */
  readonly shapeDefinition?: VectorShapeDefinition;
  paintColors: string[];
  outlineWidth: number;
  outlineColor: string;
  outlineJoin: VectorTextOutlineJoin;
  blockShadowEnabled: boolean;
  blockShadowColor: string;
  blockShadowOpacity: number;
  blockShadowOffset: number;
  blockShadowAngle: number;
  blockShadowOutlineWidth: number;
  singleShadowEnabled: boolean;
  singleShadowColor: string;
  singleShadowOpacity: number;
  singleShadowOffset: number;
  singleShadowAngle: number;
  singleShadowBlur: number;
  innerShadowEnabled: boolean;
  innerShadowColor: string;
  innerShadowOpacity: number;
  innerShadowOffset: number;
  innerShadowAngle: number;
  innerShadowBlur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface VectorSvgNodeSeed {
  document: VectorSvgDocument;
  readonly shapeDefinition?: VectorShapeDefinition;
  paintColors?: readonly string[];
  outlineWidth?: number;
  outlineColor?: string;
  outlineJoin?: VectorTextOutlineJoin;
  blockShadowEnabled?: boolean;
  blockShadowColor?: string;
  blockShadowOpacity?: number;
  blockShadowOffset?: number;
  blockShadowAngle?: number;
  blockShadowOutlineWidth?: number;
  singleShadowEnabled?: boolean;
  singleShadowColor?: string;
  singleShadowOpacity?: number;
  singleShadowOffset?: number;
  singleShadowAngle?: number;
  singleShadowBlur?: number;
  innerShadowEnabled?: boolean;
  innerShadowColor?: string;
  innerShadowOpacity?: number;
  innerShadowOffset?: number;
  innerShadowAngle?: number;
  innerShadowBlur?: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export function cloneVectorSvgNode(node: Readonly<VectorSvgNode>): VectorSvgNode {
  return {
    ...node,
    document: cloneVectorSvgDocument(node.document),
    shapeDefinition: cloneVectorShapeDefinition(node.shapeDefinition),
    paintColors: [...node.paintColors],
  };
}

/** History snapshots share the immutable parsed SVG document by design. */
export function cloneVectorSvgNodeForHistory(
  node: Readonly<VectorSvgNode>,
): VectorSvgNode {
  return {
    ...node,
    document: node.document,
    shapeDefinition: cloneVectorShapeDefinition(node.shapeDefinition),
    paintColors: [...node.paintColors],
  };
}
