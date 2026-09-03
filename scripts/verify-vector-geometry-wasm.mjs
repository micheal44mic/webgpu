import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileVectorTextEffect } from "../src/vector-text-effect-geometry.ts";
import { vectorTextLodForSigma } from "../src/vector-text-lod.ts";
import { instantiateVectorGeometryKernel } from "../wasm/vector-geometry-kernel/runtime.mjs";
import {
  vectorGeometryArtifactPath,
  verifyVectorGeometryArtifactFreshness,
} from "./vector-geometry-artifact.mjs";

await verifyVectorGeometryArtifactFreshness();
const kernel = await instantiateVectorGeometryKernel(await readFile(vectorGeometryArtifactPath));
assert.equal(kernel.backend, "wasm");

function rectangle(left, top, right, bottom, clockwise = true) {
  const points = clockwise
    ? [[left, top], [right, top], [right, bottom], [left, bottom]]
    : [[left, top], [left, bottom], [right, bottom], [right, top]];
  const verbs = [0, 1, 1, 1, 4];
  return {
    verbs,
    coords: points.flat(),
  };
}

function pathFromContours(contours, fillRule = 0) {
  const verbs = [];
  const coords = [];
  const offsets = [];
  for (const contour of contours) {
    offsets.push(verbs.length);
    verbs.push(...contour.verbs);
    coords.push(...contour.coords);
  }
  return {
    fillRule,
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(offsets),
  };
}

const fixtures = [
  {
    name: "rectangle",
    path: pathFromContours([rectangle(-37.25, -11.5, 92.75, 63.125)]),
  },
  {
    name: "hole",
    path: pathFromContours([
      rectangle(-80, -70, 90, 75, true),
      rectangle(-21.5, -18.25, 27.75, 30.5, false),
    ]),
  },
  {
    name: "cubic",
    path: {
      fillRule: 0,
      verbs: new Uint8Array([0, 3, 3, 3, 3, 4]),
      coords: new Float64Array([
        0, -64,
        35.346, -64, 64, -35.346, 64, 0,
        64, 35.346, 35.346, 64, 0, 64,
        -35.346, 64, -64, 35.346, -64, 0,
        -64, -35.346, -35.346, -64, 0, -64,
      ]),
      contourOffsets: new Uint32Array([0]),
    },
  },
];

const effects = [
  { kind: "source-fill" },
  { kind: "source-outline", width: 3.75, join: "round" },
  { kind: "source-outline", width: 5.25, join: "bevel" },
  { kind: "source-outline", width: 7, join: "miter", includeFill: true },
  { kind: "block", vectorX: 12.5, vectorY: 8.25 },
  { kind: "block-outline", vectorX: -9.5, vectorY: 14, width: 2.5, join: "round" },
];

function triangleAreaSum(mesh) {
  let area = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const ia = mesh.indices[offset] * 2;
    const ib = mesh.indices[offset + 1] * 2;
    const ic = mesh.indices[offset + 2] * 2;
    const ax = mesh.vertices[ia];
    const ay = mesh.vertices[ia + 1];
    const bx = mesh.vertices[ib];
    const by = mesh.vertices[ib + 1];
    const cx = mesh.vertices[ic];
    const cy = mesh.vertices[ic + 1];
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
  }
  return area;
}

function sampleCovered(mesh, x, y) {
  const epsilon = 1e-9;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const indexes = [
      mesh.indices[offset] * 2,
      mesh.indices[offset + 1] * 2,
      mesh.indices[offset + 2] * 2,
    ];
    const ax = mesh.vertices[indexes[0]];
    const ay = mesh.vertices[indexes[0] + 1];
    const bx = mesh.vertices[indexes[1]];
    const by = mesh.vertices[indexes[1] + 1];
    const cx = mesh.vertices[indexes[2]];
    const cy = mesh.vertices[indexes[2] + 1];
    const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
    const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
    if (
      (ab >= -epsilon && bc >= -epsilon && ca >= -epsilon)
      || (ab <= epsilon && bc <= epsilon && ca <= epsilon)
    ) {
      return true;
    }
  }
  return false;
}

