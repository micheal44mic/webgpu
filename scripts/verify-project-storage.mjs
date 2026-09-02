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
const axisScaleProject = structuredClone(request);
Object.assign(axisScaleProject.snapshot.mixedScene.svgNodes[0], {
  scale: 1.25,
  scaleX: 1.25,
  scaleY: 0.6,
});
validateProjectSaveRequest(axisScaleProject);
const invalidAxisScaleProject = structuredClone(axisScaleProject);
invalidAxisScaleProject.snapshot.mixedScene.svgNodes[0].scaleY = 0;
assert.throws(
  () => validateProjectSaveRequest(invalidAxisScaleProject),
  ProjectStorageValidationError,
  "semantic axis scales must remain positive",
);
const clippedSceneProject = structuredClone(request);
clippedSceneProject.snapshot.mixedScene.clippingRelations = [{
  childKey: "svg:1",
  parentKey: "raster:1",
}];
validateProjectSaveRequest(clippedSceneProject);
assert.deepEqual(clippedSceneProject.snapshot.mixedScene.clippingRelations, [{
  childKey: "svg:1",
  parentKey: "raster:1",
}]);
const reverseClippedSceneProject = structuredClone(request);
reverseClippedSceneProject.snapshot.mixedScene.items.reverse();
reverseClippedSceneProject.snapshot.mixedScene.clippingRelations = [{
  childKey: "raster:1",
  parentKey: "svg:1",
}];
validateProjectSaveRequest(reverseClippedSceneProject);

const textNode = (id, name) => ({
  id,
  kind: "text",
  name,
  visible: true,
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
});
const addBlankRaster = (project, id, clippingParentId = null) => {
  const layer = structuredClone(project.snapshot.layers[0]);
  Object.assign(layer, {
    id,
    name: `Layer ${id}`,
    clippingParentId,
    contentBounds: null,
    storageTileMask: new Uint32Array(8),
    hasContent: false,
    pixels: null,
  });
  project.snapshot.layers.push(layer);
};

const mixedRasterBaseProject = structuredClone(request);
addBlankRaster(mixedRasterBaseProject, 2, 1);
Object.assign(mixedRasterBaseProject.snapshot.mixedScene, {
  items: [
    { key: "raster:1", kind: "raster", rasterLayerId: 1 },
    { key: "text:1", kind: "text", textNodeId: 1 },
    { key: "raster:2", kind: "raster", rasterLayerId: 2 },
    { key: "svg:1", kind: "svg", svgNodeId: 1 },
  ],
  textNodes: [textNode(1, "Text child")],
  clippingRelations: [
    { childKey: "text:1", parentKey: "raster:1" },
    { childKey: "raster:2", parentKey: "raster:1" },
  ],
  nextTextNodeId: 2,
});
validateProjectSaveRequest(mixedRasterBaseProject);

// Raster-only restore has a separate cold-start boundary from semantic scenes.
// When the saved active raster is a clipping child, rebuilding its live group
// immediately needs the shared viewport-segment layout even though every layer
// composition field remains at its default value.
const rasterOnlyActiveClippingChildProject = structuredClone(request);
addBlankRaster(rasterOnlyActiveClippingChildProject, 2, 1);
Object.assign(rasterOnlyActiveClippingChildProject.snapshot, {
  activeRasterLayerId: 2,
});
Object.assign(rasterOnlyActiveClippingChildProject.snapshot.mixedScene, {
  items: [
    { key: "raster:1", kind: "raster", rasterLayerId: 1 },
    { key: "raster:2", kind: "raster", rasterLayerId: 2 },
  ],
  textNodes: [],
  svgNodes: [],
  imageNodes: [],
  clippingRelations: [{ childKey: "raster:2", parentKey: "raster:1" }],
  selectedKey: "raster:2",
});
validateProjectSaveRequest(rasterOnlyActiveClippingChildProject);
assert.deepEqual(
  rasterOnlyActiveClippingChildProject.snapshot.layers.map((layer) => ({
    id: layer.id,
    blendMode: layer.blendMode,
    cutoutMode: layer.cutoutMode ?? "off",
    clippingParentId: layer.clippingParentId,
  })),
  [
    { id: 1, blendMode: "normal", cutoutMode: "off", clippingParentId: null },
    { id: 2, blendMode: "normal", cutoutMode: "off", clippingParentId: 1 },
  ],
  "the active-child restore fixture must not rely on advanced layer composition",
);

