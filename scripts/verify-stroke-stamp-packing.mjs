import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createRequiredStrokeGeometryProcessor,
  createStrokeGeometryProcessor,
  instantiateStrokeGeometryKernel,
} from "../wasm/stroke-geometry-kernel/runtime.mjs";
import { shapeLayerForStamp } from "../src/brush-shape-sequence-core.ts";
import { nextPaintStampSeed } from "../src/paint-stamp-generation-core.ts";
import {
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessRadius,
  startThicknessFactor,
} from "../src/thickness-dynamics.ts";
import {
  strokeSymmetryCopiesIntersectDocument,
  strokeSymmetryReflectionCoefficients,
} from "../src/stroke-symmetry-core.ts";
import { verifyStrokeGeometryArtifactFreshness } from "./stroke-geometry-artifact.mjs";

const DAB_STRIDE = 6;
const STAMP_STRIDE_BYTES = 32;
const { wasmBytes } = await verifyStrokeGeometryArtifactFreshness();

function shapeExtentFactor(settings) {
  const maximumShapeAngle = Math.PI * settings.shapeScatter;
  return settings.shape === "shape"
    ? settings.shapeRotation === "follow-stroke" || maximumShapeAngle >= Math.PI * 0.25
      ? Math.SQRT2
      : Math.cos(maximumShapeAngle) + Math.sin(maximumShapeAngle)
    : 1;
}

function unionRect(left, right) {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const maximumX = Math.max(left.x + left.width, right.x + right.width);
  const maximumY = Math.max(left.y + left.height, right.y + right.height);
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return { x, y, width: maximumX - x, height: maximumY - y };
}

function packReferenceStamps(stamps, settings) {
  const upload = new ArrayBuffer(Math.max(1, stamps.length) * STAMP_STRIDE_BYTES);
  const floats = new Float32Array(upload);
  const unsigned = new Uint32Array(upload);
  let minimumX = settings.documentWidth;
  let minimumY = settings.documentHeight;
  let maximumX = 0;
  let maximumY = 0;
  let minimumRadius = Number.POSITIVE_INFINITY;
  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = stamps[index];
    const base = index * 8;
    floats[base] = stamp.x;
    floats[base + 1] = stamp.y;
    floats[base + 2] = stamp.radius;
    floats[base + 3] = stamp.pressure;
    unsigned[base + 4] = stamp.seed;
    unsigned[base + 5] = Math.max(0, Math.min(3, Math.trunc(stamp.shapeLayer))) >>> 0;
    floats[base + 6] = stamp.directionX;
    floats[base + 7] = stamp.directionY;
    const x = floats[base];
    const y = floats[base + 1];
    const radius = floats[base + 2];
    minimumRadius = Math.min(minimumRadius, radius);
    const directionX = floats[base + 6];
    const directionY = floats[base + 7];
    const directionLength = Math.hypot(directionX, directionY);
    const linearReach = radius * 2 * settings.positionJitterLinear;
    const lateralReach = radius * 2 * settings.positionJitterLateral;
    const brushReach = radius * shapeExtentFactor(settings);
    const [reachX, reachY] = directionLength > 0.0002
      ? [
        brushReach
          + Math.abs(directionX / directionLength) * linearReach
          + Math.abs(directionY / directionLength) * lateralReach
          + 2,
        brushReach
          + Math.abs(directionY / directionLength) * linearReach
          + Math.abs(directionX / directionLength) * lateralReach
          + 2,
      ]
      : [
        brushReach + linearReach + lateralReach + 2,
        brushReach + linearReach + lateralReach + 2,
      ];
    minimumX = Math.min(minimumX, x - reachX);
    minimumY = Math.min(minimumY, y - reachY);
    maximumX = Math.max(maximumX, x + reachX);
    maximumY = Math.max(maximumY, y + reachY);
    if (stamp.symmetryMode !== "off") {
      const [cosine, sine] = strokeSymmetryReflectionCoefficients(
        stamp.symmetryMode,
        stamp.symmetryAngleRadians,
      );
      const offsetX = x - settings.documentWidth * 0.5;
      const offsetY = y - settings.documentHeight * 0.5;
      const reflectedX = settings.documentWidth * 0.5 + cosine * offsetX + sine * offsetY;
      const reflectedY = settings.documentHeight * 0.5 + sine * offsetX - cosine * offsetY;
      const reflectedReachX = Math.abs(cosine) * reachX + Math.abs(sine) * reachY;
      const reflectedReachY = Math.abs(sine) * reachX + Math.abs(cosine) * reachY;
      minimumX = Math.min(minimumX, reflectedX - reflectedReachX);
      minimumY = Math.min(minimumY, reflectedY - reflectedReachY);
      maximumX = Math.max(maximumX, reflectedX + reflectedReachX);
      maximumY = Math.max(maximumY, reflectedY + reflectedReachY);
    }
  }
  if (stamps.length === 0) {
    return { upload, dirtyRect: null, minimumRadius };
  }
  const x = Math.max(0, Math.min(settings.documentWidth - 1, Math.floor(minimumX)));
  const y = Math.max(0, Math.min(settings.documentHeight - 1, Math.floor(minimumY)));
  const right = Math.max(1, Math.min(settings.documentWidth, Math.ceil(maximumX)));
  const bottom = Math.max(1, Math.min(settings.documentHeight, Math.ceil(maximumY)));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  return {
    upload,
    dirtyRect: width > 0 && height > 0 ? { x, y, width, height } : null,
    minimumRadius,
  };
}

