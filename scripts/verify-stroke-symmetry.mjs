import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  STAMP_STRIDE_BYTES,
} from "../src/engine-limits.ts";
import {
  encodeStrokeSymmetryOptions,
  reflectStrokeSymmetryCenter,
  strokeSymmetryModeForStampBatch,
  strokeSymmetryPhysicalCopyCount,
} from "../src/stroke-symmetry-core.ts";

assert.equal(STAMP_STRIDE_BYTES, 32, "symmetry must not expand the GPU stamp ABI");
assert.equal(encodeStrokeSymmetryOptions(3, "off"), 3);
assert.equal(encodeStrokeSymmetryOptions(3, "vertical"), 3 | (1 << 8));
assert.equal(encodeStrokeSymmetryOptions(3, "horizontal"), 3 | (2 << 8));
assert.equal(strokeSymmetryPhysicalCopyCount(3, "off"), 3);
assert.equal(strokeSymmetryPhysicalCopyCount(3, "vertical"), 6);
assert.deepEqual(
  reflectStrokeSymmetryCenter(100, 200, "vertical", DOCUMENT_WIDTH, DOCUMENT_HEIGHT),
  [DOCUMENT_WIDTH - 100, 200],
);
assert.deepEqual(
  reflectStrokeSymmetryCenter(100, 200, "horizontal", DOCUMENT_WIDTH, DOCUMENT_HEIGHT),
  [100, DOCUMENT_HEIGHT - 200],
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
  symmetryMode: "vertical",
};
assert.equal(strokeSymmetryModeForStampBatch([sourceStamp]), "vertical");
assert.throws(
  () => strokeSymmetryModeForStampBatch([
    sourceStamp,
    { ...sourceStamp, symmetryMode: "horizontal" },
  ]),
  /multiple symmetry modes/,
);

const root = new URL("../", import.meta.url);
const shaderSource = readFileSync(new URL("src/shaders.ts", root), "utf8");
const engineSource = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const historySource = readFileSync(new URL("src/engine-history-types.ts", root), "utf8");
const stampUploadSource = readFileSync(new URL("src/engine-stamp-upload.ts", root), "utf8");
assert(shaderSource.includes("let copiesPerStamp = copyCount * symmetryCopyCount"));
assert(shaderSource.includes("jitteredCenter + geometryPosition * stamp.radius"));
assert(shaderSource.includes("DOCUMENT_WIDTH - layerPosition.x"));
assert(shaderSource.includes("DOCUMENT_HEIGHT - layerPosition.y"));
assert(engineSource.includes("setStrokeSymmetryMode(mode: StrokeSymmetryMode)"));
assert(engineSource.includes("strokeSymmetryPhysicalCopyCount"));
assert(historySource.includes("symmetryMode: StrokeSymmetryMode"));
assert(stampUploadSource.includes("encodeStrokeSymmetryOptions(settings.count, symmetryMode)"));
assert(stampUploadSource.includes("reflectStrokeSymmetryCenter("));
assert(stampUploadSource.includes("uploadU32[base + 5] = 0"));

console.log("Stroke symmetry verification passed.");
