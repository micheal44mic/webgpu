/** Transactional destructive Motion Blur for the selected native raster layer. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import type { DirtyRect } from "./engine-stroke-types";
import {
  createRgba16fToRgba8ResolveResources,
  destroyRgba16fToRgba8ResolveResources,
  encodeRgba16fToRgba8Resolve,
  type Rgba16fToRgba8ResolveResources,
} from "./engine-rgba16f-resolve";
import type { LayerFormat } from "./engine-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
  destructiveMotionBlurBounds,
  destructiveMotionBlurKernel,
  destructiveMotionBlurMaximumBounds,
  normalizeDestructiveMotionBlurAngle,
  normalizeDestructiveMotionBlurDistance,
  unionMotionBlurRects,
  type MotionBlurKernel,
  type MotionBlurRect,
} from "./motion-blur-core";
import { tileMaskCoveringRect } from "./raster-transform-math";

export const DESTRUCTIVE_MOTION_BLUR_RUNTIME_BUILD =
  "destructive-motion-blur-webgpu-v3-rgba16float-work-rgba8-final-resolve";
export const DESTRUCTIVE_MOTION_BLUR_PRECISION =
  "rgba16float-storage-f32-accumulation" as const;
export const DESTRUCTIVE_MOTION_BLUR_EDGE_MODE =
  "transparent-content-clamp-document-edge" as const;

const PARAMETER_WORDS = 16;
const PARAMETER_BYTES = PARAMETER_WORDS * 4;
const PARAMETER_CAPACITY = 16;
const BYTES_PER_RGBA16F_PIXEL = 8;

interface MotionBlurSharedResources {
  bindGroupLayout: GPUBindGroupLayout;
  pipeline: GPURenderPipeline;
}

export interface RasterMotionBlurSnapshot {
  readonly layerId: number;
  readonly distance: number;
  readonly angle: number;
  readonly sampleCount: number;
  readonly passCount: number;
  readonly supportX: number;
  readonly supportY: number;
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterMotionBlurSession {
  readonly layerId: number;
  readonly sourceFormat: LayerFormat;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly workTextureA: GPUTexture;
  readonly workViewA: GPUTextureView;
  readonly workTextureB: GPUTexture;
  readonly workViewB: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterStride: number;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadF32: Float32Array;
  readonly sourceBindGroup: GPUBindGroup;
  readonly workBindGroupA: GPUBindGroup;
  readonly workBindGroupB: GPUBindGroup;
  readonly rgba8ResolveA: Rgba16fToRgba8ResolveResources | null;
  readonly rgba8ResolveB: Rgba16fToRgba8ResolveResources | null;
  readonly shared: MotionBlurSharedResources;
  readonly memoryBytes: number;
  distance: number;
  angle: number;
  resultBounds: DirtyRect;
  resultTileMask: Uint32Array;
  presentedBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
}

const sharedByDevice = new WeakMap<GPUDevice, Promise<MotionBlurSharedResources>>();

function copyRect(rect: MotionBlurRect | null): DirtyRect | null {
  return rect ? { ...rect } : null;
}

function motionBlurShader(): string {
  return /* wgsl */ `
struct MotionParameters {
  inputTextureOriginAndSize: vec4<i32>,
  inputValidOriginAndSize: vec4<i32>,
  attachmentOriginAndDocumentSize: vec4<i32>,
  shiftAndPadding: vec4<f32>,
};

@group(0) @binding(0) var<uniform> parameters: MotionParameters;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;

fn inputTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let documentSize = parameters.attachmentOriginAndDocumentSize.zw;
  let documentMaximum = max(documentSize - vec2<i32>(1), vec2<i32>(0));
  let clampedDocumentPixel = clamp(
    documentPixel,
    vec2<i32>(0),
    documentMaximum
  );
  let validOrigin = parameters.inputValidOriginAndSize.xy;
  let validSize = parameters.inputValidOriginAndSize.zw;
  if (
    any(clampedDocumentPixel < validOrigin)
    || any(clampedDocumentPixel >= validOrigin + validSize)
  ) {
    return vec4<f32>(0.0);
  }
  let local = clampedDocumentPixel - parameters.inputTextureOriginAndSize.xy;
  let size = parameters.inputTextureOriginAndSize.zw;
  if (any(local < vec2<i32>(0)) || any(local >= size)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(inputTexture, local, 0);
}

fn sampleInputLinear(documentPosition: vec2<f32>) -> vec4<f32> {
  let pixelPosition = documentPosition - vec2<f32>(0.5);
  let baseFloat = floor(pixelPosition);
  let base = vec2<i32>(baseFloat);
  let fraction = pixelPosition - baseFloat;
  let top = mix(
    inputTexel(base),
    inputTexel(base + vec2<i32>(1, 0)),
    fraction.x
  );
  let bottom = mix(
    inputTexel(base + vec2<i32>(0, 1)),
    inputTexel(base + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPosition = position.xy
    + vec2<f32>(parameters.attachmentOriginAndDocumentSize.xy);
  let shift = parameters.shiftAndPadding.xy;
  // Each logarithmic stage averages two equally weighted, symmetric exposure
  // blocks. Fragment arithmetic and the average are f32; only storage between
  // stages is rounded back to the document's native RGBA16F representation.
  return (
    sampleInputLinear(documentPosition - shift)
    + sampleInputLinear(documentPosition + shift)
  ) * 0.5;
}
`;
}

