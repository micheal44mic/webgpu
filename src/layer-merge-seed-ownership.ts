import type {
  LayerColdStorageResources,
  LayerGpuResources,
} from "./engine-layer-resources";

/**
 * A cold-only input stays live while the replacement is prepared. The merge
 * action borrows that exact seed until the structural detach begins; clearing
 * `gpu.cold` earlier would leave a visible input with no pixel authority while
 * the temporary input+output scene is rebuilt.
 */
export function borrowLayerMergeColdSeed(
  gpu: LayerGpuResources,
): LayerColdStorageResources | null {
  return gpu.cold;
}

/** Moves a borrowed cold authority from the live GPU record to History. */
export function transferBorrowedLayerMergeColdSeedForDetach(
  gpu: LayerGpuResources,
  seed: LayerColdStorageResources | null,
): boolean {
  if (!seed || gpu.cold !== seed) return false;
  gpu.cold = null;
  return true;
}

/**
 * Compensates a detach that failed before removing the live layer. Never
 * overwrites another authority that the failure path may already have built.
 */
export function restoreBorrowedLayerMergeColdSeedAfterDetachFailure(
  gpu: LayerGpuResources,
  seed: LayerColdStorageResources | null,
): boolean {
  if (!seed || gpu.hot || gpu.cold || gpu.compressed) return false;
  gpu.cold = seed;
  return true;
}

export function layerMergeColdSeedIsLiveAuthority(
  gpu: LayerGpuResources | null | undefined,
  seed: LayerColdStorageResources | null,
): boolean {
  return Boolean(gpu && seed && gpu.cold === seed);
}
