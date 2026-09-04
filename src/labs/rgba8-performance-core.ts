import humanFixtureJson from "./gpu/dirty-region-human-fixture.json";
import {
  beginStrokeGeometryJs,
  instantiateStrokeGeometryKernel,
} from "../../wasm/stroke-geometry-kernel/runtime.mjs";
import type {
  StrokeGeometryProcessor,
  StrokeGeometrySample,
  StrokeGeometrySession,
} from "../../wasm/stroke-geometry-kernel/runtime.mjs";

export const RGBA8_LAB_SCHEMA_VERSION = 2;
export const RGBA8_LAB_VERSION = "rgba8-renderer-matrix-2026-09-04-v2";
export const TARGET_SIZE = 2048;
export const STAMP_STRIDE_BYTES = 32;
export const WARMUP_RUNS = 2;
export const MEASURED_RUNS = 7;
export const FRAMES_PER_MEASURED_RUN = 8;

export type RendererKind = "webgpu" | "webgl2";
export type GeometryBackend = "javascript" | "wasm";
export type RunMode = "paced" | "saturation";
export type SuiteKind = "quick" | "full" | "sustained";
export type SamplingProfile = "simple" | "shape" | "grain" | "shape-grain";
export type WorkloadLayout = "grid" | "overlap" | "clipped" | "human";

export interface TimingSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly maximum: number;
}

export interface GpuCase {
  readonly id: string;
  readonly label: string;
  readonly category: "upload" | "vertex" | "fill" | "texture" | "pass" | "copy" | "e2e" | "sustained";
  readonly instanceCount: number;
  readonly radiusPx: number;
  readonly layout: WorkloadLayout;
  readonly sampling: SamplingProfile;
  readonly passes: number;
  readonly submits: number;
  readonly copies: number;
  readonly uploadEachFrame: boolean;
  readonly uploadOnly: boolean;
  readonly sustainedMs?: number;
  readonly clearBeforeDraw?: boolean;
}

export interface GeometryCaseResult {
  readonly id: string;
  readonly spacingPx: number;
  readonly stampCount: number;
  readonly uploadBytes: number;
  readonly iterationsPerRun: number;
  readonly parity: {
    readonly exact: boolean;
    readonly javascriptHash: string;
    readonly wasmHash: string;
  };
  readonly javascriptMs: TimingSummary;
  readonly wasmMs: TimingSummary;
  readonly javascriptRunsMs: readonly number[];
  readonly wasmRunsMs: readonly number[];
}

export interface PreparedGeometry {
  readonly wasmProcessor: StrokeGeometryProcessor;
  readonly wasmByteLength: number;
  readonly wasmCompileMs: number;
  readonly points: readonly StrokeGeometrySample[];
  readonly humanStampBytes: Uint8Array;
  readonly results: readonly GeometryCaseResult[];
}

export function beginPreparedGeometrySession(
  prepared: PreparedGeometry,
  backend: GeometryBackend,
  spacingPx = 4,
): StrokeGeometrySession {
  const begin = backend === "javascript" ? beginStrokeGeometryJs : prepared.wasmProcessor.begin;
  return begin(prepared.points[0], {
    stabilization: 1,
    spacingMode: "fixed",
    spacing: spacingPx,
    batchSize: 16,
    maximumBatchSize: 16,
  });
}

export function packGeometryDabs(
  dabs: Float64Array,
  firstStampOrdinal = 0,
): Uint8Array {
  const stampCount = dabs.length / 6;
  const bytes = new Uint8Array(stampCount * STAMP_STRIDE_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < stampCount; index += 1) {
    const dabOffset = index * 6;
    const byteOffset = index * STAMP_STRIDE_BYTES;
    view.setFloat32(byteOffset, dabs[dabOffset], true);
    view.setFloat32(byteOffset + 4, dabs[dabOffset + 1], true);
    view.setFloat32(byteOffset + 8, 48, true);
    view.setFloat32(byteOffset + 12, dabs[dabOffset + 2], true);
    view.setUint32(byteOffset + 16, firstStampOrdinal + index + 1, true);
    view.setUint32(byteOffset + 20, 0, true);
    view.setFloat32(byteOffset + 24, dabs[dabOffset + 4], true);
    view.setFloat32(byteOffset + 28, dabs[dabOffset + 5], true);
  }
  return bytes;
}

