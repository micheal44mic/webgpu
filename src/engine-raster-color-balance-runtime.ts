/** Transactional destructive Color Balance for the selected native raster. */

import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  isRasterColorBalanceIdentity,
  normalizeRasterColorBalanceSettings,
  rasterColorBalanceSettingsEqual,
  type RasterColorBalanceSettingsInput,
  type RasterColorBalanceSettings,
} from "./raster-color-balance-core.ts";
import {
  rasterColorBalanceDispatchSize,
  rasterColorBalanceShader,
} from "./raster-color-balance-shaders.ts";

export const DESTRUCTIVE_RASTER_COLOR_BALANCE_RUNTIME_BUILD =
  "destructive-raster-color-balance-webgpu-v1-immutable-crop-latest-wins" as const;
export const DESTRUCTIVE_RASTER_COLOR_BALANCE_ALGORITHM =
  "tonal-channel-balance-v1" as const;
export const DESTRUCTIVE_RASTER_COLOR_BALANCE_ALGORITHM_VERSION = 1 as const;
export const DESTRUCTIVE_RASTER_COLOR_BALANCE_PRECISION =
  "rgba16float-source-and-output-f32-tonal-balance" as const;
export const DESTRUCTIVE_RASTER_COLOR_BALANCE_COLOR_SPACE =
  "straight-encoded-rgb" as const;
export const DESTRUCTIVE_RASTER_COLOR_BALANCE_ALPHA_MODE = "preserve" as const;
export const DESTRUCTIVE_RASTER_COLOR_BALANCE_BOUNDS_MODE = "preserve" as const;

const BYTES_PER_RGBA16F_PIXEL = 8;
const RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE = 80;

interface RasterColorBalanceSharedResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
}

export interface RasterColorBalanceSnapshot {
  readonly layerId: number;
  readonly settings: Readonly<RasterColorBalanceSettings>;
  readonly sourceBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterColorBalanceSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly shared: RasterColorBalanceSharedResources;
  readonly memoryBytes: number;
  settings: RasterColorBalanceSettings;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

export type RasterColorBalanceEngineHost = BrushEngine & {
  activeRasterColorBalanceSession: ActiveRasterColorBalanceSession | null;
};

const sharedByDevice = new WeakMap<GPUDevice, Promise<RasterColorBalanceSharedResources>>();

async function createSharedResources(
  device: GPUDevice,
): Promise<RasterColorBalanceSharedResources> {
  return runGpuAllocationTransaction(device, "Raster color balance pipeline", async () => {
    const module = device.createShaderModule({
      label: "Raster color balance WGSL",
      code: rasterColorBalanceShader,
    });
    await assertShaderCompiled(module, "Raster color balance");
    const bindGroupLayout = device.createBindGroupLayout({
      label: "Raster color balance layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "uniform",
            minBindingSize: RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE,
          },
        },
      ],
    });
    const pipeline = device.createComputePipeline({
      label: "Raster color balance pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module, entryPoint: "balanceRasterColor" },
    });
    return { bindGroupLayout, pipeline };
  });
}

async function requireSharedResources(
  device: GPUDevice,
): Promise<RasterColorBalanceSharedResources> {
  let promise = sharedByDevice.get(device);
  if (!promise) {
    promise = createSharedResources(device);
    sharedByDevice.set(device, promise);
  }
  try {
    return await promise;
  } catch (error) {
    sharedByDevice.delete(device);
    throw error;
  }
}

export async function prewarmRasterColorBalanceRuntime(device: GPUDevice): Promise<void> {
  await requireSharedResources(device);
}

function runtimeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copySettings(
  settings: Readonly<RasterColorBalanceSettings>,
): RasterColorBalanceSettings {
  return normalizeRasterColorBalanceSettings(settings);
}

function snapshot(session: ActiveRasterColorBalanceSession): RasterColorBalanceSnapshot {
  return {
    layerId: session.layerId,
    settings: copySettings(session.settings),
    sourceBounds: { ...session.sourceBounds },
    memoryBytes: session.memoryBytes,
  };
}

function requireActiveLayer(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
) {
  const record = engine.layerStack.active;
  if (record.id !== session.layerId) {
    throw new Error("The active raster changed while Color Balance was open.");
  }
  return record;
}

function setAuthoritativeMetadata(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
): void {
  const record = requireActiveLayer(engine, session);
  const bounds = session.sourceBounds;
  engine.layerContentBounds = { ...bounds };
  engine.layerHasContent = true;
  record.contentBounds = { ...bounds };
  record.hasContent = true;
  record.storageTileMask.set(session.sourceTileMask);
  invalidateActiveLayerBake(engine);
}

function destroySessionResources(session: ActiveRasterColorBalanceSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.parameterBuffer.destroy();
}

