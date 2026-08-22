import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_MANIFEST_MAGIC,
  PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_TILE_GRID_SIZE,
  ProjectStorage,
  ProjectStorageValidationError,
  checkProjectStorageCapacity,
  estimateProjectSaveBytes,
  normalizeProjectTitle,
  validateLoadedProject,
  validateProjectSaveRequest,
} from "../src/project-storage.ts";
import {
  decodeFloat16,
  rgba8UnormToRgba16FloatBytes,
} from "../src/float16.ts";

const VERSION = PROJECT_DOCUMENT_SCHEMA_VERSION;

function projectRequest(
  name = "  First\nArtwork  ",
  width = 1081,
  height = 1919,
) {
  const tileWidth = Math.ceil(width / PROJECT_STORAGE_TILE_GRID_SIZE);
  const tileHeight = Math.ceil(height / PROJECT_STORAGE_TILE_GRID_SIZE);
  const tileBytes = tileWidth * tileHeight * 8;
  const storageTileMask = new Uint32Array(8);
  storageTileMask[0] = 1;
  const bytes = new ArrayBuffer(tileBytes);
  new Uint8Array(bytes)[0] = 7;
  const descriptor = {
    schemaVersion: VERSION,
    chunkIndex: 0,
    firstTileOffset: 0,
    tileCount: 1,
    storage: "raw",
    rawBytes: tileBytes,
    storedBytes: tileBytes,
    sourceHash: 0x1234_5678,
  };
  return {
    request: {
      schemaVersion: VERSION,
      name,
      thumbnail: new Blob([Uint8Array.of(137, 80, 78, 71)], { type: "image/png" }),
      snapshot: {
        schemaVersion: VERSION,
        document: {
          schemaVersion: VERSION,
          width,
          height,
          layerFormat: "rgba16float",
          tileGridSize: PROJECT_STORAGE_TILE_GRID_SIZE,
          colorSpace: "linear-premultiplied",
        },
        layers: [{
          schemaVersion: VERSION,
          id: 1,
          name: "Layer 1",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          clippingParentId: null,
          contentBounds: {
            x: 0,
            y: 0,
            width: Math.min(128, width),
            height: Math.min(128, height),
          },
          storageTileMask,
          hasContent: true,
          noiseMipSmoothing: false,
          strokeStyle: {
            enabled: false,
            width: 14,
            position: "outside",
            color: [1, 0.5, 0.25, 1],
          },
          bevelStyle: { enabled: false },
          outerShadowStyle: { enabled: false },
          innerShadowStyle: { enabled: false },
          colorOverlayStyle: { enabled: false, color: [0, 0, 0], opacity: 100 },
          pixels: {
            schemaVersion: VERSION,
            format: "rgba16float",
            tileIndices: [0],
            chunks: [descriptor],
            rawBytes: tileBytes,
            storedBytes: tileBytes,
            sourceHash: 0x1234_5678,
            generation: 3,
          },
        }],
        activeRasterLayerId: 1,
        referenceRasterLayerId: null,
        mixedScene: {
          schemaVersion: VERSION,
          items: [
            { key: "raster:1", kind: "raster", rasterLayerId: 1 },
            { key: "svg:1", kind: "svg", svgNodeId: 1 },
          ],
          textNodes: [],
          svgNodes: [{
            id: 1,
            kind: "svg",
            name: "Typed SVG",
            visible: true,
            opacity: 1,
            document: {
              paints: [],
              paths: [{
                commands: new Uint8Array([1, 2, 3]),
                coordinates: new Float32Array([0, 0, 64, 64]),
              }],
            },
            paintColors: [],
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
          }],
          imageNodes: [],
          selectedKey: "raster:1",
          nextTextNodeId: 1,
          nextSvgNodeId: 2,
          nextImageNodeId: 1,
        },
        view: {
          schemaVersion: VERSION,
          centerX: width / 2,
          centerY: height / 2,
          zoom: 1,
          rotationRadians: 0,
        },
        background: {
          schemaVersion: VERSION,
          visible: true,
          color: "#2a4c6e",
        },
        brushSettings: { color: "#ff5b35", size: 32 },
      },
      chunks: [{
        schemaVersion: VERSION,
        layerId: 1,
        chunkIndex: 0,
        storage: "raw",
        rawBytes: tileBytes,
        storedBytes: tileBytes,
        sourceHash: 0x1234_5678,
        bytes,
      }],
    },
    bytes,
    tileBytes,
  };
}