export function generatePreparedStrokeBytes(
  prepared: PreparedGeometry,
  backend: GeometryBackend,
  spacingPx = 4,
): Uint8Array {
  return executeGeometry(
    backend === "javascript" ? beginStrokeGeometryJs : prepared.wasmProcessor.begin,
    prepared.points,
    spacingPx,
  );
}

export interface LoadedGeometryWasm {
  readonly processor: StrokeGeometryProcessor;
  readonly byteLength: number;
  readonly compileMs: number;
}

interface HumanFixture {
  readonly points: readonly StrokeGeometrySample[];
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function summarize(values: readonly number[]): TimingSummary {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    maximum: values.length > 0 ? Math.max(...values) : 0,
  };
}

export function missedDeadlines(values: readonly number[]): Record<string, number> {
  const count = (limit: number): number => values.filter((value) => value > limit).length;
  return {
    "8.33ms": count(8.33),
    "11.11ms": count(11.11),
    "16.67ms": count(16.67),
  };
}

export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const stableCopy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableCopy.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function comparePixels(
  left: Uint8Array,
  right: Uint8Array,
): {
  readonly valid: boolean;
  readonly exact: boolean;
  readonly maximumChannelError: number;
  readonly differentPixelRatio: number;
} {
  if (left.byteLength !== right.byteLength) {
    return { valid: false, exact: false, maximumChannelError: 255, differentPixelRatio: 1 };
  }
  let maximumChannelError = 0;
  let differentPixels = 0;
  for (let offset = 0; offset < left.byteLength; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const error = Math.abs(left[offset + channel] - right[offset + channel]);
      maximumChannelError = Math.max(maximumChannelError, error);
      pixelDiffers ||= error > 0;
    }
    if (pixelDiffers) differentPixels += 1;
  }
  const differentPixelRatio = differentPixels / (left.byteLength / 4);
  return {
    // Fractional raster coordinates can round one accumulated RGBA8 blend by two
    // quantization steps across APIs. Keep the affected-area guard deliberately tight.
    valid: maximumChannelError <= 2 && differentPixelRatio <= 0.001,
    exact: maximumChannelError === 0,
    maximumChannelError,
    differentPixelRatio,
  };
}

function scaledFixturePoints(): StrokeGeometrySample[] {
  const fixture = humanFixtureJson as HumanFixture;
  const minX = Math.min(...fixture.points.map((point) => point.x));
  const maxX = Math.max(...fixture.points.map((point) => point.x));
  const minY = Math.min(...fixture.points.map((point) => point.y));
  const maxY = Math.max(...fixture.points.map((point) => point.y));
  const extent = Math.max(1, maxX - minX, maxY - minY);
  const scale = (TARGET_SIZE - 192) / extent;
  return fixture.points.map((point) => ({
    x: 96 + (point.x - minX) * scale,
    y: 96 + (point.y - minY) * scale,
    pressure: point.pressure,
    timeMs: point.timeMs,
  }));
}

function appendDabs(source: Float64Array, target: number[]): void {
  for (const value of source) target.push(value);
}