export function abandonRasterColorBalanceSession(
  engine: RasterColorBalanceEngineHost,
): boolean {
  const session = engine.activeRasterColorBalanceSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterColorBalanceSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function packedParameters(
  bounds: DirtyRect,
  settings: Readonly<RasterColorBalanceSettings>,
): ArrayBuffer {
  const buffer = new ArrayBuffer(RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, bounds.x, true);
  view.setUint32(4, bounds.y, true);
  const writeTone = (
    offset: number,
    tone: Readonly<RasterColorBalanceSettings["midtones"]>,
  ): void => {
    view.setFloat32(offset, tone.cyanRedPercent / 100, true);
    view.setFloat32(offset + 4, tone.magentaGreenPercent / 100, true);
    view.setFloat32(offset + 8, tone.yellowBluePercent / 100, true);
  };
  writeTone(16, settings.shadows);
  writeTone(32, settings.midtones);
  writeTone(48, settings.highlights);
  view.setFloat32(64, settings.preserveLuminosity ? 1 : 0, true);
  return buffer;
}

function encodeRequestedPreview(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
  serial: number,
  settings: RasterColorBalanceSettings,
): void {
  if (engine.activeRasterColorBalanceSession !== session) return;
  if (session.encodedSerial === serial) return;
  requireActiveLayer(engine, session);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Raster color balance preview layer ${session.layerId}`,
  });
  if (isRasterColorBalanceIdentity(settings)) {
    encoder.copyTextureToTexture(
      { texture: session.sourceTexture },
      { texture: engine.layerTexture, origin: { x: bounds.x, y: bounds.y, z: 0 } },
      { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
    );
  } else {
    engine.device.queue.writeBuffer(
      session.parameterBuffer,
      0,
      packedParameters(bounds, settings),
    );
    const dispatch = rasterColorBalanceDispatchSize(bounds.width, bounds.height);
    const pass = encoder.beginComputePass({ label: "Raster color balance pass" });
    pass.setPipeline(session.shared.pipeline);
    pass.setBindGroup(0, session.bindGroup);
    pass.dispatchWorkgroups(dispatch.x, dispatch.y);
    pass.end();
  }
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session);
  engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  setAuthoritativeMetadata(engine, session);
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterColorBalanceSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) return Promise.resolve();
  const serial = session.requestedSerial;
  const settings = copySettings(session.settings);
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, settings);
      await engine.waitForGpuCapped("Raster color balance preview", 60_000);
    } catch (error) {
      session.previewFault = runtimeError(error);
      if (engine.activeRasterColorBalanceSession === session) {
        engine.publishStatus(
          `Color Balance preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterColorBalanceSession === session
        && !session.terminal
        && !session.previewFault
        && session.encodedSerial !== session.requestedSerial
      ) schedulePreview(engine, session);
    }
  });
  session.previewInFlight = completion;
  return completion;
}

function schedulePreview(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterColorBalanceSession !== session
      || session.terminal
      || session.previewFault
    ) return;
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  for (;;) {
    if (session.previewFault) throw session.previewFault;
    if (session.encodedSerial === session.requestedSerial && !session.previewInFlight) return;
    await startPreviewSubmission(engine, session);
  }
}

async function restoreOriginalPixels(
  engine: RasterColorBalanceEngineHost,
  session: ActiveRasterColorBalanceSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;
  requireActiveLayer(engine, session);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Restore raster color source layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    { texture: engine.layerTexture, origin: { x: bounds.x, y: bounds.y, z: 0 } },
    { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, session);
  await engine.waitForGpuCapped("Restore raster color source", 60_000);
  if (presentationError) throw presentationError;
}

