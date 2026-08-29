import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIMENSION_MATRIX = [
  [1080, 1920],
  [1920, 1080],
  [3000, 2400],
  [4000, 4000],
];
const PROBE_ARGUMENT = "--engine-dimension-probe";
const PROBE_URL_SEARCH_ENV = "M1M4_DIMENSION_PROBE_URL_SEARCH";

function cleanDimensionEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const name of [
    "BRUSH_DOCUMENT_WIDTH",
    "BRUSH_DOCUMENT_HEIGHT",
    "BRUSH_DOCUMENT_SIZE",
    PROBE_URL_SEARCH_ENV,
  ]) {
    delete environment[name];
  }
  return { ...environment, ...overrides };
}

function runProbe(label, environment) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), PROBE_ARGUMENT],
    { stdio: "inherit", env: environment },
  );
  assert.equal(result.status, 0, `${label} failed.`);
}

async function verifyEngineDimensionProbe() {
  const urlSearch = process.env[PROBE_URL_SEARCH_ENV];
  if (urlSearch) {
    globalThis.location = { search: urlSearch };
  }

  const limits = await import("../src/engine-limits.ts");
  const storageTiles = await import("../src/layer-storage-study.ts");
  const fill = await import("../src/fill-core.ts");
  const layerThumbnail = await import("../src/layer-thumbnail-geometry.ts");
  const selection = await import("../src/selection-core.ts");
  const rasterTransform = await import("../src/raster-transform-math.ts");
  const expectedWidth = Number(
    new URLSearchParams(urlSearch ?? "").get("documentWidth")
      ?? process.env.BRUSH_DOCUMENT_WIDTH,
  );
  const expectedHeight = Number(
    new URLSearchParams(urlSearch ?? "").get("documentHeight")
      ?? process.env.BRUSH_DOCUMENT_HEIGHT,
  );
  const label = `${expectedWidth} x ${expectedHeight}`;

  assert.equal(limits.DOCUMENT_WIDTH, expectedWidth, `${label}: resolved width`);
  assert.equal(limits.DOCUMENT_HEIGHT, expectedHeight, `${label}: resolved height`);
  assert.equal(limits.DOCUMENT_MAX_EDGE, Math.max(expectedWidth, expectedHeight));
  assert.equal(limits.LAYER_SIZE, limits.DOCUMENT_MAX_EDGE,
    `${label}: compatibility edge must be the maximum, never a second dimension`);
  assert.equal(limits.DOCUMENT_TILE_GRID_SIZE, 16);
  assert.equal(limits.DOCUMENT_TILE_MASK_WORDS, 8);

  const tileWidth = Math.ceil(expectedWidth / limits.DOCUMENT_TILE_GRID_SIZE);
  const tileHeight = Math.ceil(expectedHeight / limits.DOCUMENT_TILE_GRID_SIZE);
  assert.equal(limits.DOCUMENT_TILE_WIDTH, tileWidth, `${label}: tile width`);
  assert.equal(limits.DOCUMENT_TILE_HEIGHT, tileHeight, `${label}: tile height`);
  assert.equal(storageTiles.LAYER_STORAGE_TILE_WIDTH, tileWidth);
  assert.equal(storageTiles.LAYER_STORAGE_TILE_HEIGHT, tileHeight);
  assert.equal(storageTiles.LAYER_STORAGE_DOCUMENT_WIDTH, expectedWidth);
  assert.equal(storageTiles.LAYER_STORAGE_DOCUMENT_HEIGHT, expectedHeight);

  const bottomRightTileX = Math.floor((expectedWidth - 1) / tileWidth);
  const bottomRightTileY = Math.floor((expectedHeight - 1) / tileHeight);
  assert.equal(bottomRightTileX, 15, `${label}: right edge must use tile column 15`);
  assert.equal(bottomRightTileY, 15, `${label}: bottom edge must use tile row 15`);
  assert.equal(bottomRightTileY * 16 + bottomRightTileX, 255,
    `${label}: bottom-right pixel must map to tile 255`);

  const mask = storageTiles.createLayerStorageTileMask();
  storageTiles.markLayerStorageRect(mask, {
    x: expectedWidth - 1,
    y: expectedHeight - 1,
    width: 1,
    height: 1,
  });
  assert.deepEqual(storageTiles.layerStorageTileIndices(mask), [255],
    `${label}: sparse storage mask must retain the last pixel`);
  assert.equal(mask[7] >>> 0, 0x8000_0000,
    `${label}: tile 255 must be bit 31 in mask word 7`);

  const lastTileWidth = expectedWidth - tileWidth * 15;
  const lastTileHeight = expectedHeight - tileHeight * 15;
  assert.ok(lastTileWidth > 0 && lastTileWidth <= tileWidth, `${label}: last tile width`);
  assert.ok(lastTileHeight > 0 && lastTileHeight <= tileHeight, `${label}: last tile height`);
  assert.equal(rasterTransform.RASTER_TRANSFORM_DOCUMENT_WIDTH, expectedWidth);
  assert.equal(rasterTransform.RASTER_TRANSFORM_DOCUMENT_HEIGHT, expectedHeight);
  assert.equal(rasterTransform.RASTER_TRANSFORM_TILE_WIDTH, tileWidth);
  assert.equal(rasterTransform.RASTER_TRANSFORM_TILE_HEIGHT, tileHeight);
  assert.deepEqual(
    rasterTransform.rasterTransformScratchRect(
      mask,
      expectedWidth,
      tileWidth,
      expectedHeight,
      tileHeight,
    ),
    {
      x: tileWidth * 15,
      y: tileHeight * 15,
      width: lastTileWidth,
      height: lastTileHeight,
    },
    `${label}: transform scratch must clip tile 255 to the document edge`,
  );

  assert.equal(fill.FILL_LAYER_WIDTH, expectedWidth);
  assert.equal(fill.FILL_LAYER_HEIGHT, expectedHeight);
  assert.equal(fill.FILL_BLOCK_GRID_WIDTH, Math.ceil(expectedWidth / fill.FILL_BLOCK_SIZE));
  assert.equal(fill.FILL_BLOCK_GRID_HEIGHT, Math.ceil(expectedHeight / fill.FILL_BLOCK_SIZE));
  assert.equal(fill.FILL_HISTORY_WORDS_PER_ROW, Math.ceil(expectedWidth / 32));
  assert.equal(
    fill.FILL_HISTORY_MASK_BYTES,
    Math.ceil(expectedWidth / 32) * expectedHeight * 4,
  );
  assert.equal(fill.FILL_RENDER_MASK_WORDS_PER_ROW, Math.ceil(expectedWidth / 8));
  assert.equal(fill.FILL_TILE_WIDTH, tileWidth);
  assert.equal(fill.FILL_TILE_HEIGHT, tileHeight);

  const lastHistoryWordInFirstRow = fill.FILL_HISTORY_WORDS_PER_ROW - 1;
  const validFinalRenderWords = fill.FILL_RENDER_MASK_WORDS_PER_ROW
    - lastHistoryWordInFirstRow * 4;
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    assert.equal(
      fill.fillRenderMaskTargetWord(lastHistoryWordInFirstRow, byteIndex),
      byteIndex < validFinalRenderWords
        ? lastHistoryWordInFirstRow * 4 + byteIndex
        : null,
      `${label}: padded history bytes must not spill into the next render-mask row`,
    );
  }
  assert.equal(
    fill.fillRenderMaskTargetWord(fill.FILL_HISTORY_WORDS_PER_ROW, 0),
    fill.FILL_RENDER_MASK_WORDS_PER_ROW,
    `${label}: render-mask row two must begin at its exact packed stride`,
  );

  const sourceWords = new Uint32Array(fill.FILL_HISTORY_WORDS_PER_ROW * 2);
  sourceWords.fill(0xffff_ffff);
  const expandedWords = new Uint32Array(fill.FILL_RENDER_MASK_WORDS_PER_ROW * 2);
  for (let sourceWord = 0; sourceWord < sourceWords.length; sourceWord += 1) {
    for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
      const targetWord = fill.fillRenderMaskTargetWord(sourceWord, byteIndex);
      if (targetWord !== null) {
        expandedWords[targetWord] = (sourceWords[sourceWord] >>> (byteIndex * 8)) & 0xff;
      }
    }
  }
  assert.ok(
    expandedWords.every((word) => word === 0xff),
    `${label}: two full rows must expand without diagonal gaps or row drift`,
  );

  const thumbnailScale = 64 / Math.max(expectedWidth, expectedHeight);
  assert.deepEqual(
    layerThumbnail.layerThumbnailDimensions(expectedWidth, expectedHeight),
    {
      width: Math.max(1, Math.round(expectedWidth * thumbnailScale)),
      height: Math.max(1, Math.round(expectedHeight * thumbnailScale)),
    },
    `${label}: layer previews must retain the document aspect ratio`,
  );

  assert.equal(selection.SELECTION_LAYER_WIDTH, expectedWidth);
  assert.equal(selection.SELECTION_LAYER_HEIGHT, expectedHeight);
  assert.equal(selection.SELECTION_WORDS_PER_ROW, Math.ceil(expectedWidth / 32));
  assert.equal(
    selection.SELECTION_MASK_BYTES,
    Math.ceil(expectedWidth / 32) * expectedHeight * 4,
  );
  assert.equal(selection.SELECTION_TILE_WIDTH, tileWidth);
  assert.equal(selection.SELECTION_TILE_HEIGHT, tileHeight);

  for (const bytesPerPixel of [4, 8]) {
    const tightBytesPerRow = tileWidth * bytesPerPixel;
    const gpuBytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;
    assert.equal(gpuBytesPerRow % 256, 0, `${label}: aligned GPU row`);
    assert.ok(gpuBytesPerRow >= tightBytesPerRow, `${label}: row padding cannot truncate`);
    assert.ok(gpuBytesPerRow - tightBytesPerRow < 256, `${label}: minimal row padding`);
    assert.equal(
      tightBytesPerRow * tileHeight,
      tileWidth * tileHeight * bytesPerPixel,
      `${label}: codec payload remains tightly packed`,
    );
  }
}