function referencePack(
  dabs,
  settings,
  state,
  symmetryMode,
  symmetryAngleRadians,
  thickness = {},
) {
  assert.equal(dabs.length % DAB_STRIDE, 0);
  const accepted = [];
  const firstSequence = state.seedSequence;
  for (let offset = 0; offset < dabs.length; offset += DAB_STRIDE) {
    const pressure = Math.max(0.01, Math.min(1, dabs[offset + 2]));
    const baseRadius = settings.radiusMode === "direct-pressure"
      ? Math.max(0.5, Math.max(1, settings.size * pressure) * 0.5)
      : Math.max(0.5, settings.size * 0.5);
    const liveThicknessFactor = startThicknessFactor(
      thickness.startThickness ?? 1,
      Math.max(0, dabs[offset + 3] - (thickness.startedAtMs ?? dabs[offset + 3])),
    );
    const radius = thickness.applyEndTaper
      ? endThicknessRadius(
        baseRadius,
        liveThicknessFactor,
        thickness.endThickness ?? 1,
        Math.max(0, (thickness.referenceTimeMs ?? dabs[offset + 3]) - dabs[offset + 3]),
      )
      : baseRadius * liveThicknessFactor;
    const seed = nextPaintStampSeed(state.seedSequence);
    state.seedSequence += 1;
    const ordinal = state.stampOrdinal;
    state.stampOrdinal += 1;
    const conservativeReach = radius * (
      1 + 2 * (settings.positionJitterLinear + settings.positionJitterLateral)
    );
    if (radius <= 0 || !strokeSymmetryCopiesIntersectDocument(
      dabs[offset],
      dabs[offset + 1],
      conservativeReach,
      conservativeReach,
      symmetryMode,
      settings.documentWidth,
      settings.documentHeight,
      symmetryAngleRadians,
    )) {
      continue;
    }
    accepted.push({
      x: dabs[offset],
      y: dabs[offset + 1],
      radius,
      pressure,
      seed,
      shapeLayer: shapeLayerForStamp(
        settings.shapeSequenceMode,
        ordinal,
        seed,
        settings.shapeLayerCount,
      ),
      directionX: dabs[offset + 4],
      directionY: dabs[offset + 5],
      historyActionId: 1,
      symmetryMode,
      symmetryAngleRadians,
    });
  }
  const packed = packReferenceStamps(accepted, settings);
  return {
    packedStamps: new Uint8Array(
      packed.upload,
      0,
      accepted.length * STAMP_STRIDE_BYTES,
    ).slice(),
    stampCount: accepted.length,
    firstSeed: accepted[0]?.seed ?? null,
    dirtyRect: packed.dirtyRect,
    minimumRadius: packed.minimumRadius,
    nextSeedSequence: state.seedSequence,
    nextStampOrdinal: state.stampOrdinal,
    culledDabCount: state.seedSequence - firstSequence - accepted.length,
  };
}

