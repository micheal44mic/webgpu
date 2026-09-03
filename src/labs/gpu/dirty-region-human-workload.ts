import { stampShapeExtentFactor } from "../../engine-stamp-upload";
import { MAX_STAMPS_PER_BATCH, STAMP_STRIDE_BYTES } from "../../engine-limits";
import { loadRequiredPackedStrokeGeometryProcessor } from "../../stroke-geometry-backend";
import { defaultBrushSettings, type BrushSettings } from "../../engine-types";
import type { PackedStrokeStampResult } from "../../stroke-geometry-backend";
import { fingerprintHumanStroke, type HumanStrokePoint } from "../human-stroke-lab";
import type { DirtyRegionRect } from "./dirty-region-lab-model";

const HUMAN_STROKE_API_URL = "/api/human-stroke";
const HUMAN_STROKE_TIMELINE_API_URL = "/api/stroke-timeline";
const CAPTURE_DOCUMENT_EXTENT = 4096;
const STROKE_GEOMETRY_INPUT_BATCH_CAPACITY = 256;

interface StoredHumanStrokeFixture {
  readonly version?: unknown;
  readonly capturedAt?: unknown;
  readonly settings?: Partial<BrushSettings>;
  readonly points?: readonly Partial<HumanStrokePoint>[];
}

interface StoredHumanStrokeTimeline {
  readonly fixture?: {
    readonly fingerprint?: unknown;
    readonly pointCount?: unknown;
    readonly traceDurationMs?: unknown;
  };
  readonly release?: {
    readonly performance?: {
      readonly baseStamps?: unknown;
      readonly physicalCopies?: unknown;
      readonly renderFrames?: unknown;
      readonly brushBatches?: unknown;
      readonly largestBatchStamps?: unknown;
      readonly lightGlazePyramidUpdatedPixels?: unknown;
      readonly presentationCacheUpdatedPixels?: unknown;
    };
  };
}

export interface HumanDirtyRegionRecordedReference {
  readonly fingerprint: string;
  readonly pointCount: number;
  readonly traceDurationMs: number;
  readonly baseStamps: number;
  readonly physicalCopies: number;
  readonly renderFrames: number;
  readonly brushBatches: number;
  readonly largestBatchStamps: number;
  readonly lightGlazePyramidUpdatedPixels: number;
  readonly presentationCacheUpdatedPixels: number;
}

export interface HumanDirtyRegionFrame {
  readonly index: number;
  readonly inputTimeMs: number;
  readonly stampCount: number;
  readonly footprints: readonly DirtyRegionRect[];
}

