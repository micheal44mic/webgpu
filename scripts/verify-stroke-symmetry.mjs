import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import {
  BRUSH_UNIFORM_BYTES,
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  STAMP_STRIDE_BYTES,
} from "../src/engine-limits.ts";
import {
  encodeStrokeSymmetryOptions,
  reflectedStrokeSymmetryExtent,
  reflectStrokeSymmetryCenter,
  strokeSymmetryCopiesIntersectDocument,
  strokeSymmetryPhysicalCopyCount,
  strokeSymmetryReflectionCoefficients,
  strokeSymmetryTransformForStampBatch,
} from "../src/stroke-symmetry-core.ts";

function closeTo(actual, expected, epsilon = 1e-5, label = "value") {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

assert.equal(STAMP_STRIDE_BYTES, 32, "symmetry must not expand the GPU stamp ABI");
assert.equal(BRUSH_UNIFORM_BYTES, 112, "symmetry must retain the dimension-neutral uniform ABI");
assert.equal(encodeStrokeSymmetryOptions(3, "off"), 3);
assert.equal(encodeStrokeSymmetryOptions(3, "vertical"), 3 | (1 << 8));
assert.equal(encodeStrokeSymmetryOptions(3, "horizontal"), 3 | (2 << 8));
assert.equal(encodeStrokeSymmetryOptions(3, "angle"), 3 | (3 << 8));
assert.equal(strokeSymmetryPhysicalCopyCount(3, "off"), 3);
assert.equal(strokeSymmetryPhysicalCopyCount(3, "angle"), 6);
assert.deepEqual(strokeSymmetryReflectionCoefficients("horizontal"), [1, 0]);
assert.deepEqual(strokeSymmetryReflectionCoefficients("vertical"), [-1, 0]);
assert.deepEqual(strokeSymmetryReflectionCoefficients("angle", Math.PI / 4), [0, 1]);

assert.deepEqual(
  reflectStrokeSymmetryCenter(100, 200, "vertical", DOCUMENT_WIDTH, DOCUMENT_HEIGHT),
  [DOCUMENT_WIDTH - 100, 200],
);
assert.deepEqual(
  reflectStrokeSymmetryCenter(100, 200, "horizontal", DOCUMENT_WIDTH, DOCUMENT_HEIGHT),
  [100, DOCUMENT_HEIGHT - 200],
);
const reflected45 = reflectStrokeSymmetryCenter(620, 260, "angle", 1000, 600, Math.PI / 4);
assert.deepEqual(reflected45, [460, 420]);
assert.deepEqual(
  reflectStrokeSymmetryCenter(...reflected45, "angle", 1000, 600, Math.PI / 4),
  [620, 260],
  "reflection must be an involution",
);
assert.deepEqual(
  reflectedStrokeSymmetryExtent(32, 12, "angle", Math.PI / 4),
  [12, 32],
);
const extent30 = reflectedStrokeSymmetryExtent(32, 12, "angle", Math.PI / 6);
closeTo(extent30[0], 26.3923048, 1e-5, "30-degree reflected x extent");
closeTo(extent30[1], 33.7128129, 1e-5, "30-degree reflected y extent");
assert.equal(
  strokeSymmetryCopiesIntersectDocument(-20, 300, 5, 5, "off", 1000, 600),
  false,
);
assert.equal(
  strokeSymmetryCopiesIntersectDocument(-20, 300, 5, 5, "vertical", 1000, 600),
  false,
);
assert.equal(
  strokeSymmetryCopiesIntersectDocument(500, -50, 5, 5, "angle", 1000, 600, Math.PI / 4),
  true,
  "an off-document source must survive culling when its reflected copy is visible",
);

const sourceStamp = {
  x: 100,
  y: 200,
  radius: 10,
  pressure: 1,
  seed: 123,
  directionX: 1,
  directionY: 0,
  historyActionId: 7,
  symmetryMode: "angle",
  symmetryAngleRadians: Math.PI / 4,
};
assert.deepEqual(strokeSymmetryTransformForStampBatch([sourceStamp]), {
  mode: "angle",
  angleRadians: Math.PI / 4,
});
assert.throws(
  () => strokeSymmetryTransformForStampBatch([
    sourceStamp,
    { ...sourceStamp, symmetryAngleRadians: Math.PI / 3 },
  ]),
  /multiple symmetry transforms/,
);
assert.throws(
  () => strokeSymmetryTransformForStampBatch([{ ...sourceStamp, symmetryAngleRadians: NaN }]),
  /Invalid stamp symmetry angle/,
);
assert.throws(
  () => strokeSymmetryTransformForStampBatch([{
    ...sourceStamp,
    symmetryAngleRadians: undefined,
  }]),
  /Invalid stamp symmetry angle/,
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let defaultBrushSettings;
let packStampsIntoUpload;
let populateBrushUniformUpload;
let resolvePaintHistoryStampCount;
try {
  ({ defaultBrushSettings } = await moduleServer.ssrLoadModule("/src/engine-types.ts"));
  ({
    packStampsIntoUpload,
    populateBrushUniformUpload,
  } = await moduleServer.ssrLoadModule("/src/engine-stamp-upload.ts"));
  ({ resolvePaintHistoryStampCount } = await moduleServer.ssrLoadModule(
    "/src/engine-history-types.ts",
  ));
} finally {
  await moduleServer.close();
}

const angleSettings = {
  ...defaultBrushSettings,
  count: 3,
  positionJitterLinear: 1,
  positionJitterLateral: 0,
  shape: "circle",
};
const uniformUpload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
populateBrushUniformUpload(
  uniformUpload,
  angleSettings,
  DOCUMENT_WIDTH,
  DOCUMENT_HEIGHT,
  0,
  0,
  "angle",
  Math.PI / 4,
);
const uniformFloats = new Float32Array(uniformUpload);
const uniformUnsigned = new Uint32Array(uniformUpload);
assert.equal(uniformFloats[15], 0);
assert.equal(uniformFloats[19], 1);
assert.equal(uniformUnsigned[20], 3 | (3 << 8));
assert.equal(uniformFloats[24], DOCUMENT_WIDTH);
assert.equal(uniformFloats[25], DOCUMENT_HEIGHT);

const packedUpload = new ArrayBuffer(STAMP_STRIDE_BYTES);
const packed = packStampsIntoUpload(
  [{
    ...sourceStamp,
    x: DOCUMENT_WIDTH * 0.5,
    y: DOCUMENT_HEIGHT * 0.5,
  }],
  angleSettings,
  new Float32Array(packedUpload),
  new Uint32Array(packedUpload),
);
assert.deepEqual(packed.dirtyRect, {
  x: DOCUMENT_WIDTH * 0.5 - 32,
  y: DOCUMENT_HEIGHT * 0.5 - 32,
  width: 64,
  height: 64,
});

const historyBatch = {
  stampCount: 1,
  symmetryMode: "angle",
  symmetryAngleRadians: Math.PI / 4,
  cloneSource: null,
  gpuSlice: { logicalBytes: STAMP_STRIDE_BYTES },
};
assert.equal(resolvePaintHistoryStampCount([], historyBatch), 1);
assert.equal(resolvePaintHistoryStampCount([], {
  ...historyBatch,
  symmetryMode: "vertical",
  symmetryAngleRadians: undefined,
}), 1, "legacy vertical history must remain replayable");
assert.equal(resolvePaintHistoryStampCount([], {
  ...historyBatch,
  symmetryMode: "horizontal",
  symmetryAngleRadians: undefined,
}), 1, "legacy horizontal history must remain replayable");
assert.throws(
  () => resolvePaintHistoryStampCount([], {
    ...historyBatch,
    symmetryAngleRadians: undefined,
  }),
  /Invalid Paint history symmetry transform/,
);
assert.throws(
  () => resolvePaintHistoryStampCount([], {
    ...historyBatch,
    symmetryAngleRadians: Number.NaN,
  }),
  /Invalid Paint history symmetry transform/,
);
assert.throws(
  () => resolvePaintHistoryStampCount([], {
    ...historyBatch,
    symmetryAngleRadians: Math.PI + Math.PI / 4,
  }),
  /Invalid Paint history symmetry transform/,
);
assert.throws(
  () => resolvePaintHistoryStampCount([], {
    ...historyBatch,
    cloneSource: {},
  }),
  /Invalid Paint history symmetry transform/,
);

const root = new URL("../", import.meta.url);
const shaderSource = readFileSync(new URL("src/shaders.ts", root), "utf8");
const engineSource = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const historySource = readFileSync(new URL("src/engine-history-types.ts", root), "utf8");
const stampUploadSource = readFileSync(new URL("src/engine-stamp-upload.ts", root), "utf8");
const strokeTypesSource = readFileSync(new URL("src/engine-stroke-types.ts", root), "utf8");
const reflectionFunction = shaderSource.slice(
  shaderSource.indexOf("fn reflectedLayerPosition("),
  shaderSource.indexOf("@vertex", shaderSource.indexOf("fn reflectedLayerPosition(")),
);
assert(shaderSource.includes("let copiesPerStamp = copyCount * symmetryCopyCount"));
assert(shaderSource.includes("jitteredCenter + geometryPosition * stamp.radius"));
assert(reflectionFunction.includes("brush.controls.w"));
assert(reflectionFunction.includes("brush.positionJitter.w"));
assert(!reflectionFunction.includes("cos("));
assert(!reflectionFunction.includes("sin("));
assert(engineSource.includes("setStrokeSymmetry(enabled: boolean, angleDegrees: number)"));
assert(engineSource.includes("sourceStroke.symmetryAngleRadians"));
assert(engineSource.includes("symmetryAngleRadians: symmetryTransform.angleRadians"));
assert(engineSource.includes("replayBatch.symmetryAngleRadians"));
assert(historySource.includes("symmetryAngleRadians: number"));
assert(strokeTypesSource.includes("readonly symmetryAngleRadians: number"));
assert(stampUploadSource.includes("strokeSymmetryReflectionCoefficients("));
assert(stampUploadSource.includes("reflectedStrokeSymmetryExtent("));
assert(stampUploadSource.includes("uploadU32[base + 5] = 0"));

console.log("Stroke symmetry angle verification passed.");
