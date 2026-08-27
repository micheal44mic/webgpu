/** Transactional destructive tone curves for the selected native raster. */

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
  DEFAULT_RASTER_TONE_CURVE_SET,
  RASTER_TONE_CURVE_LUT_BYTE_SIZE,
  RASTER_TONE_CURVE_LUT_SIZE,
  RASTER_TONE_HISTOGRAM_BYTE_SIZE,
  createEmptyRasterToneHistogram,
  createPackedRasterToneCurveLut,
  isRasterToneCurveSetIdentity,
  normalizeRasterToneCurveSet,
  type RasterToneCurvePoint,
  type RasterToneCurveSet,
} from "./raster-tone-curves-core";
import {
  rasterToneCurvesAdjustmentDispatchSize,
  rasterToneCurvesAdjustmentShader,
  rasterToneCurvesHistogramDispatchSize,
  rasterToneCurvesHistogramShader,
} from "./raster-tone-curves-shaders";

export const DESTRUCTIVE_RASTER_TONE_CURVES_RUNTIME_BUILD =
  "destructive-raster-tone-curves-webgpu-v1-immutable-crop-latest-wins" as const;
export const DESTRUCTIVE_RASTER_TONE_CURVES_ALGORITHM =
  "shape-preserving-cubic-lut-v1" as const;
export const DESTRUCTIVE_RASTER_TONE_CURVES_ALGORITHM_VERSION = 1 as const;
export const DESTRUCTIVE_RASTER_TONE_CURVES_PRECISION =
  "rgba16float-source-and-output-f32-lut" as const;
export const DESTRUCTIVE_RASTER_TONE_CURVES_COLOR_SPACE =
  "straight-encoded-rgb" as const;
export const DESTRUCTIVE_RASTER_TONE_CURVES_ALPHA_MODE = "preserve" as const;
export const DESTRUCTIVE_RASTER_TONE_CURVES_BOUNDS_MODE = "preserve" as const;

const BYTES_PER_RGBA16F_PIXEL = 8;
const RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE = 16;

interface RasterToneCurvesSharedResources {
  readonly adjustmentBindGroupLayout: GPUBindGroupLayout;
  readonly adjustmentPipeline: GPUComputePipeline;
  readonly histogramBindGroupLayout: GPUBindGroupLayout;
  readonly histogramPipeline: GPUComputePipeline;
}

export interface RasterToneCurvesSnapshot {
  readonly layerId: number;
  readonly curves: Readonly<RasterToneCurveSet>;
  /** Composite, red, green and blue ranges, each containing 256 bins. */
  readonly histogram: Uint32Array;
  readonly sourceBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterToneCurvesSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly lutBuffer: GPUBuffer;
  readonly parameterBuffer: GPUBuffer;
  readonly adjustmentBindGroup: GPUBindGroup;
  readonly shared: RasterToneCurvesSharedResources;
  readonly histogram: Uint32Array;
  readonly memoryBytes: number;
  curves: RasterToneCurveSet;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

/** Explicit host slot keeps this runtime type-safe before engine wiring. */
export type RasterToneCurvesEngineHost = BrushEngine & {
  activeRasterToneCurvesSession: ActiveRasterToneCurvesSession | null;
};

const sharedByDevice = new WeakMap<
  GPUDevice,
  Promise<RasterToneCurvesSharedResources>
>();

async function createSharedResources(
  device: GPUDevice,
): Promise<RasterToneCurvesSharedResources> {
  return runGpuAllocationTransaction(
    device,
    "Raster tone curves pipelines",
    async () => {
      const adjustmentModule = device.createShaderModule({
        label: "Raster tone curves adjustment WGSL",
        code: rasterToneCurvesAdjustmentShader,
      });
      const histogramModule = device.createShaderModule({
        label: "Raster tone histogram WGSL",
        code: rasterToneCurvesHistogramShader,
      });
      await Promise.all([
        assertShaderCompiled(adjustmentModule, "Raster tone curves adjustment"),
        assertShaderCompiled(histogramModule, "Raster tone histogram"),
      ]);

      const adjustmentBindGroupLayout = device.createBindGroupLayout({
        label: "Raster tone curves adjustment layout",
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
              type: "read-only-storage",
              minBindingSize: RASTER_TONE_CURVE_LUT_BYTE_SIZE,
            },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: {
              type: "uniform",
              minBindingSize: RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE,
            },
          },
        ],
      });
      const histogramBindGroupLayout = device.createBindGroupLayout({
        label: "Raster tone histogram layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: "unfilterable-float" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: {
              type: "storage",
              minBindingSize: RASTER_TONE_HISTOGRAM_BYTE_SIZE,
            },
          },
        ],
      });
      const adjustmentPipeline = device.createComputePipeline({
        label: "Raster tone curves adjustment pipeline",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [adjustmentBindGroupLayout],
        }),
        compute: { module: adjustmentModule, entryPoint: "adjustRasterTone" },
      });
      const histogramPipeline = device.createComputePipeline({
        label: "Raster tone histogram pipeline",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [histogramBindGroupLayout],
        }),
        compute: { module: histogramModule, entryPoint: "buildRasterToneHistogram" },
      });
      return {
        adjustmentBindGroupLayout,
        adjustmentPipeline,
        histogramBindGroupLayout,
        histogramPipeline,
      };
    },
  );
}

