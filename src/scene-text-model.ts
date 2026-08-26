import {
  normalizeVectorTextDistortPoints,
  type VectorTextDistortPoints,
  type VectorTextTransformType,
} from "./vector-text-transform.ts";
import type { VectorTextOutlineJoin } from "./scene-vector-effects.ts";
import { normalizeSceneAxisScale } from "./scene-axis-scale.ts";

export interface VectorTextNode {
  readonly id: number;
  readonly kind: "text";
  name: string;
  visible: boolean;
  opacity: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  transformType: VectorTextTransformType;
  transformCurve: number;
  circleRadiusPercent: number;
  circleInverted: boolean;
  distortPoints: VectorTextDistortPoints | null;
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
  /** Horizontal compatibility alias; old documents use it for both axes. */
  scale: number;
  scaleX?: number;
  scaleY?: number;
  rotation: number;
}

export interface VectorTextNodeSeed {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  transformType?: VectorTextTransformType;
  transformCurve?: number;
  circleRadiusPercent?: number;
  circleInverted?: boolean;
  distortPoints?: VectorTextDistortPoints | null;
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
  scaleX?: number;
  scaleY?: number;
  rotation: number;
}

export function cloneVectorTextNode(
  node: Readonly<VectorTextNode>,
): VectorTextNode {
  return {
    ...node,
    ...normalizeSceneAxisScale(node),
    distortPoints: normalizeVectorTextDistortPoints(node.distortPoints),
  };
}
