import type { VectorTextNode } from "./scene-text-model";
import type { VectorSvgNode } from "./scene-svg-model";
import {
  vectorTextInnerShadowLocalVector,
  vectorTextSingleShadowLocalVector,
} from "./scene-vector-effects";
import { gpuLinearColor } from "./scene-gpu-paint";
import type { VectorSceneNode } from "./mixed-scene-node";
import type { VectorTextOutlineGeometry } from "./vector-text-font-geometry";
import type { VectorTextGpuMeshData } from "./vector-text-effect-geometry";
import type { VectorTextSlugData } from "./vector-text-slug";
import { planVectorTextSingleShadowBlur } from "./vector-text-single-shadow";
import type {
  VectorTextGpuDraw,
  VectorTextGpuGradient,
  VectorTextViewState,
} from "./vector-text-types";

export interface MixedSceneTextGeometry {
  readonly outlineKey: string;
  readonly outline: VectorTextOutlineGeometry;
  readonly sourceRevision: string;
  readonly slug: VectorTextSlugData;
}

export function planMixedSceneSvgBlurDraw(
  node: Readonly<VectorSvgNode>,
  sourceMesh: VectorTextGpuMeshData,
  view: VectorTextViewState,
  kind: "outer" | "inner",
): VectorTextGpuDraw {
  const blur = kind === "outer" ? node.singleShadowBlur : node.innerShadowBlur;
  const requestedPixelScale = Math.max(1 / 32, Math.abs(view.zoom * node.scale));
  const bucketScale = 2 ** Math.ceil(Math.log2(requestedPixelScale));
  const plan = planVectorTextSingleShadowBlur(node.document.bounds, blur, bucketScale);
  const vector = kind === "outer"
    ? vectorTextSingleShadowLocalVector(node.singleShadowOffset, node.singleShadowAngle)
    : vectorTextInnerShadowLocalVector(node.innerShadowOffset, node.innerShadowAngle);
  const blurKey = [
    "vector-svg-gpu-blur-v1",
    node.id,
    sourceMesh.revision,
    blur.toFixed(4),
    plan.width,
    plan.height,
    plan.scale.toFixed(8),
    plan.sigmaPixels.toFixed(8),
    plan.radius,
  ].join(":");
  const common = {
    meshKey: `svg:${node.id}:silhouette-fill`,
    mesh: sourceMesh,
    blurKey,
    blurBounds: [plan.bounds[0], plan.bounds[1], plan.bounds[2], plan.bounds[3]] as const,
    blurWidth: plan.width,
    blurHeight: plan.height,
    blurScale: plan.scale,
    blurSigmaPixels: plan.sigmaPixels,
    blurRadius: plan.radius,
    x: node.x,
    y: node.y,
    scale: node.scale,
    rotation: node.rotation,
  } as const;
  if (kind === "outer") {
    return {
      mode: "mesh-blur",
      ...common,
      localOffsetX: vector.x,
      localOffsetY: vector.y,
      color: gpuLinearColor(node.singleShadowColor),
      opacity: Math.min(1, Math.max(0, node.opacity * node.singleShadowOpacity)),
    };
  }
  return {
    mode: "mesh-inner-shadow-blur",
    ...common,
    localOffsetX: sourceMesh.originX,
    localOffsetY: sourceMesh.originY,
    sampleOffsetX: vector.x,
    sampleOffsetY: vector.y,
    color: gpuLinearColor(node.innerShadowColor),
    opacity: Math.min(1, Math.max(0, node.opacity * node.innerShadowOpacity)),
  };
}

export function planMixedSceneSlugDraw(
  node: Readonly<VectorTextNode>,
  meshKey: string,
  slug: VectorTextSlugData,
  color: string,
  opacity: number,
  localOffsetX = 0,
  localOffsetY = 0,
): VectorTextGpuDraw {
  return {
    mode: "slug-direct",
    meshKey,
    slug,
    x: node.x,
    y: node.y,
    scale: node.scale,
    rotation: node.rotation,
    localOffsetX: slug.originX + localOffsetX,
    localOffsetY: slug.originY + localOffsetY,
    color: gpuLinearColor(color),
    opacity: Math.min(1, Math.max(0, opacity)),
  };
}

export function planMixedSceneMeshDraw(
  node: Readonly<VectorSceneNode>,
  meshKey: string,
  mesh: VectorTextGpuMeshData,
  color: string,
  opacity: number,
  visualOffsetX = 0,
  visualOffsetY = 0,
  gradient?: VectorTextGpuGradient,
): VectorTextGpuDraw {
  return {
    mode: "mesh-direct",
    meshKey,
    mesh,
    x: node.x,
    y: node.y,
    scale: node.scale,
    rotation: node.rotation,
    localOffsetX: mesh.originX + visualOffsetX,
    localOffsetY: mesh.originY + visualOffsetY,
    color: gpuLinearColor(color),
    opacity: Math.min(1, Math.max(0, opacity)),
    gradient,
  };
}

