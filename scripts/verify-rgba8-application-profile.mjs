import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(new URL(path, `file:///${root.replaceAll("\\", "/")}/`), "utf8");

const {
  RGBA8_APPLICATION_LAB_DATABASE,
  RGBA8_APPLICATION_LAB_PATH,
  resolveApplicationProfile,
} = await import("../src/application-profile.ts");
const {
  categoriseGpuResource,
  textureDescriptorBytes,
} = await import("../src/gpu-resource-registry.ts");

assert.equal(RGBA8_APPLICATION_LAB_PATH, "/rgba8-app-lab");
assert.equal(RGBA8_APPLICATION_LAB_DATABASE, "webgpu-brush-rgba8-app-lab-v1");
assert.equal(resolveApplicationProfile("/").documentLayerFormat, "rgba16float");
assert.equal(resolveApplicationProfile("/index.html").documentLayerFormat, "rgba16float");
assert.equal(resolveApplicationProfile("/rgba8-app-lab").documentLayerFormat, "rgba8unorm");
assert.equal(resolveApplicationProfile("/rgba8-app-lab/").documentLayerFormat, "rgba16float");
assert.equal(resolveApplicationProfile("/RGBA8-app-lab").documentLayerFormat, "rgba16float");

const engineTypes = read("src/engine-types.ts");
const engine = read("src/brush-engine.ts");
const main = read("src/main.ts");
const rasterAdjustments = read("src/raster-adjustments-controller.ts");
const startup = read("src/startup.ts");
const worker = read("scripts/prepare-sites-build.mjs");
const vite = read("vite.config.ts");
const html = read("index.html");

assert.match(engineTypes, /initialLayerFormat\?: LayerFormat/);
assert.match(engine, /layerFormat: LayerFormat = "rgba16float"/);
assert.match(
  engine,
  /const initialLayerFormat = options\.initialLayerFormat \?\? "rgba16float"[\s\S]*?this\.layerFormat = initialLayerFormat/,
);
assert.match(main, /resolveApplicationProfile\(window\.location\.pathname\)/);
assert.match(main, /initialLayerFormat: applicationProfile\.documentLayerFormat/);
assert.match(
  main,
  /isAdjustmentSupported: \(\) => applicationProfile\.documentLayerFormat === "rgba16float"/,
);
assert.doesNotMatch(main, /engine\.layerFormat\s*=/);
assert.match(
  rasterAdjustments,
  /isAdjustmentSupported\?\.\(kind\) === false[\s\S]*?unavailable for this document format/,
);
assert.match(startup, /applicationProfile\.projectDatabaseName/);
assert.match(startup, /databaseName: applicationProfile\.projectDatabaseName/);
assert.match(worker, /const RGBA8_APPLICATION_LAB_PATH = "\/rgba8-app-lab"/);
assert.match(worker, /url\.pathname === RGBA8_APPLICATION_LAB_PATH/);
assert.match(worker, /INDEX_HTML/);
assert.match(worker, /"Cache-Control": "private, no-store, max-age=0"/);
assert.match(vite, /url\.pathname === "\/rgba8-app-lab"/);
assert.match(vite, /request\.url = `\/\$\{url\.search\}`/);
assert.match(html, /id="documentFormatTestBadge"[\s\S]*?RGBA8 TEST/);

const rgba8Layer = textureDescriptorBytes({
  format: "rgba8unorm",
  size: { width: 4096, height: 4096 },
});
const rgba16Layer = textureDescriptorBytes({
  format: "rgba16float",
  size: { width: 4096, height: 4096 },
});
assert.equal(rgba8Layer.bytes, 64 * 1024 * 1024);
assert.equal(rgba16Layer.bytes, 128 * 1024 * 1024);
assert.equal(
  categoriseGpuResource("4096² authoritative paint layer rgba8unorm"),
  "Layer surfaces",
);
assert.equal(
  categoriseGpuResource("Single active-layer display pyramid rgba8unorm"),
  "Document mip pyramids",
);

console.log("RGBA8 application profile verification passed.");