async function requireSharedResources(
  device: GPUDevice,
): Promise<RasterToneCurvesSharedResources> {
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

/** Builds both resident pipelines without opening a document edit. */
export async function prewarmRasterToneCurvesRuntime(
  device: GPUDevice,
): Promise<void> {
  await requireSharedResources(device);
}

function previewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copyCurve(
  curve: readonly RasterToneCurvePoint[],
): readonly RasterToneCurvePoint[] {
  return Object.freeze(curve.map((point) => Object.freeze({ ...point })));
}

function copyCurves(curves: RasterToneCurveSet): RasterToneCurveSet {
  return Object.freeze({
    composite: copyCurve(curves.composite),
    red: copyCurve(curves.red),
    green: copyCurve(curves.green),
    blue: copyCurve(curves.blue),
  });
}

function curvesEqual(
  left: RasterToneCurveSet,
  right: RasterToneCurveSet,
): boolean {
  for (const channel of ["composite", "red", "green", "blue"] as const) {
    const first = left[channel];
    const second = right[channel];
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index += 1) {
      if (first[index].x !== second[index].x || first[index].y !== second[index].y) {
        return false;
      }
    }
  }
  return true;
}

function snapshot(
  session: ActiveRasterToneCurvesSession,
): RasterToneCurvesSnapshot {
  return {
    layerId: session.layerId,
    curves: copyCurves(session.curves),
    histogram: session.histogram.slice(),
    sourceBounds: { ...session.sourceBounds },
    memoryBytes: session.memoryBytes,
  };
}

function requireActiveToneCurvesLayer(
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
) {
  const record = engine.layerStack.active;
  if (record.id !== session.layerId) {
    throw new Error("The active raster changed while Tone Curves was open.");
  }
  return record;
}

function setAuthoritativeMetadata(
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
  bounds: DirtyRect,
  tileMask: Uint32Array,
): void {
  const record = requireActiveToneCurvesLayer(engine, session);
  engine.layerContentBounds = { ...bounds };
  engine.layerHasContent = true;
  record.contentBounds = { ...bounds };
  record.hasContent = true;
  record.storageTileMask.set(tileMask);
  invalidateActiveLayerBake(engine);
}

function destroySessionResources(session: ActiveRasterToneCurvesSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.lutBuffer.destroy();
  session.parameterBuffer.destroy();
}

