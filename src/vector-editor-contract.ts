import type {
  VectorTextNode,
  VectorTextOutlineJoin,
} from "./mixed-scene-stack";
import type { VectorTextTransformType } from "./vector-text-transform";

export type VectorShadowKind = "single" | "inner" | "block";

export type VectorTextEditorPatch = Partial<Pick<
  VectorTextNode,
  | "text"
  | "fontFamily"
  | "fontSize"
  | "color"
  | "transformCurve"
  | "circleRadiusPercent"
  | "circleInverted"
>>;

export type VectorEffectEditorPatch = Partial<Pick<
  VectorTextNode,
  | "outlineWidth"
  | "outlineColor"
  | "outlineJoin"
  | "singleShadowColor"
  | "singleShadowOpacity"
  | "singleShadowOffset"
  | "singleShadowAngle"
  | "singleShadowBlur"
  | "innerShadowColor"
  | "innerShadowOpacity"
  | "innerShadowOffset"
  | "innerShadowAngle"
  | "innerShadowBlur"
  | "blockShadowColor"
  | "blockShadowOpacity"
  | "blockShadowOffset"
  | "blockShadowAngle"
  | "blockShadowOutlineWidth"
>>;

export interface VectorTextEditorSnapshot {
  readonly selected: boolean;
  readonly locked: boolean;
  readonly canCreate: boolean;
  readonly canReset: boolean;
  readonly canDelete: boolean;
  readonly canRasterize: boolean;
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly color: string;
  readonly transformType: VectorTextTransformType;
  readonly transformCurve: number;
  readonly circleRadiusPercent: number;
  readonly circleInverted: boolean;
  readonly distortEditing: boolean;
}

export interface VectorEffectEditorSnapshot {
  readonly locked: boolean;
  readonly outlineWidth: number;
  readonly outlineColor: string;
  readonly outlineJoin: VectorTextOutlineJoin;
  readonly singleShadowEnabled: boolean;
  readonly singleShadowColor: string;
  readonly singleShadowOpacity: number;
  readonly singleShadowOffset: number;
  readonly singleShadowAngle: number;
  readonly singleShadowBlur: number;
  readonly innerShadowEnabled: boolean;
  readonly innerShadowColor: string;
  readonly innerShadowOpacity: number;
  readonly innerShadowOffset: number;
  readonly innerShadowAngle: number;
  readonly innerShadowBlur: number;
  readonly blockShadowEnabled: boolean;
  readonly blockShadowColor: string;
  readonly blockShadowOpacity: number;
  readonly blockShadowOffset: number;
  readonly blockShadowAngle: number;
  readonly blockShadowOutlineWidth: number;
}

export interface VectorTransformActionSnapshot {
  readonly active: boolean;
  readonly canApply: boolean;
  readonly canCancel: boolean;
}
