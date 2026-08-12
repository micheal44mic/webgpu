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
assert.equal(estimateProjectSaveBytes(request), tileBytes + 4);

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

const source = readFileSync(new URL("../src/project-storage.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(
  new URL("../src/engine-project-runtime.ts", import.meta.url),
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
const semanticResourcesPosition = runtimeSource.indexOf(
  "await engine.ensureOptionalEditorResources()",
);
const semanticRestorePosition = runtimeSource.indexOf(
  "engine.mixedSceneStack?.restoreState(snapshot.mixedScene)",
);
assert.ok(
  semanticResourcesPosition >= 0 && semanticResourcesPosition < semanticRestorePosition,
  "semantic GPU layouts must exist before a restored vector scene can schedule its first frame",
);

storage.close();
secondInstance.close();
console.log("Project storage verification passed.");
