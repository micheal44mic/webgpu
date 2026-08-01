/** Transactional WebGPU Transform for every native raster layer. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import type { LayerFormat, RasterTransformSnapshot } from "./engine-types";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { truncateRedoHistory } from "./engine-history-runtime";
import { publishMixedScene } from "./engine-vector-text-runtime";
import type { DirtyRect } from "./engine-stroke-types";
import type { RasterTransformHistoryAction } from "./engine-history-types";
import {
  normalizeRasterTransform,
  packRasterTransformUniforms,
  rasterTransformBounds,
  rasterTransformDirtyRect,
  rasterTransformSamplingBounds,
  rasterTransformSamplingPadding,
  rasterTransformScratchRect,
  rasterTransformTileMask,
  RASTER_TRANSFORM_UNIFORM_BYTES,
  type RasterTransformAffine,
} from "./raster-transform-math";
import {
  rasterTransformMipmapShader,
  rasterTransformShader,
  RASTER_TRANSFORM_SHADER_STRATEGY,
} from "./raster-transform-shader";

export const RASTER_LAYER_TRANSFORM_STRATEGY =
  "native-raster-tile-bbox-transparent-border-scale-aware-latest-frame-single-checkpoint-v3" as const;
const RASTER_TRANSFORM_TRANSPARENT_GUARD_PX = 2;

interface RasterTransformSharedResources {
  bindGroupLayout: GPUBindGroupLayout;
  mipBindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
  pipeline: GPURenderPipeline;
  mipPipeline: GPURenderPipeline;
}

export interface ActiveRasterTransformSession {
  readonly layerId: number;
  /** Stable handle/pivot geometry, restored from the latest Transform action. */
  readonly sourceBounds: DirtyRect;
  /** Actual filtered pixel support used by storage, effects and sampling. */
  readonly sourceRasterBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly sourceScratchRect: DirtyRect;
  readonly sourceTextureRect: DirtyRect;
  readonly sourcePivot: { x: number; y: number };
  readonly scratchTexture: GPUTexture;
  readonly scratchView: GPUTextureView;
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly uniformUpload: Float32Array;
  readonly shared: RasterTransformSharedResources;
  readonly memoryBytes: number;
  transform: RasterTransformAffine;
  resultBounds: DirtyRect | null;
  samplingBounds: DirtyRect | null;
  resultTileMask: Uint32Array;
  presentedSamplingBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  terminal: boolean;
}

const sharedResources = new WeakMap<
  BrushEngine,
  Map<LayerFormat, Promise<RasterTransformSharedResources>>
>();

function copyRect(rect: DirtyRect | null): DirtyRect | null {
  return rect ? { ...rect } : null;
}

function rasterTransformScratchMemoryBytes(
  width: number,
  height: number,
  mipLevelCount: number,
  format: LayerFormat,
): number {
  const bytesPerPixel = format === "rgba16float" ? 8 : 4;
  let bytes = RASTER_TRANSFORM_UNIFORM_BYTES;
  for (let level = 0; level < mipLevelCount; level += 1) {
    bytes += Math.max(1, Math.floor(width / 2 ** level))
      * Math.max(1, Math.floor(height / 2 ** level))
      * bytesPerPixel;
  }
  return bytes;
}

function transformSnapshot(session: ActiveRasterTransformSession): RasterTransformSnapshot {
  return {
    layerId: session.layerId,
    x: session.sourcePivot.x + session.transform.translationX,
    y: session.sourcePivot.y + session.transform.translationY,
    scale: session.transform.scale,
    rotation: session.transform.rotation,
    sourceBounds: { ...session.sourceBounds },
    resultBounds: copyRect(session.resultBounds),
  };
}

