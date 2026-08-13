import { getGpuMemoryStats } from "../engine-reports";
import type { BrushEngine } from "../brush-engine";
import { type BenchmarkResult, type BrushSettings } from "../engine-types";
import {
  SHAPE_DIRECT_DECODE_STRATEGY,
  SHAPE_OCCUPANCY_STRATEGY,
  isTexturizedGrainActive,
  usesStrokeGlazeRenderer,
} from "../engine-strategies";


import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  MAX_STAMPS_PER_BATCH,
  SHAPE_OCCUPANCY_GRID_SIZE,
} from "../engine-limits";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_SIZE,
  LAYER_STORAGE_TILE_WIDTH,
} from "../layer-storage-study";
import { type DirtyRect, type Stamp } from "../engine-stroke-types";
import { type LayerBakeResources } from "../engine-layer-resources";
import { clamp } from "../color";
import { type EffectsWorkbenchBenchmarkReport } from "./benchmarks/effects-benchmark";
import {
  type LayerCompressionLayerReport,
  type LayerCompressionStudyProgress,
  type LayerCompressionStudyReport,
} from "./memory/layer-compression-study-contract";
import { decodeFloat16, encodeFloat16 } from "../float16";

export async function runBenchmark(engine: BrushEngine, baseStampCount: number): Promise<BenchmarkResult> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  if (engine.historyBusy || engine.activeStroke || engine.layerSwitchBusy || engine.activeVectorHistoryEdit) {
    throw new Error("Concludi prima il tratto o l'operazione Undo/Redo.");
  }
  if (engine.documentWideResetBlockedByLayers) {
    throw new Error(
      "Il benchmark azzera la cronologia dell'intero documento: tienilo a un solo livello.",
    );
  }
  if (engine.settings.tool === "blend") {
    throw new Error("Il benchmark GPU sintetico misura Paint: seleziona Pennello Paint.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error("Deseleziona i pixel prima del benchmark Paint canonico.");
  }
  if (engine.lightGlazeSession) {
    await engine.waitForIdle();
  }
  // Il benchmark sottomette stamp senza passare da beginStroke: gli asset
  // lazy vanno garantiti qui, mai campionare i placeholder.
  if (engine.settings.shape === "shape") {
    await engine.ensureShapeResources();
  }
  if (engine.settings.grainMode !== "off") {
    await engine.ensureGrainResources();
  }
  if (usesStrokeGlazeRenderer(engine.settings)) {
    await engine.ensureLightGlazeResources(engine.settings.blendMode);
  }

  const count = clamp(Math.round(baseStampCount), 1, Math.min(12_000, MAX_STAMPS_PER_BATCH));
  engine.invalidateAdaptivePreview();
  engine.pendingStamps.length = 0;
  engine.pendingBlendBatches.length = 0;
  engine.activeStroke = null;
  engine.resetHistoryState();
  engine.publishHistoryState();

  if (engine.frameRequest !== null) {
    cancelAnimationFrame(engine.frameRequest);
    engine.frameRequest = null;
  }

  await engine.device.queue.onSubmittedWorkDone();
  const benchmarkSettings = engine.settings;
  const stamps = generateBenchmarkStamps(engine, count, benchmarkSettings);

  if (usesStrokeGlazeRenderer(benchmarkSettings)) {
    engine.startLightGlazeSession(0, benchmarkSettings);
    engine.lightGlazeSession!.endRequested = true;
    engine.lightGlazeSession!.commitRequested = true;
  }

  const completionStart = performance.now();
  const timing = engine.submitImmediate(stamps, true, benchmarkSettings);
  const cpuSubmitMs = timing.totalCpuMs;
  engine.clearRequested = false;
  engine.displayDirty = false;
  engine.layerHasContent = true;
  await engine.device.queue.onSubmittedWorkDone();
  const gpuCompletionMs = performance.now() - completionStart;

  // Il benchmark resta escluso dalle proprie misure di history, ma il suo
  // risultato visibile diventa comunque un'unica azione annullabile.
  const benchmarkHistorySlice = engine.captureCurrentInstanceBufferForHistory(
    stamps.length,
    `Benchmark Paint · ${stamps.length} stamp`,
  );
  await engine.device.queue.onSubmittedWorkDone();
  const historyActionId = engine.history.reserveActionId();
  for (const stamp of stamps) {
    stamp.historyActionId = historyActionId;
  }
  engine.recordHistoryBatch(stamps, benchmarkSettings, timing, true, benchmarkHistorySlice);

  engine.totalBaseStamps += stamps.length;
  engine.avoidedLogicalDraws += stamps.length * Math.max(0, benchmarkSettings.count - 1);
  engine.recordRenderedFrame(performance.now());
  engine.publishStats();
  engine.publishHistoryState();

  const averageRadiusSquared = stamps.reduce((sum, stamp) => sum + stamp.radius * stamp.radius, 0) / stamps.length;
  const estimatedCoveredFragments = Math.round(
    Math.PI * averageRadiusSquared * stamps.length * benchmarkSettings.count,
  );
  const strategy = [
    "1 draw instanziata",
    `${benchmarkSettings.count} copie fisiche GPU per stamp base`,
    benchmarkSettings.shape === "shape"
      ? engine.lastShapeSamplingStrategy === SHAPE_OCCUPANCY_STRATEGY
        ? `bitmask alpha ${SHAPE_OCCUPANCY_GRID_SIZE}², mip ${engine.lastShapeOccupancyMipLevel}, campioni 2K ammessi ${(engine.lastShapeOccupancyCoverageRatio * 100).toFixed(1)}%`
        : `quad Shape legacy da 4 vertici, fallback ${engine.lastShapeOccupancyFallbackReason}, mappa candidata ${(engine.lastShapeOccupancyCandidateCoverageRatio * 100).toFixed(1)}%`
      : "geometria quad triangle-strip (4 vertici)",
    benchmarkSettings.shape === "shape"
      ? "coverage da maschera alpha 2048²"
      : "coverage fragment smoothstep generica",
    benchmarkSettings.shape === "shape"
      ? engine.shapeMaskDecodeStrategy === SHAPE_DIRECT_DECODE_STRATEGY
        ? "PNG grayscale decodificata direttamente"
        : "PNG decodificata tramite fallback canvas"
      : "nessuna maschera Shape",
    benchmarkSettings.shape === "shape"
      ? `scatter rotazione ${(benchmarkSettings.shapeScatter * 100).toFixed(0)}%`
      : "orientamento circolare invariato",
    "riuso copySeed per jitter colore per copia",
    "dirty rect direzionale conservativo",
    isTexturizedGrainActive(benchmarkSettings)
      ? `grain ${engine.grainTextureWidth}×${engine.grainTextureHeight} ${benchmarkSettings.grainMode} `
        + `${benchmarkSettings.grainFiltering}, `
        + `scale ${(benchmarkSettings.grainScale * 100).toFixed(0)}%, `
        + `depth ${(benchmarkSettings.grainDepth * 100).toFixed(0)}%`
      : "grain Off, pipeline standard",
  ].join(" · ");

  return {
    baseStamps: stamps.length,
    logicalCopies: stamps.length * benchmarkSettings.count,
    cpuSubmitMs,
    gpuCompletionMs,
    estimatedCoveredFragments,
    strategy,
  };
}

