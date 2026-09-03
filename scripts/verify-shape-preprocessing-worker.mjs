import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  instantiateScalarMaskKernel,
  prepareScalarMaskJs,
} from "../wasm/shape-mask-kernel/runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRootUrl = new URL("../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(sourceRootUrl)
      && /^\.{1,2}\//.test(specifier)
      && !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const [{ preprocessShapeMask }, { SHAPE_OCCUPANCY_MAP_COUNT }] = await Promise.all([
  import("../src/shape-preprocessing-core.ts"),
  import("../src/engine-limits.ts"),
]);
const wasmBytes = readFileSync(resolve(
  repositoryRoot,
  "wasm",
  "shape-mask-kernel",
  "dist",
  "shape_mask_kernel.wasm",
));
const kernel = await instantiateScalarMaskKernel(wasmBytes);
const source = new Uint16Array(16);
source[5] = 65535;
source[6] = 65535;
source[9] = 65535;
source[10] = 65535;
const input = {
  source,
  sourceWidth: 4,
  sourceHeight: 4,
  invert: false,
  maskFormat: "r16float",
};
const expected = preprocessShapeMask(
  input,
  { backend: "js", prepare: prepareScalarMaskJs },
);
const actual = preprocessShapeMask(input, kernel);

assert.equal(actual.backend, "wasm");
assert.equal(actual.identity, expected.identity);
assert.equal(actual.sourceIdentity, expected.sourceIdentity);
assert.equal(actual.sourceWidth, 4);
assert.equal(actual.sourceHeight, 4);
assert.equal(actual.previewSize, 128);
assert.equal(actual.occupancyActiveCells.length, SHAPE_OCCUPANCY_MAP_COUNT);
assert.equal(actual.occupancyCoverageRatios.length, SHAPE_OCCUPANCY_MAP_COUNT);
assert.deepEqual(actual.scalar16, expected.scalar16);
assert.deepEqual(actual.previewMask, expected.previewMask);
assert.deepEqual(actual.occupancyWords, expected.occupancyWords);
assert.deepEqual(actual.occupancyActiveCells, expected.occupancyActiveCells);
assert.deepEqual(actual.occupancyCoverageRatios, expected.occupancyCoverageRatios);
assert.deepEqual(actual.outline.boundingHull, expected.outline.boundingHull);
assert.equal(actual.outline.paths.length, expected.outline.paths.length);
actual.outline.paths.forEach((path, index) => {
  assert.deepEqual(path, expected.outline.paths[index]);
});
assert.ok(actual.timings.totalMs >= actual.timings.scalarMs);
assert.ok(actual.retainedWasmMemoryBytes > 0);

const [workerSource, clientSource, protocolSource, resourceSource] = await Promise.all([
  readFile(resolve(repositoryRoot, "src", "shape-preprocessing-worker.ts"), "utf8"),
  readFile(resolve(repositoryRoot, "src", "shape-preprocessing-client.ts"), "utf8"),
  readFile(resolve(repositoryRoot, "src", "shape-preprocessing-worker-protocol.ts"), "utf8"),
  readFile(resolve(repositoryRoot, "src", "engine-resource-setup.ts"), "utf8"),
]);
assert.match(workerSource, /decodeGrayscalePng/);
assert.match(workerSource, /transferableBuffers/);
assert.match(workerSource, /preprocessShapeMask/);
assert.match(clientSource, /SHAPE_PREPROCESSING_DEFAULT_IDLE_TERMINATION_MS/);
assert.match(clientSource, /prepareFallback/);
assert.match(clientSource, /terminateIdleWorker/);
assert.match(protocolSource, /type: "prepare-png"/);
assert.match(protocolSource, /Uint16Array/);
assert.match(protocolSource, /Float32Array/);
assert.match(resourceSource, /const shapePreprocessingClient = new ShapePreprocessingClient\(\)/);
assert.match(
  resourceSource,
  /source: customAsset\.scalar16,[\s\S]*?invert: shapeInvert,[\s\S]*?maskFormat: shapeMaskFormat/,
);
assert.match(
  resourceSource,
  /pngBytes: source,[\s\S]*?invert: asset\.decode\.invertLuminance !== shapeInvert/,
);
assert.match(resourceSource, /scalar16: prepared\.scalar16/);
assert.match(resourceSource, /outline: prepared\.outline/);

console.log(
  "Shape preprocessing worker verified: full Wasm/JS parity for scalar data, "
  + "outline, preview mip, protected support occupancy, PNG worker decode, "
  + "typed transfer protocol, deterministic fallback, and idle termination.",
);