if (process.argv.includes(PROBE_ARGUMENT)) {
  await verifyEngineDimensionProbe();
  process.exit(0);
}

for (const [width, height] of DIMENSION_MATRIX) {
  runProbe(
    `Environment dimensions ${width} x ${height}`,
    cleanDimensionEnvironment({
      BRUSH_DOCUMENT_WIDTH: String(width),
      BRUSH_DOCUMENT_HEIGHT: String(height),
    }),
  );
  runProbe(
    `URL dimensions ${width} x ${height}`,
    cleanDimensionEnvironment({
      BRUSH_DOCUMENT_WIDTH: "777",
      BRUSH_DOCUMENT_HEIGHT: "888",
      [PROBE_URL_SEARCH_ENV]: `?documentWidth=${width}&documentHeight=${height}`,
    }),
  );
}

// Preserve the two historical square profiles while new projects use two axes.
for (const legacySize of [2048, 4096]) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        "const limits = await import('./src/engine-limits.ts');",
        `if (limits.DOCUMENT_WIDTH !== ${legacySize}`,
        ` || limits.DOCUMENT_HEIGHT !== ${legacySize}) process.exit(1);`,
      ].join(""),
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
      env: cleanDimensionEnvironment({ BRUSH_DOCUMENT_SIZE: String(legacySize) }),
    },
  );
  assert.equal(result.status, 0, `Legacy ${legacySize} square profile failed.`);
}

