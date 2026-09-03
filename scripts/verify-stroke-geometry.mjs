import assert from "node:assert/strict";
import {
  beginStrokeGeometryJs,
  createStrokeGeometryProcessor,
  instantiateStrokeGeometryKernel,
  processStrokeGeometryJs,
} from "../wasm/stroke-geometry-kernel/runtime.mjs";
import {
  verifyStrokeGeometryArtifactFreshness,
} from "./stroke-geometry-artifact.mjs";

const { wasmBytes } = await verifyStrokeGeometryArtifactFreshness();
const kernel = await instantiateStrokeGeometryKernel(wasmBytes);
assert.equal(kernel.backend, "wasm");

const fixture = createBuiltInFixture();
const fixtureSource = "checked deterministic fixture";
const fixedSpacing = Math.max(
  0.1,
  fixture.settings.size * fixture.settings.spacingPercent / 100,
);

const integerStats = [
  "totalDabs",
  "maturePoints",
  "forcedMaturePoints",
  "tailPoints",
  "maximumTailPoints",
  "curveInputSegments",
  "curveFlattenedSegments",
  "curveSmoothedSegments",
  "curveSharpCornerBypasses",
  "latestSequence",
];

const f32Bits = (value) => {
  const buffer = new ArrayBuffer(4);
  new Float32Array(buffer)[0] = value;
  return new Uint32Array(buffer)[0];
};

const f32OrderedBits = (value) => {
  const bits = f32Bits(value);
  return (bits & 0x8000_0000) !== 0
    ? 0x8000_0000n - BigInt(bits & 0x7fff_ffff)
    : 0x8000_0000n + BigInt(bits);
};

const f32UlpDistance = (left, right) => {
  const leftBits = f32OrderedBits(left);
  const rightBits = f32OrderedBits(right);
  return leftBits >= rightBits ? leftBits - rightBits : rightBits - leftBits;
};

