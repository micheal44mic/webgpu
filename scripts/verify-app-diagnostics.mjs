import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP_DIAGNOSTIC_EVENT_LIMIT,
  BoundedAppDiagnosticLog,
  captureAppDiagnosticState,
  inspectAppDiagnosticInvariants,
  summarizeAppDiagnosticHistoryWindow,
} from "../src/app-diagnostics.ts";

const log = new BoundedAppDiagnosticLog(3);
for (let index = 0; index < 5; index += 1) {
  log.record({ category: "operation", name: `event-${index}` });
}
assert.deepEqual(log.snapshot().map((event) => event.name), [
  "event-2",
  "event-3",
  "event-4",
]);
assert.equal(APP_DIAGNOSTIC_EVENT_LIMIT, 30);

const history = {
  canUndo: true,
  canRedo: false,
  busy: false,
  inconsistent: false,
  actionCount: 2,
  cursor: 2,
  storedBaseStamps: 0,
  logicalStampBytes: 0,
  undoBlockedReason: null,
  redoBlockedReason: "fine",
  openEdit: null,
};
const stats = {
  activeLayerId: 2,
  referenceLayerId: null,
  layers: [
    {
      id: 1,
      visible: true,
      clippingParentId: null,
      hasContent: false,
    },
    {
      id: 2,
      visible: true,
      clippingParentId: null,
      hasContent: true,
    },
  ],
  mixedScene: {
    selectedKey: "raster:2",
    activeRasterLayerId: 2,
    items: [
      {
        key: "raster:1",
        kind: "raster",
        rasterLayerId: 1,
        rasterLayerIndex: 0,
        rasterClippingParentId: null,
      },
      { key: "text:1", kind: "text" },
      {
        key: "raster:2",
        kind: "raster",
        rasterLayerId: 2,
        rasterLayerIndex: 1,
        rasterClippingParentId: null,
      },
    ],
  },
  gpuMemory: {
    governorZone: "green",
    registeredCurrentMiB: 64,
    countedTotalMiB: 64,
    layerCompressedCpuMiB: 0,
    countedGpuPlusCompressedCpuMiB: 64,
    layers: [
      { id: 1, state: "empty" },
      { id: 2, state: "hot" },
    ],
  },
};

assert.equal(inspectAppDiagnosticInvariants(stats, history).ok, true);
const state = captureAppDiagnosticState(stats, history);
assert.deepEqual(state.scene.bottomUpKeys, ["raster:1", "text:1", "raster:2"]);
assert.equal(state.rasterLayers[1].storage, "hot");

const brokenStats = {
  ...stats,
  mixedScene: {
    ...stats.mixedScene,
    activeRasterLayerId: 1,
    items: [stats.mixedScene.items[2], stats.mixedScene.items[1], stats.mixedScene.items[0]],
  },
};
const broken = inspectAppDiagnosticInvariants(brokenStats, history);
assert.equal(broken.ok, false);
assert.ok(broken.issues.some((issue) => issue.includes("ordine raster incoerente")));
assert.ok(broken.issues.some((issue) => issue.includes("Raster attivo scena")));

const actions = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1,
  kind: "clear",
  layerId: index % 2 + 1,
}));
const windowAtEnd = summarizeAppDiagnosticHistoryWindow(actions, 40);
assert.equal(windowAtEnd.length, 30);
assert.equal(windowAtEnd[0].index, 10);
assert.equal(windowAtEnd.at(-1).index, 39);
const windowAfterUndo = summarizeAppDiagnosticHistoryWindow(actions, 12);
assert.equal(windowAfterUndo.at(-1).index, 14, "include tre azioni Redo dopo il cursore");
assert.equal(windowAfterUndo.at(-1).side, "redo");
assert.deepEqual(
  summarizeAppDiagnosticHistoryWindow(actions, -10).map((entry) => entry.index),
  [0, 1, 2],
  "un cursore corrotto non deve rompere il rapporto diagnostico",
);