async function createSharedResources(
  engine: BrushEngine,
): Promise<RasterTransformSharedResources> {
  const format = engine.layerFormat;
  return runGpuAllocationTransaction(
    engine.device,
    `Pipeline Trasforma raster ${format}`,
    async () => {
      const transformModule = engine.device.createShaderModule({
        label: "Native raster Transform WGSL",
        code: rasterTransformShader,
      });
      const mipModule = engine.device.createShaderModule({
        label: "Native raster Transform exact mip WGSL",
        code: rasterTransformMipmapShader,
      });
      await Promise.all([
        assertShaderCompiled(transformModule, "Native raster Transform"),
        assertShaderCompiled(mipModule, "Native raster Transform mip"),
      ]);
      const bindGroupLayout = engine.device.createBindGroupLayout({
        label: "Native raster Transform bind group layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform", minBindingSize: RASTER_TRANSFORM_UNIFORM_BYTES },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float", viewDimension: "2d" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" },
          },
        ],
      });
      const mipBindGroupLayout = engine.device.createBindGroupLayout({
        label: "Native raster Transform mip bind group layout",
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        }],
      });
      const sampler = engine.device.createSampler({
        label: "Native raster Transform linear sampler",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "nearest",
        maxAnisotropy: 1,
      });
      const pipelineLayout = engine.device.createPipelineLayout({
        label: "Native raster Transform pipeline layout",
        bindGroupLayouts: [bindGroupLayout],
      });
      const mipPipelineLayout = engine.device.createPipelineLayout({
        label: "Native raster Transform mip pipeline layout",
        bindGroupLayouts: [mipBindGroupLayout],
      });
      const pipeline = engine.device.createRenderPipeline({
        label: `Native raster Transform ${format}`,
        layout: pipelineLayout,
        vertex: { module: transformModule, entryPoint: "vertexMain" },
        fragment: {
          module: transformModule,
          entryPoint: "fragmentMain",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
      const mipPipeline = engine.device.createRenderPipeline({
        label: `Native raster Transform exact mip ${format}`,
        layout: mipPipelineLayout,
        vertex: { module: mipModule, entryPoint: "vertexMain" },
        fragment: {
          module: mipModule,
          entryPoint: "fragmentMain",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
      return {
        bindGroupLayout,
        mipBindGroupLayout,
        sampler,
        pipeline,
        mipPipeline,
      };
    },
  );
}

async function requireSharedResources(
  engine: BrushEngine,
): Promise<RasterTransformSharedResources> {
  let byFormat = sharedResources.get(engine);
  byFormat ??= new Map<LayerFormat, Promise<RasterTransformSharedResources>>();
  let promise = byFormat.get(engine.layerFormat);
  if (!promise) {
    promise = createSharedResources(engine);
    byFormat.set(engine.layerFormat, promise);
    sharedResources.set(engine, byFormat);
  }
  try {
    return await promise;
  } catch (error) {
    byFormat.delete(engine.layerFormat);
    if (byFormat.size === 0) sharedResources.delete(engine);
    throw error;
  }
}

function destroySessionResources(session: ActiveRasterTransformSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.uniformBuffer.destroy();
  session.scratchTexture.destroy();
}

function writeSessionUniforms(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
  transform = session.transform,
): void {
  packRasterTransformUniforms({
    sourceScratchRect: session.sourceTextureRect,
    sourceContentBounds: session.sourceRasterBounds,
    sourcePivot: session.sourcePivot,
    transform,
  }, session.uniformUpload);
  engine.device.queue.writeBuffer(session.uniformBuffer, 0, session.uniformUpload);
}

function setAuthoritativeMetadata(
  engine: BrushEngine,
  bounds: DirtyRect | null,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  engine.layerContentBounds = copyRect(bounds);
  engine.layerHasContent = bounds !== null;
  record.contentBounds = copyRect(bounds);
  record.hasContent = bounds !== null;
  record.storageTileMask.set(tileMask);
}

function encodeTransformPass(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
  encoder: GPUCommandEncoder,
  dirtyRect: DirtyRect,
): void {
  const pass = encoder.beginRenderPass({
    label: "Native raster Transform preview",
    colorAttachments: [{
      view: engine.layerView,
      loadOp: "load",
      storeOp: "store",
    }],
  });
  pass.setPipeline(session.shared.pipeline);
  pass.setBindGroup(0, session.bindGroup);
  pass.setScissorRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function renderRequestedPreview(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
): void {
  if (engine.activeRasterTransformSession !== session) return;
  session.previewFrame = null;
  if (session.encodedSerial === session.requestedSerial) return;
  const dirtyRect = rasterTransformDirtyRect(
    session.presentedSamplingBounds,
    session.samplingBounds,
    engine.layerSize,
    0,
  ) as DirtyRect | null;
  if (dirtyRect) {
    writeSessionUniforms(engine, session);
    const encoder = engine.device.createCommandEncoder({
      label: `Native raster Transform preview #${session.requestedSerial}`,
    });
    encodeTransformPass(engine, session, encoder, dirtyRect);
    engine.device.queue.submit([encoder.finish()]);

    // FIFO ordering makes this presentation/effects submit observe the exact
    // transformed pixels without a CPU fence or an intermediate frame.
    // `resultBounds` is the geometric box used by the handles. The raster can
    // contain legitimate filtered alpha out to `samplingBounds`; that actual
    // pixel support is authoritative for effects, cold storage and replay.
    setAuthoritativeMetadata(engine, session.samplingBounds, session.resultTileMask);
    engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
    setAuthoritativeMetadata(engine, session.samplingBounds, session.resultTileMask);
  }
  session.presentedSamplingBounds = copyRect(session.samplingBounds);
  session.encodedSerial = session.requestedSerial;
  publishMixedScene(engine);
  engine.publishStats();
}

function schedulePreview(engine: BrushEngine, session: ActiveRasterTransformSession): void {
  if (session.previewFrame !== null) return;
  session.previewFrame = requestAnimationFrame(() => renderRequestedPreview(engine, session));
}

function flushPreview(engine: BrushEngine, session: ActiveRasterTransformSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  renderRequestedPreview(engine, session);
}

export async function beginRasterLayerTransform(
  engine: BrushEngine,
): Promise<RasterTransformSnapshot | null> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (engine.activeRasterTransformSession) {
    return transformSnapshot(engine.activeRasterTransformSession);
  }
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error(
      `Invariante Trasforma: raster selezionato ${selected.rasterLayerId}, `
      + `ma raster attivo ${record.id}.`,
    );
  }
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("Il livello raster selezionato è vuoto.");
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterTransformSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("Texture hot del raster da trasformare mancante.");
    const sourceRasterBounds = { ...record.contentBounds };
    let sourceBounds = sourceRasterBounds;
    for (let index = engine.historyCursor - 1; index >= 0; index -= 1) {
      const action = engine.historyActions[index];
      if (action.kind === "vector" || action.layerId !== record.id) continue;
      if (action.kind === "raster-transform" && action.geometryBounds) {
        sourceBounds = { ...action.geometryBounds };
      }
      break;
    }
    const sourceTileMask = record.storageTileMask.slice();
    const sourceScratchRect = rasterTransformScratchRect(
      sourceTileMask,
      engine.layerSize,
    ) as DirtyRect | null;
    if (!sourceScratchRect) {
      throw new Error("Il livello raster non contiene tile trasformabili.");
    }
    const sourcePivot = {
      x: sourceBounds.x + sourceBounds.width * 0.5,
      y: sourceBounds.y + sourceBounds.height * 0.5,
    };
    const sourceTextureRect = {
      x: sourceScratchRect.x - RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
      y: sourceScratchRect.y - RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
      width: sourceScratchRect.width + RASTER_TRANSFORM_TRANSPARENT_GUARD_PX * 2,
      height: sourceScratchRect.height + RASTER_TRANSFORM_TRANSPARENT_GUARD_PX * 2,
    };
    const shared = await requireSharedResources(engine);
    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocazione Trasforma raster ${sourceScratchRect.width}×${sourceScratchRect.height}`,
      async (transaction) => {
        const mipLevelCount = Math.floor(Math.log2(Math.max(
          sourceTextureRect.width,
          sourceTextureRect.height,
        ))) + 1;
        const scratchTexture = engine.device.createTexture({
          label: `Native raster Transform source layer ${record.id}`,
          size: {
            width: sourceTextureRect.width,
            height: sourceTextureRect.height,
            depthOrArrayLayers: 1,
          },
          mipLevelCount,
          format: engine.layerFormat,
          usage:
            GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        transaction.deferRollback(() => scratchTexture.destroy());
        const scratchView = scratchTexture.createView({
          label: `Native raster Transform source mips layer ${record.id}`,
          baseMipLevel: 0,
          mipLevelCount,
        });
        const uniformBuffer = engine.device.createBuffer({
          label: `Native raster Transform uniform layer ${record.id}`,
          size: RASTER_TRANSFORM_UNIFORM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => uniformBuffer.destroy());
        const bindGroup = engine.device.createBindGroup({
          label: `Native raster Transform bind group layer ${record.id}`,
          layout: shared.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: scratchView },
            { binding: 2, resource: shared.sampler },
          ],
        });
        const transform: RasterTransformAffine = {
          translationX: 0,
          translationY: 0,
          scale: 1,
          rotation: 0,
        };
        const created: ActiveRasterTransformSession = {
          layerId: record.id,
          sourceBounds,
          sourceRasterBounds,
          sourceTileMask,
          sourceScratchRect,
          sourceTextureRect,
          sourcePivot,
          scratchTexture,
          scratchView,
          uniformBuffer,
          bindGroup,
          uniformUpload: new Float32Array(RASTER_TRANSFORM_UNIFORM_BYTES / 4),
          shared,
          memoryBytes: rasterTransformScratchMemoryBytes(
            sourceTextureRect.width,
            sourceTextureRect.height,
            mipLevelCount,
            engine.layerFormat,
          ),
          transform,
          resultBounds: { ...sourceBounds },
          samplingBounds: rasterTransformSamplingBounds(
            sourceRasterBounds,
            sourcePivot,
            transform,
            engine.layerSize,
          ) as DirtyRect | null,
          resultTileMask: sourceTileMask.slice(),
          presentedSamplingBounds: { ...sourceRasterBounds },
          requestedSerial: 0,
          encodedSerial: 0,
          previewFrame: null,
          terminal: false,
        };
        writeSessionUniforms(engine, created);

        const encoder = engine.device.createCommandEncoder({
          label: `Native raster Transform immutable source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: { x: sourceScratchRect.x, y: sourceScratchRect.y, z: 0 },
          },
          {
            texture: scratchTexture,
            mipLevel: 0,
            origin: {
              x: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
              y: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
              z: 0,
            },
          },
          {
            width: sourceScratchRect.width,
            height: sourceScratchRect.height,
            depthOrArrayLayers: 1,
          },
        );
        for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel += 1) {
          const sourceView = scratchTexture.createView({
            baseMipLevel: mipLevel - 1,
            mipLevelCount: 1,
          });
          const targetView = scratchTexture.createView({
            baseMipLevel: mipLevel,
            mipLevelCount: 1,
          });
          const mipBindGroup = engine.device.createBindGroup({
            layout: shared.mipBindGroupLayout,
            entries: [{ binding: 0, resource: sourceView }],
          });
          const pass = encoder.beginRenderPass({
            label: `Native raster Transform mip ${mipLevel}`,
            colorAttachments: [{
              view: targetView,
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            }],
          });
          pass.setPipeline(shared.mipPipeline);
          pass.setBindGroup(0, mipBindGroup);
          pass.draw(3, 1, 0, 0);
          pass.end();
        }
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Preparazione Trasforma raster", 60_000);
        return created;
      },
    );
    engine.activeRasterTransformSession = session;
    engine.publishStatus(
      `Trasforma GPU pronto per ${record.name}: Applica o Annulla.`,
      "ok",
    );
    publishMixedScene(engine);
    engine.publishHistoryState();
    engine.publishStats();
    return transformSnapshot(session);
  } catch (error) {
    if (session) destroySessionResources(session);
    engine.activeRasterTransformSession = null;
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.scheduleLayerColdCompression();
    throw error;
  }
}

