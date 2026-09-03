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

const {
  grainPreviewRgbaFromScalar16,
  preprocessGrainPng,
  preprocessGrainScalar,
} = await import("../src/grain-preprocessing-core.ts");
const wasmBytes = readFileSync(resolve(
  repositoryRoot,
  "wasm",
  "shape-mask-kernel",
  "dist",
  "shape_mask_kernel.wasm",
));
const kernel = await instantiateScalarMaskKernel(wasmBytes);
const jsPreprocessor = { backend: "js", prepare: prepareScalarMaskJs };

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash;
}

const scalarInput = {
  kind: "scalar",
  scalar16: new Uint16Array([0, 1, 257, 32768, 65278, 65535]),
  width: 3,
  height: 2,
  invertLuminance: true,
  sourceBitDepth: 16,
};
const scalarJs = preprocessGrainScalar(scalarInput, jsPreprocessor);
const scalarWasm = preprocessGrainScalar(scalarInput, kernel);
assert.equal(scalarWasm.backend, "wasm");
assert.deepEqual(scalarWasm.scalar16, scalarJs.scalar16);
assert.deepEqual(scalarWasm.previewRgba, scalarJs.previewRgba);
assert.equal(scalarWasm.identity, scalarJs.identity);
assert.equal(scalarWasm.scalarIdentity, scalarJs.scalarIdentity);
assert.equal(scalarWasm.identity, scalarWasm.scalarIdentity);
assert.equal(
  scalarWasm.identity,
  fnv1a(new Uint8Array(
    scalarWasm.scalar16.buffer,
    scalarWasm.scalar16.byteOffset,
    scalarWasm.scalar16.byteLength,
  )),
);
assert.ok(scalarWasm.retainedWasmMemoryBytes > 0);
assert.deepEqual(
  grainPreviewRgbaFromScalar16(new Uint16Array([0, 32768, 65535])),
  new Uint8Array([
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 255,
  ]),
);

const pngBytes = readFileSync(resolve(repositoryRoot, "Grainpencil.png"));
const pngBuffer = pngBytes.buffer.slice(
  pngBytes.byteOffset,
  pngBytes.byteOffset + pngBytes.byteLength,
);
const pngInput = {
  kind: "png",
  pngBytes: pngBuffer,
  expectedWidth: 800,
  expectedHeight: 800,
  invertLuminance: false,
};
const [pngJs, pngWasm, pngWasmInverted] = await Promise.all([
  preprocessGrainPng(pngInput, jsPreprocessor),
  preprocessGrainPng(pngInput, kernel),
  preprocessGrainPng({ ...pngInput, invertLuminance: true }, kernel),
]);
assert.equal(pngWasm.backend, "wasm");
assert.equal(pngWasm.width, 800);
assert.equal(pngWasm.height, 800);
assert.equal(pngWasm.previewRgba.byteLength, 800 * 800 * 4);
assert.deepEqual(pngWasm.scalar16, pngJs.scalar16);
assert.deepEqual(pngWasm.previewRgba, pngJs.previewRgba);
assert.equal(pngWasm.identity, pngJs.identity);
assert.equal(pngWasm.identity, fnv1a(pngBytes));
assert.equal(pngWasm.scalarIdentity, pngJs.scalarIdentity);
assert.equal(pngWasmInverted.identity, pngWasm.identity);
assert.notEqual(pngWasmInverted.scalarIdentity, pngWasm.scalarIdentity);
assert.equal(pngWasm.timings.decodeMs >= 0, true);
assert.equal(pngWasm.timings.totalMs >= pngWasm.timings.scalarMs, true);
await assert.rejects(
  preprocessGrainPng({ ...pngInput, expectedWidth: 801 }, kernel),
  /must remain 801×800px/,
);

const [workerSource, clientSource, protocolSource, resourceSource] = await Promise.all([
  readFile(resolve(repositoryRoot, "src", "grain-preprocessing-worker.ts"), "utf8"),
  readFile(resolve(repositoryRoot, "src", "grain-preprocessing-client.ts"), "utf8"),
  readFile(resolve(repositoryRoot, "src", "grain-preprocessing-worker-protocol.ts"), "utf8"),
  readFile(resolve(repositoryRoot, "src", "engine-resource-setup.ts"), "utf8"),
]);
assert.match(workerSource, /preprocessGrainPng/);
assert.match(workerSource, /preprocessorPromise/);
assert.match(workerSource, /queue = queue\.then/);
assert.match(workerSource, /transfer: \[\.\.\.transfer\]/);
assert.match(clientSource, /GRAIN_PREPROCESSING_DEFAULT_IDLE_TERMINATION_MS = 15_000/);
assert.match(clientSource, /GRAIN_PREPROCESSING_DEFAULT_REQUEST_TIMEOUT_MS/);
assert.match(clientSource, /prepareInWorker/);
assert.match(clientSource, /enqueueFallback/);
assert.match(clientSource, /terminateIdleWorker/);
assert.match(protocolSource, /type: "prepare-scalar"/);
assert.match(protocolSource, /type: "prepare-png"/);
assert.match(protocolSource, /extends GrainPreprocessingResult/);
assert.match(resourceSource, /const grainPreprocessingClient = new GrainPreprocessingClient\(\)/);
assert.match(
  resourceSource,
  /kind: "scalar",[\s\S]*?scalar16: customAsset\.scalar16,[\s\S]*?sourceBitDepth: customAsset\.sourceBitDepth/,
);
assert.match(
  resourceSource,
  /kind: "png",[\s\S]*?pngBytes: source,[\s\S]*?invertLuminance: asset\.decode\.invertLuminance/,
);
assert.match(resourceSource, /const \{ width, height, scalar16 \} = prepared/);
assert.match(resourceSource, /prepared\.previewRgba\.buffer/);

// Exercise lazy construction, request timeout, Worker teardown, and exact
// main-thread fallback without depending on a browser Worker implementation.
globalThis.window ??= globalThis;
const { GrainPreprocessingClient } = await import(
  "../src/grain-preprocessing-client.ts"
);
let workerCreations = 0;
let workerTerminations = 0;
const silentWorker = {
  onmessage: null,
  onerror: null,
  onmessageerror: null,
  postMessage() {},
  terminate() {
    workerTerminations += 1;
  },
};
const client = new GrainPreprocessingClient({
  requestTimeoutMs: 1,
  idleTerminationMs: 0,
  workerFactory() {
    workerCreations += 1;
    return silentWorker;
  },
});
assert.equal(workerCreations, 0);
const fallback = await client.prepare({
  kind: "scalar",
  scalar16: new Uint16Array([0, 65535]),
  width: 2,
  height: 1,
});
assert.equal(workerCreations, 1);
assert.equal(workerTerminations, 1);
assert.equal(fallback.backend, "js");
assert.match(fallback.acceleratorFailure, /timed out/);
assert.deepEqual(fallback.previewRgba, new Uint8Array([
  0, 0, 0, 255,
  255, 255, 255, 255,
]));
client.dispose();

console.log(
  "Grain preprocessing worker verified: exact Wasm/JavaScript scalar parity, "
  + "post-inversion custom identity, encoded PNG identity, Worker-side PNG decode, "
  + "full-resolution preview bytes, typed transfers, serialized jobs, fallback, "
  + "timeouts, and 15-second idle termination.",
);
