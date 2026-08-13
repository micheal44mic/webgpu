import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = resolve(root, "dist-labs");

function outputFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? outputFiles(absolute) : [absolute];
  });
}

const files = outputFiles(outputRoot);
const relativeFiles = files.map((file) => relative(outputRoot, file).replaceAll("\\", "/"));
assert.ok(relativeFiles.includes("labs.html"), "Build Labs senza labs.html.");
assert.ok(!relativeFiles.includes("index.html"), "L'entry editor non deve duplicarsi nel build Labs.");
assert.ok(relativeFiles.some((file) => /^assets\/main-.*\.js$/.test(file)));
assert.ok(relativeFiles.some((file) => /^assets\/main-.*\.css$/.test(file)));
assert.ok(relativeFiles.some((file) => /^assets\/labs-.*\.js$/.test(file)));
assert.ok(relativeFiles.some((file) => /^assets\/labs-.*\.css$/.test(file)));

const requiredChunkFamilies = [
  "engine-lab-operations-",
  "iphone-memory-limit-test-",
  "layer-history-gpu-test-",
  "layer-memory-stress-test-",
  "layer-merge-gpu-test-",
  "mixed-memory-benchmark-",
  "shadow-golden-",
  "stroke-golden-",
  "vector-zoom-labs-",
];
for (const family of requiredChunkFamilies) {
  assert.ok(
    relativeFiles.some((file) => file.includes(family)),
    `Famiglia di chunk Labs assente: ${family}`,
  );
}
for (const sharedAsset of [
  "BebasNeue-Regular-",
  "Grainpencil-",
  "Poppins-Regular-",
  "Shape-",
  "Shapepencil-",
]) {
  assert.ok(
    relativeFiles.some((file) => file.includes(sharedAsset)),
    `Asset editor condiviso assente dal bundle Labs: ${sharedAsset}`,
  );
}

const labsHtml = readFileSync(resolve(outputRoot, "labs.html"), "utf8");
assert.match(labsHtml, /<title>WebGPU Brush Engine Labs<\/title>/);
assert.match(labsHtml, /id="projectHome"/);
assert.match(labsHtml, /id="gpuCanvas"/);
const text = files
  .filter((file) => /\.(?:css|html|js|json|map)$/.test(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
assert.match(text, /Laboratorio sconosciuto:/, "Il dispatcher Labs non e presente nel bundle.");
assert.match(text, /runLayerHistoryGpuTest/, "L'harness GPU History non e raggiungibile.");

assert.ok(
  relativeFiles.length >= 35 && relativeFiles.length <= 50,
  `Topologia Labs inattesa: ${relativeFiles.length} file (baseline 43).`,
);

console.log(`Bundle Labs verificato: ${relativeFiles.length} file, entry e harness separati.`);