export function updateRasterLayerTransform(
  engine: BrushEngine,
  update: Partial<Pick<RasterTransformSnapshot, "x" | "y" | "scale" | "rotation">>,
): RasterTransformSnapshot {
  const session = engine.activeRasterTransformSession;
  if (!session) throw new Error("Nessuna sessione Trasforma raster aperta.");
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.terminal) {
    throw new Error("La trasformazione raster è già in fase di Applica/Annulla.");
  }
  const transform = normalizeRasterTransform({
    translationX: update.x === undefined
      ? session.transform.translationX
      : update.x - session.sourcePivot.x,
    translationY: update.y === undefined
      ? session.transform.translationY
      : update.y - session.sourcePivot.y,
    scale: update.scale ?? session.transform.scale,
    rotation: update.rotation ?? session.transform.rotation,
  });
  session.transform = transform;
  session.resultBounds = rasterTransformBounds(
    session.sourceBounds,
    session.sourcePivot,
    transform,
    // Content metadata describes actual transformed pixels. Filtering safety
    // belongs only to the transient dirty/scissor rect; persisting it here
    // would grow bounds and shift the pivot after every successive Apply.
    { documentSize: engine.layerSize, padding: 0 },
  ) as DirtyRect | null;
  const samplingPadding = rasterTransformSamplingPadding(transform);
  session.samplingBounds = rasterTransformSamplingBounds(
    session.sourceRasterBounds,
    session.sourcePivot,
    transform,
    engine.layerSize,
  ) as DirtyRect | null;
  session.resultTileMask = session.samplingBounds
    ? rasterTransformTileMask(
      session.sourceTileMask,
      session.sourceRasterBounds,
      session.sourcePivot,
      transform,
      { documentSize: engine.layerSize, padding: samplingPadding },
    )
    : new Uint32Array(session.sourceTileMask.length);
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  return transformSnapshot(session);
}

