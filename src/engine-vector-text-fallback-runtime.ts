import type {
  BrushEngine,
} from "./brush-engine";
import {
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
} from "./vector-text-gpu-shader";
import {
  vectorTextGpuDrawUsesBlur,
  type VectorTextRunTextureResources,
} from "./engine-vector-text-resources";
import {
  type VectorTextGpuDraw,
  type VectorTextPlacement,
  type VectorTextViewState,
} from "./vector-text-types";
import {
  vectorTextGpuRunBounds,
} from "./engine-geometry";
import { flushVectorTextGpuPresentations } from "./engine-vector-text-fast-runtime";
import {
  createVectorTextRunBindGroup,
  ensureVectorTextGpuBlurCache,
  ensureVectorTextGpuResource,
  rebuildVectorTextRunBindGroup,
  vectorTextFallbackPresentationComplete,
  writeVectorTextCaptureUniforms,
  writeVectorTextFallbackCaptureUniforms,
} from "./engine-vector-text-resources-runtime";

export function clearVectorTextFallbackPresentation(engine: BrushEngine): void {
  let changed = engine.vectorTextFallbackCaptureView !== null;
  for (const [key, resources] of engine.vectorTextRunTextures) {
    if (resources.fallbackTexture) {
      resources.fallbackTexture.destroy();
      resources.fallbackTexture = null;
      resources.fallbackView = null;
      changed = true;
      rebuildVectorTextRunBindGroup(engine, key, resources);
    }
  }
  engine.vectorTextFallbackCaptureView = null;
  writeVectorTextFallbackCaptureUniforms(engine);
  writeVectorTextCaptureUniforms(engine);
  if (changed && engine.initialized) {
    engine.displayDirty = true;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.requestRender();
  }
}


export function getVectorTextFallbackPresentationStats(engine: BrushEngine): {
  captureView: VectorTextViewState | null;
  textureCount: number;
  gpuMemoryMiB: number;
  complete: boolean;
} {
  const textureCount = [...engine.vectorTextRunTextures.values()].filter(
    (resources) => resources.fallbackTexture !== null,
  ).length;
  return {
    captureView: engine.vectorTextFallbackCaptureView
      ? { ...engine.vectorTextFallbackCaptureView }
      : null,
    textureCount,
    gpuMemoryMiB:
      textureCount
      * engine.vectorTextTextureWidth
      * engine.vectorTextTextureHeight
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL
      / (1024 * 1024),
    complete: vectorTextFallbackPresentationComplete(engine),
  };
}

/**
 * Rebuilds every live text run into candidate fallback textures with a fixed
 * scene-relative camera. Candidate views and bind groups are published only
 * after the whole batch has been encoded and submitted, so a topology change
 * can never expose a half-old/half-new fallback generation.
 */
