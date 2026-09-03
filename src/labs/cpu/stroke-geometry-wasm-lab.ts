import {
  beginStrokeGeometryJs,
  instantiateStrokeGeometryKernel,
} from "../../../wasm/stroke-geometry-kernel/runtime.mjs";
import type {
  StrokeGeometryOptions,
  StrokeGeometryProcessor,
  StrokeGeometrySample,
  StrokeGeometrySession,
  StrokeGeometryStats,
} from "../../../wasm/stroke-geometry-kernel/runtime.mjs";

const HUMAN_STROKE_API_URL = "/api/human-stroke";
const MEASURED_RUNS = 25;
const WARMUP_RUNS = 5;
const STREAM_BATCH_SIZE = 16;
const HIGH_STABILIZATION = 1;
const DENSE_SPACING_PERCENT = 0.25;
const NORMAL_SPACING_PERCENT = 1;
const DAB_STRIDE = 6;
const PACKED_DAB_LANES = [0, 1, 2, 4, 5] as const;
const SYNTHETIC_SAMPLE_COUNT = 4_800;
const SYNTHETIC_FREQUENCY_HZ = 240;
const SYNTHETIC_BRUSH_SIZE_PX = 96;

interface HumanStrokeFixture {
  readonly version: 1;
  readonly capturedAt: string;
  readonly settings: {
    readonly size: number;
  };
  readonly points: readonly StrokeGeometrySample[];
}

interface BenchmarkScenario {
  readonly id: string;
  readonly label: string;
  readonly source: "canonical-human-stroke" | "synthetic-240hz";
  readonly samples: readonly StrokeGeometrySample[];
  readonly brushSizePx: number;
  readonly spacingPercent: number;
  readonly options: StrokeGeometryOptions;
}

interface StreamingExecution {
  readonly authoritativeDabCount: number;
  readonly previewDabCount: number;
  readonly packedAuthoritativeBits: readonly number[];
  readonly packedPreviewBits: readonly number[];
  readonly stats: StrokeGeometryStats;
  readonly witness: number;
}

interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly runsMs: readonly number[];
}

function parseHumanStrokeFixture(value: unknown): HumanStrokeFixture {
  if (!value || typeof value !== "object") {
    throw new Error("The canonical stroke response is not an object.");
  }
  const candidate = value as {
    version?: unknown;
    capturedAt?: unknown;
    settings?: { size?: unknown };
    points?: unknown;
  };
  if (
    candidate.version !== 1
    || typeof candidate.capturedAt !== "string"
    || !candidate.settings
    || !Number.isFinite(candidate.settings.size)
    || Number(candidate.settings.size) <= 0
    || !Array.isArray(candidate.points)
    || candidate.points.length < 2
  ) {
    throw new Error("The canonical stroke response is incomplete.");
  }
  const points = candidate.points.map((value, index): StrokeGeometrySample => {
    if (!value || typeof value !== "object") {
      throw new Error(`Canonical stroke sample ${index} is not an object.`);
    }
    const sample = value as Partial<StrokeGeometrySample>;
    if (
      !Number.isFinite(sample.x)
      || !Number.isFinite(sample.y)
      || !Number.isFinite(sample.pressure)
      || !Number.isFinite(sample.timeMs)
    ) {
      throw new Error(`Canonical stroke sample ${index} is not finite.`);
    }
    return {
      x: Number(sample.x),
      y: Number(sample.y),
      pressure: Number(sample.pressure),
      timeMs: Number(sample.timeMs),
    };
  });
  return {
    version: 1,
    capturedAt: candidate.capturedAt,
    settings: { size: Number(candidate.settings.size) },
    points,
  };
}

