/** Transactional destructive Color Adjust for the selected native raster. */

import type { BrushEngine } from "./brush-engine";
import type { DocumentStorageColorSpace, LayerFormat } from "./engine-types";
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
  DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
  isRasterColorAdjustIdentity,
  normalizeRasterColorAdjustSettings,
  rasterColorAdjustSettingsEqual,
  type RasterColorAdjustSettings,
} from "./raster-color-adjust-core.ts";
import {
  createRasterColorAdjustShader,
  rasterColorAdjustDispatchSize,
} from "./raster-color-adjust-shaders.ts";
import {
  rasterAdjustmentBytesPerPixel,
  rasterAdjustmentStorageProfileKey,
  type RasterAdjustmentStorageProfile,
} from "./raster-adjustment-storage-shader";

export const DESTRUCTIVE_RASTER_COLOR_ADJUST_RUNTIME_BUILD =
  "destructive-raster-color-adjust-webgpu-v2-dual-storage-adjacent-code" as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_ALGORITHM =
  "hsv-relative-adjust-v1" as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_ALGORITHM_VERSION = 1 as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_PRECISION =
  "rgba16float-source-and-output-f32-hsv" as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_RGBA8_PRECISION =
  "rgba8unorm-encoded-srgb-source-and-output-f32-hsv-high-frequency-output" as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_COLOR_SPACE =
  "straight-encoded-rgb" as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_ALPHA_MODE = "preserve" as const;
export const DESTRUCTIVE_RASTER_COLOR_ADJUST_BOUNDS_MODE = "preserve" as const;

const RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE = 32;

interface RasterColorAdjustSharedResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
}

export interface RasterColorAdjustSnapshot {
  readonly layerId: number;
  readonly settings: Readonly<RasterColorAdjustSettings>;
  readonly sourceBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterColorAdjustSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly shared: RasterColorAdjustSharedResources;
  readonly quantizationSeed: number;
  readonly memoryBytes: number;
  settings: RasterColorAdjustSettings;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

export type RasterColorAdjustEngineHost = BrushEngine & {
  activeRasterColorAdjustSession: ActiveRasterColorAdjustSession | null;
};

const sharedByDevice = new WeakMap<
  GPUDevice,
  Map<string, Promise<RasterColorAdjustSharedResources>>
>();

async function createSharedResources(
  device: GPUDevice,
  profile: RasterAdjustmentStorageProfile,
): Promise<RasterColorAdjustSharedResources> {
  return runGpuAllocationTransaction(device, "Raster color adjust pipeline", async () => {
    const module = device.createShaderModule({
      label: "Raster color adjust WGSL",
      code: createRasterColorAdjustShader(profile),
    });
    await assertShaderCompiled(module, "Raster color adjust");
    const bindGroupLayout = device.createBindGroupLayout({
      label: "Raster color adjust layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: profile.layerFormat },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "uniform",
            minBindingSize: RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE,
          },
        },
      ],
    });
    const pipeline = device.createComputePipeline({
      label: "Raster color adjust pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module, entryPoint: "adjustRasterColor" },
    });
    return { bindGroupLayout, pipeline };
  });
}

async function requireSharedResources(
  device: GPUDevice,
  profile: RasterAdjustmentStorageProfile,
): Promise<RasterColorAdjustSharedResources> {
  let profiles = sharedByDevice.get(device);
  if (!profiles) {
    profiles = new Map();
    sharedByDevice.set(device, profiles);
  }
  const key = rasterAdjustmentStorageProfileKey(profile);
  let promise = profiles.get(key);
  if (!promise) {
    promise = createSharedResources(device, profile);
    profiles.set(key, promise);
  }
  try {
    return await promise;
  } catch (error) {
    profiles.delete(key);
    throw error;
  }
}

export async function prewarmRasterColorAdjustRuntime(
  device: GPUDevice,
  layerFormat: LayerFormat = "rgba16float",
  colorSpace: DocumentStorageColorSpace = "linear-premultiplied",
): Promise<void> {
  await requireSharedResources(device, { layerFormat, colorSpace });
}

function runtimeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copySettings(
  settings: Readonly<RasterColorAdjustSettings>,
): RasterColorAdjustSettings {
  return Object.freeze({ ...settings });
}