const {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_TILE_GRID_SIZE,
  ProjectStorage,
  ProjectStorageValidationError,
  validateLoadedProject,
  validateProjectSaveRequest,
} = await import("../src/project-storage.ts");

function bottomRightProjectRequest(width, height) {
  const tileWidth = Math.ceil(width / PROJECT_STORAGE_TILE_GRID_SIZE);
  const tileHeight = Math.ceil(height / PROJECT_STORAGE_TILE_GRID_SIZE);
  const tileBytes = tileWidth * tileHeight * 8;
  const storageTileMask = new Uint32Array(8);
  storageTileMask[7] = 0x8000_0000;
  const bytes = new ArrayBuffer(tileBytes);
  const byteView = new Uint8Array(bytes);
  byteView[0] = 0x51;
  byteView[byteView.length - 1] = 0xa7;
  const descriptor = {
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    chunkIndex: 0,
    firstTileOffset: 0,
    tileCount: 1,
    storage: "raw",
    rawBytes: tileBytes,
    storedBytes: tileBytes,
    sourceHash: 0x25_50_00_01,
  };
  return {
    tileWidth,
    tileHeight,
    tileBytes,
    request: {
      schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
      name: `Edge ${width} x ${height}`,
      thumbnail: null,
      snapshot: {
        schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
        document: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          width,
          height,
          layerFormat: "rgba16float",
          tileGridSize: PROJECT_STORAGE_TILE_GRID_SIZE,
          colorSpace: "linear-premultiplied",
        },
        layers: [{
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          id: 1,
          name: "Bottom-right raster",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          clippingParentId: null,
          contentBounds: { x: width - 1, y: height - 1, width: 1, height: 1 },
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
            schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
            format: "rgba16float",
            tileIndices: [255],
            chunks: [descriptor],
            rawBytes: tileBytes,
            storedBytes: tileBytes,
            sourceHash: descriptor.sourceHash,
            generation: 1,
          },
        }],
        activeRasterLayerId: 1,
        referenceRasterLayerId: null,
        mixedScene: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          items: [{ key: "raster:1", kind: "raster", rasterLayerId: 1 }],
          textNodes: [],
          svgNodes: [],
          imageNodes: [],
          selectedKey: "raster:1",
          nextTextNodeId: 1,
          nextSvgNodeId: 1,
          nextImageNodeId: 1,
        },
        view: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          centerX: width / 2,
          centerY: height / 2,
          zoom: 1,
          rotationRadians: 0,
        },
        brushSettings: { color: "#ff5b35", size: 32 },
      },
      chunks: [{
        schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
        layerId: 1,
        chunkIndex: 0,
        storage: "raw",
        rawBytes: tileBytes,
        storedBytes: tileBytes,
        sourceHash: descriptor.sourceHash,
        bytes,
      }],
    },
  };
}

