import {
  CausalStrokeCurvePlanner,
} from "../../src/stroke-curve-core.ts";
import {
  CausalFadedStrokeStabilizer,
  normalizeStrokeStabilizationAmount,
} from "../../src/stroke-stabilization-core.ts";
import {
  resamplePaintCurveSegment,
  resamplePaintCurveSegmentWithVariableSpacing,
} from "../../src/paint-stamp-generation-core.ts";
import { directDepositSpacingDistance } from "../../src/direct-deposit-brush-core.ts";

const ABI_VERSION = 1;
const STAMP_PACK_ABI_VERSION = 2;
const INPUT_STRIDE = 4;
const DAB_STRIDE = 6;
const PACKED_STAMP_STRIDE_BYTES = 32;
const STAMP_PACK_CONFIG_LENGTH = 20;
const STAMP_PACK_SUMMARY_LENGTH = 12;
const TAIL_STRIDE = 10;
const SUMMARY_LENGTH = 16;
const TAIL_CAPACITY = 1025;
const WASM_PAGE_BYTES = 64 * 1024;
const MAXIMUM_SAMPLE_COUNT = 1_000_000;
const MAXIMUM_DAB_CAPACITY = 4_000_000;
const DEFAULT_MAXIMUM_STAMPS_PER_SEGMENT = 65_536;
const MAXIMUM_PACKED_STAMPS_PER_CHUNK = 65_536;
const THICKNESS_TAPER_WINDOW_MS = 100;

const STATUS_MESSAGES = new Map([
  [-1, "invalid kernel argument"],
  [-2, "inactive stroke state"],
  [-3, "dab output capacity exceeded"],
  [-4, "tail output capacity exceeded"],
]);

const align = (value, alignment) => Math.ceil(value / alignment) * alignment;

function normalizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > MAXIMUM_SAMPLE_COUNT) {
    throw new RangeError("A stroke requires a bounded, non-empty sample array.");
  }
  for (const sample of samples) {
    if (
      !sample
      || !Number.isFinite(sample.x)
      || !Number.isFinite(sample.y)
      || !Number.isFinite(sample.pressure)
      || !Number.isFinite(sample.timeMs)
    ) {
      throw new TypeError("Every stroke sample must contain finite x, y, pressure and timeMs.");
    }
  }
  return samples;
}

function normalizeOptions(samples, options = {}) {
  const stabilization = normalizeStrokeStabilizationAmount(options.stabilization ?? 0);
  const spacingMode = options.spacingMode === "direct-pressure" ? "direct-pressure" : "fixed";
  const spacingValue = spacingMode === "direct-pressure"
    ? Math.max(1, Number.isFinite(options.size) ? options.size : 1)
    : Math.max(0.1, Number.isFinite(options.spacing) ? options.spacing : 1);
  const maximumStampsPerSegment = Number.isSafeInteger(options.maximumStampsPerSegment)
    ? Math.max(1, Math.min(0xffff_ffff, options.maximumStampsPerSegment))
    : DEFAULT_MAXIMUM_STAMPS_PER_SEGMENT;
  const batchSize = Number.isSafeInteger(options.batchSize)
    ? Math.max(1, Math.min(samples.length, options.batchSize))
    : Math.max(1, samples.length - 1);
  let rawLength = 0;
  for (let index = 1; index < samples.length; index += 1) {
    rawLength += Math.hypot(
      samples[index].x - samples[index - 1].x,
      samples[index].y - samples[index - 1].y,
    );
  }
  let minimumSpacing = spacingValue;
  if (spacingMode === "direct-pressure") {
    minimumSpacing = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      minimumSpacing = Math.min(
        minimumSpacing,
        directDepositSpacingDistance(spacingValue, sample.pressure),
      );
    }
  }
  const estimatedCapacity = Math.ceil(rawLength * 4 / Math.max(0.1, minimumSpacing))
    + samples.length * 4
    + TAIL_CAPACITY;
  const dabCapacity = Number.isSafeInteger(options.dabCapacity)
    ? options.dabCapacity
    : Math.max(4096, estimatedCapacity);
  if (dabCapacity < 1 || dabCapacity > MAXIMUM_DAB_CAPACITY) {
    throw new RangeError("The requested dab capacity is outside the kernel limit.");
  }
  return {
    batchSize,
    dabCapacity,
    maximumStampsPerSegment,
    spacingMode,
    spacingValue,
    stabilization,
  };
}

function statsFromSummary(summary) {
  return {
    totalDabs: summary[3],
    maturePoints: summary[4],
    forcedMaturePoints: summary[5],
    tailPoints: summary[6],
    maximumTailPoints: summary[7],
    curveInputSegments: summary[8],
    curveFlattenedSegments: summary[9],
    curveSmoothedSegments: summary[10],
    curveSharpCornerBypasses: summary[11],
    spacingCarry: summary[12],
    latestSequence: summary[13],
    stabilizationTimeConstantMs: summary[14],
  };
}

function appendChunk(chunks, source, count) {
  if (count <= 0) return;
  chunks.push(source.slice(0, count * DAB_STRIDE));
}

