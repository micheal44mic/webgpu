import {
  instantiateStrokeGeometryKernel,
  type PackedStrokeStampResult,
  type StrokeGeometryProcessor,
  type StrokeGeometrySample,
  type StrokeGeometryStats,
} from "../../../wasm/stroke-geometry-kernel/runtime.mjs";
import { shapeLayerForStamp } from "../../brush-shape-sequence-core";
import { packStampsIntoUpload, stampShapeExtentFactor } from "../../engine-stamp-upload";
import type { Stamp } from "../../engine-stroke-types";
import { defaultBrushSettings, type BrushSettings } from "../../engine-types";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  MAX_STAMPS_PER_BATCH,
  STAMP_STRIDE_BYTES,
} from "../../engine-limits";
import { nextPaintStampSeed } from "../../paint-stamp-generation-core";

const HUMAN_STROKE_API_URL = "/api/human-stroke";
const STREAM_BATCH_SIZE = 16;
const WARMUP_RUNS = 5;
const DAB_STRIDE = 6;
const CANONICAL_FIXTURE_EXTENT = 4096;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface HumanStrokeFixture {
  readonly settings: { readonly size: number };
  readonly points: readonly StrokeGeometrySample[];
}

interface StampCounters {
  seedSequence: number;
  stampOrdinal: number;
}

interface Execution {
  readonly stampCount: number;
  readonly culledDabCount: number;
  readonly bytes: Uint8Array;
  readonly witness: number;
  readonly packComputeMs: number;
  readonly finalSeedSequence: number;
  readonly finalStampOrdinal: number;
  readonly dirtyRect: Rect | null;
  readonly minimumRadius: number;
  readonly previewBytes: Uint8Array;
  readonly stats: StrokeGeometryStats;
  readonly chunkContract: boolean;
  readonly transcript: readonly FrameTranscript[];
}

interface FrameTranscript {
  readonly label: string;
  readonly stampCount: number;
  readonly byteHash: string;
  readonly firstSeed: number | null;
  readonly dirtyRect: Rect | null;
  readonly minimumRadius: number;
  readonly nextSeedSequence: number;
  readonly nextStampOrdinal: number;
  readonly culledDabCount: number;
}

function measuredRuns(): number {
  const value = Number(new URLSearchParams(location.search).get("runs"));
  return Number.isSafeInteger(value) ? Math.max(5, Math.min(40, value)) : 25;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const value of bytes) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function unionRect(left: Rect | null, right: Rect | null): Rect | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const maximumX = Math.max(left.x + left.width, right.x + right.width);
  const maximumY = Math.max(left.y + left.height, right.y + right.height);
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return { x, y, width: maximumX - x, height: maximumY - y };
}

function rectMatches(left: Rect | null, right: Rect | null): boolean {
  return left === null && right === null
    || left !== null && right !== null
      && left.x === right.x
      && left.y === right.y
      && left.width === right.width
      && left.height === right.height;
}

function transcriptMatches(
  left: readonly FrameTranscript[],
  right: readonly FrameTranscript[],
): boolean {
  return left.length === right.length && left.every((frame, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && frame.label === candidate.label
      && frame.stampCount === candidate.stampCount
      && frame.byteHash === candidate.byteHash
      && frame.firstSeed === candidate.firstSeed
      && rectMatches(frame.dirtyRect, candidate.dirtyRect)
      && Object.is(frame.minimumRadius, candidate.minimumRadius)
      && frame.nextSeedSequence === candidate.nextSeedSequence
      && frame.nextStampOrdinal === candidate.nextStampOrdinal
      && frame.culledDabCount === candidate.culledDabCount;
  });
}