function rasterTransformMatrix(session: ActiveRasterTransformSession): readonly [
  number, number, number, number, number, number,
] {
  const cosine = Math.cos(session.transform.rotation);
  const sine = Math.sin(session.transform.rotation);
  const a = cosine * session.transform.scale;
  const b = sine * session.transform.scale;
  const c = -sine * session.transform.scale;
  const d = cosine * session.transform.scale;
  const destinationX = session.sourcePivot.x + session.transform.translationX;
  const destinationY = session.sourcePivot.y + session.transform.translationY;
  return [
    a,
    b,
    c,
    d,
    destinationX - a * session.sourcePivot.x - c * session.sourcePivot.y,
    destinationY - b * session.sourcePivot.x - d * session.sourcePivot.y,
  ];
}

function rasterTransformIsIdentity(session: ActiveRasterTransformSession): boolean {
  return Math.abs(session.transform.translationX) < 1e-7
    && Math.abs(session.transform.translationY) < 1e-7
    && Math.abs(session.transform.scale - 1) < 1e-7
    && Math.abs(session.transform.rotation) < 1e-7;
}

async function restoreOriginalPixels(
  engine: BrushEngine,
  session: ActiveRasterTransformSession,
): Promise<void> {
  flushPreview(engine, session);
  const identity: RasterTransformAffine = {
    translationX: 0,
    translationY: 0,
    scale: 1,
    rotation: 0,
  };
  const identitySamplingBounds = rasterTransformSamplingBounds(
    session.sourceRasterBounds,
    session.sourcePivot,
    identity,
    engine.layerSize,
  ) as DirtyRect | null;
  const dirtyRect = rasterTransformDirtyRect(
    session.presentedSamplingBounds,
    identitySamplingBounds,
    engine.layerSize,
    0,
  ) as DirtyRect | null;
  if (dirtyRect) {
    writeSessionUniforms(engine, session, identity);
    const encoder = engine.device.createCommandEncoder({
      label: `Cancel native raster Transform layer ${session.layerId}`,
    });
    encodeTransformPass(engine, session, encoder, dirtyRect);
    encoder.copyTextureToTexture(
      {
        texture: session.scratchTexture,
        mipLevel: 0,
        origin: {
          x: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
          y: RASTER_TRANSFORM_TRANSPARENT_GUARD_PX,
          z: 0,
        },
      },
      {
        texture: engine.layerTexture,
        origin: {
          x: session.sourceScratchRect.x,
          y: session.sourceScratchRect.y,
          z: 0,
        },
      },
      {
        width: session.sourceScratchRect.width,
        height: session.sourceScratchRect.height,
        depthOrArrayLayers: 1,
      },
    );
    engine.device.queue.submit([encoder.finish()]);
    setAuthoritativeMetadata(engine, session.sourceRasterBounds, session.sourceTileMask);
    engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
    setAuthoritativeMetadata(engine, session.sourceRasterBounds, session.sourceTileMask);
  }
  await engine.waitForGpuCapped("Annullamento Trasforma raster", 60_000);
}