assert.equal(normalizeProjectTitle("  Alpha\n  Beta  "), "Alpha Beta");
assert.equal(normalizeProjectTitle("\n\t"), "Untitled Artwork");

const { request, bytes, tileBytes } = projectRequest();
validateProjectSaveRequest(request);
const legacyBackgroundProject = structuredClone(request);
delete legacyBackgroundProject.snapshot.background;
validateProjectSaveRequest(legacyBackgroundProject);
const invalidBackgroundColor = structuredClone(request);
invalidBackgroundColor.snapshot.background.color = "#fff";
assert.throws(
  () => validateProjectSaveRequest(invalidBackgroundColor),
  ProjectStorageValidationError,
  "the optional document background must use a six-digit hex color",
);
const invalidBackgroundVisibility = structuredClone(request);
invalidBackgroundVisibility.snapshot.background.visible = "true";
assert.throws(
  () => validateProjectSaveRequest(invalidBackgroundVisibility),
  ProjectStorageValidationError,
  "the optional document background visibility must remain boolean",
);
assert.equal(estimateProjectSaveBytes(request), tileBytes + 4);
const uniformAlphaProject = projectRequest("Uniform alpha overlay");
uniformAlphaProject.request.snapshot.layers[0].colorOverlayStyle.uniformAlpha = true;
validateProjectSaveRequest(uniformAlphaProject.request);
const invalidUniformAlphaProject = structuredClone(uniformAlphaProject.request);
invalidUniformAlphaProject.snapshot.layers[0].colorOverlayStyle.uniformAlpha = "true";
assert.throws(
  () => validateProjectSaveRequest(invalidUniformAlphaProject),
  ProjectStorageValidationError,
  "uniformAlpha must be boolean when present",
);

const immutableMasterBytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const sourceBacked = projectRequest("Source-backed raster");
sourceBacked.request.snapshot.layers[0].rasterSource = {
  schemaVersion: VERSION,
  assetId: "raster-layer-source-1",
  sourceName: "mockup.png",
  mimeType: "image/png",
  sourceBytes: immutableMasterBytes.byteLength,
  width: 800,
  height: 600,
  x: 540.5,
  y: 959.5,
  scale: 0.75,
  rotation: 0.125,
  blob: new Blob([immutableMasterBytes], { type: "image/png" }),
};
validateProjectSaveRequest(sourceBacked.request);
assert.equal(
  estimateProjectSaveBytes(sourceBacked.request),
  sourceBacked.tileBytes + 4 + immutableMasterBytes.byteLength,
  "the encoded immutable master must be included in storage accounting",
);
const invalidRasterSource = structuredClone(sourceBacked.request);
invalidRasterSource.snapshot.layers[0].rasterSource.sourceBytes += 1;
assert.throws(
  () => validateProjectSaveRequest(invalidRasterSource),
  ProjectStorageValidationError,
  "source metadata cannot claim a byte size different from its Blob",
);

// V1 readers must continue accepting legacy RGBA8 projects. Restore migrates
// their normalized linear-premultiplied channels to the permanent RGBA16F
// document format; the original stored generation remains untouched.
const legacy = projectRequest("Legacy RGBA8");
const legacyTileBytes = legacy.tileBytes / 2;
legacy.request.snapshot.document.layerFormat = "rgba8unorm";
legacy.request.snapshot.layers[0].pixels.format = "rgba8unorm";
legacy.request.snapshot.layers[0].pixels.rawBytes = legacyTileBytes;
legacy.request.snapshot.layers[0].pixels.storedBytes = legacyTileBytes;
legacy.request.snapshot.layers[0].pixels.chunks[0].rawBytes = legacyTileBytes;
legacy.request.snapshot.layers[0].pixels.chunks[0].storedBytes = legacyTileBytes;
legacy.request.chunks[0].rawBytes = legacyTileBytes;
legacy.request.chunks[0].storedBytes = legacyTileBytes;
legacy.request.chunks[0].bytes = new ArrayBuffer(legacyTileBytes);
validateProjectSaveRequest(legacy.request);

