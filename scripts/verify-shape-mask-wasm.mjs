import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createScalarMaskPreprocessor,
  instantiateScalarMaskKernel,
  prepareScalarMaskJs,
} from "../wasm/shape-mask-kernel/runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = resolve(
  repositoryRoot,
  "wasm",
  "shape-mask-kernel",
  "dist",
  "shape_mask_kernel.wasm",
);
const wasmBytes = await readFile(wasmPath);
const kernel = await instantiateScalarMaskKernel(wasmBytes);
assert.equal(kernel.backend, "wasm");

const compare = (source, width, height, options) => {
  const snapshot = source.slice();
  const expected = prepareScalarMaskJs(source, width, height, options);
  const actual = kernel.prepare(source, width, height, options);
  assert.deepEqual(source, snapshot, "the adapter must not mutate its caller-owned source");
  assert.equal(actual.identity, expected.identity, "post-transform identity");
  assert.deepEqual(actual.scalar16, expected.scalar16, "post-transform scalar source");
  assert.deepEqual(actual.baseMask, expected.baseMask, "visual mask");
  assert.deepEqual(actual.supportMask, expected.supportMask, "support mask");
};

const fixed = Uint16Array.from([0, 1, 128, 129, 256, 257, 32768, 65535]);
for (const invert of [false, true]) {
  for (const quantizeR8 of [false, true]) {
    compare(fixed, 4, 2, { targetSize: 4, invert, quantizeR8 });
    compare(fixed, 4, 2, {
      targetSize: 7,
      invert,
      quantizeR8,
      emitSupport: false,
    });
    compare(fixed, 4, 2, {
      targetSize: 3,
      invert,
      quantizeR8,
      emitBase: false,
    });
  }
}

let randomState = 0x9e3779b9;
const randomU16 = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState & 0xffff;
};
for (let fixture = 0; fixture < 24; fixture += 1) {
  const width = 1 + fixture % 9;
  const height = 1 + fixture % 7;
  const targetSize = 1 + fixture % 11;
  const source = Uint16Array.from(
    { length: width * height },
    () => randomU16(),
  );
  compare(source, width, height, {
    targetSize,
    invert: fixture % 2 === 0,
    quantizeR8: fixture % 3 === 0,
  });
}

assert.throws(
  () => kernel.prepare(new Uint16Array(3), 2, 2),
  /sample count/,
);
assert.throws(
  () => kernel.prepare(new Uint16Array(1), 1, 1, { targetSize: 0 }),
  /target size/,
);

const fallback = await createScalarMaskPreprocessor({
  moduleOrBytes: new Uint8Array([0, 1, 2, 3]),
});
assert.equal(fallback.backend, "js");
assert.ok(fallback.initializationError instanceof Error);
assert.deepEqual(
  fallback.prepare(fixed, 4, 2, { targetSize: 5, invert: true }),
  prepareScalarMaskJs(fixed, 4, 2, { targetSize: 5, invert: true }),
);

console.log(
  "Scalar mask Wasm kernel verified: exact U16 inversion/hash, R8/R16 resampling, "
  + "conservative support, optional outputs, immutable input, and JS fallback.",
);
