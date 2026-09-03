import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  instantiateScalarMaskKernel,
  prepareScalarMaskJs,
} from "../wasm/shape-mask-kernel/runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmBytes = await readFile(resolve(
  repositoryRoot,
  "wasm",
  "shape-mask-kernel",
  "dist",
  "shape_mask_kernel.wasm",
));
const kernel = await instantiateScalarMaskKernel(wasmBytes);

const median = (values) => [...values].sort((left, right) => left - right)[
  Math.floor(values.length / 2)
];
const measure = (operation, runs = 7) => {
  operation();
  const values = [];
  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now();
    operation();
    values.push(performance.now() - startedAt);
  }
  return median(values);
};
let state = 0x12345678;
const randomSource = (width, height) => {
  const source = new Uint16Array(width * height);
  for (let index = 0; index < source.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    source[index] = state & 0xffff;
  }
  return source;
};
const scenarios = [
  {
    label: "native 2048² shape",
    width: 2048,
    height: 2048,
    options: { targetSize: 2048, invert: true, quantizeR8: false },
  },
  {
    label: "1536×1024 custom shape → 2048²",
    width: 1536,
    height: 1024,
    options: { targetSize: 2048, invert: true, quantizeR8: false },
  },
  {
    label: "2048² scalar preview without support",
    width: 2048,
    height: 2048,
    options: {
      targetSize: 2048,
      invert: true,
      quantizeR8: false,
      emitSupport: false,
    },
  },
];

for (const scenario of scenarios) {
  const source = randomSource(scenario.width, scenario.height);
  const jsMs = measure(() => prepareScalarMaskJs(
    source,
    scenario.width,
    scenario.height,
    scenario.options,
  ));
  const wasmMs = measure(() => kernel.prepare(
    source,
    scenario.width,
    scenario.height,
    scenario.options,
  ));
  console.log(
    `${scenario.label} end-to-end median: JS ${jsMs.toFixed(1)} ms · `
    + `Wasm ${wasmMs.toFixed(1)} ms · ${(jsMs / wasmMs).toFixed(2)}×.`,
  );
}