function assertPacked(actual, expected, label) {
  assert.equal(actual.stampCount, expected.stampCount, `${label}: stamp count`);
  assert.equal(actual.firstSeed, expected.firstSeed, `${label}: first seed`);
  assert.deepEqual(actual.dirtyRect, expected.dirtyRect, `${label}: dirty rect`);
  assert.equal(actual.minimumRadius, expected.minimumRadius, `${label}: minimum radius`);
  assert.equal(actual.nextSeedSequence, expected.nextSeedSequence, `${label}: seed cursor`);
  assert.equal(actual.nextStampOrdinal, expected.nextStampOrdinal, `${label}: ordinal cursor`);
  assert.equal(actual.culledDabCount, expected.culledDabCount, `${label}: culled dabs`);
  const concatenated = new Uint8Array(actual.stampCount * STAMP_STRIDE_BYTES);
  let byteOffset = 0;
  let chunkDirtyRect = null;
  let chunkMinimumRadius = Number.POSITIVE_INFINITY;
  let chunkFirstSeed = null;
  let chunkStampCount = 0;
  for (const chunk of actual.packedChunks) {
    assert.ok(chunk.stampCount > 0, `${label}: empty GPU chunk`);
    assert.ok(chunk.stampCount <= 65_536, `${label}: oversized GPU chunk`);
    assert.equal(chunk.packedStamps.byteLength, chunk.stampCount * STAMP_STRIDE_BYTES);
    assert.notEqual(chunk.firstSeed, null, `${label}: missing chunk seed`);
    assert.notEqual(chunk.dirtyRect, null, `${label}: missing chunk dirty rect`);
    assert.ok(Number.isFinite(chunk.minimumRadius), `${label}: invalid chunk radius`);
    concatenated.set(chunk.packedStamps, byteOffset);
    byteOffset += chunk.packedStamps.byteLength;
    chunkStampCount += chunk.stampCount;
    chunkFirstSeed ??= chunk.firstSeed;
    chunkDirtyRect = unionRect(chunkDirtyRect, chunk.dirtyRect);
    chunkMinimumRadius = Math.min(chunkMinimumRadius, chunk.minimumRadius);
  }
  assert.equal(chunkStampCount, actual.stampCount, `${label}: chunk stamp total`);
  assert.deepEqual(concatenated, expected.packedStamps, `${label}: GPU bytes`);
  if (actual.packedStamps.byteLength > 0) {
    assert.equal(actual.packedStamps.byteLength, actual.stampCount * STAMP_STRIDE_BYTES);
    assert.deepEqual(concatenated, actual.packedStamps, `${label}: flattened chunk bytes`);
  }
  assert.equal(chunkFirstSeed, actual.firstSeed, `${label}: aggregate first seed`);
  assert.deepEqual(chunkDirtyRect, actual.dirtyRect, `${label}: aggregate chunk dirty rect`);
  assert.equal(chunkMinimumRadius, actual.minimumRadius, `${label}: aggregate chunk radius`);
}

function packedResultBytes(result) {
  if (result.packedStamps.byteLength > 0) return result.packedStamps;
  const bytes = new Uint8Array(result.stampCount * STAMP_STRIDE_BYTES);
  let byteOffset = 0;
  for (const chunk of result.packedChunks) {
    bytes.set(chunk.packedStamps, byteOffset);
    byteOffset += chunk.packedStamps.byteLength;
  }
  assert.equal(byteOffset, bytes.byteLength);
  return bytes;
}

function aggregatePackedResults(results) {
  const stampCount = results.reduce((total, result) => total + result.stampCount, 0);
  const bytes = new Uint8Array(stampCount * STAMP_STRIDE_BYTES);
  let byteOffset = 0;
  let dirtyRect = null;
  let minimumRadius = Number.POSITIVE_INFINITY;
  let firstSeed = null;
  let culledDabCount = 0;
  for (const result of results) {
    const resultBytes = packedResultBytes(result);
    bytes.set(resultBytes, byteOffset);
    byteOffset += resultBytes.byteLength;
    dirtyRect = unionRect(dirtyRect, result.dirtyRect);
    minimumRadius = Math.min(minimumRadius, result.minimumRadius);
    firstSeed ??= result.firstSeed;
    culledDabCount += result.culledDabCount;
  }
  return { bytes, stampCount, dirtyRect, minimumRadius, firstSeed, culledDabCount };
}

