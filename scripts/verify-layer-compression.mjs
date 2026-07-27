import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_COMPRESSION_CHUNK_TILE_COUNT,
  LAYER_COMPRESSION_CODEC,
  LAYER_COMPRESSION_STUDY_BUILD,
  LAYER_COMPRESSION_STUDY_VERSION,
  combineCompressionHashes,
  formatCompressionHash,
  measureLosslessGzipChunk,
} from "../src/layer-compression-study.ts";

assert.equal(LAYER_COMPRESSION_STUDY_VERSION, 1);
assert.equal(
  LAYER_COMPRESSION_STUDY_BUILD,
  "lossless-gzip-256-tile-1mib-streamed-measurement-v1",
);
assert.equal(LAYER_COMPRESSION_CODEC, "compression-stream-gzip");
assert.equal(LAYER_COMPRESSION_CHUNK_TILE_COUNT, 4);

const tinyTileBytes = 16;
const classified = new Uint8Array(tinyTileBytes * 2);
for (let offset = tinyTileBytes; offset < classified.length; offset += 4) {
  classified[offset] = 12;
  classified[offset + 1] = 34;
  classified[offset + 2] = 56;
  classified[offset + 3] = 255;
}
const classifiedMeasurement = await measureLosslessGzipChunk(
  classified,
  tinyTileBytes,
);
assert.equal(classifiedMeasurement.byteIdentical, true);
assert.equal(classifiedMeasurement.zeroTileCount, 1);
assert.equal(classifiedMeasurement.solidTileCount, 2);
assert.equal(classifiedMeasurement.sourceHash, classifiedMeasurement.restoredHash);
assert.ok(classifiedMeasurement.adaptiveStoredBytes <= classified.byteLength);

const realTileBytes = 256 * 256 * 4;
const zeros = new Uint8Array(realTileBytes);
const zeroMeasurement = await measureLosslessGzipChunk(zeros, realTileBytes);
assert.equal(zeroMeasurement.zeroTileCount, 1);
assert.equal(zeroMeasurement.solidTileCount, 1);
assert.equal(zeroMeasurement.usedRawFallback, false);
assert.ok(zeroMeasurement.gzipBytes < 1024);

const noisy = new Uint8Array(realTileBytes);
let state = 0x12345678;
for (let index = 0; index < noisy.length; index += 1) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  noisy[index] = state & 0xff;
}
const noisyMeasurement = await measureLosslessGzipChunk(noisy, realTileBytes);
assert.equal(noisyMeasurement.byteIdentical, true);
assert.ok(noisyMeasurement.adaptiveStoredBytes <= noisy.byteLength);

const combinedSource = combineCompressionHashes(
  0x811c9dc5,
  classifiedMeasurement.sourceHash,
  classifiedMeasurement.rawBytes,
);
const combinedRestored = combineCompressionHashes(
  0x811c9dc5,
  classifiedMeasurement.restoredHash,
  classifiedMeasurement.rawBytes,
);
assert.equal(combinedSource, combinedRestored);
assert.match(formatCompressionHash(combinedSource), /^[0-9a-f]{8}$/);

const engineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sitesSource = readFileSync(
  new URL("../scripts/prepare-sites-build.mjs", import.meta.url),
  "utf8",
);

const schemaSource = readFileSync(
  new URL("../db/schema.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../.openai/drizzle/0004_layer_compression_runs.sql", import.meta.url),
  "utf8",
);

assert.match(engineSource, /layerCompressionTestEnabled\?: boolean/);
assert.match(engineSource, /async measureLayerColdCompressionStudy\(/);
assert.match(engineSource, /readLayerColdStorageTiles\(/);
assert.match(engineSource, /depthOrArrayLayers: arrayLayerCount/);
assert.match(engineSource, /temporaryReadbackPeakMiB/);
const studyStart = engineSource.indexOf("async measureLayerColdCompressionStudy(");
const studyEnd = engineSource.indexOf("getLayerBakeState(", studyStart);
assert.ok(studyStart >= 0 && studyEnd > studyStart);
const studyBody = engineSource.slice(studyStart, studyEnd);
assert.doesNotMatch(studyBody, /destroyLayerColdStorage/);
assert.match(studyBody, /countedGpuMiBAfter - countedGpuMiBBefore/);
assert.match(studyBody, /measureLosslessGzipChunk/);

assert.match(mainSource, /pageSearchParams\.get\("layerCompressionTest"\) === "1"/);
assert.match(mainSource, /await engine\.measureLayerColdCompressionStudy/);
assert.match(mainSource, /saveLayerCompressionRun\(report\)/);
assert.match(indexSource, /id="runLayerCompressionStudy"/);
assert.match(sitesSource, /\/api\/layer-compression-runs/);
assert.match(sitesSource, /layer_compression_runs/);
assert.match(sitesSource, new RegExp(LAYER_COMPRESSION_STUDY_BUILD));
assert.match(schemaSource, /layerCompressionRunsSchemaSql/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS layer_compression_runs/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS layer_compression_runs/);
assert.match(migrationSource, /layer_compression_runs_created_at_idx/);

console.log(JSON.stringify({
  passed: true,
  version: LAYER_COMPRESSION_STUDY_VERSION,
  build: LAYER_COMPRESSION_STUDY_BUILD,
  zeroTileGzipBytes: zeroMeasurement.gzipBytes,
  noisyTileGzipBytes: noisyMeasurement.gzipBytes,
  noisyUsesRawFallback: noisyMeasurement.usedRawFallback,
}, null, 2));
