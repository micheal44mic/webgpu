import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
telemetry.begin("initial-document-resources");
telemetry.fail("initial-document-resources", new Error("document pipeline rejected"));
telemetry.recordPipelineCompilation({
  phase: "document-pipelines",
  label: "Brush normal rgba16float",
  state: "start",
  durationMs: null,
});
telemetry.recordPipelineCompilation({
  phase: "document-pipelines",
  label: "Brush normal rgba16float",
  state: "complete",
  durationMs: 12.34,
});

let snapshot = telemetry.snapshot();
assert.equal(snapshot.schema, STARTUP_TIMING_SCHEMA);
assert.equal(snapshot.unit, "milliseconds-from-navigation-start");
assert.equal(snapshot.summary.startupEntryMs, 12.3);
assert.deepEqual(snapshot.expectedBackgroundTasks, ["vector", "selection", "blend"]);
assert.deepEqual(snapshot.summary.pendingBackgroundTasks, ["blend"]);
assert.equal(snapshot.summary.allBackgroundSettledMs, null);
assert.equal(snapshot.summary.allBackgroundSucceeded, null);
assert.equal(snapshot.summary.initialDocumentReadyMs, null);
assert.equal(snapshot.phases[0].queueDelayMs, 7.7);
assert.equal(snapshot.phases[0].durationMs, 24.4);
assert.deepEqual(snapshot.errors, [{
  phase: "selection",
  atMs: 70,
  error: { name: "Error", message: "pipeline rejected" },
}, {
  phase: "initial-document-resources",
  atMs: 70,
  error: { name: "Error", message: "document pipeline rejected" },
}]);
assert.equal(snapshot.navigation?.type, "reload");
assert.equal(snapshot.navigation?.loadEventEndMs, null);
assert.equal(snapshot.navigation?.transferSizeBytes, 4096);
assert.deepEqual(snapshot.pipelineCompilations, [{
  phase: "document-pipelines",
  label: "Brush normal rgba16float",
  status: "ok",
  completedAtMs: 70,
  durationMs: 12.3,
  error: null,
}]);

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
const startupLoadingSource = readFileSync(
  new URL("../src/editor-startup-loading.ts", import.meta.url),
  "utf8",
);
const startupLoadingShell = readFileSync(
  new URL("../src/ui-shell/startup-loading.html", import.meta.url),
  "utf8",
);
const startupLoadingStyles = readFileSync(
  new URL("../src/styles/startup-loading.css", import.meta.url),
  "utf8",
);
const gpuUtilsSource = readFileSync(
  new URL("../src/engine-gpu-utils.ts", import.meta.url),
  "utf8",
);
const layerRecreationSource = readFileSync(
  new URL("../src/engine-layer-recreation-runtime.ts", import.meta.url),
  "utf8",
);
const blendRendererSource = readFileSync(
  new URL("../src/blend-renderer.ts", import.meta.url),
  "utf8",
);

assert.match(startupSource, /startupTelemetry\.track\("main-module-load", \(\) => import\("\.\/main"\)\)/);
assert.match(mainSource, /getStartupDiagnostics: \(\) => startupTelemetry\.snapshot\(\)/);
assert.match(mainSource, /startupTelemetry\.mark\("project-interactive"\)/);
assert.match(mainSource, /await startupTelemetry\.track\(\s*"deferred-selection-pipelines"/);
assert.match(mainSource, /await startupTelemetry\.track\(\s*"deferred-blend-renderer"/);
assert.match(mainSource, /startupLoading\.complete\(\)/);
assert.match(orchestrationSource, /telemetry\.mark\("first-canvas-paint-opportunity"\)/);
assert.match(orchestrationSource, /telemetry\.expectBackgroundTasks\(\[/);
assert.match(orchestrationSource, /class DeferredStartupScheduler/);
assert.match(engineSource, /name: "webgpu-adapter", state: "start"/);
assert.match(engineSource, /name: "webgpu-device", state: "complete"/);
assert.match(engineSource, /name: "core-renderer-resources"/);
assert.match(engineSource, /name: "initial-document-resources"/);
assert.match(diagnosticsSource, /startup: this\.options\.getStartupDiagnostics\(\)/);
assert.match(stageSource, /Copia diagnosi \+ avvio/);
assert.match(startupSource, /startupLoading\.begin\(\)/);
assert.match(startupLoadingSource, /this\.app\.inert = true/);
assert.match(startupLoadingSource, /this\.app\.inert = false/);
assert.match(startupLoadingShell, /<progress[\s\S]*id="startupLoadingProgress"/);
assert.match(startupLoadingStyles, /backdrop-filter: blur\(8px\)/);
assert.doesNotMatch(startupLoadingStyles, /box-shadow/);
const styleDirectory = new URL("../src/styles/", import.meta.url);
for (const filename of readdirSync(styleDirectory).filter((name) => name.endsWith(".css"))) {
  const source = readFileSync(new URL(filename, styleDirectory), "utf8");
  assert.doesNotMatch(source, /box-shadow|text-shadow|drop-shadow/);
  if (filename !== "startup-loading.css") {
    assert.doesNotMatch(source, /backdrop-filter|filter:\s*blur\(/);
  }
}
assert.match(gpuUtilsSource, /touchDevice \? 2 : 4/);
assert.match(gpuUtilsSource, /createPipelineCompilationQueue/);
assert.match(layerRecreationSource, /total: pipelineTotal/);
assert.match(layerRecreationSource, /await Promise\.all\(\[/);
assert.doesNotMatch(layerRecreationSource, /`Pipeline formato layer \$\{format\}`/);
assert.match(blendRendererSource, /createPipelineCompilationQueue\(this\.device/);

console.log("startup telemetry verification passed");