async function verifyThicknessTailParity(
  startThickness,
  endThickness,
  stabilization,
  radiusMode = "fixed",
) {
  const referenceKernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const packedKernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const samples = Array.from({ length: 31 }, (_, index) => ({
    x: 18 + index * 4.5,
    y: 72 + Math.sin(index * 0.37) * 28,
    pressure: 0.18 + (index % 7) * 0.12,
    timeMs: 1_000 + index * 9,
  }));
  const geometryOptions = {
    stabilization,
    spacingMode: radiusMode === "direct-pressure" ? "direct-pressure" : "fixed",
    spacing: 2.25,
    size: 24,
    maximumBatchSize: 5,
    dabCapacity: 65_536,
    maximumStampsPerSegment: 65_536,
  };
  const settings = {
    size: 24,
    documentWidth: 180,
    documentHeight: 144,
    positionJitterLinear: 0.13,
    positionJitterLateral: 0.07,
    shape: "shape",
    shapeRotation: "follow-stroke",
    shapeScatter: 0.2,
    shapeSequenceMode: "random",
    shapeLayerCount: 4,
    radiusMode,
  };
  const packOptions = {
    ...settings,
    shapeExtentFactor: shapeExtentFactor(settings),
    seedSequence: 73,
    stampOrdinal: 19,
    startThickness,
    endThickness,
    startedAtMs: samples[0].timeMs,
    flattenPackedStamps: false,
  };
  const referenceSession = referenceKernel.begin(samples[0], geometryOptions);
  const packedSession = packedKernel.beginPacked(samples[0], geometryOptions, packOptions);
  const generatedDabs = [...referenceSession.initialDab];
  const packedResults = [packedSession.initialPackedStamps];
  assert.equal(packedSession.initialPackedStamps.consumedDabCount, 1);
  assert.equal(packedSession.initialPackedStamps.stampCount, 0);
  assert.equal(packedSession.initialPackedStamps.generatedHeldDabCount, 1);
  assert.equal(packedSession.initialPackedStamps.remainingHeldDabCount, 1);
  assert.equal(packedSession.initialPackedStamps.maximumHeldDabCount, 1);
  const initialPreviewState = {
    seedSequence: packOptions.seedSequence,
    stampOrdinal: packOptions.stampOrdinal,
  };
  const expectedInitialPreview = referencePack(
    referenceSession.initialDab,
    settings,
    initialPreviewState,
    "off",
    0,
    {
      startThickness,
      endThickness,
      startedAtMs: packOptions.startedAtMs,
      applyEndTaper: true,
      referenceTimeMs: samples[0].timeMs,
    },
  );
  assertPacked(
    packedSession.initialPreviewPackedStamps,
    expectedInitialPreview,
    `thickness ${startThickness}/${endThickness}/${stabilization}: initial preview`,
  );
  assert.equal(packedSession.initialPreviewPackedStamps.packedStamps.byteLength, 0);
  assert.equal(packedSession.initialPreviewPackedStamps.remainingHeldDabCount, 1);
  assert.equal(packedSession.initialPreviewPackedStamps.maximumHeldDabCount, 1);
  if (radiusMode === "fixed") {
    const suppressedPreview = packedSession.updateFixedSpacing(geometryOptions.spacing, {
      includePreviewTail: false,
    });
    assert.equal(suppressedPreview.stampCount, 0);
    assert.equal(suppressedPreview.remainingHeldDabCount, 1);
    assert.equal(suppressedPreview.maximumHeldDabCount, 1);
  }

  let completed = false;
  try {
    for (let start = 1; start < samples.length; start += 5) {
      const batch = samples.slice(start, start + 5);
      const reference = referenceSession.processBatch(batch, {
        includePreviewTail: true,
        includeTail: false,
      });
      const packed = packedSession.processBatch(batch, {
        includePreviewTail: true,
        includeTail: false,
      });
      generatedDabs.push(...reference.dabs);
      packedResults.push(packed);
      assert.equal(
        packed.consumedDabCount,
        reference.dabs.length / DAB_STRIDE,
        "thickness process must reserve each generated dab exactly once",
      );
    }
    const refreshTimeMs = samples.at(-1).timeMs + 47;
    const refresh = packedSession.refreshThickness(refreshTimeMs);
    const repeatedRefresh = packedSession.refreshThickness(refreshTimeMs);
    packedResults.push(refresh.releasedPackedStamps, repeatedRefresh.releasedPackedStamps);
    assert.equal(repeatedRefresh.releasedPackedStamps.stampCount, 0);
    assert.deepEqual(
      packedResultBytes(repeatedRefresh.previewPackedStamps),
      packedResultBytes(refresh.previewPackedStamps),
      "thickness preview must be idempotent at a fixed reference time",
    );
    const referenceFinal = referenceSession.finish();
    generatedDabs.push(...referenceFinal.dabs);
    const liftTimeMs = samples.at(-1).timeMs + 63;
    const packedFinal = packedSession.finish({ referenceTimeMs: liftTimeMs });
    completed = true;
    packedResults.push(packedFinal);
    assert.equal(
      packedFinal.consumedDabCount,
      referenceFinal.dabs.length / DAB_STRIDE,
      "thickness finish must reserve each final dab exactly once",
    );
    assert.equal(
      packedFinal.generatedHeldDabCount,
      referenceFinal.dabs.length / DAB_STRIDE,
      "thickness finish must count newly held stabilization dabs",
    );
    assert.ok(
      packedFinal.maximumHeldDabCount >= packedFinal.releasedHeldAtLiftDabCount,
      "thickness maximum hold count must cover the lift release",
    );

    const expectedState = {
      seedSequence: packOptions.seedSequence,
      stampOrdinal: packOptions.stampOrdinal,
    };
    const expected = referencePack(
      Float64Array.from(generatedDabs),
      settings,
      expectedState,
      "off",
      0,
      {
        startThickness,
        endThickness,
        startedAtMs: packOptions.startedAtMs,
        applyEndTaper: true,
        referenceTimeMs: liftTimeMs,
      },
    );
    const actual = aggregatePackedResults(packedResults);
    assert.deepEqual(actual.bytes, expected.packedStamps, "thickness final GPU byte parity");
    assert.equal(actual.stampCount, expected.stampCount);
    assert.equal(actual.firstSeed, expected.firstSeed);
    assert.deepEqual(actual.dirtyRect, expected.dirtyRect);
    assert.equal(actual.minimumRadius, expected.minimumRadius);
    assert.equal(actual.culledDabCount, expected.culledDabCount);
    assert.equal(packedFinal.nextSeedSequence, expected.nextSeedSequence);
    assert.equal(packedFinal.nextStampOrdinal, expected.nextStampOrdinal);
    return {
      startThickness,
      endThickness,
      stabilization,
      radiusMode,
      stamps: actual.stampCount,
    };
  } finally {
    if (!completed) {
      referenceSession.cancel();
      packedSession.cancel();
    }
  }
}