export function generateBenchmarkStamps(engine: BrushEngine, count: number, settings: BrushSettings): Stamp[] {
  const stamps = new Array<Stamp>(count);
  const centerX = DOCUMENT_WIDTH * 0.5;
  const centerY = DOCUMENT_HEIGHT * 0.5;
  const maximumPathRadius = Math.min(DOCUMENT_WIDTH, DOCUMENT_HEIGHT) * 0.39;

  for (let index = 0; index < count; index += 1) {
    const progress = count <= 1 ? 0 : index / (count - 1);
    const angle = progress * Math.PI * 18;
    const pathRadius = maximumPathRadius * (0.12 + progress * 0.88);
    const pressure = clamp(0.58 + Math.sin(progress * Math.PI * 15) * 0.28, 0.1, 1);
    const radius = Math.max(0.5, settings.size * 0.5);

    stamps[index] = {
      x: centerX + Math.cos(angle) * pathRadius,
      y: centerY + Math.sin(angle * 1.037) * pathRadius,
      radius,
      pressure,
      seed: (Math.imul(engine.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0,
      directionX: -Math.sin(angle),
      directionY: Math.cos(angle * 1.037),
      historyActionId: 0,
    };
  }

  return stamps;
}

export async function benchmarkEffectsWorkingSet(engine: BrushEngine, 
  samples = 3,
): Promise<EffectsWorkbenchBenchmarkReport> {
  if (!import.meta.env.DEV) {
    throw new Error("Il benchmark del banco effetti è disponibile solo in modalità dev.");
  }
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  if (
    engine.activeStroke
    || engine.historyBusy
    || engine.layerSwitchBusy
    || engine.rasterStrokeBusy
    || engine.rasterBevelBusy
    || engine.rasterOuterShadowBusy
    || engine.rasterInnerShadowBusy
  ) {
    throw new Error("Ferma il motore prima del benchmark del banco effetti.");
  }
  await engine.waitForIdle();
  if (
    engine.rasterStrokeRenderer
    || engine.rasterBevelRenderer
    || engine.rasterOuterShadowRenderer
    || engine.rasterInnerShadowRenderer
  ) {
    throw new Error(
      "Disattiva Sovrapposizione colore, Traccia, Smusso e Ombre prima del benchmark per evitare due working set residenti.",
    );
  }

  const originalWorkbench = engine.requireEffectsWorkbench();
  engine.rasterStrokeBusy = true;
  engine.rasterBevelBusy = true;
  engine.rasterOuterShadowBusy = true;
  engine.rasterInnerShadowBusy = true;
  engine.callbacks.onStatus?.(
    `Benchmark banco effetti ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT} in corso…`,
    "working",
  );
  try {
    const { benchmarkEffectsWorkbench } = await import("./benchmarks/effects-benchmark");
    const report = await benchmarkEffectsWorkbench({
      device: engine.device,
      sourceTexture: engine.layerTexture,
      layerFormat: engine.layerFormat,
      lightGlazeUniformBuffer: engine.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: engine.thicknessTailDisplayUniformBuffer,
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      gpuLabel: engine.gpuLabel,
      timestampQueriesSupported: engine.device.features.has("timestamp-query"),
      samples,
      onWorkbenchChanged: (workbench) => {
        engine.effectsWorkbench = workbench ?? originalWorkbench;
        engine.publishStats();
      },
      onMemoryChanged: () => engine.publishStats(),
    });
    console.info(
      `[EffectsWorkbench] benchmark ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT}`,
      report,
    );
    console.table(Object.fromEntries(report.scenarios.map((scenario) => [
      scenario.id,
      {
        retargetCpuMs: scenario.retarget.cpuSetupAndEncodeMedianMs,
        retargetQueueMs: scenario.retarget.queueCompletionMedianMs,
        retargetTotalMs: scenario.retarget.totalMedianMs,
        recreateTotalMs: scenario.destroyRecreate.totalMedianMs,
        heightfieldMiB: scenario.heightfieldMemoryMiB,
        resolvedPixels: scenario.retarget.bevelResolvedPixelsMedian,
      },
    ])));
    engine.callbacks.onStatus?.("Benchmark banco effetti completato.", "ok");
    return report;
  } finally {
    engine.effectsWorkbench = originalWorkbench;
    engine.rasterStrokeBusy = false;
    engine.rasterBevelBusy = false;
    engine.rasterOuterShadowBusy = false;
    engine.rasterInnerShadowBusy = false;
    engine.publishStats();
  }
}

export async function measureLayerColdCompressionStudy(engine: BrushEngine, 
  onProgress?: (progress: LayerCompressionStudyProgress) => void,
): Promise<LayerCompressionStudyReport> {
  if (!engine.layerCompressionTestEnabled) {
    throw new Error("Studio compressione livelli non abilitato per questa pagina.");
  }
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  if (engine.activeStroke || engine.historyBusy || engine.layerSwitchBusy) {
    throw new Error("La compressione richiede il motore fermo.");
  }
  if (
    typeof CompressionStream !== "function"
    || typeof DecompressionStream !== "function"
  ) {
    throw new Error("CompressionStream gzip non disponibile in questo browser.");
  }

  await engine.waitForIdle();
  if (engine.devReadbackActiveBytes !== 0) {
    throw new Error(
      `Compressione avviata con ${engine.devReadbackActiveBytes} byte readback ancora vivi.`,
    );
  }
  engine.devReadbackPeakBytes = 0;

  const {
    LAYER_COMPRESSION_CHUNK_TILE_COUNT,
    LAYER_COMPRESSION_CODEC,
    bytesToMiB,
    combineCompressionHashes,
    formatCompressionHash,
    measureLosslessGzipChunk,
  } = await import("../layer-compression-codec");
  const {
    LAYER_COMPRESSION_STUDY_BUILD,
    LAYER_COMPRESSION_STUDY_VERSION,
  } = await import("./memory/layer-compression-study-contract");
  const sources = engine.layerStack.layers.flatMap((record, index) => {
    if (index === engine.layerStack.activeIndex) {
      return [];
    }
    const gpu = engine.requireLayerGpu(record.id);
    if (record.hasContent && !gpu.cold) {
      throw new Error(
        `Livello inattivo ${record.id}: cold store autorevole mancante.`,
      );
    }
    return gpu.cold ? [{ record, index, cold: gpu.cold }] : [];
  });
  if (sources.length === 0) {
    throw new Error(
      "Servono almeno due livelli e un livello inattivo con contenuto.",
    );
  }

  const startedAt = performance.now();
  const countedGpuMiBBefore = getGpuMemoryStats(engine).countedTotalMiB;
  const studyBytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const tileByteLength =
    LAYER_STORAGE_TILE_WIDTH * LAYER_STORAGE_TILE_HEIGHT * studyBytesPerPixel;
  const totalTiles = sources.reduce(
    (total, source) => total + source.cold.tileIndices.length,
    0,
  );
  const layers: LayerCompressionLayerReport[] = [];
  let completedTiles = 0;
  let totalRawBytes = 0;
  let totalGzipBytes = 0;
  let totalAdaptiveBytes = 0;
  let totalEncodeMs = 0;
  let totalDecodeMs = 0;
  let totalZeroTiles = 0;
  let totalSolidTiles = 0;
  let totalRawFallbackChunks = 0;
  let totalChunkCount = 0;
  let maximumLogicalChunkWorkingBytes = 0;

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const { record, index, cold } = sources[sourceIndex];
    let rawBytes = 0;
    let gzipBytes = 0;
    let adaptiveBytes = 0;
    let encodeMs = 0;
    let decodeMs = 0;
    let zeroTileCount = 0;
    let solidTileCount = 0;
    let rawFallbackChunks = 0;
    let chunkCount = 0;
    let sourceHash = 0x811c9dc5;
    let restoredHash = 0x811c9dc5;

    for (
      let firstArrayLayer = 0;
      firstArrayLayer < cold.tileIndices.length;
      firstArrayLayer += LAYER_COMPRESSION_CHUNK_TILE_COUNT
    ) {
      const chunkTileCount = Math.min(
        LAYER_COMPRESSION_CHUNK_TILE_COUNT,
        cold.tileIndices.length - firstArrayLayer,
      );
      const payload = await engine.readLayerColdStorageTiles(
        cold,
        firstArrayLayer,
        chunkTileCount,
        `compressione livello ${record.id}`,
      );
      const expectedBytes = chunkTileCount * tileByteLength;
      if (payload.byteLength !== expectedBytes) {
        throw new Error(
          `Readback compressione livello ${record.id}: ${payload.byteLength} byte, `
          + `attesi ${expectedBytes}.`,
        );
      }
      const measurement = await measureLosslessGzipChunk(
        payload,
        tileByteLength,
      );
      rawBytes += measurement.rawBytes;
      gzipBytes += measurement.gzipBytes;
      adaptiveBytes += measurement.adaptiveStoredBytes;
      encodeMs += measurement.encodeMs;
      decodeMs += measurement.decodeMs;
      zeroTileCount += measurement.zeroTileCount;
      solidTileCount += measurement.solidTileCount;
      rawFallbackChunks += measurement.usedRawFallback ? 1 : 0;
      chunkCount += 1;
      sourceHash = combineCompressionHashes(
        sourceHash,
        measurement.sourceHash,
        measurement.rawBytes,
      );
      restoredHash = combineCompressionHashes(
        restoredHash,
        measurement.restoredHash,
        measurement.rawBytes,
      );
      maximumLogicalChunkWorkingBytes = Math.max(
        maximumLogicalChunkWorkingBytes,
        measurement.rawBytes * 2 + measurement.gzipBytes,
      );
      completedTiles += chunkTileCount;
      totalRawBytes += measurement.rawBytes;
      totalGzipBytes += measurement.gzipBytes;
      totalAdaptiveBytes += measurement.adaptiveStoredBytes;
      totalEncodeMs += measurement.encodeMs;
      totalDecodeMs += measurement.decodeMs;
      totalZeroTiles += measurement.zeroTileCount;
      totalSolidTiles += measurement.solidTileCount;
      totalRawFallbackChunks += measurement.usedRawFallback ? 1 : 0;
      totalChunkCount += 1;
      onProgress?.({
        layerNumber: sourceIndex + 1,
        layerCount: sources.length,
        layerName: record.name,
        completedTiles,
        totalTiles,
        rawMiB: bytesToMiB(totalRawBytes),
        adaptiveStoredMiB: bytesToMiB(totalAdaptiveBytes),
        savingsPercent: totalRawBytes === 0
          ? 0
          : (1 - totalAdaptiveBytes / totalRawBytes) * 100,
      });
      if ((totalChunkCount & 3) === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    if (rawBytes !== cold.memoryBytes) {
      throw new Error(
        `Livello ${record.id}: misurati ${rawBytes} byte, cold store `
        + `dichiara ${cold.memoryBytes}.`,
      );
    }
    if (sourceHash !== restoredHash) {
      throw new Error(`Livello ${record.id}: hash finale non identico.`);
    }
    const adaptiveSavings = rawBytes - adaptiveBytes;
    layers.push({
      index,
      id: record.id,
      name: record.name,
      tileCount: cold.tileIndices.length,
      chunkCount,
      rawMiB: bytesToMiB(rawBytes),
      gzipMiB: bytesToMiB(gzipBytes),
      adaptiveStoredMiB: bytesToMiB(adaptiveBytes),
      adaptiveSavingsMiB: bytesToMiB(adaptiveSavings),
      adaptiveSavingsPercent: rawBytes === 0
        ? 0
        : adaptiveSavings / rawBytes * 100,
      compressionRatio: adaptiveBytes === 0 ? 0 : rawBytes / adaptiveBytes,
      encodeMs,
      decodeMs,
      zeroTileCount,
      solidTileCount,
      rawFallbackChunks,
      sourceHash: formatCompressionHash(sourceHash),
      restoredHash: formatCompressionHash(restoredHash),
      byteIdentical: true,
    });
  }

  if (engine.devReadbackActiveBytes !== 0) {
    throw new Error(
      `Compressione terminata con ${engine.devReadbackActiveBytes} byte readback vivi.`,
    );
  }
  const countedGpuMiBAfter = getGpuMemoryStats(engine).countedTotalMiB;
  if (Math.abs(countedGpuMiBAfter - countedGpuMiBBefore) > 0.000_001) {
    throw new Error(
      `La diagnostica ha cambiato la memoria GPU conteggiata: `
      + `${countedGpuMiBBefore} → ${countedGpuMiBAfter} MiB.`,
    );
  }
  const adaptiveSavingsBytes = totalRawBytes - totalAdaptiveBytes;
  return {
    version: LAYER_COMPRESSION_STUDY_VERSION,
    build: LAYER_COMPRESSION_STUDY_BUILD,
    passed: true,
    measurementOnly: true,
    codec: LAYER_COMPRESSION_CODEC,
    tileSizePx: LAYER_STORAGE_TILE_SIZE,
    chunkTileCount: LAYER_COMPRESSION_CHUNK_TILE_COUNT,
    layerFormat: engine.layerFormat,
    bytesPerPixel: engine.layerFormat === "rgba16float" ? 8 : 4,
    recordedAt: new Date().toISOString(),
    elapsedMs: performance.now() - startedAt,
    layerCount: engine.layerStack.count,
    inactiveLayerCount: engine.layerStack.count - 1,
    measuredLayerCount: layers.length,
    tileCount: totalTiles,
    chunkCount: totalChunkCount,
    rawMiB: bytesToMiB(totalRawBytes),
    gzipMiB: bytesToMiB(totalGzipBytes),
    adaptiveStoredMiB: bytesToMiB(totalAdaptiveBytes),
    adaptiveSavingsMiB: bytesToMiB(adaptiveSavingsBytes),
    adaptiveSavingsPercent: totalRawBytes === 0
      ? 0
      : adaptiveSavingsBytes / totalRawBytes * 100,
    compressionRatio: totalAdaptiveBytes === 0
      ? 0
      : totalRawBytes / totalAdaptiveBytes,
    encodeMs: totalEncodeMs,
    decodeMs: totalDecodeMs,
    zeroTileCount: totalZeroTiles,
    solidTileCount: totalSolidTiles,
    rawFallbackChunks: totalRawFallbackChunks,
    byteIdentical: true,
    countedGpuMiBBefore,
    countedGpuMiBAfter,
    temporaryReadbackPeakMiB: bytesToMiB(engine.devReadbackPeakBytes),
    maximumLogicalChunkWorkingMiB: bytesToMiB(maximumLogicalChunkWorkingBytes),
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gpuLabel: engine.gpuLabel,
    },
    layers,
  };
}

export async function measureActiveStyleBakeGap(engine: BrushEngine, rect: DirtyRect): Promise<{
  comparedPixels: number;
  comparedBytes: number;
  differingPixels: number;
  differingBytes: number;
  maxDelta: number;
  maxDeltaByChannel: readonly [number, number, number, number];
  firstDifference: {
    x: number;
    y: number;
    channel: "r" | "g" | "b" | "a";
    live: number;
    analyticBake: number;
  } | null;
}> {
  if (!import.meta.env.DEV) {
    throw new Error("Misura fwidth/bake disponibile solo in modalità dev.");
  }
  if (!engine.initialized || engine.layerFormat !== "rgba16float") {
    throw new Error("La misura fwidth/bake richiede un layer RGBA16F inizializzato.");
  }
  if (engine.layerStack.count !== 1 || !engine.styleStackActive()) {
    throw new Error("La misura fwidth/bake richiede un solo livello con effetti attivi.");
  }
  await engine.waitForIdle();

  const previousView = {
    centerX: engine.viewCenterX,
    centerY: engine.viewCenterY,
    zoom: engine.zoom,
    rotation: engine.viewRotation,
    rotationCos: engine.viewRotationCos,
    rotationSin: engine.viewRotationSin,
    rotationGestureRaw: engine.viewRotationGestureRaw,
    rotationGestureActive: engine.viewRotationGestureActive,
    rotationSnappedToZero: engine.viewRotationSnappedToZero,
    hasFittedView: engine.hasFittedView,
  };
  let candidate: LayerBakeResources | null = null;
  try {
    engine.viewCenterX = rect.x + rect.width * 0.5;
    engine.viewCenterY = rect.y + rect.height * 0.5;
    engine.zoom = 1;
    engine.viewRotation = 0;
    engine.viewRotationCos = 1;
    engine.viewRotationSin = 0;
    engine.viewRotationGestureRaw = 0;
    engine.viewRotationGestureActive = false;
    engine.viewRotationSnappedToZero = true;
    engine.hasFittedView = true;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    const live = await engine.readPresentationLayerRect(rect);

    const record = engine.layerStack.active;
    const gpu = engine.requireLayerGpu(record.id);
    candidate = await engine.createLayerBakeCandidate(
      record,
      (gpu.bake?.generation ?? 0) + 1,
      false,
    );
    const analytic = await engine.readTexturePixels(
      candidate.texture,
      rect,
      "bake analitico per misura fwidth",
    );
    if (analytic.length !== live.length * 2) {
      throw new Error("Misura fwidth/bake: dimensioni readback incoerenti.");
    }
    const analyticView = new DataView(
      analytic.buffer,
      analytic.byteOffset,
      analytic.byteLength,
    );

    const srgbToLinear = (value: number): number => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
    const linearToSrgb = (value: number): number => value <= 0.0031308
      ? value * 12.92
      : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
    const quantizeUnorm = (value: number): number => {
      const scaled = clamp(value, 0, 1) * 255;
      const lower = Math.floor(scaled);
      const fraction = scaled - lower;
      if (fraction < 0.5) {
        return lower;
      }
      if (fraction > 0.5) {
        return lower + 1;
      }
      return lower % 2 === 0 ? lower : lower + 1;
    };
    const activeAlpha = record.visible ? clamp(record.opacity, 0, 1) : 0;
    const channelNames = ["r", "g", "b", "a"] as const;
    const maxDeltaByChannel = [0, 0, 0, 0] as [number, number, number, number];
    let differingPixels = 0;
    let differingBytes = 0;
    let firstDifference: {
      x: number;
      y: number;
      channel: "r" | "g" | "b" | "a";
      live: number;
      analyticBake: number;
    } | null = null;
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const pixelIndex = row * width + column;
        const offset = pixelIndex * 4;
        const analyticOffset = pixelIndex * 8;
        const analyticRed = decodeFloat16(analyticView.getUint16(analyticOffset, true));
        const analyticGreen = decodeFloat16(analyticView.getUint16(analyticOffset + 2, true));
        const analyticBlue = decodeFloat16(analyticView.getUint16(analyticOffset + 4, true));
        const analyticAlpha = decodeFloat16(analyticView.getUint16(analyticOffset + 6, true));
        const alpha = analyticAlpha * activeAlpha;
        const checkerX = Math.floor((rect.x + column + 0.5) / 96);
        const checkerY = Math.floor((rect.y + row + 0.5) / 96);
        const backgroundSrgb = ((checkerX + checkerY) & 1) === 0 ? 0.91 : 0.82;
        const backgroundLinear = srgbToLinear(backgroundSrgb);
        const expected = [
          quantizeUnorm(linearToSrgb(
            analyticRed * activeAlpha + backgroundLinear * (1 - alpha),
          )),
          quantizeUnorm(linearToSrgb(
            analyticGreen * activeAlpha + backgroundLinear * (1 - alpha),
          )),
          quantizeUnorm(linearToSrgb(
            analyticBlue * activeAlpha + backgroundLinear * (1 - alpha),
          )),
          255,
        ];
        let pixelDiffers = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(live[offset + channel] - expected[channel]);
          maxDeltaByChannel[channel] = Math.max(maxDeltaByChannel[channel], delta);
          if (delta > 0) {
            differingBytes += 1;
            pixelDiffers = true;
            firstDifference ??= {
              x: Math.floor(rect.x) + column,
              y: Math.floor(rect.y) + row,
              channel: channelNames[channel],
              live: live[offset + channel],
              analyticBake: expected[channel],
            };
          }
        }
        if (pixelDiffers) {
          differingPixels += 1;
        }
      }
    }
    return {
      comparedPixels: width * height,
      comparedBytes: live.length,
      differingPixels,
      differingBytes,
      maxDelta: Math.max(...maxDeltaByChannel),
      maxDeltaByChannel,
      firstDifference,
    };
  } finally {
    engine.destroyLayerBake(candidate);
    engine.viewCenterX = previousView.centerX;
    engine.viewCenterY = previousView.centerY;
    engine.zoom = previousView.zoom;
    engine.viewRotation = previousView.rotation;
    engine.viewRotationCos = previousView.rotationCos;
    engine.viewRotationSin = previousView.rotationSin;
    engine.viewRotationGestureRaw = previousView.rotationGestureRaw;
    engine.viewRotationGestureActive = previousView.rotationGestureActive;
    engine.viewRotationSnappedToZero = previousView.rotationSnappedToZero;
    engine.hasFittedView = previousView.hasFittedView;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
  }
}