const storageDatabaseName = `m1m4-custom-dimension-verify-${Date.now()}`;
const storage = new ProjectStorage({
  databaseName: storageDatabaseName,
  forceMemory: true,
});
await storage.initialize();
for (const [width, height] of DIMENSION_MATRIX) {
  const fixture = bottomRightProjectRequest(width, height);
  validateProjectSaveRequest(fixture.request);
  const summary = await storage.saveProject(fixture.request);
  assert.equal(summary.documentWidth, width);
  assert.equal(summary.documentHeight, height);
  assert.equal(summary.storedBytes, fixture.tileBytes);
  const reloadedStorage = new ProjectStorage({
    databaseName: storageDatabaseName,
    forceMemory: true,
  });
  await reloadedStorage.initialize();
  const loaded = await reloadedStorage.loadProject(summary.id);
  assert.ok(loaded, `${width} x ${height}: saved project must reload`);
  validateLoadedProject(loaded);
  assert.equal(loaded.manifest.snapshot.document.width, width);
  assert.equal(loaded.manifest.snapshot.document.height, height);
  const layer = loaded.manifest.snapshot.layers[0];
  assert.deepEqual(layer.pixels?.tileIndices, [255]);
  assert.equal(layer.storageTileMask[7] >>> 0, 0x8000_0000);
  assert.equal(layer.pixels?.rawBytes, fixture.tileWidth * fixture.tileHeight * 8);
  const restoredBytes = new Uint8Array(loaded.chunks[0].bytes);
  assert.equal(restoredBytes[0], 0x51);
  assert.equal(restoredBytes.at(-1), 0xa7);
  reloadedStorage.close();
}
storage.close();

assert.throws(
  () => validateProjectSaveRequest(bottomRightProjectRequest(
    PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION + 1,
    1000,
  ).request),
  ProjectStorageValidationError,
  "New project storage must reject dimensions above 4000 px.",
);

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const startupSource = read("../src/startup.ts");
const mainSource = read("../src/main.ts");
const projectSessionSource = read("../src/project-session-controller.ts");
const projectRuntimeSource = read("../src/engine-project-runtime.ts");
const coldStorageSource = read("../src/engine-cold-storage.ts");
const brushEngineSource = read("../src/brush-engine.ts");
const historyStorageCoreSource = read("../src/history-storage-core.ts");
const historyStorageCoordinatorSource = read("../src/history-storage-coordinator.ts");

// Opening an existing project and creating a new one both use two-axis routes.
assert.match(startupSource,
  /url\.searchParams\.set\("documentWidth", String\(summary\.documentWidth\)\)/);
assert.match(startupSource,
  /url\.searchParams\.set\("documentHeight", String\(summary\.documentHeight\)\)/);