async function loadFixture(): Promise<HumanStrokeFixture> {
  const response = await fetch(HUMAN_STROKE_API_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Human stroke request failed (${response.status}).`);
  const value = await response.json() as Partial<HumanStrokeFixture>;
  if (!value.settings || !Number.isFinite(value.settings.size) || !Array.isArray(value.points)) {
    throw new Error("Human stroke fixture is incomplete.");
  }
  const scale = Math.min(DOCUMENT_WIDTH, DOCUMENT_HEIGHT) / CANONICAL_FIXTURE_EXTENT;
  const offsetX = (DOCUMENT_WIDTH - CANONICAL_FIXTURE_EXTENT * scale) * 0.5;
  const offsetY = (DOCUMENT_HEIGHT - CANONICAL_FIXTURE_EXTENT * scale) * 0.5;
  const points = value.points.map((point, index) => {
    if (
      !point
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || !Number.isFinite(point.pressure)
      || !Number.isFinite(point.timeMs)
    ) {
      throw new Error(`Human stroke sample ${index} is invalid.`);
    }
    return {
      x: offsetX + point.x * scale,
      y: offsetY + point.y * scale,
      pressure: point.pressure,
      timeMs: point.timeMs,
    };
  });
  if (points.length < 2) throw new Error("Human stroke fixture is empty.");
  return { settings: { size: value.settings.size * scale }, points };
}

function legacyPack(
  dabs: Float64Array,
  settings: BrushSettings,
  counters: StampCounters,
  uploadF32: Float32Array,
  uploadU32: Uint32Array,
  uploadBytes: Uint8Array,
  collect: boolean,
  stampPool: Stamp[] | null = null,
): {
  readonly stampCount: number;
  readonly culledDabCount: number;
  readonly bytes: Uint8Array;
  readonly witness: number;
  readonly dirtyRect: Rect | null;
  readonly minimumRadius: number;
  readonly firstSeed: number | null;
} {
  const stamps: Stamp[] = [];
  let culledDabCount = 0;
  for (let offset = 0; offset < dabs.length; offset += DAB_STRIDE) {
    const pressure = Math.max(0.01, Math.min(1, dabs[offset + 2]));
    const radius = Math.max(0.5, settings.size * 0.5);
    const ordinal = counters.stampOrdinal;
    const seed = nextPaintStampSeed(counters.seedSequence);
    counters.seedSequence += 1;
    counters.stampOrdinal += 1;
    const reach = radius * (
      1 + 2 * (settings.positionJitterLinear + settings.positionJitterLateral)
    );
    const x = dabs[offset];
    const y = dabs[offset + 1];
    if (x + reach < 0 || y + reach < 0 || x - reach >= DOCUMENT_WIDTH || y - reach >= DOCUMENT_HEIGHT) {
      culledDabCount += 1;
      continue;
    }
    const stampIndex = stamps.length;
    let stamp = stampPool?.[stampIndex];
    if (!stamp) {
      stamp = {
        x: 0,
        y: 0,
        radius: 0,
        pressure: 1,
        seed: 0,
        shapeLayer: 0,
        directionX: 1,
        directionY: 0,
        historyActionId: 1,
        symmetryMode: "off",
        symmetryAngleRadians: 0,
      };
      stampPool?.push(stamp);
    }
    stamp.x = x;
    stamp.y = y;
    stamp.radius = radius;
    stamp.pressure = pressure;
    stamp.seed = seed;
    stamp.shapeLayer = shapeLayerForStamp(
      settings.shapeSequenceMode,
      ordinal,
      seed,
      settings.shapeAssetIds?.length ?? 1,
    );
    stamp.directionX = dabs[offset + 4];
    stamp.directionY = dabs[offset + 5];
    stamps.push(stamp);
  }
  const packed = packStampsIntoUpload(
    stamps,
    settings,
    uploadF32,
    uploadU32,
  );
  const byteLength = stamps.length * STAMP_STRIDE_BYTES;
  return {
    stampCount: stamps.length,
    culledDabCount,
    bytes: collect ? uploadBytes.slice(0, byteLength) : new Uint8Array(0),
    witness: stamps.length + (packed.dirtyRect?.width ?? 0) + (uploadBytes[0] ?? 0),
    dirtyRect: packed.dirtyRect,
    minimumRadius: packed.minimumRadius,
    firstSeed: stamps[0]?.seed ?? null,
  };
}

function executeLegacy(
  begin: StrokeGeometryProcessor["begin"],
  points: readonly StrokeGeometrySample[],
  settings: BrushSettings,
  uploadF32: Float32Array,
  uploadU32: Uint32Array,
  uploadBytes: Uint8Array,
  previewStampPool: Stamp[],
  collect: boolean,
): Execution {
  const session = begin(points[0], {
    stabilization: 1,
    spacingMode: "fixed",
    spacing: Math.max(0.1, settings.size * 0.0025),
    maximumBatchSize: STREAM_BATCH_SIZE,
    dabCapacity: MAX_STAMPS_PER_BATCH,
    maximumStampsPerSegment: MAX_STAMPS_PER_BATCH,
  });
  const counters = { seedSequence: 1, stampOrdinal: 0 };
  const chunks: Uint8Array[] = [];
  const previewChunks: Uint8Array[] = [];
  const transcript: FrameTranscript[] = [];
  let stampCount = 0;
  let culledDabCount = 0;
  let witness = 0;
  let dirtyRect: Rect | null = null;
  let minimumRadius = Number.POSITIVE_INFINITY;
  const consume = (dabs: Float64Array, preview: boolean, label: string): void => {
    const targetCounters = preview ? { ...counters } : counters;
    const packed = legacyPack(
      dabs,
      settings,
      targetCounters,
      uploadF32,
      uploadU32,
      uploadBytes,
      collect,
      preview ? previewStampPool : null,
    );
    if (!preview) {
      stampCount += packed.stampCount;
      culledDabCount += packed.culledDabCount;
      if (packed.bytes.byteLength > 0) chunks.push(packed.bytes);
      dirtyRect = unionRect(dirtyRect, packed.dirtyRect);
      minimumRadius = Math.min(minimumRadius, packed.minimumRadius);
    } else if (packed.bytes.byteLength > 0) {
      previewChunks.push(packed.bytes);
    }
    if (collect) {
      transcript.push({
        label,
        stampCount: packed.stampCount,
        byteHash: hashBytes(packed.bytes),
        firstSeed: packed.firstSeed,
        dirtyRect: packed.dirtyRect,
        minimumRadius: packed.minimumRadius,
        nextSeedSequence: targetCounters.seedSequence,
        nextStampOrdinal: targetCounters.stampOrdinal,
        culledDabCount: packed.culledDabCount,
      });
    }
    witness += packed.witness;
  };
  let completed = false;
  try {
    consume(session.initialDab, false, "initial");
    for (let start = 1; start < points.length; start += STREAM_BATCH_SIZE) {
      const update = session.processBatch(points.slice(start, start + STREAM_BATCH_SIZE), {
        includePreviewTail: true,
        includeTail: false,
      });
      consume(update.dabs, false, `batch-${start}`);
      consume(update.previewDabs, true, `preview-${start}`);
    }
    const final = session.finish();
    completed = true;
    consume(final.dabs, false, "finish");
    witness += final.stats.spacingCarry;
    return {
      stampCount,
      culledDabCount,
      bytes: collect ? concatenate(chunks) : new Uint8Array(0),
      witness,
      packComputeMs: 0,
      finalSeedSequence: counters.seedSequence,
      finalStampOrdinal: counters.stampOrdinal,
      dirtyRect,
      minimumRadius,
      previewBytes: collect ? concatenate(previewChunks) : new Uint8Array(0),
      stats: final.stats,
      chunkContract: true,
      transcript,
    };
  } finally {
    if (!completed) session.cancel();
  }
}

function executePacked(
  beginPacked: NonNullable<StrokeGeometryProcessor["beginPacked"]>,
  points: readonly StrokeGeometrySample[],
  settings: BrushSettings,
  collect: boolean,
): Execution {
  const session = beginPacked(points[0], {
    stabilization: 1,
    spacingMode: "fixed",
    spacing: Math.max(0.1, settings.size * 0.0025),
    maximumBatchSize: STREAM_BATCH_SIZE,
    dabCapacity: MAX_STAMPS_PER_BATCH,
    maximumStampsPerSegment: MAX_STAMPS_PER_BATCH,
  }, {
    size: settings.size,
    positionJitterLinear: settings.positionJitterLinear,
    positionJitterLateral: settings.positionJitterLateral,
    shapeExtentFactor: stampShapeExtentFactor(settings),
    documentWidth: DOCUMENT_WIDTH,
    documentHeight: DOCUMENT_HEIGHT,
    seedSequence: 1,
    stampOrdinal: 0,
    radiusMode: "fixed",
    shapeSequenceMode: settings.shapeSequenceMode,
    shapeLayerCount: settings.shapeAssetIds?.length ?? 1,
    flattenPackedStamps: false,
  });
  const chunks: Uint8Array[] = [];
  const previewChunks: Uint8Array[] = [];
  let stampCount = 0;
  let culledDabCount = 0;
  let witness = 0;
  let packComputeMs = 0;
  let dirtyRect: Rect | null = null;
  let minimumRadius = Number.POSITIVE_INFINITY;
  let chunkContract = true;
  const transcript: FrameTranscript[] = [];
  let lastResult: PackedStrokeStampResult = session.initialPackedStamps;
  const consume = (
    result: PackedStrokeStampResult,
    authoritative: boolean,
    label: string,
  ): void => {
    const resultBytes = collect
      ? concatenate(result.packedChunks.map((chunk) => chunk.packedStamps))
      : new Uint8Array(0);
    let chunkDirtyRect: Rect | null = null;
    let chunkMinimumRadius = Number.POSITIVE_INFINITY;
    let chunkFirstSeed: number | null = null;
    let chunkByteOffset = 0;
    const chunkStampCount = result.packedChunks.reduce((sum, chunk) => {
      chunkContract = chunkContract
        && chunk.stampCount > 0
        && chunk.stampCount <= MAX_STAMPS_PER_BATCH
        && chunk.packedStamps.byteLength === chunk.stampCount * STAMP_STRIDE_BYTES
        && chunk.firstSeed !== null
        && chunk.dirtyRect !== null
        && Number.isFinite(chunk.minimumRadius);
      if (collect) {
        chunkFirstSeed ??= chunk.firstSeed;
        chunkDirtyRect = unionRect(chunkDirtyRect, chunk.dirtyRect);
        chunkMinimumRadius = Math.min(chunkMinimumRadius, chunk.minimumRadius);
        for (let index = 0; index < chunk.packedStamps.byteLength; index += 1) {
          if (chunk.packedStamps[index] !== resultBytes[chunkByteOffset + index]) {
            chunkContract = false;
            break;
          }
        }
        chunkByteOffset += chunk.packedStamps.byteLength;
      }
      return sum + chunk.stampCount;
    }, 0);
    chunkContract = chunkContract
      && result.packedStamps.byteLength === 0
      && chunkStampCount === result.stampCount;
    if (collect) {
      chunkContract = chunkContract
        && chunkByteOffset === resultBytes.byteLength
        && chunkFirstSeed === result.firstSeed
        && rectMatches(chunkDirtyRect, result.dirtyRect)
        && chunkMinimumRadius === result.minimumRadius;
    }
    if (authoritative) {
      stampCount += result.stampCount;
      culledDabCount += result.culledDabCount;
      if (collect && resultBytes.byteLength > 0) chunks.push(resultBytes);
      lastResult = result;
      dirtyRect = unionRect(dirtyRect, result.dirtyRect);
      minimumRadius = Math.min(minimumRadius, result.minimumRadius);
    } else if (collect && resultBytes.byteLength > 0) {
      previewChunks.push(resultBytes);
    }
    if (collect) {
      transcript.push({
        label,
        stampCount: result.stampCount,
        byteHash: hashBytes(resultBytes),
        firstSeed: result.firstSeed,
        dirtyRect: result.dirtyRect,
        minimumRadius: result.minimumRadius,
        nextSeedSequence: result.nextSeedSequence,
        nextStampOrdinal: result.nextStampOrdinal,
        culledDabCount: result.culledDabCount,
      });
    }
    packComputeMs += result.packComputeMs;
    witness += result.stampCount
      + (result.dirtyRect?.width ?? 0)
      + (result.packedChunks[0]?.packedStamps[0] ?? 0);
  };
  let completed = false;
  try {
    consume(session.initialPackedStamps, true, "initial");
    for (let start = 1; start < points.length; start += STREAM_BATCH_SIZE) {
      const update = session.processBatch(points.slice(start, start + STREAM_BATCH_SIZE), {
        includePreviewTail: true,
        includeTail: false,
      });
      consume(update, true, `batch-${start}`);
      consume(update.previewPackedStamps, false, `preview-${start}`);
    }
    const final = session.finish();
    completed = true;
    consume(final, true, "finish");
    witness += final.stats.spacingCarry;
    return {
      stampCount,
      culledDabCount,
      bytes: collect ? concatenate(chunks) : new Uint8Array(0),
      witness,
      packComputeMs,
      finalSeedSequence: lastResult.nextSeedSequence,
      finalStampOrdinal: lastResult.nextStampOrdinal,
      dirtyRect,
      minimumRadius,
      previewBytes: collect ? concatenate(previewChunks) : new Uint8Array(0),
      stats: final.stats,
      chunkContract,
      transcript,
    };
  } finally {
    if (!completed) session.cancel();
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runStrokePackedWasmBenchmark(): Promise<Record<string, unknown>> {
  const fixture = await loadFixture();
  const settings: BrushSettings = {
    ...defaultBrushSettings,
    size: fixture.settings.size,
    shape: "shape",
    shapeRotation: "follow-stroke",
    shapeScatter: 0.35,
    shapeSequenceMode: "random",
    shapeAssetIds: ["legacy-shape", "pencil-shape", "legacy-shape", "pencil-shape"],
    positionJitterLinear: 0.3,
    positionJitterLateral: 0.2,
  };
  const response = await fetch(new URL(
    "../../../wasm/stroke-geometry-kernel/dist/stroke_geometry_kernel.wasm",
    import.meta.url,
  ), { cache: "force-cache" });
  if (!response.ok) throw new Error(`Packed stroke module request failed (${response.status}).`);
  const moduleBytes = await response.arrayBuffer();
  const compileStartedAt = performance.now();
  const module = await WebAssembly.compile(moduleBytes);
  const compileMs = performance.now() - compileStartedAt;
  const legacyProcessor = await instantiateStrokeGeometryKernel(module);
  const packedProcessor = await instantiateStrokeGeometryKernel(module);
  if (!packedProcessor.beginPacked) {
    throw new Error("Required direct packed-stamp ABI is unavailable.");
  }
  // Match production: one persistent upload arena, reused by every legacy batch.
  const legacyUpload = new ArrayBuffer(MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES);
  const legacyUploadF32 = new Float32Array(legacyUpload);
  const legacyUploadU32 = new Uint32Array(legacyUpload);
  const legacyUploadBytes = new Uint8Array(legacyUpload);
  const legacyPreviewStampPool: Stamp[] = [];
  const legacy = () => executeLegacy(
    legacyProcessor.begin,
    fixture.points,
    settings,
    legacyUploadF32,
    legacyUploadU32,
    legacyUploadBytes,
    legacyPreviewStampPool,
    false,
  );
  const packed = () => executePacked(
    packedProcessor.beginPacked!,
    fixture.points,
    settings,
    false,
  );
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    if ((index & 1) === 0) {
      legacy();
      packed();
    } else {
      packed();
      legacy();
    }
  }
  await yieldToBrowser();
  const legacyTimes: number[] = [];
  const packedTimes: number[] = [];
  const packedKernelTimes: number[] = [];
  let witness = 0;
  const runs = measuredRuns();
  for (let index = 0; index < runs; index += 1) {
    const measure = (operation: () => Execution): readonly [number, Execution] => {
      const startedAt = performance.now();
      const result = operation();
      return [performance.now() - startedAt, result];
    };
    const [first, second] = (index & 1) === 0
      ? [measure(legacy), measure(packed)]
      : [measure(packed), measure(legacy)];
    const legacyRun = (index & 1) === 0 ? first : second;
    const packedRun = (index & 1) === 0 ? second : first;
    legacyTimes.push(legacyRun[0]);
    packedTimes.push(packedRun[0]);
    packedKernelTimes.push(packedRun[1].packComputeMs);
    witness += legacyRun[1].witness + packedRun[1].witness;
    if ((index + 1) % 5 === 0) await yieldToBrowser();
  }
  const legacyOutput = executeLegacy(
    legacyProcessor.begin,
    fixture.points,
    settings,
    legacyUploadF32,
    legacyUploadU32,
    legacyUploadBytes,
    legacyPreviewStampPool,
    true,
  );
  const packedOutput = executePacked(
    packedProcessor.beginPacked,
    fixture.points,
    settings,
    true,
  );
  const bytesMatch = legacyOutput.bytes.length === packedOutput.bytes.length
    && legacyOutput.bytes.every((value, index) => value === packedOutput.bytes[index]);
  const previewBytesMatch = legacyOutput.previewBytes.length === packedOutput.previewBytes.length
    && legacyOutput.previewBytes.every(
      (value, index) => value === packedOutput.previewBytes[index],
    );
  const statsMatch = JSON.stringify(legacyOutput.stats) === JSON.stringify(packedOutput.stats);
  const transcriptMatch = transcriptMatches(legacyOutput.transcript, packedOutput.transcript);
  const dirtyRectMatch = rectMatches(legacyOutput.dirtyRect, packedOutput.dirtyRect);
  const minimumRadiusMatch = legacyOutput.minimumRadius === packedOutput.minimumRadius;
  const legacyMedian = percentile(legacyTimes, 0.5);
  const packedMedian = percentile(packedTimes, 0.5);
  return {
    lab: "stroke-packed-wasm",
    version: 1,
    passed: bytesMatch
      && previewBytesMatch
      && legacyOutput.stampCount === packedOutput.stampCount
      && legacyOutput.culledDabCount === packedOutput.culledDabCount
      && legacyOutput.finalSeedSequence === packedOutput.finalSeedSequence
      && legacyOutput.finalStampOrdinal === packedOutput.finalStampOrdinal
      && dirtyRectMatch
      && minimumRadiusMatch
      && statsMatch
      && transcriptMatch
      && packedOutput.chunkContract,
    strictNoFallback: true,
    workload: {
      samples: fixture.points.length,
      stabilization: 1,
      spacingPercent: 0.25,
      streamBatchSize: STREAM_BATCH_SIZE,
      runs,
      shapeLayers: settings.shapeAssetIds?.length ?? 1,
      positionJitter: [settings.positionJitterLinear, settings.positionJitterLateral],
      document: [DOCUMENT_WIDTH, DOCUMENT_HEIGHT],
      fixtureScale: Math.min(DOCUMENT_WIDTH, DOCUMENT_HEIGHT) / CANONICAL_FIXTURE_EXTENT,
    },
    module: {
      byteLength: moduleBytes.byteLength,
      compileMs,
      legacyInstanceMemoryBytes: legacyProcessor.memoryBytes?.(),
      packedInstanceMemoryBytes: packedProcessor.memoryBytes?.(),
    },
    timing: {
      legacyObjectAndPackingMedianMs: legacyMedian,
      legacyObjectAndPackingP95Ms: percentile(legacyTimes, 0.95),
      directPackedMedianMs: packedMedian,
      directPackedP95Ms: percentile(packedTimes, 0.95),
      directPackKernelMedianMs: percentile(packedKernelTimes, 0.5),
      directPackKernelP95Ms: percentile(packedKernelTimes, 0.95),
      speedup: packedMedian > 0 ? legacyMedian / packedMedian : null,
      savedPercent: legacyMedian > 0 ? (legacyMedian - packedMedian) / legacyMedian * 100 : null,
    },
    parity: {
      exactGpuBytes: bytesMatch,
      exactPreviewGpuBytes: previewBytesMatch,
      legacyHash: hashBytes(legacyOutput.bytes),
      packedHash: hashBytes(packedOutput.bytes),
      legacyPreviewHash: hashBytes(legacyOutput.previewBytes),
      packedPreviewHash: hashBytes(packedOutput.previewBytes),
      stampCount: packedOutput.stampCount,
      uploadBytes: packedOutput.bytes.byteLength,
      culledDabs: packedOutput.culledDabCount,
      finalSeedSequence: packedOutput.finalSeedSequence,
      finalStampOrdinal: packedOutput.finalStampOrdinal,
      exactDirtyRect: dirtyRectMatch,
      dirtyRect: packedOutput.dirtyRect,
      exactMinimumRadius: minimumRadiusMatch,
      minimumRadius: packedOutput.minimumRadius,
      exactStats: statsMatch,
      exactStreamingTranscript: transcriptMatch,
      streamingFrames: packedOutput.transcript.length,
      validChunks: packedOutput.chunkContract,
    },
    witness,
  };
}