export async function cancelRasterLayerTransform(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterTransformSession;
  if (!session) return false;
  if (session.terminal) {
    throw new Error("La trasformazione raster sta già terminando.");
  }
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    // Keep the immutable scratch and the session reachable: a second Cancel
    // can retry the exact restore instead of throwing away the only source.
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Annullamento Trasforma raster fallito: ricarica la pagina.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterTransformSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Trasformazione raster annullata.", "ok");
  return true;
}

export async function commitRasterLayerTransform(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterTransformSession;
  if (!session) return false;
  if (session.terminal) {
    throw new Error("La trasformazione raster sta già terminando.");
  }
  if (rasterTransformIsIdentity(session)) {
    await cancelRasterLayerTransform(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let retainSessionForRecovery = false;
  try {
    flushPreview(engine, session);
    await engine.waitForGpuCapped("Commit Trasforma raster", 60_000);
    const record = engine.layerStack.active;
    if (session.samplingBounds) {
      const hot = engine.requireLayerGpu(session.layerId).hot;
      if (!hot) throw new Error("Texture hot del raster trasformato mancante.");
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        session.resultTileMask.slice(),
        engine.nextHistoryActionId,
      );
    }
    // Allocate every JS payload before invalidating Redo. After the truncate,
    // publication is reduced to one array insertion and scalar assignments.
    const actionId = engine.nextHistoryActionId;
    const common = {
      id: actionId,
      kind: "raster-transform",
      layerId: session.layerId,
      baseTileMask: session.resultTileMask.slice(),
      geometryBounds: copyRect(session.resultBounds),
      matrix: rasterTransformMatrix(session),
      filterStrategy: RASTER_TRANSFORM_SHADER_STRATEGY,
    } as const;
    const action: RasterTransformHistoryAction = session.samplingBounds && seed
      ? {
        ...common,
        seed,
        baseBounds: { ...session.samplingBounds },
      }
      : {
        ...common,
        seed: null,
        baseBounds: null,
      };
    const cursorBefore = engine.historyCursor;
    const redoActions = engine.historyActions.slice(cursorBefore);
    const discardedVectorLength = engine.discardedVectorRasterHistoryActions.length;
    const discardedImportLength = engine.discardedRasterImportHistoryActions.length;
    const discardedTransformLength = engine.discardedRasterTransformHistoryActions.length;
    const compactionPendingBefore = engine.historyCompactionPending;
    try {
      truncateRedoHistory(engine);
      engine.historyActions.push(action);
      engine.nextHistoryActionId = actionId + 1;
      engine.historyCursor = engine.historyActions.length;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyCommittedActions += 1;
      }
    } catch (journalError) {
      engine.historyActions.length = cursorBefore;
      for (const redoAction of redoActions) engine.historyActions.push(redoAction);
      engine.historyCursor = cursorBefore;
      engine.nextHistoryActionId = actionId;
      engine.discardedVectorRasterHistoryActions.length = discardedVectorLength;
      engine.discardedRasterImportHistoryActions.length = discardedImportLength;
      engine.discardedRasterTransformHistoryActions.length = discardedTransformLength;
      engine.historyCompactionPending = compactionPendingBefore;
      throw journalError;
    }
  } catch (error) {
    // The history cursor is untouched until the checkpoint exists. Restore the
    // immutable source if allocation or publication fails.
    let rollbackError: unknown = null;
    try {
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Commit Trasforma raster fallito e rollback incompleto: ricarica la pagina.",
      );
    } finally {
      destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Commit Trasforma fallito: ${operationMessage}; rollback fallito: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterTransformSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus("Trasformazione raster applicata: un solo Undo.", "ok");
  return true;
}