assert.match(startupSource, /if \(summary\.documentWidth === summary\.documentHeight\)/);
assert.match(startupSource, /url\.searchParams\.set\("documentWidth", String\(width\)\)/);
assert.match(startupSource, /url\.searchParams\.set\("documentHeight", String\(height\)\)/);
assert.match(startupSource, /if \(width === height\) url\.searchParams\.set\("documentSize"/);
assert.match(
  startupSource,
  /search\.get\("newProject"\) !== "1"[\s\S]{0,120}Number\(widthRaw\) === LEGACY_CANVAS_DIMENSION[\s\S]{0,120}Number\(heightRaw\) === LEGACY_CANVAS_DIMENSION[\s\S]{0,80}return true;/,
  "Existing 4096 x 4096 deep links must remain valid after the two-axis migration.",
);
assert.match(
  startupSource,
  /return parsedEditorDimension\(widthRaw\) !== null\s*&& parsedEditorDimension\(heightRaw\) !== null;/,
  "New/custom deep links must validate both axes independently.",
);
assert.doesNotMatch(
  startupSource,
  /Number\(widthRaw\) === LEGACY_CANVAS_DIMENSION\s*\|\||Number\(heightRaw\) === LEGACY_CANVAS_DIMENSION\s*\|\|/,
  "A single 4096 edge must not make an otherwise invalid rectangle routable.",
);

const updateProjectUrlStart = projectSessionSource.indexOf("private projectUrl(");
const updateProjectUrlEnd = projectSessionSource.indexOf(
  "\n  private syncSaveControl",
  updateProjectUrlStart,
);
assert.ok(updateProjectUrlStart >= 0 && updateProjectUrlEnd > updateProjectUrlStart);
const updateProjectUrlSource = projectSessionSource.slice(updateProjectUrlStart, updateProjectUrlEnd);
assert.match(updateProjectUrlSource, /searchParams\.set\("documentWidth"/,
  "Saved-project URLs must retain the authoritative width.");
assert.match(updateProjectUrlSource, /searchParams\.set\("documentHeight"/,
  "Saved-project URLs must retain the authoritative height.");
assert.match(updateProjectUrlSource, /this\.documentWidth === this\.documentHeight/,
  "The legacy documentSize alias may only be emitted for square documents.");
assert.match(updateProjectUrlSource, /searchParams\.delete\("documentSize"\)/,
  "Rectangular saved-project URLs must remove a stale square alias.");

assert.match(projectRuntimeSource, /snapshot\.document\.width !== DOCUMENT_WIDTH/,
  "Restore must compare saved width with runtime width.");
assert.match(projectRuntimeSource, /snapshot\.document\.height !== DOCUMENT_HEIGHT/,
  "Restore must compare saved height with runtime height.");

assert.match(historyStorageCoreSource,
  /interface HistoryDocumentFingerprintV1[\s\S]*?documentWidth: number;[\s\S]*?documentHeight: number;/,
  "History spill descriptors must identify both document axes.");
assert.match(historyStorageCoordinatorSource,
  /documentWidth: DOCUMENT_WIDTH,[\s\S]*?documentHeight: DOCUMENT_HEIGHT,/,
  "Portrait and landscape documents must not share a History fingerprint.");
assert.match(historyStorageCoordinatorSource,
  /engineBuildId: "history-local-spill-rect-v\d+"/,
  "Adding independent dimensions must invalidate scalar History spill records.");

// GPU readback uses an aligned staging stride, then strips padding so the
// compressor and persisted chunks keep the exact tight tile payload.
const readbackStart = brushEngineSource.indexOf("async readLayerColdStorageTiles(");
const readbackEnd = brushEngineSource.indexOf("\n  async ", readbackStart + 10);
assert.ok(readbackStart >= 0 && readbackEnd > readbackStart);
const readbackSource = brushEngineSource.slice(readbackStart, readbackEnd);
assert.match(readbackSource,
  /const unpaddedBytesPerRow = LAYER_STORAGE_TILE_WIDTH \* bytesPerPixel;/);
assert.match(readbackSource,
  /const bytesPerRow = Math\.ceil\(unpaddedBytesPerRow \/ 256\) \* 256;/);
assert.match(readbackSource, /copyTextureToBuffer\([\s\S]*?bytesPerRow, rowsPerImage/);
assert.match(readbackSource,
  /new Uint8Array\(\s*unpaddedBytesPerRow \* rowsPerImage \* arrayLayerCount/);
assert.match(readbackSource,
  /mappedBytes\.subarray\(sourceOffset, sourceOffset \+ unpaddedBytesPerRow\)/);

assert.match(coldStorageSource,
  /function coldCodecTileBytes[\s\S]*?LAYER_STORAGE_TILE_WIDTH \* LAYER_STORAGE_TILE_HEIGHT/);
assert.match(coldStorageSource,
  /function coldCodecBytesPerRow[\s\S]*?LAYER_STORAGE_TILE_WIDTH \* layerFormatBytesPerPixel/);
assert.match(coldStorageSource,
  /queue\.writeTexture\([\s\S]*?bytesPerRow: coldCodecBytesPerRow\(compressed\.format\)/,
  "GPUQueue.writeTexture must consume the tight codec row stride.");
assert.match(coldStorageSource,
  /width: Math\.max\(0, Math\.min\(LAYER_STORAGE_TILE_WIDTH, DOCUMENT_WIDTH - originX\)\)/);
assert.match(coldStorageSource,
  /height: Math\.max\(0, Math\.min\(LAYER_STORAGE_TILE_HEIGHT, DOCUMENT_HEIGHT - originY\)\)/);

console.log("Custom document dimension verification passed.");
