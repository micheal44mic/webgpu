/** Pure policy for the display-only mip transition retained by Noise layers. */

export const NOISE_MIP_SMOOTHING_STRATEGY =
  "active-noise-layer-existing-pyramid-continuous-lod-explicit-adjacent-blend" as const;

const LOD_BOUNDARY_EPSILON = 1e-6;

export interface PaintDisplayMipPlan {
  /** Legacy integer selected by every layer that has no committed Noise. */
  readonly legacyMipLevel: number;
  /** Highest existing logical mip that must be valid before presentation. */
  readonly requiredMipLevel: number;
  /** Fractional only for an eligible Noise layer; otherwise exactly legacyMipLevel. */
  readonly sampleLod: number;
  readonly smoothingActive: boolean;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Plans display sampling without allocating another texture or pyramid.
 *
 * The authoritative raster remains logical mip 0. When smoothing is active,
 * the renderer samples floor(sampleLod) and ceil(sampleLod) from the already
 * existing active-layer pyramid and mixes them. `requiredMipLevel` therefore
 * keeps the upper neighbour valid while all legacy layers continue to request
 * exactly the old floor-selected level.
 */
export function planPaintDisplayMips(
  zoom: number,
  mipLevelCount: number,
  smoothingEligible: boolean,
): PaintDisplayMipPlan {
  const maximumMipLevel = Math.max(0, Math.floor(mipLevelCount) - 1);
  const finiteZoom = zoom > 0 ? zoom : Number.EPSILON;
  const continuousLod = clamp(
    !Number.isFinite(zoom) || finiteZoom >= 1
      ? 0
      : Math.log2(1 / Math.max(finiteZoom, Number.EPSILON)),
    0,
    maximumMipLevel,
  );
  const legacyMipLevel = clamp(
    Math.floor(continuousLod + LOD_BOUNDARY_EPSILON),
    0,
    maximumMipLevel,
  );
  if (!smoothingEligible) {
    return {
      legacyMipLevel,
      requiredMipLevel: legacyMipLevel,
      sampleLod: legacyMipLevel,
      smoothingActive: false,
    };
  }
  const requiredMipLevel = clamp(
    Math.ceil(continuousLod - LOD_BOUNDARY_EPSILON),
    legacyMipLevel,
    maximumMipLevel,
  );
  return {
    legacyMipLevel,
    requiredMipLevel,
    sampleLod: continuousLod,
    smoothingActive: true,
  };
}

export interface NoiseMipHistoryActionLike {
  readonly kind: string;
  readonly layerId?: number;
  readonly filter?: string;
  readonly baseBounds?: unknown;
}

/**
 * Reconstructs the tiny display-policy bit from the visible journal prefix.
 * This keeps Undo/Redo exact without retaining pixel masks or another history
 * payload. A destructive clear/replacement starts a new raster lineage; later
 * paint and filters preserve the bit, while a committed Noise turns it on.
 */
export function noiseMipSmoothingAfterHistory(
  actions: readonly NoiseMipHistoryActionLike[],
  cursor: number,
  layerId: number,
): boolean {
  const end = Math.max(0, Math.min(Math.floor(cursor), actions.length));
  let enabled = false;
  for (let index = 0; index < end; index += 1) {
    const action = actions[index];
    if (action.layerId !== layerId) continue;
    if (
      action.kind === "clear"
      || action.kind === "vector-rasterize"
      || action.kind === "raster-import"
    ) {
      enabled = false;
      continue;
    }
    if (action.kind === "raster-filter" && action.filter === "noise") {
      enabled = true;
    }
  }
  return enabled;
}
