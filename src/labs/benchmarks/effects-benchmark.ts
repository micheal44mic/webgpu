import {
  DEFAULT_RASTER_BEVEL_STYLE,
  copyRasterBevelStyle,
  rasterBevelInfluenceBounds,
  type RasterBevelRect,
  type RasterBevelStyle,
} from "../../bevel-core";
import {
  RASTER_BEVEL_RENDERER_BUILD,
  RasterBevelRenderer,
  type RasterBevelEncodeResult,
  type RasterBevelFieldState,
} from "../../bevel-renderer";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  copyRasterStrokeStyle,
  rasterStrokeScratchExtentForWidth,
  type RasterStrokeRect,
  type RasterStrokeStyle,
} from "../../stroke-core";
import {
  RASTER_STROKE_RENDERER_BUILD,
  RasterStrokeRenderer,
  type RasterStrokeEncodeResult,
} from "../../stroke-renderer";
import {
  EFFECTS_WORKING_SET_STRATEGY,
  EffectsWorkbench,
  type EffectsLayerFormat,
} from "../../effects-workbench";
import { EFFECTS_SCRATCH_POOL_STRATEGY } from "../../effects-scratch-pool";

export const EFFECTS_WORKBENCH_BENCHMARK_MEASUREMENT =
  "wall-clock-onSubmittedWorkDone-queue-prefix-plus-js-callback" as const;

export interface EffectsWorkbenchBenchmarkOptions {
  device: GPUDevice;
  sourceTexture: GPUTexture;
  layerFormat: EffectsLayerFormat;
  lightGlazeUniformBuffer: GPUBuffer;
  thicknessTailUniformBuffer: GPUBuffer;
  documentWidth: number;
  documentHeight: number;
  gpuLabel: string;
  timestampQueriesSupported: boolean;
  samples?: number;
  onWorkbenchChanged?: (workbench: EffectsWorkbench | null) => void;
  onMemoryChanged?: () => void;
}

export interface EffectsWorkbenchBenchmarkSample {
  operation: "retarget" | "destroy-recreate";
  cpuSetupAndEncodeMs: number;
  queueCompletionMs: number;
  totalMs: number;
  stroke: RasterStrokeEncodeResult;
  bevel: RasterBevelEncodeResult;
}

export interface EffectsWorkbenchBenchmarkSummary {
  cpuSetupAndEncodeMedianMs: number;
  queueCompletionMedianMs: number;
  totalMedianMs: number;
  bevelResolvedPixelsMedian: number;
  samples: EffectsWorkbenchBenchmarkSample[];
}

export interface EffectsWorkbenchBenchmarkScenario {
  id: string;
  contentId: "small-1000x800" | "full-canvas";
  contentBounds: RasterBevelRect;
  contentPixels: number;
  boundingFieldEnabled: boolean;
  fieldMode: "full-document" | "tile-aligned-influence-bbox";
  fieldState: RasterBevelFieldState;
  heightfieldMemoryMiB: number;
  persistentAndScratchMemoryMiB: number;
  scratchPoolStrategy: typeof EFFECTS_SCRATCH_POOL_STRATEGY;
  scratchPoolCurrentMiB: number;
  scratchPoolPeakMiB: number;
  scratchPoolRequirementsMiB: Readonly<Record<string, number>>;
  retarget: EffectsWorkbenchBenchmarkSummary;
  destroyRecreate: EffectsWorkbenchBenchmarkSummary;
}

export interface EffectsWorkbenchBenchmarkReport {
  strategy: typeof EFFECTS_WORKING_SET_STRATEGY;
  measurement: typeof EFFECTS_WORKBENCH_BENCHMARK_MEASUREMENT;
  documentWidth: number;
  documentHeight: number;
  layerFormat: EffectsLayerFormat;
  gpuLabel: string;
  timestampQueriesSupported: boolean;
  sampleCount: number;
  strokeBuild: string;
  bevelBuild: string;
  strokeStyle: RasterStrokeStyle;
  bevelStyle: RasterBevelStyle;
  scenarios: EffectsWorkbenchBenchmarkScenario[];
}