export async function seedActiveLayerMemoryStress(engine: BrushEngine, 
  markerIndex: number,
  storageTileCount = LAYER_STORAGE_TILE_COUNT,
): Promise<void> {
  if (!engine.layerMemoryStressTestEnabled) {
    throw new Error("Stress memoria livelli non abilitato per questa pagina.");
  }
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Lo stress memoria da 1000 MiB richiede il formato RGBA16F.");
  }
  if (engine.styleStackActive()) {
    throw new Error(
      "Disattiva Sovrapposizione colore, Traccia, Smusso e Ombre prima dello stress memoria.",
    );
  }
  if (
    !Number.isInteger(storageTileCount)
    || storageTileCount < 1
    || storageTileCount > LAYER_STORAGE_TILE_COUNT
  ) {
    throw new Error(
      `Numero tile stress non valido: ${storageTileCount}; atteso 1-${LAYER_STORAGE_TILE_COUNT}.`,
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  await engine.waitForIdle();

  const markerSize = 64;
  const gridColumn = markerIndex % 4;
  const gridRow = Math.floor(markerIndex / 4) % 4;
  const markerCellWidth = DOCUMENT_WIDTH / 4;
  const markerCellHeight = DOCUMENT_HEIGHT / 4;
  const x = Math.floor(gridColumn * markerCellWidth + (markerCellWidth - markerSize) * 0.5);
  const y = Math.floor(gridRow * markerCellHeight + (markerCellHeight - markerSize) * 0.5);
  const red = 72 + (markerIndex * 73) % 176;
  const green = 72 + (markerIndex * 109) % 176;
  const blue = 72 + (markerIndex * 151) % 176;
  const pixels = new Uint16Array(markerSize * markerSize * 4);
  const redF16 = encodeFloat16(red / 255);
  const greenF16 = encodeFloat16(green / 255);
  const blueF16 = encodeFloat16(blue / 255);
  const opaqueF16 = encodeFloat16(1);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = redF16;
    pixels[offset + 1] = greenF16;
    pixels[offset + 2] = blueF16;
    pixels[offset + 3] = opaqueF16;
  }
  engine.device.queue.writeTexture(
    { texture: engine.layerTexture, origin: { x, y, z: 0 } },
    pixels,
    { bytesPerRow: markerSize * 8, rowsPerImage: markerSize },
    { width: markerSize, height: markerSize, depthOrArrayLayers: 1 },
  );
  await engine.waitForGpuCapped(`Marker stress memoria livello ${markerIndex + 1}`);

  const markerRect = { x, y, width: markerSize, height: markerSize };
  engine.layerHasContent = true;
  engine.noteLayerMutation(markerRect, false);
  // The marker remains tiny so merged-surface rebuilds stay interactive. Its
  // real tile is always included, then deterministic additional tiles are
  // marked until the requested cold-store capacity is reached.
  const storageTileMask = engine.layerStack.active.storageTileMask;
  storageTileMask.fill(0);
  const markerTileIndex =
    Math.floor(y / LAYER_STORAGE_TILE_HEIGHT) * LAYER_STORAGE_GRID_SIZE
    + Math.floor(x / LAYER_STORAGE_TILE_WIDTH);
  const markStorageTile = (tileIndex: number): void => {
    const wordIndex = tileIndex >>> 5;
    storageTileMask[wordIndex] |= 1 << (tileIndex & 31);
  };
  markStorageTile(markerTileIndex);
  let markedTileCount = 1;
  for (
    let tileIndex = 0;
    tileIndex < LAYER_STORAGE_TILE_COUNT && markedTileCount < storageTileCount;
    tileIndex += 1
  ) {
    if (tileIndex !== markerTileIndex) {
      markStorageTile(tileIndex);
      markedTileCount += 1;
    }
  }
  engine.persistActiveLayerState();
  engine.paintDisplayMipValidThroughLevel = 0;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.displayDirty = true;
  engine.requestRender();
  engine.publishStats();
  engine.scheduleLayerColdCompression();
}

export function setLayerCompositeTestView(engine: BrushEngine, centerX: number, centerY: number, zoom = 1): void {
  if (!import.meta.env.DEV) {
    throw new Error("Vista test compositing disponibile solo in modalità dev.");
  }
  engine.viewCenterX = centerX;
  engine.viewCenterY = centerY;
  engine.zoom = clamp(zoom, 0.02, 64);
  engine.viewRotation = 0;
  engine.viewRotationCos = 1;
  engine.viewRotationSin = 0;
  engine.viewRotationGestureRaw = 0;
  engine.viewRotationGestureActive = false;
  engine.viewRotationSnappedToZero = true;
  engine.hasFittedView = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.displayDirty = true;
  engine.notifyViewChange();
  engine.requestRender();
}
