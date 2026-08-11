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
const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const gpuUtilsSource = readFileSync(
  new URL("../src/engine-gpu-utils.ts", import.meta.url),
  "utf8",
);
const adaptivePreviewSource = readFileSync(
  new URL("../src/engine-adaptive-preview-runtime.ts", import.meta.url),
  "utf8",
);
const reportsSource = readFileSync(
  new URL("../src/engine-reports.ts", import.meta.url),
  "utf8",
);
assert.match(indexSource, /id="copyAppDiagnostics"/);
assert.match(indexSource, /id="appDiagnosticsReport"/);
assert.match(mainSource, /copyAppDiagnosticsButton\.addEventListener\("click"/);
assert.match(mainSource, /renderFrameError:[\s\S]*?getDocumentInconsistentDiagnostic\(\)/);
assert.match(
  mainSource,
  /import type \{ MixedVectorTextController \}[\s\S]*?await import\("\.\/mixed-vector-text-controller"\)/,
  "font e controller vettoriale devono restare fuori dal percorso JS iniziale",
);
assert.match(
  mainSource,
  /function refreshRuntimeStats\(\)[\s\S]*?if \(!engineInitialized \|\| document\.hidden\) return;/,
  "le statistiche non devono leggere History prima dello startup o in background",
);
assert.match(mainSource, /setInterval\(refreshRuntimeStats, 1_000\)/);
assert(!mainSource.includes("setInterval(() => updateStats(engine.getStats()), 500)"));
assert.match(
  mainSource,
  /scheduleDeferredStartupTask\([\s\S]*?"deferred-brush-restore"[\s\S]*?"deferred-vector-text"/,
  "pennello persistito e font devono caricarsi dopo che il renderer e' utilizzabile",
);
assert.match(mainSource, /"deferred-canonical-stroke"[\s\S]*?loadCanonicalHumanStroke/);
assert(!mainSource.includes("void loadCanonicalHumanStroke();"));
assert.match(
  mainSource,
  /mobileBrushLibrarySheet\.contains\(document\.activeElement\)[\s\S]*?mobilePaintButton\.focus[\s\S]*?setAttribute\("inert", ""\)/,
  "la sheet pennelli deve trasferire il focus prima di diventare inerte",
);
assert.match(brushEngineSource, /android \|\| MOBILE_DEVICE_CLASS[\s\S]*?powerPreference: "high-performance"/);
assert.match(brushEngineSource, /featureLevel: "compatibility"/);
assert.match(
  brushEngineSource,
  /Adapter trovato\. Creo il device WebGPU[\s\S]*?Device pronto\. Preparo il renderer[\s\S]*?Creo il documento iniziale/,
  "lo stato startup deve distinguere adapter, device, renderer e documento",
);
assert.match(
  gpuUtilsSource,
  /import\.meta\.env\.DEV[\s\S]*?validateShaders[\s\S]*?if \(!explicitShaderValidationRequested\(\)\) return;/,
  "la build pubblicata non deve attendere due volte la compilazione di ogni shader",
);
assert.match(
  adaptivePreviewSource,
  /source\.getContext\("2d", \{ willReadFrequently: true \}\)/,
  "la palette adattiva legge frequentemente il canvas sorgente",
);
assert.match(
  reportsSource,
  /vectorTextRunTextureCount[\s\S]*?fallbackTexture !== null/,
  "la memoria vettoriale deve contare anche le texture fallback vive",
);

console.log("App diagnostics verification passed.");
