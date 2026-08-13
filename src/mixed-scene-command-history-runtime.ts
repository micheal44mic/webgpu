import type { VectorTextNodeSeed } from "./scene-text-model";
import type { VectorSvgNodeSeed } from "./scene-svg-model";
import type { VectorSvgDocument } from "./vector-svg-import.ts";
import type { MixedSceneHost } from "./mixed-scene-controller-contract";

export type MixedSceneTransformSessionKind = "vector" | "raster";

export function createMixedSceneDefaultTextSeed(
  documentWidth: number,
  documentHeight: number,
  index: number,
  colorOverride?: string,
): VectorTextNodeSeed {
  const color = colorOverride && /^#[0-9a-f]{6}$/i.test(colorOverride)
    ? colorOverride.toLowerCase()
    : index === 0
      ? "#111111"
      : "#f47c5d";
  return {
    text: index === 0 ? "STREETWEAR" : `TESTO ${index + 1}`,
    fontFamily: "Anton",
    fontSize: 360,
    color,
    transformType: "none",
    transformCurve: 80,
    circleRadiusPercent: 50,
    circleInverted: false,
    distortPoints: null,
    outlineWidth: 0,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: false,
    blockShadowColor: "#727272",
    blockShadowOpacity: 1,
    blockShadowOffset: 23,
    blockShadowAngle: -104,
    blockShadowOutlineWidth: 0,
    singleShadowEnabled: false,
    singleShadowColor: "#727272",
    singleShadowOpacity: 1,
    singleShadowOffset: 54,
    singleShadowAngle: -180,
    singleShadowBlur: 6,
    innerShadowEnabled: false,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0.65,
    innerShadowOffset: 12,
    innerShadowAngle: -135,
    innerShadowBlur: 12,
    x: documentWidth * 0.5 + index * 90,
    y: documentHeight * 0.5 + index * 110,
    scale: 1,
    rotation: 0,
  };
}

export function createMixedSceneDefaultSvgSeed(
  documentWidth: number,
  documentHeight: number,
  documentValue: VectorSvgDocument,
): VectorSvgNodeSeed {
  const longestSide = Math.max(1, documentValue.width, documentValue.height);
  return {
    document: documentValue,
    paintColors: documentValue.paints.map((paint) => paint.color),
    outlineWidth: 0,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: false,
    blockShadowColor: "#727272",
    blockShadowOpacity: 1,
    blockShadowOffset: 23,
    blockShadowAngle: -104,
    blockShadowOutlineWidth: 0,
    singleShadowEnabled: false,
    singleShadowColor: "#000000",
    singleShadowOpacity: 0.55,
    singleShadowOffset: 24,
    singleShadowAngle: -135,
    singleShadowBlur: 12,
    innerShadowEnabled: false,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0.55,
    innerShadowOffset: 12,
    innerShadowAngle: -135,
    innerShadowBlur: 12,
    x: documentWidth * 0.5,
    y: documentHeight * 0.5,
    scale: Math.min(2, 1200 / longestSide),
    rotation: 0,
  };
}

export async function runMixedSceneTransformHistoryAction(
  host: MixedSceneHost,
  kind: MixedSceneTransformSessionKind,
  action: "apply" | "cancel",
): Promise<void> {
  if (action === "apply") {
    if (kind === "raster") await host.commitRasterLayerTransform();
    else host.commitVectorHistoryEdit();
    return;
  }
  const cancelled = kind === "raster"
    ? await host.cancelRasterLayerTransform()
    : await host.cancelVectorHistoryEdit();
  if (!cancelled) {
    throw new Error("Nessuna trasformazione aperta da annullare.");
  }
}

export function beginMixedSceneVectorTransformHistory(host: MixedSceneHost): boolean {
  return host.beginVectorHistoryEdit("transform");
}
