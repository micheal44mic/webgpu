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
const INPUT_STRIDE = 4;
const DAB_STRIDE = 6;
const TAIL_STRIDE = 10;
const SUMMARY_LENGTH = 16;
const TAIL_CAPACITY = 1025;
const WASM_PAGE_BYTES = 64 * 1024;
const MAXIMUM_SAMPLE_COUNT = 1_000_000;
const MAXIMUM_DAB_CAPACITY = 4_000_000;
const DEFAULT_MAXIMUM_STAMPS_PER_SEGMENT = 65_536;

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
  ]) {
    if (typeof exports[name] !== "function") {
      throw new Error(`Stroke geometry kernel entry point is missing: ${name}.`);
    }
  }
  if (exports.stroke_geometry_abi_version() !== ABI_VERSION) {
    throw new Error("Stroke geometry kernel ABI version is incompatible.");
  }
  const stateBytes = exports.stroke_geometry_state_bytes();
  const heapBase = align(heapBaseValue(exports), 16);
  let activeSessionToken = null;

  const begin = (firstSource, options = {}) => {
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
    const inputCapacity = Math.min(MAXIMUM_SAMPLE_COUNT, requestedInputCapacity);
    const statePtr = heapBase;
    const previewStatePtr = align(statePtr + stateBytes, 16);
    const inputPtr = align(previewStatePtr + stateBytes, 16);
    const dabPtr = align(inputPtr + inputCapacity * INPUT_STRIDE * 8, 16);
    const tailPtr = align(dabPtr + request.dabCapacity * DAB_STRIDE * 8, 16);
    const summaryPtr = align(tailPtr + TAIL_CAPACITY * TAIL_STRIDE * 8, 16);
    const end = summaryPtr + SUMMARY_LENGTH * 8;
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
    activeSessionToken = token;
    let finished = false;
    let expandedDabCapacity = request.dabCapacity;

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
    const finishFromSnapshot = (targetStatePtr, snapshotStatePtr) => {
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
        return {
          dabs: new Float64Array(
            new Float64Array(
              exports.memory.buffer,
              output.pointer,
              summary[2] * DAB_STRIDE,
            ),
          ),
          tail: copyCurrentTail(summary),
          stats: statsFromSummary(summary),
        };
      }
    };
    const previewTail = () => {
      if (request.stabilization === 0) return new Float64Array(0);
      return finishFromSnapshot(previewStatePtr, statePtr).dabs;
    };
    const updateFixedSpacing = (spacing) => {
      if (request.spacingMode !== "fixed" || !Number.isFinite(spacing)) {
        throw new TypeError("Only a finite fixed spacing can change during a stroke.");
      }
      const normalizedSpacing = Math.max(0.1, spacing);
      assertStatus(exports.stroke_geometry_set_fixed_spacing(statePtr, normalizedSpacing));
      request.spacingValue = normalizedSpacing;
    };

    return {
      backend: "wasm",
      initialDab: initialDab(first),
      updateFixedSpacing(spacing, updateOptions = {}) {
        assertActive();
        updateFixedSpacing(spacing);
        return updateOptions.includePreviewTail === false
          ? new Float64Array(0)
          : previewTail();
      },
      processBatch(samplesSource, processOptions = {}) {
        assertActive();
        const samples = normalizeSamples(samplesSource);
        if (processOptions.spacing !== undefined) {
          updateFixedSpacing(processOptions.spacing);
        }
        const chunks = [];
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
            appendChunk(
              chunks,
              new Float64Array(
                exports.memory.buffer,
                output.pointer,
                summary[2] * DAB_STRIDE,
              ),
              summary[2],
            );
            if (includeTail && next + count >= samples.length) {
              tail = copyCurrentTail(summary);
            }
            stats = statsFromSummary(summary);
            next += count;
            break;
          }
        }
        const includePreviewTail = processOptions.includePreviewTail !== false;
        const previewDabs = includePreviewTail ? previewTail() : new Float64Array(0);
        return {
          backend: "wasm",
          dabs: concatenateChunks(chunks),
          tail,
          previewDabs,
          stats,
        };
      },
      finish() {
        assertActive();
        try {
          assertStatus(exports.stroke_geometry_copy_state(previewStatePtr, statePtr));
          const completed = finishFromSnapshot(statePtr, previewStatePtr);
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

  const processor = {
    backend: "wasm",
    memoryBytes() {
      return exports.memory.buffer.byteLength;
    },
    begin,
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

/** Loads lazily and selects the exact JavaScript path on initialization failure. */
export async function createStrokeGeometryProcessor(options = {}) {
  try {
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
    return await instantiateStrokeGeometryKernel(moduleOrBytes);
  } catch (initializationError) {
    return {
      backend: "js",
      initializationError,
      begin: beginStrokeGeometryJs,
      processStroke: processStrokeGeometryJs,
    };
  }
}