async function fetchHumanStrokeFixture(): Promise<HumanStrokeFixture> {
  const response = await fetch(HUMAN_STROKE_API_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Canonical stroke request failed (${response.status}).`);
  }
  return parseHumanStrokeFixture(await response.json());
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createSynthetic240HzStroke(): StrokeGeometrySample[] {
  const intervalMs = 1_000 / SYNTHETIC_FREQUENCY_HZ;
  return Array.from({ length: SYNTHETIC_SAMPLE_COUNT }, (_, index) => ({
    x: 160 + index * 0.72 + Math.sin(index * 0.009) * 28,
    y: 520
      + Math.sin(index * 0.017) * 210
      + Math.sin(index * 0.061) * 35
      + Math.cos(index * 0.003) * 90,
    pressure: clamp(
      0.53 + Math.sin(index * 0.011) * 0.31 + Math.sin(index * 0.043) * 0.14,
      0.04,
      0.99,
    ),
    timeMs: index * intervalMs,
  }));
}

function spacingPixels(sizePx: number, spacingPercent: number): number {
  return Math.max(0.1, sizePx * spacingPercent / 100);
}

function createScenarios(fixture: HumanStrokeFixture): BenchmarkScenario[] {
  const canonical = (
    id: string,
    label: string,
    spacingPercent: number,
  ): BenchmarkScenario => ({
    id,
    label,
    source: "canonical-human-stroke",
    samples: fixture.points,
    brushSizePx: fixture.settings.size,
    spacingPercent,
    options: {
      stabilization: HIGH_STABILIZATION,
      spacingMode: "fixed",
      spacing: spacingPixels(fixture.settings.size, spacingPercent),
      batchSize: STREAM_BATCH_SIZE,
    },
  });
  return [
    canonical(
      "canonical-high-stabilization-dense",
      "Canonical stroke · high stabilization · 0.25% spacing",
      DENSE_SPACING_PERCENT,
    ),
    canonical(
      "canonical-high-stabilization-normal",
      "Canonical stroke · high stabilization · 1% spacing",
      NORMAL_SPACING_PERCENT,
    ),
    {
      id: "synthetic-240hz-high-stabilization",
      label: "Long synthetic stroke · 240 Hz · high stabilization · 0.25% spacing",
      source: "synthetic-240hz",
      samples: createSynthetic240HzStroke(),
      brushSizePx: SYNTHETIC_BRUSH_SIZE_PX,
      spacingPercent: DENSE_SPACING_PERCENT,
      options: {
        stabilization: HIGH_STABILIZATION,
        spacingMode: "fixed",
        spacing: spacingPixels(SYNTHETIC_BRUSH_SIZE_PX, DENSE_SPACING_PERCENT),
        batchSize: STREAM_BATCH_SIZE,
      },
    },
  ];
}

function splitStreamingBatches(
  samples: readonly StrokeGeometrySample[],
): readonly (readonly StrokeGeometrySample[])[] {
  const batches: StrokeGeometrySample[][] = [];
  for (let index = 1; index < samples.length; index += STREAM_BATCH_SIZE) {
    batches.push(samples.slice(index, index + STREAM_BATCH_SIZE));
  }
  return batches;
}

const floatBitsBuffer = new ArrayBuffer(4);
const floatBitsView = new DataView(floatBitsBuffer);

function float32Bits(value: number): number {
  floatBitsView.setFloat32(0, value, true);
  return floatBitsView.getUint32(0, true);
}

function appendPackedGeometryBits(source: Float64Array, target: number[]): void {
  if (source.length % DAB_STRIDE !== 0) {
    throw new Error("A geometry result does not contain complete dabs.");
  }
  for (let offset = 0; offset < source.length; offset += DAB_STRIDE) {
    for (const lane of PACKED_DAB_LANES) {
      target.push(float32Bits(source[offset + lane]));
    }
  }
}

function sampleWitness(values: Float64Array): number {
  if (values.length === 0) return 0;
  return values[0] + values[Math.floor(values.length / 2)] + values[values.length - 1];
}

function executeStreamingStroke(
  begin: NonNullable<StrokeGeometryProcessor["begin"]>,
  scenario: BenchmarkScenario,
  batches: readonly (readonly StrokeGeometrySample[])[],
  collectPackedOutput: boolean,
): StreamingExecution {
  const session: StrokeGeometrySession = begin(scenario.samples[0], {
    ...scenario.options,
    maximumBatchSize: STREAM_BATCH_SIZE,
  });
  const packedAuthoritativeBits: number[] = [];
  const packedPreviewBits: number[] = [];
  let authoritativeDabCount = 1;
  let previewDabCount = 0;
  let witness = sampleWitness(session.initialDab);
  let completed = false;
  try {
    if (collectPackedOutput) {
      appendPackedGeometryBits(session.initialDab, packedAuthoritativeBits);
    }
    for (const batch of batches) {
      const update = session.processBatch(batch, {
        includePreviewTail: true,
        includeTail: false,
      });
      authoritativeDabCount += update.dabs.length / DAB_STRIDE;
      previewDabCount += update.previewDabs.length / DAB_STRIDE;
      witness += sampleWitness(update.dabs) + sampleWitness(update.previewDabs);
      if (collectPackedOutput) {
        appendPackedGeometryBits(update.dabs, packedAuthoritativeBits);
        appendPackedGeometryBits(update.previewDabs, packedPreviewBits);
      }
    }
    const finalUpdate = session.finish();
    completed = true;
    authoritativeDabCount += finalUpdate.dabs.length / DAB_STRIDE;
    witness += sampleWitness(finalUpdate.dabs) + finalUpdate.stats.spacingCarry;
    if (collectPackedOutput) {
      appendPackedGeometryBits(finalUpdate.dabs, packedAuthoritativeBits);
    }
    return {
      authoritativeDabCount,
      previewDabCount,
      packedAuthoritativeBits,
      packedPreviewBits,
      stats: finalUpdate.stats,
      witness,
    };
  } finally {
    if (!completed) session.cancel();
  }
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * ratio) - 1),
  );
  return ordered[index];
}

function summarizeTimings(runsMs: readonly number[]): TimingSummary {
  return {
    medianMs: percentile(runsMs, 0.5),
    p95Ms: percentile(runsMs, 0.95),
    minimumMs: Math.min(...runsMs),
    maximumMs: Math.max(...runsMs),
    runsMs,
  };
}

function measure(operation: () => StreamingExecution): {
  readonly durationMs: number;
  readonly execution: StreamingExecution;
} {
  const startedAt = performance.now();
  const execution = operation();
  return {
    durationMs: performance.now() - startedAt,
    execution,
  };
}

function packedHash(values: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ ((value >>> 8) & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ ((value >>> 16) & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ ((value >>> 24) & 0xff), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function comparePackedBits(left: readonly number[], right: readonly number[]): {
  readonly passed: boolean;
  readonly valueCount: number;
  readonly mismatchCount: number;
  readonly firstMismatchIndex: number | null;
  readonly javascriptHash: string;
  readonly wasmHash: string;
} {
  const sharedLength = Math.min(left.length, right.length);
  let mismatchCount = Math.abs(left.length - right.length);
  let firstMismatchIndex: number | null = left.length === right.length ? null : sharedLength;
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] === right[index]) continue;
    mismatchCount += 1;
    firstMismatchIndex ??= index;
  }
  return {
    passed: mismatchCount === 0,
    valueCount: Math.max(left.length, right.length),
    mismatchCount,
    firstMismatchIndex,
    javascriptHash: packedHash(left),
    wasmHash: packedHash(right),
  };
}

function pressureRange(samples: readonly StrokeGeometrySample[]): {
  readonly minimum: number;
  readonly maximum: number;
} {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    minimum = Math.min(minimum, sample.pressure);
    maximum = Math.max(maximum, sample.pressure);
  }
  return { minimum, maximum };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runStrokeGeometryWasmBenchmark(): Promise<Record<string, unknown>> {
  const fixtureStartedAt = performance.now();
  const fixture = await fetchHumanStrokeFixture();
  const fixtureLoadMs = performance.now() - fixtureStartedAt;
  const scenarios = createScenarios(fixture);
  const batchesByScenario = new Map(
    scenarios.map((scenario) => [scenario.id, splitStreamingBatches(scenario.samples)]),
  );

  const moduleUrl = new URL(
    "../../../wasm/stroke-geometry-kernel/dist/stroke_geometry_kernel.wasm",
    import.meta.url,
  );
  const initializationStartedAt = performance.now();
  const moduleFetchStartedAt = performance.now();
  const moduleResponse = await fetch(moduleUrl, { cache: "force-cache" });
  if (!moduleResponse.ok) {
    throw new Error(`Stroke geometry module request failed (${moduleResponse.status}).`);
  }
  const moduleBytes = await moduleResponse.arrayBuffer();
  const moduleFetchMs = performance.now() - moduleFetchStartedAt;
  const moduleCompileStartedAt = performance.now();
  const compiledModule = await WebAssembly.compile(moduleBytes);
  const moduleCompileMs = performance.now() - moduleCompileStartedAt;
  const moduleInstantiationStartedAt = performance.now();
  const wasmProcessor = await instantiateStrokeGeometryKernel(compiledModule);
  const moduleInstantiationMs = performance.now() - moduleInstantiationStartedAt;
  const moduleInitializationMs = performance.now() - initializationStartedAt;
  if (wasmProcessor.backend !== "wasm" || !wasmProcessor.begin) {
    throw new Error("The local stroke geometry module did not expose the Wasm streaming path.");
  }
  const wasmBegin = wasmProcessor.begin;
  const initialLinearMemoryBytes = wasmProcessor.memoryBytes?.() ?? 0;

  for (const scenario of scenarios) {
    const batches = batchesByScenario.get(scenario.id);
    if (!batches) throw new Error(`Streaming batches are missing for ${scenario.id}.`);
    for (let run = 0; run < WARMUP_RUNS; run += 1) {
      if ((run & 1) === 0) {
        executeStreamingStroke(beginStrokeGeometryJs, scenario, batches, false);
        executeStreamingStroke(wasmBegin, scenario, batches, false);
      } else {
        executeStreamingStroke(wasmBegin, scenario, batches, false);
        executeStreamingStroke(beginStrokeGeometryJs, scenario, batches, false);
      }
    }
    await yieldToBrowser();
  }
  const warmedLinearMemoryBytes = wasmProcessor.memoryBytes?.() ?? 0;

  const reports: Record<string, unknown>[] = [];
  let benchmarkWitness = 0;
  let everyDabCountMatches = true;
  let everyPackedOutputMatches = true;
  let canonicalPackedOutputMatches = true;
  for (const scenario of scenarios) {
    const batches = batchesByScenario.get(scenario.id);
    if (!batches) throw new Error(`Streaming batches are missing for ${scenario.id}.`);
    const javascriptRunsMs: number[] = [];
    const wasmRunsMs: number[] = [];
    for (let run = 0; run < MEASURED_RUNS; run += 1) {
      const runJavascript = () => measure(
        () => executeStreamingStroke(beginStrokeGeometryJs, scenario, batches, false),
      );
      const runWasm = () => measure(
        () => executeStreamingStroke(wasmBegin, scenario, batches, false),
      );
      if ((run & 1) === 0) {
        const javascript = runJavascript();
        const wasm = runWasm();
        javascriptRunsMs.push(javascript.durationMs);
        wasmRunsMs.push(wasm.durationMs);
        benchmarkWitness += javascript.execution.witness + wasm.execution.witness;
      } else {
        const wasm = runWasm();
        const javascript = runJavascript();
        wasmRunsMs.push(wasm.durationMs);
        javascriptRunsMs.push(javascript.durationMs);
        benchmarkWitness += javascript.execution.witness + wasm.execution.witness;
      }
      if ((run + 1) % 5 === 0) await yieldToBrowser();
    }

    const javascriptOutput = executeStreamingStroke(
      beginStrokeGeometryJs,
      scenario,
      batches,
      true,
    );
    const wasmOutput = executeStreamingStroke(wasmBegin, scenario, batches, true);
    const authoritativePackedParity = comparePackedBits(
      javascriptOutput.packedAuthoritativeBits,
      wasmOutput.packedAuthoritativeBits,
    );
    const previewPackedParity = comparePackedBits(
      javascriptOutput.packedPreviewBits,
      wasmOutput.packedPreviewBits,
    );
    const dabCountParity = javascriptOutput.authoritativeDabCount
      === wasmOutput.authoritativeDabCount;
    const previewDabCountParity = javascriptOutput.previewDabCount
      === wasmOutput.previewDabCount;
    everyDabCountMatches &&= dabCountParity && previewDabCountParity;
    everyPackedOutputMatches &&= authoritativePackedParity.passed && previewPackedParity.passed;
    if (scenario.source === "canonical-human-stroke") {
      canonicalPackedOutputMatches &&= authoritativePackedParity.passed;
    }

    const javascript = summarizeTimings(javascriptRunsMs);
    const wasm = summarizeTimings(wasmRunsMs);
    reports.push({
      id: scenario.id,
      label: scenario.label,
      source: scenario.source,
      input: {
        sampleCount: scenario.samples.length,
        streamBatchSize: STREAM_BATCH_SIZE,
        streamBatchCount: batches.length,
        stabilization: HIGH_STABILIZATION,
        brushSizePx: scenario.brushSizePx,
        spacingPercent: scenario.spacingPercent,
        spacingPx: scenario.options.spacing,
        pressure: pressureRange(scenario.samples),
        durationMs: scenario.samples.at(-1)?.timeMs ?? 0,
      },
      javascript,
      wasm,
      comparison: {
        medianSpeedup: wasm.medianMs > 0 ? javascript.medianMs / wasm.medianMs : null,
        medianMsSaved: javascript.medianMs - wasm.medianMs,
        p95MsSaved: javascript.p95Ms - wasm.p95Ms,
      },
      parity: {
        dabCount: {
          passed: dabCountParity,
          javascript: javascriptOutput.authoritativeDabCount,
          wasm: wasmOutput.authoritativeDabCount,
        },
        previewDabCount: {
          passed: previewDabCountParity,
          javascript: javascriptOutput.previewDabCount,
          wasm: wasmOutput.previewDabCount,
        },
        authoritativePackedF32: authoritativePackedParity,
        previewPackedF32: previewPackedParity,
        packedLanes: ["x", "y", "pressure", "directionX", "directionY"],
      },
      output: {
        maturePoints: wasmOutput.stats.maturePoints,
        forcedMaturePoints: wasmOutput.stats.forcedMaturePoints,
        maximumTailPoints: wasmOutput.stats.maximumTailPoints,
        retainedLinearMemoryBytes: wasmProcessor.memoryBytes?.() ?? 0,
      },
    });
  }

  return {
    lab: "stroke-geometry-wasm",
    benchmarkClass: "isolated-runtime-adapter-microbenchmark",
    productionClaim: false,
    passed: everyDabCountMatches
      && everyPackedOutputMatches
      && canonicalPackedOutputMatches,
    methodology: {
      warmupRunsPerBackendAndScenario: WARMUP_RUNS,
      measuredRunsPerBackendAndScenario: MEASURED_RUNS,
      order: "alternating-javascript-wasm",
      execution: "16-sample runtime-adapter batches with preview enabled and tail-copy disabled",
      timing: "browser performance.now wall time",
      productionComparison:
        "BrushEngine timings must use captured coalesced event groups; this adapter microbenchmark is not an editor speedup measurement.",
      limitation: "The JavaScript comparator is the standalone runtime adapter, not the editor's reusable planner path. Product claims use forced-backend human replay.",
    },
    source: {
      endpoint: HUMAN_STROKE_API_URL,
      fixtureLoadMs,
      capturedAt: fixture.capturedAt,
      canonicalSampleCount: fixture.points.length,
    },
    module: {
      byteLength: moduleBytes.byteLength,
      fetchAndReadMs: moduleFetchMs,
      compileMs: moduleCompileMs,
      instantiateMs: moduleInstantiationMs,
      totalInitializationMs: moduleInitializationMs,
      initialLinearMemoryBytes,
      warmedLinearMemoryBytes,
      retainedLinearMemoryBytes: wasmProcessor.memoryBytes?.() ?? 0,
      context: "Standalone benchmark instance only; engine auto-warm is disabled on this lab page, but browser process caches may already be warm.",
    },
    correctness: {
      dabCountParity: everyDabCountMatches,
      canonicalPackedF32Parity: canonicalPackedOutputMatches,
      allPackedF32Parity: everyPackedOutputMatches,
    },
    scenarios: reports,
    benchmarkWitness,
    scope: "Runtime-adapter CPU stabilization, causal curve planning, resampling, pressure interpolation and streaming output copies; BrushEngine integration and GPU submission are excluded.",
  };
}
