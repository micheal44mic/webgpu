import type { BrushEngine } from "./brush-engine";
import { restoreColdStorageResources } from "./engine-cold-storage";
import {
  periodicCheckpointChainForReplay,
  periodicHistoryCheckpoints,
} from "./history-maintenance-runtime";
import type {
  HistoryHost,
  HistoryMaintenanceHost,
  HistoryRuntimeHost,
  HistoryStorageHost,
} from "./history-host";

/** The only module allowed to adapt live engine facilities to History storage. */
export function createEngineHistoryStorageHost(engine: BrushEngine): HistoryStorageHost {
  return {
    get device() {
      return engine.device;
    },
    get gpuStorage() {
      return engine.historyGpuStorage;
    },
    store: engine.history,
    get layerFormat() {
      return engine.layerFormat;
    },
    publishStatus: (message, kind) => engine.publishStatus(message, kind),
    waitForIdle: () => engine.waitForIdle(),
    waitForGpu: (label, timeoutMs) => engine.waitForGpuCapped(label, timeoutMs),
    onResidenceChanged: () => engine.historyStorageResidenceChanged(),
    resumeMaintenance: () => engine.resumeHistoryStorageMaintenance(),
    restoreColdStorage: (compressed, label) =>
      restoreColdStorageResources(engine, compressed, label),
    readColdStorageTiles: (cold, firstArrayLayer, arrayLayerCount, label) =>
      engine.readLayerColdStorageTiles(cold, firstArrayLayer, arrayLayerCount, label),
    compressionClient: () => engine.requireLayerColdCompressionClient(),
    periodicCheckpoints: () => periodicHistoryCheckpoints(engine),
    periodicCheckpointChain: (layerId, cursor) =>
      periodicCheckpointChainForReplay(engine, layerId, cursor),
  };
}

export function createEngineHistoryRuntimeHost(engine: BrushEngine): HistoryRuntimeHost {
  return {
    gateSnapshot: () => ({
      initialized: engine.initialized,
      historyBusy: engine.historyBusy,
      historyInconsistent: engine.historyStateInconsistent,
      layerSwitchBusy: engine.layerSwitchBusy,
      selectionBusy: engine.selectionBusy,
      activeStroke: engine.activeStroke !== null,
      openEdit: Boolean(
        engine.activeVectorHistoryEdit
        || engine.activeRasterLayerMetadataHistoryEdit
        || engine.activeRasterTransformSession
        || engine.activeRasterGaussianBlurSession
        || engine.activeRasterMotionBlurSession
        || engine.activeRasterNoiseSession
        || engine.activeRasterLiquifySession
      ),
      deviceLost: engine.deviceLostError !== null,
    }),
    waitForIdle: () => engine.waitForIdle(),
    publishHistoryState: () => engine.publishHistoryState(),
    publishStatus: (message, kind) => engine.publishStatus(message, kind),
    latchInconsistent: (message, cause) => engine.latchDocumentStateInconsistent(message, cause),
  };
}

export function createEngineHistoryMaintenanceHost(
  engine: BrushEngine,
): HistoryMaintenanceHost {
  return {
    canMaintain: () => engine.initialized
      && !engine.historyBusy
      && !engine.layerSwitchBusy
      && !engine.selectionBusy
      && engine.activeStroke === null
      && engine.deviceLostError === null,
    waitForIdle: () => engine.waitForIdle(),
    scheduleIdle: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelIdle: (handle) => window.clearTimeout(handle),
    yieldTurn: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
    onAccountingChanged: () => engine.publishStats(),
  };
}

export function createEngineHistoryHost(engine: BrushEngine): HistoryHost {
  return {
    runtime: createEngineHistoryRuntimeHost(engine),
    maintenance: createEngineHistoryMaintenanceHost(engine),
    storage: createEngineHistoryStorageHost(engine),
  };
}
