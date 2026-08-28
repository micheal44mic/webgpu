import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RGBA16_FLOAT_BYTES_PER_PIXEL,
  encodeFloat16,
  rgba16FloatRowsToRgba8Unorm,
} from "../src/float16.ts";

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
  // Il cold compresso non fissa piu' un formato: segue quello del documento,
  // quindi l'ultimo letterale RGBA8 di questo file e' sparito.
  // Anche il tipo del cold compresso segue ora LayerFormat: nessun letterale.
  ["src/engine-raster-image-runtime.ts", { "rgba8unorm-srgb": 1 }],
  // Shape and Grain source staging is native scalar R16Uint; placeholders,
  // resident bases, and complete mip chains are R16F in both comparison modes.
  // Descriptor serializzato: registra il formato originale del seed History,
  // non alloca né converte una texture continua a 8 bit.
  ["src/history-storage-core.ts", { rgba8unorm: 1 }],
  ["src/layer-blend-tile-compositor.ts", { rgba8unorm: 1 }],
  ["src/layer-thumbnail-renderer.ts", { rgba8unorm: 2 }],
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

// La catena mip della grana era l'ultimo percorso continuo a passare per un
// target a 8 bit: ora e' R16F dal primo livello all'ultimo, quindi l'eccezione
// non serve piu'. Resta solo la miniatura, che e' un output di interfaccia.
const allowedEightBitRenderTargets = new Map([
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
  "src/brush-engine.ts",
  /this\.canvasFormat\s*=\s*"rgba16float";[\s\S]*?this\.context\.configure\(\{[\s\S]*?format:\s*this\.canvasFormat,[\s\S]*?alphaMode:\s*"opaque",[\s\S]*?colorSpace:\s*"srgb"/,
  "Canvas e presentation cache devono condividere il target RGBA16F esplicito.",
);
assert.doesNotMatch(
  sources.get("src/brush-engine.ts"),
  /navigator\.gpu\.getPreferredCanvasFormat\(\)/,
  "Il canvas principale non deve ricadere implicitamente in un formato 8-bit.",
);
assert.equal(
  (sources.get("src/brush-engine.ts").match(/rgba16FloatRowsToRgba8Unorm\(/g) ?? []).length,
  3,
  "Miniatura, rectangle probe e pixel probe devono decodificare il readback RGBA16F.",
);
assert.doesNotMatch(
  sources.get("src/brush-engine.ts"),
  /canvasFormat\.startsWith\("bgra"\)/,
  "I confini di readback non devono conservare assunzioni BGRA8.",
);
requireSource(
  "src/brush-stroke-preview-renderer.ts",
  /width\s*\*\s*RGBA16_FLOAT_BYTES_PER_PIXEL/,
  "Il readback diagnostico delle preview deve usare otto byte per texel RGBA16F.",
);
requireSource(
  "src/brush-library-preview.ts",
  /BRUSH_LIBRARY_PREVIEW_WIDTH[\s\S]*?BRUSH_LIBRARY_PREVIEW_HEIGHT[\s\S]*?RGBA16_FLOAT_BYTES_PER_PIXEL/,
  "Il budget delle preview deve contabilizzare il backing RGBA16F.",
);
requireSource(
  "src/engine-reports.ts",
  /presentationCacheWidth[\s\S]*?presentationCacheHeight[\s\S]*?RGBA16_FLOAT_BYTES_PER_PIXEL/,
  "La memoria della presentation cache deve contabilizzare RGBA16F.",
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
  "src/engine-resource-setup.ts",
  /createR16FloatShapeTexture[\s\S]*format:\s*"r16float"[\s\S]*GPUTextureUsage\.RENDER_ATTACHMENT/,
  "La Shape high-precision deve costruire e mantenere la catena mip in R16F.",
);
requireSource(
  "src/engine-raster-image-runtime.ts",
  /format:\s*"rgba8unorm-srgb"[\s\S]*format:\s*"rgba16float"/,
  "L’import deve passare dalla sorgente decoder RGBA8-sRGB ai mip lineari RGBA16F.",
);

assert.equal(RGBA16_FLOAT_BYTES_PER_PIXEL, 8);
const paddedBytesPerRow = 256;
const float16Rows = new Uint8Array(paddedBytesPerRow * 2).fill(0xa5);
const float16View = new DataView(float16Rows.buffer);
const writePixel = (row, column, channels) => {
  const offset = row * paddedBytesPerRow
    + column * RGBA16_FLOAT_BYTES_PER_PIXEL;
  channels.forEach((channel, index) => {
    float16View.setUint16(offset + index * 2, encodeFloat16(channel), true);
  });
};
writePixel(0, 0, [0, 0.5, 1, 1]);
writePixel(0, 1, [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]);
writePixel(1, 0, [0.25, 0.75, 0.125, 0]);
writePixel(1, 1, [1, 0, 0.5, 1]);
assert.deepEqual(
  [...rgba16FloatRowsToRgba8Unorm(float16Rows, 2, 2, paddedBytesPerRow)],
  [
    0, 128, 255, 255,
    0, 255, 0, 255,
    64, 191, 32, 0,
    255, 0, 128, 255,
  ],
  "Il confine RGBA8 deve decodificare half-float, ignorare il padding e saturare in modo deterministico.",
);
assert.throws(
  () => rgba16FloatRowsToRgba8Unorm(float16Rows, 2, 2, 8),
  /row stride/,
);

console.log("High-precision format allowlist verification passed.");