function executeGeometry(
  begin: StrokeGeometryProcessor["begin"],
  points: readonly StrokeGeometrySample[],
  spacingPx: number,
): Uint8Array {
  const session: StrokeGeometrySession = begin(points[0], {
    stabilization: 1,
    spacingMode: "fixed",
    spacing: spacingPx,
    batchSize: 16,
    maximumBatchSize: 16,
  });
  const dabs: number[] = [];
  let completed = false;
  try {
    appendDabs(session.initialDab, dabs);
    for (let start = 1; start < points.length; start += 16) {
      const update = session.processBatch(points.slice(start, start + 16), {
        includePreviewTail: false,
        includeTail: false,
      });
      appendDabs(update.dabs, dabs);
    }
    const final = session.finish();
    completed = true;
    appendDabs(final.dabs, dabs);
  } finally {
    if (!completed) session.cancel();
  }
  return packGeometryDabs(new Float64Array(dabs), 0);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let geometryWasmPromise: Promise<LoadedGeometryWasm> | null = null;

export function loadGeometryWasm(): Promise<LoadedGeometryWasm> {
  geometryWasmPromise ??= (async () => {
    const moduleResponse = await fetch(new URL(
      "../../wasm/stroke-geometry-kernel/dist/stroke_geometry_kernel.wasm",
      import.meta.url,
    ), { cache: "force-cache" });
    if (!moduleResponse.ok) {
      throw new Error(`Modulo geometria Wasm non disponibile (${moduleResponse.status}).`);
    }
    const moduleBytes = await moduleResponse.arrayBuffer();
    const compileStartedAt = performance.now();
    const module = await WebAssembly.compile(moduleBytes);
    const compileMs = performance.now() - compileStartedAt;
    const processor = await instantiateStrokeGeometryKernel(module);
    if (processor.backend !== "wasm" || typeof processor.begin !== "function") {
      throw new Error("Il modulo geometria non ha attivato il percorso Wasm.");
    }
    return { processor, byteLength: moduleBytes.byteLength, compileMs };
  })();
  return geometryWasmPromise;
}

export async function prepareGeometry(full: boolean): Promise<PreparedGeometry> {
  const points = scaledFixturePoints();
  const loaded = await loadGeometryWasm();
  const wasmProcessor = loaded.processor;
  const spacings = full ? [2, 4, 8] : [4];
  const results: GeometryCaseResult[] = [];
  let humanStampBytes: Uint8Array = new Uint8Array(0);
  for (const spacingPx of spacings) {
    for (let warmup = 0; warmup < WARMUP_RUNS; warmup += 1) {
      if ((warmup & 1) === 0) {
        executeGeometry(beginStrokeGeometryJs, points, spacingPx);
        executeGeometry(wasmProcessor.begin, points, spacingPx);
      } else {
        executeGeometry(wasmProcessor.begin, points, spacingPx);
        executeGeometry(beginStrokeGeometryJs, points, spacingPx);
      }
    }
    const calibrate = (begin: StrokeGeometryProcessor["begin"]): number => {
      let iterations = 1;
      while (iterations < 1024) {
        const startedAt = performance.now();
        for (let index = 0; index < iterations; index += 1) {
          executeGeometry(begin, points, spacingPx);
        }
        if (performance.now() - startedAt >= 30) break;
        iterations *= 2;
      }
      return iterations;
    };
    const iterationsPerRun = Math.max(
      calibrate(beginStrokeGeometryJs),
      calibrate(wasmProcessor.begin),
    );
    const javascriptRunsMs: number[] = [];
    const wasmRunsMs: number[] = [];
    for (let run = 0; run < MEASURED_RUNS; run += 1) {
      const measure = (begin: StrokeGeometryProcessor["begin"]): number => {
        const startedAt = performance.now();
        for (let index = 0; index < iterationsPerRun; index += 1) {
          executeGeometry(begin, points, spacingPx);
        }
        return (performance.now() - startedAt) / iterationsPerRun;
      };
      if ((run & 1) === 0) {
        javascriptRunsMs.push(measure(beginStrokeGeometryJs));
        wasmRunsMs.push(measure(wasmProcessor.begin));
      } else {
        wasmRunsMs.push(measure(wasmProcessor.begin));
        javascriptRunsMs.push(measure(beginStrokeGeometryJs));
      }
      await yieldToBrowser();
    }
    const javascriptBytes = executeGeometry(beginStrokeGeometryJs, points, spacingPx);
    const wasmBytes = executeGeometry(wasmProcessor.begin, points, spacingPx);
    if (spacingPx === 4) humanStampBytes = javascriptBytes;
    results.push({
      id: `geometry-${spacingPx}px`,
      spacingPx,
      stampCount: javascriptBytes.byteLength / STAMP_STRIDE_BYTES,
      uploadBytes: javascriptBytes.byteLength,
      iterationsPerRun,
      parity: {
        exact: bytesEqual(javascriptBytes, wasmBytes),
        javascriptHash: hashBytes(javascriptBytes),
        wasmHash: hashBytes(wasmBytes),
      },
      javascriptMs: summarize(javascriptRunsMs),
      wasmMs: summarize(wasmRunsMs),
      javascriptRunsMs,
      wasmRunsMs,
    });
  }
  return {
    wasmProcessor,
    wasmByteLength: loaded.byteLength,
    wasmCompileMs: loaded.compileMs,
    points,
    humanStampBytes,
    results,
  };
}

export function buildGpuCases(
  suite: SuiteKind,
  humanInstanceCount: number,
): GpuCase[] {
  if (suite === "sustained") {
    return [{
      id: "sustained-shape-grain",
      label: "Sostenuto interattivo Shape + Grain · 30 s",
      category: "sustained",
      instanceCount: humanInstanceCount,
      radiusPx: 48,
      layout: "human",
      sampling: "shape-grain",
      passes: 1,
      submits: 1,
      copies: 1,
      uploadEachFrame: true,
      uploadOnly: false,
      sustainedMs: 30_000,
    }];
  }

  const quick = suite === "quick";
  const cases: GpuCase[] = [];
  const uploadCounts = quick ? [8192] : [1024, 8192, 32768, 65536];
  for (const instanceCount of uploadCounts) {
    cases.push({
      id: `upload-${instanceCount}`,
      label: `Upload ${(instanceCount * STAMP_STRIDE_BYTES / 1024).toFixed(0)} KiB`,
      category: "upload",
      instanceCount,
      radiusPx: 1,
      layout: "clipped",
      sampling: "simple",
      passes: 0,
      submits: 1,
      copies: 0,
      uploadEachFrame: true,
      uploadOnly: true,
    });
  }

  const vertexCounts = quick ? [8192] : [1024, 8192, 32768, 65536];
  for (const instanceCount of vertexCounts) {
    cases.push({
      id: `vertex-${instanceCount}`,
      label: `Vertex · ${instanceCount.toLocaleString("it-IT")} istanze`,
      category: "vertex",
      instanceCount,
      radiusPx: 1,
      layout: "clipped",
      sampling: "simple",
      passes: 1,
      submits: 1,
      copies: 0,
      uploadEachFrame: false,
      uploadOnly: false,
    });
  }

  const fillCount = quick ? 1024 : 4096;
  for (const layout of ["grid", "overlap"] as const) {
    cases.push({
      id: `fill-${layout}-${fillCount}`,
      label: `Fill ${layout === "grid" ? "disgiunto" : "sovrapposto"}`,
      category: "fill",
      instanceCount: fillCount,
      radiusPx: 16,
      layout,
      sampling: "simple",
      passes: 1,
      submits: 1,
      copies: 0,
      uploadEachFrame: false,
      uploadOnly: false,
    });
  }

  const samplingProfiles: SamplingProfile[] = quick
    ? ["simple", "shape-grain"]
    : ["simple", "shape", "grain", "shape-grain"];
  for (const sampling of samplingProfiles) {
    cases.push({
      id: `texture-${sampling}`,
      label: `Texture · ${sampling}`,
      category: "texture",
      instanceCount: quick ? 1024 : 4096,
      radiusPx: 16,
      layout: "grid",
      sampling,
      passes: 1,
      submits: 1,
      copies: 0,
      uploadEachFrame: false,
      uploadOnly: false,
    });
  }

  const passCounts = quick ? [1, 8] : [1, 2, 4, 8, 32];
  for (const passes of passCounts) {
    cases.push({
      id: `passes-${passes}-submit-1`,
      label: `${passes} pass · 1 submit`,
      category: "pass",
      instanceCount: 4096,
      radiusPx: 8,
      layout: "grid",
      sampling: "simple",
      passes,
      submits: 1,
      copies: 0,
      uploadEachFrame: false,
      uploadOnly: false,
    });
    if (passes > 1) {
      cases.push({
        id: `passes-${passes}-submit-${passes}`,
        label: `${passes} pass · ${passes} submit/flush`,
        category: "pass",
        instanceCount: 4096,
        radiusPx: 8,
        layout: "grid",
        sampling: "simple",
        passes,
        submits: passes,
        copies: 0,
        uploadEachFrame: false,
        uploadOnly: false,
      });
    }
  }

  if (!quick) {
    for (const copies of [1, 2, 4]) {
      cases.push({
        id: `copies-${copies}`,
        label: `${copies} copie RGBA8`,
        category: "copy",
        instanceCount: 4096,
        radiusPx: 8,
        layout: "grid",
        sampling: "simple",
        passes: 1,
        submits: 1,
        copies,
        uploadEachFrame: false,
        uploadOnly: false,
      });
    }
  }

  cases.push({
    id: "e2e-human-stroke",
    label: "Pipeline interattiva · replay + copia RGBA8",
    category: "e2e",
    instanceCount: humanInstanceCount,
    radiusPx: 48,
    layout: "human",
    sampling: "shape-grain",
    passes: 1,
    submits: 1,
    copies: 1,
    uploadEachFrame: true,
    uploadOnly: false,
  });
  return cases;
}

export function createStampBytes(spec: GpuCase, frameIndex = 0): Uint8Array {
  const bytes = new Uint8Array(spec.instanceCount * STAMP_STRIDE_BYTES);
  const view = new DataView(bytes.buffer);
  const gridSize = Math.max(1, Math.ceil(Math.sqrt(spec.instanceCount)));
  const cellSize = TARGET_SIZE / gridSize;
  for (let index = 0; index < spec.instanceCount; index += 1) {
    const byteOffset = index * STAMP_STRIDE_BYTES;
    let x = ((index % gridSize) + 0.5) * cellSize;
    let y = (Math.floor(index / gridSize) + 0.5) * cellSize;
    if (spec.layout === "overlap") {
      x = TARGET_SIZE * 0.5;
      y = TARGET_SIZE * 0.5;
    } else if (spec.layout === "clipped") {
      x = -128;
      y = -128;
    }
    view.setFloat32(byteOffset, x, true);
    view.setFloat32(byteOffset + 4, y, true);
    view.setFloat32(byteOffset + 8, spec.radiusPx, true);
    view.setFloat32(byteOffset + 12, 0.08, true);
    view.setUint32(byteOffset + 16, (index + frameIndex * 131 + 1) >>> 0, true);
    view.setUint32(byteOffset + 20, 0, true);
    view.setFloat32(byteOffset + 24, 1, true);
    view.setFloat32(byteOffset + 28, 0, true);
  }
  return bytes;
}

export function createRgba8Masks(size = 256): {
  readonly shape: Uint8Array;
  readonly grain: Uint8Array;
} {
  const shape = new Uint8Array(size * size * 4);
  const grain = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const radial = Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny));
      const shapeValue = Math.round(radial * radial * 255);
      const noise = Math.sin((x + 17) * 12.9898 + (y + 31) * 78.233) * 43758.5453;
      const grainValue = Math.round((0.35 + (noise - Math.floor(noise)) * 0.65) * 255);
      shape[offset] = shapeValue;
      shape[offset + 1] = shapeValue;
      shape[offset + 2] = shapeValue;
      shape[offset + 3] = 255;
      grain[offset] = grainValue;
      grain[offset + 1] = grainValue;
      grain[offset + 2] = grainValue;
      grain[offset + 3] = 255;
    }
  }
  return { shape, grain };
}