async function verifyLargePackedChunkContract() {
  const kernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const session = kernel.beginPacked(
    { x: 10, y: 100, pressure: 1, timeMs: 0 },
    {
      stabilization: 0,
      spacingMode: "fixed",
      spacing: 1,
      maximumBatchSize: 1,
      dabCapacity: 80_000,
      maximumStampsPerSegment: 80_000,
    },
    {
      size: 2,
      documentWidth: 100_000,
      documentHeight: 200,
      seedSequence: 1,
      stampOrdinal: 0,
      radiusMode: "fixed",
      shapeSequenceMode: "ordered",
      shapeLayerCount: 3,
      flattenPackedStamps: false,
    },
  );
  try {
    const packed = session.processBatch([
      { x: 70_010, y: 100, pressure: 1, timeMs: 16 },
    ]);
    assert.ok(packed.stampCount > 65_536, "large chunk fixture must cross one GPU upload");
    assert.ok(packed.packedChunks.length > 1, "large result must expose multiple GPU chunks");
    assert.deepEqual(packed.packedChunks.map((chunk) => chunk.stampCount), [65_536, 4_464]);
    assert.equal(packed.packedStamps.byteLength, 0, "chunked upload must skip the aggregate copy");
    const packedBytes = packedResultBytes(packed);
    const floats = new Float32Array(
      packedBytes.buffer,
      packedBytes.byteOffset,
      packedBytes.byteLength / 4,
    );
    const unsigned = new Uint32Array(
      packedBytes.buffer,
      packedBytes.byteOffset,
      packedBytes.byteLength / 4,
    );
    for (const index of [0, 65_535, 65_536, packed.stampCount - 1]) {
      const base = index * 8;
      assert.equal(floats[base], 11 + index, `large packed x at ${index}`);
      assert.equal(floats[base + 1], 100, `large packed y at ${index}`);
      assert.equal(floats[base + 2], 1, `large packed radius at ${index}`);
      assert.equal(floats[base + 3], 1, `large packed pressure at ${index}`);
      assert.equal(unsigned[base + 4], nextPaintStampSeed(2 + index), `large seed at ${index}`);
      assert.equal(unsigned[base + 5], (1 + index) % 3, `large shape layer at ${index}`);
      assert.equal(floats[base + 6], 1, `large direction x at ${index}`);
      assert.equal(floats[base + 7], 0, `large direction y at ${index}`);
    }
    const expected = {
      ...packed,
      packedStamps: packedBytes,
    };
    assertPacked(packed, expected, "large packed chunk contract");
    return { stampCount: packed.stampCount, chunks: packed.packedChunks.length };
  } finally {
    session.cancel();
  }
}