/** Device-loss cleanup intentionally avoids submitting an impossible rollback. */
export function abandonRasterToneCurvesSession(
  engine: RasterToneCurvesEngineHost,
): boolean {
  const session = engine.activeRasterToneCurvesSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterToneCurvesSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function encodeRequestedPreview(
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
  serial: number,
  curves: RasterToneCurveSet,
): void {
  if (engine.activeRasterToneCurvesSession !== session) return;
  if (session.encodedSerial === serial) return;
  requireActiveToneCurvesLayer(engine, session);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Raster tone curves preview layer ${session.layerId}`,
  });
  if (isRasterToneCurveSetIdentity(curves)) {
    encoder.copyTextureToTexture(
      { texture: session.sourceTexture },
      {
        texture: engine.layerTexture,
        origin: { x: bounds.x, y: bounds.y, z: 0 },
      },
      { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
    );
  } else {
    engine.device.queue.writeBuffer(
      session.lutBuffer,
      0,
      createPackedRasterToneCurveLut(curves),
    );
    const dispatch = rasterToneCurvesAdjustmentDispatchSize(
      bounds.width,
      bounds.height,
    );
    const pass = encoder.beginComputePass({ label: "Raster tone curves pass" });
    pass.setPipeline(session.shared.adjustmentPipeline);
    pass.setBindGroup(0, session.adjustmentBindGroup);
    pass.dispatchWorkgroups(dispatch.x, dispatch.y);
    pass.end();
  }
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session, bounds, session.sourceTileMask);
  engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  setAuthoritativeMetadata(engine, session, bounds, session.sourceTileMask);
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterToneCurvesSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const curves = copyCurves(session.curves);
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, curves);
      await engine.waitForGpuCapped("Raster tone curves preview", 60_000);
    } catch (error) {
      session.previewFault = previewError(error);
      if (engine.activeRasterToneCurvesSession === session) {
        engine.publishStatus(
          `Tone Curves preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterToneCurvesSession === session
        && !session.terminal
        && !session.previewFault
        && session.encodedSerial !== session.requestedSerial
      ) {
        schedulePreview(engine, session);
      }
    }
  });
  session.previewInFlight = completion;
  return completion;
}

function schedulePreview(
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterToneCurvesSession !== session
      || session.terminal
      || session.previewFault
    ) {
      return;
    }
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
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
  engine: RasterToneCurvesEngineHost,
  session: ActiveRasterToneCurvesSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  // A preview microtask may already own a submission. Waiting first guarantees
  // that the byte-exact restore is the final command touching the layer.
  if (session.previewInFlight) await session.previewInFlight;
  requireActiveToneCurvesLayer(engine, session);
  const bounds = session.sourceBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Restore raster tone source layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: engine.layerTexture,
      origin: { x: bounds.x, y: bounds.y, z: 0 },
    },
    { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session, bounds, session.sourceTileMask);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, session, bounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Restore raster tone source", 60_000);
  if (presentationError) throw presentationError;
}

interface AllocatedToneCurvesSession {
  readonly session: ActiveRasterToneCurvesSession;
  readonly histogramBuffer: GPUBuffer;
  readonly histogramReadback: GPUBuffer;
}