async function createSharedResources(device: GPUDevice): Promise<MotionBlurSharedResources> {
  return runGpuAllocationTransaction(
    device,
    "Pipeline Native raster Motion Blur RGBA16F",
    async () => {
      const module = device.createShaderModule({
        label: "Native raster Motion Blur logarithmic WGSL",
        code: motionBlurShader(),
      });
      await assertShaderCompiled(module, "Motion Blur direzionale");
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Motion Blur layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: PARAMETER_BYTES,
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "unfilterable-float" },
          },
        ],
      });
      const pipeline = device.createRenderPipeline({
        label: "Native raster Motion Blur logarithmic pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vertexMain" },
        fragment: {
          module,
          entryPoint: "fragmentMain",
          targets: [{ format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list" },
      });
      return { bindGroupLayout, pipeline };
    },
  );
}

async function requireSharedResources(device: GPUDevice): Promise<MotionBlurSharedResources> {
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

function snapshot(session: ActiveRasterMotionBlurSession): RasterMotionBlurSnapshot {
  const kernel = destructiveMotionBlurKernel(session.distance, session.angle);
  return {
    layerId: session.layerId,
    distance: session.distance,
    angle: session.angle,
    sampleCount: kernel.sampleCount,
    passCount: kernel.passCount,
    supportX: kernel.supportX,
    supportY: kernel.supportY,
    sourceBounds: { ...session.sourceBounds },
    resultBounds: { ...session.resultBounds },
    memoryBytes: session.memoryBytes,
  };
}

function setAuthoritativeMetadata(
  engine: BrushEngine,
  bounds: DirtyRect,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  engine.layerContentBounds = { ...bounds };
  engine.layerHasContent = true;
  record.contentBounds = { ...bounds };
  record.hasContent = true;
  record.storageTileMask.set(tileMaskCoveringRect(tileMask, bounds, engine.layerSize));
  invalidateActiveLayerBake(engine);
}

interface PassParameters {
  readonly inputTextureBounds: DirtyRect;
  readonly inputValidBounds: DirtyRect;
  readonly attachmentOriginX: number;
  readonly attachmentOriginY: number;
  readonly shiftX: number;
  readonly shiftY: number;
}

function writePassParameters(
  session: ActiveRasterMotionBlurSession,
  index: number,
  parameters: PassParameters,
  documentSize: number,
): number {
  if (index >= PARAMETER_CAPACITY) {
    throw new Error("Motion Blur: capacità passaggi superata.");
  }
  const byteOffset = index * session.parameterStride;
  const word = byteOffset / 4;
  const texture = parameters.inputTextureBounds;
  const valid = parameters.inputValidBounds;
  session.parameterUploadI32[word] = texture.x;
  session.parameterUploadI32[word + 1] = texture.y;
  session.parameterUploadI32[word + 2] = texture.width;
  session.parameterUploadI32[word + 3] = texture.height;
  session.parameterUploadI32[word + 4] = valid.x;
  session.parameterUploadI32[word + 5] = valid.y;
  session.parameterUploadI32[word + 6] = valid.width;
  session.parameterUploadI32[word + 7] = valid.height;
  session.parameterUploadI32[word + 8] = parameters.attachmentOriginX;
  session.parameterUploadI32[word + 9] = parameters.attachmentOriginY;
  session.parameterUploadI32[word + 10] = documentSize;
  session.parameterUploadI32[word + 11] = documentSize;
  session.parameterUploadF32[word + 12] = parameters.shiftX;
  session.parameterUploadF32[word + 13] = parameters.shiftY;
  session.parameterUploadF32[word + 14] = 0;
  session.parameterUploadF32[word + 15] = 0;
  return byteOffset;
}

function destroySessionResources(session: ActiveRasterMotionBlurSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.workTextureA.destroy();
  session.workTextureB.destroy();
  session.parameterBuffer.destroy();
  destroyRgba16fToRgba8ResolveResources(session.rgba8ResolveA);
  destroyRgba16fToRgba8ResolveResources(session.rgba8ResolveB);
}

function previewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function encodeRequestedPreview(
  engine: BrushEngine,
  session: ActiveRasterMotionBlurSession,
  serial: number,
  distance: number,
  angle: number,
): void {
  if (engine.activeRasterMotionBlurSession !== session) return;
  if (session.encodedSerial === serial) return;

  const kernel = destructiveMotionBlurKernel(distance, angle);
  const resultBounds = destructiveMotionBlurBounds(
    session.sourceBounds,
    distance,
    angle,
    engine.layerSize,
    engine.layerSize,
  ) as DirtyRect | null;
  if (!resultBounds) throw new Error("Motion Blur: bounds risultato mancanti.");
  const dirtyRect = unionMotionBlurRects(
    session.presentedBounds,
    resultBounds,
  ) as DirtyRect;
  if (kernel.passCount > PARAMETER_CAPACITY) {
    throw new Error("Motion Blur: troppi passaggi per il buffer parametri.");
  }

  const offsets = kernel.shifts.map((shift, pass) => {
    const inputValidBounds = pass === 0 ? session.scratchBounds : resultBounds;
    return writePassParameters(session, pass, {
      inputTextureBounds: session.scratchBounds,
      inputValidBounds,
      attachmentOriginX: session.scratchBounds.x,
      attachmentOriginY: session.scratchBounds.y,
      shiftX: shift.x,
      shiftY: shift.y,
    }, engine.layerSize);
  });
  if (offsets.length > 0) {
    engine.device.queue.writeBuffer(
      session.parameterBuffer,
      0,
      session.parameterUpload,
      0,
      offsets.length * session.parameterStride,
    );
  }

  const encoder = engine.device.createCommandEncoder({
    label: `Native raster Motion Blur preview ${distance}px ${angle}deg`,
  });
  encoder.copyTextureToTexture(
    {
      texture: session.sourceTexture,
      origin: {
        x: dirtyRect.x - session.scratchBounds.x,
        y: dirtyRect.y - session.scratchBounds.y,
        z: 0,
      },
    },
    {
      texture: engine.layerTexture,
      origin: { x: dirtyRect.x, y: dirtyRect.y, z: 0 },
    },
    { width: dirtyRect.width, height: dirtyRect.height, depthOrArrayLayers: 1 },
  );

  for (let pass = 0; pass < kernel.passCount; pass += 1) {
    const writesA = pass % 2 === 0;
    const renderPass = encoder.beginRenderPass({
      label: `Motion Blur exposure pass ${pass + 1}/${kernel.passCount}`,
      colorAttachments: [{
        view: writesA ? session.workViewA : session.workViewB,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    renderPass.setPipeline(session.shared.pipeline);
    const bindGroup = pass === 0
      ? session.sourceBindGroup
      : pass % 2 === 1
        ? session.workBindGroupA
        : session.workBindGroupB;
    renderPass.setBindGroup(0, bindGroup, [offsets[pass]]);
    const viewportX = resultBounds.x - session.scratchBounds.x;
    const viewportY = resultBounds.y - session.scratchBounds.y;
    renderPass.setViewport(
      viewportX,
      viewportY,
      resultBounds.width,
      resultBounds.height,
      0,
      1,
    );
    renderPass.setScissorRect(
      viewportX,
      viewportY,
      resultBounds.width,
      resultBounds.height,
    );
    renderPass.draw(3, 1, 0, 0);
    renderPass.end();
  }

  if (kernel.passCount > 0) {
    const finalTexture = kernel.passCount % 2 === 1
      ? session.workTextureA
      : session.workTextureB;
    if (session.sourceFormat === "rgba8unorm") {
      const rgba8Resolve = kernel.passCount % 2 === 1
        ? session.rgba8ResolveA
        : session.rgba8ResolveB;
      if (!rgba8Resolve) {
        throw new Error("Motion Blur: resolve RGBA8 mancante.");
      }
      encodeRgba16fToRgba8Resolve(
        engine.device,
        encoder,
        rgba8Resolve,
        {
          sourceX: resultBounds.x - session.scratchBounds.x,
          sourceY: resultBounds.y - session.scratchBounds.y,
          targetX: resultBounds.x,
          targetY: resultBounds.y,
          width: resultBounds.width,
          height: resultBounds.height,
        },
        "Motion Blur RGBA16F → layer RGBA8",
      );
    } else {
      encoder.copyTextureToTexture(
        {
          texture: finalTexture,
          origin: {
            x: resultBounds.x - session.scratchBounds.x,
            y: resultBounds.y - session.scratchBounds.y,
            z: 0,
          },
        },
        {
          texture: engine.layerTexture,
          origin: { x: resultBounds.x, y: resultBounds.y, z: 0 },
        },
        {
          width: resultBounds.width,
          height: resultBounds.height,
          depthOrArrayLayers: 1,
        },
      );
    }
  }
  engine.device.queue.submit([encoder.finish()]);

  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    resultBounds,
    engine.layerSize,
  );
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  session.presentedBounds = { ...resultBounds };
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: BrushEngine,
  session: ActiveRasterMotionBlurSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterMotionBlurSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const distance = session.distance;
  const angle = session.angle;
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, distance, angle);
      await engine.waitForGpuCapped(
        `Anteprima Motion Blur ${distance}px ${angle}deg`,
        60_000,
      );
    } catch (error) {
      session.previewFault = previewError(error);
      if (engine.activeRasterMotionBlurSession === session) {
        engine.publishStatus(
          `Anteprima Motion Blur interrotta: ${session.previewFault.message}. Usa Annulla.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterMotionBlurSession === session
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
  engine: BrushEngine,
  session: ActiveRasterMotionBlurSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterMotionBlurSession !== session
      || session.terminal
      || session.previewFault
    ) {
      return;
    }
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: BrushEngine,
  session: ActiveRasterMotionBlurSession,
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
  engine: BrushEngine,
  session: ActiveRasterMotionBlurSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  const encoder = engine.device.createCommandEncoder({
    label: `Cancel Native raster Motion Blur layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: engine.layerTexture,
      origin: { x: session.scratchBounds.x, y: session.scratchBounds.y, z: 0 },
    },
    {
      width: session.scratchBounds.width,
      height: session.scratchBounds.height,
      depthOrArrayLayers: 1,
    },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate(
      [],
      false,
      engine.settings,
      true,
      null,
      session.scratchBounds,
      false,
    );
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Annullamento Motion Blur", 60_000);
  if (session.previewInFlight) await session.previewInFlight;
  if (presentationError) throw presentationError;
}

export async function beginRasterMotionBlur(
  engine: BrushEngine,
  initialDistance = DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  initialAngle = DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
): Promise<RasterMotionBlurSnapshot | null> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (engine.activeRasterMotionBlurSession) {
    return snapshot(engine.activeRasterMotionBlurSession);
  }
  engine.assertDestructiveRasterEditCanOpen("motion-blur");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("Il raster selezionato non coincide con il livello attivo.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Motion Blur v1 lavora sull’intero livello: deseleziona i pixel prima di aprirlo.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("Il livello raster selezionato è vuoto.");
  }
  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterMotionBlurSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("Texture hot del raster da sfocare mancante.");
    const sourceBounds = { ...record.contentBounds };
    const scratchBounds = destructiveMotionBlurMaximumBounds(
      sourceBounds,
      engine.layerSize,
      engine.layerSize,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("Il raster non contiene pixel sfocabili.");
    const distance = normalizeDestructiveMotionBlurDistance(initialDistance);
    const angle = normalizeDestructiveMotionBlurAngle(initialAngle);
    const initialResultBounds = destructiveMotionBlurBounds(
      sourceBounds,
      distance,
      angle,
      engine.layerSize,
      engine.layerSize,
    ) as DirtyRect;
    const maximumKernel = destructiveMotionBlurKernel(
      DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
      0,
    );
    if (maximumKernel.passCount > PARAMETER_CAPACITY) {
      throw new Error("Motion Blur: il massimo richiesto supera la capacità passaggi.");
    }
    const sourceTileMask = record.storageTileMask.slice();
    const shared = await requireSharedResources(engine.device);
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const parameterStride = Math.ceil(PARAMETER_BYTES / uniformAlignment) * uniformAlignment;

    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocazione Native raster Motion Blur layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Motion Blur immutable source layer ${record.id}`,
          size: {
            width: scratchBounds.width,
            height: scratchBounds.height,
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
          label: "Native raster Motion Blur immutable source view",
        });
        const createWorkTexture = (suffix: "A" | "B"): GPUTexture => (
          engine.device.createTexture({
            label: `Native raster Motion Blur RGBA16F work ${suffix} ${scratchBounds.width}x${scratchBounds.height}`,
            size: {
              width: scratchBounds.width,
              height: scratchBounds.height,
              depthOrArrayLayers: 1,
            },
            format: "rgba16float",
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT
              | GPUTextureUsage.TEXTURE_BINDING
              | GPUTextureUsage.COPY_SRC,
          })
        );
        const workTextureA = createWorkTexture("A");
        transaction.deferRollback(() => workTextureA.destroy());
        const workViewA = workTextureA.createView({
          label: "Native raster Motion Blur RGBA16F work A view",
        });
        const workTextureB = createWorkTexture("B");
        transaction.deferRollback(() => workTextureB.destroy());
        const workViewB = workTextureB.createView({
          label: "Native raster Motion Blur RGBA16F work B view",
        });
        const parameterBuffer = engine.device.createBuffer({
          label: "Native raster Motion Blur dynamic parameters",
          size: parameterStride * PARAMETER_CAPACITY,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => parameterBuffer.destroy());
        const bindGroup = (label: string, view: GPUTextureView): GPUBindGroup => (
          engine.device.createBindGroup({
            label,
            layout: shared.bindGroupLayout,
            entries: [
              {
                binding: 0,
                resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
              },
              { binding: 1, resource: view },
            ],
          })
        );
        const parameterUpload = new ArrayBuffer(parameterStride * PARAMETER_CAPACITY);
        const rgba8ResolveA = engine.layerFormat === "rgba8unorm"
          ? await createRgba16fToRgba8ResolveResources(
            engine.device,
            workViewA,
            engine.layerView,
            "Motion Blur",
          )
          : null;
        const rgba8ResolveB = engine.layerFormat === "rgba8unorm"
          ? await createRgba16fToRgba8ResolveResources(
            engine.device,
            workViewB,
            engine.layerView,
            "Motion Blur work B",
          )
          : null;
        transaction.deferRollback(() => {
          destroyRgba16fToRgba8ResolveResources(rgba8ResolveA);
          destroyRgba16fToRgba8ResolveResources(rgba8ResolveB);
        });
        const created: ActiveRasterMotionBlurSession = {
          layerId: record.id,
          sourceFormat: engine.layerFormat,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          workTextureA,
          workViewA,
          workTextureB,
          workViewB,
          parameterBuffer,
          parameterStride,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          sourceBindGroup: bindGroup(
            "Native raster Motion Blur immutable source bind group",
            sourceView,
          ),
          workBindGroupA: bindGroup(
            "Native raster Motion Blur work A input bind group",
            workViewA,
          ),
          workBindGroupB: bindGroup(
            "Native raster Motion Blur work B input bind group",
            workViewB,
          ),
          rgba8ResolveA,
          rgba8ResolveB,
          shared,
          memoryBytes:
            scratchBounds.width * scratchBounds.height * (
              (engine.layerFormat === "rgba16float" ? 8 : 4)
              + BYTES_PER_RGBA16F_PIXEL * 2
            )
            + parameterStride * PARAMETER_CAPACITY
            + (rgba8ResolveA?.memoryBytes ?? 0)
            + (rgba8ResolveB?.memoryBytes ?? 0),
          distance,
          angle,
          resultBounds: initialResultBounds,
          resultTileMask: tileMaskCoveringRect(
            sourceTileMask,
            initialResultBounds,
            engine.layerSize,
          ),
          presentedBounds: null,
          requestedSerial: 1,
          encodedSerial: 0,
          previewFrame: null,
          previewInFlight: null,
          previewFault: null,
          terminal: false,
        };
        const encoder = engine.device.createCommandEncoder({
          label: `Capture Native raster Motion Blur source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: { x: scratchBounds.x, y: scratchBounds.y, z: 0 },
          },
          { texture: sourceTexture },
          {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
        );
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Preparazione Motion Blur", 60_000);
        return created;
      },
    );
    engine.activeRasterMotionBlurSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus(
      `Anteprima Motion Blur ${distance.toFixed(0)} px a ${angle.toFixed(0)} gradi: Applica o Annulla.`,
      "ok",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterMotionBlurSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Avvio Motion Blur fallito e ripristino incompleto: ricarica la pagina.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterMotionBlurSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Avvio Motion Blur fallito: ${previewError(error).message}; `
        + `ripristino fallito: ${previewError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterMotionBlur(
  engine: BrushEngine,
  distanceValue: unknown,
  angleValue: unknown,
): RasterMotionBlurSnapshot {
  const session = engine.activeRasterMotionBlurSession;
  if (!session) throw new Error("Nessuna sessione Motion Blur aperta.");
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Motion Blur interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Motion Blur sta già terminando.");
  const distance = normalizeDestructiveMotionBlurDistance(distanceValue);
  const angle = normalizeDestructiveMotionBlurAngle(angleValue);
  if (distance === session.distance && angle === session.angle) return snapshot(session);
  session.distance = distance;
  session.angle = angle;
  const result = destructiveMotionBlurBounds(
    session.sourceBounds,
    distance,
    angle,
    engine.layerSize,
    engine.layerSize,
  ) as DirtyRect;
  session.resultBounds = result;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    result,
    engine.layerSize,
  );
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus(
    `Anteprima Motion Blur ${distance.toFixed(0)} px a ${angle.toFixed(0)} gradi…`,
    "working",
  );
  return snapshot(session);
}

export async function cancelRasterMotionBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterMotionBlurSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Motion Blur sta già terminando.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Annullamento Motion Blur fallito: ricarica la pagina.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterMotionBlurSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus(
    "Motion Blur annullato: i pixel originali sono stati ripristinati.",
    "ok",
  );
  return true;
}

export async function commitRasterMotionBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterMotionBlurSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Motion Blur interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Motion Blur sta già terminando.");
  if (session.distance === 0) {
    await cancelRasterMotionBlur(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    await flushPreview(engine, session);
    const record = engine.layerStack.active;
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("Texture hot del raster sfocato mancante.");
    seed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.resultTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const kernel = destructiveMotionBlurKernel(session.distance, session.angle);
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "motion-blur",
      distance: session.distance,
      angle: session.angle,
      sampleCount: kernel.sampleCount,
      passCount: kernel.passCount,
      supportX: kernel.supportX,
      supportY: kernel.supportY,
      precision: "rgba16float-f32-accumulation",
      edgeMode: DESTRUCTIVE_MOTION_BLUR_EDGE_MODE,
      seed,
      baseBounds: { ...session.resultBounds },
      baseTileMask: session.resultTileMask.slice(),
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
        "Commit Motion Blur fallito e rollback incompleto: ricarica la pagina.",
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
        `Commit Motion Blur fallito: ${operationMessage}; rollback fallito: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterMotionBlurSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Motion Blur ${session.distance.toFixed(0)} px a ${session.angle.toFixed(0)} gradi applicato ai pixel: un solo Undo.`,
    "ok",
  );
  return true;
}
