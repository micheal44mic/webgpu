import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDirectory, "..");
const sourceRoot = resolve(projectRoot, "src");

const sourceFiles = [];
const visit = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) visit(path);
    else if (/\.(?:ts|js)$/.test(name)) sourceFiles.push(path);
  }
};
visit(sourceRoot);

const normalizedPath = (path) => relative(projectRoot, path).replaceAll("\\", "/");
const sources = new Map(sourceFiles.map((path) => [
  normalizedPath(path),
  readFileSync(path, "utf8"),
]));

// Every remaining literal 8-bit texture format is a deliberate input,
// presentation surface, binary/source mask, or the disabled legacy cold codec.
// Exact counts make this an allowlist: a new continuous R8/RGBA8 allocation
// cannot hide merely by landing in a file that already contains an exception.
const allowedLiteralFormats = new Map([
  ["src/engine-cold-storage.ts", { rgba8unorm: 1 }],
  ["src/engine-layer-resources.ts", { rgba8unorm: 1 }],
  ["src/engine-raster-image-runtime.ts", { "rgba8unorm-srgb": 1 }],
  ["src/engine-resource-setup.ts", { rgba8unorm: 3, r8unorm: 2 }],
  ["src/layer-blend-tile-compositor.ts", { rgba8unorm: 1 }],
  ["src/layer-thumbnail-renderer.ts", { rgba8unorm: 2 }],
  ["src/stroke-renderer.ts", { rgba8unorm: 1 }],
]);
const actualLiteralFormats = new Map();
const literalFormatPattern = /format:\s*"(rgba8unorm(?:-srgb)?|r8unorm)"/g;
for (const [path, source] of sources) {
  for (const match of source.matchAll(literalFormatPattern)) {
    const format = match[1];
    const formats = actualLiteralFormats.get(path) ?? {};
    formats[format] = (formats[format] ?? 0) + 1;
    actualLiteralFormats.set(path, formats);
  }
}
assert.deepEqual(
  Object.fromEntries([...actualLiteralFormats].sort()),
  Object.fromEntries([...allowedLiteralFormats].sort()),
  "È comparso (o è cambiato) un formato letterale RGBA8/R8: classificarlo esplicitamente prima di accettarlo.",
);

const allowedEightBitRenderTargets = new Map([
  ["src/engine-resource-setup.ts", 1], // mip della sorgente Grain RGBA8
  ["src/layer-thumbnail-renderer.ts", 1], // miniatura UI finale
]);
const actualEightBitRenderTargets = new Map();
for (const [path, source] of sources) {
  const count = (source.match(/targets:\s*\[\{\s*format:\s*"(?:rgba8unorm(?:-srgb)?|r8unorm)"/g) ?? []).length;
  if (count > 0) actualEightBitRenderTargets.set(path, count);
}
assert.deepEqual(
  Object.fromEntries([...actualEightBitRenderTargets].sort()),
  Object.fromEntries([...allowedEightBitRenderTargets].sort()),
  "Target render 8-bit non autorizzato in un percorso continuo.",
);

const joinedSource = [...sources.values()].join("\n");
assert.doesNotMatch(joinedSource, /pack4x8unorm|unpack4x8unorm/);
assert.doesNotMatch(joinedSource, /r8-coverage|packed R8 (?:coverage|matte)|or-r8-separable/);

const requireSource = (path, pattern, message) => {
  const source = sources.get(path);
  assert.ok(source, `Sorgente mancante: ${path}`);
  assert.match(source, pattern, message);
};
requireSource(
  "src/brush-engine.ts",
  /layerFormat:\s*LayerFormat\s*=\s*"rgba16float"/,
  "Il default reale del documento deve essere RGBA16F.",
);
requireSource(
  "src/vector-text-gpu-shader.ts",
  /VECTOR_TEXT_GPU_TARGET_FORMAT[^=]*=\s*"rgba16float"[\s\S]*VECTOR_TEXT_GPU_BLUR_FORMAT[^=]*=\s*"r16float"/,
  "Cache colore vettoriali e matte blur devono essere RGBA16F/R16F.",
);
requireSource(
  "src/engine-strategies.ts",
  /"r16float-coverage"/,
  "Light Glaze deve conservare la coverage continua in R16F.",
);
requireSource(
  "src/engine-raster-image-runtime.ts",
  /format:\s*"rgba8unorm-srgb"[\s\S]*format:\s*"rgba16float"/,
  "L’import deve passare dalla sorgente decoder RGBA8-sRGB ai mip lineari RGBA16F.",
);

console.log("High-precision format allowlist verification passed.");
