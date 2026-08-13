import type { LayerColdStorageResources } from "./engine-layer-resources.ts";
import type { DirtyRect } from "./engine-stroke-types.ts";

/** Disposable replay checkpoint owned by History, never by project storage. */
export interface PeriodicRasterHistoryCheckpoint {
  readonly id: number;
  readonly layerId: number;
  readonly afterActionId: number;
  readonly parentId: number | null;
  readonly kind: "full" | "delta" | "blank";
  seed: LayerColdStorageResources | null;
  readonly baseBounds: DirtyRect | null;
  readonly baseTileMask: Uint32Array;
  readonly memoryBytes: number;
}