const mixedRasterBaseWithGap = structuredClone(mixedRasterBaseProject);
mixedRasterBaseWithGap.snapshot.mixedScene.clippingRelations = [{
  childKey: "raster:2",
  parentKey: "raster:1",
}];
assert.throws(
  () => validateProjectSaveRequest(mixedRasterBaseWithGap),
  /consecutive|clipping/i,
  "an unrelated text row must not split a clipping unit",
);

const textBaseProject = structuredClone(request);
addBlankRaster(textBaseProject, 2);
Object.assign(textBaseProject.snapshot.mixedScene, {
  items: [
    { key: "raster:1", kind: "raster", rasterLayerId: 1 },
    { key: "text:1", kind: "text", textNodeId: 1 },
    { key: "raster:2", kind: "raster", rasterLayerId: 2 },
    { key: "svg:1", kind: "svg", svgNodeId: 1 },
  ],
  textNodes: [textNode(1, "Text base")],
  clippingRelations: [{ childKey: "raster:2", parentKey: "text:1" }],
  nextTextNodeId: 2,
});
validateProjectSaveRequest(textBaseProject);

const textPairProject = structuredClone(request);
Object.assign(textPairProject.snapshot.mixedScene, {
  items: [
    { key: "raster:1", kind: "raster", rasterLayerId: 1 },
    { key: "text:1", kind: "text", textNodeId: 1 },
    { key: "text:2", kind: "text", textNodeId: 2 },
    { key: "svg:1", kind: "svg", svgNodeId: 1 },
  ],
  textNodes: [textNode(1, "Text base"), textNode(2, "Text child")],
  clippingRelations: [{ childKey: "text:2", parentKey: "text:1" }],
  nextTextNodeId: 3,
});
validateProjectSaveRequest(textPairProject);
const invalidClippingChainProject = structuredClone(clippedSceneProject);
invalidClippingChainProject.snapshot.mixedScene.clippingRelations.push({
  childKey: "raster:1",
  parentKey: "svg:1",
});
assert.throws(
  () => validateProjectSaveRequest(invalidClippingChainProject),
  /Clipping chains|clipping/i,
);
const dissolveProject = structuredClone(request);
dissolveProject.snapshot.layers[0].blendMode = "dissolve";
validateProjectSaveRequest(dissolveProject);
assert.equal(dissolveProject.snapshot.layers[0].blendMode, "dissolve");

const composedLayerProject = structuredClone(request);
Object.assign(composedLayerProject.snapshot.layers[0], {
  contentOpacity: 0.42,
  cutoutMode: "document",
  tonalBlend: {
    current: [12, 28, 224, 246],
    underlying: [4, 18, 210, 252],
  },
});
validateProjectSaveRequest(composedLayerProject);
assert.equal(composedLayerProject.snapshot.layers[0].contentOpacity, 0.42);
assert.equal(composedLayerProject.snapshot.layers[0].cutoutMode, "document");
assert.deepEqual(composedLayerProject.snapshot.layers[0].tonalBlend, {
  current: [12, 28, 224, 246],
  underlying: [4, 18, 210, 252],
});

const invalidLayerFillProject = structuredClone(composedLayerProject);
invalidLayerFillProject.snapshot.layers[0].contentOpacity = 1.1;
assert.throws(
  () => validateProjectSaveRequest(invalidLayerFillProject),
  ProjectStorageValidationError,
);

const invalidLayerCutoutProject = structuredClone(composedLayerProject);
invalidLayerCutoutProject.snapshot.layers[0].cutoutMode = "unsupported";
assert.throws(
  () => validateProjectSaveRequest(invalidLayerCutoutProject),
  ProjectStorageValidationError,
);