interface RendererPair {
  workbench: EffectsWorkbench;
  stroke: RasterStrokeRenderer;
  bevel: RasterBevelRenderer;
}

interface ContentCase {
  id: EffectsWorkbenchBenchmarkScenario["contentId"];
  bounds: RasterBevelRect;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarize(
  samples: EffectsWorkbenchBenchmarkSample[],
): EffectsWorkbenchBenchmarkSummary {
  return {
    cpuSetupAndEncodeMedianMs: median(samples.map((sample) => sample.cpuSetupAndEncodeMs)),
    queueCompletionMedianMs: median(samples.map((sample) => sample.queueCompletionMs)),
    totalMedianMs: median(samples.map((sample) => sample.totalMs)),
    bevelResolvedPixelsMedian: median(
      samples.map((sample) => sample.bevel.resolvedPixels),
    ),
    samples,
  };
}

function benchmarkStyles(): {
  stroke: RasterStrokeStyle;
  bevel: RasterBevelStyle;
} {
  const stroke = copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE);
  stroke.enabled = true;
  const bevel = copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE);
  bevel.enabled = true;
  return { stroke, bevel };
}

function benchmarkContentCases(
  documentWidth: number,
  documentHeight: number,
): ContentCase[] {
  const smallWidth = Math.min(1_000, documentWidth);
  const smallHeight = Math.min(800, documentHeight);
  return [
    {
      id: "small-1000x800",
      bounds: {
        x: Math.max(0, Math.min(documentWidth - smallWidth, 384)),
        y: Math.max(0, Math.min(documentHeight - smallHeight, 512)),
        width: smallWidth,
        height: smallHeight,
      },
    },
    {
      id: "full-canvas",
      bounds: { x: 0, y: 0, width: documentWidth, height: documentHeight },
    },
  ];
}

async function createRendererPair(
  options: EffectsWorkbenchBenchmarkOptions,
  layerView: GPUTextureView,
  strokeStyle: RasterStrokeStyle,
  bevelStyle: RasterBevelStyle,
  boundingFieldEnabled: boolean,
): Promise<RendererPair> {
  const workbench = new EffectsWorkbench({
    device: options.device,
    view: layerView,
    format: options.layerFormat,
  });
  try {
    const bevel = await RasterBevelRenderer.create({
      device: options.device,
      scratchPool: workbench.scratchPool,
      documentWidth: options.documentWidth,
      documentHeight: options.documentHeight,
      layerView,
      lightGlazeUniformBuffer: options.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: options.thicknessTailUniformBuffer,
      boundingFieldEnabled,
    });
    workbench.attachBevelRenderer(bevel);
    bevel.setLightGlazeView(null);
    bevel.setThicknessTailView(null);
    bevel.updateStyleResources(bevelStyle);

    const stroke = await RasterStrokeRenderer.create({
      device: options.device,
      scratchPool: workbench.scratchPool,
      documentWidth: options.documentWidth,
      documentHeight: options.documentHeight,
      layerFormat: options.layerFormat,
      layerView,
      lightGlazeUniformBuffer: options.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: options.thicknessTailUniformBuffer,
      scratchExtent: rasterStrokeScratchExtentForWidth(strokeStyle.width),
      bevelBoundingFieldEnabled: boundingFieldEnabled,
    });
    workbench.attachStrokeRenderer(stroke);
    stroke.setLightGlazeView(null);
    stroke.setThicknessTailView(null);
    stroke.setBevelResources(bevel.heightView, bevel.glossView);
    stroke.updateBevelFieldParameters(bevel.fieldState);
    stroke.updateBevelParameters(bevelStyle);
    options.onWorkbenchChanged?.(workbench);
    options.onMemoryChanged?.();
    return { workbench, stroke, bevel };
  } catch (error) {
    workbench.destroy();
    throw error;
  }
}