export function planMixedSceneSlugBlurDraw(
  node: Readonly<VectorTextNode>,
  geometry: MixedSceneTextGeometry,
  view: VectorTextViewState,
): VectorTextGpuDraw {
  const requestedPixelScale = Math.max(1 / 32, Math.abs(view.zoom * node.scale));
  const bucketScale = 2 ** Math.ceil(Math.log2(requestedPixelScale));
  const plan = planVectorTextSingleShadowBlur(
    {
      left: geometry.outline.inkLeft,
      top: geometry.outline.inkTop,
      right: geometry.outline.inkRight,
      bottom: geometry.outline.inkBottom,
    },
    node.singleShadowBlur,
    bucketScale,
  );
  const vector = vectorTextSingleShadowLocalVector(
    node.singleShadowOffset,
    node.singleShadowAngle,
  );
  return {
    mode: "slug-blur",
    meshKey: `text:${node.id}:slug`,
    slug: geometry.slug,
    blurKey: [
      "vector-text-gpu-blur-v1",
      node.id,
      geometry.sourceRevision,
      node.singleShadowBlur.toFixed(4),
      plan.width,
      plan.height,
      plan.scale.toFixed(8),
      plan.sigmaPixels.toFixed(8),
      plan.radius,
    ].join(":"),
    blurBounds: [plan.bounds[0], plan.bounds[1], plan.bounds[2], plan.bounds[3]],
    blurWidth: plan.width,
    blurHeight: plan.height,
    blurScale: plan.scale,
    blurSigmaPixels: plan.sigmaPixels,
    blurRadius: plan.radius,
    x: node.x,
    y: node.y,
    scale: node.scale,
    rotation: node.rotation,
    localOffsetX: vector.x,
    localOffsetY: vector.y,
    color: gpuLinearColor(node.singleShadowColor),
    opacity: Math.min(1, Math.max(0, node.opacity * node.singleShadowOpacity)),
  };
}

export function planMixedSceneSlugInnerShadowDraw(
  node: Readonly<VectorTextNode>,
  geometry: MixedSceneTextGeometry,
  view: VectorTextViewState,
): VectorTextGpuDraw {
  const vector = vectorTextInnerShadowLocalVector(
    node.innerShadowOffset,
    node.innerShadowAngle,
  );
  const common = {
    meshKey: `text:${node.id}:slug`,
    slug: geometry.slug,
    x: node.x,
    y: node.y,
    scale: node.scale,
    rotation: node.rotation,
    localOffsetX: geometry.slug.originX,
    localOffsetY: geometry.slug.originY,
    sampleOffsetX: vector.x,
    sampleOffsetY: vector.y,
    color: gpuLinearColor(node.innerShadowColor),
    opacity: Math.min(1, Math.max(0, node.opacity * node.innerShadowOpacity)),
  } as const;
  if (node.innerShadowBlur <= 0) {
    return { mode: "slug-inner-shadow-direct", ...common };
  }
  const requestedPixelScale = Math.max(1 / 32, Math.abs(view.zoom * node.scale));
  const bucketScale = 2 ** Math.ceil(Math.log2(requestedPixelScale));
  const plan = planVectorTextSingleShadowBlur(
    {
      left: geometry.outline.inkLeft,
      top: geometry.outline.inkTop,
      right: geometry.outline.inkRight,
      bottom: geometry.outline.inkBottom,
    },
    node.innerShadowBlur,
    bucketScale,
  );
  return {
    mode: "slug-inner-shadow-blur",
    ...common,
    blurKey: [
      "vector-text-gpu-blur-v1",
      node.id,
      geometry.sourceRevision,
      node.innerShadowBlur.toFixed(4),
      plan.width,
      plan.height,
      plan.scale.toFixed(8),
      plan.sigmaPixels.toFixed(8),
      plan.radius,
    ].join(":"),
    blurBounds: [plan.bounds[0], plan.bounds[1], plan.bounds[2], plan.bounds[3]],
    blurWidth: plan.width,
    blurHeight: plan.height,
    blurScale: plan.scale,
    blurSigmaPixels: plan.sigmaPixels,
    blurRadius: plan.radius,
  };
}

export function retargetMixedSceneDraws(
  draws: readonly VectorTextGpuDraw[],
  node: Readonly<VectorSceneNode>,
): VectorTextGpuDraw[] {
  return draws.map((draw): VectorTextGpuDraw => ({
    ...draw,
    x: node.x,
    y: node.y,
    scale: node.scale,
    rotation: node.rotation,
  }));
}
