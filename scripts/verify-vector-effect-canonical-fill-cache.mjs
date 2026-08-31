import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  compileVectorTextEffect,
  VectorTextCanonicalFillCache,
} from "../src/vector-text-effect-geometry.ts";
import { vectorTextLodForSigma } from "../src/vector-text-lod.ts";

function polygonPath(points) {
  const verbs = new Uint8Array(points.length + 1);
  const coords = new Float64Array(points.length * 2);
  verbs[0] = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) verbs[index] = 1;
    coords[index * 2] = points[index][0];
    coords[index * 2 + 1] = points[index][1];
  }
  verbs[points.length] = 4;
  return {
    fillRule: 0,
    verbs,
    coords,
    contourOffsets: new Uint32Array([0]),
  };
}

function meshBytes(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function assertMeshByteExact(actual, expected, label) {
  assert.ok(actual, `${label}: cached mesh is missing`);
  assert.ok(expected, `${label}: uncached mesh is missing`);
  assert.deepEqual(
    {
      revision: actual.revision,
      left: actual.left,
      top: actual.top,
      right: actual.right,
      bottom: actual.bottom,
      originX: actual.originX,
      originY: actual.originY,
      lodBucket: actual.lodBucket,
      integerScale: actual.integerScale,
    },
    {
      revision: expected.revision,
      left: expected.left,
      top: expected.top,
      right: expected.right,
      bottom: expected.bottom,
      originX: expected.originX,
      originY: expected.originY,
      lodBucket: expected.lodBucket,
      integerScale: expected.integerScale,
    },
    `${label}: cached scalar output changed`,
  );
  assert.deepEqual(
    meshBytes(actual.vertices),
    meshBytes(expected.vertices),
    `${label}: cached vertex bytes changed`,
  );
  assert.deepEqual(
    meshBytes(actual.indices),
    meshBytes(expected.indices),
    `${label}: cached index bytes changed`,
  );
}

const path = polygonPath([
  [0, 0],
  [84, 0],
  [112, 31],
  [78, 88],
  [12, 73],
]);
const changedPath = polygonPath([
  [0, 0],
  [85, 0],
  [112, 31],
  [78, 88],
  [12, 73],
]);
const lod = vectorTextLodForSigma(2);
const cache = new VectorTextCanonicalFillCache(32, 8 * 1024 * 1024);

const blockFill = cache.getOrCreate("path-a", path, lod, 0);
assert.deepEqual(cache.diagnostics(), {
  entries: 1,
  retainedBytes: cache.diagnostics().retainedBytes,
  hits: 0,
  misses: 1,
  evictions: 0,
});
assert.ok(cache.diagnostics().retainedBytes > 0);

// Angle and distance change the block vector, not its canonical source fill.
for (const [index, effect] of [
  { kind: "block", vectorX: 20, vectorY: 4 },
  { kind: "block", vectorX: -7, vectorY: 23 },
].entries()) {
  const retainedFill = cache.getOrCreate("path-a", path, lod, 0);
  assert.equal(retainedFill, blockFill);
  const revision = `block-variant-${index}`;
  assertMeshByteExact(
    compileVectorTextEffect(path, lod, effect, revision, retainedFill),
    compileVectorTextEffect(path, lod, effect, revision),
    revision,
  );
}
assert.equal(cache.diagnostics().hits, 2);
assert.equal(cache.diagnostics().misses, 1);

// Source and block outlines with the same width share the width-aware fill.
const outlineWidth = 6;
const outlineFill = cache.getOrCreate("path-a", path, lod, outlineWidth);
assert.equal(cache.diagnostics().misses, 2);
const reusedOutlineFill = cache.getOrCreate("path-a", path, lod, outlineWidth);
assert.equal(reusedOutlineFill, outlineFill);
for (const [revision, effect] of [
  ["source-outline", {
    kind: "source-outline",
    width: outlineWidth,
    join: "round",
  }],
  ["block-outline", {
    kind: "block-outline",
    vectorX: 18,
    vectorY: -12,
    width: outlineWidth,
    join: "bevel",
  }],
]) {
  assertMeshByteExact(
    compileVectorTextEffect(path, lod, effect, revision, outlineFill),
    compileVectorTextEffect(path, lod, effect, revision),
    revision,
  );
}

// A different content revision, every LOD field, and outline width are misses.
let expectedMisses = cache.diagnostics().misses;
cache.getOrCreate("path-b", changedPath, lod, 0);
expectedMisses += 1;
assert.equal(cache.diagnostics().misses, expectedMisses);
for (const [field, value] of [
  ["bucket", lod.bucket + 1],
  ["bucketScale", lod.bucketScale + 1],
  ["cubicToQuadraticTolerance", lod.cubicToQuadraticTolerance * 0.75],
  ["polygonFlattenTolerance", lod.polygonFlattenTolerance * 0.75],
  ["roundArcSagittaTolerance", lod.roundArcSagittaTolerance * 0.75],
  ["integerScale", lod.integerScale + 1],
]) {
  cache.getOrCreate("path-a", path, { ...lod, [field]: value }, 0);
  expectedMisses += 1;
  assert.equal(cache.diagnostics().misses, expectedMisses, `${field} must key the cache`);
}
cache.getOrCreate("path-a", path, lod, outlineWidth + 1);
expectedMisses += 1;
assert.equal(cache.diagnostics().misses, expectedMisses, "outline width must key the cache");

// Entry count is bounded and a hit promotes the entry to most-recently used.
const lru = new VectorTextCanonicalFillCache(2, 8 * 1024 * 1024);
const first = lru.getOrCreate("first", path, lod, 0);
lru.getOrCreate("second", path, lod, 0);
assert.equal(lru.getOrCreate("first", path, lod, 0), first);
lru.getOrCreate("third", path, lod, 0);
assert.equal(lru.diagnostics().entries, 2);
assert.equal(lru.diagnostics().evictions, 1);
const missesBeforeEvictedLookup = lru.diagnostics().misses;
lru.getOrCreate("second", path, lod, 0);
assert.equal(lru.diagnostics().misses, missesBeforeEvictedLookup + 1);

// The byte cap also rejects a single oversized entry without retaining it.
const byteBounded = new VectorTextCanonicalFillCache(4, 1);
byteBounded.getOrCreate("oversized", path, lod, 0);
assert.deepEqual(byteBounded.diagnostics(), {
  entries: 0,
  retainedBytes: 0,
  hits: 0,
  misses: 1,
  evictions: 0,
});

// Releasing a worker path removes every LOD/width variant; reset clears state.
const releasable = new VectorTextCanonicalFillCache(8, 8 * 1024 * 1024);
releasable.getOrCreate("released", path, lod, 0);
releasable.getOrCreate("released", path, lod, 4);
releasable.getOrCreate("retained", changedPath, lod, 0);
assert.equal(releasable.releasePath("released"), 2);
assert.equal(releasable.diagnostics().entries, 1);
assert.equal(releasable.releasePath("released"), 0);
releasable.reset();
assert.deepEqual(releasable.diagnostics(), {
  entries: 0,
  retainedBytes: 0,
  hits: 0,
  misses: 0,
  evictions: 0,
});

assert.throws(() => new VectorTextCanonicalFillCache(0, 1), /positive integer/);
assert.throws(() => new VectorTextCanonicalFillCache(1, 0), /positive integer/);

const workerSource = readFileSync(
  new URL("../src/vector-text-effect-worker.ts", import.meta.url),
  "utf8",
);
assert.match(workerSource, /const canonicalFills = new VectorTextCanonicalFillCache\(\)/);
assert.match(
  workerSource,
  /message\.type === "release-path"[\s\S]*canonicalFills\.releasePath\(message\.revision\)/,
);
assert.match(
  workerSource,
  /canonicalFills\.getOrCreate\([\s\S]*message\.revision[\s\S]*message\.lod/,
);

console.log(
  "Vector effect canonical-fill cache verified: byte-exact reuse, full LOD/width identity, bounded LRU, release, and reset.",
);