async function allocateSession(
  engine: RasterToneCurvesEngineHost,
  recordId: number,
  authoritativeTexture: GPUTexture,
  authoritativeView: GPUTextureView,
  sourceBounds: DirtyRect,
  sourceTileMask: Uint32Array,
  curves: RasterToneCurveSet,
  shared: RasterToneCurvesSharedResources,
): Promise<ActiveRasterToneCurvesSession> {
  const allocated = await runGpuAllocationTransaction(
    engine.device,
    `Allocate raster tone curves layer ${recordId}`,
    async (transaction): Promise<AllocatedToneCurvesSession> => {
      const sourceTexture = engine.device.createTexture({
        label: `Raster tone immutable source layer ${recordId}`,
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
        label: "Raster tone immutable source view",
      });
      const lutBuffer = engine.device.createBuffer({
        label: "Raster tone curves LUT",
        size: RASTER_TONE_CURVE_LUT_BYTE_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => lutBuffer.destroy());
      const parameterBuffer = engine.device.createBuffer({
        label: "Raster tone curves output origin",
        size: RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => parameterBuffer.destroy());
      const histogramBuffer = engine.device.createBuffer({
        label: "Raster tone histogram GPU bins",
        size: RASTER_TONE_HISTOGRAM_BYTE_SIZE,
        usage:
          GPUBufferUsage.STORAGE
          | GPUBufferUsage.COPY_SRC
          | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => histogramBuffer.destroy());
      const histogramReadback = engine.device.createBuffer({
        label: "Raster tone histogram one-shot readback",
        size: RASTER_TONE_HISTOGRAM_BYTE_SIZE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      transaction.deferRollback(() => histogramReadback.destroy());

      const adjustmentBindGroup = engine.device.createBindGroup({
        label: "Raster tone curves adjustment bind group",
        layout: shared.adjustmentBindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: authoritativeView },
          {
            binding: 2,
            resource: {
              buffer: lutBuffer,
              offset: 0,
              size: RASTER_TONE_CURVE_LUT_BYTE_SIZE,
            },
          },
          {
            binding: 3,
            resource: {
              buffer: parameterBuffer,
              offset: 0,
              size: RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE,
            },
          },
        ],
      });
      const histogramBindGroup = engine.device.createBindGroup({
        label: "Raster tone histogram bind group",
        layout: shared.histogramBindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          {
            binding: 1,
            resource: {
              buffer: histogramBuffer,
              offset: 0,
              size: RASTER_TONE_HISTOGRAM_BYTE_SIZE,
            },
          },
        ],
      });

      engine.device.queue.writeBuffer(
        histogramBuffer,
        0,
        createEmptyRasterToneHistogram(),
      );
      engine.device.queue.writeBuffer(
        parameterBuffer,
        0,
        new Uint32Array([sourceBounds.x, sourceBounds.y, 0, 0]),
      );
      const histogramDispatch = rasterToneCurvesHistogramDispatchSize(
        sourceBounds.width,
        sourceBounds.height,
      );
      const encoder = engine.device.createCommandEncoder({
        label: `Capture raster tone source and histogram layer ${recordId}`,
      });
      encoder.copyTextureToTexture(
        {
          texture: authoritativeTexture,
          origin: { x: sourceBounds.x, y: sourceBounds.y, z: 0 },
        },
        { texture: sourceTexture },
        {
          width: sourceBounds.width,
          height: sourceBounds.height,
          depthOrArrayLayers: 1,
        },
      );
      const histogramPass = encoder.beginComputePass({
        label: "Raster tone histogram one-shot pass",
      });
      histogramPass.setPipeline(shared.histogramPipeline);
      histogramPass.setBindGroup(0, histogramBindGroup);
      histogramPass.dispatchWorkgroups(histogramDispatch.x, histogramDispatch.y);
      histogramPass.end();
      encoder.copyBufferToBuffer(
        histogramBuffer,
        0,
        histogramReadback,
        0,
        RASTER_TONE_HISTOGRAM_BYTE_SIZE,
      );
      engine.device.queue.submit([encoder.finish()]);
      await engine.waitForGpuCapped("Prepare raster tone curves", 60_000);
      await histogramReadback.mapAsync(GPUMapMode.READ);
      const histogram = new Uint32Array(
        histogramReadback.getMappedRange().slice(0),
      );
      histogramReadback.unmap();

      const session: ActiveRasterToneCurvesSession = {
        layerId: recordId,
        sourceBounds,
        sourceTileMask,
        sourceTexture,
        sourceView,
        lutBuffer,
        parameterBuffer,
        adjustmentBindGroup,
        shared,
        histogram,
        memoryBytes:
          sourceBounds.width * sourceBounds.height * BYTES_PER_RGBA16F_PIXEL
          + RASTER_TONE_CURVE_LUT_BYTE_SIZE
          + RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE,
        curves,
        requestedSerial: 1,
        encodedSerial: 0,
        previewFrame: null,
        previewInFlight: null,
        previewFault: null,
        terminal: false,
        destroyed: false,
      };
      return { session, histogramBuffer, histogramReadback };
    },
  );
  allocated.histogramBuffer.destroy();
  allocated.histogramReadback.destroy();
  return allocated.session;
}

export async function beginRasterToneCurves(
  engine: RasterToneCurvesEngineHost,
  initial: Partial<RasterToneCurveSet> = DEFAULT_RASTER_TONE_CURVE_SET,
): Promise<RasterToneCurvesSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterToneCurvesSession) {
    return snapshot(engine.activeRasterToneCurvesSession);
  }
  const activeEdit = engine.activeDestructiveRasterEditKind();
  if (activeEdit) {
    throw new Error(
      `Apply or cancel ${engine.destructiveRasterEditLabel(activeEdit)} `
      + "before opening Tone Curves.",
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
      "Tone Curves works on the entire layer: deselect the pixels before opening it.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Destructive Tone Curves requires an RGBA16F document.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterToneCurvesSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The raster's hot texture for Tone Curves is missing.");
    const sourceBounds = { ...record.contentBounds };
    const adjustmentDispatch = rasterToneCurvesAdjustmentDispatchSize(
      sourceBounds.width,
      sourceBounds.height,
    );
    const histogramDispatch = rasterToneCurvesHistogramDispatchSize(
      sourceBounds.width,
      sourceBounds.height,
    );
    const maximumGroups = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (
      adjustmentDispatch.x > maximumGroups
      || adjustmentDispatch.y > maximumGroups
      || histogramDispatch.x > maximumGroups
      || histogramDispatch.y > maximumGroups
    ) {
      throw new Error("Tone Curves: the GPU does not support the required dispatch size.");
    }
    const sourceTileMask = record.storageTileMask.slice();
    const curves = normalizeRasterToneCurveSet(initial);
    const shared = await requireSharedResources(engine.device);
    session = await allocateSession(
      engine,
      record.id,
      hot.texture,
      hot.view,
      sourceBounds,
      sourceTileMask,
      curves,
      shared,
    );
    engine.activeRasterToneCurvesSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus("Tone Curves preview: Apply or Cancel.", "ok");
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterToneCurvesSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Tone Curves startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterToneCurvesSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Tone Curves startup failed: ${previewError(error).message}; `
        + `recovery failed: ${previewError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterToneCurves(
  engine: RasterToneCurvesEngineHost,
  update: Partial<RasterToneCurveSet>,
): RasterToneCurvesSnapshot {
  const session = engine.activeRasterToneCurvesSession;
  if (!session) throw new Error("No Tone Curves session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Tone Curves preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Tone Curves is already finishing.");
  const curves = normalizeRasterToneCurveSet({ ...session.curves, ...update });
  if (curvesEqual(curves, session.curves)) return snapshot(session);
  session.curves = curves;
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus("Tone Curves preview…", "working");
  return snapshot(session);
}

export async function cancelRasterToneCurves(
  engine: RasterToneCurvesEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterToneCurvesSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Tone Curves is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Tone Curves cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterToneCurvesSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus(
    "Tone Curves canceled: the original pixels were restored.",
    "ok",
  );
  return true;
}

export async function commitRasterToneCurves(
  engine: RasterToneCurvesEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterToneCurvesSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(
      `Tone Curves preview interrupted: ${session.previewFault.message}. Use Cancel.`,
    );
  }
  if (session.terminal) throw new Error("Tone Curves is already finishing.");
  if (isRasterToneCurveSetIdentity(session.curves)) {
    await cancelRasterToneCurves(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    await flushPreview(engine, session);
    const record = requireActiveToneCurvesLayer(engine, session);
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("The raster's hot texture with Tone Curves is missing.");
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
      filter: "curves",
      curves: copyCurves(session.curves),
      lutSize: RASTER_TONE_CURVE_LUT_SIZE,
      precision: DESTRUCTIVE_RASTER_TONE_CURVES_PRECISION,
      colorSpace: DESTRUCTIVE_RASTER_TONE_CURVES_COLOR_SPACE,
      alphaMode: DESTRUCTIVE_RASTER_TONE_CURVES_ALPHA_MODE,
      boundsMode: DESTRUCTIVE_RASTER_TONE_CURVES_BOUNDS_MODE,
      seed,
      baseBounds: { ...session.sourceBounds },
      baseTileMask: session.sourceTileMask.slice(),
    };
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Tone Curves commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Tone Curves commit failed: ${operationMessage}; `
        + `rollback failed: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterToneCurvesSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus("Tone Curves applied to the pixels: one Undo step.", "ok");
  return true;
}
