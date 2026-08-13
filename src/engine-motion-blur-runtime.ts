/** Transactional destructive Motion Blur for the selected native raster layer. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-residency-runtime";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-resources-runtime";
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
} from "./motion-blur-core";
import { tileMaskCoveringRect } from "./raster-transform-math";

export const DESTRUCTIVE_MOTION_BLUR_RUNTIME_BUILD =
  "destructive-motion-blur-webgpu-v2-document-edge-clamp-logarithmic-exposures-rgba16float";
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
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly intermediateTexture: GPUTexture;
  readonly intermediateView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterStride: number;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadF32: Float32Array;
  readonly sourceBindGroup: GPUBindGroup;
  readonly layerBindGroup: GPUBindGroup;
  readonly intermediateBindGroup: GPUBindGroup;
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
  record.storageTileMask.set(tileMaskCoveringRect(tileMask, bounds));
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
  documentWidth: number,
  documentHeight: number,
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
  session.parameterUploadI32[word + 10] = documentWidth;
  session.parameterUploadI32[word + 11] = documentHeight;
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
  session.intermediateTexture.destroy();
  session.parameterBuffer.destroy();
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
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (!resultBounds) throw new Error("Motion Blur: bounds risultato mancanti.");
  const dirtyRect = unionMotionBlurRects(
    session.presentedBounds,
    resultBounds,
  ) as DirtyRect;
  if (kernel.passCount > PARAMETER_CAPACITY) {
    throw new Error("Motion Blur: troppi passaggi per il buffer parametri.");
  }

  const fullLayerBounds: DirtyRect = {
    x: 0,
    y: 0,
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  };
  const offsets = kernel.shifts.map((shift, pass) => {
    const inputTextureBounds = pass === 0
      ? session.scratchBounds
      : pass % 2 === 1
        ? fullLayerBounds
        : session.scratchBounds;
    const inputValidBounds = pass === 0 ? session.scratchBounds : resultBounds;
    const writesIntermediate = pass % 2 === 1;
    return writePassParameters(session, pass, {
      inputTextureBounds,
      inputValidBounds,
      attachmentOriginX: writesIntermediate ? session.scratchBounds.x : 0,
      attachmentOriginY: writesIntermediate ? session.scratchBounds.y : 0,
      shiftX: shift.x,
      shiftY: shift.y,
    }, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
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
    const writesIntermediate = pass % 2 === 1;
    const renderPass = encoder.beginRenderPass({
      label: `Motion Blur exposure pass ${pass + 1}/${kernel.passCount}`,
      colorAttachments: [{
        view: writesIntermediate ? session.intermediateView : engine.layerView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    renderPass.setPipeline(session.shared.pipeline);
    const bindGroup = pass === 0
      ? session.sourceBindGroup
      : pass % 2 === 1
        ? session.layerBindGroup
        : session.intermediateBindGroup;
    renderPass.setBindGroup(0, bindGroup, [offsets[pass]]);
    const viewportX = writesIntermediate
      ? resultBounds.x - session.scratchBounds.x
      : resultBounds.x;
    const viewportY = writesIntermediate
      ? resultBounds.y - session.scratchBounds.y
      : resultBounds.y;
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

  // An even number of passes ends in the intermediate surface. Copy the exact
  // RGBA16F result into the authoritative layer without another resampling.
  if (kernel.passCount > 0 && kernel.passCount % 2 === 0) {
    encoder.copyTextureToTexture(
      {
        texture: session.intermediateTexture,
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
  engine.device.queue.submit([encoder.finish()]);

  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    resultBounds,
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
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Motion Blur distruttivo richiede un documento RGBA16F.");
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
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("Il raster non contiene pixel sfocabili.");
    const distance = normalizeDestructiveMotionBlurDistance(initialDistance);
    const angle = normalizeDestructiveMotionBlurAngle(initialAngle);
    const initialResultBounds = destructiveMotionBlurBounds(
      sourceBounds,
      distance,
      angle,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
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
          format: "rgba16float",
          usage:
            GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => sourceTexture.destroy());
        const sourceView = sourceTexture.createView({
          label: "Native raster Motion Blur immutable source view",
        });
        const intermediateTexture = engine.device.createTexture({
          label: `Native raster Motion Blur logarithmic intermediate ${scratchBounds.width}x${scratchBounds.height}`,
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
        });
        transaction.deferRollback(() => intermediateTexture.destroy());
        const intermediateView = intermediateTexture.createView({
          label: "Native raster Motion Blur logarithmic intermediate view",
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
        const created: ActiveRasterMotionBlurSession = {
          layerId: record.id,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          intermediateTexture,
          intermediateView,
          parameterBuffer,
          parameterStride,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          sourceBindGroup: bindGroup(
            "Native raster Motion Blur immutable source bind group",
            sourceView,
          ),
          layerBindGroup: bindGroup(
            "Native raster Motion Blur authoritative layer bind group",
            engine.layerSamplingView,
          ),
          intermediateBindGroup: bindGroup(
            "Native raster Motion Blur intermediate bind group",
            intermediateView,
          ),
          shared,
          memoryBytes:
            scratchBounds.width * scratchBounds.height * BYTES_PER_RGBA16F_PIXEL * 2
            + parameterStride * PARAMETER_CAPACITY,
          distance,
          angle,
          resultBounds: initialResultBounds,
          resultTileMask: tileMaskCoveringRect(
            sourceTileMask,
            initialResultBounds,
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
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect;
  session.resultBounds = result;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    result,
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