const legacyPixel = Uint8Array.of(0, 127, 255, 64);
const migratedPixel = rgba8UnormToRgba16FloatBytes(legacyPixel);
assert.equal(migratedPixel.byteLength, 8);
const migratedView = new DataView(
  migratedPixel.buffer,
  migratedPixel.byteOffset,
  migratedPixel.byteLength,
);
for (let channel = 0; channel < legacyPixel.length; channel += 1) {
  const restored = decodeFloat16(migratedView.getUint16(channel * 2, true));
  assert.ok(
    Math.abs(restored - legacyPixel[channel] / 255) <= 1 / 2048,
    "legacy RGBA8 channel " + channel + " must retain its normalized value",
  );
}

// Independent, non-divisible dimensions use ceil(width / 16) × ceil(height / 16)
// normalized tile slots, while exact legacy 4096² documents remain loadable.
assert.equal(request.snapshot.document.width, 1081);
assert.equal(request.snapshot.document.height, 1919);
validateProjectSaveRequest(projectRequest(
  "Maximum custom canvas",
  PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION - 1,
).request);
validateProjectSaveRequest(projectRequest(
  "Minimum custom canvas",
  PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION,
).request);
validateProjectSaveRequest(projectRequest(
  "Legacy canvas",
  PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION,
).request);
assert.throws(
  () => validateProjectSaveRequest(projectRequest(
    "Too small",
    PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION - 1,
    1000,
  ).request),
  ProjectStorageValidationError,
);
assert.throws(
  () => validateProjectSaveRequest(projectRequest(
    "Too wide",
    PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION + 1,
    1000,
  ).request),
  ProjectStorageValidationError,
);
assert.throws(
  () => validateProjectSaveRequest(projectRequest(
    "Unsupported legacy rectangle",
    PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION,
    2048,
  ).request),
  ProjectStorageValidationError,
);

const databaseName = `m1m4-project-storage-verify-${Date.now()}`;
const storage = new ProjectStorage({ databaseName, forceMemory: true });
await storage.initialize();
assert.equal(storage.backend, "memory");

const first = await storage.saveProject(request);
assert.equal(first.name, "First Artwork");
assert.equal(first.storedBytes, tileBytes + 4);
assert.equal(first.documentWidth, 1081);
assert.equal(first.documentHeight, 1919);
assert.match(first.id, /^project-/);
assert.match(first.headGenerationId, /^generation-/);

// The save path copies instead of transferring/detaching engine-owned bytes.
assert.equal(bytes.byteLength, tileBytes);
new Uint8Array(bytes)[0] = 99;
const loadedFirst = await storage.loadProject(first.id);
assert.ok(loadedFirst);
validateLoadedProject(loadedFirst);
assert.equal(new Uint8Array(loadedFirst.chunks[0].bytes)[0], 7);
assert.equal(loadedFirst.manifest.magic, PROJECT_MANIFEST_MAGIC);
assert.deepEqual(loadedFirst.manifest.snapshot.background, {
  schemaVersion: VERSION,
  visible: true,
  color: "#2a4c6e",
});
assert.ok(loadedFirst.manifest.snapshot.layers[0].storageTileMask instanceof Uint32Array);
const svgPath = loadedFirst.manifest.snapshot.mixedScene.svgNodes[0].document.paths[0];
assert.ok(svgPath.commands instanceof Uint8Array);
assert.ok(svgPath.coordinates instanceof Float32Array);

// Returned snapshots are defensive clones, not aliases into the cache.
loadedFirst.manifest.snapshot.layers[0].storageTileMask[0] = 0;
new Uint8Array(loadedFirst.chunks[0].bytes)[0] = 44;
const loadedAgain = await storage.loadProject(first.id);
assert.ok(loadedAgain);
assert.equal(loadedAgain.manifest.snapshot.layers[0].storageTileMask[0], 1);
assert.equal(new Uint8Array(loadedAgain.chunks[0].bytes)[0], 7);

const listed = await storage.listProjects();
assert.equal(listed.length, 1);
assert.equal(listed[0].id, first.id);

