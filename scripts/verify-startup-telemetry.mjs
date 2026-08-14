import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STARTUP_TIMING_SCHEMA,
  StartupTelemetry,
} from "../src/startup-telemetry.ts";

let now = 12.34;
const navigation = {
  type: "reload",
  redirectCount: 1,
  responseStart: 3.14,
  responseEnd: 8.28,
  domInteractive: 21.25,
  domContentLoadedEventEnd: 22.75,
  loadEventEnd: 0,
  transferSize: 4096,
  encodedBodySize: 2048,
  decodedBodySize: 8192,
};
const telemetry = new StartupTelemetry({
  timeOrigin: Date.UTC(2026, 7, 14, 8, 0, 0),
  now: () => now,
  getEntriesByType: (type) => type === "navigation" ? [navigation] : [],
});

telemetry.mark("startup-entry");
telemetry.mark("startup-entry");
telemetry.expectBackgroundTasks(["vector", "selection", "blend", "selection"]);
telemetry.queue("vector");
now = 20;
telemetry.begin("vector");
now = 44.44;
telemetry.complete("vector");
telemetry.queue("selection");
now = 50;
telemetry.begin("selection");
now = 70;
telemetry.fail("selection", new Error("pipeline rejected"));

let snapshot = telemetry.snapshot();
assert.equal(snapshot.schema, STARTUP_TIMING_SCHEMA);
assert.equal(snapshot.unit, "milliseconds-from-navigation-start");
assert.equal(snapshot.summary.startupEntryMs, 12.3);
assert.deepEqual(snapshot.expectedBackgroundTasks, ["vector", "selection", "blend"]);
assert.deepEqual(snapshot.summary.pendingBackgroundTasks, ["blend"]);
assert.equal(snapshot.summary.allBackgroundSettledMs, null);
assert.equal(snapshot.summary.allBackgroundSucceeded, null);
assert.equal(snapshot.phases[0].queueDelayMs, 7.7);
assert.equal(snapshot.phases[0].durationMs, 24.4);
assert.deepEqual(snapshot.errors, [{
  phase: "selection",
  atMs: 70,
  error: { name: "Error", message: "pipeline rejected" },
}]);
assert.equal(snapshot.navigation?.type, "reload");
assert.equal(snapshot.navigation?.loadEventEndMs, null);
assert.equal(snapshot.navigation?.transferSizeBytes, 4096);

telemetry.queue("blend");
now = 80;
await telemetry.track("blend", async () => {
  now = 95.55;
});
snapshot = telemetry.snapshot();
assert.deepEqual(snapshot.summary.pendingBackgroundTasks, []);
assert.equal(snapshot.summary.allBackgroundSettledMs, 95.6);
assert.equal(snapshot.summary.allBackgroundSucceeded, false);

const startupSource = readFileSync(new URL("../src/startup.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const orchestrationSource = readFileSync(
  new URL("../src/editor-startup-orchestration.ts", import.meta.url),
  "utf8",
);
const diagnosticsSource = readFileSync(
  new URL("../src/app-diagnostics-controller.ts", import.meta.url),
  "utf8",
);
const stageSource = readFileSync(new URL("../src/ui-shell/stage.html", import.meta.url), "utf8");

assert.match(startupSource, /startupTelemetry\.track\("main-module-load", \(\) => import\("\.\/main"\)\)/);
assert.match(mainSource, /getStartupDiagnostics: \(\) => startupTelemetry\.snapshot\(\)/);
assert.match(mainSource, /startupTelemetry\.mark\("project-interactive"\)/);
assert.match(orchestrationSource, /telemetry\.mark\("first-canvas-paint-opportunity"\)/);
assert.match(orchestrationSource, /telemetry\.expectBackgroundTasks\(\[/);
assert.match(orchestrationSource, /class DeferredStartupScheduler/);
assert.match(engineSource, /name: "webgpu-adapter", state: "start"/);
assert.match(engineSource, /name: "webgpu-device", state: "complete"/);
assert.match(engineSource, /name: "core-renderer-resources"/);
assert.match(engineSource, /name: "initial-document-resources"/);
assert.match(diagnosticsSource, /startup: this\.options\.getStartupDiagnostics\(\)/);
assert.match(stageSource, /Copia diagnosi \+ avvio/);

console.log("startup telemetry verification passed");
