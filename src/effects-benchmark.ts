import {
  DEFAULT_RASTER_BEVEL_STYLE,
  copyRasterBevelStyle,
  type RasterBevelStyle,
} from "./bevel-core";
import {
  RasterBevelRenderer,
  type RasterBevelEncodeResult,
} from "./bevel-renderer";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  copyRasterStrokeStyle,
  rasterStrokeScratchExtentForWidth,
  type RasterStrokeRect,
  type RasterStrokeStyle,
} from "./stroke-core";
import {
  RasterStrokeRenderer,
  type RasterStrokeEncodeResult,
} from "./stroke-renderer";
import {
  EFFECTS_WORKING_SET_STRATEGY,
  EffectsWorkbench,
  type EffectsLayerFormat,
} from "./effects-workbench";

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
  samples: EffectsWorkbenchBenchmarkSample[];
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
  persistentAndScratchMemoryMiB: number;
  retarget: EffectsWorkbenchBenchmarkSummary;
  destroyRecreate: EffectsWorkbenchBenchmarkSummary;
}

interface RendererPair {
  workbench: EffectsWorkbench;
  stroke: RasterStrokeRenderer;
  bevel: RasterBevelRenderer;
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

async function createRendererPair(
  options: EffectsWorkbenchBenchmarkOptions,
  layerView: GPUTextureView,
  strokeStyle: RasterStrokeStyle,
  bevelStyle: RasterBevelStyle,
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
    });
    workbench.attachStrokeRenderer(stroke);
    stroke.setLightGlazeView(null);
    stroke.setThicknessTailView(null);
    stroke.setBevelResources(bevel.heightView, bevel.glossView);
    stroke.updateBevelParameters(bevelStyle);
    options.onWorkbenchChanged?.(workbench);
    options.onMemoryChanged?.();
    return { workbench, stroke, bevel };
  } catch (error) {
    workbench.destroy();
    throw error;
  }
}

function encodeFullDocumentRebuild(
  options: EffectsWorkbenchBenchmarkOptions,
  pair: RendererPair,
  strokeStyle: RasterStrokeStyle,
  bevelStyle: RasterBevelStyle,
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
  const encoder = options.device.createCommandEncoder({ label });
  const bevel = pair.bevel.encode({
    encoder,
    style: bevelStyle,
    sourceMode: "permanent",
    rebuildRect: fullDocument,
    changeDetectionRect: null,
    clearHeight: true,
  });
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
  encoded: ReturnType<typeof encodeFullDocumentRebuild>,
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
  let pair: RendererPair | null = await createRendererPair(
    options,
    createSourceView(),
    styles.stroke,
    styles.bevel,
  );
  const retargetSamples: EffectsWorkbenchBenchmarkSample[] = [];
  const recreateSamples: EffectsWorkbenchBenchmarkSample[] = [];
  try {
    const warmup = encodeFullDocumentRebuild(
      options,
      pair,
      styles.stroke,
      styles.bevel,
      "EffectsWorkbench benchmark warm-up",
    );
    options.device.queue.submit([warmup.encoder.finish()]);
    await options.device.queue.onSubmittedWorkDone();

    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = performance.now();
      pair.workbench.retarget({
        view: createSourceView(),
        format: options.layerFormat,
      });
      const encoded = encodeFullDocumentRebuild(
        options,
        pair,
        styles.stroke,
        styles.bevel,
        `EffectsWorkbench retarget benchmark ${index + 1}/${sampleCount}`,
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
      );
      const encoded = encodeFullDocumentRebuild(
        options,
        pair,
        styles.stroke,
        styles.bevel,
        `EffectsWorkbench destroy/recreate benchmark ${index + 1}/${sampleCount}`,
      );
      recreateSamples.push(
        await submitMeasured(options, "destroy-recreate", startedAt, encoded),
      );
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
      strokeBuild: pair.stroke.build,
      bevelBuild: pair.bevel.build,
      strokeStyle: copyRasterStrokeStyle(styles.stroke),
      bevelStyle: copyRasterBevelStyle(styles.bevel),
      persistentAndScratchMemoryMiB: (
        pair.stroke.persistentMemoryBytes
        + pair.stroke.scratchMemoryBytes
        + pair.bevel.heightMemoryBytes
        + pair.bevel.lutMemoryBytes
        + pair.bevel.controlMemoryBytes
        + pair.bevel.workspaceMemoryBytes
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
