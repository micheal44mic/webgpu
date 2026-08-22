import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STARTUP_TIMING_SCHEMA,
  beginStartupTiming,
  captureStartupTiming,
  markStartupTiming,
  markStartupTimingOnce,
  measureStartupTiming,
} from "../src/startup-timing.ts";

markStartupTiming("verification-mark", { phase: "test" });
markStartupTimingOnce("verification-once");
markStartupTimingOnce("verification-once");

const completedSpan = beginStartupTiming("verification-span");
completedSpan.end({ completed: true });

const failedSpan = beginStartupTiming("verification-error");
failedSpan.fail(new TypeError("details must not be copied"));

assert.equal(
  await measureStartupTiming("verification-measure", async () => 42),
  42,
);
await assert.rejects(
  measureStartupTiming("verification-rejection", async () => {
    throw new Error("expected");
  }),
  /expected/,
);

const snapshot = captureStartupTiming();
assert.equal(snapshot.schema, STARTUP_TIMING_SCHEMA);
assert.equal(snapshot.entries.filter((entry) => entry.name === "verification-once").length, 1);
assert.equal(
  snapshot.entries.find((entry) => entry.name === "verification-span")?.status,
  "ok",
);
assert.equal(
  snapshot.entries.find((entry) => entry.name === "verification-error")?.detail?.errorName,
  "TypeError",
);
assert.equal(
  snapshot.entries.find((entry) => entry.name === "verification-rejection")?.status,
  "error",
);
assert.ok(snapshot.entries.every((entry) => entry.startMs >= 0));

for (let index = 0; index < 140; index += 1) {
  markStartupTiming(`bounded-${index}`);
}
const bounded = captureStartupTiming();
assert.equal(bounded.entries.length, 128);
assert.equal(bounded.entries.at(-1)?.name, "bounded-139");

const startupSource = readFileSync(new URL("../src/startup.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const projectSessionSource = readFileSync(
  new URL("../src/project-session-controller.ts", import.meta.url),
  "utf8",
);
const projectRuntimeSource = readFileSync(
  new URL("../src/engine-project-runtime.ts", import.meta.url),
  "utf8",
);
const layerRuntimeSource = readFileSync(
  new URL("../src/engine-layer-runtime.ts", import.meta.url),
  "utf8",
);
const diagnosticsSource = readFileSync(
  new URL("../src/app-diagnostics-controller.ts", import.meta.url),
  "utf8",
);

assert.match(startupSource, /"editor-module-import"/);
assert.match(mainSource, /"editor-interactive"/);
assert.match(engineSource, /"webgpu-adapter-request"/);
assert.match(engineSource, /"webgpu-device-request"/);
assert.match(engineSource, /"gpu-static-resources-core"/);
assert.match(engineSource, /"gpu-initial-document-resources"/);
assert.match(engineSource, /"first-frame-submitted"/);
assert.match(layerRuntimeSource, /"gpu-layer-core-pipelines"/);
assert.match(layerRuntimeSource, /"gpu-display-infrastructure-allocation"/);
assert.match(layerRuntimeSource, /"gpu-document-layer-allocation"/);
assert.match(layerRuntimeSource, /"gpu-layer-resource-publication"/);
assert.match(projectSessionSource, /"project-storage-ready-wait"/);
assert.match(projectSessionSource, /"project-load-await"/);
assert.match(projectSessionSource, /"project-restore"/);
assert.match(projectRuntimeSource, /"project-restore-active-layer-hydration"/);
assert.match(projectRuntimeSource, /"project-restore-raster-assets"/);
assert.match(diagnosticsSource, /startupTiming: captureStartupTiming\(\)/);

console.log("Startup timing verification passed.");