function concatenateDabs(initial, chunks) {
  let length = DAB_STRIDE;
  for (const chunk of chunks) length += chunk.length;
  const output = new Float64Array(length);
  output.set(initial, 0);
  let offset = DAB_STRIDE;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function concatenateChunks(chunks) {
  if (chunks.length === 0) return new Float64Array(0);
  if (chunks.length === 1) return chunks[0];
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const output = new Float64Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function concatenatePackedChunks(chunks) {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function counterOption(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizeStampPackOptions(options = {}) {
  const finite = (value, label, minimum = 0) => {
    if (!Number.isFinite(value) || value < minimum) {
      throw new RangeError(`${label} must be finite and at least ${minimum}.`);
    }
    return Number(value);
  };
  const shapeLayerCount = options.shapeLayerCount ?? 1;
  if (!Number.isSafeInteger(shapeLayerCount) || shapeLayerCount < 1 || shapeLayerCount > 4) {
    throw new RangeError("Shape layer count must be an integer from 1 through 4.");
  }
  const radiusMode = options.radiusMode === "direct-pressure" ? 1 : 0;
  if (options.radiusMode !== undefined
    && options.radiusMode !== "fixed"
    && options.radiusMode !== "direct-pressure") {
    throw new TypeError("Stamp radius mode is invalid.");
  }
  const shapeSequenceMode = options.shapeSequenceMode === "random" ? 1 : 0;
  if (options.shapeSequenceMode !== undefined
    && options.shapeSequenceMode !== "ordered"
    && options.shapeSequenceMode !== "random") {
    throw new TypeError("Shape sequence mode is invalid.");
  }
  const symmetryEnabled = options.symmetryEnabled === true;
  const reflectionCosineDoubleAngle = finite(
    options.reflectionCosineDoubleAngle ?? 0,
    "Reflection cosine",
    -1,
  );
  const reflectionSineDoubleAngle = finite(
    options.reflectionSineDoubleAngle ?? 0,
    "Reflection sine",
    -1,
  );
  if (Math.abs(reflectionCosineDoubleAngle) > 1 || Math.abs(reflectionSineDoubleAngle) > 1) {
    throw new RangeError("Reflection coefficients must be between -1 and 1.");
  }
  return {
    size: finite(options.size, "Brush size", Number.EPSILON),
    positionJitterLinear: finite(
      options.positionJitterLinear ?? 0,
      "Linear position jitter",
    ),
    positionJitterLateral: finite(
      options.positionJitterLateral ?? 0,
      "Lateral position jitter",
    ),
    shapeExtentFactor: finite(
      options.shapeExtentFactor ?? 1,
      "Shape extent factor",
      Number.EPSILON,
    ),
    documentWidth: finite(options.documentWidth, "Document width", 1),
    documentHeight: finite(options.documentHeight, "Document height", 1),
    reflectionCosineDoubleAngle,
    reflectionSineDoubleAngle,
    seedSequence: counterOption(options.seedSequence ?? 1, "Seed sequence"),
    stampOrdinal: counterOption(options.stampOrdinal ?? 0, "Stamp ordinal"),
    radiusMode,
    shapeSequenceMode,
    shapeLayerCount,
    symmetryEnabled,
    startThickness: Math.min(2, finite(options.startThickness ?? 1, "Start thickness")),
    endThickness: Math.min(2, finite(options.endThickness ?? 1, "End thickness")),
    startedAtMs: finite(options.startedAtMs ?? 0, "Stroke start time", -Number.MAX_VALUE),
    flattenPackedStamps: options.flattenPackedStamps !== false,
  };
}

function thicknessTailHoldbackEnabled(state) {
  return Math.abs(state.endThickness - 1) > Number.EPSILON * 8;
}

function emptyPackedStampResult(
  state,
  remainingHeldDabCount = 0,
  maximumHeldDabCount = remainingHeldDabCount,
) {
  return {
    backend: "wasm-packed",
    packedStamps: new Uint8Array(0),
    packedChunks: [],
    stampCount: 0,
    firstSeed: null,
    dirtyRect: null,
    minimumRadius: Number.POSITIVE_INFINITY,
    nextSeedSequence: state.seedSequence,
    nextStampOrdinal: state.stampOrdinal,
    culledDabCount: 0,
    consumedDabCount: 0,
    generatedHeldDabCount: 0,
    releasedHeldDabCount: 0,
    releasedHeldAtLiftDabCount: 0,
    remainingHeldDabCount,
    maximumHeldDabCount,
    packComputeMs: 0,
  };
}

function combinePackedStampResults(
  results,
  state,
  flattenPackedStamps = state.flattenPackedStamps !== false,
) {
  if (results.length === 0) return emptyPackedStampResult(state);
  const packedChunks = [];
  let firstSeed = null;
  let dirtyRect = null;
  let minimumRadius = Number.POSITIVE_INFINITY;
  let stampCount = 0;
  let culledDabCount = 0;
  let consumedDabCount = 0;
  let generatedHeldDabCount = 0;
  let releasedHeldDabCount = 0;
  let releasedHeldAtLiftDabCount = 0;
  let remainingHeldDabCount = 0;
  let maximumHeldDabCount = 0;
  let packComputeMs = 0;
  let nextSeedSequence = state.seedSequence;
  let nextStampOrdinal = state.stampOrdinal;
  for (const result of results) {
    const leaves = Array.isArray(result.packedChunks)
      ? result.packedChunks
      : result.stampCount > 0
        ? [{
          packedStamps: result.packedStamps,
          stampCount: result.stampCount,
          firstSeed: result.firstSeed,
          dirtyRect: result.dirtyRect,
          minimumRadius: result.minimumRadius,
          culledDabCount: result.culledDabCount,
        }]
        : [];
    for (const leaf of leaves) {
      if (leaf.stampCount > MAXIMUM_PACKED_STAMPS_PER_CHUNK) {
        throw new Error("Packed stamp chunk exceeds the GPU upload capacity.");
      }
      if (leaf.stampCount > 0) packedChunks.push(leaf);
    }
    if (firstSeed === null && result.firstSeed !== null) firstSeed = result.firstSeed;
    minimumRadius = Math.min(minimumRadius, result.minimumRadius);
    stampCount += result.stampCount;
    culledDabCount += result.culledDabCount;
    consumedDabCount += result.consumedDabCount ?? (result.stampCount + result.culledDabCount);
    generatedHeldDabCount += result.generatedHeldDabCount ?? 0;
    releasedHeldDabCount += result.releasedHeldDabCount ?? 0;
    releasedHeldAtLiftDabCount += result.releasedHeldAtLiftDabCount ?? 0;
    remainingHeldDabCount = result.remainingHeldDabCount ?? remainingHeldDabCount;
    maximumHeldDabCount = Math.max(
      maximumHeldDabCount,
      result.maximumHeldDabCount ?? 0,
    );
    packComputeMs += result.packComputeMs;
    nextSeedSequence = result.nextSeedSequence;
    nextStampOrdinal = result.nextStampOrdinal;
    const rect = result.dirtyRect;
    if (rect) {
      if (!dirtyRect) {
        dirtyRect = { ...rect };
      } else {
        const right = Math.max(dirtyRect.x + dirtyRect.width, rect.x + rect.width);
        const bottom = Math.max(dirtyRect.y + dirtyRect.height, rect.y + rect.height);
        dirtyRect.x = Math.min(dirtyRect.x, rect.x);
        dirtyRect.y = Math.min(dirtyRect.y, rect.y);
        dirtyRect.width = right - dirtyRect.x;
        dirtyRect.height = bottom - dirtyRect.y;
      }
    }
  }
  return {
    backend: "wasm-packed",
    packedStamps: flattenPackedStamps
      ? concatenatePackedChunks(packedChunks.map((chunk) => chunk.packedStamps))
      : new Uint8Array(0),
    packedChunks,
    stampCount,
    firstSeed,
    dirtyRect,
    minimumRadius,
    nextSeedSequence,
    nextStampOrdinal,
    culledDabCount,
    consumedDabCount,
    generatedHeldDabCount,
    releasedHeldDabCount,
    releasedHeldAtLiftDabCount,
    remainingHeldDabCount,
    maximumHeldDabCount,
    packComputeMs,
  };
}

function initialDab(sample) {
  return new Float64Array([
    sample.x,
    sample.y,
    sample.pressure,
    sample.timeMs,
    1,
    0,
  ]);
}

function stabilizationTailFromUpdate(update) {
  if (!update || update.bypassed) return new Float64Array(0);
  const tail = new Float64Array(update.tailCount * TAIL_STRIDE);
  for (let index = 0; index < update.tailCount; index += 1) {
    const base = index * TAIL_STRIDE;
    tail[base] = update.tailX[index];
    tail[base + 1] = update.tailY[index];
    tail[base + 2] = update.tailPressure[index];
    tail[base + 3] = update.tailTimeMs[index];
    tail[base + 4] = update.tailSequence[index];
    tail[base + 5] = update.tailRawX[index];
    tail[base + 6] = update.tailRawY[index];
    tail[base + 7] = update.tailFilteredX[index];
    tail[base + 8] = update.tailFilteredY[index];
    tail[base + 9] = update.tailWeight[index];
  }
  return tail;
}

/** Streaming JavaScript fallback with the same gesture-boundary contract. */
export function beginStrokeGeometryJs(firstSource, options = {}) {
  const first = normalizeSamples([firstSource])[0];
  const request = normalizeOptions([first], {
    ...options,
    batchSize: 1,
    dabCapacity: options.dabCapacity ?? DEFAULT_MAXIMUM_STAMPS_PER_SEGMENT,
  });
  const curve = new CausalStrokeCurvePlanner();
  const stabilizer = request.stabilization > 0
    ? new CausalFadedStrokeStabilizer()
    : null;
  let stabilizationUpdate = stabilizer?.begin(first, request.stabilization) ?? null;
  let committed = { ...first };
  let spacingCarry = request.spacingMode === "direct-pressure"
    ? directDepositSpacingDistance(request.spacingValue, first.pressure)
    : 0;
  let active = true;
  let totalDabs = 1;
  let maturePoints = 0;
  let forcedMaturePoints = 0;
  let maximumTailPoints = stabilizationUpdate?.tailCount ?? 0;
  let curveInputSegments = 0;
  let curveFlattenedSegments = 0;
  let curveSmoothedSegments = 0;
  let curveSharpCornerBypasses = 0;
  let latestSequence = 0;

  const assertActive = () => {
    if (!active) throw new Error("The JavaScript stroke geometry session is no longer active.");
  };
  const appendFromPoint = (
    planner,
    startSource,
    carrySource,
    point,
    output,
    authoritative,
  ) => {
    const start = startSource;
    const normalized = {
      ...point,
      timeMs: Math.max(start.timeMs, point.timeMs),
    };
    let carry = carrySource;
    if (Math.hypot(normalized.x - start.x, normalized.y - start.y) > 0.0001) {
      const segment = planner.plan(start.x, start.y, normalized.x, normalized.y);
      if (authoritative) {
        curveInputSegments += 1;
        curveFlattenedSegments += segment.subdivisionCount;
        curveSmoothedSegments += Number(segment.smoothed);
        curveSharpCornerBypasses += Number(segment.sharpCornerBypass);
      }
      const emit = (_context, sample, directionX, directionY) => output.push(
        sample.x,
        sample.y,
        sample.pressure,
        sample.timeMs,
        directionX,
        directionY,
      );
      carry = request.spacingMode === "direct-pressure"
        ? resamplePaintCurveSegmentWithVariableSpacing(
            segment,
            start,
            normalized,
            carry,
            request.maximumStampsPerSegment,
            null,
            emit,
            (sample) => directDepositSpacingDistance(request.spacingValue, sample.pressure),
          )
        : resamplePaintCurveSegment(
            segment,
            start,
            normalized,
            request.spacingValue,
            carry,
            request.maximumStampsPerSegment,
            null,
            emit,
          );
    }
    return { committed: normalized, spacingCarry: carry };
  };
  const appendAuthoritativePoint = (point, output) => {
    const result = appendFromPoint(curve, committed, spacingCarry, point, output, true);
    committed = result.committed;
    spacingCarry = result.spacingCarry;
  };
  const previewDabsFromTail = (tail) => {
    if (tail.length <= TAIL_STRIDE) return new Float64Array(0);
    const previewCurve = new CausalStrokeCurvePlanner();
    previewCurve.copyStateFrom(curve);
    let previewCommitted = { ...committed };
    let previewCarry = spacingCarry;
    const output = [];
    for (let base = TAIL_STRIDE; base < tail.length; base += TAIL_STRIDE) {
      const result = appendFromPoint(
        previewCurve,
        previewCommitted,
        previewCarry,
        {
          x: tail[base],
          y: tail[base + 1],
          pressure: tail[base + 2],
          timeMs: tail[base + 3],
        },
        output,
        false,
      );
      previewCommitted = result.committed;
      previewCarry = result.spacingCarry;
    }
    return new Float64Array(output);
  };
  const stats = (tailPoints) => ({
    totalDabs,
    maturePoints,
    forcedMaturePoints,
    tailPoints,
    maximumTailPoints,
    curveInputSegments,
    curveFlattenedSegments,
    curveSmoothedSegments,
    curveSharpCornerBypasses,
    spacingCarry,
    latestSequence,
    stabilizationTimeConstantMs: 160 * request.stabilization ** 2,
  });
  const updateFixedSpacing = (spacing) => {
    if (request.spacingMode !== "fixed" || !Number.isFinite(spacing)) {
      throw new TypeError("Only a finite fixed spacing can change during a stroke.");
    }
    request.spacingValue = Math.max(0.1, spacing);
  };

  return {
    backend: "js",
    initialDab: initialDab(first),
    updateFixedSpacing(spacing, updateOptions = {}) {
      assertActive();
      updateFixedSpacing(spacing);
      if (updateOptions.includePreviewTail === false) return new Float64Array(0);
      return previewDabsFromTail(stabilizationTailFromUpdate(stabilizationUpdate));
    },
    processBatch(samplesSource, processOptions = {}) {
      assertActive();
      const samples = normalizeSamples(samplesSource);
      if (processOptions.spacing !== undefined) {
        updateFixedSpacing(processOptions.spacing);
      }
      const output = [];
      for (const sample of samples) {
        latestSequence += 1;
        if (!stabilizer) {
          appendAuthoritativePoint(sample, output);
          continue;
        }
        stabilizationUpdate = stabilizer.push(sample);
        maturePoints += stabilizationUpdate.matureCount;
        forcedMaturePoints += stabilizationUpdate.forcedMatureCount;
        maximumTailPoints = Math.max(maximumTailPoints, stabilizationUpdate.tailCount);
        for (let index = 0; index < stabilizationUpdate.matureCount; index += 1) {
          appendAuthoritativePoint({
            x: stabilizationUpdate.matureX[index],
            y: stabilizationUpdate.matureY[index],
            pressure: stabilizationUpdate.maturePressure[index],
            timeMs: stabilizationUpdate.matureTimeMs[index],
          }, output);
        }
      }
      totalDabs += output.length / DAB_STRIDE;
      const includeTail = processOptions.includeTail !== false;
      const includePreviewTail = processOptions.includePreviewTail !== false;
      const tailPointCount = stabilizationUpdate?.bypassed
        ? 0
        : (stabilizationUpdate?.tailCount ?? 0);
      const tailForPreview = includeTail || includePreviewTail
        ? stabilizationTailFromUpdate(stabilizationUpdate)
        : new Float64Array(0);
      return {
        backend: "js",
        dabs: new Float64Array(output),
        tail: includeTail ? tailForPreview : new Float64Array(0),
        previewDabs: includePreviewTail ? previewDabsFromTail(tailForPreview) : new Float64Array(0),
        stats: stats(tailPointCount),
      };
    },
    finish() {
      assertActive();
      const output = [];
      if (stabilizer) {
        stabilizationUpdate = stabilizer.finish();
        for (let index = 1; index < stabilizationUpdate.tailCount; index += 1) {
          appendAuthoritativePoint({
            x: stabilizationUpdate.tailX[index],
            y: stabilizationUpdate.tailY[index],
            pressure: stabilizationUpdate.tailPressure[index],
            timeMs: stabilizationUpdate.tailTimeMs[index],
          }, output);
        }
      }
      totalDabs += output.length / DAB_STRIDE;
      active = false;
      const tail = stabilizationTailFromUpdate(stabilizationUpdate);
      return {
        backend: "js",
        dabs: new Float64Array(output),
        tail,
        previewDabs: new Float64Array(0),
        stats: stats(tail.length / TAIL_STRIDE),
      };
    },
    cancel() {
      active = false;
    },
  };
}

/** Exact application-core fallback and executable specification for the ABI. */
export function processStrokeGeometryJs(samplesSource, options = {}) {
  const samples = normalizeSamples(samplesSource);
  const request = normalizeOptions(samples, options);
  const first = samples[0];
  const dabs = [
    first.x,
    first.y,
    first.pressure,
    first.timeMs,
    1,
    0,
  ];
  const curve = new CausalStrokeCurvePlanner();
  let committed = { ...first };
  let spacingCarry = request.spacingMode === "direct-pressure"
    ? directDepositSpacingDistance(request.spacingValue, first.pressure)
    : 0;
  let curveInputSegments = 0;
  let curveFlattenedSegments = 0;
  let curveSmoothedSegments = 0;
  let curveSharpCornerBypasses = 0;
  const emit = (_context, point, directionX, directionY) => {
    dabs.push(
      point.x,
      point.y,
      point.pressure,
      point.timeMs,
      directionX,
      directionY,
    );
  };
  const feed = (point) => {
    const normalized = {
      ...point,
      timeMs: Math.max(committed.timeMs, point.timeMs),
    };
    if (Math.hypot(normalized.x - committed.x, normalized.y - committed.y) > 0.0001) {
      const segment = curve.plan(
        committed.x,
        committed.y,
        normalized.x,
        normalized.y,
      );
      curveInputSegments += 1;
      curveFlattenedSegments += segment.subdivisionCount;
      curveSmoothedSegments += Number(segment.smoothed);
      curveSharpCornerBypasses += Number(segment.sharpCornerBypass);
      if (request.spacingMode === "direct-pressure") {
        spacingCarry = resamplePaintCurveSegmentWithVariableSpacing(
          segment,
          committed,
          normalized,
          spacingCarry,
          request.maximumStampsPerSegment,
          null,
          emit,
          (sample) => directDepositSpacingDistance(request.spacingValue, sample.pressure),
        );
      } else {
        spacingCarry = resamplePaintCurveSegment(
          segment,
          committed,
          normalized,
          request.spacingValue,
          spacingCarry,
          request.maximumStampsPerSegment,
          null,
          emit,
        );
      }
    }
    committed = normalized;
  };

  let maturePoints = 0;
  let forcedMaturePoints = 0;
  let maximumTailPoints = 0;
  let finalTail = new Float64Array(0);
  if (request.stabilization === 0) {
    for (let index = 1; index < samples.length; index += 1) feed(samples[index]);
  } else {
    const stabilizer = new CausalFadedStrokeStabilizer();
    let update = stabilizer.begin(first, request.stabilization);
    maximumTailPoints = update.tailCount;
    for (let index = 1; index < samples.length; index += 1) {
      update = stabilizer.push(samples[index]);
      maturePoints += update.matureCount;
      forcedMaturePoints += update.forcedMatureCount;
      maximumTailPoints = Math.max(maximumTailPoints, update.tailCount);
      for (let mature = 0; mature < update.matureCount; mature += 1) {
        feed({
          x: update.matureX[mature],
          y: update.matureY[mature],
          pressure: update.maturePressure[mature],
          timeMs: update.matureTimeMs[mature],
        });
      }
    }
    update = stabilizer.finish();
    finalTail = new Float64Array(update.tailCount * TAIL_STRIDE);
    for (let index = 0; index < update.tailCount; index += 1) {
      const base = index * TAIL_STRIDE;
      finalTail[base] = update.tailX[index];
      finalTail[base + 1] = update.tailY[index];
      finalTail[base + 2] = update.tailPressure[index];
      finalTail[base + 3] = update.tailTimeMs[index];
      finalTail[base + 4] = update.tailSequence[index];
      finalTail[base + 5] = update.tailRawX[index];
      finalTail[base + 6] = update.tailRawY[index];
      finalTail[base + 7] = update.tailFilteredX[index];
      finalTail[base + 8] = update.tailFilteredY[index];
      finalTail[base + 9] = update.tailWeight[index];
    }
    for (let index = 1; index < update.tailCount; index += 1) {
      feed({
        x: update.tailX[index],
        y: update.tailY[index],
        pressure: update.tailPressure[index],
        timeMs: update.tailTimeMs[index],
      });
    }
  }

  return {
    backend: "js",
    dabs: new Float64Array(dabs),
    tail: finalTail,
    stats: {
      totalDabs: dabs.length / DAB_STRIDE,
      maturePoints,
      forcedMaturePoints,
      tailPoints: finalTail.length / TAIL_STRIDE,
      maximumTailPoints,
      curveInputSegments,
      curveFlattenedSegments,
      curveSmoothedSegments,
      curveSharpCornerBypasses,
      spacingCarry,
      latestSequence: samples.length - 1,
      stabilizationTimeConstantMs: 160 * request.stabilization ** 2,
    },
  };
}

function heapBaseValue(exports) {
  const heapBase = exports.__heap_base;
  const value = heapBase instanceof WebAssembly.Global ? heapBase.value : heapBase;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    throw new Error("Stroke geometry kernel does not export a valid heap base.");
  }
  return Number(value);
}

function instanceFromResult(result) {
  return result instanceof WebAssembly.Instance ? result : result.instance;
}

function assertStatus(status, summary) {
  if (status === 0) return;
  const message = STATUS_MESSAGES.get(status) ?? `unknown status ${status}`;
  throw new Error(
    `Stroke geometry kernel failed: ${message}; consumed ${summary?.[1] ?? 0} inputs.`,
  );
}

/** Instantiates the module and exposes streaming and whole-stroke adapters. */
export async function instantiateStrokeGeometryKernel(moduleOrBytes) {
  const result = moduleOrBytes instanceof WebAssembly.Module
    ? await WebAssembly.instantiate(moduleOrBytes, {})
    : await WebAssembly.instantiate(moduleOrBytes, {});
  const instance = instanceFromResult(result);
  const exports = instance.exports;
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("Stroke geometry kernel does not export linear memory.");
  }
  for (const name of [
    "stroke_geometry_abi_version",
    "stroke_geometry_state_bytes",
    "stroke_geometry_begin",
    "stroke_geometry_set_fixed_spacing",
    "stroke_geometry_process_batch",
    "stroke_geometry_finish",
    "stroke_geometry_copy_state",
    "stroke_stamp_pack_abi_version",
    "stroke_stamp_pack_dabs_in_place",
  ]) {
    if (typeof exports[name] !== "function") {
      throw new Error(`Stroke geometry kernel entry point is missing: ${name}.`);
    }
  }
  if (exports.stroke_geometry_abi_version() !== ABI_VERSION) {
    throw new Error("Stroke geometry kernel ABI version is incompatible.");
  }
  if (exports.stroke_stamp_pack_abi_version() !== STAMP_PACK_ABI_VERSION) {
    throw new Error("Stroke stamp packing kernel ABI version is incompatible.");
  }
  const stateBytes = exports.stroke_geometry_state_bytes();
  const heapBase = align(heapBaseValue(exports), 16);
  let activeSessionToken = null;

  const beginInternal = (firstSource, options = {}, packedOptionsSource = null) => {
    const first = normalizeSamples([firstSource])[0];
    if (activeSessionToken !== null) {
      throw new Error("A stroke geometry streaming session is already active.");
    }
    const requestedInputCapacity = options.maximumBatchSize ?? options.batchSize ?? 256;
    if (!Number.isSafeInteger(requestedInputCapacity) || requestedInputCapacity < 1) {
      throw new RangeError("The streaming batch capacity must be a positive integer.");
    }
    const request = normalizeOptions([first], {
      ...options,
      batchSize: 1,
      dabCapacity: options.dabCapacity ?? DEFAULT_MAXIMUM_STAMPS_PER_SEGMENT,
    });
    const packState = packedOptionsSource === null
      ? null
      : normalizeStampPackOptions({
        ...packedOptionsSource,
        startedAtMs: packedOptionsSource.startedAtMs ?? first.timeMs,
      });
    const inputCapacity = Math.min(MAXIMUM_SAMPLE_COUNT, requestedInputCapacity);
    const statePtr = heapBase;
    const previewStatePtr = align(statePtr + stateBytes, 16);
    const inputPtr = align(previewStatePtr + stateBytes, 16);
    const dabPtr = align(inputPtr + inputCapacity * INPUT_STRIDE * 8, 16);
    const tailPtr = align(dabPtr + request.dabCapacity * DAB_STRIDE * 8, 16);
    const summaryPtr = align(tailPtr + TAIL_CAPACITY * TAIL_STRIDE * 8, 16);
    const packConfigPtr = align(summaryPtr + SUMMARY_LENGTH * 8, 16);
    const packSummaryPtr = align(
      packConfigPtr + STAMP_PACK_CONFIG_LENGTH * 8,
      16,
    );
    const end = packSummaryPtr + STAMP_PACK_SUMMARY_LENGTH * 8;
    const expandedFinishDabPtr = align(end, 16);
    const ensureMemoryThrough = (requiredEnd) => {
      const missingBytes = requiredEnd - exports.memory.buffer.byteLength;
      if (missingBytes <= 0) return;
      try {
        exports.memory.grow(Math.ceil(missingBytes / WASM_PAGE_BYTES));
      } catch (cause) {
        throw new RangeError(
          `Stroke geometry kernel could not reserve ${requiredEnd} bytes of linear memory.`,
          { cause },
        );
      }
    };
    ensureMemoryThrough(end);
    const spacingMode = request.spacingMode === "direct-pressure" ? 1 : 0;
    const beginStatus = exports.stroke_geometry_begin(
      statePtr,
      request.stabilization,
      spacingMode,
      request.spacingValue,
      request.maximumStampsPerSegment,
      first.x,
      first.y,
      first.pressure,
      first.timeMs,
    );
    assertStatus(beginStatus);
    const token = {};
    let finished = false;
    let expandedDabCapacity = request.dabCapacity;
    let latestReferenceTimeMs = first.timeMs;
    const heldThicknessDabChunks = [];
    let heldThicknessDabCount = 0;
    let maximumHeldThicknessDabCount = 0;
    const thicknessTailHoldback = Boolean(packState && thicknessTailHoldbackEnabled(packState));

    const assertActive = () => {
      if (finished || activeSessionToken !== token) {
        throw new Error("The stroke geometry streaming session is no longer active.");
      }
    };
    const copyCurrentTail = (summary) => new Float64Array(
      new Float64Array(
        exports.memory.buffer,
        tailPtr,
        summary[6] * TAIL_STRIDE,
      ),
    );
    const currentDabArena = () => {
      const pointer = expandedDabCapacity === request.dabCapacity
        ? dabPtr
        : expandedFinishDabPtr;
      ensureMemoryThrough(pointer + expandedDabCapacity * DAB_STRIDE * 8);
      return { pointer, capacity: expandedDabCapacity };
    };
    const growDabArena = () => {
      if (expandedDabCapacity >= MAXIMUM_DAB_CAPACITY) return false;
      expandedDabCapacity = Math.min(
        MAXIMUM_DAB_CAPACITY,
        Math.max(expandedDabCapacity + 1, expandedDabCapacity * 2),
      );
      return true;
    };
    const packDabArena = (
      pointer,
      dabCount,
      stateSource,
      mutateState,
      thickness = {},
    ) => {
      const workingState = { ...stateSource };
      const finalSeedSequence = workingState.seedSequence + dabCount;
      const finalStampOrdinal = workingState.stampOrdinal + dabCount;
      if (
        !Number.isSafeInteger(finalSeedSequence)
        || !Number.isSafeInteger(finalStampOrdinal)
      ) {
        throw new Error("Packed stroke counters exceed the safe integer range.");
      }
      const results = [];
      let sourceOffset = 0;
      while (sourceOffset < dabCount) {
        const count = Math.min(
          MAXIMUM_PACKED_STAMPS_PER_CHUNK,
          dabCount - sourceOffset,
        );
        const nextSeedSequence = workingState.seedSequence + count;
        const nextStampOrdinal = workingState.stampOrdinal + count;
        if (
          !Number.isSafeInteger(nextSeedSequence)
          || !Number.isSafeInteger(nextStampOrdinal)
        ) {
          throw new Error("Packed stroke counters exceed the safe integer range.");
        }
        const sourcePointer = pointer + sourceOffset * DAB_STRIDE * 8;
        const config = new Float64Array(
          exports.memory.buffer,
          packConfigPtr,
          STAMP_PACK_CONFIG_LENGTH,
        );
        config.set([
          workingState.size,
          workingState.positionJitterLinear,
          workingState.positionJitterLateral,
          workingState.shapeExtentFactor,
          workingState.documentWidth,
          workingState.documentHeight,
          workingState.reflectionCosineDoubleAngle,
          workingState.reflectionSineDoubleAngle,
          workingState.seedSequence >>> 0,
          workingState.stampOrdinal,
          workingState.radiusMode,
          workingState.shapeSequenceMode,
          workingState.shapeLayerCount,
          workingState.symmetryEnabled ? 1 : 0,
          workingState.startThickness,
          workingState.endThickness,
          workingState.startedAtMs,
          thickness.referenceTimeMs ?? 0,
          thickness.applyEndTaper === true ? 1 : 0,
          0,
        ]);
        const startedAt = performance.now();
        const status = exports.stroke_stamp_pack_dabs_in_place(
          sourcePointer,
          count,
          packConfigPtr,
          packSummaryPtr,
        );
        const summary = new Float64Array(
          new Float64Array(
            exports.memory.buffer,
            packSummaryPtr,
            STAMP_PACK_SUMMARY_LENGTH,
          ),
        );
        assertStatus(status, summary);
        if (summary[1] !== count || summary[2] < 0 || summary[2] > count) {
          throw new Error("Stroke stamp packing kernel returned an invalid count.");
        }
        const stampCount = summary[2];
        const packedStamps = new Uint8Array(
          exports.memory.buffer,
          sourcePointer,
          stampCount * PACKED_STAMP_STRIDE_BYTES,
        ).slice();
        const dirtyRect = summary[6] > 0 && summary[7] > 0
          ? {
            x: summary[4],
            y: summary[5],
            width: summary[6],
            height: summary[7],
          }
          : null;
        const expectedNextSeedLow32 = nextSeedSequence >>> 0;
        if (
          (summary[9] >>> 0) !== expectedNextSeedLow32
          || summary[10] !== nextStampOrdinal
        ) {
          throw new Error("Stroke stamp packing kernel returned invalid counters.");
        }
        workingState.seedSequence = nextSeedSequence;
        workingState.stampOrdinal = nextStampOrdinal;
        results.push({
          backend: "wasm-packed",
          packedStamps,
          stampCount,
          firstSeed: summary[3] < 0 ? null : summary[3] >>> 0,
          dirtyRect,
          minimumRadius: summary[8],
          nextSeedSequence: workingState.seedSequence,
          nextStampOrdinal: workingState.stampOrdinal,
          culledDabCount: summary[11],
          consumedDabCount: count,
          packComputeMs: performance.now() - startedAt,
        });
        sourceOffset += count;
      }
      const combined = combinePackedStampResults(results, workingState);
      if (mutateState) {
        stateSource.seedSequence = workingState.seedSequence;
        stateSource.stampOrdinal = workingState.stampOrdinal;
      }
      return combined;
    };
    const packedResultContract = (result, consumedDabCount, state = packState) => ({
      ...result,
      consumedDabCount,
      nextSeedSequence: state.seedSequence,
      nextStampOrdinal: state.stampOrdinal,
    });
    const advancePackedCounters = (state, count) => {
      const nextSeedSequence = state.seedSequence + count;
      const nextStampOrdinal = state.stampOrdinal + count;
      if (!Number.isSafeInteger(nextSeedSequence) || !Number.isSafeInteger(nextStampOrdinal)) {
        throw new Error("Packed stroke counters exceed the safe integer range.");
      }
      state.seedSequence = nextSeedSequence;
      state.stampOrdinal = nextStampOrdinal;
    };
    const copiedDabs = (pointer, dabOffset, dabCount) => new Float64Array(
      new Float64Array(
        exports.memory.buffer,
        pointer + dabOffset * DAB_STRIDE * 8,
        dabCount * DAB_STRIDE,
      ),
    );
    const matureDabCount = (dabs, referenceTimeMs) => {
      const cutoff = referenceTimeMs - THICKNESS_TAPER_WINDOW_MS;
      let count = 0;
      while (count < dabs.length / DAB_STRIDE) {
        if (dabs[count * DAB_STRIDE + 3] > cutoff) break;
        count += 1;
      }
      return count;
    };
    const consumeGeneratedDabs = (pointer, dabCount, referenceTimeMs) => {
      if (!packState || !thicknessTailHoldback) {
        return packState
          ? packDabArena(pointer, dabCount, packState, true)
          : null;
      }
      const source = new Float64Array(
        exports.memory.buffer,
        pointer,
        dabCount * DAB_STRIDE,
      );
      const matureCount = matureDabCount(source, referenceTimeMs);
      const workingState = { ...packState };
      const mature = matureCount > 0
        ? packDabArena(pointer, matureCount, workingState, true)
        : emptyPackedStampResult(workingState);
      const heldCount = dabCount - matureCount;
      if (heldCount > 0) {
        heldThicknessDabChunks.push({
          dabs: copiedDabs(pointer, matureCount, heldCount),
          seedSequence: workingState.seedSequence,
          stampOrdinal: workingState.stampOrdinal,
        });
        advancePackedCounters(workingState, heldCount);
        heldThicknessDabCount += heldCount;
        maximumHeldThicknessDabCount = Math.max(
          maximumHeldThicknessDabCount,
          heldThicknessDabCount,
        );
      }
      packState.seedSequence = workingState.seedSequence;
      packState.stampOrdinal = workingState.stampOrdinal;
      return {
        ...packedResultContract(mature, dabCount),
        generatedHeldDabCount: heldCount,
        remainingHeldDabCount: heldThicknessDabCount,
        maximumHeldDabCount: maximumHeldThicknessDabCount,
      };
    };
    const copyDabsIntoCurrentArena = (dabs) => {
      const dabCount = dabs.length / DAB_STRIDE;
      while (expandedDabCapacity < dabCount && growDabArena()) {
        // Grow until the complete retained chunk fits in the shared scratch arena.
      }
      const output = currentDabArena();
      if (dabCount > output.capacity) {
        throw new RangeError("Retained thickness tail exceeds the dab arena capacity.");
      }
      new Float64Array(
        exports.memory.buffer,
        output.pointer,
        dabs.length,
      ).set(dabs);
      return output.pointer;
    };
    const releaseHeldThicknessDabs = (referenceTimeMs, atLift) => {
      if (!packState || !thicknessTailHoldback || heldThicknessDabChunks.length === 0) {
        return packState
          ? emptyPackedStampResult(
            packState,
            heldThicknessDabCount,
            maximumHeldThicknessDabCount,
          )
          : null;
      }
      const results = [];
      let releasedCandidateCount = 0;
      let chunkIndex = 0;
      while (chunkIndex < heldThicknessDabChunks.length) {
        const chunk = heldThicknessDabChunks[chunkIndex];
        const availableCount = chunk.dabs.length / DAB_STRIDE;
        const releaseCount = atLift
          ? availableCount
          : matureDabCount(chunk.dabs, referenceTimeMs);
        if (releaseCount === 0) break;
        const releasedDabs = releaseCount === availableCount
          ? chunk.dabs
          : chunk.dabs.slice(0, releaseCount * DAB_STRIDE);
        const pointer = copyDabsIntoCurrentArena(releasedDabs);
        const sequenceState = {
          ...packState,
          seedSequence: chunk.seedSequence,
          stampOrdinal: chunk.stampOrdinal,
        };
        results.push(packDabArena(
          pointer,
          releaseCount,
          sequenceState,
          false,
          { applyEndTaper: atLift, referenceTimeMs },
        ));
        releasedCandidateCount += releaseCount;
        heldThicknessDabCount -= releaseCount;
        if (releaseCount === availableCount) {
          heldThicknessDabChunks.splice(chunkIndex, 1);
        } else {
          chunk.dabs = chunk.dabs.slice(releaseCount * DAB_STRIDE);
          chunk.seedSequence += releaseCount;
          chunk.stampOrdinal += releaseCount;
          break;
        }
      }
      return {
        ...packedResultContract(combinePackedStampResults(results, packState), 0),
        releasedHeldDabCount: atLift ? 0 : releasedCandidateCount,
        releasedHeldAtLiftDabCount: atLift ? releasedCandidateCount : 0,
        remainingHeldDabCount: heldThicknessDabCount,
        maximumHeldDabCount: maximumHeldThicknessDabCount,
      };
    };
    const previewHeldThicknessDabs = (referenceTimeMs, provisionalDabs = null) => {
      if (!packState || !thicknessTailHoldback) return emptyPackedStampResult(packState);
      const results = [];
      for (const chunk of heldThicknessDabChunks) {
        const pointer = copyDabsIntoCurrentArena(chunk.dabs);
        results.push(packDabArena(
          pointer,
          chunk.dabs.length / DAB_STRIDE,
          {
            ...packState,
            seedSequence: chunk.seedSequence,
            stampOrdinal: chunk.stampOrdinal,
          },
          false,
          { applyEndTaper: true, referenceTimeMs },
        ));
      }
      if (provisionalDabs && provisionalDabs.length > 0) {
        const pointer = copyDabsIntoCurrentArena(provisionalDabs);
        results.push(packDabArena(
          pointer,
          provisionalDabs.length / DAB_STRIDE,
          packState,
          false,
          { applyEndTaper: true, referenceTimeMs },
        ));
      }
      return {
        ...packedResultContract(combinePackedStampResults(results, packState), 0),
        remainingHeldDabCount: heldThicknessDabCount,
        maximumHeldDabCount: maximumHeldThicknessDabCount,
      };
    };
    const finishFromSnapshot = (
      targetStatePtr,
      snapshotStatePtr,
      packedStateSource = null,
      mutatePackedState = false,
    ) => {
      while (true) {
        const output = currentDabArena();
        assertStatus(exports.stroke_geometry_copy_state(targetStatePtr, snapshotStatePtr));
        const status = exports.stroke_geometry_finish(
          targetStatePtr,
          output.pointer,
          output.capacity,
          tailPtr,
          TAIL_CAPACITY,
          summaryPtr,
        );
        const summary = new Float64Array(
          new Float64Array(exports.memory.buffer, summaryPtr, SUMMARY_LENGTH),
        );
        if (status === -3 && growDabArena()) {
          continue;
        }
        assertStatus(status, summary);
        const packed = packedStateSource
          ? packDabArena(
            output.pointer,
            summary[2],
            packedStateSource,
            mutatePackedState,
          )
          : null;
        return {
          dabs: packed
            ? new Float64Array(0)
            : new Float64Array(
              new Float64Array(
                exports.memory.buffer,
                output.pointer,
                summary[2] * DAB_STRIDE,
              ),
            ),
          packed,
          tail: copyCurrentTail(summary),
          stats: statsFromSummary(summary),
        };
      }
    };
    const previewTail = (referenceTimeMs = latestReferenceTimeMs) => {
      if (request.stabilization === 0) {
        return packState && thicknessTailHoldback
          ? previewHeldThicknessDabs(referenceTimeMs)
          : packState ? emptyPackedStampResult(packState) : new Float64Array(0);
      }
      if (packState && thicknessTailHoldback) {
        const preview = finishFromSnapshot(previewStatePtr, statePtr, null, false);
        return previewHeldThicknessDabs(referenceTimeMs, preview.dabs);
      }
      const preview = finishFromSnapshot(
        previewStatePtr,
        statePtr,
        packState,
        false,
      );
      return packState ? preview.packed : preview.dabs;
    };
    const updateFixedSpacing = (spacing) => {
      if (request.spacingMode !== "fixed" || !Number.isFinite(spacing)) {
        throw new TypeError("Only a finite fixed spacing can change during a stroke.");
      }
      const normalizedSpacing = Math.max(0.1, spacing);
      assertStatus(exports.stroke_geometry_set_fixed_spacing(statePtr, normalizedSpacing));
      request.spacingValue = normalizedSpacing;
    };

    let initialPacked = null;
    let initialPackedPreview = null;
    if (packState) {
      new Float64Array(exports.memory.buffer, dabPtr, DAB_STRIDE).set(initialDab(first));
      initialPacked = consumeGeneratedDabs(dabPtr, 1, latestReferenceTimeMs);
      initialPackedPreview = previewTail(latestReferenceTimeMs);
    }

    // Acquire the single-session token only after every fallible setup step.
    // A rejected initial packed record must not poison the processor instance.
    activeSessionToken = token;
    return {
      backend: packState ? "wasm-packed" : "wasm",
      initialDab: packState ? new Float64Array(0) : initialDab(first),
      initialPackedStamps: initialPacked,
      initialPreviewPackedStamps: initialPackedPreview,
      updateFixedSpacing(spacing, updateOptions = {}) {
        assertActive();
        try {
          updateFixedSpacing(spacing);
          if (updateOptions.includePreviewTail === false) {
            return packState
              ? emptyPackedStampResult(
                packState,
                heldThicknessDabCount,
                maximumHeldThicknessDabCount,
              )
              : new Float64Array(0);
          }
          return previewTail();
        } catch (error) {
          finished = true;
          if (activeSessionToken === token) activeSessionToken = null;
          throw error;
        }
      },
      processBatch(samplesSource, processOptions = {}) {
        assertActive();
        try {
        const samples = normalizeSamples(samplesSource);
        latestReferenceTimeMs = Math.max(
          latestReferenceTimeMs,
          samples[samples.length - 1].timeMs,
        );
        if (processOptions.spacing !== undefined) {
          updateFixedSpacing(processOptions.spacing);
        }
        const chunks = [];
        const packedChunks = [];
        if (packState && thicknessTailHoldback) {
          packedChunks.push(releaseHeldThicknessDabs(latestReferenceTimeMs, false));
        }
        const includeTail = processOptions.includeTail !== false;
        let tail = new Float64Array(0);
        let stats = null;
        let next = 0;
        while (next < samples.length) {
          let count = Math.min(inputCapacity, samples.length - next);
          while (true) {
            const output = currentDabArena();
            const input = new Float64Array(
              exports.memory.buffer,
              inputPtr,
              count * INPUT_STRIDE,
            );
            for (let offset = 0; offset < count; offset += 1) {
              const sample = samples[next + offset];
              const base = offset * INPUT_STRIDE;
              input[base] = sample.x;
              input[base + 1] = sample.y;
              input[base + 2] = sample.pressure;
              input[base + 3] = sample.timeMs;
            }
            assertStatus(exports.stroke_geometry_copy_state(previewStatePtr, statePtr));
            const status = exports.stroke_geometry_process_batch(
              statePtr,
              inputPtr,
              count,
              output.pointer,
              output.capacity,
              tailPtr,
              TAIL_CAPACITY,
              summaryPtr,
            );
            const summary = new Float64Array(
              new Float64Array(exports.memory.buffer, summaryPtr, SUMMARY_LENGTH),
            );
            if (status === -3) {
              assertStatus(exports.stroke_geometry_copy_state(statePtr, previewStatePtr));
              if (count > 1) {
                count = Math.max(1, Math.floor(count / 2));
                continue;
              }
              if (growDabArena()) continue;
            }
            assertStatus(status, summary);
            if (packState) {
              packedChunks.push(
                consumeGeneratedDabs(output.pointer, summary[2], latestReferenceTimeMs),
              );
            } else {
              appendChunk(
                chunks,
                new Float64Array(
                  exports.memory.buffer,
                  output.pointer,
                  summary[2] * DAB_STRIDE,
                ),
                summary[2],
              );
            }
            if (includeTail && next + count >= samples.length) {
              tail = copyCurrentTail(summary);
            }
            stats = statsFromSummary(summary);
            next += count;
            break;
          }
        }
        const includePreviewTail = processOptions.includePreviewTail !== false;
        const preview = includePreviewTail
          ? previewTail(latestReferenceTimeMs)
          : packState
            ? emptyPackedStampResult(
              packState,
              heldThicknessDabCount,
              maximumHeldThicknessDabCount,
            )
            : new Float64Array(0);
        if (packState) {
          return {
            ...combinePackedStampResults(packedChunks, packState),
            tail,
            previewPackedStamps: preview,
            stats,
          };
        }
        return {
          backend: "wasm",
          dabs: concatenateChunks(chunks),
          tail,
          previewDabs: preview,
          stats,
        };
        } catch (error) {
          finished = true;
          if (activeSessionToken === token) activeSessionToken = null;
          throw error;
        }
      },
      refreshThickness(referenceTimeMs = latestReferenceTimeMs) {
        assertActive();
        if (!packState || !thicknessTailHoldback) {
          return {
            releasedPackedStamps: packState ? emptyPackedStampResult(packState) : null,
            previewPackedStamps: packState ? emptyPackedStampResult(packState) : null,
          };
        }
        if (!Number.isFinite(referenceTimeMs)) {
          throw new TypeError("Thickness reference time must be finite.");
        }
        latestReferenceTimeMs = Math.max(latestReferenceTimeMs, referenceTimeMs);
        return {
          releasedPackedStamps: releaseHeldThicknessDabs(latestReferenceTimeMs, false),
          previewPackedStamps: previewTail(latestReferenceTimeMs),
        };
      },
      finish(finishOptions = {}) {
        assertActive();
        try {
          const requestedReferenceTimeMs = finishOptions.referenceTimeMs ?? latestReferenceTimeMs;
          if (!Number.isFinite(requestedReferenceTimeMs)) {
            throw new TypeError("Thickness lift time must be finite.");
          }
          latestReferenceTimeMs = Math.max(latestReferenceTimeMs, requestedReferenceTimeMs);
          assertStatus(exports.stroke_geometry_copy_state(previewStatePtr, statePtr));
          if (packState && thicknessTailHoldback) {
            const completed = finishFromSnapshot(
              statePtr,
              previewStatePtr,
              null,
              false,
            );
            let consumedDabCount = 0;
            if (completed.dabs.length > 0) {
              const dabCount = completed.dabs.length / DAB_STRIDE;
              heldThicknessDabChunks.push({
                dabs: completed.dabs,
                seedSequence: packState.seedSequence,
                stampOrdinal: packState.stampOrdinal,
              });
              advancePackedCounters(packState, dabCount);
              heldThicknessDabCount += dabCount;
              maximumHeldThicknessDabCount = Math.max(
                maximumHeldThicknessDabCount,
                heldThicknessDabCount,
              );
              consumedDabCount = dabCount;
            }
            const released = releaseHeldThicknessDabs(latestReferenceTimeMs, true);
            return {
              ...packedResultContract(released, consumedDabCount),
              generatedHeldDabCount: consumedDabCount,
              maximumHeldDabCount: maximumHeldThicknessDabCount,
              tail: completed.tail,
              previewPackedStamps: emptyPackedStampResult(
                packState,
                heldThicknessDabCount,
                maximumHeldThicknessDabCount,
              ),
              stats: completed.stats,
            };
          }
          const completed = finishFromSnapshot(
            statePtr,
            previewStatePtr,
            packState,
            Boolean(packState),
          );
          if (packState) {
            return {
              ...completed.packed,
              tail: completed.tail,
              previewPackedStamps: emptyPackedStampResult(packState),
              stats: completed.stats,
            };
          }
          return {
            backend: "wasm",
            dabs: completed.dabs,
            tail: completed.tail,
            previewDabs: new Float64Array(0),
            stats: completed.stats,
          };
        } finally {
          finished = true;
          if (activeSessionToken === token) activeSessionToken = null;
        }
      },
      cancel() {
        if (finished) return;
        finished = true;
        if (activeSessionToken === token) activeSessionToken = null;
      },
    };
  };

  const begin = (firstSource, options = {}) => (
    beginInternal(firstSource, options, null)
  );
  const beginPacked = (firstSource, options = {}, packedOptions = {}) => (
    beginInternal(firstSource, options, packedOptions)
  );

  const processor = {
    backend: "wasm",
    memoryBytes() {
      return exports.memory.buffer.byteLength;
    },
    begin,
    beginPacked,
    processStroke(samplesSource, options = {}) {
      const samples = normalizeSamples(samplesSource);
      const request = normalizeOptions(samples, options);
      const first = samples[0];
      const session = begin(first, {
        ...request,
        batchSize: request.batchSize,
        maximumBatchSize: request.batchSize,
        spacing: request.spacingMode === "fixed" ? request.spacingValue : undefined,
        size: request.spacingMode === "direct-pressure" ? request.spacingValue : undefined,
      });
      let processed;
      let finishedResult;
      try {
        processed = samples.length > 1
          ? session.processBatch(samples.slice(1), { includePreviewTail: false })
          : { dabs: new Float64Array(0) };
        finishedResult = session.finish();
      } catch (error) {
        session.cancel();
        throw error;
      }
      return {
        backend: "wasm",
        dabs: concatenateDabs(session.initialDab, [processed.dabs, finishedResult.dabs]),
        tail: finishedResult.tail,
        stats: finishedResult.stats,
        memoryBytes: exports.memory.buffer.byteLength,
      };
    },
  };
  return processor;
}

/** Loads the required geometry+packing module and never substitutes JavaScript. */
export async function createRequiredStrokeGeometryProcessor(options = {}) {
  let moduleOrBytes = options.moduleOrBytes;
  if (!moduleOrBytes) {
    const url = options.url ?? new URL("./dist/stroke_geometry_kernel.wasm", import.meta.url);
    const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    if (typeof fetchImplementation !== "function") {
      throw new Error("fetch is unavailable for stroke geometry kernel loading.");
    }
    const response = await fetchImplementation(url);
    if (!response.ok) {
      throw new Error(`Stroke geometry kernel fetch failed (${response.status}).`);
    }
    moduleOrBytes = await response.arrayBuffer();
  }
  return instantiateStrokeGeometryKernel(moduleOrBytes);
}

/** Legacy optional loader retained only for explicit reference A/B tests. */
export async function createStrokeGeometryProcessor(options = {}) {
  try {
    return await createRequiredStrokeGeometryProcessor(options);
  } catch (initializationError) {
    return {
      backend: "js",
      initializationError,
      begin: beginStrokeGeometryJs,
      processStroke: processStrokeGeometryJs,
    };
  }
}