const invalidTonalRangeProject = structuredClone(composedLayerProject);
invalidTonalRangeProject.snapshot.layers[0].tonalBlend.current = [0, 80, 64, 255];
assert.throws(
  () => validateProjectSaveRequest(invalidTonalRangeProject),
  ProjectStorageValidationError,
);

const legacyShadeProject = structuredClone(request);
legacyShadeProject.snapshot.layers[0].blendMode = "shade";
validateProjectSaveRequest(legacyShadeProject);
assert.equal(
  legacyShadeProject.snapshot.layers[0].blendMode,
  "darken",
  "legacy provisional Shade must preserve its old Darken appearance",
);

const frozenCanonicalProject = structuredClone(request);
Object.freeze(frozenCanonicalProject.snapshot.layers[0]);
validateProjectSaveRequest(frozenCanonicalProject);
assert.equal(frozenCanonicalProject.snapshot.layers[0].blendMode, "normal");

const unsupportedBlendProject = structuredClone(request);
unsupportedBlendProject.snapshot.layers[0].blendMode = "random-mode";
assert.throws(
  () => validateProjectSaveRequest(unsupportedBlendProject),
  ProjectStorageValidationError,
);
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

// V1 readers must continue accepting legacy linear-premultiplied RGBA8 projects.
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

const encodedRgba8 = structuredClone(legacy.request);
encodedRgba8.name = "Encoded-sRGB RGBA8";
encodedRgba8.snapshot.document.colorSpace = "encoded-srgb-premultiplied";
validateProjectSaveRequest(encodedRgba8);

const invalidEncodedRgba16 = structuredClone(request);
invalidEncodedRgba16.snapshot.document.colorSpace = "encoded-srgb-premultiplied";
assert.throws(
  () => validateProjectSaveRequest(invalidEncodedRgba16),
  (error) => error instanceof ProjectStorageValidationError
    && /requires RGBA8 authoritative document pixels/.test(error.message),
  "encoded-sRGB premultiplied storage must be restricted to RGBA8 documents",
);

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

const encodedSummary = await storage.saveProject(encodedRgba8);
const loadedEncoded = await storage.loadProject(encodedSummary.id);
assert.ok(loadedEncoded);
validateLoadedProject(loadedEncoded);
assert.deepEqual(
  [
    loadedEncoded.manifest.snapshot.document.layerFormat,
    loadedEncoded.manifest.snapshot.document.colorSpace,
  ],
  ["rgba8unorm", "encoded-srgb-premultiplied"],
  "encoded-sRGB RGBA8 storage must survive a validated round trip",
);
assert.equal(await storage.deleteProject(encodedSummary.id), true);

const legacySummary = await storage.saveProject(legacy.request);
const loadedLegacy = await storage.loadProject(legacySummary.id);
assert.ok(loadedLegacy);
validateLoadedProject(loadedLegacy);
assert.deepEqual(
  [
    loadedLegacy.manifest.snapshot.document.layerFormat,
    loadedLegacy.manifest.snapshot.document.colorSpace,
  ],
  ["rgba8unorm", "linear-premultiplied"],
  "legacy linear RGBA8 storage must remain valid across a round trip",
);
assert.equal(await storage.deleteProject(legacySummary.id), true);

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

const axisScaleSummary = await storage.saveProject({
  ...axisScaleProject,
  name: "Axis Scale Round Trip",
});
const loadedAxisScale = await storage.loadProject(axisScaleSummary.id);
assert.ok(loadedAxisScale);
validateLoadedProject(loadedAxisScale);
assert.deepEqual(
  loadedAxisScale.manifest.snapshot.mixedScene.svgNodes.map((node) => [
    node.scale,
    node.scaleX,
    node.scaleY,
  ]),
  [[1.25, 1.25, 0.6]],
  "project persistence must retain independent semantic axes",
);
assert.equal(await storage.deleteProject(axisScaleSummary.id), true);

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

