export const VECTOR_TEXT_OUTLINE_STRATEGY =
  "webgpu-clipper64-worker-outside-offset-aa-overlap1px-same-color-fused-round-bevel-miter4-v6" as const;

export const VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM = 0;
export const VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM = 100;
export const VECTOR_TEXT_OUTLINE_MITER_LIMIT = 4;

export type VectorTextOutlineJoin = "bevel" | "miter" | "round";

export const VECTOR_TEXT_BLOCK_SHADOW_STRATEGY =
  "webgpu-clipper64-worker-visible-swept-union-separate-clipped-overlap2px-mesh-v8" as const;
export const VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MAXIMUM = 180;

export const VECTOR_TEXT_SINGLE_SHADOW_STRATEGY =
  "webgpu-zero-blur-or-r16float-separable-adaptive-tent-v4" as const;
export const VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM = 0;
export const VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MAXIMUM = 100;
export const VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MINIMUM = -180;
export const VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MAXIMUM = 180;
export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM = 0;
export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM = 300;

export const VECTOR_TEXT_INNER_SHADOW_STRATEGY =
  "webgpu-analytic-fill-clip-zero-blur-or-r16float-adaptive-tent-v3" as const;

export function normalizeVectorTextOutlineWidth(width: number): number {
  const finite = Number.isFinite(width) ? width : VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM;
  return Math.min(
    VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
    Math.max(VECTOR_TEXT_OUTLINE_WIDTH_MINIMUM, finite),
  );
}

export function normalizeVectorTextOutlineJoin(
  join: VectorTextOutlineJoin,
): VectorTextOutlineJoin {
  return join === "bevel" || join === "miter" || join === "round"
    ? join
    : "round";
}

export function vectorTextOutlineLocalReach(
  width: number,
  join: VectorTextOutlineJoin,
): number {
  const outsideWidth = normalizeVectorTextOutlineWidth(width);
  return normalizeVectorTextOutlineJoin(join) === "miter"
    ? outsideWidth * VECTOR_TEXT_OUTLINE_MITER_LIMIT
    : outsideWidth;
}

export function normalizeVectorTextBlockShadowOpacity(opacity: number): number {
  const finite = Number.isFinite(opacity) ? opacity : 1;
  return Math.min(1, Math.max(0, finite));
}

export function normalizeVectorTextBlockShadowOffset(offset: number): number {
  const finite = Number.isFinite(offset)
    ? offset
    : VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM;
  return Math.min(
    VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MAXIMUM,
    Math.max(VECTOR_TEXT_BLOCK_SHADOW_OFFSET_MINIMUM, finite),
  );
}

export function normalizeVectorTextBlockShadowAngle(angle: number): number {
  const finite = Number.isFinite(angle) ? angle : 0;
  return Math.min(
    VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MAXIMUM,
    Math.max(VECTOR_TEXT_BLOCK_SHADOW_ANGLE_MINIMUM, finite),
  );
}

export function vectorTextBlockShadowLocalReach(
  _fontSize: number,
  offset: number,
): number {
  return normalizeVectorTextBlockShadowOffset(offset);
}

export function vectorTextBlockShadowLocalVector(
  fontSize: number,
  offset: number,
  angleDegrees: number,
): { x: number; y: number } {
  const reach = vectorTextBlockShadowLocalReach(fontSize, offset);
  const angleRadians = normalizeVectorTextBlockShadowAngle(angleDegrees)
    * Math.PI / 180;
  return {
    x: Math.cos(angleRadians) * reach,
    // UI angles are Cartesian; canvas Y grows downwards.
    y: -Math.sin(angleRadians) * reach,
  };
}

export function normalizeVectorTextSingleShadowOpacity(opacity: number): number {
  return normalizeVectorTextBlockShadowOpacity(opacity);
}

export function normalizeVectorTextSingleShadowOffset(offset: number): number {
  const finite = Number.isFinite(offset)
    ? offset
    : VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM;
  return Math.min(
    VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MAXIMUM,
    Math.max(VECTOR_TEXT_SINGLE_SHADOW_OFFSET_MINIMUM, finite),
  );
}

export function normalizeVectorTextSingleShadowAngle(angle: number): number {
  const finite = Number.isFinite(angle) ? angle : 0;
  return Math.min(
    VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MAXIMUM,
    Math.max(VECTOR_TEXT_SINGLE_SHADOW_ANGLE_MINIMUM, finite),
  );
}

export function normalizeVectorTextSingleShadowBlur(blur: number): number {
  const finite = Number.isFinite(blur)
    ? blur
    : VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM;
  return Math.min(
    VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
    Math.max(VECTOR_TEXT_SINGLE_SHADOW_BLUR_MINIMUM, finite),
  );
}

export function vectorTextSingleShadowLocalVector(
  offset: number,
  angleDegrees: number,
): { x: number; y: number } {
  const reach = normalizeVectorTextSingleShadowOffset(offset);
  const angleRadians = normalizeVectorTextSingleShadowAngle(angleDegrees)
    * Math.PI / 180;
  return {
    x: Math.cos(angleRadians) * reach,
    y: -Math.sin(angleRadians) * reach,
  };
}

export function normalizeVectorTextInnerShadowOpacity(opacity: number): number {
  return normalizeVectorTextSingleShadowOpacity(opacity);
}

export function normalizeVectorTextInnerShadowOffset(offset: number): number {
  return normalizeVectorTextSingleShadowOffset(offset);
}

export function normalizeVectorTextInnerShadowAngle(angle: number): number {
  return normalizeVectorTextSingleShadowAngle(angle);
}

export function normalizeVectorTextInnerShadowBlur(blur: number): number {
  return normalizeVectorTextSingleShadowBlur(blur);
}

export function vectorTextInnerShadowLocalVector(
  offset: number,
  angleDegrees: number,
): { x: number; y: number } {
  return vectorTextSingleShadowLocalVector(offset, angleDegrees);
}