const renamed = await storage.renameProject(first.id, "  Renamed   Artwork ");
assert.equal(renamed.name, "Renamed Artwork");
const afterRename = await storage.loadProject(first.id);
assert.equal(afterRename?.manifest.projectName, "Renamed Artwork");

// A second instance sees the same page-session fallback cache.
const secondInstance = new ProjectStorage({ databaseName, forceMemory: true });
assert.equal((await secondInstance.listProjects()).length, 1);

const next = projectRequest("Second Generation").request;
const secondHead = await storage.saveProject({ ...next, projectId: first.id, thumbnail: undefined });
assert.notEqual(secondHead.headGenerationId, first.headGenerationId);
assert.equal((await storage.loadProject(first.id))?.summary.headGenerationId, secondHead.headGenerationId);

// Validation fails before staging and therefore cannot move the current head.
const invalid = structuredClone(next);
invalid.projectId = first.id;
invalid.chunks[0].storedBytes -= 1;
assert.throws(() => validateProjectSaveRequest(invalid), ProjectStorageValidationError);
await assert.rejects(storage.saveProject(invalid), ProjectStorageValidationError);
assert.equal((await storage.loadProject(first.id))?.summary.headGenerationId, secondHead.headGenerationId);

assert.deepEqual(
  checkProjectStorageCapacity(10, { availableBytes: 100, quotaBytes: 1_000 }),
  {
    requiredBytes: 10,
    availableBytes: 100,
    reserveBytes: 16 * 1024 * 1024,
    fits: false,
  },
);
assert.equal(
  checkProjectStorageCapacity(10, { availableBytes: null, quotaBytes: null }).fits,
  null,
);

assert.equal(await storage.deleteProject(first.id), true);
assert.equal(await storage.deleteProject(first.id), false);
assert.equal(await storage.loadProject(first.id), null);
assert.equal((await secondInstance.listProjects()).length, 0);

const sourceSummary = await storage.saveProject(sourceBacked.request);
assert.equal(
  sourceSummary.storedBytes,
  sourceBacked.tileBytes + 4 + immutableMasterBytes.byteLength,
);
const loadedSource = await storage.loadProject(sourceSummary.id);
assert.ok(loadedSource);
validateLoadedProject(loadedSource);
const loadedRasterSource = loadedSource.manifest.snapshot.layers[0].rasterSource;
assert.ok(loadedRasterSource?.blob instanceof Blob);
assert.deepEqual(
  [...new Uint8Array(await loadedRasterSource.blob.arrayBuffer())],
  [...immutableMasterBytes],
  "save/load must retain the exact encoded master bytes",
);
assert.deepEqual(
  [loadedRasterSource.x, loadedRasterSource.y, loadedRasterSource.scale, loadedRasterSource.rotation],
  [540.5, 959.5, 0.75, 0.125],
  "save/load must retain the cumulative transform matrix parameters",
);
assert.equal(await storage.deleteProject(sourceSummary.id), true);