async function allocateSession(
  engine: RasterColorBalanceEngineHost,
  recordId: number,
  authoritativeTexture: GPUTexture,
  authoritativeView: GPUTextureView,
  sourceBounds: DirtyRect,
  sourceTileMask: Uint32Array,
  settings: RasterColorBalanceSettings,
  shared: RasterColorBalanceSharedResources,
): Promise<ActiveRasterColorBalanceSession> {
  return runGpuAllocationTransaction(
    engine.device,
    `Allocate raster color balance layer ${recordId}`,
    async (transaction): Promise<ActiveRasterColorBalanceSession> => {
      const sourceTexture = engine.device.createTexture({
        label: `Raster color immutable source layer ${recordId}`,
        size: {
          width: sourceBounds.width,
          height: sourceBounds.height,
          depthOrArrayLayers: 1,
        },
        format: "rgba16float",
        usage:
          GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      transaction.deferRollback(() => sourceTexture.destroy());
      const sourceView = sourceTexture.createView({
        label: "Raster color immutable source view",
      });
      const parameterBuffer = engine.device.createBuffer({
        label: "Raster color balance parameters",
        size: RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => parameterBuffer.destroy());
      const bindGroup = engine.device.createBindGroup({
        label: "Raster color balance bind group",
        layout: shared.bindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: authoritativeView },
          {
            binding: 2,
            resource: {
              buffer: parameterBuffer,
              offset: 0,
              size: RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE,
            },
          },
        ],
      });
      const encoder = engine.device.createCommandEncoder({
        label: `Capture raster color source layer ${recordId}`,
      });
      encoder.copyTextureToTexture(
        {
          texture: authoritativeTexture,
          origin: { x: sourceBounds.x, y: sourceBounds.y, z: 0 },
        },
        { texture: sourceTexture },
        { width: sourceBounds.width, height: sourceBounds.height, depthOrArrayLayers: 1 },
      );
      engine.device.queue.submit([encoder.finish()]);
      await engine.waitForGpuCapped("Prepare Color Balance", 60_000);
      return {
        layerId: recordId,
        sourceBounds,
        sourceTileMask,
        sourceTexture,
        sourceView,
        parameterBuffer,
        bindGroup,
        shared,
        memoryBytes:
          sourceBounds.width * sourceBounds.height * BYTES_PER_RGBA16F_PIXEL
          + RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE,
        settings,
        requestedSerial: 1,
        encodedSerial: 0,
        previewFrame: null,
        previewInFlight: null,
        previewFault: null,
        terminal: false,
        destroyed: false,
      };
    },
  );
}

export async function beginRasterColorBalance(
  engine: RasterColorBalanceEngineHost,
  initial: RasterColorBalanceSettingsInput = DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
): Promise<RasterColorBalanceSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterColorBalanceSession) return snapshot(engine.activeRasterColorBalanceSession);
  const activeEdit = engine.activeDestructiveRasterEditKind();
  if (activeEdit) {
    throw new Error(
      `Apply or cancel ${engine.destructiveRasterEditLabel(activeEdit)} `
      + "before opening Color Balance.",
    );
  }
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("The selected raster does not match the active layer.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Color Balance works on the entire layer: deselect the pixels before opening it.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Destructive Color Balance requires an RGBA16F document.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterColorBalanceSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The raster's hot texture for Color Balance is missing.");
    const sourceBounds = { ...record.contentBounds };
    const dispatch = rasterColorBalanceDispatchSize(sourceBounds.width, sourceBounds.height);
    const maximumGroups = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (dispatch.x > maximumGroups || dispatch.y > maximumGroups) {
      throw new Error("Color Balance: the GPU does not support the required dispatch size.");
    }
    const settings = normalizeRasterColorBalanceSettings(initial);
    const shared = await requireSharedResources(engine.device);
    session = await allocateSession(
      engine,
      record.id,
      hot.texture,
      hot.view,
      sourceBounds,
      record.storageTileMask.slice(),
      settings,
      shared,
    );
    engine.activeRasterColorBalanceSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus("Color Balance preview is live.", "ok");
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterColorBalanceSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Color Balance startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterColorBalanceSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Color Balance startup failed: ${runtimeError(error).message}; `
        + `recovery failed: ${runtimeError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterColorBalance(
  engine: RasterColorBalanceEngineHost,
  update: RasterColorBalanceSettingsInput,
): RasterColorBalanceSnapshot {
  const session = engine.activeRasterColorBalanceSession;
  if (!session) throw new Error("No Color Balance session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Color Balance preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Color Balance is already finishing.");
  const settings = normalizeRasterColorBalanceSettings(update, session.settings);
  if (rasterColorBalanceSettingsEqual(settings, session.settings)) return snapshot(session);
  session.settings = settings;
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus("Color Balance preview…", "working");
  return snapshot(session);
}

export async function cancelRasterColorBalance(
  engine: RasterColorBalanceEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterColorBalanceSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Color Balance is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Color Balance cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterColorBalanceSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Color Balance canceled: the original pixels were restored.", "ok");
  return true;
}

export async function commitRasterColorBalance(
  engine: RasterColorBalanceEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterColorBalanceSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Color Balance preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Color Balance is already finishing.");
  if (isRasterColorBalanceIdentity(session.settings)) {
    await cancelRasterColorBalance(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    await flushPreview(engine, session);
    const record = requireActiveLayer(engine, session);
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("The raster's hot texture with Color Balance is missing.");
    seed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.sourceTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "color-balance",
      settings: copySettings(session.settings),
      algorithm: DESTRUCTIVE_RASTER_COLOR_BALANCE_ALGORITHM,
      algorithmVersion: DESTRUCTIVE_RASTER_COLOR_BALANCE_ALGORITHM_VERSION,
      precision: DESTRUCTIVE_RASTER_COLOR_BALANCE_PRECISION,
      colorSpace: DESTRUCTIVE_RASTER_COLOR_BALANCE_COLOR_SPACE,
      alphaMode: DESTRUCTIVE_RASTER_COLOR_BALANCE_ALPHA_MODE,
      boundsMode: DESTRUCTIVE_RASTER_COLOR_BALANCE_BOUNDS_MODE,
      seed,
      baseBounds: { ...session.sourceBounds },
      baseTileMask: session.sourceTileMask.slice(),
    };
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    if (engine.activeStrokeProfile) engine.activeStrokeProfile.historyCommittedActions += 1;
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Color Balance commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      throw new Error(
        `Color Balance commit failed: ${runtimeError(error).message}; `
        + `rollback failed: ${runtimeError(rollbackError).message}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterColorBalanceSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus("Color Balance applied to the pixels: one Undo step.", "ok");
  return true;
}
