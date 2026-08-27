/** Transactional destructive Gradient Map for the selected native raster. */

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
  RASTER_GRADIENT_MAP_LUT_COMPONENTS,
  RASTER_GRADIENT_MAP_LUT_SIZE,
  RASTER_GRADIENT_MAP_MIN_STOPS,
  generateRasterGradientMapLut,
  normalizeRasterGradientMapSettings,
  rasterGradientMapSettingsEqual,
  type RasterGradientMapSettings,
  type RasterGradientMapSettingsInput,
} from "./raster-gradient-map-core.ts";
import {
  rasterGradientMapDispatchSize,
  rasterGradientMapShader,
} from "./raster-gradient-map-shaders.ts";

export const DESTRUCTIVE_RASTER_GRADIENT_MAP_RUNTIME_BUILD =
  "destructive-raster-gradient-map-webgpu-v1-immutable-crop-latest-wins" as const;
export const DESTRUCTIVE_RASTER_GRADIENT_MAP_ALGORITHM =
  "luminance-gradient-map-v1" as const;
export const DESTRUCTIVE_RASTER_GRADIENT_MAP_ALGORITHM_VERSION = 1 as const;
export const DESTRUCTIVE_RASTER_GRADIENT_MAP_PRECISION =
  "rgba16float-source-and-output-f32-lut" as const;
export const DESTRUCTIVE_RASTER_GRADIENT_MAP_COLOR_SPACE =
  "straight-encoded-rgb" as const;
export const DESTRUCTIVE_RASTER_GRADIENT_MAP_ALPHA_MODE = "preserve" as const;
export const DESTRUCTIVE_RASTER_GRADIENT_MAP_BOUNDS_MODE = "preserve" as const;

const BYTES_PER_RGBA16F_PIXEL = 8;
const RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE = 32;
const RASTER_GRADIENT_MAP_LUT_BYTE_SIZE =
  RASTER_GRADIENT_MAP_LUT_SIZE
  * RASTER_GRADIENT_MAP_LUT_COMPONENTS
  * Float32Array.BYTES_PER_ELEMENT;

interface RasterGradientMapSharedResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
}

export interface RasterGradientMapSnapshot {
  readonly layerId: number;
  readonly settings: Readonly<RasterGradientMapSettings>;
  readonly sourceBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterGradientMapSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly lutBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly shared: RasterGradientMapSharedResources;
  readonly memoryBytes: number;
  settings: RasterGradientMapSettings;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

export type RasterGradientMapEngineHost = BrushEngine & {
  activeRasterGradientMapSession: ActiveRasterGradientMapSession | null;
};

const sharedByDevice = new WeakMap<GPUDevice, Promise<RasterGradientMapSharedResources>>();

async function createSharedResources(
  device: GPUDevice,
): Promise<RasterGradientMapSharedResources> {
  return runGpuAllocationTransaction(device, "Raster Gradient Map pipeline", async () => {
    const module = device.createShaderModule({
      label: "Raster Gradient Map WGSL",
      code: rasterGradientMapShader,
    });
    await assertShaderCompiled(module, "Raster Gradient Map");
    const bindGroupLayout = device.createBindGroupLayout({
      label: "Raster Gradient Map layout",
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
            minBindingSize: RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE,
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "read-only-storage",
            minBindingSize: RASTER_GRADIENT_MAP_LUT_BYTE_SIZE,
          },
        },
      ],
    });
    const pipeline = device.createComputePipeline({
      label: "Raster Gradient Map pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module, entryPoint: "mapRasterGradient" },
    });
    return { bindGroupLayout, pipeline };
  });
}