export interface HumanDirtyRegionWorkload {
  readonly source: "saved-human-stroke";
  readonly capturedAt: string;
  readonly fingerprint: string;
  readonly capturePointCount: number;
  readonly captureDurationMs: number;
  readonly captureExtent: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly coordinateScale: number;
  readonly settings: BrushSettings;
  readonly points: readonly HumanStrokePoint[];
  readonly frames: readonly HumanDirtyRegionFrame[];
  readonly footprints: readonly DirtyRegionRect[];
  readonly baseStampCount: number;
  readonly physicalCopyCount: number;
  readonly largestFrameStampCount: number;
  readonly releaseStampCount: number;
  readonly recordedReference: HumanDirtyRegionRecordedReference | null;
  readonly recordedReferenceMatches: boolean | null;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Human stroke ${label} is invalid.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseRecordedReference(
  value: StoredHumanStrokeTimeline,
): HumanDirtyRegionRecordedReference | null {
  const fixture = value.fixture;
  const performance = value.release?.performance;
  if (!fixture || !performance || typeof fixture.fingerprint !== "string") return null;
  const pointCount = nonNegativeInteger(fixture.pointCount);
  const baseStamps = nonNegativeInteger(performance.baseStamps);
  const physicalCopies = nonNegativeInteger(performance.physicalCopies);
  const renderFrames = nonNegativeInteger(performance.renderFrames);
  const brushBatches = nonNegativeInteger(performance.brushBatches);
  const largestBatchStamps = nonNegativeInteger(performance.largestBatchStamps);
  const traceDurationMs = typeof fixture.traceDurationMs === "number"
    && Number.isFinite(fixture.traceDurationMs)
    ? fixture.traceDurationMs
    : null;
  const lightGlazePyramidUpdatedPixels = nonNegativeInteger(
    performance.lightGlazePyramidUpdatedPixels,
  );
  const presentationCacheUpdatedPixels = nonNegativeInteger(
    performance.presentationCacheUpdatedPixels,
  );
  if (
    pointCount === null
    || baseStamps === null
    || physicalCopies === null
    || renderFrames === null
    || brushBatches === null
    || largestBatchStamps === null
    || traceDurationMs === null
    || lightGlazePyramidUpdatedPixels === null
    || presentationCacheUpdatedPixels === null
  ) return null;
  return {
    fingerprint: fixture.fingerprint,
    pointCount,
    traceDurationMs,
    baseStamps,
    physicalCopies,
    renderFrames,
    brushBatches,
    largestBatchStamps,
    lightGlazePyramidUpdatedPixels,
    presentationCacheUpdatedPixels,
  };
}

async function loadRecordedReference(): Promise<HumanDirtyRegionRecordedReference | null> {
  try {
    const response = await fetch(HUMAN_STROKE_TIMELINE_API_URL, { cache: "no-store" });
    if (!response.ok) return null;
    return parseRecordedReference(await response.json() as StoredHumanStrokeTimeline);
  } catch {
    return null;
  }
}

function stampFootprints(
  result: PackedStrokeStampResult,
  settings: Readonly<BrushSettings>,
  width: number,
  height: number,
): DirtyRegionRect[] {
  const footprints: DirtyRegionRect[] = [];
  const extentFactor = stampShapeExtentFactor(settings);
  for (const chunk of result.packedChunks) {
    if (chunk.packedStamps.byteLength !== chunk.stampCount * STAMP_STRIDE_BYTES) {
      throw new Error("Packed human stroke chunk has an invalid byte length.");
    }
    const view = new DataView(
      chunk.packedStamps.buffer,
      chunk.packedStamps.byteOffset,
      chunk.packedStamps.byteLength,
    );
    for (let index = 0; index < chunk.stampCount; index += 1) {
      const byteOffset = index * STAMP_STRIDE_BYTES;
      const x = view.getFloat32(byteOffset, true);
      const y = view.getFloat32(byteOffset + 4, true);
      const radius = view.getFloat32(byteOffset + 8, true);
      const directionX = view.getFloat32(byteOffset + 24, true);
      const directionY = view.getFloat32(byteOffset + 28, true);
      const directionLength = Math.hypot(directionX, directionY);
      const linearReach = radius * 2 * settings.positionJitterLinear;
      const lateralReach = radius * 2 * settings.positionJitterLateral;
      const brushReach = radius * extentFactor;
      let reachX: number;
      let reachY: number;
      if (directionLength > 0.0002) {
        const normalizedX = directionX / directionLength;
        const normalizedY = directionY / directionLength;
        reachX = brushReach
          + Math.abs(normalizedX) * linearReach
          + Math.abs(normalizedY) * lateralReach
          + 2;
        reachY = brushReach
          + Math.abs(normalizedY) * linearReach
          + Math.abs(normalizedX) * lateralReach
          + 2;
      } else {
        reachX = brushReach + linearReach + lateralReach + 2;
        reachY = reachX;
      }
      const left = Math.max(0, Math.floor(x - reachX));
      const top = Math.max(0, Math.floor(y - reachY));
      const right = Math.min(width, Math.ceil(x + reachX));
      const bottom = Math.min(height, Math.ceil(y + reachY));
      if (right > left && bottom > top) {
        footprints.push({ x: left, y: top, width: right - left, height: bottom - top });
      }
    }
  }
  if (footprints.length !== result.stampCount) {
    throw new Error(
      `Human stroke footprint count ${footprints.length} does not match ${result.stampCount} stamps.`,
    );
  }
  return footprints;
}

export async function loadHumanDirtyRegionWorkload(
  width: number,
  height: number,
): Promise<HumanDirtyRegionWorkload> {
  const response = await fetch(HUMAN_STROKE_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Human stroke request failed (${response.status}).`);
  }
  const stored = await response.json() as StoredHumanStrokeFixture;
  if (!stored.settings || !Array.isArray(stored.points) || stored.points.length < 2) {
    throw new Error("The saved human stroke fixture is incomplete.");
  }
  const coordinateScale = Math.min(width, height) / CAPTURE_DOCUMENT_EXTENT;
  const offsetX = (width - CAPTURE_DOCUMENT_EXTENT * coordinateScale) * 0.5;
  const offsetY = (height - CAPTURE_DOCUMENT_EXTENT * coordinateScale) * 0.5;
  const capturePoints: HumanStrokePoint[] = stored.points.map((point, index) => ({
    x: finiteNumber(point.x, `point ${index} x`),
    y: finiteNumber(point.y, `point ${index} y`),
    pressure: finiteNumber(point.pressure, `point ${index} pressure`),
    timeMs: finiteNumber(point.timeMs, `point ${index} time`),
  }));
  const points = capturePoints.map((point) => ({
    x: offsetX + point.x * coordinateScale,
    y: offsetY + point.y * coordinateScale,
    pressure: point.pressure,
    timeMs: point.timeMs,
  }));
  const settings: BrushSettings = {
    ...defaultBrushSettings,
    ...stored.settings,
    size: finiteNumber(stored.settings.size, "brush size") * coordinateScale,
  };
  const spacing = Math.max(0.1, settings.size * settings.spacingPercent / 100);
  const processor = await loadRequiredPackedStrokeGeometryProcessor();
  const session = processor.beginPacked(points[0], {
    stabilization: settings.stabilization,
    spacingMode: "fixed",
    spacing,
    size: settings.size,
    maximumBatchSize: STROKE_GEOMETRY_INPUT_BATCH_CAPACITY,
    dabCapacity: MAX_STAMPS_PER_BATCH,
    maximumStampsPerSegment: MAX_STAMPS_PER_BATCH,
  }, {
    size: settings.size,
    positionJitterLinear: settings.positionJitterLinear,
    positionJitterLateral: settings.positionJitterLateral,
    shapeExtentFactor: stampShapeExtentFactor(settings),
    documentWidth: width,
    documentHeight: height,
    seedSequence: 1,
    stampOrdinal: 0,
    radiusMode: "fixed",
    shapeSequenceMode: settings.shapeSequenceMode,
    shapeLayerCount: settings.shapeAssetIds?.length ?? 1,
    symmetryEnabled: false,
    startThickness: settings.startThickness,
    endThickness: settings.endThickness,
    startedAtMs: points[0].timeMs,
    flattenPackedStamps: false,
  });
  const frames: HumanDirtyRegionFrame[] = [];
  const allFootprints: DirtyRegionRect[] = [];
  let baseStampCount = 0;
  const appendFrame = (result: PackedStrokeStampResult, point: HumanStrokePoint): void => {
    const footprints = stampFootprints(result, settings, width, height);
    frames.push({
      index: frames.length,
      inputTimeMs: point.timeMs,
      stampCount: result.stampCount,
      footprints,
    });
    baseStampCount += result.stampCount;
    allFootprints.push(...footprints);
  };

  let releaseStampCount = 0;
  try {
    appendFrame(session.initialPackedStamps, points[0]);
    for (let index = 1; index < points.length; index += 1) {
      appendFrame(session.processBatch([points[index]], {
        spacing,
        includeTail: false,
        includePreviewTail: true,
      }), points[index]);
    }
    const released = session.finish({ referenceTimeMs: points.at(-1)!.timeMs });
    releaseStampCount = released.stampCount;
    if (released.stampCount > 0) appendFrame(released, points.at(-1)!);
  } catch (error) {
    session.cancel();
    throw error;
  }

  const fingerprint = fingerprintHumanStroke(capturePoints);
  const recordedReference = await loadRecordedReference();
  const largestFrameStampCount = frames.reduce(
    (largest, frame) => Math.max(largest, frame.stampCount),
    0,
  );
  const physicalCopyCount = baseStampCount * settings.count;
  const recordedReferenceMatches = recordedReference
    ? recordedReference.fingerprint === fingerprint
      && recordedReference.pointCount === capturePoints.length
      && recordedReference.baseStamps === baseStampCount
      && recordedReference.physicalCopies === physicalCopyCount
      && recordedReference.renderFrames === frames.length
      && recordedReference.brushBatches === frames.length
      && recordedReference.largestBatchStamps === largestFrameStampCount
    : null;

  return {
    source: "saved-human-stroke",
    capturedAt: typeof stored.capturedAt === "string" ? stored.capturedAt : "unknown",
    fingerprint,
    capturePointCount: capturePoints.length,
    captureDurationMs: capturePoints.at(-1)!.timeMs,
    captureExtent: CAPTURE_DOCUMENT_EXTENT,
    targetWidth: width,
    targetHeight: height,
    coordinateScale,
    settings,
    points,
    frames,
    footprints: allFootprints,
    baseStampCount,
    physicalCopyCount,
    largestFrameStampCount,
    releaseStampCount,
    recordedReference,
    recordedReferenceMatches,
  };
}
