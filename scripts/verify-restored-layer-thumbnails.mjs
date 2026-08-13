import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engineSource = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n");
const controllerSource = readFileSync(
  new URL("../src/layer-thumbnail-controller.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const panelSource = readFileSync(
  new URL("../src/layer-panel-controller.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");

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

const scheduler = controllerSource;
assert.match(scheduler, /this\.captureInFlight/);
assert.match(scheduler, /const activeFirst = \[\s*activeLayer,/);
assert.match(scheduler, /this\.cache\.get\(layer\.id\) === undefined/);
assert.match(
  scheduler,
  /this\.pendingLayerIds\.has\(activeLayer\.id\)[\s\S]*?\? activeLayer\.id/,
  "The active raster layer must drain before other restored layers.",
);
assert.match(scheduler, /this\.options\.captureRasterLayerThumbnail\(layerId\)/);
assert.match(scheduler, /dirtyGenerationByLayerId/);
assert.match(scheduler, /invalidate\(activeLayer\.id, delayMs\)/);
assert.match(
  scheduler,
  /dirtyGenerationByLayerId\.get\(layerId\)[\s\S]*?!== requestedGeneration[\s\S]*?pendingLayerIds\.add\(layerId\)/,
  "A capture made stale by a newer invalidation must be discarded and queued again.",
);
const closeStart = scheduler.indexOf("setPanelOpen(open: boolean)");
const closeEnd = scheduler.indexOf("requestActive(", closeStart);
assert.doesNotMatch(
  scheduler.slice(closeStart, closeEnd),
  /pendingLayerIds\.clear|dirtyGenerationByLayerId\.clear/,
  "Closing the panel may pause GPU work but must retain dirty layer generations.",
);
assert.match(
  scheduler,
  /finally\s*{[\s\S]*?this\.captureInFlight = false;[\s\S]*?this\.scheduleCapture\(160\);[\s\S]*?}/,
  "The serial drain must release its in-flight latch and continue the queue.",
);

const panelToggle = sourceBetween(
  panelSource,
  "setOpen(open: boolean)",
  "selectedLayerProperties(",
);
assert.match(panelToggle, /this\.options\.thumbnails\.setPanelOpen\(true\)/);
assert.match(panelToggle, /this\.options\.thumbnails\.setPanelOpen\(false\)/);
assert.match(mainSource, /captureRasterLayerThumbnail: \(layerId\) => engine\.captureRasterLayerThumbnail\(layerId\)/);

console.log("Restored raster layer thumbnail verification passed.");