const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const controllerSource = readFileSync(
  new URL("../src/app-diagnostics-controller.ts", import.meta.url),
  "utf8",
);
const gpuMemoryPanelSource = readFileSync(
  new URL("../src/gpu-memory-panel-controller.ts", import.meta.url),
  "utf8",
);
const runtimeStatsSource = readFileSync(
  new URL("../src/runtime-stats-controller.ts", import.meta.url),
  "utf8",
);
const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const gpuUtilsSource = readFileSync(
  new URL("../src/engine-gpu-utils.ts", import.meta.url),
  "utf8",
);
const resourceSetupSource = readFileSync(
  new URL("../src/engine-resource-setup.ts", import.meta.url),
  "utf8",
);
const historyMaintenanceSource = readFileSync(
  new URL("../src/history-maintenance-runtime.ts", import.meta.url),
  "utf8",
);
const reportsSource = readFileSync(
  new URL("../src/engine-reports.ts", import.meta.url),
  "utf8",
);
assert.match(indexSource, /id="copyAppDiagnostics"/);
assert.match(indexSource, /id="appDiagnosticsReport"/);
assert.doesNotMatch(indexSource, /id="startupDiagnostic"/);
assert.doesNotMatch(indexSource, /window\.setTimeout\(showPanel, 10000\)/);
assert.doesNotMatch(indexSource, /window\.__WEBGPU_BRUSH_STARTUP__/);
assert.match(mainSource, /new AppDiagnosticsController\(\{/);
assert.doesNotMatch(mainSource, /function buildAppDiagnosticReport|appDiagnosticLog/);
assert.match(controllerSource, /options\.elements\.copyButton\.addEventListener\("click"/);
assert.match(controllerSource, /async buildReport\(\): Promise<string>/);
assert.match(controllerSource, /await this\.buildReport\(\)/);
assert.match(controllerSource, /captureUserAgentData/);
assert.match(controllerSource, /"platformVersion"/);
assert.match(controllerSource, /engine\.captureFillDiagnostics\(\)/);
assert.match(controllerSource, /fillDiagnostics: fillDiagnosticsResult/);
assert.match(
  controllerSource,
  /layerColdTileComposite:[\s\S]*?enabled: stats\.layerColdTileCompositeEnabled,[\s\S]*?\.\.\.stats\.layerColdTileComposite/,
  "il rapporto deve rendere misurabile il fast path cold tile sul dispositivo reale",
);
assert.match(controllerSource, /entryScripts:/);
assert.doesNotMatch(mainSource, /startup-diagnostics/);
assert.doesNotMatch(brushEngineSource, /startup-diagnostics/);
assert.match(brushEngineSource, /deferBlendRenderer: true/);
assert.match(brushEngineSource, /deferSelectionPipelines: true/);
assert.match(brushEngineSource, /ensureOptionalEditorResources\(\)/);
assert.match(resourceSetupSource, /finishStaticResourceCreation\(engine, "core"\)/);
assert.match(mainSource, /"deferred-gpu-pipelines"/);
assert.match(mainSource, /runtimeStatsController\?\.start\(\)/);
assert.match(runtimeStatsSource, /this\.options\.browser\.setInterval\(\(\) => this\.refresh\(\), 1_000\)/);
assert.match(runtimeStatsSource, /recordDiagnostic\("runtime-stats-poll", null, error\)/);
assert.doesNotMatch(mainSource, /startRuntimeStatsPolling|statsPollingTimer|function updateStats/);
assert.match(gpuUtilsSource, /if \(!explicitShaderValidationRequested\(\)\) return/);
assert.match(
  historyMaintenanceSource,
  /if \(!engine\.initialized \|\| !engine\.historyLocalStorage\) return false/,
);
assert.match(
  historyMaintenanceSource,
  /export function scheduleHistoryMaintenance[\s\S]*?if \(!engine\.initialized \|\| !engine\.historyLocalStorage\) return/,
);
assert.match(historyMaintenanceSource, /readonly capturesRefusedForBudget: number;/);
assert.match(historyMaintenanceSource, /readonly checkpointCacheEvictions: number;/);
assert.match(
  historyMaintenanceSource,
  /capturesRefusedForBudget: state\.capturesRefusedForBudget/,
);
assert.match(
  historyMaintenanceSource,
  /checkpointCacheEvictions: state\.checkpointCacheEvictions/,
);
assert.match(gpuMemoryPanelSource, /telemetry\.capturesRefusedForBudget/);
assert.match(gpuMemoryPanelSource, /telemetry\.checkpointCacheEvictions/);
assert.match(controllerSource, /renderFrameError:[\s\S]*?getDocumentInconsistentDiagnostic\(\)/);
assert.match(
  reportsSource,
  /vectorTextRunTextureCount[\s\S]*?fallbackTexture !== null/,
  "la memoria vettoriale deve contare anche le texture fallback vive",
);

console.log("App diagnostics verification passed.");