export function rebuildVectorTextGpuFallbackPresentation(
  engine: BrushEngine,
  captureView: Readonly<VectorTextViewState>,
  runs: readonly {
    placement: VectorTextPlacement;
    draws: readonly VectorTextGpuDraw[];
  }[],
): { textureCount: number; gpuMemoryMiB: number } {
  flushVectorTextGpuPresentations(engine);
  const width = engine.vectorTextTextureWidth;
  const height = engine.vectorTextTextureHeight;
  if (
    width < 1
    || height < 1
    || captureView.canvasWidth !== width
    || captureView.canvasHeight !== height
  ) {
    throw new Error("Vista larga diversa dalle cache vettoriali del viewport.");
  }
  if (engine.vectorTextRunTextures.size === 0) {
    clearVectorTextFallbackPresentation(engine);
    return { textureCount: 0, gpuMemoryMiB: 0 };
  }

  const runByKey = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    readonly VectorTextGpuDraw[]
  >();
  for (const run of runs) {
    if (!run.placement.startsWith("text-run:")) {
      throw new Error("La cache larga accetta soltanto run testo segmentate.");
    }
    const key = run.placement as Extract<VectorTextPlacement, `text-run:${string}`>;
    if (runByKey.has(key)) {
      throw new Error(`Run testo duplicata nella cache larga: ${key}.`);
    }
    runByKey.set(key, run.draws);
  }
  if (
    runByKey.size !== engine.vectorTextRunTextures.size
    || [...engine.vectorTextRunTextures.keys()].some((key) => !runByKey.has(key))
  ) {
    throw new Error("La cache larga deve coprire atomicamente tutte le run testo vive.");
  }

  const candidates = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    {
      texture: GPUTexture;
      view: GPUTextureView;
      bindGroup: GPUBindGroup;
      resources: VectorTextRunTextureResources;
    }
  >();
  const pendingStart = engine.vectorTextGpuPendingRuns.length;
  try {
    for (const [key, draws] of runByKey) {
      const resources = engine.vectorTextRunTextures.get(key);
      if (!resources) {
        throw new Error(`Run testo GPU ${key} rimossa durante la cache larga.`);
      }
      const texture = engine.device.createTexture({
        label: `Vector text ${key} automatic wide fallback ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: VECTOR_TEXT_GPU_TARGET_FORMAT,
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      try {
        const view = texture.createView({
          label: `Vector text ${key} automatic wide fallback view`,
        });
        const bindGroup = createVectorTextRunBindGroup(
          engine,
          key,
          resources.view,
          view,
        );
        candidates.set(key, { texture, view, bindGroup, resources });
        const drawResources = draws.map((draw) => ensureVectorTextGpuResource(engine, draw));
        const blurResources = draws.map((draw) =>
          vectorTextGpuDrawUsesBlur(draw)
            ? ensureVectorTextGpuBlurCache(engine, draw)
            : null,
        );
        engine.vectorTextGpuPendingRuns.push({
          placement: key,
          resources,
          target: "fallback",
          targetTexture: texture,
          targetView: view,
          draws,
          drawResources,
          blurResources,
          view: { ...captureView },
          bounds: vectorTextGpuRunBounds(draws, captureView),
        });
      } catch (error) {
        candidates.delete(key);
        texture.destroy();
        throw error;
      }
    }
    flushVectorTextGpuPresentations(engine);
  } catch (error) {
    engine.vectorTextGpuPendingRuns.splice(pendingStart);
    for (const candidate of candidates.values()) candidate.texture.destroy();
    throw error;
  }

  const previousTextures: GPUTexture[] = [];
  for (const [key, candidate] of candidates) {
    if (candidate.resources.fallbackTexture) {
      previousTextures.push(candidate.resources.fallbackTexture);
    }
    candidate.resources.fallbackTexture = candidate.texture;
    candidate.resources.fallbackView = candidate.view;
    candidate.resources.bindGroup = candidate.bindGroup;
    if (!engine.vectorTextRunTextures.has(key)) {
      throw new Error(`Run testo GPU ${key} rimossa prima della pubblicazione larga.`);
    }
  }
  engine.vectorTextFallbackCaptureView = { ...captureView };
  writeVectorTextFallbackCaptureUniforms(engine);
  writeVectorTextCaptureUniforms(engine);
  for (const texture of previousTextures) texture.destroy();
  return {
    textureCount: candidates.size,
    gpuMemoryMiB: candidates.size * width * height
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL / (1024 * 1024),
  };
}

export function captureVectorTextFallbackPresentation(engine: BrushEngine): {
  textureCount: number;
  gpuMemoryMiB: number;
} {
  flushVectorTextGpuPresentations(engine);
  const width = engine.vectorTextTextureWidth;
  const height = engine.vectorTextTextureHeight;
  const sourceView = engine.vectorTextCaptureView;
  if (!sourceView || width < 1 || height < 1) {
    throw new Error("Nessuna presentazione vettoriale esatta da usare come copertura.");
  }
  const candidates = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    { texture: GPUTexture; view: GPUTextureView }
  >();
  const encoder = engine.device.createCommandEncoder({
    label: "Vector text wide fallback capture copies",
  });
  try {
    for (const [key, resources] of engine.vectorTextRunTextures) {
      if (!resources.initialized) continue;
      const texture = engine.device.createTexture({
        label: `Vector text ${key} wide fallback ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: VECTOR_TEXT_GPU_TARGET_FORMAT,
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      const view = texture.createView({
        label: `Vector text ${key} wide fallback view`,
      });
      candidates.set(key, { texture, view });
      encoder.copyTextureToTexture(
        { texture: resources.texture },
        { texture },
        { width, height, depthOrArrayLayers: 1 },
      );
    }
    if (candidates.size === 0) {
      throw new Error("Le cache vettoriali esatte non sono ancora inizializzate.");
    }
    engine.device.queue.submit([encoder.finish()]);
  } catch (error) {
    for (const candidate of candidates.values()) candidate.texture.destroy();
    throw error;
  }

  const previousTextures: GPUTexture[] = [];
  for (const [key, resources] of engine.vectorTextRunTextures) {
    const candidate = candidates.get(key);
    if (resources.fallbackTexture) previousTextures.push(resources.fallbackTexture);
    resources.fallbackTexture = candidate?.texture ?? null;
    resources.fallbackView = candidate?.view ?? null;
  }
  engine.vectorTextFallbackCaptureView = { ...sourceView };
  writeVectorTextFallbackCaptureUniforms(engine);
  for (const [key, resources] of engine.vectorTextRunTextures) {
    rebuildVectorTextRunBindGroup(engine, key, resources);
  }
  for (const texture of previousTextures) texture.destroy();
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.requestRender();
  return {
    textureCount: candidates.size,
    gpuMemoryMiB: candidates.size * width * height
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL / (1024 * 1024),
  };
}

export async function probeVectorTextFallbackAlpha(
  engine: BrushEngine,
  layerPoints: readonly { x: number; y: number }[],
): Promise<{ runCount: number; alphaPixelCounts: number[] }> {
  const fallbackRuns = [...engine.vectorTextRunTextures.values()].filter(
    (resources) => resources.fallbackTexture !== null,
  );
  const capture = engine.vectorTextFallbackCaptureView;
  if (fallbackRuns.length !== 1 || !capture || layerPoints.length === 0) {
    throw new Error("Il probe C richiede una sola run con copertura GPU pronta.");
  }
  const texture = fallbackRuns[0].fallbackTexture!;
  const probeSize = Math.max(
    1,
    Math.min(128, Math.floor(capture.canvasWidth), Math.floor(capture.canvasHeight)),
  );
  const bytesPerPixel = VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL;
  const bytesPerRow = Math.ceil(probeSize * bytesPerPixel / 256) * 256;
  const bytesPerProbe = bytesPerRow * probeSize;
  const readback = engine.device.createBuffer({
    label: `Vector text C fallback alpha witnesses ${layerPoints.length}`,
    size: bytesPerProbe * layerPoints.length,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = engine.device.createCommandEncoder({
      label: "Vector text C fallback alpha witness readback",
    });
    layerPoints.forEach((point, index) => {
      const deltaX = point.x - capture.centerX;
      const deltaY = point.y - capture.centerY;
      const screenX = capture.canvasWidth * 0.5 + capture.zoom * (
        capture.rotationCos * deltaX - capture.rotationSin * deltaY
      );
      const screenY = capture.canvasHeight * 0.5 + capture.zoom * (
        capture.rotationSin * deltaX + capture.rotationCos * deltaY
      );
      const originX = Math.max(
        0,
        Math.min(
          Math.floor(capture.canvasWidth) - probeSize,
          Math.round(screenX - probeSize * 0.5),
        ),
      );
      const originY = Math.max(
        0,
        Math.min(
          Math.floor(capture.canvasHeight) - probeSize,
          Math.round(screenY - probeSize * 0.5),
        ),
      );
      encoder.copyTextureToBuffer(
        { texture, origin: { x: originX, y: originY, z: 0 } },
        {
          buffer: readback,
          offset: index * bytesPerProbe,
          bytesPerRow,
          rowsPerImage: probeSize,
        },
        { width: probeSize, height: probeSize, depthOrArrayLayers: 1 },
      );
    });
    engine.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const alphaPixelCounts = layerPoints.map((_, pointIndex) => {
      let alphaPixels = 0;
      const base = pointIndex * bytesPerProbe;
      for (let y = 0; y < probeSize; y += 1) {
        for (let x = 0; x < probeSize; x += 1) {
          const alphaOffset = base + y * bytesPerRow + x * bytesPerPixel + 6;
          if ((bytes[alphaOffset] | bytes[alphaOffset + 1]) !== 0) alphaPixels += 1;
        }
      }
      return alphaPixels;
    });
    readback.unmap();
    return { runCount: fallbackRuns.length, alphaPixelCounts };
  } finally {
    readback.destroy();
  }
}

/**
 * Reads the actual fast-mode mixed-scene result before the opaque checker pass.
 * Unlike the fallback-source probe, this exercises the current camera uniforms,
 * dual-capture bind group, mode-3 shader branch, and the compositor submission
 * that is copied to the visible presentation cache.
 */
export async function probeVectorTextFastCompositeAlpha(
  engine: BrushEngine,
  layerPoints: readonly { x: number; y: number }[],
): Promise<{ alphaPixelCounts: number[] }> {
  const texture = engine.mixedSceneLinearTexture;
  const view = engine.getVectorTextViewState();
  if (
    !engine.vectorTextFastPresentationEnabled
    || engine.vectorTextFastPresentationMode !== "reproject-fallback"
    || !texture
    || layerPoints.length === 0
  ) {
    throw new Error("Il probe C richiede la composizione fast fallback attiva.");
  }
  if (
    engine.mixedSceneLinearWidth !== view.canvasWidth
    || engine.mixedSceneLinearHeight !== view.canvasHeight
  ) {
    throw new Error("La cache lineare C non corrisponde al viewport corrente.");
  }

  const probeSize = Math.max(
    1,
    Math.min(128, Math.floor(view.canvasWidth), Math.floor(view.canvasHeight)),
  );
  const bytesPerPixel = 8;
  const bytesPerRow = Math.ceil(probeSize * bytesPerPixel / 256) * 256;
  const bytesPerProbe = bytesPerRow * probeSize;
  const readback = engine.device.createBuffer({
    label: `Vector text C fast composite alpha witnesses ${layerPoints.length}`,
    size: bytesPerProbe * layerPoints.length,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = engine.device.createCommandEncoder({
      label: "Vector text C fast composite alpha witness readback",
    });
    layerPoints.forEach((point, index) => {
      const deltaX = point.x - view.centerX;
      const deltaY = point.y - view.centerY;
      const screenX = view.canvasWidth * 0.5 + view.zoom * (
        view.rotationCos * deltaX - view.rotationSin * deltaY
      );
      const screenY = view.canvasHeight * 0.5 + view.zoom * (
        view.rotationSin * deltaX + view.rotationCos * deltaY
      );
      const originX = Math.max(
        0,
        Math.min(
          Math.floor(view.canvasWidth) - probeSize,
          Math.round(screenX - probeSize * 0.5),
        ),
      );
      const originY = Math.max(
        0,
        Math.min(
          Math.floor(view.canvasHeight) - probeSize,
          Math.round(screenY - probeSize * 0.5),
        ),
      );
      encoder.copyTextureToBuffer(
        { texture, origin: { x: originX, y: originY, z: 0 } },
        {
          buffer: readback,
          offset: index * bytesPerProbe,
          bytesPerRow,
          rowsPerImage: probeSize,
        },
        { width: probeSize, height: probeSize, depthOrArrayLayers: 1 },
      );
    });
    engine.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const alphaPixelCounts = layerPoints.map((_, pointIndex) => {
      let alphaPixels = 0;
      const base = pointIndex * bytesPerProbe;
      for (let y = 0; y < probeSize; y += 1) {
        for (let x = 0; x < probeSize; x += 1) {
          const alphaOffset = base + y * bytesPerRow + x * bytesPerPixel + 6;
          if ((bytes[alphaOffset] | bytes[alphaOffset + 1]) !== 0) alphaPixels += 1;
        }
      }
      return alphaPixels;
    });
    readback.unmap();
    return { alphaPixelCounts };
  } finally {
    readback.destroy();
  }
}