async function verifyLargeThicknessTailContract() {
  const kernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const session = kernel.beginPacked(
    { x: 0, y: 100, pressure: 1, timeMs: 0 },
    {
      stabilization: 0,
      spacingMode: "fixed",
      spacing: 0.1,
      maximumBatchSize: 2,
      dabCapacity: 100_000,
      maximumStampsPerSegment: 65_536,
    },
    {
      size: 2,
      documentWidth: 4_000,
      documentHeight: 4_000,
      seedSequence: 1,
      stampOrdinal: 0,
      radiusMode: "fixed",
      shapeSequenceMode: "ordered",
      shapeLayerCount: 1,
      endThickness: 0.5,
      startedAtMs: 0,
      flattenPackedStamps: false,
    },
  );
  try {
    const update = session.processBatch([
      { x: 3_999, y: 100, pressure: 1, timeMs: 20 },
      { x: 0, y: 100, pressure: 1, timeMs: 40 },
    ]);
    const preview = update.previewPackedStamps;
    assert.equal(update.stampCount, 0, "young taper dabs must remain revisionable");
    assert.equal(preview.stampCount, 79_981, "large taper fixture stamp count");
    assert.ok(preview.stampCount > 65_536, "taper preview must cross one GPU upload");
    assert.ok(preview.packedChunks.length > 1, "taper preview must expose upload chunks");
    assert.equal(preview.packedStamps.byteLength, 0, "taper preview must skip aggregate copy");
    assert.equal(preview.remainingHeldDabCount, preview.stampCount);
    assert.equal(preview.maximumHeldDabCount, preview.stampCount);
    const previewBytes = packedResultBytes(preview);
    const completed = session.finish({ referenceTimeMs: 40 });
    assert.equal(completed.stampCount, preview.stampCount);
    assert.ok(completed.packedChunks.length > 1, "taper lift must preserve upload chunks");
    assert.equal(completed.packedStamps.byteLength, 0, "taper lift must skip aggregate copy");
    assert.equal(completed.releasedHeldAtLiftDabCount, preview.stampCount);
    assert.equal(completed.maximumHeldDabCount, preview.stampCount);
    assert.deepEqual(packedResultBytes(completed), previewBytes);
    return { stampCount: preview.stampCount, chunks: preview.packedChunks.length };
  } catch (error) {
    session.cancel();
    throw error;
  }
}

async function verifyRejectedCounterDoesNotPoisonInstance() {
  const kernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const geometry = {
    stabilization: 0,
    spacingMode: "fixed",
    spacing: 1,
    maximumBatchSize: 1,
    dabCapacity: 8,
  };
  const packed = {
    size: 2,
    documentWidth: 100,
    documentHeight: 100,
    seedSequence: 1,
    stampOrdinal: Number.MAX_SAFE_INTEGER,
    radiusMode: "fixed",
    shapeSequenceMode: "ordered",
    shapeLayerCount: 3,
  };
  assert.throws(
    () => kernel.beginPacked({ x: 10, y: 10, pressure: 1, timeMs: 0 }, geometry, packed),
    /safe integer range|invalid kernel argument/,
  );
  const recovered = kernel.beginPacked(
    { x: 10, y: 10, pressure: 1, timeMs: 0 },
    geometry,
    { ...packed, stampOrdinal: 0 },
  );
  try {
    assert.equal(recovered.initialPackedStamps.stampCount, 1);
  } finally {
    recovered.cancel();
  }

  const multiChunk = kernel.beginPacked(
    { x: 10, y: 100, pressure: 1, timeMs: 0 },
    {
      ...geometry,
      dabCapacity: 80_000,
      maximumStampsPerSegment: 80_000,
    },
    {
      ...packed,
      documentWidth: 100_000,
      documentHeight: 200,
      stampOrdinal: Number.MAX_SAFE_INTEGER - 70_000,
    },
  );
  assert.throws(
    () => multiChunk.processBatch([
      { x: 70_010, y: 100, pressure: 1, timeMs: 16 },
    ]),
    /safe integer range/,
  );
  assert.throws(
    () => multiChunk.processBatch([{ x: 70_011, y: 100, pressure: 1, timeMs: 17 }]),
    /no longer active/,
  );
  const afterStreamingFailure = kernel.beginPacked(
    { x: 10, y: 10, pressure: 1, timeMs: 0 },
    geometry,
    { ...packed, stampOrdinal: 0 },
  );
  afterStreamingFailure.cancel();
}