function encodeRebuild(
  options: EffectsWorkbenchBenchmarkOptions,
  pair: RendererPair,
  strokeStyle: RasterStrokeStyle,
  bevelStyle: RasterBevelStyle,
  content: ContentCase,
  boundingFieldEnabled: boolean,
  label: string,
): {
  encoder: GPUCommandEncoder;
  stroke: RasterStrokeEncodeResult;
  bevel: RasterBevelEncodeResult;
} {
  const fullDocument: RasterStrokeRect = {
    x: 0,
    y: 0,
    width: options.documentWidth,
    height: options.documentHeight,
  };
  const influenceBounds = rasterBevelInfluenceBounds(
    content.bounds,
    bevelStyle,
    options.documentWidth,
    options.documentHeight,
  );
  if (!influenceBounds) {
    throw new Error(`Bounds benchmark ${content.id} non validi.`);
  }
  const bevelTarget = boundingFieldEnabled ? influenceBounds : fullDocument;
  const encoder = options.device.createCommandEncoder({ label });
  const bevel = pair.bevel.encode({
    encoder,
    style: bevelStyle,
    sourceMode: "permanent",
    rebuildRect: bevelTarget,
    changeDetectionRect: null,
    clearHeight: true,
    fieldBounds: bevelTarget,
    allowFieldShrink: boundingFieldEnabled,
  });
  if (bevel.fieldReallocated) {
    pair.stroke.setBevelResources(pair.bevel.heightView, pair.bevel.glossView);
  }
  pair.stroke.updateBevelFieldParameters(bevel.fieldState);
  pair.stroke.updateBevelParameters(bevelStyle);
  // Coverage, mask and styled textures deliberately keep the full-document
  // workload in both variants. PR3 changes only the R32F bevel heightfield.
  const stroke = pair.stroke.encode({
    encoder,
    style: strokeStyle,
    bevelStyle,
    sourceMode: "permanent",
    rebuildRect: fullDocument,
    changeDetectionRect: null,
    composeRect: fullDocument,
    conditionalComposeRect: null,
    clearStyled: true,
    resetThresholdMask: true,
  });
  options.onMemoryChanged?.();
  return { encoder, stroke, bevel };
}

async function submitMeasured(
  options: EffectsWorkbenchBenchmarkOptions,
  operation: EffectsWorkbenchBenchmarkSample["operation"],
  startedAt: number,
  encoded: ReturnType<typeof encodeRebuild>,
): Promise<EffectsWorkbenchBenchmarkSample> {
  options.device.queue.submit([encoded.encoder.finish()]);
  const submittedAt = performance.now();
  await options.device.queue.onSubmittedWorkDone();
  const completedAt = performance.now();
  return {
    operation,
    cpuSetupAndEncodeMs: submittedAt - startedAt,
    queueCompletionMs: completedAt - submittedAt,
    totalMs: completedAt - startedAt,
    stroke: encoded.stroke,
    bevel: encoded.bevel,
  };
}

