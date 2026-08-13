import type { HistoryAction, HistoryRenderBatch, SelectionHistoryMaskSnapshot } from "./engine-history-types";
import type { LayerColdCompressionClient } from "./layer-cold-compression-client";
import type {
  LayerColdStorageResources,
  LayerCompressedColdStorageResources,
} from "./engine-layer-resources";
import type { LayerFormat } from "./engine-types";
import type { GpuHistoryStorage } from "./gpu-history-storage";
import type { PeriodicRasterHistoryCheckpoint } from "./history-checkpoint-types.ts";
import type { PeriodicHistoryReplaySelection } from "./history-replay-plan";

/** Internal read/ownership port shared by retention and disposable storage. */
export interface HistoryStoreReadPort {
  readonly actions: HistoryAction[];
  readonly cursor: number;
  readonly batches: HistoryRenderBatch[];
  readonly selectionMasksByAction: Map<number, SelectionHistoryMaskSnapshot>;
  readonly selectionMasksByRevision: Map<number, SelectionHistoryMaskSnapshot>;
  readonly selectionClipBindGroups: Map<number, GPUBindGroup>;
}

/**
 * Engine adapter consumed by the disposable IDB/OPFS cache. Project storage is
 * intentionally absent: History cache can be evicted without touching a saved
 * document.
 */
export interface HistoryStorageHost {
  readonly device: GPUDevice;
  readonly gpuStorage: GpuHistoryStorage;
  readonly store: HistoryStoreReadPort;
  readonly layerFormat: LayerFormat;
  publishStatus(message: string, kind: "working" | "ok" | "error"): void;
  waitForIdle(): Promise<void>;
  waitForGpu(label: string, timeoutMs: number): Promise<void>;
  onResidenceChanged(): void;
  resumeMaintenance(): void;
  restoreColdStorage(
    compressed: LayerCompressedColdStorageResources,
    label: string,
  ): Promise<LayerColdStorageResources>;
  readColdStorageTiles(
    cold: LayerColdStorageResources,
    firstArrayLayer: number,
    arrayLayerCount: number,
    label: string,
  ): Promise<Uint8Array>;
  compressionClient(): Promise<LayerColdCompressionClient>;
  periodicCheckpoints(): readonly PeriodicRasterHistoryCheckpoint[];
  periodicCheckpointChain(
    layerId: number,
    cursor: number,
  ): PeriodicHistoryReplaySelection | null;
}

export interface HistoryGateSnapshot {
  readonly initialized: boolean;
  readonly historyBusy: boolean;
  readonly historyInconsistent: boolean;
  readonly layerSwitchBusy: boolean;
  readonly selectionBusy: boolean;
  readonly activeStroke: boolean;
  readonly openEdit: boolean;
  readonly deviceLost: boolean;
}

/** Coarse replay operations; renderers and live scene objects stay behind it. */
export interface HistoryRuntimeHost {
  gateSnapshot(): HistoryGateSnapshot;
  waitForIdle(): Promise<void>;
  publishHistoryState(): void;
  publishStatus(message: string, kind: "working" | "ok" | "error"): void;
  latchInconsistent(message: string, cause?: unknown): void;
}

/** Scheduling/fence boundary used by checkpoint capture and accounting. */
export interface HistoryMaintenanceHost {
  canMaintain(): boolean;
  waitForIdle(): Promise<void>;
  scheduleIdle(callback: () => void, delayMs: number): number;
  cancelIdle(handle: number): void;
  yieldTurn(): Promise<void>;
  onAccountingChanged(): void;
}

export interface HistoryHost {
  readonly runtime: HistoryRuntimeHost;
  readonly maintenance: HistoryMaintenanceHost;
  readonly storage: HistoryStorageHost;
}