async function requireSharedResources(
  device: GPUDevice,
): Promise<RasterGradientMapSharedResources> {
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

export async function prewarmRasterGradientMapRuntime(device: GPUDevice): Promise<void> {
  await requireSharedResources(device);
}

function runtimeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copySettings(
  settings: Readonly<RasterGradientMapSettings>,
): RasterGradientMapSettings {
  return normalizeRasterGradientMapSettings(settings);
}

function snapshot(session: ActiveRasterGradientMapSession): RasterGradientMapSnapshot {
  return {
    layerId: session.layerId,
    settings: copySettings(session.settings),
    sourceBounds: { ...session.sourceBounds },
    memoryBytes: session.memoryBytes,
  };
}

function requireActiveLayer(
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
) {
  const record = engine.layerStack.active;
  if (record.id !== session.layerId) {
    throw new Error("The active raster changed while Gradient Map was open.");
  }
  return record;
}

function setAuthoritativeMetadata(
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
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

function destroySessionResources(session: ActiveRasterGradientMapSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.parameterBuffer.destroy();
  session.lutBuffer.destroy();
}

export function abandonRasterGradientMapSession(
  engine: RasterGradientMapEngineHost,
): boolean {
  const session = engine.activeRasterGradientMapSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterGradientMapSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function packedParameters(
  bounds: DirtyRect,
  settings: Readonly<RasterGradientMapSettings>,
): ArrayBuffer {
  const buffer = new ArrayBuffer(RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, bounds.x, true);
  view.setUint32(4, bounds.y, true);
  view.setUint32(16, settings.dither ? 1 : 0, true);
  return buffer;
}

function encodeRequestedPreview(
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
  serial: number,
  settings: RasterGradientMapSettings,
): void {
  if (engine.activeRasterGradientMapSession !== session) return;
  if (session.encodedSerial === serial) return;
  requireActiveLayer(engine, session);
  const bounds = session.sourceBounds;
  engine.device.queue.writeBuffer(
    session.parameterBuffer,
    0,
    packedParameters(bounds, settings),
  );
  engine.device.queue.writeBuffer(
    session.lutBuffer,
    0,
    generateRasterGradientMapLut(settings),
  );
  const encoder = engine.device.createCommandEncoder({
    label: `Raster Gradient Map preview layer ${session.layerId}`,
  });
  const dispatch = rasterGradientMapDispatchSize(bounds.width, bounds.height);
  const pass = encoder.beginComputePass({ label: "Raster Gradient Map pass" });
  pass.setPipeline(session.shared.pipeline);
  pass.setBindGroup(0, session.bindGroup);
  pass.dispatchWorkgroups(dispatch.x, dispatch.y);
  pass.end();
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session);
  engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  setAuthoritativeMetadata(engine, session);
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterGradientMapSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) return Promise.resolve();
  const serial = session.requestedSerial;
  const settings = copySettings(session.settings);
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, settings);
      await engine.waitForGpuCapped("Raster Gradient Map preview", 60_000);
    } catch (error) {
      session.previewFault = runtimeError(error);
      if (engine.activeRasterGradientMapSession === session) {
        engine.publishStatus(
          `Gradient Map preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterGradientMapSession === session
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
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterGradientMapSession !== session
      || session.terminal
      || session.previewFault
    ) return;
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
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
  engine: RasterGradientMapEngineHost,
  session: ActiveRasterGradientMapSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;
  requireActiveLayer(engine, session);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Restore raster Gradient Map source layer ${session.layerId}`,
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
  await engine.waitForGpuCapped("Restore raster Gradient Map source", 60_000);
  if (presentationError) throw presentationError;
}

async function allocateSession(
  engine: RasterGradientMapEngineHost,
  recordId: number,
  authoritativeTexture: GPUTexture,
  authoritativeView: GPUTextureView,
  sourceBounds: DirtyRect,
  sourceTileMask: Uint32Array,
  settings: RasterGradientMapSettings,
  shared: RasterGradientMapSharedResources,
): Promise<ActiveRasterGradientMapSession> {
  return runGpuAllocationTransaction(
    engine.device,
    `Allocate raster Gradient Map layer ${recordId}`,
    async (transaction): Promise<ActiveRasterGradientMapSession> => {
      const sourceTexture = engine.device.createTexture({
        label: `Raster Gradient Map immutable source layer ${recordId}`,
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
        label: "Raster Gradient Map immutable source view",
      });
      const parameterBuffer = engine.device.createBuffer({
        label: "Raster Gradient Map parameters",
        size: RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => parameterBuffer.destroy());
      const lutBuffer = engine.device.createBuffer({
        label: "Raster Gradient Map LUT",
        size: RASTER_GRADIENT_MAP_LUT_BYTE_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => lutBuffer.destroy());
      const bindGroup = engine.device.createBindGroup({
        label: "Raster Gradient Map bind group",
        layout: shared.bindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: authoritativeView },
          {
            binding: 2,
            resource: {
              buffer: parameterBuffer,
              offset: 0,
              size: RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE,
            },
          },
          {
            binding: 3,
            resource: {
              buffer: lutBuffer,
              offset: 0,
              size: RASTER_GRADIENT_MAP_LUT_BYTE_SIZE,
            },
          },
        ],
      });
      const encoder = engine.device.createCommandEncoder({
        label: `Capture raster Gradient Map source layer ${recordId}`,
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
      await engine.waitForGpuCapped("Prepare Gradient Map", 60_000);
      return {
        layerId: recordId,
        sourceBounds,
        sourceTileMask,
        sourceTexture,
        sourceView,
        parameterBuffer,
        lutBuffer,
        bindGroup,
        shared,
        memoryBytes:
          sourceBounds.width * sourceBounds.height * BYTES_PER_RGBA16F_PIXEL
          + RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE
          + RASTER_GRADIENT_MAP_LUT_BYTE_SIZE,
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

export async function beginRasterGradientMap(
  engine: RasterGradientMapEngineHost,
  initial: RasterGradientMapSettings,
): Promise<RasterGradientMapSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterGradientMapSession) {
    return snapshot(engine.activeRasterGradientMapSession);
  }
  if (
    !initial
    || !Array.isArray(initial.stops)
    || initial.stops.length < RASTER_GRADIENT_MAP_MIN_STOPS
  ) {
    throw new Error("Choose a gradient with at least two color stops first.");
  }
  const activeEdit = engine.activeDestructiveRasterEditKind();
  if (activeEdit) {
    throw new Error(
      `Apply or cancel ${engine.destructiveRasterEditLabel(activeEdit)} `
      + "before opening Gradient Map.",
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
      "Gradient Map works on the entire layer: deselect the pixels before opening it.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Destructive Gradient Map requires an RGBA16F document.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterGradientMapSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The raster's hot texture for Gradient Map is missing.");
    const sourceBounds = { ...record.contentBounds };
    const dispatch = rasterGradientMapDispatchSize(sourceBounds.width, sourceBounds.height);
    const maximumGroups = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (dispatch.x > maximumGroups || dispatch.y > maximumGroups) {
      throw new Error("Gradient Map: the GPU does not support the required dispatch size.");
    }
    const settings = normalizeRasterGradientMapSettings(initial);
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
    engine.activeRasterGradientMapSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus("Gradient Map preview is live.", "ok");
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterGradientMapSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Gradient Map startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterGradientMapSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Gradient Map startup failed: ${runtimeError(error).message}; `
        + `recovery failed: ${runtimeError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterGradientMap(
  engine: RasterGradientMapEngineHost,
  update: RasterGradientMapSettingsInput,
): RasterGradientMapSnapshot {
  const session = engine.activeRasterGradientMapSession;
  if (!session) throw new Error("No Gradient Map session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Gradient Map preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Gradient Map is already finishing.");
  const settings = normalizeRasterGradientMapSettings(update, session.settings);
  if (rasterGradientMapSettingsEqual(settings, session.settings)) return snapshot(session);
  session.settings = settings;
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus("Gradient Map preview…", "working");
  return snapshot(session);
}

export async function cancelRasterGradientMap(
  engine: RasterGradientMapEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterGradientMapSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Gradient Map is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Gradient Map cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterGradientMapSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus(
    "Gradient Map canceled: the original pixels were restored.",
    "ok",
  );
  return true;
}

export async function commitRasterGradientMap(
  engine: RasterGradientMapEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterGradientMapSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Gradient Map preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Gradient Map is already finishing.");
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    await flushPreview(engine, session);
    const record = requireActiveLayer(engine, session);
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("The raster's hot texture with Gradient Map is missing.");
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
      filter: "gradient-map",
      settings: copySettings(session.settings),
      lutSize: RASTER_GRADIENT_MAP_LUT_SIZE,
      algorithm: DESTRUCTIVE_RASTER_GRADIENT_MAP_ALGORITHM,
      algorithmVersion: DESTRUCTIVE_RASTER_GRADIENT_MAP_ALGORITHM_VERSION,
      precision: DESTRUCTIVE_RASTER_GRADIENT_MAP_PRECISION,
      colorSpace: DESTRUCTIVE_RASTER_GRADIENT_MAP_COLOR_SPACE,
      alphaMode: DESTRUCTIVE_RASTER_GRADIENT_MAP_ALPHA_MODE,
      boundsMode: DESTRUCTIVE_RASTER_GRADIENT_MAP_BOUNDS_MODE,
      seed,
      baseBounds: { ...session.sourceBounds },
      baseTileMask: session.sourceTileMask.slice(),
    };
    // The atomic history boundary records source provenance before detaching
    // the selected raster from its immutable imported source.
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
        "Gradient Map commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      throw new Error(
        `Gradient Map commit failed: ${runtimeError(error).message}; `
        + `rollback failed: ${runtimeError(rollbackError).message}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterGradientMapSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus("Gradient Map applied to the pixels: one Undo step.", "ok");
  return true;
}
