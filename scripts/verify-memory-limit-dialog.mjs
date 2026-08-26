import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const main = read("../src/main.ts");
const engine = read("../src/brush-engine.ts");
const types = read("../src/engine-types.ts");
const merge = read("../src/engine-layer-merge-runtime.ts");
const glass = read("../src/engine-glass-runtime.ts");
const liquify = read("../src/engine-liquify-runtime.ts");
const spatialBlur = read("../src/engine-spatial-blur-runtime.ts");

assert.doesNotMatch(html, /memoryLimitDialog|Memory limit warning|Proceed anyway/);
assert.doesNotMatch(main, /MemoryLimitDialogController|onMemoryAdmissionWarning/);
assert.doesNotMatch(types, /MemoryAdmissionWarning|onMemoryAdmissionWarning/);
assert.doesNotMatch(engine, /reserveMemoryWithAdmissionOverride|decision\.outcome|allocation remains blocked/);
assert.match(
  engine,
  /async reservePlannedMemory\(request: MemoryRequest\): Promise<MemoryReservation> \{\s*return this\.memoryReservations\.reserve\(request\);\s*\}/,
);
assert.match(engine, /await this\.reserveLayerDuplicateMemory\(source\)/);
assert.match(engine, /await this\.reserveLayerSwitchMemory\(index\)/);
assert.match(merge, /await reserveLayerMergeCreateMemory\(engine, memoryPlan\)/);
assert.match(merge, /await reserveLayerMergeHistoryMemory\(/);
assert.match(glass, /return engine\.reservePlannedMemory\(request\)/);
assert.match(liquify, /return engine\.reservePlannedMemory\(request\)/);
assert.match(spatialBlur, /return engine\.reservePlannedMemory\(request\)/);

console.log("Memory admission: operations remain accounted for and no preventive UI or refusal gate remains.");