async function goldenRecord(timeMs) {
  const kernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const session = kernel.beginPacked(
    { x: 50, y: 50, pressure: 0.5, timeMs },
    {
      stabilization: 0,
      spacingMode: "fixed",
      spacing: 1,
      maximumBatchSize: 1,
      dabCapacity: 65_536,
    },
    {
      size: 20,
      documentWidth: 100,
      documentHeight: 100,
      seedSequence: 1,
      stampOrdinal: 0,
      radiusMode: "fixed",
      shapeSequenceMode: "random",
      shapeLayerCount: 4,
    },
  );
  try {
    return session.initialPackedStamps;
  } finally {
    session.cancel();
  }
}

async function streamingParity(label, settings, samples, symmetryMode, symmetryAngleRadians) {
  const referenceKernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const packedKernel = await instantiateStrokeGeometryKernel(wasmBytes);
  const geometryOptions = {
    stabilization: 1,
    spacingMode: settings.radiusMode === "direct-pressure" ? "direct-pressure" : "fixed",
    spacing: settings.size * 0.0025,
    size: settings.size,
    maximumBatchSize: 16,
    dabCapacity: 65_536,
    maximumStampsPerSegment: 65_536,
  };
  const [reflectionCosineDoubleAngle, reflectionSineDoubleAngle] =
    strokeSymmetryReflectionCoefficients(symmetryMode, symmetryAngleRadians);
  const packOptions = {
    ...settings,
    shapeExtentFactor: shapeExtentFactor(settings),
    reflectionCosineDoubleAngle,
    reflectionSineDoubleAngle,
    symmetryEnabled: symmetryMode !== "off",
    seedSequence: 0xffff_fffc,
    stampOrdinal: 0xffff_fffc,
  };
  const referenceState = {
    seedSequence: packOptions.seedSequence,
    stampOrdinal: packOptions.stampOrdinal,
  };
  const referenceSession = referenceKernel.begin(samples[0], geometryOptions);
  const packedSession = packedKernel.beginPacked(samples[0], geometryOptions, packOptions);
  let authoritativeBytes = 0;
  let previewChecks = 0;
  let completed = false;
  try {
    const expectedInitial = referencePack(
      referenceSession.initialDab,
      settings,
      referenceState,
      symmetryMode,
      symmetryAngleRadians,
    );
    assertPacked(packedSession.initialPackedStamps, expectedInitial, `${label}: initial`);
    authoritativeBytes += expectedInitial.packedStamps.byteLength;

    for (let start = 1; start < samples.length; start += 16) {
      const batch = samples.slice(start, start + 16);
      const reference = referenceSession.processBatch(batch, {
        includePreviewTail: true,
        includeTail: false,
      });
      const packed = packedSession.processBatch(batch, {
        includePreviewTail: true,
        includeTail: false,
      });
      const expected = referencePack(
        reference.dabs,
        settings,
        referenceState,
        symmetryMode,
        symmetryAngleRadians,
      );
      assertPacked(packed, expected, `${label}: authoritative batch ${start}`);
      authoritativeBytes += expected.packedStamps.byteLength;

      const previewState = { ...referenceState };
      const expectedPreview = referencePack(
        reference.previewDabs,
        settings,
        previewState,
        symmetryMode,
        symmetryAngleRadians,
      );
      assertPacked(
        packed.previewPackedStamps,
        expectedPreview,
        `${label}: preview batch ${start}`,
      );
      assert.equal(referenceState.seedSequence, packed.nextSeedSequence);
      assert.equal(referenceState.stampOrdinal, packed.nextStampOrdinal);
      previewChecks += 1;
    }

    const referenceFinal = referenceSession.finish();
    const packedFinal = packedSession.finish();
    completed = true;
    const expectedFinal = referencePack(
      referenceFinal.dabs,
      settings,
      referenceState,
      symmetryMode,
      symmetryAngleRadians,
    );
    assertPacked(packedFinal, expectedFinal, `${label}: finish`);
    authoritativeBytes += expectedFinal.packedStamps.byteLength;
    assert.deepEqual(packedFinal.stats, referenceFinal.stats, `${label}: final geometry stats`);
    return {
      label,
      authoritativeBytes,
      previewChecks,
      finalSeedSequence: referenceState.seedSequence,
      finalStampOrdinal: referenceState.stampOrdinal,
    };
  } finally {
    if (!completed) {
      referenceSession.cancel();
      packedSession.cancel();
    }
  }
}