async function runScenario(
  options: EffectsWorkbenchBenchmarkOptions,
  styles: ReturnType<typeof benchmarkStyles>,
  content: ContentCase,
  boundingFieldEnabled: boolean,
  sampleCount: number,
  createSourceView: () => GPUTextureView,
): Promise<EffectsWorkbenchBenchmarkScenario> {
  let pair: RendererPair | null = await createRendererPair(
    options,
    createSourceView(),
    styles.stroke,
    styles.bevel,
    boundingFieldEnabled,
  );
  const retargetSamples: EffectsWorkbenchBenchmarkSample[] = [];
  const recreateSamples: EffectsWorkbenchBenchmarkSample[] = [];
  const id = `${content.id}-${boundingFieldEnabled ? "bbox-on" : "bbox-off"}`;
  try {
    const warmup = encodeRebuild(
      options,
      pair,
      styles.stroke,
      styles.bevel,
      content,
      boundingFieldEnabled,
      `EffectsWorkbench ${id} warm-up`,
    );
    options.device.queue.submit([warmup.encoder.finish()]);
    await options.device.queue.onSubmittedWorkDone();

    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = performance.now();
      pair.workbench.retarget({
        view: createSourceView(),
        format: options.layerFormat,
      });
      const encoded = encodeRebuild(
        options,
        pair,
        styles.stroke,
        styles.bevel,
        content,
        boundingFieldEnabled,
        `EffectsWorkbench ${id} retarget ${index + 1}/${sampleCount}`,
      );
      retargetSamples.push(await submitMeasured(options, "retarget", startedAt, encoded));
    }

    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = performance.now();
      pair.workbench.destroy();
      pair = null;
      options.onWorkbenchChanged?.(null);
      pair = await createRendererPair(
        options,
        createSourceView(),
        styles.stroke,
        styles.bevel,
        boundingFieldEnabled,
      );
      const encoded = encodeRebuild(
        options,
        pair,
        styles.stroke,
        styles.bevel,
        content,
        boundingFieldEnabled,
        `EffectsWorkbench ${id} destroy/recreate ${index + 1}/${sampleCount}`,
      );
      recreateSamples.push(
        await submitMeasured(options, "destroy-recreate", startedAt, encoded),
      );
    }

    const scratchPool = pair.workbench.scratchPool.snapshot();
    const fieldState = pair.bevel.fieldState;
    return {
      id,
      contentId: content.id,
      contentBounds: { ...content.bounds },
      contentPixels: content.bounds.width * content.bounds.height,
      boundingFieldEnabled,
      fieldMode: boundingFieldEnabled
        ? "tile-aligned-influence-bbox"
        : "full-document",
      fieldState,
      heightfieldMemoryMiB: fieldState.memoryBytes / (1024 * 1024),
      scratchPoolStrategy: EFFECTS_SCRATCH_POOL_STRATEGY,
      scratchPoolCurrentMiB: scratchPool.currentBytes / (1024 * 1024),
      scratchPoolPeakMiB: scratchPool.peakBytes / (1024 * 1024),
      scratchPoolRequirementsMiB: Object.fromEntries(
        Object.entries(scratchPool.requirements)
          .map(([effectId, bytes]) => [effectId, bytes / (1024 * 1024)]),
      ),
      persistentAndScratchMemoryMiB: (
        pair.stroke.persistentMemoryBytes
        + pair.bevel.heightMemoryBytes
        + pair.bevel.lutMemoryBytes
        + pair.bevel.controlMemoryBytes
        + scratchPool.currentBytes
      ) / (1024 * 1024),
      retarget: summarize(retargetSamples),
      destroyRecreate: summarize(recreateSamples),
    };
  } finally {
    pair?.workbench.destroy();
    await options.device.queue.onSubmittedWorkDone();
    options.onWorkbenchChanged?.(null);
    options.onMemoryChanged?.();
  }
}

export async function benchmarkEffectsWorkbench(
  options: EffectsWorkbenchBenchmarkOptions,
): Promise<EffectsWorkbenchBenchmarkReport> {
  const sampleCount = Math.max(1, Math.min(10, Math.floor(options.samples ?? 3)));
  const styles = benchmarkStyles();
  const createSourceView = (): GPUTextureView => options.sourceTexture.createView({
    label: "EffectsWorkbench benchmark source mip 0",
    baseMipLevel: 0,
    mipLevelCount: 1,
  });
  const scenarios: EffectsWorkbenchBenchmarkScenario[] = [];
  for (const content of benchmarkContentCases(options.documentWidth, options.documentHeight)) {
    for (const boundingFieldEnabled of [false, true]) {
      scenarios.push(await runScenario(
        options,
        styles,
        content,
        boundingFieldEnabled,
        sampleCount,
        createSourceView,
      ));
    }
  }
  return {
    strategy: EFFECTS_WORKING_SET_STRATEGY,
    measurement: EFFECTS_WORKBENCH_BENCHMARK_MEASUREMENT,
    documentWidth: options.documentWidth,
    documentHeight: options.documentHeight,
    layerFormat: options.layerFormat,
    gpuLabel: options.gpuLabel,
    timestampQueriesSupported: options.timestampQueriesSupported,
    sampleCount,
    strokeBuild: RASTER_STROKE_RENDERER_BUILD,
    bevelBuild: RASTER_BEVEL_RENDERER_BUILD,
    strokeStyle: copyRasterStrokeStyle(styles.stroke),
    bevelStyle: copyRasterBevelStyle(styles.bevel),
    scenarios,
  };
}