const mixedClippingSummary = await storage.saveProject({
  ...mixedRasterBaseProject,
  name: "Mixed Text Clipping",
});
const loadedMixedClipping = await storage.loadProject(mixedClippingSummary.id);
assert.ok(loadedMixedClipping);
validateLoadedProject(loadedMixedClipping);
assert.deepEqual(
  loadedMixedClipping.manifest.snapshot.mixedScene.items,
  mixedRasterBaseProject.snapshot.mixedScene.items,
);
assert.deepEqual(
  loadedMixedClipping.manifest.snapshot.mixedScene.clippingRelations,
  mixedRasterBaseProject.snapshot.mixedScene.clippingRelations,
);
assert.deepEqual(
  loadedMixedClipping.manifest.snapshot.layers.map((layer) => layer.clippingParentId),
  [null, 1],
  "save/load must retain the raster projection of a mixed clipping unit",
);
assert.equal(await storage.deleteProject(mixedClippingSummary.id), true);

const rasterClippingSummary = await storage.saveProject({
  ...rasterOnlyActiveClippingChildProject,
  name: "Raster Clipping Active Child",
});
const loadedRasterClipping = await storage.loadProject(rasterClippingSummary.id);
assert.ok(loadedRasterClipping);
validateLoadedProject(loadedRasterClipping);
assert.equal(loadedRasterClipping.manifest.snapshot.activeRasterLayerId, 2);
assert.deepEqual(
  loadedRasterClipping.manifest.snapshot.layers.map((layer) => layer.clippingParentId),
  [null, 1],
  "save/load must retain the active raster child's clipping projection",
);
assert.deepEqual(
  loadedRasterClipping.manifest.snapshot.mixedScene.clippingRelations,
  [{ childKey: "raster:2", parentKey: "raster:1" }],
  "save/load must retain the raster-only active clipping relation",
);
assert.equal(await storage.deleteProject(rasterClippingSummary.id), true);

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
  "await engine.ensureMixedSceneEditorResources()",
);
const semanticRestorePosition = runtimeSource.indexOf(
  "engine.mixedSceneStack?.restoreState(snapshot.mixedScene, true)",
);
assert.ok(
  semanticResourcesPosition >= 0 && semanticResourcesPosition < semanticRestorePosition,
  "semantic GPU layouts must exist before a restored vector scene can schedule its first frame",
);
assert.match(
  runtimeSource,
  /bytes:\s*stored\.bytes/,
  "restore must adopt the isolated immutable chunk buffers instead of copying them again",
);
assert.doesNotMatch(
  runtimeSource,
  /storedChunks\s*\.filter\(/,
  "restore must index project chunks once instead of rescanning every chunk per layer",
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
assert.doesNotMatch(
  restoreBody,
  /RGBA8 sRGB project contains semantic layers whose renderer is not validated yet/,
  "encoded RGBA8 projects must restore saved SVG and text layers",
);
assert.doesNotMatch(
  restoreBody,
  /RGBA8 sRGB project uses (?:advanced layer composition|layer clipping) that is not validated yet/,
  "encoded RGBA8 projects must restore saved layer composition and clipping state",
);
assert.match(
  restoreBody,
  /records\.some\(rasterLayerHasUnvalidatedEffects\)/,
  "encoded RGBA8 restore must gate only raster styles that still lack a validated renderer",
);
assert.doesNotMatch(
  restoreBody,
  /records\.some\(rasterLayerEffectsAreConfigured\)/,
  "Fill\/content opacity must not be mistaken for an unsupported raster effect during restore",
);
assert.match(
  restoreBody,
  /const restoredScenePlan = new MixedSceneStack\(records\.map\([\s\S]*?restoredScenePlan\.restoreState\(snapshot\.mixedScene, true\)[\s\S]*?advancedLayerCompositionRequired = Boolean\(engine\.mixedSceneStack\)[\s\S]*?records\.some\(layerNeedsBackdropComposition\)[\s\S]*?rasterOnlyLayerBlendPresentationRequired = advancedLayerCompositionRequired[\s\S]*?restoredScenePlan\.visibleSemanticCount === 0[\s\S]*?!restoredScenePlan\.hasHeterogeneousClipping/,
  "restore must detect the raster-only ordered-composition path from saved state",
);
assert.match(
  restoreBody,
  /const rasterClippingSegmentLayoutRequired = Boolean\(engine\.mixedSceneStack\)[\s\S]*?records\.some\(\(record\) => record\.clippingParentId !== null\);/,
  "restore must detect saved raster clipping independently of advanced composition",
);
assert.match(
  restoreBody,
  /orderedScenePresentationRequired = advancedLayerCompositionRequired[\s\S]*?restoredScenePlan\.visibleSemanticCount > 0[\s\S]*?restoredScenePlan\.hasHeterogeneousClipping/,
  "restore must prewarm the linear target for every visible ordered scene, not only advanced blend modes",
);
assert.match(
  restoreBody,
  /if \([\s\S]*?rasterOnlyLayerBlendPresentationRequired[\s\S]*?\|\| rasterClippingSegmentLayoutRequired[\s\S]*?\) \{\s*await ensureMixedScenePresentationResources\(engine\);/,
  "restore must prepare the shared segment layout before activating a saved clipping child",
);
const rasterPresentationGatePosition = restoreBody.indexOf(
  "await ensureMixedScenePresentationResources(engine)",
);
const rasterLinearPrewarmPosition = restoreBody.indexOf(
  "await prewarmMixedSceneLinearTextureForLayerBlend(",
);
const rasterTileGatePosition = restoreBody.indexOf(
  "await ensureLayerBlendTilePresentationResources(engine)",
);
const liveStackRestorePosition = restoreBody.indexOf("engine.layerStack.restoreState(stackState)");
assert.ok(
  rasterPresentationGatePosition >= 0
    && rasterLinearPrewarmPosition > rasterPresentationGatePosition
    && rasterTileGatePosition > rasterLinearPrewarmPosition
    && liveStackRestorePosition > rasterTileGatePosition,
  "saved raster composition must prepare its layout, linear target and tile compositor before publishing state",
);
assert.match(
  restoreBody,
  /if \(orderedScenePresentationRequired\) \{[\s\S]*?prewarmMixedSceneLinearTextureForLayerBlend\([\s\S]*?advancedLayerCompositionRequired && !rasterOnlyLayerBlendPresentationRequired[\s\S]*?if \(rasterOnlyLayerBlendPresentationRequired\) \{[\s\S]*?ensureLayerBlendTilePresentationResources\(engine\)/,
  "restore must prewarm the current ordered family and allocate tile resources only for raster-only advanced composition",
);
assert.match(
  restoreBody,
  /advancedLayerCompositionRequired && !rasterOnlyLayerBlendPresentationRequired,\s*records\.some\(\(record\) => record\.cutoutMode === "document"\),/,
  "restore prewarm must derive the Deep-floor requirement from saved records before they become live",
);
assert.match(
  restoreBody,
  /await engine\.beginPresentationTransaction\(\);\s*presentationTransactionStarted = true;\s*await promotePersistedLayer[\s\S]*?restoreCompleted = true;[\s\S]*?presentationTransactionStarted && restoreCompleted[\s\S]*?engine\.endPresentationTransaction\(\)/,
  "destructive saved-pixel upload and active-effect retarget must stay behind one presentation transaction",
);
assert.match(
  restoreBody,
  /latchDocumentStateInconsistent\(\s*"The project could not be restored safely\. Reload before continuing\.",\s*error,\s*\)/,
  "a failed destructive restore must retain the originating error in diagnostics",
);
assert.doesNotMatch(
  restoreBody,
  /engine\.setBrushSettings\(snapshot\.brushSettings\)|engine\.ensureCurrentBrushResources\(\)/,
  "project restore must preserve the globally active brush and must not hydrate another brush",
);
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
  'await engine.activateLayer(engine.layerStack.activeIndex, "layer-switch")',
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