{
  const golden = await goldenRecord(123);
  assert.equal(
    Buffer.from(golden.packedStamps).toString("hex"),
    "0000484200004842000020410000003f0290263b010000000000803f00000000",
  );
  assert.deepEqual(golden.dirtyRect, { x: 38, y: 38, width: 24, height: 24 });
  assert.equal(golden.firstSeed, 0x3b26_9002);
  assert.equal(golden.minimumRadius, 10);
  assert.deepEqual((await goldenRecord(9876)).packedStamps, golden.packedStamps);

  const samples = Array.from({ length: 193 }, (_, index) => ({
    x: -90 + index * 4.1,
    y: 256 + Math.sin(index * 0.17) * 190,
    pressure: Math.max(-1, Math.min(2, 0.5 + Math.sin(index * 0.071) * 0.72)),
    timeMs: index * (1_000 / 240),
  }));
  const common = {
    size: 72,
    documentWidth: 512,
    documentHeight: 512,
    positionJitterLinear: 0.37,
    positionJitterLateral: 0.21,
    shape: "shape",
    shapeRotation: "follow-stroke",
    shapeScatter: 0.33,
    shapeSequenceMode: "random",
    shapeLayerCount: 4,
  };
  const reports = [
    await streamingParity(
      "fixed-angle-symmetry",
      { ...common, radiusMode: "fixed" },
      samples,
      "angle",
      Math.PI * 0.25,
    ),
    await streamingParity(
      "direct-pressure-no-symmetry",
      {
        ...common,
        radiusMode: "direct-pressure",
        shapeSequenceMode: "ordered",
        shapeLayerCount: 3,
      },
      samples,
      "off",
      0,
    ),
  ];
  assert.ok(
    reports.some((report) => report.finalStampOrdinal > 2 ** 32),
    "streaming parity must cross the 32-bit counter boundary",
  );
  const largeChunk = await verifyLargePackedChunkContract();
  const largeThicknessTail = await verifyLargeThicknessTailContract();
  await verifyRejectedCounterDoesNotPoisonInstance();
  const thicknessReports = [];
  for (const [startThickness, endThickness, stabilization, radiusMode] of [
    [1, 0.6, 0, "fixed"],
    [0, 0.6, 0, "fixed"],
    [2, 0, 1, "fixed"],
    [0.6, 2, 1, "fixed"],
    [0.6, 0, 1, "direct-pressure"],
  ]) {
    thicknessReports.push(await verifyThicknessTailParity(
      startThickness,
      endThickness,
      stabilization,
      radiusMode,
    ));
  }

  await assert.rejects(
    () => createRequiredStrokeGeometryProcessor({
      fetchImplementation: async () => new Response(null, { status: 404 }),
    }),
    /fetch failed \(404\)/,
  );
  const optional = await createStrokeGeometryProcessor({
    fetchImplementation: async () => new Response(null, { status: 404 }),
  });
  assert.equal(optional.backend, "js");
  assert.equal(optional.beginPacked, undefined);

  console.log("Stroke packed Wasm verification passed.", {
    wasmBytes: wasmBytes.byteLength,
    reports,
    largeChunk,
    largeThicknessTail,
    thicknessReports,
  });
}
