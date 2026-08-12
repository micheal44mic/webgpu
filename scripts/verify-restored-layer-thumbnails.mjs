import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engineSource = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

const rasterCapture = sourceBetween(
  engineSource,
  "async captureRasterLayerThumbnail(layerId: number)",
  "async captureActiveLayerThumbnail()",
);
assert.match(rasterCapture, /this\.layerStack\.byId\(layerId\)/);
assert.match(rasterCapture, /gpu\.hot\s*\?\s*gpu\.hot\.samplingView/);
assert.match(rasterCapture, /createHydratedLayerTexture\([\s\S]*?"defer-to-fold-fence"/);
assert.match(
  rasterCapture,
  /finally\s*{\s*destroyTransientLayerHydration\(this, transientHydration\);\s*}/,
  "Transient cold/compressed hydrations must always be destroyed.",
);

const activeCapture = sourceBetween(
  engineSource,
  "async captureActiveLayerThumbnail()",
  "async retargetEffectsWorkingSet(",
);
assert.match(activeCapture, /this\.captureRasterLayerThumbnail\(layerId\)/);
assert.match(activeCapture, /layerId !== this\.layerStack\.active\.id/);

const scheduler = sourceBetween(
  mainSource,
  "function scheduleMobileLayerThumbnailCapture(",
  "function announceMobileLayerReorder(",
);
assert.match(scheduler, /mobileLayerThumbnailCaptureInFlight/);
assert.match(scheduler, /const activeFirst = \[\s*activeLayer,/);
assert.match(scheduler, /mobileRasterThumbnailCache\.get\(layer\.id\) === undefined/);
assert.match(
  scheduler,
  /mobileLayerThumbnailPendingIds\.has\(activeLayer\.id\)[\s\S]*?\? activeLayer\.id/,
  "The active raster layer must drain before other restored layers.",
);
assert.match(scheduler, /engine\.captureRasterLayerThumbnail\(layerId\)/);
assert.match(
  scheduler,
  /finally\s*{[\s\S]*?mobileLayerThumbnailCaptureInFlight = false;[\s\S]*?scheduleMobileLayerThumbnailCapture\(160\);[\s\S]*?}/,
  "The serial drain must release its in-flight latch and continue the queue.",
);

const panelToggle = sourceBetween(
  mainSource,
  "function setMobileLayersPanelOpen(",
  "function setMobileToolsSheetOpen(",
);
assert.match(panelToggle, /queueMissingMobileLayerThumbnails\(0\)/);
assert.match(panelToggle, /mobileLayerThumbnailPendingIds\.clear\(\)/);

console.log("Restored raster layer thumbnail verification passed.");