function assertCoverageParity(actual, expected, label) {
  const left = Math.min(actual.left, expected.left);
  const top = Math.min(actual.top, expected.top);
  const right = Math.max(actual.right, expected.right);
  const bottom = Math.max(actual.bottom, expected.bottom);
  const steps = 31;
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x = left + (right - left) * (column + 0.371) / steps;
      const y = top + (bottom - top) * (row + 0.619) / steps;
      assert.equal(
        sampleCovered(actual, x, y),
        sampleCovered(expected, x, y),
        `${label}: sampled coverage at ${column},${row}`,
      );
    }
  }
}

const reports = [];
let nextHandle = 1;
for (const fixture of fixtures) {
  const handle = nextHandle;
  nextHandle += 1;
  kernel.registerPath(handle, fixture.path);
  for (const sigma of [0.125, 1, 8]) {
    const lod = vectorTextLodForSigma(sigma);
    for (const effect of effects) {
      const suffix = `${fixture.name}:${sigma}:${effect.kind}`;
      const expected = compileVectorTextEffect(fixture.path, lod, effect, suffix);
      const actual = kernel.compileRegistered(
        handle,
        lod,
        effect,
        expected?.revision ?? suffix,
      );
      const warm = kernel.compileRegistered(
        handle,
        lod,
        effect,
        expected?.revision ?? suffix,
      );
      assert.equal(actual.mesh === null, expected === null, `${suffix}: null result`);
      assert.equal(warm.mesh === null, expected === null, `${suffix}: warm null result`);
      if (!expected || !actual.mesh) continue;
      const metadataKeys = [
        "left", "top", "right", "bottom", "originX", "originY", "lodBucket", "integerScale",
      ];
      for (const key of metadataKeys) {
        assert.equal(actual.mesh[key], expected[key], `${suffix}: ${key}`);
      }
      assert.deepEqual(actual.mesh.vertices, expected.vertices, `${suffix}: vertices`);
      assert.deepEqual(warm.mesh?.vertices, expected.vertices, `${suffix}: warm vertices`);
      assert.equal(actual.mesh.indices.length, expected.indices.length, `${suffix}: index count`);
      const actualArea = triangleAreaSum(actual.mesh);
      const expectedArea = triangleAreaSum(expected);
      assert.ok(
        Math.abs(actualArea - expectedArea) <= Math.max(1e-6, expectedArea * 1e-8),
        `${suffix}: triangulated area`,
      );
      assertCoverageParity(actual.mesh, expected, suffix);
      reports.push({
        fixture: fixture.name,
        sigma,
        effect: effect.kind,
        vertices: actual.mesh.vertices.length / 2,
        triangles: actual.mesh.indices.length / 3,
        computeMs: actual.computeMs,
      });
    }
  }
  kernel.releasePath(handle);
}

const cacheDiagnostics = kernel.diagnostics();
assert.equal(cacheDiagnostics.registeredPaths, 0);
assert.ok(cacheDiagnostics.canonicalCacheHits > 0, "registered compilation must hit its cache");

assert.throws(
  () => kernel.compile(
    {
      fillRule: 0,
      verbs: new Uint8Array([0, 1, 4]),
      coords: new Float64Array([0, 0, Number.NaN, 1]),
      contourOffsets: new Uint32Array([0]),
    },
    vectorTextLodForSigma(1),
    { kind: "source-fill" },
    "invalid",
  ),
  /non-finite/,
);

console.log(JSON.stringify({
  passed: true,
  cases: reports.length,
  wasmBytes: (await readFile(vectorGeometryArtifactPath)).byteLength,
  memoryBytes: kernel.memoryBytes(),
}, null, 2));