function assertDabParity(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: lane count`);
  for (let index = 0; index < actual.length; index += 1) {
    const delta = Math.abs(actual[index] - expected[index]);
    assert.ok(delta <= 2e-7, `${label}: lane ${index} differs by ${delta}`);
    if (index % 6 !== 3) {
      assert.equal(f32Bits(actual[index]), f32Bits(expected[index]), `${label}: f32 lane ${index}`);
    }
  }
}

function compareResult(actual, expected, label) {
  assert.equal(actual.dabs.length, expected.dabs.length, `${label}: dab lane count`);
  assert.equal(actual.tail.length, expected.tail.length, `${label}: tail lane count`);
  let maximumDabDelta = 0;
  for (let index = 0; index < actual.dabs.length; index += 1) {
    const delta = Math.abs(actual.dabs[index] - expected.dabs[index]);
    maximumDabDelta = Math.max(maximumDabDelta, delta);
    assert.ok(delta <= 2e-7, `${label}: dab lane ${index} differs by ${delta}`);
    const lane = index % 6;
    if (lane === 0 || lane === 1 || lane === 2 || lane === 4 || lane === 5) {
      assert.equal(
        f32Bits(actual.dabs[index]),
        f32Bits(expected.dabs[index]),
        `${label}: final f32 dab lane ${index}`,
      );
    }
  }
  let maximumTailDelta = 0;
  for (let index = 0; index < actual.tail.length; index += 1) {
    const delta = Math.abs(actual.tail[index] - expected.tail[index]);
    maximumTailDelta = Math.max(maximumTailDelta, delta);
    assert.ok(delta <= 2e-7, `${label}: tail lane ${index} differs by ${delta}`);
    if (index % 10 !== 3 && index % 10 !== 4) {
      assert.equal(
        f32Bits(actual.tail[index]),
        f32Bits(expected.tail[index]),
        `${label}: final f32 tail lane ${index}`,
      );
    }
  }
  for (const key of integerStats) {
    assert.equal(actual.stats[key], expected.stats[key], `${label}: stats.${key}`);
  }
  assert.ok(
    Math.abs(actual.stats.spacingCarry - expected.stats.spacingCarry) <= 2e-7,
    `${label}: spacing carry`,
  );
  assert.equal(
    actual.stats.stabilizationTimeConstantMs,
    expected.stats.stabilizationTimeConstantMs,
    `${label}: stabilization time constant`,
  );
  return { maximumDabDelta, maximumTailDelta };
}

const summaries = [];
for (const stabilization of [0, 0.5, 1]) {
  const options = { stabilization, spacing: fixedSpacing };
  const expected = processStrokeGeometryJs(fixture.points, options);
  let groupingReference = null;
  for (const batchSize of [1, 7, fixture.points.length]) {
    const actual = kernel.processStroke(fixture.points, { ...options, batchSize });
    const parity = compareResult(
      actual,
      expected,
      `canonical stabilization ${stabilization}, batch ${batchSize}`,
    );
    if (groupingReference) {
      assert.deepEqual(actual.dabs, groupingReference.dabs, "Wasm dab grouping invariance");
      assert.deepEqual(actual.tail, groupingReference.tail, "Wasm tail grouping invariance");
    } else {
      groupingReference = actual;
    }
    summaries.push({
      stabilization,
      batchSize,
      dabs: actual.stats.totalDabs,
      ...parity,
    });
  }
}

const variableSamples = Array.from({ length: 512 }, (_, index) => ({
  x: index * 0.7,
  y: 80 + Math.sin(index * 0.047) * 31,
  pressure: 0.05 + 0.95 * (0.5 + Math.sin(index * 0.031) * 0.5),
  timeMs: index * 1000 / 240,
}));
const variableOptions = {
  stabilization: 1,
  spacingMode: "direct-pressure",
  size: 96,
};
const variableExpected = processStrokeGeometryJs(variableSamples, variableOptions);
const variableActual = kernel.processStroke(variableSamples, {
  ...variableOptions,
  batchSize: 13,
});
summaries.push({
  scenario: "variable-pressure",
  dabs: variableActual.stats.totalDabs,
  ...compareResult(variableActual, variableExpected, "variable pressure"),
});

const repeatedTimeSamples = Array.from({ length: 1300 }, (_, index) => ({
  x: index * 0.2,
  y: index % 7,
  pressure: 0.75,
  timeMs: 0,
}));
const repeatedOptions = { stabilization: 1, spacing: 0.5, batchSize: 31 };
const repeatedExpected = processStrokeGeometryJs(repeatedTimeSamples, repeatedOptions);
const repeatedActual = kernel.processStroke(repeatedTimeSamples, repeatedOptions);
compareResult(repeatedActual, repeatedExpected, "fixed-capacity forced maturation");
assert.ok(repeatedActual.stats.forcedMaturePoints > 0);

// Streaming keeps the authoritative mature prefix separate from a cloned,
// revisionable tail. Preview generation must not mutate later batches.
const streamingOptions = {
  stabilization: 1,
  spacing: fixedSpacing,
  maximumBatchSize: 32,
};
const streaming = kernel.begin(fixture.points[0], streamingOptions);
const firstBoundary = 83;
const streamedA = streaming.processBatch(fixture.points.slice(1, firstBoundary));
const expectedA = processStrokeGeometryJs(
  fixture.points.slice(0, firstBoundary),
  streamingOptions,
);
const authoritativeA = new Float64Array(streaming.initialDab.length + streamedA.dabs.length);
authoritativeA.set(streaming.initialDab);
authoritativeA.set(streamedA.dabs, streaming.initialDab.length);
assert.deepEqual(streamedA.tail, expectedA.tail, "streaming first tail");
assertDabParity(
  streamedA.previewDabs,
  expectedA.dabs.slice(authoritativeA.length),
  "streaming first preview clone",
);
const streamedB = streaming.processBatch(fixture.points.slice(firstBoundary));
const expectedB = processStrokeGeometryJs(fixture.points, streamingOptions);
const authoritativeBLength = authoritativeA.length + streamedB.dabs.length;
assert.deepEqual(streamedB.tail, expectedB.tail, "streaming final live tail");
assertDabParity(
  streamedB.previewDabs,
  expectedB.dabs.slice(authoritativeBLength),
  "streaming final preview clone",
);
const streamedFinish = streaming.finish();
const streamedComplete = concatenateForTest([
  streaming.initialDab,
  streamedA.dabs,
  streamedB.dabs,
  streamedFinish.dabs,
]);
assertDabParity(streamedComplete, expectedB.dabs, "streaming authoritative finish");
assert.deepEqual(streamedFinish.tail, expectedB.tail, "streaming finish tail");
assert.equal(streamedFinish.stats.totalDabs, expectedB.stats.totalDabs);

const noTailStreaming = kernel.begin(fixture.points[0], streamingOptions);
const noTailUpdate = noTailStreaming.processBatch(
  fixture.points.slice(1, 12),
  { includePreviewTail: false, includeTail: false },
);
assert.equal(noTailUpdate.tail.length, 0, "includeTail false skips a non-empty tail copy");
assert.equal(noTailUpdate.previewDabs.length, 0, "preview cloning is independently optional");
assert.ok(noTailUpdate.stats.tailPoints > 0, "tail remains present in authoritative state");
noTailStreaming.cancel();

// Adaptive fixed spacing changes at an input-batch boundary while preserving
// the distance already travelled since the preceding dab.
const adaptive = kernel.begin(
  { x: 0, y: 0, pressure: 1, timeMs: 0 },
  { stabilization: 0, spacing: 10, maximumBatchSize: 4 },
);
const adaptiveA = adaptive.processBatch([
  { x: 25, y: 0, pressure: 1, timeMs: 25 },
], { includePreviewTail: false, includeTail: false });
const adaptiveB = adaptive.processBatch([
  { x: 40, y: 0, pressure: 1, timeMs: 40 },
], { spacing: 6, includePreviewTail: false, includeTail: false });
assert.deepEqual(
  [
    ...adaptiveA.dabs.filter((_, index) => index % 6 === 0),
    ...adaptiveB.dabs.filter((_, index) => index % 6 === 0),
  ],
  [10, 20, 26, 32, 38],
);
assert.equal(adaptiveA.tail.length, 0, "includeTail false skips the first tail copy");
assert.equal(adaptiveB.tail.length, 0, "includeTail false skips the second tail copy");
adaptive.finish();

// A coalesced group may collectively exceed the output arena even though each
// individual segment is valid. The adapter must restore the state, split the
// group and return every dab in order rather than losing the overflowing tail.
const splitBatchSamples = [
  { x: 0, y: 0, pressure: 1, timeMs: 0 },
  { x: 6, y: 0, pressure: 1, timeMs: 6 },
  { x: 12, y: 0, pressure: 1, timeMs: 12 },
];
const splitBatchOptions = {
  stabilization: 0,
  spacing: 0.1,
  maximumBatchSize: 2,
  dabCapacity: 100,
  maximumStampsPerSegment: 100,
};
const javascriptSplitBatch = beginStrokeGeometryJs(
  splitBatchSamples[0],
  splitBatchOptions,
);
const wasmSplitBatch = kernel.begin(splitBatchSamples[0], splitBatchOptions);
const javascriptSplitUpdate = javascriptSplitBatch.processBatch(splitBatchSamples.slice(1), {
  includePreviewTail: false,
  includeTail: false,
});
const wasmSplitUpdate = wasmSplitBatch.processBatch(splitBatchSamples.slice(1), {
  includePreviewTail: false,
  includeTail: false,
});
assert.ok(wasmSplitUpdate.dabs.length / 6 > splitBatchOptions.dabCapacity);
assertDabParity(
  wasmSplitUpdate.dabs,
  javascriptSplitUpdate.dabs,
  "capacity-aware coalesced batch splitting",
);
javascriptSplitBatch.finish();
wasmSplitBatch.finish();

// A spacing escalation can arrive after the last pointer sample. Updating the
// state without consuming another sample must rebuild the live tail and affect
// the subsequent finish identically in both implementations.
const spacingEscalationPrefix = fixture.points.slice(0, 96);
const initialEscalationSpacing = fixedSpacing;
const finalEscalationSpacing = fixedSpacing + 2.75;
const javascriptEscalation = beginStrokeGeometryJs(spacingEscalationPrefix[0], {
  stabilization: 1,
  spacing: initialEscalationSpacing,
  maximumBatchSize: spacingEscalationPrefix.length,
});
const wasmEscalation = kernel.begin(spacingEscalationPrefix[0], {
  stabilization: 1,
  spacing: initialEscalationSpacing,
  maximumBatchSize: spacingEscalationPrefix.length,
});
javascriptEscalation.processBatch(spacingEscalationPrefix.slice(1), {
  includePreviewTail: false,
  includeTail: false,
});
wasmEscalation.processBatch(spacingEscalationPrefix.slice(1), {
  includePreviewTail: false,
  includeTail: false,
});
const javascriptEscalatedPreview = javascriptEscalation.updateFixedSpacing(
  finalEscalationSpacing,
);
const wasmEscalatedPreview = wasmEscalation.updateFixedSpacing(finalEscalationSpacing);
assertDabParity(
  wasmEscalatedPreview,
  javascriptEscalatedPreview,
  "spacing escalation preview without another input",
);
const javascriptEscalatedFinish = javascriptEscalation.finish();
const wasmEscalatedFinish = wasmEscalation.finish();
assertDabParity(
  wasmEscalatedFinish.dabs,
  javascriptEscalatedFinish.dabs,
  "spacing escalation finish without another input",
);
assert.equal(
  wasmEscalatedFinish.stats.totalDabs,
  javascriptEscalatedFinish.stats.totalDabs,
  "spacing escalation must preserve final dab-count parity",
);

const interactiveStreamingMemoryBytes = kernel.memoryBytes();

// A valid stabilized tail can represent more dabs than the ordinary live
// batch arena. Preview and pointer-up must grow a separate bounded arena and
// retry from a state snapshot, never truncate or mutate the live session.
const denseTailFirst = { x: 0, y: 0, pressure: 1, timeMs: 0 };
const denseTailLast = { x: 7000, y: 0, pressure: 1, timeMs: 0 };
const denseTailOptions = {
  stabilization: 1,
  spacing: 0.1,
  maximumBatchSize: 1,
  dabCapacity: 65_536,
  maximumStampsPerSegment: 100_000,
};
const javascriptDensePreview = beginStrokeGeometryJs(denseTailFirst, denseTailOptions);
const wasmDensePreview = kernel.begin(denseTailFirst, denseTailOptions);
const javascriptDensePreviewUpdate = javascriptDensePreview.processBatch([denseTailLast], {
  includeTail: false,
});
const wasmDensePreviewUpdate = wasmDensePreview.processBatch([denseTailLast], {
  includeTail: false,
});
assert.ok(
  wasmDensePreviewUpdate.previewDabs.length / 6 > denseTailOptions.dabCapacity,
  "the regression preview must exceed the ordinary live dab arena",
);
assertDabParity(
  wasmDensePreviewUpdate.previewDabs,
  javascriptDensePreviewUpdate.previewDabs,
  "grown dense stabilization preview",
);
const javascriptDensePreviewFinish = javascriptDensePreview.finish();
const wasmDensePreviewFinish = wasmDensePreview.finish();
assertDabParity(
  wasmDensePreviewFinish.dabs,
  javascriptDensePreviewFinish.dabs,
  "finish after an oversized preview remains non-mutating",
);

const javascriptDenseFinish = beginStrokeGeometryJs(denseTailFirst, denseTailOptions);
const wasmDenseFinish = kernel.begin(denseTailFirst, denseTailOptions);
javascriptDenseFinish.processBatch([denseTailLast], {
  includeTail: false,
  includePreviewTail: false,
});
wasmDenseFinish.processBatch([denseTailLast], {
  includeTail: false,
  includePreviewTail: false,
});
const javascriptDenseFinishResult = javascriptDenseFinish.finish();
const wasmDenseFinishResult = wasmDenseFinish.finish();
assert.ok(
  wasmDenseFinishResult.dabs.length / 6 > denseTailOptions.dabCapacity,
  "the regression finish must exceed the ordinary live dab arena",
);
assertDabParity(
  wasmDenseFinishResult.dabs,
  javascriptDenseFinishResult.dabs,
  "grown dense stabilization finish",
);
assert.deepEqual(
  wasmDenseFinishResult.tail,
  javascriptDenseFinishResult.tail,
  "grown finish preserves the complete stabilization tail",
);

// A single later event can mature many cached points at once. Batch splitting
// cannot make that call smaller, so it must use the same snapshot/grow/retry
// path and preserve every authoritative dab.
const delayedMaturationFirst = { x: 0, y: 0, pressure: 1, timeMs: 0 };
const delayedMaturationPrefix = Array.from({ length: 159 }, (_, index) => ({
  x: (index + 1) * 200,
  y: 0,
  pressure: 1,
  timeMs: index + 1,
}));
const delayedMaturationLast = { x: 32_000, y: 0, pressure: 1, timeMs: 1000 };
const delayedMaturationOptions = {
  stabilization: 1,
  spacing: 0.1,
  maximumBatchSize: 256,
  dabCapacity: 65_536,
  maximumStampsPerSegment: 65_536,
};
const javascriptDelayedMaturation = beginStrokeGeometryJs(
  delayedMaturationFirst,
  delayedMaturationOptions,
);
const wasmDelayedMaturation = kernel.begin(
  delayedMaturationFirst,
  delayedMaturationOptions,
);
const javascriptDelayedPrefix = javascriptDelayedMaturation.processBatch(
  delayedMaturationPrefix,
  { includeTail: false, includePreviewTail: false },
);
const wasmDelayedPrefix = wasmDelayedMaturation.processBatch(
  delayedMaturationPrefix,
  { includeTail: false, includePreviewTail: false },
);
assertDabParity(
  wasmDelayedPrefix.dabs,
  javascriptDelayedPrefix.dabs,
  "delayed maturation prefix",
);
const javascriptDelayedUpdate = javascriptDelayedMaturation.processBatch(
  [delayedMaturationLast],
  { includeTail: false, includePreviewTail: false },
);
const wasmDelayedUpdate = wasmDelayedMaturation.processBatch(
  [delayedMaturationLast],
  { includeTail: false, includePreviewTail: false },
);
assert.ok(
  wasmDelayedUpdate.dabs.length / 6 > delayedMaturationOptions.dabCapacity,
  "one delayed input must exceed the ordinary live dab arena",
);
assertDabParity(
  wasmDelayedUpdate.dabs,
  javascriptDelayedUpdate.dabs,
  "grown single-input maturation",
);
assertDabParity(
  wasmDelayedMaturation.finish().dabs,
  javascriptDelayedMaturation.finish().dabs,
  "finish after grown single-input maturation",
);

// The public whole-stroke contract accepts large bounded arrays. Direct
// pressure spacing must scan them without spreading an array onto the JS stack.
const largeDirectSamples = Array.from({ length: 150_000 }, (_, index) => ({
  x: 8,
  y: 12,
  pressure: 0.5 + (index & 1) * 0.01,
  timeMs: index,
}));
const largeDirectJavascript = processStrokeGeometryJs(largeDirectSamples, {
  spacingMode: "direct-pressure",
  size: 96,
  batchSize: 4096,
});
const largeDirectWasm = kernel.processStroke(largeDirectSamples, {
  spacingMode: "direct-pressure",
  size: 96,
  batchSize: 4096,
});
assert.equal(largeDirectJavascript.stats.totalDabs, 1);
assert.equal(largeDirectWasm.stats.totalDabs, 1);

for (const degrees of [60, 61]) {
  const radians = degrees * Math.PI / 180;
  const samples = [
    { x: 0, y: 0, pressure: 1, timeMs: 0 },
    { x: 100, y: 0, pressure: 1, timeMs: 10 },
    { x: 100 + 100 * Math.cos(radians), y: 100 * Math.sin(radians), pressure: 1, timeMs: 20 },
  ];
  compareResult(
    kernel.processStroke(samples, { spacing: 10, batchSize: 1 }),
    processStrokeGeometryJs(samples, { spacing: 10 }),
    `${degrees} degree corner`,
  );
}

const broken = await createStrokeGeometryProcessor({ moduleOrBytes: new Uint8Array([0]) });
assert.equal(broken.backend, "js");
assert.ok(broken.initializationError);
assert.equal(
  broken.processStroke(fixture.points.slice(0, 8), { spacing: fixedSpacing }).backend,
  "js",
);
const fallbackStreaming = broken.begin(fixture.points[0], streamingOptions);
const fallbackPart = fallbackStreaming.processBatch(
  fixture.points.slice(1, 12),
  { includePreviewTail: false, includeTail: false },
);
assert.equal(fallbackPart.backend, "js");
assert.equal(fallbackPart.previewDabs.length, 0);
assert.equal(fallbackPart.tail.length, 0);
fallbackStreaming.cancel();

// Seeded randomized and threshold-oriented cases audit the numerical envelope.
// The canonical fixture above deliberately remains stricter: its final f32
// lanes must be bit-identical. The broader corpus records adjacent-f32 drift
// from the platform math implementations instead of disguising it as exact.
const random = mulberry32(0x51_7a_b1_e5);
const fuzzCases = [];
for (let caseIndex = 0; caseIndex < 64; caseIndex += 1) {
  const count = 12 + Math.floor(random() * 180);
  const frequencyHz = caseIndex % 3 === 0 ? 1000 : 240;
  const samples = [];
  let x = (random() - 0.5) * 20_000;
  let y = (random() - 0.5) * 20_000;
  let direction = random() * Math.PI * 2;
  let timeMs = random() * 10_000;
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      direction += (random() - 0.5) * 1.7;
      const selector = random();
      const distance = selector < 0.04
        ? 0
        : selector < 0.08
          ? 0.00011 + random() * 0.0002
          : 0.05 + random() * 11;
      x += Math.cos(direction) * distance;
      y += Math.sin(direction) * distance;
      const dt = random() < 0.06 ? 0 : (0.25 + random() * 1.5) * 1000 / frequencyHz;
      timeMs += dt;
    }
    samples.push({
      x,
      y,
      pressure: 0.01 + random() * 0.98,
      timeMs,
    });
  }
  const directPressure = caseIndex % 2 === 1;
  fuzzCases.push({
    label: `seeded-${caseIndex}-${directPressure ? "direct" : "fixed"}`,
    samples,
    options: {
      stabilization: [0, 0.125, 0.5, 0.875, 1][caseIndex % 5],
      ...(directPressure
        ? { spacingMode: "direct-pressure", size: 4 + random() * 196 }
        : { spacing: 0.15 + random() * 8 }),
      batchSize: 1 + Math.floor(random() * 31),
    },
  });
}

fuzzCases.push(
  createRegressionFuzzCase({
    targetCase: 5,
    seed: 0x8765_4321,
    multiplier: 1_103_515_245,
    increment: 12_345,
    spacingMode: "direct-pressure",
  }),
  createRegressionFuzzCase({
    targetCase: 4636,
    seed: 0xabcd_efff,
    multiplier: 1_664_525,
    increment: 1_013_904_223,
    spacingMode: "fixed",
  }),
);

for (const degrees of [0, 0.001, 14.999, 15, 15.001, 59.999, 60, 60.001, 179.999]) {
  const radians = degrees * Math.PI / 180;
  fuzzCases.push({
    label: `edge-corner-${degrees}`,
    samples: [
      { x: 0, y: 0, pressure: 0.01, timeMs: 10 },
      { x: 100, y: 0, pressure: 0.5, timeMs: 10 },
      {
        x: 100 + 100 * Math.cos(radians),
        y: 100 * Math.sin(radians),
        pressure: 0.99,
        timeMs: 9,
      },
    ],
    options: { stabilization: degrees % 2 === 0 ? 1 : 0, spacing: 0.37, batchSize: 1 },
  });
}

const fuzzReport = {
  cases: fuzzCases.length,
  countDivergences: [],
  integerStatDivergences: [],
  maximumDabAbsoluteDelta: 0,
  maximumDabF32Ulp: 0n,
  dabF32MismatchLanes: 0,
  firstDabF32Mismatch: null,
  f32MismatchCases: [],
  maximumTailAbsoluteDelta: 0,
  maximumTailF32Ulp: 0n,
  tailF32MismatchLanes: 0,
  maximumSpacingCarryDelta: 0,
  worstDabCase: null,
  worstTailCase: null,
};

for (const fuzzCase of fuzzCases) {
  const expected = processStrokeGeometryJs(fuzzCase.samples, fuzzCase.options);
  const actual = kernel.processStroke(fuzzCase.samples, fuzzCase.options);
  auditFuzzResult(actual, expected, fuzzCase.label, fuzzReport);
}

const printableFuzzReport = {
  ...fuzzReport,
  maximumDabF32Ulp: fuzzReport.maximumDabF32Ulp.toString(),
  maximumTailF32Ulp: fuzzReport.maximumTailF32Ulp.toString(),
};
console.log("Seeded stroke geometry numerical audit.", printableFuzzReport);
assert.deepEqual(fuzzReport.countDivergences, [], "fuzz dab/tail counts must match");
assert.deepEqual(
  fuzzReport.integerStatDivergences,
  [],
  "fuzz structural integer statistics must match",
);
assert.ok(fuzzReport.maximumDabAbsoluteDelta <= 5e-4, "fuzz dab numerical envelope");
assert.ok(fuzzReport.maximumTailAbsoluteDelta <= 2e-7, "fuzz tail numerical envelope");
assert.ok(fuzzReport.maximumSpacingCarryDelta <= 1e-5, "fuzz carry numerical envelope");

console.log("Stroke geometry Wasm verification passed.", {
  fixtureSource,
  wasmBytes: wasmBytes.byteLength,
  interactiveStreamingMemoryBytes,
  largeWholeStrokeAuditMemoryBytes: kernel.memoryBytes(),
  summaries,
  forcedMaturePoints: repeatedActual.stats.forcedMaturePoints,
});

function concatenateForTest(parts) {
  const output = new Float64Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function createBuiltInFixture() {
  const points = Array.from({ length: 257 }, (_, index) => {
    const phase = index / 256;
    return {
      x: 64 + phase * 1536 + Math.sin(phase * Math.PI * 7) * 83,
      y: 512 + Math.sin(phase * Math.PI * 3.5) * 270 + Math.sin(phase * Math.PI * 19) * 13,
      pressure: 0.08 + 0.88 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2.7 - 0.6)),
      timeMs: index * 1000 / 240,
    };
  });
  return {
    settings: { size: 72, spacingPercent: 4.5 },
    points,
  };
}

function createRegressionFuzzCase({
  targetCase,
  seed,
  multiplier,
  increment,
  spacingMode,
}) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, multiplier) + increment) >>> 0;
    return state / 4_294_967_296;
  };
  let selected = null;
  for (let caseIndex = 0; caseIndex <= targetCase; caseIndex += 1) {
    const count = 2 + Math.floor(random() * 300);
    let x = 0;
    let y = 0;
    let timeMs = 0;
    const samples = [{
      x,
      y,
      timeMs,
      pressure: 0.01 + random() * 0.99,
    }];
    for (let index = 1; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = random() * (spacingMode === "fixed" ? 50 : 30);
      x += Math.cos(angle) * distance;
      y += Math.sin(angle) * distance;
      timeMs += random() < 0.2 ? 0 : random() * (spacingMode === "fixed" ? 20 : 10);
      samples.push({
        x,
        y,
        timeMs,
        pressure: 0.01 + random() * 0.99,
      });
    }
    const stabilizationValues = spacingMode === "fixed"
      ? [0, 0.1, 0.5, 0.999999, 1]
      : [0, 0.5, 1];
    const options = {
      stabilization: stabilizationValues[Math.floor(random() * stabilizationValues.length)],
      ...(spacingMode === "fixed"
        ? { spacing: 0.1 + random() * 25 }
        : { spacingMode, size: 1 + random() * 500 }),
      batchSize: 1 + Math.floor(random() * (spacingMode === "fixed" ? 60 : 50)),
    };
    if (caseIndex === targetCase) {
      selected = {
        label: `regression-${spacingMode}-${targetCase}`,
        samples,
        options,
      };
    }
  }
  return selected;
}

function auditFuzzResult(actual, expected, label, report) {
  let caseDabF32MismatchLanes = 0;
  let caseMaximumDabF32Ulp = 0n;
  let caseMaximumDabAbsoluteDelta = 0;
  if (actual.dabs.length !== expected.dabs.length || actual.tail.length !== expected.tail.length) {
    report.countDivergences.push({
      label,
      actualDabs: actual.dabs.length / 6,
      expectedDabs: expected.dabs.length / 6,
      actualTail: actual.tail.length / 10,
      expectedTail: expected.tail.length / 10,
    });
  }
  for (const key of integerStats) {
    if (actual.stats[key] !== expected.stats[key]) {
      report.integerStatDivergences.push({
        label,
        key,
        actual: actual.stats[key],
        expected: expected.stats[key],
      });
    }
  }
  const dabLaneCount = Math.min(actual.dabs.length, expected.dabs.length);
  for (let index = 0; index < dabLaneCount; index += 1) {
    const delta = Math.abs(actual.dabs[index] - expected.dabs[index]);
    const ulp = f32UlpDistance(actual.dabs[index], expected.dabs[index]);
    caseMaximumDabAbsoluteDelta = Math.max(caseMaximumDabAbsoluteDelta, delta);
    if (ulp > caseMaximumDabF32Ulp) caseMaximumDabF32Ulp = ulp;
    if (delta > report.maximumDabAbsoluteDelta) {
      report.maximumDabAbsoluteDelta = delta;
      report.worstDabCase = {
        label,
        lane: index,
        actual: actual.dabs[index],
        expected: expected.dabs[index],
        delta,
        ulp: ulp.toString(),
      };
    }
    if (ulp > report.maximumDabF32Ulp) report.maximumDabF32Ulp = ulp;
    if (ulp !== 0n) {
      caseDabF32MismatchLanes += 1;
      report.dabF32MismatchLanes += 1;
      report.firstDabF32Mismatch ??= {
        label,
        lane: index,
        actual: actual.dabs[index],
        expected: expected.dabs[index],
        actualF32Bits: f32Bits(actual.dabs[index]),
        expectedF32Bits: f32Bits(expected.dabs[index]),
        ulp: ulp.toString(),
      };
    }
  }
  if (caseDabF32MismatchLanes > 0) {
    report.f32MismatchCases.push({
      label,
      mismatchedLanes: caseDabF32MismatchLanes,
      maximumAbsoluteDelta: caseMaximumDabAbsoluteDelta,
      maximumUlp: caseMaximumDabF32Ulp.toString(),
    });
  }
  const tailLaneCount = Math.min(actual.tail.length, expected.tail.length);
  for (let index = 0; index < tailLaneCount; index += 1) {
    const delta = Math.abs(actual.tail[index] - expected.tail[index]);
    const ulp = f32UlpDistance(actual.tail[index], expected.tail[index]);
    if (delta > report.maximumTailAbsoluteDelta) {
      report.maximumTailAbsoluteDelta = delta;
      report.worstTailCase = { label, lane: index, delta, ulp: ulp.toString() };
    }
    if (ulp > report.maximumTailF32Ulp) report.maximumTailF32Ulp = ulp;
    if (ulp !== 0n) report.tailF32MismatchLanes += 1;
  }
  report.maximumSpacingCarryDelta = Math.max(
    report.maximumSpacingCarryDelta,
    Math.abs(actual.stats.spacingCarry - expected.stats.spacingCarry),
  );
}