const source = readFileSync(new URL("../src/project-storage.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(
  new URL("../src/engine-project-runtime.ts", import.meta.url),
  "utf8",
);
const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const historyRuntimeSource = readFileSync(
  new URL("../src/engine-history-runtime.ts", import.meta.url),
  "utf8",
);
const stagePosition = source.indexOf("await this.writeStagedGeneration(generation)");
const headPosition = source.indexOf("await this.commitProjectHead(generation.summary");
assert.ok(stagePosition >= 0 && headPosition > stagePosition,
  "the durable generation must commit before switching the project head");
assert.match(source, /bytes:\s*chunk\.bytes\.slice\(0\)/,
  "engine-owned ArrayBuffers must be copied, never transferred");
assert.doesNotMatch(source, /JSON\.(?:parse|stringify)/,
  "project DTOs need structured clone so typed arrays and ArrayBuffers survive");
assert.doesNotMatch(source, /GPU(?:Texture|Buffer|Device|Queue|CommandEncoder)/,
  "the storage layer must stay independent of WebGPU objects");
assert.match(
  runtimeSource,
  /storageTileMask: pixels\s*\? projectStorageMaskForTileIndices\(pixels\.tileIndices\)/,
  "saved layer masks must exactly describe the conservative compressed tile payload",
);
assert.match(
  runtimeSource,
  /mask\[tileIndex >>> 5\] \|= \(1 << \(tileIndex & 31\)\) >>> 0/,
  "project capture must rebuild every persisted tile bit, including tile 255",
);
const semanticResourcesPosition = runtimeSource.indexOf(
  "engine.ensureOptionalEditorResources()",
);
const semanticRestorePosition = runtimeSource.indexOf(
  "engine.mixedSceneStack?.restoreState(snapshot.mixedScene)",
);
assert.ok(
  semanticResourcesPosition >= 0 && semanticResourcesPosition < semanticRestorePosition,
  "semantic GPU layouts must exist before a restored vector scene can schedule its first frame",
);
assert.match(
  runtimeSource,
  /for \(const chunk of persisted\.chunks\)[\s\S]*?rgba8UnormToRgba16FloatBytes\(restored\)/,
  "legacy RGBA8 restore must migrate one persisted chunk at a time",
);
assert.match(runtimeSource, /sourceResource\.sourceBlob/);
assert.match(runtimeSource, /installRasterLayerSourceResource\(/);
assert.match(
  runtimeSource,
  /background: \{\s*schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,\s*\.\.\.engine\.documentBackground,\s*\}/,
  "project capture must persist the structural background",
);
assert.match(
  runtimeSource,
  /snapshot\.background \?\? \{ visible: false, color: "#ffffff" \}/,
  "legacy V1 projects without a background must retain transparent checker presentation",
);
assert.match(
  runtimeSource,
  /colorOverlayStyle: normalizeRasterColorOverlayStyle\(layer\.colorOverlayStyle\)/,
  "restore must default uniformAlpha for projects written before the field existed",
);
const restoreStart = runtimeSource.indexOf("export async function restoreProjectDocument(");
assert.notEqual(restoreStart, -1);
const restoreBody = runtimeSource.slice(restoreStart);
assert.match(
  restoreBody,
  /const restoredHistoryBaselines = new Map<number, RestoredProjectHistoryBaseline>\(\)/,
  "restore must build a baseline for every saved raster layer",
);
assert.match(
  restoreBody,
  /restoredHistoryBaselines\.set\(layer\.id, \{[\s\S]*?compressed: gpu\.compressed,[\s\S]*?baseBounds:[\s\S]*?baseTileMask: record\.storageTileMask\.slice\(\)/,
  "the cursor-zero baseline must share the immutable saved payload and clone its metadata",
);
const activatePosition = restoreBody.indexOf(
  'engine.activateLayer(engine.layerStack.activeIndex, "layer-switch")',
);
const baselineInstallPosition = restoreBody.indexOf(
  "engine.installRestoredProjectHistoryBaselines(restoredHistoryBaselines)",
);
assert.ok(
  activatePosition >= 0 && baselineInstallPosition > activatePosition,
  "the non-undoable baseline is installed only after saved pixels are activated successfully",
);
assert.doesNotMatch(
  restoreBody.slice(0, baselineInstallPosition),
  /createLayerColdStorageCandidate\(/,
  "project restore must not allocate a full-size GPU checkpoint just to seed Undo",
);
assert.match(
  brushEngineSource,
  /installRestoredProjectHistoryBaselines\([\s\S]*?historyActions\.length !== 0 \|\| this\.historyCursor !== 0/,
  "saved baselines may only be installed into a reset journal",
);
assert.match(
  brushEngineSource,
  /resetHistoryState\(\): void \{[\s\S]*?this\.history\.reset\(\);\s*this\.restoredProjectHistoryBaselines\.clear\(\)/,
  "starting another history session must release every saved baseline",
);
assert.match(
  historyRuntimeSource,
  /sessionBaseline\?\.compressed[\s\S]*?uploadCompressedLayerIntoHot\(/,
  "cursor-zero replay must hydrate the saved compressed pixels into the active hot texture",
);
assert.match(
  historyRuntimeSource,
  /hasVisibleHistoryContent[\s\S]*?restoredProjectBaselineApplies\(/,
  "Clear must recognize loaded raster content even before the first journal action",
);

storage.close();
secondInstance.close();
console.log("Project storage verification passed.");