function snapshot(session: ActiveRasterColorAdjustSession): RasterColorAdjustSnapshot {
  return {
    layerId: session.layerId,
    settings: copySettings(session.settings),
    sourceBounds: { ...session.sourceBounds },
    memoryBytes: session.memoryBytes,
  };
}

function requireActiveLayer(
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
) {
  const record = engine.layerStack.active;
  if (record.id !== session.layerId) {
    throw new Error("The active raster changed while Color Adjust was open.");
  }
  return record;
}

function setAuthoritativeMetadata(
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
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

function destroySessionResources(session: ActiveRasterColorAdjustSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.parameterBuffer.destroy();
}

export function abandonRasterColorAdjustSession(
  engine: RasterColorAdjustEngineHost,
): boolean {
  const session = engine.activeRasterColorAdjustSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterColorAdjustSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function packedParameters(
  bounds: DirtyRect,
  settings: Readonly<RasterColorAdjustSettings>,
  quantizationSeed: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, bounds.x, true);
  view.setUint32(4, bounds.y, true);
  view.setUint32(8, quantizationSeed >>> 0, true);
  view.setFloat32(16, settings.hueDegrees / 360, true);
  view.setFloat32(20, settings.saturationPercent / 100, true);
  view.setFloat32(24, settings.brightnessPercent / 100, true);
  return buffer;
}

function encodeRequestedPreview(
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
  serial: number,
  settings: RasterColorAdjustSettings,
): void {
  if (engine.activeRasterColorAdjustSession !== session) return;
  if (session.encodedSerial === serial) return;
  requireActiveLayer(engine, session);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Raster color adjust preview layer ${session.layerId}`,
  });
  if (isRasterColorAdjustIdentity(settings)) {
    encoder.copyTextureToTexture(
      { texture: session.sourceTexture },
      { texture: engine.layerTexture, origin: { x: bounds.x, y: bounds.y, z: 0 } },
      { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
    );
  } else {
    engine.device.queue.writeBuffer(
      session.parameterBuffer,
      0,
      packedParameters(bounds, settings, session.quantizationSeed),
    );
    const dispatch = rasterColorAdjustDispatchSize(bounds.width, bounds.height);
    const pass = encoder.beginComputePass({ label: "Raster color adjust pass" });
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
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterColorAdjustSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) return Promise.resolve();
  const serial = session.requestedSerial;
  const settings = copySettings(session.settings);
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, settings);
      await engine.waitForGpuCapped("Raster color adjust preview", 60_000);
    } catch (error) {
      session.previewFault = runtimeError(error);
      if (engine.activeRasterColorAdjustSession === session) {
        engine.publishStatus(
          `Color Adjust preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterColorAdjustSession === session
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
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterColorAdjustSession !== session
      || session.terminal
      || session.previewFault
    ) return;
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
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
  engine: RasterColorAdjustEngineHost,
  session: ActiveRasterColorAdjustSession,
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
  engine: RasterColorAdjustEngineHost,
  recordId: number,
  authoritativeTexture: GPUTexture,
  authoritativeView: GPUTextureView,
  sourceBounds: DirtyRect,
  sourceTileMask: Uint32Array,
  settings: RasterColorAdjustSettings,
  shared: RasterColorAdjustSharedResources,
): Promise<ActiveRasterColorAdjustSession> {
  const quantizationSeed = engine.nextHistoryActionId >>> 0;
  return runGpuAllocationTransaction(
    engine.device,
    `Allocate raster color adjust layer ${recordId}`,
    async (transaction): Promise<ActiveRasterColorAdjustSession> => {
      const sourceTexture = engine.device.createTexture({
        label: `Raster color immutable source layer ${recordId}`,
        size: {
          width: sourceBounds.width,
          height: sourceBounds.height,
          depthOrArrayLayers: 1,
        },
        format: engine.layerFormat,
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
        label: "Raster color adjust parameters",
        size: RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => parameterBuffer.destroy());
      const bindGroup = engine.device.createBindGroup({
        label: "Raster color adjust bind group",
        layout: shared.bindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: authoritativeView },
          {
            binding: 2,
            resource: {
              buffer: parameterBuffer,
              offset: 0,
              size: RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE,
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
      await engine.waitForGpuCapped("Prepare Color Adjust", 60_000);
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
          sourceBounds.width * sourceBounds.height
            * rasterAdjustmentBytesPerPixel(engine.layerFormat)
          + RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE,
        quantizationSeed,
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

export async function beginRasterColorAdjust(
  engine: RasterColorAdjustEngineHost,
  initial: Partial<RasterColorAdjustSettings> = DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
): Promise<RasterColorAdjustSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterColorAdjustSession) return snapshot(engine.activeRasterColorAdjustSession);
  const activeEdit = engine.activeDestructiveRasterEditKind();
  if (activeEdit) {
    throw new Error(
      `Apply or cancel ${engine.destructiveRasterEditLabel(activeEdit)} `
      + "before opening Color Adjust.",
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
      "Color Adjust works on the entire layer: deselect the pixels before opening it.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterColorAdjustSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The raster's hot texture for Color Adjust is missing.");
    const sourceBounds = { ...record.contentBounds };
    const dispatch = rasterColorAdjustDispatchSize(sourceBounds.width, sourceBounds.height);
    const maximumGroups = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (dispatch.x > maximumGroups || dispatch.y > maximumGroups) {
      throw new Error("Color Adjust: the GPU does not support the required dispatch size.");
    }
    const settings = normalizeRasterColorAdjustSettings(initial);
    const shared = await requireSharedResources(engine.device, {
      layerFormat: engine.layerFormat,
      colorSpace: engine.documentStorageColorSpace,
    });
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
    engine.activeRasterColorAdjustSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus("Color Adjust preview is live.", "ok");
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterColorAdjustSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Color Adjust startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterColorAdjustSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Color Adjust startup failed: ${runtimeError(error).message}; `
        + `recovery failed: ${runtimeError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterColorAdjust(
  engine: RasterColorAdjustEngineHost,
  update: Partial<RasterColorAdjustSettings>,
): RasterColorAdjustSnapshot {
  const session = engine.activeRasterColorAdjustSession;
  if (!session) throw new Error("No Color Adjust session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Color Adjust preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Color Adjust is already finishing.");
  const settings = normalizeRasterColorAdjustSettings(update, session.settings);
  if (rasterColorAdjustSettingsEqual(settings, session.settings)) return snapshot(session);
  session.settings = settings;
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus("Color Adjust preview…", "working");
  return snapshot(session);
}

export async function cancelRasterColorAdjust(
  engine: RasterColorAdjustEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterColorAdjustSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Color Adjust is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Color Adjust cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterColorAdjustSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Color Adjust canceled: the original pixels were restored.", "ok");
  return true;
}

export async function commitRasterColorAdjust(
  engine: RasterColorAdjustEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterColorAdjustSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Color Adjust preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Color Adjust is already finishing.");
  if (isRasterColorAdjustIdentity(session.settings)) {
    await cancelRasterColorAdjust(engine);
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
    if (!hot) throw new Error("The raster's hot texture with Color Adjust is missing.");
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
      filter: "color-adjust",
      settings: copySettings(session.settings),
      algorithm: DESTRUCTIVE_RASTER_COLOR_ADJUST_ALGORITHM,
      algorithmVersion: DESTRUCTIVE_RASTER_COLOR_ADJUST_ALGORITHM_VERSION,
      precision: engine.layerFormat === "rgba8unorm"
        ? DESTRUCTIVE_RASTER_COLOR_ADJUST_RGBA8_PRECISION
        : DESTRUCTIVE_RASTER_COLOR_ADJUST_PRECISION,
      colorSpace: DESTRUCTIVE_RASTER_COLOR_ADJUST_COLOR_SPACE,
      alphaMode: DESTRUCTIVE_RASTER_COLOR_ADJUST_ALPHA_MODE,
      boundsMode: DESTRUCTIVE_RASTER_COLOR_ADJUST_BOUNDS_MODE,
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
        "Color Adjust commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      throw new Error(
        `Color Adjust commit failed: ${runtimeError(error).message}; `
        + `rollback failed: ${runtimeError(rollbackError).message}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterColorAdjustSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus("Color Adjust applied to the pixels: one Undo step.", "ok");
  return true;
}
