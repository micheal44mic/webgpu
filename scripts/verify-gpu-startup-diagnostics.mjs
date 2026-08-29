import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const html = read("gpu-startup-diagnostics.html");
const moduleSource = read("src/labs/gpu-startup-diagnostics.ts");
const workerBuilder = read("scripts/prepare-sites-build.mjs");
const migration = read(".openai/drizzle/0006_gpu_startup_diagnostic_runs.sql");
const summaryMigration = read(".openai/drizzle/0007_gpu_startup_diagnostic_summary.sql");
const vite = read("vite.config.ts");
const attach = read("scripts/attach-human-replay-site-build.mjs");
const indexHtml = read("index.html");
const startup = read("src/startup.ts");
const mainSource = read("src/main.ts");
const projectSessionSource = read("src/project-session-controller.ts");
const engineSource = read("src/brush-engine.ts");
const layerRuntimeSource = read("src/engine-layer-runtime.ts");
const featurePolicySource = read("src/gpu-startup-feature-policy.ts");

const DIAGNOSTIC_BUILD = "gpu-diagnostics-application-4096-startup-v16";
const DEFAULT_TEST_ID = "startup-no-tier2-v1";
const DEFAULT_VARIANT = "rgba16float-no-texture-formats-tier2-v1";
const STORAGE_FORMAT_TEST_ID = "storage-format-ab-v1";
const STORAGE_FORMAT_VARIANT =
  "storage-format-ab-rgba8unorm-control-rgba16float-target-write-only-1x1-no-tier2-v1";
const DOCUMENT_PIPELINE_TEST_ID = "document-pipeline-bisect-v1";
const DOCUMENT_PIPELINE_VARIANT = "document-pipeline-bisect-rgba16float-no-tier2-v1";
const APPLICATION_4096_TEST_ID = "application-4096-startup-v1";
const APPLICATION_4096_VARIANT = "application-startup-rgba16float-4096x4096-no-tier2-v1";
const APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID = "application-4096-pipelines-async2-v1";
const APPLICATION_4096_PIPELINES_ASYNC2_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipelines-async2-v1";
const APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID =
  "application-4096-pipelines-first-frame-v1";
const APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipelines-first-frame-1-v1";
const APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID =
  "application-4096-pipeline-breakdown-v1";
const APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipeline-breakdown-sync-v1";
const APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID =
  "application-4096-pipeline-attribution-async1-v1";
const APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipeline-attribution-async1-v1";
const DEFAULT_COMPARISON = {
  layerFormat: "rgba16float",
  canvasFormat: "rgba16float",
  textureFormatsTier2Enabled: false,
  inPlaceGlazeCommitEnabled: false,
  inPlaceGlazeCommitPipelineCreated: false,
};
const STORAGE_FORMAT_COMPARISON = {
  kind: "storage-texture-format-ab",
  controlFormat: "rgba8unorm",
  targetFormat: "rgba16float",
  width: 1,
  height: 1,
  depthOrArrayLayers: 1,
  storageAccess: "write-only",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  deviceReuse: "single-device",
  executionOrder: ["rgba8unorm", "rgba16float"],
};
const DOCUMENT_PIPELINE_COMPARISON = {
  kind: "document-pipeline-bisect",
  targetPhase: "document-pipelines",
  layerFormat: "rgba16float",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  applicationFrame: "isolated-production-startup",
  instrumentation: "native-device-call-boundaries",
  expectedSynchronousPipelineLayouts: 17,
  expectedSynchronousRenderPipelines: 52,
  expectedErrorScopeDrains: 2,
};
const APPLICATION_4096_COMPARISON = {
  kind: "application-startup",
  documentWidth: 4096,
  documentHeight: 4096,
  layerFormat: "rgba16float",
  canvasFormat: "rgba16float",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  applicationFrame: "isolated-production-startup",
  startupMode: "cold-empty-document",
  deferredObservationMs: 5000,
};
const APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON = {
  kind: "application-startup-pipeline-compilation",
  documentWidth: 4096,
  documentHeight: 4096,
  layerFormat: "rgba16float",
  canvasFormat: "rgba16float",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  applicationFrame: "isolated-production-startup",
  startupMode: "cold-empty-document",
  deferredObservationMs: 5000,
  pipelineCompilationMethod: "createRenderPipelineAsync",
  pipelineCompilationConcurrency: 2,
  expectedRenderPipelines: 52,
  asyncFallbackAllowed: false,
};
const APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON = {
  kind: "application-startup-pipeline-compilation",
  documentWidth: 4096,
  documentHeight: 4096,
  layerFormat: "rgba16float",
  canvasFormat: "rgba16float",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  applicationFrame: "isolated-production-startup",
  startupMode: "cold-empty-document",
  deferredObservationMs: 5000,
  pipelineCompilationScope: "first-frame-diagnostic",
  expectedRenderPipelines: 1,
  excludedRenderPipelines: 51,
  editorInteractionEnabled: false,
};
const APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON = {
  kind: "application-startup-render-pipeline-breakdown",
  documentWidth: 4096,
  documentHeight: 4096,
  layerFormat: "rgba16float",
  canvasFormat: "rgba16float",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  applicationFrame: "isolated-production-startup",
  startupMode: "empty-document",
  targetPhase: "document-pipelines",
  instrumentation: "native-device-call-boundaries",
  pipelineCompilationMethod: "createRenderPipeline",
  pipelineCompilationOrder: "sync-sequential",
  expectedPipelineLayouts: 17,
  expectedRenderPipelines: 52,
  expectedErrorScopeDrains: 2,
  capture: "all-native-call-durations",
  deferredObservationMs: 5000,
};
const APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON = {
  kind: "application-startup-render-pipeline-attribution",
  documentWidth: 4096,
  documentHeight: 4096,
  layerFormat: "rgba16float",
  canvasFormat: "rgba16float",
  requiredFeatures: [],
  textureFormatsTier2Requested: false,
  applicationFrame: "isolated-production-startup",
  startupMode: "empty-document",
  targetPhase: "document-pipelines",
  instrumentation: "native-device-call-boundaries",
  pipelineCompilationMethod: "createRenderPipelineAsync",
  pipelineCompilationConcurrency: 1,
  pipelineCompilationOrder: "async-sequential",
  expectedPipelineLayouts: 17,
  expectedRenderPipelines: 52,
  expectedErrorScopeDrains: 2,
  capture: "non-overlapping-async-pipeline-durations",
  timingSemantics: "one-native-async-pipeline-at-a-time",
  deferredObservationMs: 5000,
};
const STORAGE_FORMAT_STAGES = [
  "shader-module",
  "compilation-info",
  "layout",
  "pipeline",
  "texture",
  "binding",
  "dispatch",
  "fence",
];

function storageTimings(offset) {
  return Object.fromEntries(STORAGE_FORMAT_STAGES.map((stage, index) => [
    stage,
    [offset + index + 0.1, offset + index + 0.2],
  ]));
}

function storageTargetFailureResult() {
  return {
    conclusion: "RGBA8 passed; RGBA16F failed at pipeline.",
    verdict: "rgba16float-specific-failure",
    evidence: "format-acceptance-submit-fence-no-readback",
    adapter: {
      mode: "neutral",
      textureFormatsTier2Advertised: true,
    },
    device: {
      requiredFeatures: [],
      textureFormatsTier2Enabled: false,
      uncapturedErrorCount: 0,
      lost: null,
    },
    control: {
      format: "rgba8unorm",
      outcome: "passed",
      passed: true,
      failedStage: null,
      lastStage: "fence",
      internalErrorScopeSupported: true,
      durationMs: 72.8,
      timingsMs: storageTimings(1),
      failure: null,
    },
    target: {
      format: "rgba16float",
      outcome: "failed",
      passed: false,
      failedStage: "pipeline",
      lastStage: "pipeline",
      internalErrorScopeSupported: true,
      durationMs: 46.4,
      timingsMs: storageTimings(11),
      failure: {
        thrown: "OperationError: target pipeline rejected",
        pipelineReason: "validation",
        semanticError: "rgba16float pipeline creation failed validation.",
        scopePushErrors: {},
        scopeErrors: {
          validation: "GPUValidationError: Storage format validation failed for the target pipeline.",
        },
        scopePopErrors: {},
        result: {
          available: true,
          errorCount: 1,
          warningCount: 0,
          messageCount: 1,
          firstMessages: [
            "error 1:1 The target format was rejected while the control format passed.",
          ],
        },
      },
    },
    uncapturedErrors: [],
    totalElapsedMs: 134.2,
  };
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function diagnosticDefinition(testId) {
  if (testId === DEFAULT_TEST_ID) {
    return {
      testId,
      diagnosticVariant: DEFAULT_VARIANT,
      comparison: DEFAULT_COMPARISON,
    };
  }
  if (testId === STORAGE_FORMAT_TEST_ID) {
    return {
      testId,
      diagnosticVariant: STORAGE_FORMAT_VARIANT,
      comparison: STORAGE_FORMAT_COMPARISON,
    };
  }
  if (testId === DOCUMENT_PIPELINE_TEST_ID) {
    return {
      testId,
      diagnosticVariant: DOCUMENT_PIPELINE_VARIANT,
      comparison: DOCUMENT_PIPELINE_COMPARISON,
    };
  }
  if (testId === APPLICATION_4096_TEST_ID) {
    return {
      testId,
      diagnosticVariant: APPLICATION_4096_VARIANT,
      comparison: APPLICATION_4096_COMPARISON,
    };
  }
  if (testId === APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID) {
    return {
      testId,
      diagnosticVariant: APPLICATION_4096_PIPELINES_ASYNC2_VARIANT,
      comparison: APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON,
    };
  }
  if (testId === APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID) {
    return {
      testId,
      diagnosticVariant: APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT,
      comparison: APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON,
    };
  }
  if (testId === APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID) {
    return {
      testId,
      diagnosticVariant: APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT,
      comparison: APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON,
    };
  }
  if (testId === APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID) {
    return {
      testId,
      diagnosticVariant: APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT,
      comparison: APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON,
    };
  }
  throw new Error(`Unknown verification diagnostic test: ${testId}`);
}

function assertDiagnosticSummary(summary, testId, expectedResult) {
  const definition = diagnosticDefinition(testId);
  assert.equal(summary.testId, definition.testId);
  assert.equal(summary.diagnosticVariant, definition.diagnosticVariant);
  assert.deepEqual(jsonValue(summary.comparison), definition.comparison);
  if (arguments.length >= 3) {
    assert.deepEqual(jsonValue(summary.result), jsonValue(expectedResult));
  }
}

const featurePolicyModule = await import(
  `data:text/javascript;base64,${Buffer.from(featurePolicySource).toString("base64")}`
);
const suppressTier2 = featurePolicyModule.suppressTextureFormatsTier2ForGpuStartup;
assert.equal(typeof suppressTier2, "function");
assert.equal(
  suppressTier2(
    "/gpu-startup-app-frame",
    "?diagnosticBoot=1&forceGlazeCommitFallback=1",
  ),
  true,
);
for (const [pathname, search] of [
  ["/gpu-startup-app-frame", "?forceGlazeCommitFallback=1"],
  ["/gpu-startup-app-frame", "?diagnosticBoot=1"],
  ["/", "?diagnosticBoot=1&forceGlazeCommitFallback=1"],
  ["/index.html", "?diagnosticBoot=1&forceGlazeCommitFallback=1"],
  ["/prefix/gpu-startup-app-frame", "?diagnosticBoot=1&forceGlazeCommitFallback=1"],
  ["/gpu-startup-app-frame-extra", "?diagnosticBoot=1&forceGlazeCommitFallback=1"],
]) {
  assert.equal(suppressTier2(pathname, search), false, `Tier 2 leaked into ${pathname}.`);
}

const inlineBootstrapIndex = html.indexOf("inline-bootstrap-started");
const moduleScriptIndex = html.indexOf('type="module" src="/src/labs/gpu-startup-diagnostics.ts"');
const diagnosticBuild = html.match(/var BUILD = "([^"]+)"/)?.[1];
assert.equal(diagnosticBuild, DIAGNOSTIC_BUILD);
assert.ok(
  workerBuilder.includes(`GPU_STARTUP_DIAGNOSTIC_BUILD = "${diagnosticBuild}"`),
  "Client and Worker diagnostic builds must match.",
);
assert.ok(inlineBootstrapIndex >= 0, "Missing early inline diagnostic bootstrap.");
assert.ok(moduleScriptIndex > inlineBootstrapIndex, "The diagnostic bootstrap must run before its module asset.");
assert.match(html, /window\.history\.replaceState\(null, "", window\.location\.pathname \+ window\.location\.search\)/);
assert.match(html, /window\.addEventListener\("error"/);
assert.match(html, /window\.addEventListener\("unhandledrejection"/);
assert.match(html, /window\.addEventListener\("pagehide"/);
assert.match(html, /navigator\.sendBeacon/);
assert.match(html, /keepalive: keepalive === true/);
assert.match(html, /function serializedBreadcrumbSnapshot\(event\)/);
assert.match(html, /function compactBreadcrumbCall\(value\)/);
assert.match(html, /function compactBreadcrumbGpuEvent\(value\)/);
assert.match(html, /function compactBreadcrumbDetail\(name, value\)/);
assert.match(html, /function recordBreadcrumb\(name, detail, status\)/);
assert.match(html, /return postSnapshot\(\s*body,\s*false,/);
assert.match(html, /MAX_SNAPSHOT_BYTES = 48 \* 1024/);
assert.match(
  html,
  /MAX_DIAGNOSTIC_RESULT_BYTES = APPLICATION_4096_PIPELINE_BREAKDOWN_TEST[\s\S]*18 \* 1024[\s\S]*12 \* 1024/,
);
assert.match(html, /truncateUtf8/);
assert.match(html, /terminalUploadPromise/);
assert.match(html, /new window\.AbortController/);
assert.match(html, /probeFinished/);
assert.match(html, /reportStored/);
assert.match(html, /lastHeartbeatAt/);
assert.match(html, /acknowledgement\.acknowledged === true/);
assert.match(html, /storedStatus === expectedStatus/);
assert.match(html, /localStorage\.getItem\(backupStorageKey\)/);
assert.match(html, /localStorage\.setItem\(backupStorageKey/);
assert.match(html, /BACKUP_LIFETIME_MS = 24 \* 60 \* 60 \* 1000/);
assert.match(html, /MAX_BACKUP_EVENT_COUNT = 128/);
assert.match(html, /recoveredBackupAttempts/);
assert.match(html, /manualDiagnosticBackup/);
assert.match(html, /sanitizeBackupValue/);
assert.match(html, /String\(key\)\.toLowerCase\(\) === "writetoken"/);
assert.match(html, /navigator\.clipboard\.writeText/);
assert.match(html, /document\.execCommand\("copy"\)/);
assert.match(html, />Copy JSON</);
assert.match(html, /sessionStorage\.setItem\(capabilityKey/);
assert.match(html, /sessionStorage\.getItem\(capabilityKey/);
assert.match(html, /application-startup-phase/);
assert.match(html, /diagnosticElapsed/);
assert.match(html, /Very slow or stopped here/);
assert.match(html, /App boot · RGBA16F · Tier 2 off/);
assert.match(html, /1×1 · RGBA8 vs RGBA16F · storage write/);
assert.match(html, /Real document pipelines · RGBA16F · Tier 2 off/);
assert.match(html, /Real 4096×4096 document · RGBA16F · Tier 2 off/);
assert.match(html, /Real 4096×4096 document · 71 timed GPU calls · Tier 2 off/);
assert.match(html, /requestedTestId \|\| "startup-no-tier2-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "storage-format-ab-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "document-pipeline-bisect-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "application-4096-startup-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "application-4096-pipelines-async2-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "application-4096-pipelines-first-frame-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "application-4096-pipeline-breakdown-v1"/);
assert.match(
  html,
  /DIAGNOSTIC_TEST_ID === "application-4096-pipeline-attribution-async1-v1"/,
);
assert.match(html, new RegExp(APPLICATION_4096_PIPELINES_ASYNC2_VARIANT));
assert.match(html, new RegExp(APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT));
assert.match(html, new RegExp(APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT));
assert.match(html, new RegExp(APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT));
assert.match(html, /documentWidth: 4096/);
assert.match(html, /documentHeight: 4096/);
assert.match(html, /startupMode: "cold-empty-document"/);
assert.match(html, /deferredObservationMs: 5000/);
assert.match(html, /pipelineCompilationMethod: "createRenderPipelineAsync"/);
assert.match(html, /pipelineCompilationConcurrency: 2/);
assert.match(html, /expectedRenderPipelines: 52/);
assert.match(html, /asyncFallbackAllowed: false/);
assert.match(html, /pipelineCompilationScope: "first-frame-diagnostic"/);
assert.match(html, /expectedRenderPipelines: 1/);
assert.match(html, /excludedRenderPipelines: 51/);
assert.match(html, /editorInteractionEnabled: false/);
assert.match(html, /kind: "application-startup-render-pipeline-breakdown"/);
assert.match(html, /pipelineCompilationOrder: "sync-sequential"/);
assert.match(html, /capture: "all-native-call-durations"/);
assert.match(html, /kind: "application-startup-render-pipeline-attribution"/);
assert.match(html, /pipelineCompilationConcurrency: 1/);
assert.match(html, /pipelineCompilationOrder: "async-sequential"/);
assert.match(html, /capture: "non-overlapping-async-pipeline-durations"/);
assert.match(html, /timingSemantics: "one-native-async-pipeline-at-a-time"/);
assert.match(html, /function applyDocumentPipelineBreakdownEvent\(name, detail\)/);
assert.match(html, /function createDocumentPipelineBreakdown\(phase\)/);
assert.match(html, /"Pipeline layouts"/);
for (const groupLabel of [
  "Erase stamps",
  "Direct color stamps",
  "Precision color accumulation",
  "Coverage accumulation",
  "Live accumulation resolve",
  "Display and live mips",
  "Document composition",
]) {
  assert.match(html, new RegExp(`label: "${groupLabel}"`));
}
assert.match(html, /"Error-scope drains"/);
assert.match(html, /"Pre-call diagnostic checkpoints"/);
assert.match(html, /"Remaining phase work and reporting"/);
assert.match(html, /incremental time needed to make that native asynchronous render pipeline ready/);
assert.match(html, /Concurrency is 1, so durations do not overlap/);
assert.match(html, /first value can also include earlier GPU work queued before this phase/);
assert.match(html, /Percentages use the total time of all 52 render pipelines/);
assert.match(html, /grid-column: 2 \/ -1/);
assert.match(html, /display: display/);
assert.match(html, /function displayBatch\(entries\)/);
assert.match(html, /displayBatch: displayBatch/);
assert.match(html, /expectedSynchronousPipelineLayouts: 17/);
assert.match(html, /expectedSynchronousRenderPipelines: 52/);
assert.match(html, /expectedErrorScopeDrains: 2/);
assert.match(html, /diagnosticVariant: DIAGNOSTIC_VARIANT/);
assert.match(html, /testId: DIAGNOSTIC_TEST_ID/);
assert.match(html, /result: diagnosticResult/);
assert.match(html, /textureFormatsTier2Enabled: false/);
assert.match(
  workerBuilder,
  /call\.instrumentationPreparationMs = finiteNumber\([\s\S]*?call\.nativeStartedAtMs = finiteNumber\(performance\.now\(\)\);\s*result = Reflect\.apply\(original, device, arguments\);/,
);

assert.match(moduleSource, /requestAdapter\(adapterOptions\)/);
assert.match(moduleSource, /featureLevel: "compatibility"/);
assert.match(moduleSource, /format: "rgba16float"/);
assert.match(moduleSource, /GPUTextureUsage\.STORAGE_BINDING/);
assert.match(moduleSource, /DIAGNOSTIC_DOCUMENT_WIDTH = 2048/);
assert.match(moduleSource, /rgba16float-document-texture-cleared/);
assert.match(moduleSource, /failed WebGPU validation or memory checks/);
assert.match(moduleSource, /vertex-stage-storage-buffer-layout/);
assert.match(moduleSource, /compute-workgroup-256-pipeline/);
assert.match(moduleSource, /application-navigation-started/);
assert.match(moduleSource, /application-boot-completed/);
assert.match(moduleSource, /projectSessionReady/);
assert.match(moduleSource, /runFullApplicationBoot\(\)/);
assert.match(moduleSource, /APP_FRAME_DIAGNOSTIC_CHANNEL = "gpu-startup-app-frame-v3"/);
assert.match(moduleSource, /APPLICATION_BOOT_VARIANT = "rgba16float-no-texture-formats-tier2-v1"/);
assert.match(moduleSource, /STORAGE_FORMAT_AB_TEST = "storage-format-ab-v1"/);
assert.match(moduleSource, new RegExp(STORAGE_FORMAT_VARIANT));
assert.match(moduleSource, /DOCUMENT_PIPELINE_TEST = "document-pipeline-bisect-v1"/);
assert.match(moduleSource, new RegExp(DOCUMENT_PIPELINE_VARIANT));
assert.match(moduleSource, /APPLICATION_4096_TEST = "application-4096-startup-v1"/);
assert.match(moduleSource, new RegExp(APPLICATION_4096_VARIANT));
assert.match(
  moduleSource,
  /APPLICATION_4096_PIPELINES_ASYNC2_TEST = "application-4096-pipelines-async2-v1"/,
);
assert.match(moduleSource, new RegExp(APPLICATION_4096_PIPELINES_ASYNC2_VARIANT));
assert.match(
  moduleSource,
  /APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST =\s*"application-4096-pipelines-first-frame-v1"/,
);
assert.match(moduleSource, new RegExp(APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT));
assert.match(
  moduleSource,
  /APPLICATION_4096_PIPELINE_BREAKDOWN_TEST =\s*"application-4096-pipeline-breakdown-v1"/,
);
assert.match(moduleSource, new RegExp(APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT));
assert.match(
  moduleSource,
  /APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST =\s*"application-4096-pipeline-attribution-async1-v1"/,
);
assert.match(moduleSource, new RegExp(APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT));
assert.match(moduleSource, /APPLICATION_4096_DOCUMENT_WIDTH = 4096/);
assert.match(moduleSource, /APPLICATION_4096_DOCUMENT_HEIGHT = 4096/);
assert.doesNotMatch(moduleSource, /createNewProject|diagnostic-new-project/);
assert.match(moduleSource, /diagnosticTest !== DOCUMENT_PIPELINE_TEST[\s\S]*Unsupported GPU diagnostic test/);
assert.match(moduleSource, /if \(storageFormatAbEnabled\) \{\s*await runStorageFormatAbDiagnostic\(\);\s*return;/);
assert.match(moduleSource, /if \(documentPipelineBisectEnabled\) \{\s*await runDocumentPipelineBisectDiagnostic\(\);\s*return;/);
assert.match(moduleSource, /if \(application4096StartupEnabled\) \{\s*await runApplication4096StartupDiagnostic\(\);\s*return;/);
assert.match(
  moduleSource,
  /if \(application4096PipelinesAsync2Enabled\) \{\s*await runApplication4096StartupDiagnostic\(\{ asynchronousPipelineCompilation: true \}\);\s*return;/,
);
assert.match(
  moduleSource,
  /if \(application4096PipelinesFirstFrameEnabled\) \{\s*await runApplication4096StartupDiagnostic\(\{ firstFramePipelineCompilation: true \}\);\s*return;/,
);
assert.match(
  moduleSource,
  /if \(application4096PipelineTimingEnabled\) \{\s*await runApplication4096PipelineBreakdownDiagnostic\(\);\s*return;/,
);
assert.match(
  moduleSource,
  /application4096PipelineBreakdownEnabled\s*&& \(type === "document-gpu-call-completed" \|\| type === "document-gpu-call-failed"\)/,
);
assert.match(
  moduleSource,
  /if \(attributionEnabled\) bridge\.displayBatch\?\.\(documentPipelineTrace\.calls\)/,
);
assert.match(moduleSource, /applicationBoot = await runFullApplicationBoot\(\)/);
assert.match(moduleSource, /const requiredFeatures: GPUFeatureName\[\] = \[\]/);
assert.match(moduleSource, /adapter\.requestDevice\(\{ requiredFeatures \}\)/);
assert.match(
  moduleSource,
  /var outputTexture: texture_storage_2d<\$\{format\}, write>/,
);
assert.match(
  moduleSource,
  /textureStore\(outputTexture, vec2<i32>\(0, 0\), vec4<f32>/,
);
assert.match(
  moduleSource,
  /var outputTexture: texture_storage_2d<rgba16float, write>/,
);
assert.doesNotMatch(moduleSource, /\bvar target\s*:/);
assert.doesNotMatch(moduleSource, /textureStore\(target\b/);
assert.match(moduleSource, /storageTexture:\s*\{\s*access: "write-only",\s*format,/);
assert.match(moduleSource, /size: \[1, 1, 1\]/);
assert.match(moduleSource, /usage: GPUTextureUsage\.STORAGE_BINDING/);
assert.match(moduleSource, /device\.queue\.onSubmittedWorkDone\(\)/);
assert.match(moduleSource, /runStorageFormatCase\(\s*device,\s*diagnosticStartedAt,\s*"rgba8unorm",\s*"rgba8"/);
assert.match(moduleSource, /runStorageFormatCase\(\s*device,\s*diagnosticStartedAt,\s*"rgba16float",\s*"rgba16"/);
assert.match(moduleSource, /if \(control\.passed && target\.passed\)[\s\S]*verdict = "both-formats-passed"/);
assert.match(moduleSource, /else if \(control\.passed\)[\s\S]*verdict = "rgba16float-specific-failure"/);
assert.match(moduleSource, /deviceLostInfo \|\| controlTimedOut[\s\S]*failedStage: deviceLostInfo \? "device-lost" : "control-timeout"/);
assert.match(moduleSource, /evidence: "format-acceptance-submit-fence-no-readback"/);
assert.match(moduleSource, /timingsMs: Object\.fromEntries/);
assert.match(moduleSource, /firstMessages:/);
assert.match(moduleSource, /const diagnosticCompleted = control\.passed[\s\S]*bridge\.finish\([\s\S]*diagnosticCompleted \? "completed" : "failed"/);
assert.ok(
  moduleSource.indexOf("device = await withTimeout(deviceRequest")
    < moduleSource.indexOf("const textureFormatsTier2Enabled = device.features.has"),
  "The Tier 2 observation must read the created feature-neutral device.",
);
assert.match(moduleSource, /target\.searchParams\.set\("forceGlazeCommitFallback", "1"\)/);
assert.match(moduleSource, /target\.searchParams\.set\("diagnosticVariant", expectedDiagnosticVariant\)/);
assert.match(moduleSource, /target\.searchParams\.set\("test", options\.diagnosticTestId\)/);
assert.match(moduleSource, /target\.searchParams\.set\("documentWidth", String\(documentWidth\)\)/);
assert.match(moduleSource, /target\.searchParams\.set\("documentHeight", String\(documentHeight\)\)/);
assert.match(moduleSource, /target\.searchParams\.set\("documentSize", String\(documentWidth\)\)/);
assert.match(moduleSource, /documentWidth: APPLICATION_4096_DOCUMENT_WIDTH/);
assert.match(moduleSource, /documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT/);
assert.match(moduleSource, /"first-frame-submit"/);
assert.match(moduleSource, /"first-frame-gpu"/);
assert.match(moduleSource, /"editor-ready"/);
assert.match(moduleSource, /applicationGpuObservationPassed/);
assert.match(moduleSource, /requireStorageSummary: true/);
assert.match(moduleSource, /requireGpuObservation: true/);
assert.match(moduleSource, /"application-4096-startup-passed"/);
assert.match(moduleSource, /rgba16floatLayerBytes: APPLICATION_4096_DOCUMENT_WIDTH/);
assert.match(moduleSource, /documentPipelinesPhase: trace\.phaseProgress\["document-pipelines"\]/);
assert.match(moduleSource, /editorReadyPhase: trace\.phaseProgress\["editor-ready"\]/);
assert.match(moduleSource, /stats\.strategy === "async-bounded"/);
assert.match(moduleSource, /stats\.nativeAsyncSupported === true/);
assert.match(moduleSource, /stats\.fallbackCount === 0/);
assert.match(moduleSource, /verdict: "application-4096-pipelines-async2-inconclusive"/);
assert.match(moduleSource, /"application-4096-pipelines-async2-passed"/);
assert.match(moduleSource, /verdict = "application-4096-pipelines-async2-unsupported"/);
assert.match(moduleSource, /native createrenderpipelineasync is required/);
assert.match(moduleSource, /peakActiveCount === requestedConcurrency/);
assert.match(moduleSource, /validateAsyncPipelineCompilation\(startupTrace\)/);
assert.match(moduleSource, /stats\.scope === "first-frame-diagnostic"/);
assert.match(moduleSource, /stats\.format === "rgba16float"/);
assert.match(moduleSource, /stats\.requestedConcurrency === 1/);
assert.match(moduleSource, /stats\.logicalRenderPipelineCount === EXPECTED_DOCUMENT_RENDER_PIPELINES/);
assert.match(moduleSource, /stats\.excludedRenderPipelineCount/);
assert.match(moduleSource, /stats\.compiledPipelineKeys\[0\] === "paint-mip-downsample"/);
assert.match(moduleSource, /stats\.peakActiveCount === 1/);
assert.match(moduleSource, /"application-4096-pipelines-first-frame-passed"/);
assert.match(moduleSource, /verdict: "application-4096-pipelines-first-frame-inconclusive"/);
assert.match(moduleSource, /function documentPipelineBreakdownSummary\(/);
assert.match(moduleSource, /expectedMeasuredCallCount: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS/);
assert.match(moduleSource, /slowestRenderPipelineIndex:/);
assert.match(moduleSource, /slowestRenderPipelineDurationMs:/);
assert.match(moduleSource, /pipelineLayouts: layoutCalls/);
assert.match(moduleSource, /renderPipelineGroups: DOCUMENT_RENDER_PIPELINE_GROUPS\.map/);
assert.match(moduleSource, /renderPipelineMethod: trace\.renderPipelineMethod/);
assert.match(moduleSource, /trace\.renderPipelineMethod === "createRenderPipelineAsync"/);
assert.match(moduleSource, /firstRenderPipelineMayIncludePriorQueuedGpuWork:/);
assert.match(moduleSource, /errorScopeDrains: errorScopeCalls/);
assert.match(moduleSource, /preCallDiagnosticTotalMs:/);
assert.match(moduleSource, /phaseMinusPreCallDiagnosticMs:/);
assert.match(moduleSource, /remainingPhaseWorkAndReportingMs:/);
assert.doesNotMatch(moduleSource, /rankedSlowestRenderPipelines/);
assert.doesNotMatch(
  moduleSource.match(/function compactTimedDocumentPipelineCall[\s\S]*?\n}\n/)?.[0] ?? "",
  /instrumentationPreparationMs/,
);
assert.match(moduleSource, /"erase-stamps"/);
assert.match(moduleSource, /"document-composition"/);
assert.match(moduleSource, /documentPipelineBreakdownPassed/);
assert.match(moduleSource, /const verdictPrefix = attributionEnabled/);
assert.match(moduleSource, /\? "application-4096-pipeline-attribution"/);
assert.match(moduleSource, /: "application-4096-pipeline-breakdown"/);
assert.match(moduleSource, /verdict: `\$\{verdictPrefix\}-inconclusive`/);
assert.match(moduleSource, /verdict: `\$\{verdictPrefix\}-passed`/);
assert.match(moduleSource, /validateAsyncPipelineCompilation\(startupTrace, 1\)/);
assert.match(moduleSource, /complete non-overlapping 52-pipeline attribution contract/);
assert.match(moduleSource, /two error-scope drains were timed individually/);
assert.match(moduleSource, /bridge\.display\?\./);
assert.match(
  moduleSource,
  /const engineReady = \/\\bok\\b\/\.test\(statusClass\)[\s\S]*statusText\.includes\("WebGPU is ready"\)/,
);
assert.match(
  moduleSource,
  /engineReady[\s\S]*state\.projectSessionReady === true[\s\S]*bootstrapReady[\s\S]*extensionCreated[\s\S]*engineReport !== null[\s\S]*requiredStartupPhasesCompleted/,
);
assert.match(
  moduleSource,
  /window\.setTimeout\(resolve, APPLICATION_DEFERRED_OBSERVATION_MS\)[\s\S]*completedState\.runtimeStatsStarted !== true[\s\S]*applicationConsoleErrors\.length > 0[\s\S]*required GPU startup phase regressed/,
);
assert.match(moduleSource, /renderPipelineStartedCount === EXPECTED_DOCUMENT_RENDER_PIPELINES/);
assert.match(moduleSource, /renderPipelineCompletedCount === EXPECTED_DOCUMENT_RENDER_PIPELINES/);
assert.match(moduleSource, /pipelineLayoutStartedCount === EXPECTED_DOCUMENT_PIPELINE_LAYOUTS/);
assert.match(moduleSource, /pipelineLayoutCompletedCount === EXPECTED_DOCUMENT_PIPELINE_LAYOUTS/);
assert.match(moduleSource, /popErrorScopeStartedCount === EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS/);
assert.match(moduleSource, /popErrorScopeCompletedCount === EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS/);
assert.match(moduleSource, /lastScopeError: trace\.lastScopeError/);
assert.match(moduleSource, /function compactDocumentPipelineError\(value: unknown\)/);
assert.match(moduleSource, /calls: trace\.calls\.slice\(-4\)/);
assert.match(moduleSource, /applicationBoot: documentPipelineApplicationSummary\(applicationBoot\)/);
assert.match(moduleSource, /verdict: "document-pipelines-passed"/);
assert.match(moduleSource, /verdict = "document-pipelines-passed-later-startup-failed"/);
assert.match(moduleSource, /featureIsolation\.textureFormatsTier2Enabled !== false/);
assert.match(moduleSource, /featureIsolation\.inPlaceGlazeCommitEnabled !== false/);
assert.match(moduleSource, /featureIsolation\.inPlaceGlazeCommitPipelineCreated !== false/);
assert.match(moduleSource, /probeVariant: "advertised-tier2-baseline"/);
assert.match(moduleSource, /APPLICATION_BOOT_TIMEOUT_MS = 10 \* 60_000/);
assert.match(moduleSource, /APPLICATION_DOCUMENT_LOAD_TIMEOUT_MS = 3 \* 60_000/);
assert.match(moduleSource, /application-startup-phase/);
assert.match(moduleSource, /validateApplicationEngineReport/);
assert.match(moduleSource, /lateDevice\.destroy\(\)/);
assert.doesNotMatch(moduleSource, /import\("\.\.\/brush-engine"\)/);

assert.doesNotMatch(engineSource, /requiredFeatures\.push\(textureFormatsTier2\)/);
assert.match(engineSource, /const requiredFeatures: GPUFeatureName\[\] = \[\]/);
assert.match(engineSource, /this\.lightGlazeInPlaceCommitSupported = false/);
assert.match(
  engineSource,
  /if \(\s*!this\.selectedBrushPreparationDeferred\s*\|\| this\.selectedBrushPreparationRequested\s*\) \{[\s\S]*?await this\.runStartupPhase\(\s*"selected-brush-first-use"/,
);
assert.match(
  engineSource,
  /recreateLayerResources\(this, this\.layerFormat, \{\s*deferBlendRenderer: true,\s*deferSelectionPipelines: true,/,
);
const documentPipelinePhaseStart = layerRuntimeSource.indexOf('"document-pipelines"');
const documentPipelinePhaseEnd = layerRuntimeSource.indexOf(
  "// Recreating the document",
  documentPipelinePhaseStart,
);
assert.ok(documentPipelinePhaseStart >= 0 && documentPipelinePhaseEnd > documentPipelinePhaseStart);
const documentPipelinePhaseSource = layerRuntimeSource.slice(
  documentPipelinePhaseStart,
  documentPipelinePhaseEnd,
);
const literalRenderPipelineCalls = (
  documentPipelinePhaseSource.match(/compileDocumentRenderPipeline\(/g) ?? []
).length;
const literalPipelineLayoutCalls = (
  documentPipelinePhaseSource.match(/engine\.device\.createPipelineLayout\(/g) ?? []
).length;
const erasePipelineFactoryCalls = (
  documentPipelinePhaseSource.match(/createErasePipeline\(/g) ?? []
).length;
const glazePipelineFactoryCalls = (
  documentPipelinePhaseSource.match(/createRgba16FloatGlazePipeline\(/g) ?? []
).length;
const lightPipelineFactoryCalls = (
  documentPipelinePhaseSource.match(/createLightNoBuildUpPipeline\(/g) ?? []
).length;
assert.equal(literalRenderPipelineCalls, 30);
assert.equal(literalPipelineLayoutCalls, 18);
assert.equal(erasePipelineFactoryCalls, 6);
assert.equal(glazePipelineFactoryCalls, 12);
assert.equal(lightPipelineFactoryCalls, 6);
assert.equal(
  literalRenderPipelineCalls - 2
    + erasePipelineFactoryCalls
    + glazePipelineFactoryCalls
    + lightPipelineFactoryCalls,
  DOCUMENT_PIPELINE_COMPARISON.expectedSynchronousRenderPipelines,
  "The diagnostic pipeline count must track the exact production descriptor path.",
);
assert.equal(
  literalPipelineLayoutCalls - 1,
  DOCUMENT_PIPELINE_COMPARISON.expectedSynchronousPipelineLayouts,
  "The no-Tier-2 layout count must exclude only the conditional in-place layout.",
);
assert.equal(DOCUMENT_PIPELINE_COMPARISON.expectedErrorScopeDrains, 2);
assert.match(documentPipelinePhaseSource, /if \(!options\.deferSelectionPipelines\)/);
assert.match(layerRuntimeSource, /Promise\.allSettled\(promises\)/);
assert.match(layerRuntimeSource, /device\.createRenderPipelineAsync\(descriptor\)/);
assert.match(layerRuntimeSource, /Native createRenderPipelineAsync is required/);
assert.match(layerRuntimeSource, /strategy: "sync-sequential" \| "async-bounded"/);
assert.match(layerRuntimeSource, /expectedRenderPipelineCount: expectedDocumentRenderPipelineCount/);
assert.match(layerRuntimeSource, /EXPECTED_FIRST_FRAME_RENDER_PIPELINE_COUNT = 1/);
assert.match(layerRuntimeSource, /documentPipelineCompilationScope === "first-frame-diagnostic"/);
assert.match(layerRuntimeSource, /logicalRenderPipelineCount: EXPECTED_DOCUMENT_RENDER_PIPELINE_COUNT/);
assert.match(layerRuntimeSource, /excludedRenderPipelineCount: EXPECTED_DOCUMENT_RENDER_PIPELINE_COUNT/);
assert.match(layerRuntimeSource, /compiledPipelineKeys\.push\("paint-mip-downsample"\)/);
assert.match(layerRuntimeSource, /documentPipelineCompilationStats\.activeCount !== 0/);

assert.match(workerBuilder, /GPU_STARTUP_DIAGNOSTIC_HTML/);
assert.match(workerBuilder, /GPU_STARTUP_DIAGNOSTIC_PAGE_PATH = "\/gpu-startup-lab"/);
assert.match(workerBuilder, /GPU_STARTUP_APP_FRAME_PATH = "\/gpu-startup-app-frame"/);
assert.match(workerBuilder, /restorePersistedBrushOnStartup: true/);
assert.match(workerBuilder, /startupProgressEnabled: true/);
assert.match(workerBuilder, /handleEngineStartupProgress/);
assert.match(workerBuilder, /DOCUMENT_PIPELINE_TEST_ID = "document-pipeline-bisect-v1"/);
assert.match(workerBuilder, /APPLICATION_4096_TEST_ID = "application-4096-startup-v1"/);
assert.match(workerBuilder, new RegExp(APPLICATION_4096_VARIANT));
assert.match(
  workerBuilder,
  /APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID = "application-4096-pipelines-async2-v1"/,
);
assert.match(workerBuilder, new RegExp(APPLICATION_4096_PIPELINES_ASYNC2_VARIANT));
assert.match(
  workerBuilder,
  /engineOptions: application4096PipelinesFirstFrameEnabled[\s\S]*documentPipelineCompilationScope: "first-frame-diagnostic"[\s\S]*application4096PipelinesAsync2Enabled[\s\S]*documentPipelineCompilationConcurrency: 2/,
);
assert.match(
  workerBuilder,
  /APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID =[\s\S]*"application-4096-pipelines-first-frame-v1"/,
);
assert.match(workerBuilder, new RegExp(APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT));
assert.match(
  workerBuilder,
  /APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID =\s*"application-4096-pipeline-breakdown-v1"/,
);
assert.match(workerBuilder, new RegExp(APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT));
assert.match(
  workerBuilder,
  /APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID =\s*"application-4096-pipeline-attribution-async1-v1"/,
);
assert.match(workerBuilder, new RegExp(APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT));
assert.match(
  workerBuilder,
  /documentPipelineInstrumentationEnabled =\s*diagnosticTestId === DOCUMENT_PIPELINE_TEST_ID\s*\|\| application4096PipelineBreakdownEnabled\s*\|\| application4096PipelineAttributionEnabled/,
);
assert.match(
  workerBuilder,
  /application4096PipelineAttributionEnabled[\s\S]*documentPipelineCompilationConcurrency: 1/,
);
assert.match(workerBuilder, /startupMode: "cold-empty-document"/);
assert.match(workerBuilder, /document\.documentElement\.style\.pointerEvents = "none"/);
assert.match(workerBuilder, /document\.body\.inert = true/);
assert.match(workerBuilder, /event\.stopImmediatePropagation\(\)/);
assert.match(workerBuilder, /EXPECTED_DOCUMENT_RENDER_PIPELINES = 52/);
assert.match(workerBuilder, /EXPECTED_DOCUMENT_PIPELINE_LAYOUTS = 17/);
assert.match(workerBuilder, /EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS = 2/);
assert.match(workerBuilder, /Object\.keys\(value\)\.slice\(0, 24\)/);
assert.match(workerBuilder, /if \(depth >= 3\) return clippedString/);
assert.match(workerBuilder, /bridge\.recordBreadcrumb\(name, detail, status \|\| "running"\)/);
assert.match(workerBuilder, /wrapDocumentGpuMethod\(device, "createPipelineLayout", false\)/);
assert.match(
  workerBuilder,
  /renderPipelineMethod = application4096PipelineAttributionEnabled[\s\S]*\? "createRenderPipelineAsync"[\s\S]*: "createRenderPipeline"/,
);
assert.match(
  workerBuilder,
  /wrapDocumentGpuMethod\(\s*device,\s*renderPipelineMethod,\s*application4096PipelineAttributionEnabled/,
);
assert.match(
  workerBuilder,
  /call\.method === "createRenderPipeline"\s*\|\| call\.method === "createRenderPipelineAsync"[\s\S]*completedDocumentRenderPipelines \+= 1/,
);
assert.match(workerBuilder, /wrapDocumentGpuMethod\(device, "popErrorScope", true\)/);
assert.match(workerBuilder, /durableRecord\(\s*"application-document-gpu-call-started"/);
assert.match(workerBuilder, /previousCompletedRenderPipeline: lastCompletedRenderPipeline/);
assert.match(workerBuilder, /window\.__gpuStartupDiagnosticTeardown === true/);
assert.doesNotMatch(workerBuilder, /applicationEngineReady/);
assert.match(workerBuilder, /updateApplicationStartupPhase\(progress\)/);
assert.match(workerBuilder, /installApplicationGpuObservation\(\)/);
assert.match(workerBuilder, /nativePipelineMethodsWrapped: false/);
assert.match(workerBuilder, /application-gpu-device-lost/);
assert.match(workerBuilder, /application-gpu-uncaptured-error/);
assert.match(workerBuilder, /durableCheckpoint: durableCheckpoint/);
assert.match(workerBuilder, /textureFormatsTier2Enabled: engine\.device\.features\.has\("texture-formats-tier2"\)/);
assert.match(workerBuilder, /textureFormatsTier2Advertised: engine\.adapter\?\.features\?\.has\("texture-formats-tier2"\) === true/);
assert.match(workerBuilder, /inPlaceGlazeCommitEnabled: engine\.lightGlazeInPlaceCommitSupported === true/);
assert.match(workerBuilder, /inPlaceGlazeCommitPipelineCreated: engine\.lightGlazeInPlaceCommitPipeline != null/);
const productionStartupStart = mainSource.indexOf("void engine.initialize()");
const productionStartupEnd = mainSource.indexOf(
  "\n  .catch((error) => {",
  productionStartupStart,
);
assert.ok(productionStartupStart >= 0 && productionStartupEnd > productionStartupStart);
const productionStartupBody = mainSource.slice(productionStartupStart, productionStartupEnd);
assert.doesNotMatch(
  productionStartupBody,
  /scheduleDeferredStartupTask|ensureOptionalEditorResources|prewarmRaster|initializeMixedSceneController|prepareGpuResources/,
  "the diagnostic production startup must remain free of optional GPU warm-up",
);
assert.match(projectSessionSource, /await this\.save\(\{ captureThumbnail: false \}\)/);
assert.match(projectSessionSource, /options\.captureThumbnail !== false/);
assert.match(workerBuilder, /gpuStartupDiagnosticDefinition\(payload\.summary\.testId\)/);
assert.match(workerBuilder, /validGpuStartupDiagnosticComparison\(comparison, definition\.comparison\)/);
assert.match(workerBuilder, /new TextEncoder\(\)\.encode\(summaryJson\)\.byteLength > 24 \* 1024/);
assert.match(workerBuilder, /SELECT result_summary FROM gpu_startup_diagnostic_runs/);
assert.match(workerBuilder, /Diagnostic run is already bound to another test/);
assert.match(workerBuilder, /Unknown GPU diagnostic test/);
assert.match(workerBuilder, /readLimitedJson\(request, 64 \* 1024\)/);
assert.match(workerBuilder, /sha256Hex\(payload\.writeToken\)/);
assert.match(workerBuilder, /write_token_hash/);
assert.match(workerBuilder, /latest_event/);
assert.match(workerBuilder, /result_summary/);
assert.match(workerBuilder, /function serializeGpuStartupDiagnosticResultSummary\(summary, status\)/);
assert.match(workerBuilder, /schema: "pipeline-attribution-ms-v1"/);
assert.match(workerBuilder, /GPU_STARTUP_PIPELINE_ATTRIBUTION_SUMMARY_MAX_BYTES = 1536/);
assert.match(workerBuilder, /new TextEncoder\(\)\.encode\(serializedCompactSummary\)\.byteLength/);
assert.match(workerBuilder, /schema: "pipeline-attribution-summary-overflow-v1"/);
assert.match(workerBuilder, /const pipelineMs = indexedGpuStartupTimings\(pipelineCalls, 52\)/);
assert.match(workerBuilder, /const layoutMs = indexedGpuStartupTimings\(breakdown\?\.pipelineLayouts, 17\)/);
assert.match(workerBuilder, /const drainMs = indexedGpuStartupTimings\(breakdown\?\.errorScopeDrains, 2\)/);
assert.match(
  workerBuilder,
  /const resultSummary = serializeGpuStartupDiagnosticResultSummary\(\s*payload\.summary,\s*payload\.status/,
);
assert.match(workerBuilder, /payload_bytes/);
assert.match(workerBuilder, /acknowledged: true/);
assert.match(workerBuilder, /storedStatus/);
assert.match(workerBuilder, /storedSequence/);
assert.match(
  workerBuilder,
  /gpu_startup_diagnostic_runs\.write_token_hash = excluded\.write_token_hash/,
);
assert.match(workerBuilder, /stored\.write_token_hash !== tokenHash/);
assert.match(workerBuilder, /gpuStartupDiagnosticAssetsDirectory/);
assert.match(workerBuilder, /copyAssetsCollisionSafe/);
assert.match(workerBuilder, /DELETE FROM gpu_startup_diagnostic_runs WHERE expires_at < \?1/);
assert.match(workerBuilder, /url\.pathname === "\/api\/gpu-startup-diagnostics"/);
assert.match(workerBuilder, /"Cache-Control": "private, no-store, max-age=0"/);
assert.match(workerBuilder, /"Cloudflare-CDN-Cache-Control": "no-store"/);
assert.doesNotMatch(workerBuilder, /SELECT \* FROM gpu_startup_diagnostic_runs/);

assert.match(migration, /run_code TEXT PRIMARY KEY NOT NULL/);
assert.match(migration, /write_token_hash TEXT NOT NULL/);
assert.match(migration, /expires_at TEXT NOT NULL/);
assert.match(migration, /gpu_startup_diagnostic_runs_expires_at_idx/);
assert.match(summaryMigration, /ADD COLUMN latest_event/);
assert.match(summaryMigration, /ADD COLUMN result_summary/);
assert.match(summaryMigration, /ADD COLUMN payload_bytes/);

const migrationDatabase = new DatabaseSync(":memory:");
try {
  migrationDatabase.exec(migration);
  migrationDatabase.exec(summaryMigration);
  const migratedColumns = new Set(
    migrationDatabase.prepare("PRAGMA table_info(gpu_startup_diagnostic_runs)")
      .all()
      .map((column) => column.name),
  );
  for (const column of ["latest_event", "result_summary", "payload_bytes"]) {
    assert.ok(migratedColumns.has(column), `Migration 0007 must add ${column}.`);
  }
} finally {
  migrationDatabase.close();
}

assert.match(vite, /mode === "gpu-diagnostics"/);
assert.match(vite, /outDir: "dist-gpu-diagnostics"/);
assert.match(attach, /copyAssetsCollisionSafe/);
assert.doesNotMatch(attach, /siteGpuDiagnosticsHtmlFile/);
assert.doesNotMatch(indexHtml, /gpu-startup-diagnostics/);
assert.doesNotMatch(startup, /gpu-startup-diagnostics/);
for (const productionSource of [indexHtml, startup, engineSource, layerRuntimeSource]) {
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_TEST_ID));
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_VARIANT));
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID));
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_PIPELINES_ASYNC2_VARIANT));
  assert.doesNotMatch(
    productionSource,
    new RegExp(APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID),
  );
  assert.doesNotMatch(
    productionSource,
    new RegExp(APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT),
  );
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID));
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT));
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID));
  assert.doesNotMatch(productionSource, new RegExp(APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT));
  assert.doesNotMatch(productionSource, new RegExp(DIAGNOSTIC_BUILD));
}

const inlineBootstrapSource = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineBootstrapSource, "The diagnostic inline bootstrap must be executable in isolation.");

function diagnosticBootstrapHarness({
  userAgent = "Verification Browser",
  runCode = `diag-${"a".repeat(32)}`,
  writeToken = "b".repeat(64),
  testId = "",
  fetchResults = [],
  sharedSessionStorage = new Map(),
  sharedLocalStorage = new Map(),
  clipboardMode = "success",
  legacyCopyResult = true,
  TextEncoderClass = TextEncoder,
  beaconByteLimit = Number.POSITIVE_INFINITY,
  beaconThrows = false,
} = {}) {
  let selectionCount = 0;
  const legacyCopyCommands = [];
  const elements = new Map([
    ["diagnosticStatus", { dataset: {}, textContent: "" }],
    ["diagnosticSummary", { textContent: "" }],
    ["diagnosticCode", { textContent: "" }],
    ["diagnosticElapsed", { textContent: "" }],
    ["diagnosticProgressBar", {
      style: {},
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
    }],
    ["diagnosticCurrentPhase", { textContent: "" }],
    ["diagnosticLiveness", { dataset: {}, textContent: "" }],
    ["diagnosticVariantLabel", { textContent: "" }],
    ["manualDiagnosticBackup", { hidden: true }],
    ["diagnosticJson", {
      value: "",
      focus() {},
      select() { selectionCount += 1; },
      setSelectionRange() { selectionCount += 1; },
    }],
    ["diagnosticBackupHint", { textContent: "" }],
    ["diagnosticCopyStatus", { textContent: "" }],
    ["copyDiagnosticJson", { addEventListener() {} }],
  ]);
  const stepChildren = [];
  elements.set("diagnosticSteps", {
    get firstChild() { return stepChildren[0] ?? null; },
    removeChild() { stepChildren.shift(); },
    appendChild(child) { stepChildren.push(child); },
  });
  const postedBodies = [];
  const fetchRequests = [];
  const beaconRequests = [];
  let acceptedBeaconBytes = 0;
  let copiedText = null;
  let fetchIndex = 0;
  let timerId = 0;
  const locationParams = new URLSearchParams();
  if (runCode) locationParams.set("run", runCode);
  if (testId) locationParams.set("test", testId);
  const location = {
    pathname: "/gpu-startup-lab",
    search: locationParams.size > 0 ? `?${locationParams}` : "",
    hash: writeToken ? `#token=${writeToken}` : "",
  };
  const browser = {
    location,
    history: { replaceState() { location.hash = ""; } },
    innerWidth: 360,
    innerHeight: 640,
    devicePixelRatio: 3,
    isSecureContext: true,
    crossOriginIsolated: false,
    screen: {
      width: 360,
      height: 800,
      availWidth: 360,
      availHeight: 760,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: { type: "portrait-primary" },
    },
    AbortController,
    sessionStorage: {
      getItem(key) { return sharedSessionStorage.get(key) ?? null; },
      setItem(key, value) { sharedSessionStorage.set(key, String(value)); },
      removeItem(key) { sharedSessionStorage.delete(key); },
    },
    localStorage: {
      getItem(key) { return sharedLocalStorage.get(key) ?? null; },
      setItem(key, value) { sharedLocalStorage.set(key, String(value)); },
      removeItem(key) { sharedLocalStorage.delete(key); },
    },
    addEventListener() {},
    setTimeout(callback, delay) {
      timerId += 1;
      if (delay === 500 || delay === 1500 || delay === 3500) queueMicrotask(callback);
      return timerId;
    },
    clearTimeout() {},
    setInterval() { timerId += 1; return timerId; },
    clearInterval() {},
    async fetch(_url, options) {
      postedBodies.push(String(options.body));
      fetchRequests.push({ url: String(_url), options, body: String(options.body) });
      const result = fetchResults[fetchIndex++] ?? { kind: "valid" };
      const parsed = JSON.parse(String(options.body));
      if (result.kind === "http") {
        return { ok: false, status: result.status, json: async () => ({}) };
      }
      if (result.kind === "malformed") {
        return { ok: true, status: 201, json: async () => { throw new SyntaxError("malformed"); } };
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({
          acknowledged: true,
          runCode,
          storedStatus: parsed.status,
          storedSequence: parsed.sequence,
        }),
      };
    },
  };
  const navigator = {
    userAgent,
    platform: "verification-platform",
    vendor: "verification-vendor",
    language: "en",
    languages: ["en"],
    maxTouchPoints: 5,
    hardwareConcurrency: 4,
    deviceMemory: 2,
    onLine: true,
    sendBeacon(url, blob) {
      if (beaconThrows) throw new Error("Verification beacon failure");
      const size = typeof blob?.size === "number" ? blob.size : 0;
      const accepted = acceptedBeaconBytes + size <= beaconByteLimit;
      beaconRequests.push({ url: String(url), blob, accepted });
      if (!accepted) return false;
      acceptedBeaconBytes += size;
      return true;
    },
  };
  if (clipboardMode !== "missing") {
    navigator.clipboard = {
      async writeText(value) {
        if (clipboardMode === "reject") throw new Error("Clipboard permission denied");
        copiedText = String(value);
      },
    };
  }
  const document = {
    visibilityState: "visible",
    getElementById(id) { return elements.get(id) ?? null; },
    createElement() {
      return {
        className: "",
        dataset: {},
        textContent: "",
        children: [],
        addEventListener() {},
        appendChild(child) { this.children.push(child); },
      };
    },
    addEventListener(name, callback) {
      if (name === "DOMContentLoaded") callback();
    },
    execCommand(command) {
      legacyCopyCommands.push(command);
      return command === "copy" && legacyCopyResult;
    },
  };
  browser.window = browser;
  runInNewContext(inlineBootstrapSource, {
    window: browser,
    document,
    navigator,
    screen: browser.screen,
    URLSearchParams,
    TextEncoder: TextEncoderClass,
    AbortController,
    Blob,
    performance: { now: () => 1000 },
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Math,
    Promise,
    Error,
    SyntaxError,
    encodeURIComponent,
    unescape,
    queueMicrotask,
  });
  return {
    browser,
    elements,
    postedBodies,
    fetchRequests,
    beaconRequests,
    acceptedBeaconBytes: () => acceptedBeaconBytes,
    sharedSessionStorage,
    sharedLocalStorage,
    copiedText: () => copiedText,
    selectionCount: () => selectionCount,
    legacyCopyCommands,
    stepChildren,
  };
}

{
  const harness = diagnosticBootstrapHarness({
    fetchResults: [
      { kind: "http", status: 503 },
      { kind: "malformed" },
      { kind: "valid" },
    ],
  });
  const redactedError = harness.browser.__gpuStartupDiagnostics.serializeError({
    name: "Error",
    message: "Failure at https://example.test/private/path?token=secret",
    stack: "at https://example.test/private/path?token=secret:1:2",
  });
  assert.doesNotMatch(JSON.stringify(redactedError), /secret|private\/path/);
  const stored = await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    { unicode: "界".repeat(2_000) },
  );
  assert.equal(stored, true, "A retryable failure must recover after a valid typed acknowledgement.");
  assert.equal(harness.postedBodies.length, 3, "Terminal upload retries must stay bounded.");
  assert.ok(
    harness.postedBodies.every((body) => body === harness.postedBodies[0]),
    "Every terminal retry must send the byte-identical frozen snapshot.",
  );
  assert.ok(Buffer.byteLength(harness.postedBodies[0], "utf8") <= 48 * 1024);
  const terminalPayload = JSON.parse(harness.postedBodies[0]);
  assert.ok(!Object.hasOwn(terminalPayload.summary, "reportStored"));
  assertDiagnosticSummary(
    terminalPayload.summary,
    DEFAULT_TEST_ID,
    { unicode: "界".repeat(1_600) },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(terminalPayload.events.at(-1).detail), "utf8") <= 1200);
  assert.equal(harness.elements.get("diagnosticStatus").textContent, "Diagnostic complete");
  assert.equal(harness.elements.get("manualDiagnosticBackup").hidden, false);
  const manualPayload = JSON.parse(harness.elements.get("diagnosticJson").value);
  assert.equal(manualPayload.type, "gpu-startup-diagnostic-manual-backup");
  assert.ok(!Object.hasOwn(manualPayload.currentAttempt, "writeToken"));
  assert.equal(manualPayload.manualBackup.automaticUploadStored, true);
  assert.equal(manualPayload.manualBackup.runCodeSuffix, "AAAAAAAA");
  assert.equal(manualPayload.testId, DEFAULT_TEST_ID);
  assertDiagnosticSummary(
    manualPayload.currentAttempt.summary,
    DEFAULT_TEST_ID,
    terminalPayload.summary.result,
  );
  assert.doesNotMatch(JSON.stringify(manualPayload), /writeToken/);
  await harness.browser.__gpuStartupDiagnostics.copyManualBackup();
  assert.equal(harness.copiedText(), harness.elements.get("diagnosticJson").value);
  assert.doesNotMatch(harness.copiedText(), new RegExp("b".repeat(64)));
  assert.equal(
    harness.elements.get("diagnosticCopyStatus").textContent,
    "JSON copied. Paste it into the chat.",
  );
}

{
  const phaseStates = {
    "adapter-request": "completed",
    "device-request": "completed",
    "canvas-rgba16float": "completed",
    "document-display-textures": "completed",
    "document-layer-texture": "completed",
    "document-bindings": "completed",
    "first-frame-submit": "completed",
    "first-frame-gpu": "completed",
    "editor-ready": "completed",
  };
  const requiredPhaseStates = Object.fromEntries([
    "document-display-textures",
    "document-layer-texture",
    "document-bindings",
    "first-frame-submit",
    "first-frame-gpu",
    "editor-ready",
  ].map((phase) => [phase, "completed"]));
  const successResult = {
    ...APPLICATION_4096_COMPARISON,
    testId: APPLICATION_4096_TEST_ID,
    diagnosticVariant: APPLICATION_4096_VARIANT,
    verdict: "application-4096-startup-passed",
    conclusion: "The real 4096x4096 application document completed its first GPU frame and remained ready for five seconds.",
    rgba16floatLayerBytes: 134_217_728,
    startupTrace: {
      lastProgress: { phase: "editor-ready", state: "completed", totalElapsedMs: 44_000 },
      phaseStates,
      requiredPhaseStates,
      deviceLost: null,
      uncapturedError: null,
      gpuObservation: {
        installed: true,
        requestDeviceObserved: true,
        adapterCount: 1,
        deviceCount: 1,
        requiredFeatures: [],
        textureFormatsTier2Enabled: false,
      },
    },
    applicationBoot: {
      accessible: true,
      statusText: "WebGPU is ready",
      statusClass: "ok",
      projectSessionReady: true,
      runtimeStatsStarted: true,
      canvas: { width: 780, height: 1280, clientWidth: 390, clientHeight: 640 },
      startupPhaseStates: phaseStates,
      rgba16floatLayerBytes: 134_217_728,
      resourceCount: 12,
      failedResources: [],
      deferredStartupObservationMs: 5000,
      reporter: {
        channel: "gpu-startup-app-frame-v3",
        bootstrapReady: true,
        extensionCreated: true,
        frameMessageCount: 52,
        lastStartupProgress: { phase: "editor-ready", state: "completed" },
      },
      engine: {
        documentWidth: 4096,
        documentHeight: 4096,
        diagnosticVariant: APPLICATION_4096_VARIANT,
        layerFormat: "rgba16float",
        canvasFormat: "rgba16float",
        featureIsolation: {
          textureFormatsTier2Advertised: true,
          textureFormatsTier2Enabled: false,
          inPlaceGlazeCommitEnabled: false,
          inPlaceGlazeCommitPipelineCreated: false,
        },
        layerCount: 1,
        layerMemoryMiB: 128,
        storage: {
          bytesPerPixel: 8,
          fullLayerMiB: 128,
          eagerFullRawMiB: 128,
          actualRawMiB: 128,
          tileSizePx: 256,
          tileCount: 256,
        },
        gpu: {
          label: "Verification mobile GPU",
          countedTotalMiB: 192,
          registeredCurrentMiB: 192,
        },
      },
    },
  };
  const resultBytes = Buffer.byteLength(JSON.stringify(successResult), "utf8");
  assert.ok(resultBytes < 12 * 1024, `The realistic 4096 result is ${resultBytes} bytes.`);
  const harness = diagnosticBootstrapHarness({
    testId: APPLICATION_4096_TEST_ID,
    userAgent: "界".repeat(100_000),
  });
  assert.equal(
    harness.elements.get("diagnosticVariantLabel").textContent,
    "Real 4096×4096 document · RGBA16F · Tier 2 off",
  );
  const stored = await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    successResult,
  );
  assert.equal(stored, true);
  const terminalPayload = JSON.parse(harness.postedBodies[0]);
  assert.notEqual(terminalPayload.summary.result?.truncated, true);
  assertDiagnosticSummary(terminalPayload.summary, APPLICATION_4096_TEST_ID, successResult);
  const manualPayload = JSON.parse(harness.elements.get("diagnosticJson").value);
  assertDiagnosticSummary(
    manualPayload.currentAttempt.summary,
    APPLICATION_4096_TEST_ID,
    successResult,
  );

  const failureResult = {
    ...APPLICATION_4096_COMPARISON,
    testId: APPLICATION_4096_TEST_ID,
    diagnosticVariant: APPLICATION_4096_VARIANT,
    verdict: "application-4096-out-of-memory",
    conclusion: "The real 4096x4096 application document failed with explicit out-of-memory evidence.",
    failedPhase: "document-layer-texture",
    applicationError: { name: "GPUOutOfMemoryError", message: "Allocation failed." },
    startupTrace: {
      ...successResult.startupTrace,
      lastProgress: { phase: "document-layer-texture", state: "failed" },
      phaseStates: {
        ...phaseStates,
        "document-layer-texture": "failed",
        "document-bindings": "unknown",
        "first-frame-submit": "unknown",
        "first-frame-gpu": "unknown",
        "editor-ready": "unknown",
      },
      requiredPhaseStates: {
        ...requiredPhaseStates,
        "document-layer-texture": "failed",
      },
    },
  };
  const failureHarness = diagnosticBootstrapHarness({
    testId: APPLICATION_4096_TEST_ID,
    userAgent: "界".repeat(100_000),
  });
  await failureHarness.browser.__gpuStartupDiagnostics.finish(
    "failed",
    "diagnostic-failed",
    failureResult,
  );
  const failurePayload = JSON.parse(failureHarness.postedBodies[0]);
  assert.notEqual(failurePayload.summary.result?.truncated, true);
  assertDiagnosticSummary(
    failurePayload.summary,
    APPLICATION_4096_TEST_ID,
    failureResult,
  );
  const failureManualPayload = JSON.parse(
    failureHarness.elements.get("diagnosticJson").value,
  );
  assertDiagnosticSummary(
    failureManualPayload.currentAttempt.summary,
    APPLICATION_4096_TEST_ID,
    failureResult,
  );
}

{
  const asyncStats = {
    strategy: "async-bounded",
    requestedConcurrency: 2,
    nativeAsyncSupported: true,
    expectedRenderPipelineCount: 52,
    scheduledCount: 52,
    startedCount: 52,
    completedCount: 52,
    failedCount: 0,
    settledCount: 52,
    activeCount: 0,
    peakActiveCount: 2,
    fallbackCount: 0,
  };
  const result = {
    ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON,
    testId: APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    diagnosticVariant: APPLICATION_4096_PIPELINES_ASYNC2_VARIANT,
    verdict: "application-4096-pipelines-async2-passed",
    conclusion: "The bounded asynchronous pipeline startup completed.",
    startupTrace: {
      documentPipelinesPhase: {
        phase: "document-pipelines",
        state: "completed",
        totalElapsedMs: 12_000,
        phaseElapsedMs: 8_000,
        detail: asyncStats,
      },
      editorReadyPhase: {
        phase: "editor-ready",
        state: "completed",
        totalElapsedMs: 13_000,
        phaseElapsedMs: 20,
        detail: null,
      },
    },
    asyncPipelineCompilation: {
      passed: true,
      issues: [],
      stats: asyncStats,
    },
  };
  const harness = diagnosticBootstrapHarness({
    testId: APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
  });
  assert.equal(
    harness.elements.get("diagnosticVariantLabel").textContent,
    "Real 4096×4096 document · async pipeline queue 2 · Tier 2 off",
  );
  await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    result,
  );
  const terminalPayload = JSON.parse(harness.postedBodies[0]);
  assertDiagnosticSummary(
    terminalPayload.summary,
    APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    result,
  );
}

{
  const result = storageTargetFailureResult();
  const encodedResultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  assert.ok(encodedResultBytes > 1200 && encodedResultBytes < 12 * 1024);
  const harness = diagnosticBootstrapHarness({ testId: STORAGE_FORMAT_TEST_ID });
  assert.equal(
    harness.elements.get("diagnosticVariantLabel").textContent,
    "1×1 · RGBA8 vs RGBA16F · storage write",
  );
  const stored = await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    result,
  );
  assert.equal(stored, true);
  const terminalPayload = JSON.parse(harness.postedBodies[0]);
  assert.equal(terminalPayload.status, "completed");
  assertDiagnosticSummary(terminalPayload.summary, STORAGE_FORMAT_TEST_ID, result);
  assert.notEqual(terminalPayload.summary.result?.truncated, true);
  assert.deepEqual(terminalPayload.summary.result.control.timingsMs, result.control.timingsMs);
  assert.deepEqual(terminalPayload.summary.result.target.timingsMs, result.target.timingsMs);
  assert.equal(terminalPayload.events.at(-1).detail.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(terminalPayload.events.at(-1).detail), "utf8") <= 1200);
  const manualPayload = JSON.parse(harness.elements.get("diagnosticJson").value);
  assert.equal(manualPayload.testId, STORAGE_FORMAT_TEST_ID);
  assert.equal(manualPayload.manualBackup.testId, STORAGE_FORMAT_TEST_ID);
  assertDiagnosticSummary(
    manualPayload.currentAttempt.summary,
    STORAGE_FORMAT_TEST_ID,
    result,
  );
}

{
  const harness = diagnosticBootstrapHarness({ testId: DOCUMENT_PIPELINE_TEST_ID });
  assert.equal(
    harness.elements.get("diagnosticVariantLabel").textContent,
    "Real document pipelines · RGBA16F · Tier 2 off",
  );
  assertDiagnosticSummary(
    harness.browser.__gpuStartupDiagnostics.snapshot().summary,
    DOCUMENT_PIPELINE_TEST_ID,
    null,
  );
}

{
  const harness = diagnosticBootstrapHarness({
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
  });
  assert.equal(
    harness.elements.get("diagnosticVariantLabel").textContent,
    "Real 4096×4096 document · 71 timed GPU calls · Tier 2 off",
  );
  await harness.browser.__gpuStartupDiagnostics.record(
    "application-startup-phase",
    {
      phase: "document-pipelines",
      label: "Compiling 16-bit document pipelines",
      state: "started",
      totalElapsedMs: 400,
      phaseElapsedMs: 0,
    },
    "running",
  );
  await harness.browser.__gpuStartupDiagnostics.record(
    "application-document-gpu-call-started",
    {
      callIndex: 1,
      method: "createPipelineLayout",
      pipelineLayoutIndex: 1,
      label: "Verification layout rgba16float",
    },
    "running",
  );
  harness.browser.__gpuStartupDiagnostics.display(
    "application-document-gpu-call-completed",
    {
      callIndex: 1,
      method: "createPipelineLayout",
      pipelineLayoutIndex: 1,
      label: "Verification layout rgba16float",
      durationMs: 12.345,
      instrumentationPreparationMs: 3.5,
    },
  );
  const breakdownPhase = harness.stepChildren.find(
    (child) => child.className === "phase-with-breakdown",
  );
  assert.ok(breakdownPhase);
  const details = breakdownPhase.children.find(
    (child) => child.className === "pipeline-breakdown",
  );
  assert.ok(details);
  assert.equal(details.children[0].textContent, "1/71 timed calls · 0.012 s");
  assert.equal(
    harness.elements.get("diagnosticCurrentPhase").textContent,
    "Verification layout rgba16float",
  );
  assertDiagnosticSummary(
    harness.browser.__gpuStartupDiagnostics.snapshot().summary,
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    null,
  );
  const worstCaseLabel = (kind, index) => (
    `${kind}-${String(index).padStart(2, "0")}-` + "x".repeat(80)
  ).slice(0, 80);
  const compactGroups = [
    [1, 6],
    [7, 18],
    [19, 30],
    [31, 36],
    [37, 40],
    [41, 46],
    [47, 52],
  ].map(([first, last], groupIndex) => ({
    key: `group-${groupIndex + 1}`,
    label: worstCaseLabel("group", groupIndex + 1),
    totalDurationMs: last - first + 1,
    calls: Array.from({ length: last - first + 1 }, (_, offset) => ({
      index: first + offset,
      label: worstCaseLabel("render-pipeline", first + offset),
      durationMs: first + offset + 0.123,
    })),
  }));
  const compactLayouts = Array.from({ length: 17 }, (_, index) => ({
    index: index + 1,
    label: worstCaseLabel("pipeline-layout", index + 1),
    durationMs: index + 0.456,
  }));
  const compactErrorScopeDrains = [
    { index: 1, label: worstCaseLabel("validation-scope-drain", 1), durationMs: 1.234 },
    { index: 2, label: worstCaseLabel("memory-scope-drain", 2), durationMs: 2.345 },
  ];
  const compactNativeCallTotalMs = [
    ...compactLayouts,
    ...compactGroups.flatMap((group) => group.calls),
    ...compactErrorScopeDrains,
  ].reduce((sum, call) => sum + call.durationMs, 0);
  const compactBreakdownResult = {
    ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    diagnosticVariant: APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT,
    verdict: "application-4096-pipeline-breakdown-passed",
    pipelineBreakdown: {
      expectedMeasuredCallCount: 71,
      measuredCallCount: 71,
      phaseElapsedMs: 54_321.987,
      nativeCallTotalMs: compactNativeCallTotalMs,
      preCallDiagnosticTotalMs: 1_234.567,
      phaseMinusPreCallDiagnosticMs: 53_087.42,
      remainingPhaseWorkAndReportingMs: 53_087.42 - compactNativeCallTotalMs,
      pipelineLayoutTotalMs: compactLayouts.reduce((sum, call) => sum + call.durationMs, 0),
      renderPipelineTotalMs: compactGroups
        .flatMap((group) => group.calls)
        .reduce((sum, call) => sum + call.durationMs, 0),
      errorScopeDrainTotalMs: compactErrorScopeDrains
        .reduce((sum, call) => sum + call.durationMs, 0),
      slowestRenderPipelineIndex: 52,
      slowestRenderPipelineDurationMs: 52.123,
      pipelineLayouts: compactLayouts,
      renderPipelineGroups: compactGroups,
      failedCallCount: 0,
      errorScopeDrains: compactErrorScopeDrains,
    },
    startupTrace: {
      lastProgress: {
        phase: "editor-ready",
        label: worstCaseLabel("startup-phase", 17),
        state: "completed",
        totalElapsedMs: 54_999.999,
        phaseElapsedMs: 12.345,
      },
      phaseStates: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`phase-${index + 1}`, "completed"]),
      ),
      documentPipelinesPhase: {
        phase: "document-pipelines",
        label: worstCaseLabel("document-pipelines", 1),
        state: "completed",
        totalElapsedMs: 54_321.987,
        phaseElapsedMs: 54_321.987,
        detail: { format: "rgba16float", strategy: "sync-sequential" },
      },
      editorReadyPhase: {
        phase: "editor-ready",
        label: worstCaseLabel("editor-ready", 1),
        state: "completed",
        totalElapsedMs: 54_999.999,
        phaseElapsedMs: 12.345,
      },
      requiredPhaseStates: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`required-phase-${index + 1}`, "completed"]),
      ),
      deviceLost: null,
      uncapturedError: null,
      gpuObservation: {
        installed: true,
        requestDeviceObserved: true,
        adapterCount: 1,
        deviceCount: 1,
        requiredFeatures: [],
        textureFormatsTier2Enabled: false,
      },
    },
    applicationBoot: {
      accessible: true,
      statusText: worstCaseLabel("application-ready", 1),
      statusClass: "ok",
      projectSessionReady: true,
      runtimeStatsStarted: true,
      canvas: { width: 4096, height: 4096, format: "rgba16float" },
      startupPhaseStates: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`phase-${index + 1}`, "completed"]),
      ),
      rgba16floatLayerBytes: 134_217_728,
      resourceCount: 25,
      failedResources: [],
      deferredStartupObservationMs: 5000,
      reporter: {
        channel: "gpu-startup-diagnostics-v1",
        bootstrapReady: true,
        extensionCreated: true,
        frameMessageCount: 999,
        lastStartupProgress: { phase: "editor-ready", state: "completed" },
      },
      engine: {
        documentWidth: 4096,
        documentHeight: 4096,
        diagnosticVariant: APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT,
        layerFormat: "rgba16float",
        canvasFormat: "rgba16float",
        featureIsolation: {
          textureFormatsTier2Advertised: true,
          textureFormatsTier2Enabled: false,
          inPlaceGlazeCommitEnabled: false,
          inPlaceGlazeCommitPipelineCreated: false,
        },
        layerCount: 1,
        layerMemoryMiB: 128,
        storage: { format: "rgba16float", width: 4096, height: 4096 },
        gpu: { adapter: "ARM Valhall", architecture: "Valhall", description: "x".repeat(300) },
      },
    },
  };
  await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    compactBreakdownResult,
  );
  const terminalPayload = JSON.parse(harness.postedBodies.at(-1));
  assertDiagnosticSummary(
    terminalPayload.summary,
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    compactBreakdownResult,
  );
  assert.equal(
    terminalPayload.summary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls).length,
    52,
  );
  assert.deepEqual(
    terminalPayload.summary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls).map((call) => call.index),
    Array.from({ length: 52 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    terminalPayload.summary.result.pipelineBreakdown.pipelineLayouts.map((call) => call.index),
    Array.from({ length: 17 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    terminalPayload.summary.result.pipelineBreakdown.errorScopeDrains.map((call) => call.index),
    [1, 2],
  );
  const storedCalls = [
    ...terminalPayload.summary.result.pipelineBreakdown.pipelineLayouts,
    ...terminalPayload.summary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls),
    ...terminalPayload.summary.result.pipelineBreakdown.errorScopeDrains,
  ];
  assert.equal(storedCalls.length, 71);
  assert.ok(storedCalls.every((call) => Number.isFinite(call.durationMs) && call.durationMs >= 0));
  assert.equal(
    terminalPayload.summary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls)
      .sort((left, right) => right.durationMs - left.durationMs)[0].index,
    terminalPayload.summary.result.pipelineBreakdown.slowestRenderPipelineIndex,
  );
  assert.ok(
    terminalPayload.summary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls)
      .every((call) => !("instrumentationPreparationMs" in call)),
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(terminalPayload.summary.result), "utf8") <= 18 * 1024,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(terminalPayload.summary), "utf8") <= 24 * 1024);
  assert.notEqual(terminalPayload.summary.result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(terminalPayload), "utf8") <= 48 * 1024);
}

{
  const harness = diagnosticBootstrapHarness({
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
  });
  assert.equal(
    harness.elements.get("diagnosticVariantLabel").textContent,
    "Real 4096×4096 document · 52 sequential async pipeline timings · Tier 2 off",
  );
  await harness.browser.__gpuStartupDiagnostics.record(
    "application-startup-phase",
    {
      phase: "document-pipelines",
      label: "Compiling 16-bit document pipelines",
      state: "started",
      totalElapsedMs: 400,
      phaseElapsedMs: 0,
    },
    "running",
  );
  const attributionDisplayEntries = [];
  for (let index = 1; index <= 17; index += 1) {
    attributionDisplayEntries.push({
      callIndex: index,
      method: "createPipelineLayout",
      pipelineLayoutIndex: index,
      label: `Verification layout ${index} rgba16float`,
      durationMs: 1,
      instrumentationPreparationMs: 0.1,
      state: "completed",
    });
  }
  for (let index = 1; index <= 52; index += 1) {
    attributionDisplayEntries.push({
      callIndex: 17 + index,
      method: "createRenderPipelineAsync",
      renderPipelineIndex: index,
      label: `Verification async pipeline ${index} rgba16float`,
      durationMs: index * 10,
      instrumentationPreparationMs: 0.2,
      state: "completed",
    });
  }
  for (let index = 1; index <= 2; index += 1) {
    attributionDisplayEntries.push({
      callIndex: 69 + index,
      method: "popErrorScope",
      errorScopeDrainIndex: index,
      label: `Verification scope drain ${index}`,
      durationMs: 1,
      instrumentationPreparationMs: 0.1,
      state: "completed",
    });
  }
  harness.browser.__gpuStartupDiagnostics.displayBatch(attributionDisplayEntries);
  await harness.browser.__gpuStartupDiagnostics.record(
    "application-startup-phase",
    {
      phase: "document-pipelines",
      label: "Compiling 16-bit document pipelines",
      state: "completed",
      totalElapsedMs: 14_500,
      phaseElapsedMs: 14_000,
    },
    "running",
  );
  const breakdownPhase = harness.stepChildren.find(
    (child) => child.className === "phase-with-breakdown",
  );
  const details = breakdownPhase?.children.find(
    (child) => child.className === "pipeline-breakdown",
  );
  assert.ok(details);
  assert.equal(details.children[0].textContent, "71/71 timed calls · 13.799 s");
  const descendants = [];
  const collectDescendants = (node) => {
    descendants.push(node);
    for (const child of node.children ?? []) collectDescendants(child);
  };
  collectDescendants(details);
  assert.equal(
    descendants.filter((node) => node.className === "pipeline-breakdown-row").length,
    71,
  );
  const headingLabels = descendants
    .filter((node) => node.className === "pipeline-breakdown-heading")
    .map((node) => node.children[0]?.textContent);
  assert.deepEqual(headingLabels, [
    "Pipeline layouts (17/17)",
    "Erase stamps (6/6)",
    "Direct color stamps (12/12)",
    "Precision color accumulation (12/12)",
    "Coverage accumulation (6/6)",
    "Live accumulation resolve (4/4)",
    "Display and live mips (6/6)",
    "Document composition (6/6)",
    "Error-scope drains (2/2)",
  ]);
  const eraseHeading = descendants.find(
    (node) => node.className === "pipeline-breakdown-heading"
      && node.children[0]?.textContent === "Erase stamps (6/6)",
  );
  assert.equal(eraseHeading.children[1].textContent, "0.210 s · 1.5%");
  const lastPipelineRow = descendants
    .filter((node) => node.className === "pipeline-breakdown-row")
    .find((node) => node.children[0]?.textContent === "52");
  assert.equal(lastPipelineRow.children[2].textContent, "0.520 s · 3.8%");
  assertDiagnosticSummary(
    harness.browser.__gpuStartupDiagnostics.snapshot().summary,
    APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    null,
  );
}

{
  const harness = diagnosticBootstrapHarness({
    testId: DOCUMENT_PIPELINE_TEST_ID,
    beaconByteLimit: 16 * 1024,
  });
  for (let index = 1; index <= 71; index += 1) {
    const method = index <= 17
      ? "createPipelineLayout"
      : index <= 69
        ? "createRenderPipeline"
        : "popErrorScope";
    const stored = await harness.browser.__gpuStartupDiagnostics.recordBreadcrumb(
      "application-document-gpu-call-started",
      {
        callIndex: index,
        method,
        pipelineLayoutIndex: method === "createPipelineLayout" ? index : null,
        renderPipelineIndex: method === "createRenderPipeline" ? index - 17 : null,
        errorScopeDrainIndex: method === "popErrorScope" ? index - 69 : null,
        label: `Verification ${method} ${index}`,
        previousCompletedRenderPipeline: index > 18
          ? { renderPipelineIndex: Math.min(index - 18, 52) }
          : null,
        durableCheckpoint: false,
      },
      "running",
    );
    assert.equal(stored, true);
  }
  const beaconBodies = await Promise.all(
    harness.beaconRequests.map(({ blob }) => blob.text()),
  );
  const boundaryBodies = beaconBodies.filter((body) => (
    JSON.parse(body).summary.latestEvent === "application-document-gpu-call-started"
  ));
  assert.equal(boundaryBodies.length, 71);
  assert.ok(harness.acceptedBeaconBytes() <= 16 * 1024);
  assert.ok(
    harness.fetchRequests.some(({ body }) => (
      JSON.parse(body).summary.latestEvent === "application-document-gpu-call-started"
    )),
    "Breadcrumbs rejected by the beacon quota must fall back to fetch.",
  );
  const rejectedBoundaryBodies = await Promise.all(
    harness.beaconRequests
      .filter(({ accepted }) => !accepted)
      .map(({ blob }) => blob.text()),
  );
  for (const rejectedBody of rejectedBoundaryBodies.filter((body) => (
    JSON.parse(body).summary.latestEvent === "application-document-gpu-call-started"
  ))) {
    assert.equal(
      harness.fetchRequests.filter(({ body }) => body === rejectedBody).length,
      1,
      "Each rejected beacon body must be retried byte-identically once.",
    );
  }
  for (const request of harness.fetchRequests.filter(({ body }) => (
    JSON.parse(body).summary.latestEvent === "application-document-gpu-call-started"
  ))) {
    assert.equal(request.options.keepalive, false);
    assert.equal(request.options.method, "POST");
  }
  for (const body of boundaryBodies) {
    const payload = JSON.parse(body);
    assert.ok(Buffer.byteLength(body, "utf8") < 4 * 1024);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.sequence, payload.events[0].sequence);
    assert.equal(payload.summary.latestEvent, payload.events[0].name);
    assert.equal(payload.summary.result, null);
    assertDiagnosticSummary(payload.summary, DOCUMENT_PIPELINE_TEST_ID, null);
  }
  const lastBoundary = JSON.parse(boundaryBodies.at(-1));
  assert.equal(lastBoundary.events[0].detail.callIndex, 71);
  assert.equal(lastBoundary.events[0].detail.errorScopeDrainIndex, 2);
  assert.ok(
    harness.browser.__gpuStartupDiagnostics.snapshot().events.length <= 24,
    "The display snapshot must retain only its bounded event tail.",
  );
}

{
  const harness = diagnosticBootstrapHarness({
    testId: DOCUMENT_PIPELINE_TEST_ID,
    beaconThrows: true,
  });
  const stored = await harness.browser.__gpuStartupDiagnostics.recordBreadcrumb(
    "application-document-gpu-call-started",
    { callIndex: 1, method: "createPipelineLayout", label: "Beacon exception fallback" },
    "running",
  );
  assert.equal(stored, true);
  const fallback = harness.fetchRequests.find(({ body }) => (
    JSON.parse(body).summary.latestEvent === "application-document-gpu-call-started"
  ));
  assert.ok(fallback);
  assert.equal(fallback.options.keepalive, false);
}

{
  const harness = diagnosticBootstrapHarness({ testId: DOCUMENT_PIPELINE_TEST_ID });
  const stored = harness.browser.__gpuStartupDiagnostics.recordBreadcrumb(
    "application-document-gpu-call-failed",
    {
      callIndex: 42,
      method: "createRenderPipeline",
      renderPipelineIndex: 25,
      label: "Structured failure breadcrumb",
      targetFormats: ["rgba16float"],
      durationMs: 25_200,
      pipelineReason: "validation",
      error: {
        name: "OperationError",
        message: "The verification pipeline failed validation.",
        stack: "s".repeat(4_000),
      },
      durableCheckpoint: false,
    },
    "failed",
  );
  assert.equal(stored, true);
  const failureBody = await harness.beaconRequests.at(-1).blob.text();
  const failurePayload = JSON.parse(failureBody);
  assert.equal(failurePayload.events[0].detail.truncated, undefined);
  assert.equal(failurePayload.events[0].detail.callIndex, 42);
  assert.equal(failurePayload.events[0].detail.pipelineReason, "validation");
  assert.equal(
    failurePayload.events[0].detail.error.message,
    "The verification pipeline failed validation.",
  );
  assert.ok(Buffer.byteLength(failureBody, "utf8") < 4 * 1024);
}

{
  const harness = diagnosticBootstrapHarness({ testId: DOCUMENT_PIPELINE_TEST_ID });
  const currentCall = {
    callIndex: 41,
    method: "createRenderPipeline",
    renderPipelineIndex: 24,
    label: "Pipeline active during asynchronous GPU error",
    targetFormats: ["rgba16float"],
    previousCompletedRenderPipeline: { renderPipelineIndex: 23 },
  };
  const stored = harness.browser.__gpuStartupDiagnostics.recordBreadcrumb(
    "application-document-gpu-uncaptured-error",
    {
      source: "uncapturederror",
      error: {
        name: "GPUValidationError",
        message: "u".repeat(1_000),
        stack: "s".repeat(4_000),
      },
      activePhase: "document-pipelines",
      phaseState: "started",
      duringTargetPhase: true,
      currentCall,
      lastCompletedRenderPipeline: {
        renderPipelineIndex: 23,
        label: "Previous completed pipeline",
        durationMs: 15.2,
      },
      durableCheckpoint: false,
    },
    "failed",
  );
  assert.equal(stored, true);
  const errorBody = await harness.beaconRequests.at(-1).blob.text();
  const errorPayload = JSON.parse(errorBody);
  const detail = errorPayload.events[0].detail;
  assert.equal(detail.truncated, undefined);
  assert.equal(detail.duringTargetPhase, true);
  assert.equal(detail.currentCall.callIndex, 41);
  assert.equal(detail.currentCall.method, "createRenderPipeline");
  assert.equal(detail.currentCall.renderPipelineIndex, 24);
  assert.equal(detail.currentCall.label, currentCall.label);
  assert.equal(detail.lastCompletedRenderPipeline.renderPipelineIndex, 23);
  assert.equal(detail.error.name, "GPUValidationError");
  assert.ok(Buffer.byteLength(errorBody, "utf8") < 4 * 1024);
}

{
  const calls = Array.from({ length: 8 }, (_entry, index) => ({
    callIndex: 64 + index,
    method: index < 6 ? "createRenderPipeline" : "popErrorScope",
    renderPipelineIndex: index < 6 ? 47 + index : null,
    errorScopeDrainIndex: index < 6 ? null : index - 5,
    label: `${`Terminal call ${64 + index} `.padEnd(300, "L")}`,
    vertexEntryPoint: "v".repeat(120),
    fragmentEntryPoint: "f".repeat(120),
    targetFormats: ["rgba16float", "rgba16float", "rgba16float", "rgba16float"],
    topology: "triangle-list",
    durationMs: 4.5 + index,
    state: "completed",
  }));
  const engineProbe = {
    enabled: true,
    targetPhase: "document-pipelines",
    expectedSynchronousPipelineLayouts: 17,
    expectedSynchronousRenderPipelines: 52,
    expectedErrorScopeDrains: 2,
    activePhase: "document-pipelines",
    phaseState: "completed",
    adapterPatchCount: 1,
    devicePatchCount: 1,
    startedCallCount: 71,
    completedCallCount: 71,
    failedCallCount: 0,
    scopeErrorCount: 0,
    pipelineLayoutStartedCount: 17,
    pipelineLayoutCompletedCount: 17,
    renderPipelineStartedCount: 52,
    renderPipelineCompletedCount: 52,
    popErrorScopeStartedCount: 2,
    popErrorScopeCompletedCount: 2,
    lastStartedCall: calls.at(-1),
    lastCompletedRenderPipeline: calls[5],
    slowestCompletedRenderPipeline: calls[5],
  };
  const result = {
    ...DOCUMENT_PIPELINE_COMPARISON,
    testId: DOCUMENT_PIPELINE_TEST_ID,
    diagnosticVariant: DOCUMENT_PIPELINE_VARIANT,
    verdict: "document-pipelines-passed",
    conclusion: "All real pipeline layouts, render pipelines, and error scopes passed.",
    documentWidth: 2048,
    documentHeight: 2048,
    documentPipelineTrace: {
      instrumentationInstalled: true,
      adapterRequestDevicePatched: true,
      pipelineLayoutPatched: true,
      renderPipelinePatched: true,
      popErrorScopePatched: true,
      requiredFeatures: [],
      textureFormatsTier2Enabled: false,
      phaseState: "completed",
      expectedSynchronousPipelineLayouts: 17,
      expectedSynchronousRenderPipelines: 52,
      expectedErrorScopeDrains: 2,
      startedCallCount: 71,
      completedCallCount: 71,
      failedCallCount: 0,
      scopeErrorCount: 0,
      pipelineLayoutStartedCount: 17,
      pipelineLayoutCompletedCount: 17,
      renderPipelineStartedCount: 52,
      renderPipelineCompletedCount: 52,
      popErrorScopeStartedCount: 2,
      popErrorScopeCompletedCount: 2,
      deviceLost: null,
      uncapturedError: null,
      lastStartedCall: null,
      lastCompletedCall: calls.at(-1),
      lastFailedCall: null,
      lastScopeError: null,
      slowestCompletedRenderPipeline: calls[5],
      engineProbe,
      calls: calls.slice(-4),
    },
    applicationBoot: {
      accessible: true,
      statusText: "WebGPU is ready",
      statusClass: "ok",
      projectSessionReady: true,
      runtimeStatsStarted: true,
      canvas: { width: 2048, height: 2048 },
      reporter: {
        bootstrapReady: true,
        extensionCreated: true,
        frameMessageCount: 160,
        lastStartupProgress: {
          phase: "document-pipelines",
          state: "completed",
          totalElapsedMs: 25_200,
          phaseElapsedMs: 25_200,
        },
      },
      engine: {
        documentWidth: 2048,
        documentHeight: 2048,
        layerFormat: "rgba16float",
        canvasFormat: "rgba16float",
        featureIsolation: {
          textureFormatsTier2Advertised: true,
          textureFormatsTier2Enabled: false,
          inPlaceGlazeCommitEnabled: false,
          inPlaceGlazeCommitPipelineCreated: false,
        },
      },
    },
  };
  const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  assert.ok(
    resultBytes > 1200 && resultBytes < 12 * 1024,
    `The realistic document-pipeline result is ${resultBytes} bytes.`,
  );
  const harness = diagnosticBootstrapHarness({
    testId: DOCUMENT_PIPELINE_TEST_ID,
    userAgent: "界".repeat(100_000),
  });
  const stored = await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    result,
  );
  assert.equal(stored, true);
  const terminalPayload = JSON.parse(harness.postedBodies[0]);
  assert.notEqual(terminalPayload.summary.result?.truncated, true);
  assertDiagnosticSummary(terminalPayload.summary, DOCUMENT_PIPELINE_TEST_ID, result);
  assert.equal(terminalPayload.summary.result.documentPipelineTrace.calls.length, 4);
  assert.equal(terminalPayload.summary.result.documentPipelineTrace.completedCallCount, 71);
  const manualPayload = JSON.parse(harness.elements.get("diagnosticJson").value);
  assertDiagnosticSummary(
    manualPayload.currentAttempt.summary,
    DOCUMENT_PIPELINE_TEST_ID,
    result,
  );

  const failedCall = {
    ...calls[2],
    state: "failed",
    error: {
      name: "OperationError",
      message: "m".repeat(600),
    },
    pipelineReason: "validation",
  };
  const failureResult = {
    ...DOCUMENT_PIPELINE_COMPARISON,
    testId: DOCUMENT_PIPELINE_TEST_ID,
    diagnosticVariant: DOCUMENT_PIPELINE_VARIANT,
    verdict: "document-gpu-call-failed",
    conclusion: "A native WebGPU call failed inside the real document-pipeline phase.",
    applicationError: {
      name: "Error",
      message: "a".repeat(600),
    },
    documentPipelineTrace: {
      ...result.documentPipelineTrace,
      phaseState: "failed",
      startedCallCount: 42,
      completedCallCount: 41,
      failedCallCount: 1,
      renderPipelineStartedCount: 25,
      renderPipelineCompletedCount: 24,
      popErrorScopeStartedCount: 0,
      popErrorScopeCompletedCount: 0,
      lastStartedCall: null,
      lastCompletedCall: calls[1],
      lastFailedCall: failedCall,
      lastScopeError: null,
      calls: [calls[0], calls[1], failedCall],
    },
  };
  const failureResultBytes = Buffer.byteLength(JSON.stringify(failureResult), "utf8");
  assert.ok(
    failureResultBytes > 1200 && failureResultBytes < 12 * 1024,
    `The realistic failed document-pipeline result is ${failureResultBytes} bytes.`,
  );
  const failureHarness = diagnosticBootstrapHarness({
    testId: DOCUMENT_PIPELINE_TEST_ID,
    userAgent: "界".repeat(100_000),
  });
  const failureStored = await failureHarness.browser.__gpuStartupDiagnostics.finish(
    "failed",
    "diagnostic-failed",
    failureResult,
  );
  assert.equal(failureStored, true);
  const failedTerminalPayload = JSON.parse(failureHarness.postedBodies[0]);
  assert.notEqual(failedTerminalPayload.summary.result?.truncated, true);
  assertDiagnosticSummary(
    failedTerminalPayload.summary,
    DOCUMENT_PIPELINE_TEST_ID,
    failureResult,
  );
}

{
  const result = storageTargetFailureResult();
  const harness = diagnosticBootstrapHarness({
    userAgent: "界".repeat(100_000),
    testId: STORAGE_FORMAT_TEST_ID,
  });
  await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    result,
  );
  assert.equal(harness.postedBodies.length, 1);
  assert.ok(
    Buffer.byteLength(harness.postedBodies[0], "utf8") <= 48 * 1024,
    "Even adversarial Unicode input must remain under the hard client payload limit.",
  );
  const minimalPayload = JSON.parse(harness.postedBodies[0]);
  assert.equal(minimalPayload.summary.snapshotCompacted, true);
  assertDiagnosticSummary(minimalPayload.summary, STORAGE_FORMAT_TEST_ID, result);
  assert.notEqual(minimalPayload.summary.result?.truncated, true);
  assert.deepEqual(minimalPayload.summary.result.control.timingsMs, result.control.timingsMs);
  assert.deepEqual(minimalPayload.summary.result.target.timingsMs, result.target.timingsMs);
}

{
  class PayloadInflatingTextEncoder {
    encode(value) {
      const bytes = new TextEncoder().encode(String(value));
      return {
        byteLength: String(value).includes(`"build":"${DIAGNOSTIC_BUILD}"`)
          ? bytes.byteLength + 100_000
          : bytes.byteLength,
      };
    }
  }
  const result = storageTargetFailureResult();
  const harness = diagnosticBootstrapHarness({
    testId: STORAGE_FORMAT_TEST_ID,
    TextEncoderClass: PayloadInflatingTextEncoder,
  });
  await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    result,
  );
  assert.equal(harness.postedBodies.length, 1);
  const hardMinimalPayload = JSON.parse(harness.postedBodies[0]);
  assert.deepEqual(
    Object.keys(hardMinimalPayload.summary).sort(),
    ["comparison", "diagnosticVariant", "latestEvent", "result", "testId"].sort(),
  );
  assertDiagnosticSummary(hardMinimalPayload.summary, STORAGE_FORMAT_TEST_ID, result);
  assert.notEqual(hardMinimalPayload.summary.result?.truncated, true);
  assert.deepEqual(hardMinimalPayload.summary.result.control.timingsMs, result.control.timingsMs);
  assert.deepEqual(hardMinimalPayload.summary.result.target.timingsMs, result.target.timingsMs);
}

{
  const sharedSessionStorage = new Map();
  const sharedLocalStorage = new Map();
  const runCode = `diag-${"f".repeat(32)}`;
  const writeToken = "9".repeat(64);
  const firstLoad = diagnosticBootstrapHarness({
    runCode,
    writeToken,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  assert.equal(firstLoad.browser.location.hash, "", "A stored capability must be removed from the URL.");
  assert.equal(sharedSessionStorage.size, 1, "The write capability must survive a same-tab reload.");
  firstLoad.browser.__gpuStartupDiagnostics.record(
    "crash-checkpoint",
    {
      nested: { accessToken: writeToken },
      mirroredCredential: writeToken,
    },
    "running",
    "beacon",
  );
  const storedJournal = [...sharedLocalStorage.values()].join("\n");
  assert.doesNotMatch(storedJournal, new RegExp(writeToken));
  assert.doesNotMatch(storedJournal, /writeToken/);

  const reloaded = diagnosticBootstrapHarness({
    runCode,
    writeToken: "",
    sharedSessionStorage,
    sharedLocalStorage,
  });
  assert.equal(
    reloaded.browser.__gpuStartupDiagnostics.snapshot().writeToken,
    writeToken,
    "A same-tab reload must recover the diagnostic write capability.",
  );
  assert.equal(reloaded.elements.get("manualDiagnosticBackup").hidden, false);
  const recoveredBackup = JSON.parse(reloaded.elements.get("diagnosticJson").value);
  assert.equal(recoveredBackup.manualBackup.recoveredAttemptCount, 1);
  assert.ok(
    recoveredBackup.recoveredAttempts[0].payload.events.some(
      ({ name }) => name === "crash-checkpoint",
    ),
  );
  assert.doesNotMatch(JSON.stringify(recoveredBackup), new RegExp(writeToken));
  assert.match(reloaded.elements.get("diagnosticBackupHint").textContent, /Recovered data/);
  const stored = await reloaded.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    null,
  );
  assert.equal(stored, true);
  assert.equal(sharedSessionStorage.size, 0, "A terminal acknowledgement must clear the capability.");
}

{
  const sharedSessionStorage = new Map();
  const sharedLocalStorage = new Map();
  const runCode = `diag-${"e".repeat(32)}`;
  const defaultToken = "7".repeat(64);
  const storageToken = "8".repeat(64);
  const documentPipelineToken = "9".repeat(64);
  const application4096Token = "a".repeat(64);
  const defaultLoad = diagnosticBootstrapHarness({
    runCode,
    writeToken: defaultToken,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  defaultLoad.browser.__gpuStartupDiagnostics.record(
    "default-only-checkpoint",
    null,
    "running",
    "beacon",
  );
  const storageLoad = diagnosticBootstrapHarness({
    runCode,
    writeToken: storageToken,
    testId: STORAGE_FORMAT_TEST_ID,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  storageLoad.browser.__gpuStartupDiagnostics.record(
    "storage-only-checkpoint",
    null,
    "running",
    "beacon",
  );
  const documentPipelineLoad = diagnosticBootstrapHarness({
    runCode,
    writeToken: documentPipelineToken,
    testId: DOCUMENT_PIPELINE_TEST_ID,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  documentPipelineLoad.browser.__gpuStartupDiagnostics.record(
    "document-pipeline-only-checkpoint",
    null,
    "running",
    "beacon",
  );
  const application4096Load = diagnosticBootstrapHarness({
    runCode,
    writeToken: application4096Token,
    testId: APPLICATION_4096_TEST_ID,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  application4096Load.browser.__gpuStartupDiagnostics.record(
    "application-4096-only-checkpoint",
    null,
    "running",
    "beacon",
  );
  assert.equal(sharedSessionStorage.size, 4);
  assert.equal(sharedLocalStorage.size, 4);
  assert.ok([...sharedSessionStorage.keys()].some((key) => key.endsWith(`:${DEFAULT_TEST_ID}`)));
  assert.ok([...sharedSessionStorage.keys()].some((key) => key.endsWith(`:${STORAGE_FORMAT_TEST_ID}`)));
  assert.ok([...sharedSessionStorage.keys()].some((key) => key.endsWith(`:${DOCUMENT_PIPELINE_TEST_ID}`)));
  assert.ok([...sharedSessionStorage.keys()].some((key) => key.endsWith(`:${APPLICATION_4096_TEST_ID}`)));
  assert.ok([...sharedLocalStorage.keys()].some((key) => key.endsWith(`:${DEFAULT_TEST_ID}`)));
  assert.ok([...sharedLocalStorage.keys()].some((key) => key.endsWith(`:${STORAGE_FORMAT_TEST_ID}`)));
  assert.ok([...sharedLocalStorage.keys()].some((key) => key.endsWith(`:${DOCUMENT_PIPELINE_TEST_ID}`)));
  assert.ok([...sharedLocalStorage.keys()].some((key) => key.endsWith(`:${APPLICATION_4096_TEST_ID}`)));

  const defaultReload = diagnosticBootstrapHarness({
    runCode,
    writeToken: "",
    sharedSessionStorage,
    sharedLocalStorage,
  });
  const storageReload = diagnosticBootstrapHarness({
    runCode,
    writeToken: "",
    testId: STORAGE_FORMAT_TEST_ID,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  const documentPipelineReload = diagnosticBootstrapHarness({
    runCode,
    writeToken: "",
    testId: DOCUMENT_PIPELINE_TEST_ID,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  const application4096Reload = diagnosticBootstrapHarness({
    runCode,
    writeToken: "",
    testId: APPLICATION_4096_TEST_ID,
    sharedSessionStorage,
    sharedLocalStorage,
  });
  assert.equal(defaultReload.browser.__gpuStartupDiagnostics.snapshot().writeToken, defaultToken);
  assert.equal(storageReload.browser.__gpuStartupDiagnostics.snapshot().writeToken, storageToken);
  assert.equal(
    documentPipelineReload.browser.__gpuStartupDiagnostics.snapshot().writeToken,
    documentPipelineToken,
  );
  assert.equal(
    application4096Reload.browser.__gpuStartupDiagnostics.snapshot().writeToken,
    application4096Token,
  );
  const defaultBackup = JSON.parse(defaultReload.browser.__gpuStartupDiagnostics.manualBackup());
  const storageBackup = JSON.parse(storageReload.browser.__gpuStartupDiagnostics.manualBackup());
  const documentPipelineBackup = JSON.parse(
    documentPipelineReload.browser.__gpuStartupDiagnostics.manualBackup(),
  );
  const application4096Backup = JSON.parse(
    application4096Reload.browser.__gpuStartupDiagnostics.manualBackup(),
  );
  assert.equal(defaultBackup.testId, DEFAULT_TEST_ID);
  assert.equal(storageBackup.testId, STORAGE_FORMAT_TEST_ID);
  assert.equal(documentPipelineBackup.testId, DOCUMENT_PIPELINE_TEST_ID);
  assert.equal(application4096Backup.testId, APPLICATION_4096_TEST_ID);
  assert.ok(JSON.stringify(defaultBackup.recoveredAttempts).includes("default-only-checkpoint"));
  assert.ok(!JSON.stringify(defaultBackup.recoveredAttempts).includes("storage-only-checkpoint"));
  assert.ok(JSON.stringify(storageBackup.recoveredAttempts).includes("storage-only-checkpoint"));
  assert.ok(!JSON.stringify(storageBackup.recoveredAttempts).includes("default-only-checkpoint"));
  assert.ok(
    JSON.stringify(documentPipelineBackup.recoveredAttempts).includes(
      "document-pipeline-only-checkpoint",
    ),
  );
  assert.ok(!JSON.stringify(documentPipelineBackup.recoveredAttempts).includes("storage-only-checkpoint"));
  assert.ok(
    JSON.stringify(application4096Backup.recoveredAttempts).includes(
      "application-4096-only-checkpoint",
    ),
  );
  assert.ok(!JSON.stringify(application4096Backup.recoveredAttempts).includes("default-only-checkpoint"));
  assertDiagnosticSummary(defaultBackup.currentAttempt.summary, DEFAULT_TEST_ID, null);
  assertDiagnosticSummary(storageBackup.currentAttempt.summary, STORAGE_FORMAT_TEST_ID, null);
  assertDiagnosticSummary(
    documentPipelineBackup.currentAttempt.summary,
    DOCUMENT_PIPELINE_TEST_ID,
    null,
  );
  assertDiagnosticSummary(
    application4096Backup.currentAttempt.summary,
    APPLICATION_4096_TEST_ID,
    null,
  );
}

{
  const harness = diagnosticBootstrapHarness({ runCode: "", writeToken: "" });
  harness.browser.__gpuStartupDiagnostics.record(
    "application-navigation-started",
    null,
    "running",
    "wait",
  );
  harness.browser.__gpuStartupDiagnostics.record(
    "application-document-loaded",
    null,
    "running",
    "wait",
  );
  harness.browser.__gpuStartupDiagnostics.record(
    "application-frame-extension-created",
    null,
    "running",
    "wait",
  );
  harness.browser.__gpuStartupDiagnostics.record(
    "application-startup-phase",
    {
      phase: "adapter-request",
      label: "Finding a WebGPU adapter",
      state: "completed",
      totalElapsedMs: 25,
      phaseElapsedMs: 10,
    },
    "running",
    "wait",
  );
  const timeline = harness.browser.__gpuStartupDiagnostics.snapshot().summary.startupTimeline;
  assert.equal(timeline.phases.find(({ phase }) => phase === "application-navigation").state, "completed");
  assert.equal(timeline.phases.find(({ phase }) => phase === "application-module").state, "completed");
  assert.equal(timeline.phases.find(({ phase }) => phase === "adapter-request").phaseElapsedMs, 10);
  for (let index = 0; index < 30; index += 1) {
    harness.browser.__gpuStartupDiagnostics.record(
      `historical-checkpoint-${index}`,
      null,
      "running",
      "wait",
    );
  }
  assert.equal(harness.browser.__gpuStartupDiagnostics.snapshot().events.length, 24);
  assertDiagnosticSummary(
    harness.browser.__gpuStartupDiagnostics.snapshot().summary,
    DEFAULT_TEST_ID,
    null,
  );
  const stored = await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    null,
  );
  assert.equal(stored, false);
  assert.equal(harness.postedBodies.length, 0);
  assert.equal(harness.elements.get("diagnosticStatus").textContent, "Local diagnostic complete");
  assert.match(harness.elements.get("diagnosticSummary").textContent, /No report was uploaded/);
  assert.equal(harness.elements.get("manualDiagnosticBackup").hidden, false);
  const localBackup = JSON.parse(harness.elements.get("diagnosticJson").value);
  assert.ok(!Object.hasOwn(localBackup.currentAttempt, "writeToken"));
  assert.equal(localBackup.manualBackup.automaticUploadStored, false);
  assert.equal(localBackup.manualBackup.runCodeSuffix, "LOCAL");
  assert.ok(localBackup.currentAttempt.events.length > 24);
  assert.ok(localBackup.currentAttempt.events.some(({ name }) => name === "historical-checkpoint-0"));
  assertDiagnosticSummary(localBackup.currentAttempt.summary, DEFAULT_TEST_ID, null);
}

{
  const result = storageTargetFailureResult();
  const harness = diagnosticBootstrapHarness({
    runCode: "",
    writeToken: "",
    testId: STORAGE_FORMAT_TEST_ID,
  });
  for (let index = 0; index < 40; index += 1) {
    harness.browser.__gpuStartupDiagnostics.record(
      `storage-history-${index}`,
      { index },
      "running",
      "wait",
    );
  }
  assert.equal(harness.browser.__gpuStartupDiagnostics.snapshot().events.length, 24);
  await harness.browser.__gpuStartupDiagnostics.finish(
    "completed",
    "diagnostic-completed",
    result,
  );
  const snapshot = harness.browser.__gpuStartupDiagnostics.snapshot();
  assert.equal(snapshot.events.length, 24);
  assertDiagnosticSummary(snapshot.summary, STORAGE_FORMAT_TEST_ID, result);
  const backup = JSON.parse(harness.elements.get("diagnosticJson").value);
  assert.ok(backup.currentAttempt.events.length > 24);
  assert.ok(backup.currentAttempt.events.some(({ name }) => name === "storage-history-0"));
  assertDiagnosticSummary(backup.currentAttempt.summary, STORAGE_FORMAT_TEST_ID, result);
  assert.notEqual(backup.currentAttempt.summary.result?.truncated, true);
  assert.deepEqual(backup.currentAttempt.summary.result.control.timingsMs, result.control.timingsMs);
  assert.deepEqual(backup.currentAttempt.summary.result.target.timingsMs, result.target.timingsMs);
}

{
  const missingClipboard = diagnosticBootstrapHarness({
    runCode: "",
    writeToken: "",
    clipboardMode: "missing",
  });
  await missingClipboard.browser.__gpuStartupDiagnostics.finish(
    "failed",
    "diagnostic-failed",
    null,
  );
  await missingClipboard.browser.__gpuStartupDiagnostics.copyManualBackup();
  assert.deepEqual(missingClipboard.legacyCopyCommands, ["copy"]);
  assert.ok(missingClipboard.selectionCount() >= 2);
  assert.equal(
    missingClipboard.elements.get("diagnosticCopyStatus").textContent,
    "JSON copied. Paste it into the chat.",
  );
}

{
  const deniedClipboard = diagnosticBootstrapHarness({
    runCode: "",
    writeToken: "",
    clipboardMode: "reject",
    legacyCopyResult: false,
  });
  await deniedClipboard.browser.__gpuStartupDiagnostics.finish(
    "failed",
    "diagnostic-failed",
    null,
  );
  await deniedClipboard.browser.__gpuStartupDiagnostics.copyManualBackup();
  assert.deepEqual(deniedClipboard.legacyCopyCommands, ["copy"]);
  assert.ok(deniedClipboard.selectionCount() >= 2);
  assert.equal(
    deniedClipboard.elements.get("diagnosticCopyStatus").textContent,
    "JSON selected. Press and hold the box, then choose Copy.",
  );
}

const builtWorkerPath = resolve(root, "dist/server/index.js");
if (process.argv.includes("--require-build")) {
  assert.ok(existsSync(builtWorkerPath), "A fresh canonical Sites build is required.");
}
if (existsSync(builtWorkerPath)) {
  assert.ok(
    existsSync(resolve(root, "dist/.openai/drizzle/0007_gpu_startup_diagnostic_summary.sql")),
    "The canonical Sites build must package migration 0007.",
  );
  const staticDiagnosticHtmlPath = resolve(root, "dist/client/gpu-startup-diagnostics.html");
  assert.ok(
    !existsSync(staticDiagnosticHtmlPath),
    "The diagnostic HTML must only be exposed through its protected Worker route.",
  );
  const emittedDiagnosticHtmlPath = resolve(
    root,
    "dist-gpu-diagnostics/gpu-startup-diagnostics.html",
  );
  assert.ok(existsSync(emittedDiagnosticHtmlPath), "The diagnostic Vite build is missing its HTML.");
  const builtDiagnosticHtml = readFileSync(emittedDiagnosticHtmlPath, "utf8");
  const assetReferences = [...builtDiagnosticHtml.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)];
  assert.ok(assetReferences.length > 0, "The built diagnostic page must reference an emitted asset.");
  for (const reference of assetReferences) {
    const emittedAsset = resolve(root, "dist-gpu-diagnostics/assets", reference[1]);
    const canonicalAsset = resolve(root, "dist/client/assets", reference[1]);
    assert.ok(existsSync(canonicalAsset), `Missing diagnostic asset ${reference[1]}.`);
    assert.deepEqual(
      readFileSync(canonicalAsset),
      readFileSync(emittedAsset),
      `Diagnostic asset ${reference[1]} changed while joining the canonical build.`,
    );
  }

  function outputFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = resolve(directory, entry.name);
      return entry.isDirectory() ? outputFiles(absolute) : [absolute];
    });
  }
  const emittedAssetsRoot = resolve(root, "dist-gpu-diagnostics/assets");
  for (const emittedAsset of outputFiles(emittedAssetsRoot)) {
    const relativeAsset = relative(emittedAssetsRoot, emittedAsset);
    const canonicalAsset = resolve(root, "dist/client/assets", relativeAsset);
    assert.ok(existsSync(canonicalAsset), `Missing emitted diagnostic asset ${relativeAsset}.`);
    assert.deepEqual(
      readFileSync(canonicalAsset),
      readFileSync(emittedAsset),
      `Diagnostic asset ${relativeAsset} is not byte-identical in the canonical build.`,
    );
  }

  class FakeStatement {
    constructor(database, sql) {
      this.database = database;
      this.sql = sql;
      this.values = [];
    }

    bind(...values) {
      this.values = values;
      return this;
    }

    async run() {
      let changes = 0;
      if (this.sql.startsWith("INSERT OR IGNORE INTO gpu_startup_diagnostic_runs")) {
        const [runCode, createdAt, expiresAt, resultSummary, payloadBytes, payloadJson] = this.values;
        if (!this.database.rows.has(runCode)) {
          this.database.rows.set(runCode, {
            run_code: runCode,
            write_token_hash: "",
            created_at: createdAt,
            updated_at: createdAt,
            expires_at: expiresAt,
            status: "html-requested",
            sequence: 0,
            latest_event: "html-requested",
            result_summary: resultSummary,
            payload_bytes: payloadBytes,
            payload_json: payloadJson,
          });
          changes = 1;
        }
      } else if (this.sql.startsWith("INSERT INTO gpu_startup_diagnostic_runs")) {
        const [
          runCode,
          tokenHash,
          createdAt,
          updatedAt,
          expiresAt,
          status,
          sequence,
          latestEvent,
          resultSummary,
          payloadBytes,
          payloadJson,
        ] = this.values;
        const existing = this.database.rows.get(runCode);
        const existingTerminal = existing?.status === "completed" || existing?.status === "failed";
        const incomingTerminal = status === "completed" || status === "failed";
        const tokenAllowed = !existing
          || existing.write_token_hash === ""
          || existing.write_token_hash === tokenHash;
        if (
          !existing
          || (tokenAllowed && sequence >= existing.sequence && (!existingTerminal || incomingTerminal))
        ) {
          this.database.rows.set(runCode, {
            run_code: runCode,
            write_token_hash: existing?.write_token_hash || tokenHash,
            created_at: existing?.created_at || createdAt,
            updated_at: updatedAt,
            expires_at: expiresAt,
            status,
            sequence,
            latest_event: latestEvent,
            result_summary: resultSummary,
            payload_bytes: payloadBytes,
            payload_json: payloadJson,
          });
          changes = 1;
        }
      }
      return { meta: { changes } };
    }

    async first() {
      if (
        this.sql.startsWith("SELECT write_token_hash")
        || this.sql.startsWith("SELECT status, sequence")
        || this.sql.startsWith("SELECT result_summary")
      ) {
        const row = this.database.rows.get(this.values[0]) ?? null;
        if (
          row
          && this.sql.startsWith("SELECT write_token_hash")
          && this.database.claimAfterNextEmptyTokenRead
          && row.write_token_hash === ""
        ) {
          const snapshot = { ...row };
          row.write_token_hash = this.database.claimAfterNextEmptyTokenRead;
          this.database.claimAfterNextEmptyTokenRead = null;
          return snapshot;
        }
        return row;
      }
      return null;
    }
  }

  class FakeDatabase {
    rows = new Map();
    claimAfterNextEmptyTokenRead = null;

    prepare(sql) {
      return new FakeStatement(this, sql);
    }

    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  }

  const workerUrl = pathToFileURL(builtWorkerPath);
  workerUrl.searchParams.set("gpu-diagnostic-verification", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  const database = new FakeDatabase();
  const environment = {
    DB: database,
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const runCode = `diag-${"a".repeat(32)}`;
  const writeToken = "b".repeat(64);
  const pageResponse = await worker.fetch(
    new Request(`https://example.test/gpu-startup-lab?run=${runCode}`, {
      headers: { "User-Agent": "Diagnostic Test Browser" },
    }),
    environment,
  );
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("Cache-Control") ?? "", /\bno-store\b/);
  assert.equal(pageResponse.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(await pageResponse.text(), builtDiagnosticHtml.replace(/\r\n?/g, "\n"));
  assert.equal(database.rows.get(runCode)?.status, "html-requested");
  const requestedDefaultSummary = JSON.parse(database.rows.get(runCode).result_summary);
  assert.ok(!Object.hasOwn(requestedDefaultSummary, "reportStored"));
  assertDiagnosticSummary(requestedDefaultSummary, DEFAULT_TEST_ID, null);

  const storageRunCode = `diag-${"c".repeat(32)}`;
  const storagePageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${storageRunCode}&test=${STORAGE_FORMAT_TEST_ID}`,
      { headers: { "User-Agent": "Storage Diagnostic Test Browser" } },
    ),
    environment,
  );
  assert.equal(storagePageResponse.status, 200);
  assert.equal(
    await storagePageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(storageRunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(storageRunCode).result_summary),
    STORAGE_FORMAT_TEST_ID,
    null,
  );

  const documentPipelineRunCode = `diag-${"f".repeat(32)}`;
  const documentPipelinePageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${documentPipelineRunCode}&test=${DOCUMENT_PIPELINE_TEST_ID}`,
      { headers: { "User-Agent": "Document Pipeline Diagnostic Test Browser" } },
    ),
    environment,
  );
  assert.equal(documentPipelinePageResponse.status, 200);
  assert.equal(
    await documentPipelinePageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(documentPipelineRunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(documentPipelineRunCode).result_summary),
    DOCUMENT_PIPELINE_TEST_ID,
    null,
  );

  const application4096RunCode = `diag-${"1".repeat(32)}`;
  const application4096PageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096RunCode}&test=${APPLICATION_4096_TEST_ID}`,
      { headers: { "User-Agent": "Application 4096 Diagnostic Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096PageResponse.status, 200);
  assert.equal(
    await application4096PageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(application4096RunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096RunCode).result_summary),
    APPLICATION_4096_TEST_ID,
    null,
  );

  const application4096Async2RunCode = `diag-${"2".repeat(32)}`;
  const application4096Async2PageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096Async2RunCode}&test=${APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID}`,
      { headers: { "User-Agent": "Application Pipeline Queue Diagnostic Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096Async2PageResponse.status, 200);
  assert.equal(
    await application4096Async2PageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(application4096Async2RunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096Async2RunCode).result_summary),
    APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    null,
  );

  const application4096FirstFrameRunCode = `diag-${"3".repeat(32)}`;
  const application4096FirstFramePageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096FirstFrameRunCode}&test=${APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID}`,
      { headers: { "User-Agent": "Application First Frame Diagnostic Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096FirstFramePageResponse.status, 200);
  assert.equal(
    await application4096FirstFramePageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(application4096FirstFrameRunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096FirstFrameRunCode).result_summary),
    APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID,
    null,
  );

  const application4096BreakdownRunCode = `diag-${"4".repeat(32)}`;
  const application4096BreakdownPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096BreakdownRunCode}&test=${APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID}`,
      { headers: { "User-Agent": "Application Pipeline Breakdown Diagnostic Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096BreakdownPageResponse.status, 200);
  assert.equal(
    await application4096BreakdownPageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(application4096BreakdownRunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096BreakdownRunCode).result_summary),
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    null,
  );

  const application4096BreakdownSecondRunCode = `diag-${"5".repeat(32)}`;
  const application4096BreakdownSecondPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096BreakdownSecondRunCode}&test=${APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID}`,
      { headers: { "User-Agent": "Second Platform Pipeline Breakdown Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096BreakdownSecondPageResponse.status, 200);
  assert.equal(
    await application4096BreakdownSecondPageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assert.equal(database.rows.get(application4096BreakdownSecondRunCode)?.status, "html-requested");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096BreakdownSecondRunCode).result_summary),
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    null,
  );

  const application4096AttributionRunCode = `diag-${"d".repeat(32)}`;
  const application4096AttributionPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096AttributionRunCode}&test=${APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID}`,
      { headers: { "User-Agent": "Pipeline Attribution Cold Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096AttributionPageResponse.status, 200);
  assert.equal(
    await application4096AttributionPageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096AttributionRunCode).result_summary),
    APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    null,
  );

  const application4096AttributionWarmRunCode = `diag-${"e".repeat(32)}`;
  const application4096AttributionWarmPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096AttributionWarmRunCode}&test=${APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID}`,
      { headers: { "User-Agent": "Pipeline Attribution Warm Test Browser" } },
    ),
    environment,
  );
  assert.equal(application4096AttributionWarmPageResponse.status, 200);
  assert.equal(
    await application4096AttributionWarmPageResponse.text(),
    builtDiagnosticHtml.replace(/\r\n?/g, "\n"),
  );
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096AttributionWarmRunCode).result_summary),
    APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    null,
  );

  const mismatchedPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${runCode}&test=${STORAGE_FORMAT_TEST_ID}`,
    ),
    environment,
  );
  assert.equal(mismatchedPageResponse.status, 409);
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(runCode).result_summary),
    DEFAULT_TEST_ID,
    null,
  );

  const unknownRunCode = `diag-${"0".repeat(32)}`;
  const unknownPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${unknownRunCode}&test=unknown-test-v1`,
    ),
    environment,
  );
  assert.equal(unknownPageResponse.status, 400);
  assert.equal(database.rows.has(unknownRunCode), false);

  const frameResponse = await worker.fetch(
    new Request(
      "https://example.test/gpu-startup-app-frame?diagnosticBoot=1&documentWidth=2048&documentHeight=2048&documentSize=2048&diagnosticVariant=rgba16float-no-texture-formats-tier2-v1&forceGlazeCommitFallback=1",
    ),
    environment,
  );
  assert.equal(frameResponse.status, 200);
  assert.match(frameResponse.headers.get("Cache-Control") ?? "", /\bno-store\b/);
  assert.equal(frameResponse.headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(frameResponse.headers.get("Content-Security-Policy"), "frame-ancestors 'self'");
  const frameHtml = await frameResponse.text();
  const frameBootstrapIndex = frameHtml.indexOf("gpu-startup-app-frame-v3");
  const frameModuleIndex = frameHtml.search(/<script\s+type="module"/);
  assert.ok(frameBootstrapIndex >= 0 && frameModuleIndex > frameBootstrapIndex);
  assert.match(frameHtml, /restorePersistedBrushOnStartup:\s*true/);
  assert.match(frameHtml, /afterEngineInitialized:\s*async function/);

  const frameBootstrapSource = [...frameHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((source) => source.includes("gpu-startup-app-frame-v3"));
  assert.ok(frameBootstrapSource, "The protected frame must contain an executable early reporter.");
  const frameMessages = [];
  const frameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: "?diagnosticBoot=1&diagnosticVariant=rgba16float-no-texture-formats-tier2-v1&forceGlazeCommitFallback=1",
    },
    isSecureContext: true,
    addEventListener() {},
    parent: {
      postMessage(message, targetOrigin) {
        frameMessages.push({ message, targetOrigin });
      },
    },
  };
  frameWindow.window = frameWindow;
  const frameConsole = { error() {} };
  runInNewContext(frameBootstrapSource, {
    window: frameWindow,
    document: { visibilityState: "visible" },
    console: frameConsole,
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  const frameExtension = frameWindow.__editorExtensionBootstrap.create({
    engine: {
      documentWidth: 2048,
      documentHeight: 2048,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      adapter: { features: { has: () => true } },
      device: { features: { has: () => false } },
      lightGlazeInPlaceCommitSupported: false,
      lightGlazeInPlaceCommitPipeline: null,
      getStats: () => ({
        layerFormat: "rgba16float",
        layerCount: 1,
        layerMemoryMiB: 32,
        gpuLabel: "Verification GPU",
        layerStorageStudy: {
          bytesPerPixel: 8,
          fullLayerMiB: 32,
          eagerFullRawMiB: 32,
          actualRawMiB: 32,
          tileSizePx: 256,
          tileCount: 64,
        },
        gpuMemory: { countedTotalMiB: 48, registeredCurrentMiB: 48 },
      }),
    },
  });
  frameExtension.handleEngineStartupProgress({
    phase: "device-request",
    label: "Creating the WebGPU device",
    state: "completed",
    totalElapsedMs: 42,
    phaseElapsedMs: 12,
    detail: null,
  });
  await frameExtension.afterEngineInitialized();
  const startupProgressMessage = frameMessages.find(
    ({ message }) => message.type === "startup-progress",
  );
  assert.ok(startupProgressMessage, "The protected frame must forward timed startup phases.");
  assert.equal(startupProgressMessage.message.detail.phase, "device-request");
  const engineReadyMessage = frameMessages.find(({ message }) => message.type === "engine-ready");
  assert.ok(engineReadyMessage, "The early frame extension must report the observed engine state.");
  assert.equal(engineReadyMessage.message.detail.documentWidth, 2048);
  assert.equal(engineReadyMessage.message.detail.documentHeight, 2048);
  assert.equal(engineReadyMessage.message.detail.layerFormat, "rgba16float");
  assert.equal(engineReadyMessage.message.detail.canvasFormat, "rgba16float");
  assert.equal(
    engineReadyMessage.message.detail.diagnosticVariant,
    "rgba16float-no-texture-formats-tier2-v1",
  );
  assert.equal(engineReadyMessage.message.detail.featureIsolation.textureFormatsTier2Enabled, false);
  assert.equal(engineReadyMessage.message.detail.featureIsolation.textureFormatsTier2Advertised, true);
  assert.equal(engineReadyMessage.message.detail.featureIsolation.inPlaceGlazeCommitEnabled, false);
  assert.equal(
    engineReadyMessage.message.detail.featureIsolation.inPlaceGlazeCommitPipelineCreated,
    false,
  );
  assert.equal(engineReadyMessage.message.detail.storage.bytesPerPixel, 8);
  assert.equal(engineReadyMessage.message.detail.storage.fullLayerMiB, 32);
  frameConsole.error("Failure at https://example.test/private/path?token=secret");
  const consoleErrorMessage = frameMessages.find(({ message }) => message.type === "console-error");
  assert.ok(consoleErrorMessage);
  assert.doesNotMatch(JSON.stringify(consoleErrorMessage.message.detail), /secret|private\/path/);
  assert.ok(frameMessages.every(({ targetOrigin }) => targetOrigin === "https://example.test"));

  const application4096Messages = [];
  const application4096Records = [];
  const application4096Order = [];
  const application4096DeviceListeners = new Map();
  let resolveApplication4096Lost;
  const application4096Lost = new Promise((resolve) => {
    resolveApplication4096Lost = resolve;
  });
  const originalApplication4096CreatePipelineLayout = function (descriptor) {
    return { label: descriptor.label };
  };
  const application4096Device = {
    features: { has: () => false },
    addEventListener(type, listener) {
      application4096DeviceListeners.set(type, listener);
    },
    lost: application4096Lost,
    createPipelineLayout: originalApplication4096CreatePipelineLayout,
  };
  let application4096RequestDescriptor = null;
  const application4096Adapter = {
    async requestDevice(descriptor) {
      application4096RequestDescriptor = descriptor;
      return application4096Device;
    },
  };
  const application4096Gpu = {
    async requestAdapter() {
      return application4096Adapter;
    },
  };
  const application4096Parent = {
    __gpuStartupDiagnostics: {
      record() { return true; },
      recordBreadcrumb(name, detail, status) {
        application4096Records.push({ name, detail, status });
        application4096Order.push(`record:${name}`);
        return true;
      },
    },
    postMessage(message, targetOrigin) {
      application4096Messages.push({ message, targetOrigin });
      application4096Order.push(`message:${message.type}`);
    },
  };
  const application4096FrameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: `?diagnosticBoot=1&test=${APPLICATION_4096_TEST_ID}&documentWidth=4096&documentHeight=4096&documentSize=4096&diagnosticVariant=${APPLICATION_4096_VARIANT}&forceGlazeCommitFallback=1`,
    },
    isSecureContext: true,
    addEventListener() {},
    parent: application4096Parent,
  };
  application4096FrameWindow.window = application4096FrameWindow;
  runInNewContext(frameBootstrapSource, {
    window: application4096FrameWindow,
    document: { visibilityState: "visible" },
    navigator: { gpu: application4096Gpu },
    performance: { now: () => 100 },
    console: { error() {} },
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  assert.deepEqual(
    Object.keys(application4096FrameWindow.__editorExtensionBootstrap.engineOptions),
    [],
    "The synchronous 4096 baseline must keep the default engine options.",
  );
  const application4096Async2FrameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: `?diagnosticBoot=1&test=${APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID}&documentWidth=4096&documentHeight=4096&documentSize=4096&diagnosticVariant=${APPLICATION_4096_PIPELINES_ASYNC2_VARIANT}&forceGlazeCommitFallback=1`,
    },
    isSecureContext: true,
    addEventListener() {},
    parent: { postMessage() {} },
  };
  application4096Async2FrameWindow.window = application4096Async2FrameWindow;
  runInNewContext(frameBootstrapSource, {
    window: application4096Async2FrameWindow,
    document: { visibilityState: "visible" },
    navigator: { gpu: { requestAdapter: async () => null } },
    performance: { now: () => 100 },
    console: { error() {} },
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  assert.equal(
    application4096Async2FrameWindow.__editorExtensionBootstrap.engineOptions
      .documentPipelineCompilationConcurrency,
    2,
  );
  assert.deepEqual(
    Object.keys(application4096Async2FrameWindow.__editorExtensionBootstrap.engineOptions),
    ["documentPipelineCompilationConcurrency"],
  );
  const application4096FirstFrameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: `?diagnosticBoot=1&test=${APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID}&documentWidth=4096&documentHeight=4096&documentSize=4096&diagnosticVariant=${APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT}&forceGlazeCommitFallback=1`,
    },
    isSecureContext: true,
    addEventListener() {},
    parent: { postMessage() {} },
  };
  application4096FirstFrameWindow.window = application4096FirstFrameWindow;
  runInNewContext(frameBootstrapSource, {
    window: application4096FirstFrameWindow,
    document: { visibilityState: "visible" },
    navigator: { gpu: { requestAdapter: async () => null } },
    performance: { now: () => 100 },
    console: { error() {} },
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  assert.equal(
    application4096FirstFrameWindow.__editorExtensionBootstrap.engineOptions
      .documentPipelineCompilationScope,
    "first-frame-diagnostic",
  );
  assert.deepEqual(
    Object.keys(application4096FirstFrameWindow.__editorExtensionBootstrap.engineOptions),
    ["documentPipelineCompilationScope"],
  );
  const application4096BreakdownMessages = [];
  const application4096BreakdownFrameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: `?diagnosticBoot=1&test=${APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID}&documentWidth=4096&documentHeight=4096&documentSize=4096&diagnosticVariant=${APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT}&forceGlazeCommitFallback=1`,
    },
    isSecureContext: true,
    addEventListener() {},
    parent: {
      postMessage(message, targetOrigin) {
        application4096BreakdownMessages.push({ message, targetOrigin });
      },
    },
  };
  application4096BreakdownFrameWindow.window = application4096BreakdownFrameWindow;
  runInNewContext(frameBootstrapSource, {
    window: application4096BreakdownFrameWindow,
    document: { visibilityState: "visible" },
    navigator: { gpu: { requestAdapter: async () => null } },
    performance: { now: () => 100 },
    console: { error() {} },
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  assert.deepEqual(
    Object.keys(application4096BreakdownFrameWindow.__editorExtensionBootstrap.engineOptions),
    [],
    "The breakdown must measure the unchanged synchronous engine path.",
  );
  assert.ok(
    application4096BreakdownMessages.some(({ message }) => (
      message.type === "document-pipeline-instrumentation"
      && message.detail.installed === true
    )),
  );
  const observedApplication4096Adapter = await application4096Gpu.requestAdapter();
  assert.equal(observedApplication4096Adapter, application4096Adapter);
  const observedApplication4096Device = await observedApplication4096Adapter.requestDevice({
    requiredFeatures: [],
  });
  assert.equal(observedApplication4096Device, application4096Device);
  assert.deepEqual(application4096RequestDescriptor.requiredFeatures, []);
  assert.equal(
    application4096Device.createPipelineLayout,
    originalApplication4096CreatePipelineLayout,
    "The 4096 observer must not wrap native pipeline methods.",
  );
  const observationMessage = application4096Messages.find(
    ({ message }) => message.type === "application-gpu-observation",
  );
  const observedAdapterMessage = application4096Messages.find(
    ({ message }) => message.type === "application-gpu-adapter-observed",
  );
  const observedDeviceMessage = application4096Messages.find(
    ({ message }) => message.type === "application-gpu-device-observed",
  );
  assert.equal(observationMessage.message.detail.installed, true);
  assert.equal(observationMessage.message.detail.nativePipelineMethodsWrapped, false);
  assert.equal(observedAdapterMessage.message.detail.requestDeviceObserved, true);
  assert.equal(observedAdapterMessage.message.detail.adapterCount, 1);
  assert.equal(observedDeviceMessage.message.detail.deviceCount, 1);
  assert.deepEqual(observedDeviceMessage.message.detail.requiredFeatures, []);
  assert.equal(observedDeviceMessage.message.detail.textureFormatsTier2Enabled, false);

  const application4096Extension = application4096FrameWindow.__editorExtensionBootstrap.create({
    engine: {},
  });
  application4096Extension.handleEngineStartupProgress({
    phase: "document-layer-texture",
    state: "started",
    totalElapsedMs: 100,
    phaseElapsedMs: 0,
  });
  const phaseRecordIndex = application4096Order.indexOf("record:application-startup-phase");
  const phaseMessageIndex = application4096Order.indexOf("message:startup-progress");
  assert.ok(phaseRecordIndex >= 0 && phaseMessageIndex > phaseRecordIndex);
  const phaseMessage = application4096Messages.find(
    ({ message }) => message.type === "startup-progress",
  );
  assert.equal(phaseMessage.message.detail.durableCheckpoint, true);

  application4096DeviceListeners.get("uncapturederror")?.({
    error: new Error("4096 verification uncaptured error"),
  });
  assert.ok(
    application4096Records.some(({ name }) => name === "application-gpu-uncaptured-error"),
  );
  resolveApplication4096Lost({ reason: "unknown", message: "4096 verification device lost" });
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(
    application4096Records.some(({ name }) => name === "application-gpu-device-lost"),
  );
  const recordCountBeforeTeardown = application4096Records.length;
  application4096FrameWindow.__gpuStartupDiagnosticTeardown = true;
  application4096DeviceListeners.get("uncapturederror")?.({
    error: new Error("ignored teardown error"),
  });
  assert.equal(application4096Records.length, recordCountBeforeTeardown);

  const pipelineFrameMessages = [];
  const durablePipelineRecords = [];
  const fallbackPipelineRecords = [];
  const pipelineCallOrder = [];
  const pipelineDeviceListeners = new Map();
  let pipelineClock = 100;
  const popScopeResults = [null, new Error("Verification validation scope error")];
  const pipelineDevice = {
    features: { has: () => false },
    addEventListener(type, listener) { pipelineDeviceListeners.set(type, listener); },
    lost: new Promise(() => {}),
    createPipelineLayout(descriptor) {
      pipelineCallOrder.push(`native:${descriptor.label}`);
      return { label: descriptor.label };
    },
    createRenderPipeline(descriptor) {
      pipelineCallOrder.push(`native:${descriptor.label}`);
      if (descriptor.label === "Rejected pipeline") {
        const error = new Error("Pipeline rejected by verification device.");
        error.reason = "validation";
        throw error;
      }
      return { label: descriptor.label };
    },
    popErrorScope() {
      pipelineCallOrder.push("native:popErrorScope");
      return Promise.resolve(popScopeResults.shift() ?? null);
    },
  };
  const pipelineAdapter = {
    requestDevice: async () => pipelineDevice,
  };
  const pipelineGpu = {
    requestAdapter: async () => pipelineAdapter,
  };
  const pipelineParent = {
    __gpuStartupDiagnostics: {
      record(name, detail, status, delivery) {
        fallbackPipelineRecords.push({ name, detail, status, delivery });
        pipelineCallOrder.push(`record:${name}:${detail?.label ?? ""}`);
        return true;
      },
      recordBreadcrumb(name, detail, status) {
        durablePipelineRecords.push({ name, detail, status });
        pipelineClock += 1_000;
        pipelineCallOrder.push(`breadcrumb:${name}:${detail?.label ?? ""}`);
        return true;
      },
    },
    postMessage(message, targetOrigin) {
      pipelineFrameMessages.push({ message, targetOrigin });
    },
  };
  const pipelineFrameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: `?diagnosticBoot=1&test=${DOCUMENT_PIPELINE_TEST_ID}&diagnosticVariant=${DOCUMENT_PIPELINE_VARIANT}&forceGlazeCommitFallback=1`,
    },
    isSecureContext: true,
    addEventListener() {},
    parent: pipelineParent,
  };
  pipelineFrameWindow.window = pipelineFrameWindow;
  runInNewContext(frameBootstrapSource, {
    window: pipelineFrameWindow,
    document: { visibilityState: "visible" },
    navigator: { gpu: pipelineGpu },
    performance: { now: () => (pipelineClock += 5) },
    console: { error() {} },
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  const observedPipelineAdapter = await pipelineGpu.requestAdapter();
  assert.equal(observedPipelineAdapter, pipelineAdapter);
  const observedPipelineDevice = await observedPipelineAdapter.requestDevice({ requiredFeatures: [] });
  assert.equal(
    observedPipelineDevice,
    pipelineDevice,
    "Instrumentation must retain the native device object for WebIDL consumers.",
  );
  const pipelineExtension = pipelineFrameWindow.__editorExtensionBootstrap.create({
    engine: {
      documentWidth: 2048,
      documentHeight: 2048,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      adapter: pipelineAdapter,
      device: pipelineDevice,
      lightGlazeInPlaceCommitSupported: false,
      lightGlazeInPlaceCommitPipeline: null,
      getStats: () => ({ layerFormat: "rgba16float", layerCount: 1 }),
    },
  });
  pipelineDevice.createPipelineLayout({ label: "Outside layout before phase" });
  pipelineDevice.createRenderPipeline({ label: "Outside render before phase" });
  pipelineExtension.handleEngineStartupProgress({
    phase: "document-pipelines",
    label: "Compiling document pipelines",
    state: "started",
    totalElapsedMs: 10,
    phaseElapsedMs: 0,
    detail: { format: "rgba16float" },
  });
  pipelineDevice.createPipelineLayout({ label: "Accepted pipeline layout" });
  pipelineDevice.createRenderPipeline({
    label: "Accepted pipeline",
    vertex: { entryPoint: "vertexMain" },
    fragment: { entryPoint: "fragmentMain", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });
  pipelineDeviceListeners.get("uncapturederror")?.({
    error: new Error("During-phase uncaptured verification error"),
  });
  await pipelineDevice.popErrorScope();
  await pipelineDevice.popErrorScope();
  assert.throws(
    () => pipelineDevice.createRenderPipeline({
      label: "Rejected pipeline",
      vertex: { entryPoint: "vertexMain" },
      fragment: { entryPoint: "fragmentMain", targets: [{ format: "rgba16float" }] },
    }),
    /Pipeline rejected/,
  );
  pipelineExtension.handleEngineStartupProgress({
    phase: "document-pipelines",
    label: "Compiling document pipelines",
    state: "failed",
    totalElapsedMs: 30,
    phaseElapsedMs: 20,
    detail: { name: "OperationError" },
  });
  pipelineDeviceListeners.get("uncapturederror")?.({
    error: new Error("Post-phase uncaptured verification error"),
  });
  const messageCountBeforeTeardownError = pipelineFrameMessages.length;
  pipelineFrameWindow.__gpuStartupDiagnosticTeardown = true;
  pipelineDeviceListeners.get("uncapturederror")?.({
    error: new Error("Intentional teardown verification error"),
  });
  assert.equal(pipelineFrameMessages.length, messageCountBeforeTeardownError);
  pipelineDevice.createPipelineLayout({ label: "Outside layout after phase" });
  pipelineDevice.createRenderPipeline({ label: "Outside render after phase" });

  const durableStarts = durablePipelineRecords.filter(
    ({ name }) => name === "application-document-gpu-call-started",
  );
  assert.equal(durableStarts.length, 5);
  assert.equal(durableStarts[0].detail.pipelineLayoutIndex, 1);
  assert.equal(durableStarts[1].detail.renderPipelineIndex, 1);
  assert.equal(durableStarts[2].detail.errorScopeDrainIndex, 1);
  assert.equal(durableStarts[2].detail.label, "Validation error scope drain");
  assert.equal(durableStarts[3].detail.errorScopeDrainIndex, 2);
  assert.equal(durableStarts[3].detail.label, "Out-of-memory error scope drain");
  assert.equal(durableStarts[4].detail.renderPipelineIndex, 2);
  assert.equal(durableStarts[4].detail.previousCompletedRenderPipeline.renderPipelineIndex, 1);
  assert.equal(fallbackPipelineRecords.length, 0);
  assert.ok(durableStarts.every(({ detail }) => detail.nativeStartedAtMs > detail.checkpointStartedAtMs));
  assert.ok(
    durableStarts.every(({ detail }) => detail.instrumentationPreparationMs >= 1_000),
    "Pre-native diagnostic work must be measured separately from the native GPU call.",
  );
  assert.ok(
    pipelineCallOrder.indexOf("breadcrumb:application-document-gpu-call-started:Accepted pipeline")
      < pipelineCallOrder.indexOf("native:Accepted pipeline"),
    "The durable breadcrumb must precede the native pipeline call.",
  );
  assert.ok(
    pipelineCallOrder.indexOf("breadcrumb:application-document-gpu-call-started:Rejected pipeline")
      < pipelineCallOrder.indexOf("native:Rejected pipeline"),
    "The rejected pipeline must be checkpointed before entering the native call.",
  );
  const durableFailure = durablePipelineRecords.find(
    ({ name }) => name === "application-document-gpu-call-failed",
  );
  assert.ok(durableFailure);
  assert.equal(durableFailure.detail.label, "Rejected pipeline");
  assert.equal(durableFailure.detail.pipelineReason, "validation");
  const emittedFailure = pipelineFrameMessages.find(
    ({ message }) => message.type === "document-gpu-call-failed",
  );
  assert.ok(emittedFailure);
  assert.equal(emittedFailure.message.detail.error.message, "Pipeline rejected by verification device.");
  assert.equal(emittedFailure.message.detail.pipelineReason, "validation");
  assert.equal(emittedFailure.message.detail.durableCheckpoint, true);
  const emittedScopeError = pipelineFrameMessages.find(
    ({ message }) => message.type === "document-gpu-scope-error",
  );
  assert.ok(emittedScopeError);
  assert.equal(emittedScopeError.message.detail.scopeError.message, "Verification validation scope error");
  assert.equal(emittedScopeError.message.detail.durableCheckpoint, true);
  const emittedUncapturedErrors = pipelineFrameMessages.filter(
    ({ message }) => message.type === "document-gpu-uncaptured-error",
  );
  assert.equal(emittedUncapturedErrors.length, 2);
  assert.equal(emittedUncapturedErrors[0].message.detail.duringTargetPhase, true);
  assert.equal(emittedUncapturedErrors[0].message.detail.durableCheckpoint, true);
  assert.equal(emittedUncapturedErrors[1].message.detail.duringTargetPhase, false);
  assert.equal(emittedUncapturedErrors[1].message.detail.durableCheckpoint, false);
  assert.equal(
    durablePipelineRecords.filter(
      ({ name }) => name === "application-document-gpu-uncaptured-error",
    ).length,
    1,
  );
  const acceptedCompletion = pipelineFrameMessages.find(
    ({ message }) => message.type === "document-gpu-call-completed"
      && message.detail.label === "Accepted pipeline",
  );
  assert.ok(acceptedCompletion);
  assert.equal(acceptedCompletion.message.detail.durationMs, 5);
  assert.ok(acceptedCompletion.message.detail.instrumentationPreparationMs >= 1_000);
  assert.ok(
    pipelineFrameMessages.some(
      ({ message }) => message.type === "document-pipeline-instrumentation"
        && message.detail.installed === true,
    ),
  );
  assert.ok(
    pipelineFrameMessages.some(
      ({ message }) => message.type === "document-pipeline-device-patched"
        && message.detail.pipelineLayoutPatched === true
        && message.detail.renderPipelinePatched === true
        && message.detail.popErrorScopePatched === true
        && message.detail.textureFormatsTier2Enabled === false,
    ),
  );
  assert.equal(
    pipelineFrameMessages.filter(({ message }) => message.type === "document-gpu-call-started").length,
    5,
    "Calls outside document-pipelines must not enter the diagnostic trace.",
  );

  const asyncPipelineMessages = [];
  const asyncPipelineBreadcrumbs = [];
  let asyncPipelineClock = 100;
  let settleAsyncPipeline = null;
  let rejectAsyncPipeline = null;
  let asyncPipelineNativeThis = null;
  const asyncPipelineDevice = {
    features: { has: () => false },
    addEventListener() {},
    lost: new Promise(() => {}),
    createPipelineLayout(descriptor) { return { label: descriptor.label }; },
    createRenderPipelineAsync(descriptor) {
      asyncPipelineNativeThis = this;
      return new Promise((resolve, reject) => {
        settleAsyncPipeline = () => resolve({ label: descriptor.label });
        rejectAsyncPipeline = reject;
      });
    },
    popErrorScope: async () => null,
  };
  const asyncPipelineAdapter = { requestDevice: async () => asyncPipelineDevice };
  const asyncPipelineGpu = { requestAdapter: async () => asyncPipelineAdapter };
  const asyncPipelineFrameWindow = {
    location: {
      origin: "https://example.test",
      pathname: "/gpu-startup-app-frame",
      search: `?diagnosticBoot=1&test=${APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID}&documentWidth=4096&documentHeight=4096&documentSize=4096&diagnosticVariant=${APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT}&forceGlazeCommitFallback=1`,
    },
    isSecureContext: true,
    addEventListener() {},
    parent: {
      __gpuStartupDiagnostics: {
        record() { return true; },
        recordBreadcrumb(name, detail, status) {
          asyncPipelineBreadcrumbs.push({ name, detail, status });
          asyncPipelineClock += 100;
          return true;
        },
      },
      postMessage(message, targetOrigin) {
        asyncPipelineMessages.push({ message, targetOrigin });
      },
    },
  };
  asyncPipelineFrameWindow.window = asyncPipelineFrameWindow;
  runInNewContext(frameBootstrapSource, {
    window: asyncPipelineFrameWindow,
    document: { visibilityState: "visible" },
    navigator: { gpu: asyncPipelineGpu },
    performance: { now: () => (asyncPipelineClock += 5) },
    console: { error() {} },
    Reflect,
    Array,
    Object,
    String,
    Number,
    Math,
    Error,
    Promise,
    URLSearchParams,
  });
  assert.equal(
    asyncPipelineFrameWindow.__editorExtensionBootstrap.engineOptions
      .documentPipelineCompilationConcurrency,
    1,
  );
  const observedAsyncPipelineAdapter = await asyncPipelineGpu.requestAdapter();
  const observedAsyncPipelineDevice = await observedAsyncPipelineAdapter.requestDevice({
    requiredFeatures: [],
  });
  assert.equal(observedAsyncPipelineDevice, asyncPipelineDevice);
  const asyncPipelineExtension = asyncPipelineFrameWindow.__editorExtensionBootstrap.create({
    engine: {},
  });
  asyncPipelineExtension.handleEngineStartupProgress({
    phase: "document-pipelines",
    label: "Compiling document pipelines",
    state: "started",
    totalElapsedMs: 10,
    phaseElapsedMs: 0,
    detail: { format: "rgba16float", strategy: "async-bounded" },
  });
  const acceptedAsyncPipelinePromise = asyncPipelineDevice.createRenderPipelineAsync({
    label: "Accepted async pipeline",
    vertex: { entryPoint: "vertexMain" },
    fragment: { entryPoint: "fragmentMain", targets: [{ format: "rgba16float" }] },
  });
  assert.equal(asyncPipelineNativeThis, asyncPipelineDevice);
  assert.equal(
    asyncPipelineMessages.filter(
      ({ message }) => message.type === "document-gpu-call-completed",
    ).length,
    0,
    "An asynchronous pipeline must not complete before its native promise settles.",
  );
  asyncPipelineClock += 250;
  settleAsyncPipeline();
  const acceptedAsyncPipeline = await acceptedAsyncPipelinePromise;
  assert.equal(acceptedAsyncPipeline.label, "Accepted async pipeline");
  const acceptedAsyncCompletion = asyncPipelineMessages.find(
    ({ message }) => message.type === "document-gpu-call-completed"
      && message.detail.label === "Accepted async pipeline",
  );
  assert.ok(acceptedAsyncCompletion);
  assert.equal(acceptedAsyncCompletion.message.detail.method, "createRenderPipelineAsync");
  assert.ok(acceptedAsyncCompletion.message.detail.durationMs >= 250);
  const rejectedAsyncPipelinePromise = asyncPipelineDevice.createRenderPipelineAsync({
    label: "Rejected async pipeline",
    vertex: { entryPoint: "vertexMain" },
    fragment: { entryPoint: "fragmentMain", targets: [{ format: "rgba16float" }] },
  });
  const asyncPipelineError = new Error("Asynchronous pipeline rejected by verification device.");
  asyncPipelineError.reason = "validation";
  asyncPipelineClock += 125;
  rejectAsyncPipeline(asyncPipelineError);
  await assert.rejects(rejectedAsyncPipelinePromise, /Asynchronous pipeline rejected/);
  const rejectedAsyncFailure = asyncPipelineMessages.find(
    ({ message }) => message.type === "document-gpu-call-failed"
      && message.detail.label === "Rejected async pipeline",
  );
  assert.ok(rejectedAsyncFailure);
  assert.equal(rejectedAsyncFailure.message.detail.method, "createRenderPipelineAsync");
  assert.equal(rejectedAsyncFailure.message.detail.pipelineReason, "validation");
  assert.ok(rejectedAsyncFailure.message.detail.durationMs >= 125);
  assert.equal(
    asyncPipelineBreadcrumbs.filter(
      ({ name }) => name === "application-document-gpu-call-started",
    ).length,
    2,
  );
  assert.ok(
    asyncPipelineMessages.some(
      ({ message }) => message.type === "document-pipeline-device-patched"
        && message.detail.renderPipelineMethod === "createRenderPipelineAsync",
    ),
  );

  const contradictoryMessages = [];
  frameWindow.parent.postMessage = (message, targetOrigin) => {
    contradictoryMessages.push({ message, targetOrigin });
  };
  const contradictoryExtension = frameWindow.__editorExtensionBootstrap.create({
    engine: {
      documentWidth: 2048,
      documentHeight: 2048,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      adapter: { features: { has: () => true } },
      device: { features: { has: (feature) => feature === "texture-formats-tier2" } },
      lightGlazeInPlaceCommitSupported: true,
      lightGlazeInPlaceCommitPipeline: {},
      getStats: () => ({ layerFormat: "rgba16float", layerCount: 1 }),
    },
  });
  await contradictoryExtension.afterEngineInitialized();
  const contradictoryEngineReady = contradictoryMessages.find(
    ({ message }) => message.type === "engine-ready",
  );
  assert.ok(contradictoryEngineReady);
  assert.equal(
    contradictoryEngineReady.message.detail.featureIsolation.textureFormatsTier2Enabled,
    true,
  );
  assert.equal(
    contradictoryEngineReady.message.detail.featureIsolation.textureFormatsTier2Advertised,
    true,
  );
  assert.equal(
    contradictoryEngineReady.message.detail.featureIsolation.inPlaceGlazeCommitEnabled,
    true,
  );
  assert.equal(
    contradictoryEngineReady.message.detail.featureIsolation.inPlaceGlazeCommitPipelineCreated,
    true,
  );

  const rootResponse = await worker.fetch(new Request("https://example.test/"), environment);
  assert.equal(rootResponse.status, 200);
  const rootHtml = await rootResponse.text();
  assert.doesNotMatch(rootHtml, /gpu-startup-app-frame-v3/);
  assert.equal(rootHtml, readFileSync(resolve(root, "dist/client/index.html"), "utf8"));
  const flaggedRootResponse = await worker.fetch(
    new Request(
      "https://example.test/?diagnosticBoot=1&diagnosticVariant=rgba16float-no-texture-formats-tier2-v1&forceGlazeCommitFallback=1",
    ),
    environment,
  );
  assert.equal(flaggedRootResponse.status, 200);
  assert.equal(
    await flaggedRootResponse.text(),
    readFileSync(resolve(root, "dist/client/index.html"), "utf8"),
  );
  const storageFlaggedRootResponse = await worker.fetch(
    new Request(`https://example.test/?test=${STORAGE_FORMAT_TEST_ID}`),
    environment,
  );
  assert.equal(storageFlaggedRootResponse.status, 200);
  assert.equal(
    await storageFlaggedRootResponse.text(),
    readFileSync(resolve(root, "dist/client/index.html"), "utf8"),
  );
  const application4096FlaggedRootResponse = await worker.fetch(
    new Request(`https://example.test/?test=${APPLICATION_4096_TEST_ID}`),
    environment,
  );
  assert.equal(application4096FlaggedRootResponse.status, 200);
  assert.equal(
    await application4096FlaggedRootResponse.text(),
    readFileSync(resolve(root, "dist/client/index.html"), "utf8"),
  );
  const unprotectedFrameResponse = await worker.fetch(
    new Request("https://example.test/gpu-startup-app-frame"),
    environment,
  );
  assert.equal(unprotectedFrameResponse.status, 404);
  const staticDiagnosticResponse = await worker.fetch(
    new Request("https://example.test/gpu-startup-diagnostics.html"),
    environment,
  );
  assert.equal(staticDiagnosticResponse.status, 404);

  const clientNow = new Date().toISOString();
  const sequence = Date.now() * 1000 + 1;
  function createUploadPayload({
    payloadRunCode = runCode,
    payloadWriteToken = writeToken,
    payloadSequence = sequence,
    testId = DEFAULT_TEST_ID,
    status = "running",
    latestEvent = "inline-bootstrap-started",
    result = null,
    eventDetail = null,
    moduleLoaded = false,
    probeFinished = false,
  } = {}) {
    const definition = diagnosticDefinition(testId);
    return {
      version: 1,
      build: DIAGNOSTIC_BUILD,
      runCode: payloadRunCode,
      writeToken: payloadWriteToken,
      sequence: payloadSequence,
      createdAt: clientNow,
      updatedAt: clientNow,
      status,
      privacy: "Technical data only.",
      environment: { secureContext: true },
      events: [{
        sequence: payloadSequence,
        at: clientNow,
        name: latestEvent,
        detail: eventDetail,
      }],
      summary: {
        testId: definition.testId,
        diagnosticVariant: definition.diagnosticVariant,
        comparison: definition.comparison,
        result,
        latestEvent,
        moduleLoaded,
        probeFinished,
      },
    };
  };
  const payload = createUploadPayload();
  const upload = (body) => worker.fetch(new Request("https://example.test/api/gpu-startup-diagnostics", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Origin": "https://example.test",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  }), environment);

  const uploadResponse = await upload(payload);
  assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
  const acknowledgement = await uploadResponse.json();
  assert.equal(acknowledgement.acknowledged, true);
  assert.equal(acknowledgement.runCode, runCode);
  assert.equal(acknowledgement.storedStatus, "running");
  assert.equal(acknowledgement.storedSequence, sequence);
  const stored = database.rows.get(runCode);
  assert.equal(stored.status, "running");
  assert.notEqual(stored.write_token_hash, writeToken);
  assert.ok(stored.write_token_hash.length === 64);
  assert.equal(stored.latest_event, "inline-bootstrap-started");
  assert.ok(stored.payload_bytes > 0);
  assert.doesNotMatch(stored.payload_json, new RegExp(writeToken));
  assertDiagnosticSummary(JSON.parse(stored.result_summary), DEFAULT_TEST_ID, null);

  const wrongVariantResponse = await upload({
    ...payload,
    summary: {
      ...payload.summary,
      diagnosticVariant: "unexpected-variant",
    },
  });
  assert.equal(wrongVariantResponse.status, 400);
  const unknownTestResponse = await upload({
    ...payload,
    summary: {
      ...payload.summary,
      testId: "unknown-test-v1",
    },
  });
  assert.equal(unknownTestResponse.status, 400);

  const storageWriteToken = "6".repeat(64);
  const storageBasePayload = createUploadPayload({
    payloadRunCode: storageRunCode,
    payloadWriteToken: storageWriteToken,
    payloadSequence: sequence + 200,
    testId: STORAGE_FORMAT_TEST_ID,
  });
  const invalidStorageComparisons = [
    { ...STORAGE_FORMAT_COMPARISON, targetFormat: "rgba8unorm" },
    { ...STORAGE_FORMAT_COMPARISON, width: 2 },
    { ...STORAGE_FORMAT_COMPARISON, storageAccess: "read-write" },
    { ...STORAGE_FORMAT_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...STORAGE_FORMAT_COMPARISON, textureFormatsTier2Requested: true },
    { ...STORAGE_FORMAT_COMPARISON, deviceReuse: "separate-devices" },
    {
      ...STORAGE_FORMAT_COMPARISON,
      executionOrder: ["rgba16float", "rgba8unorm"],
    },
  ];
  for (const comparison of invalidStorageComparisons) {
    const invalidProtocolResponse = await upload({
      ...storageBasePayload,
      summary: { ...storageBasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }

  const documentPipelineWriteToken = "7".repeat(64);
  const documentPipelineSequence = sequence + 300;
  const documentPipelineBasePayload = createUploadPayload({
    payloadRunCode: documentPipelineRunCode,
    payloadWriteToken: documentPipelineWriteToken,
    payloadSequence: documentPipelineSequence,
    testId: DOCUMENT_PIPELINE_TEST_ID,
    latestEvent: "application-document-gpu-call-started",
    eventDetail: {
      method: "createRenderPipeline",
      renderPipelineIndex: 27,
      label: "Verification document pipeline",
      previousCompletedRenderPipeline: { renderPipelineIndex: 26 },
    },
    moduleLoaded: true,
  });
  const invalidDocumentPipelineComparisons = [
    { ...DOCUMENT_PIPELINE_COMPARISON, targetPhase: "core-pipelines" },
    { ...DOCUMENT_PIPELINE_COMPARISON, layerFormat: "rgba8unorm" },
    { ...DOCUMENT_PIPELINE_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...DOCUMENT_PIPELINE_COMPARISON, textureFormatsTier2Requested: true },
    { ...DOCUMENT_PIPELINE_COMPARISON, applicationFrame: "synthetic" },
    { ...DOCUMENT_PIPELINE_COMPARISON, instrumentation: "descriptor-copy" },
    { ...DOCUMENT_PIPELINE_COMPARISON, expectedSynchronousPipelineLayouts: 16 },
    { ...DOCUMENT_PIPELINE_COMPARISON, expectedSynchronousRenderPipelines: 51 },
    { ...DOCUMENT_PIPELINE_COMPARISON, expectedErrorScopeDrains: 1 },
    { ...DOCUMENT_PIPELINE_COMPARISON, unexpected: true },
  ];
  for (const comparison of invalidDocumentPipelineComparisons) {
    const invalidProtocolResponse = await upload({
      ...documentPipelineBasePayload,
      summary: { ...documentPipelineBasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }
  const documentPipelineRunningResponse = await upload(documentPipelineBasePayload);
  assert.equal(documentPipelineRunningResponse.status, 201);
  assert.equal(database.rows.get(documentPipelineRunCode).latest_event, "application-document-gpu-call-started");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(documentPipelineRunCode).result_summary),
    DOCUMENT_PIPELINE_TEST_ID,
    null,
  );

  const application4096WriteToken = "8".repeat(64);
  const application4096Sequence = sequence + 400;
  const application4096BasePayload = createUploadPayload({
    payloadRunCode: application4096RunCode,
    payloadWriteToken: application4096WriteToken,
    payloadSequence: application4096Sequence,
    testId: APPLICATION_4096_TEST_ID,
    latestEvent: "application-startup-phase",
    eventDetail: {
      phase: "document-layer-texture",
      state: "started",
      detail: { width: 4096, height: 4096, format: "rgba16float" },
    },
    moduleLoaded: true,
  });
  const invalidApplication4096Comparisons = [
    { ...APPLICATION_4096_COMPARISON, kind: "synthetic-startup" },
    { ...APPLICATION_4096_COMPARISON, documentWidth: 2048 },
    { ...APPLICATION_4096_COMPARISON, documentHeight: 2048 },
    { ...APPLICATION_4096_COMPARISON, layerFormat: "rgba8unorm" },
    { ...APPLICATION_4096_COMPARISON, canvasFormat: "rgba8unorm" },
    { ...APPLICATION_4096_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...APPLICATION_4096_COMPARISON, textureFormatsTier2Requested: true },
    { ...APPLICATION_4096_COMPARISON, applicationFrame: "synthetic" },
    { ...APPLICATION_4096_COMPARISON, startupMode: "restored-project" },
    { ...APPLICATION_4096_COMPARISON, deferredObservationMs: 0 },
    { ...APPLICATION_4096_COMPARISON, unexpected: true },
  ];
  for (const comparison of invalidApplication4096Comparisons) {
    const invalidProtocolResponse = await upload({
      ...application4096BasePayload,
      summary: { ...application4096BasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }
  const application4096RunningResponse = await upload(application4096BasePayload);
  assert.equal(application4096RunningResponse.status, 201);
  assert.equal(database.rows.get(application4096RunCode).latest_event, "application-startup-phase");
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096RunCode).result_summary),
    APPLICATION_4096_TEST_ID,
    null,
  );

  const application4096Async2WriteToken = "9".repeat(64);
  const application4096Async2Sequence = sequence + 500;
  const application4096Async2BasePayload = createUploadPayload({
    payloadRunCode: application4096Async2RunCode,
    payloadWriteToken: application4096Async2WriteToken,
    payloadSequence: application4096Async2Sequence,
    testId: APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    latestEvent: "application-startup-phase",
    eventDetail: {
      phase: "document-pipelines",
      state: "started",
      detail: { strategy: "async-bounded", requestedConcurrency: 2 },
    },
    moduleLoaded: true,
  });
  const invalidApplication4096Async2Comparisons = [
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, kind: "application-startup" },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, textureFormatsTier2Requested: true },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, pipelineCompilationMethod: "createRenderPipeline" },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, pipelineCompilationConcurrency: 4 },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, expectedRenderPipelines: 51 },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, asyncFallbackAllowed: true },
    { ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON, unexpected: true },
  ];
  for (const comparison of invalidApplication4096Async2Comparisons) {
    const invalidProtocolResponse = await upload({
      ...application4096Async2BasePayload,
      summary: { ...application4096Async2BasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }
  const application4096Async2RunningResponse = await upload(
    application4096Async2BasePayload,
  );
  assert.equal(application4096Async2RunningResponse.status, 201);
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096Async2RunCode).result_summary),
    APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    null,
  );

  const application4096FirstFrameWriteToken = "a".repeat(64);
  const application4096FirstFrameSequence = sequence + 600;
  const application4096FirstFrameBasePayload = createUploadPayload({
    payloadRunCode: application4096FirstFrameRunCode,
    payloadWriteToken: application4096FirstFrameWriteToken,
    payloadSequence: application4096FirstFrameSequence,
    testId: APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID,
    latestEvent: "application-startup-phase",
    eventDetail: {
      phase: "document-pipelines",
      state: "started",
      detail: { scope: "first-frame-diagnostic" },
    },
    moduleLoaded: true,
  });
  const invalidApplication4096FirstFrameComparisons = [
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, kind: "application-startup" },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, textureFormatsTier2Requested: true },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, pipelineCompilationScope: "complete" },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, expectedRenderPipelines: 2 },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, excludedRenderPipelines: 50 },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, editorInteractionEnabled: true },
    { ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON, unexpected: true },
  ];
  for (const comparison of invalidApplication4096FirstFrameComparisons) {
    const invalidProtocolResponse = await upload({
      ...application4096FirstFrameBasePayload,
      summary: { ...application4096FirstFrameBasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }
  const application4096FirstFrameRunningResponse = await upload(
    application4096FirstFrameBasePayload,
  );
  assert.equal(application4096FirstFrameRunningResponse.status, 201);
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096FirstFrameRunCode).result_summary),
    APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID,
    null,
  );

  const application4096BreakdownWriteToken = "4".repeat(64);
  const application4096BreakdownSequence = sequence + 700;
  const application4096BreakdownBasePayload = createUploadPayload({
    payloadRunCode: application4096BreakdownRunCode,
    payloadWriteToken: application4096BreakdownWriteToken,
    payloadSequence: application4096BreakdownSequence,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    latestEvent: "application-document-gpu-call-started",
    eventDetail: {
      callIndex: 1,
      method: "createPipelineLayout",
      pipelineLayoutIndex: 1,
      label: "Verification pipeline layout",
    },
    moduleLoaded: true,
  });
  const invalidApplication4096BreakdownComparisons = [
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, kind: "application-startup" },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, documentWidth: 2048 },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, textureFormatsTier2Requested: true },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, instrumentation: "descriptor-copy" },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, pipelineCompilationMethod: "createRenderPipelineAsync" },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, pipelineCompilationOrder: "async-bounded" },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, expectedPipelineLayouts: 16 },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, expectedRenderPipelines: 51 },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, expectedErrorScopeDrains: 1 },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, capture: "slowest-only" },
    { ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON, unexpected: true },
  ];
  for (const comparison of invalidApplication4096BreakdownComparisons) {
    const invalidProtocolResponse = await upload({
      ...application4096BreakdownBasePayload,
      summary: { ...application4096BreakdownBasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }
  const application4096BreakdownRunningResponse = await upload(
    application4096BreakdownBasePayload,
  );
  assert.equal(application4096BreakdownRunningResponse.status, 201);
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096BreakdownRunCode).result_summary),
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    null,
  );

  const application4096BreakdownSecondWriteToken = "5".repeat(64);
  const application4096BreakdownSecondSequence = sequence + 800;
  const application4096BreakdownSecondBasePayload = createUploadPayload({
    payloadRunCode: application4096BreakdownSecondRunCode,
    payloadWriteToken: application4096BreakdownSecondWriteToken,
    payloadSequence: application4096BreakdownSecondSequence,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    latestEvent: "application-document-gpu-call-started",
    eventDetail: {
      callIndex: 1,
      method: "createPipelineLayout",
      pipelineLayoutIndex: 1,
      label: "Second platform verification pipeline layout",
    },
    moduleLoaded: true,
  });
  const application4096BreakdownSecondRunningResponse = await upload(
    application4096BreakdownSecondBasePayload,
  );
  assert.equal(application4096BreakdownSecondRunningResponse.status, 201);
  const firstBreakdownRowBeforeCrossWrite = {
    ...database.rows.get(application4096BreakdownRunCode),
  };
  const secondBreakdownRowBeforeCrossWrite = {
    ...database.rows.get(application4096BreakdownSecondRunCode),
  };
  const firstTokenAgainstSecondRunResponse = await upload(createUploadPayload({
    payloadRunCode: application4096BreakdownSecondRunCode,
    payloadWriteToken: application4096BreakdownWriteToken,
    payloadSequence: application4096BreakdownSecondSequence + 1,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
  }));
  assert.equal(firstTokenAgainstSecondRunResponse.status, 403);
  const secondTokenAgainstFirstRunResponse = await upload(createUploadPayload({
    payloadRunCode: application4096BreakdownRunCode,
    payloadWriteToken: application4096BreakdownSecondWriteToken,
    payloadSequence: application4096BreakdownSequence + 1,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
  }));
  assert.equal(secondTokenAgainstFirstRunResponse.status, 403);
  assert.deepEqual(
    database.rows.get(application4096BreakdownRunCode),
    firstBreakdownRowBeforeCrossWrite,
  );
  assert.deepEqual(
    database.rows.get(application4096BreakdownSecondRunCode),
    secondBreakdownRowBeforeCrossWrite,
  );

  const application4096AttributionWriteToken = "d".repeat(64);
  const application4096AttributionSequence = sequence + 900;
  const application4096AttributionBasePayload = createUploadPayload({
    payloadRunCode: application4096AttributionRunCode,
    payloadWriteToken: application4096AttributionWriteToken,
    payloadSequence: application4096AttributionSequence,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    latestEvent: "application-document-gpu-call-started",
    eventDetail: {
      callIndex: 18,
      method: "createRenderPipelineAsync",
      renderPipelineIndex: 1,
      label: "Verification asynchronous pipeline 1",
    },
    moduleLoaded: true,
  });
  const invalidApplication4096AttributionComparisons = [
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, kind: "application-startup" },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, documentWidth: 2048 },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, requiredFeatures: ["texture-formats-tier2"] },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, textureFormatsTier2Requested: true },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, pipelineCompilationMethod: "createRenderPipeline" },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, pipelineCompilationConcurrency: 2 },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, pipelineCompilationOrder: "async-bounded" },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, expectedPipelineLayouts: 16 },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, expectedRenderPipelines: 51 },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, expectedErrorScopeDrains: 1 },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, capture: "all-native-call-durations" },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, timingSemantics: "overlapping" },
    { ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON, unexpected: true },
  ];
  for (const comparison of invalidApplication4096AttributionComparisons) {
    const invalidProtocolResponse = await upload({
      ...application4096AttributionBasePayload,
      summary: { ...application4096AttributionBasePayload.summary, comparison },
    });
    assert.equal(invalidProtocolResponse.status, 400);
  }
  const application4096AttributionRunningResponse = await upload(
    application4096AttributionBasePayload,
  );
  assert.equal(application4096AttributionRunningResponse.status, 201);
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(application4096AttributionRunCode).result_summary),
    APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    null,
  );

  const application4096AttributionWarmWriteToken = "e".repeat(64);
  const application4096AttributionWarmSequence = sequence + 1000;
  const application4096AttributionWarmBasePayload = createUploadPayload({
    payloadRunCode: application4096AttributionWarmRunCode,
    payloadWriteToken: application4096AttributionWarmWriteToken,
    payloadSequence: application4096AttributionWarmSequence,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    latestEvent: "application-document-gpu-call-started",
    eventDetail: {
      callIndex: 18,
      method: "createRenderPipelineAsync",
      renderPipelineIndex: 1,
      label: "Warm verification asynchronous pipeline 1",
    },
    moduleLoaded: true,
  });
  const application4096AttributionWarmRunningResponse = await upload(
    application4096AttributionWarmBasePayload,
  );
  assert.equal(application4096AttributionWarmRunningResponse.status, 201);
  const coldAttributionRowBeforeCrossWrite = {
    ...database.rows.get(application4096AttributionRunCode),
  };
  const warmAttributionRowBeforeCrossWrite = {
    ...database.rows.get(application4096AttributionWarmRunCode),
  };
  assert.equal((await upload(createUploadPayload({
    payloadRunCode: application4096AttributionWarmRunCode,
    payloadWriteToken: application4096AttributionWriteToken,
    payloadSequence: application4096AttributionWarmSequence + 1,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
  }))).status, 403);
  assert.equal((await upload(createUploadPayload({
    payloadRunCode: application4096AttributionRunCode,
    payloadWriteToken: application4096AttributionWarmWriteToken,
    payloadSequence: application4096AttributionSequence + 1,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
  }))).status, 403);
  assert.deepEqual(
    database.rows.get(application4096AttributionRunCode),
    coldAttributionRowBeforeCrossWrite,
  );
  assert.deepEqual(
    database.rows.get(application4096AttributionWarmRunCode),
    warmAttributionRowBeforeCrossWrite,
  );

  const mismatchedPostResponse = await upload(createUploadPayload({
    payloadRunCode: runCode,
    payloadWriteToken: writeToken,
    payloadSequence: sequence + 10,
    testId: STORAGE_FORMAT_TEST_ID,
  }));
  assert.equal(mismatchedPostResponse.status, 409);
  assertDiagnosticSummary(
    JSON.parse(database.rows.get(runCode).result_summary),
    DEFAULT_TEST_ID,
    null,
  );

  const storageResult = storageTargetFailureResult();
  const storageCompletedSequence = sequence + 201;
  const storageCompletedPayload = createUploadPayload({
    payloadRunCode: storageRunCode,
    payloadWriteToken: storageWriteToken,
    payloadSequence: storageCompletedSequence,
    testId: STORAGE_FORMAT_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: storageResult,
    eventDetail: {
      verdict: storageResult.verdict,
      control: { outcome: "passed" },
      target: { outcome: "failed", failedStage: "pipeline" },
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const storageCompletedResponse = await upload(storageCompletedPayload);
  assert.equal(storageCompletedResponse.status, 201);
  const storageAcknowledgement = await storageCompletedResponse.json();
  assert.equal(storageAcknowledgement.acknowledged, true);
  assert.equal(storageAcknowledgement.runCode, storageRunCode);
  assert.equal(storageAcknowledgement.storedStatus, "completed");
  assert.equal(storageAcknowledgement.storedSequence, storageCompletedSequence);
  const storedStorageRun = database.rows.get(storageRunCode);
  assert.equal(storedStorageRun.status, "completed");
  const storedStorageSummary = JSON.parse(storedStorageRun.result_summary);
  assertDiagnosticSummary(storedStorageSummary, STORAGE_FORMAT_TEST_ID, storageResult);
  assert.equal(storedStorageSummary.result.verdict, "rgba16float-specific-failure");
  assert.equal(storedStorageSummary.result.control.outcome, "passed");
  assert.equal(storedStorageSummary.result.target.outcome, "failed");
  assert.notEqual(storedStorageSummary.result.truncated, true);
  assert.deepEqual(storedStorageSummary.result.control.timingsMs, storageResult.control.timingsMs);
  assert.deepEqual(storedStorageSummary.result.target.timingsMs, storageResult.target.timingsMs);

  const documentPipelineResult = {
    verdict: "document-pipelines-passed",
    conclusion: "All real synchronous document render pipelines and final error scopes passed.",
    documentPipelineTrace: {
      instrumentationInstalled: true,
      adapterRequestDevicePatched: true,
      pipelineLayoutPatched: true,
      renderPipelinePatched: true,
      popErrorScopePatched: true,
      requiredFeatures: [],
      textureFormatsTier2Enabled: false,
      phaseState: "completed",
      expectedSynchronousPipelineLayouts: 17,
      expectedSynchronousRenderPipelines: 52,
      expectedErrorScopeDrains: 2,
      startedCallCount: 71,
      completedCallCount: 71,
      pipelineLayoutStartedCount: 17,
      pipelineLayoutCompletedCount: 17,
      renderPipelineStartedCount: 52,
      renderPipelineCompletedCount: 52,
      popErrorScopeStartedCount: 2,
      popErrorScopeCompletedCount: 2,
      failedCallCount: 0,
      scopeErrorCount: 0,
      lastCompletedCall: {
        method: "popErrorScope",
        state: "completed",
      },
      slowestCompletedRenderPipeline: {
        renderPipelineIndex: 31,
        label: "Verification document pipeline",
        durationMs: 287.4,
      },
    },
  };
  const documentPipelineCompletedSequence = documentPipelineSequence + 1;
  const documentPipelineCompletedPayload = createUploadPayload({
    payloadRunCode: documentPipelineRunCode,
    payloadWriteToken: documentPipelineWriteToken,
    payloadSequence: documentPipelineCompletedSequence,
    testId: DOCUMENT_PIPELINE_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: documentPipelineResult,
    eventDetail: {
      verdict: "document-pipelines-passed",
      renderPipelineCompletedCount: 52,
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const documentPipelineCompletedResponse = await upload(documentPipelineCompletedPayload);
  assert.equal(documentPipelineCompletedResponse.status, 201);
  const documentPipelineAcknowledgement = await documentPipelineCompletedResponse.json();
  assert.equal(documentPipelineAcknowledgement.acknowledged, true);
  assert.equal(documentPipelineAcknowledgement.storedStatus, "completed");
  assert.equal(
    documentPipelineAcknowledgement.storedSequence,
    documentPipelineCompletedSequence,
  );
  const storedDocumentPipelineRun = database.rows.get(documentPipelineRunCode);
  assert.equal(storedDocumentPipelineRun.status, "completed");
  const storedDocumentPipelineSummary = JSON.parse(storedDocumentPipelineRun.result_summary);
  assertDiagnosticSummary(
    storedDocumentPipelineSummary,
    DOCUMENT_PIPELINE_TEST_ID,
    documentPipelineResult,
  );
  assert.equal(storedDocumentPipelineSummary.result.verdict, "document-pipelines-passed");
  assert.equal(
    storedDocumentPipelineSummary.result.documentPipelineTrace.renderPipelineCompletedCount,
    52,
  );

  const application4096Result = {
    ...APPLICATION_4096_COMPARISON,
    testId: APPLICATION_4096_TEST_ID,
    diagnosticVariant: APPLICATION_4096_VARIANT,
    verdict: "application-4096-startup-passed",
    conclusion: "The real 4096x4096 application document completed its first GPU frame and remained ready for five seconds.",
    rgba16floatLayerBytes: 134_217_728,
    startupTrace: {
      lastProgress: { phase: "editor-ready", state: "completed" },
      requiredPhaseStates: {
        "document-display-textures": "completed",
        "document-layer-texture": "completed",
        "document-bindings": "completed",
        "first-frame-submit": "completed",
        "first-frame-gpu": "completed",
        "editor-ready": "completed",
      },
      deviceLost: null,
      uncapturedError: null,
      gpuObservation: {
        installed: true,
        requestDeviceObserved: true,
        adapterCount: 1,
        deviceCount: 1,
        requiredFeatures: [],
        textureFormatsTier2Enabled: false,
      },
    },
    applicationBoot: {
      statusText: "WebGPU is ready",
      statusClass: "ok",
      projectSessionReady: true,
      runtimeStatsStarted: true,
      deferredStartupObservationMs: 5000,
      engine: {
        documentWidth: 4096,
        documentHeight: 4096,
        layerFormat: "rgba16float",
        canvasFormat: "rgba16float",
        layerCount: 1,
        layerMemoryMiB: 128,
        storage: {
          bytesPerPixel: 8,
          fullLayerMiB: 128,
          eagerFullRawMiB: 128,
          actualRawMiB: 128,
          tileSizePx: 256,
          tileCount: 256,
        },
      },
    },
  };
  const application4096CompletedSequence = application4096Sequence + 1;
  const application4096CompletedPayload = createUploadPayload({
    payloadRunCode: application4096RunCode,
    payloadWriteToken: application4096WriteToken,
    payloadSequence: application4096CompletedSequence,
    testId: APPLICATION_4096_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: application4096Result,
    eventDetail: {
      verdict: "application-4096-startup-passed",
      firstFrameGpu: "completed",
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const application4096CompletedResponse = await upload(application4096CompletedPayload);
  assert.equal(application4096CompletedResponse.status, 201);
  const application4096Acknowledgement = await application4096CompletedResponse.json();
  assert.equal(application4096Acknowledgement.acknowledged, true);
  assert.equal(application4096Acknowledgement.storedStatus, "completed");
  assert.equal(
    application4096Acknowledgement.storedSequence,
    application4096CompletedSequence,
  );
  const storedApplication4096Run = database.rows.get(application4096RunCode);
  assert.equal(storedApplication4096Run.status, "completed");
  const storedApplication4096Summary = JSON.parse(storedApplication4096Run.result_summary);
  assertDiagnosticSummary(
    storedApplication4096Summary,
    APPLICATION_4096_TEST_ID,
    application4096Result,
  );
  assert.equal(storedApplication4096Summary.result.verdict, "application-4096-startup-passed");
  assert.equal(storedApplication4096Summary.result.rgba16floatLayerBytes, 134_217_728);
  assert.equal(
    storedApplication4096Summary.result.startupTrace.requiredPhaseStates["first-frame-gpu"],
    "completed",
  );
  assert.notEqual(storedApplication4096Summary.result.truncated, true);

  const application4096Async2Stats = {
    strategy: "async-bounded",
    requestedConcurrency: 2,
    nativeAsyncSupported: true,
    expectedRenderPipelineCount: 52,
    scheduledCount: 52,
    startedCount: 52,
    completedCount: 52,
    failedCount: 0,
    settledCount: 52,
    activeCount: 0,
    peakActiveCount: 2,
    fallbackCount: 0,
  };
  const application4096Async2Result = {
    ...APPLICATION_4096_PIPELINES_ASYNC2_COMPARISON,
    testId: APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    diagnosticVariant: APPLICATION_4096_PIPELINES_ASYNC2_VARIANT,
    verdict: "application-4096-pipelines-async2-passed",
    conclusion: "The bounded asynchronous render-pipeline path completed.",
    startupTrace: {
      documentPipelinesPhase: {
        phase: "document-pipelines",
        state: "completed",
        totalElapsedMs: 12_000,
        phaseElapsedMs: 8_000,
        detail: application4096Async2Stats,
      },
      editorReadyPhase: {
        phase: "editor-ready",
        state: "completed",
        totalElapsedMs: 13_000,
        phaseElapsedMs: 20,
        detail: null,
      },
    },
    asyncPipelineCompilation: {
      passed: true,
      issues: [],
      stats: application4096Async2Stats,
    },
  };
  const application4096Async2CompletedSequence = application4096Async2Sequence + 1;
  const application4096Async2CompletedPayload = createUploadPayload({
    payloadRunCode: application4096Async2RunCode,
    payloadWriteToken: application4096Async2WriteToken,
    payloadSequence: application4096Async2CompletedSequence,
    testId: APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: application4096Async2Result,
    eventDetail: {
      verdict: "application-4096-pipelines-async2-passed",
      peakActiveCount: 2,
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const application4096Async2CompletedResponse = await upload(
    application4096Async2CompletedPayload,
  );
  assert.equal(application4096Async2CompletedResponse.status, 201);
  const storedApplication4096Async2Summary = JSON.parse(
    database.rows.get(application4096Async2RunCode).result_summary,
  );
  assertDiagnosticSummary(
    storedApplication4096Async2Summary,
    APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID,
    application4096Async2Result,
  );
  assert.equal(
    storedApplication4096Async2Summary.result.startupTrace
      .documentPipelinesPhase.detail.peakActiveCount,
    2,
  );

  const application4096FirstFrameStats = {
    format: "rgba16float",
    scope: "first-frame-diagnostic",
    strategy: "sync-sequential",
    requestedConcurrency: 1,
    nativeAsyncSupported: true,
    expectedRenderPipelineCount: 1,
    logicalRenderPipelineCount: 52,
    excludedRenderPipelineCount: 51,
    compiledPipelineKeys: ["paint-mip-downsample"],
    scheduledCount: 1,
    startedCount: 1,
    completedCount: 1,
    failedCount: 0,
    settledCount: 1,
    activeCount: 0,
    peakActiveCount: 1,
    fallbackCount: 0,
  };
  const application4096FirstFrameResult = {
    ...APPLICATION_4096_PIPELINES_FIRST_FRAME_COMPARISON,
    testId: APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID,
    diagnosticVariant: APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT,
    verdict: "application-4096-pipelines-first-frame-passed",
    conclusion: "The empty 4096x4096 document reached its first frame with one document pipeline.",
    startupTrace: {
      documentPipelinesPhase: {
        phase: "document-pipelines",
        state: "completed",
        totalElapsedMs: 800,
        phaseElapsedMs: 500,
        detail: application4096FirstFrameStats,
      },
      editorReadyPhase: {
        phase: "editor-ready",
        state: "completed",
        totalElapsedMs: 2_000,
        phaseElapsedMs: 20,
        detail: null,
      },
    },
    firstFramePipelineCompilation: {
      passed: true,
      issues: [],
      stats: application4096FirstFrameStats,
    },
  };
  const application4096FirstFrameCompletedPayload = createUploadPayload({
    payloadRunCode: application4096FirstFrameRunCode,
    payloadWriteToken: application4096FirstFrameWriteToken,
    payloadSequence: application4096FirstFrameSequence + 1,
    testId: APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: application4096FirstFrameResult,
    eventDetail: {
      verdict: "application-4096-pipelines-first-frame-passed",
      completedCount: 1,
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const application4096FirstFrameCompletedResponse = await upload(
    application4096FirstFrameCompletedPayload,
  );
  assert.equal(application4096FirstFrameCompletedResponse.status, 201);
  const storedApplication4096FirstFrameSummary = JSON.parse(
    database.rows.get(application4096FirstFrameRunCode).result_summary,
  );
  assertDiagnosticSummary(
    storedApplication4096FirstFrameSummary,
    APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID,
    application4096FirstFrameResult,
  );
  assert.equal(
    storedApplication4096FirstFrameSummary.result.startupTrace
      .documentPipelinesPhase.detail.completedCount,
    1,
  );

  const breakdownLayoutCalls = Array.from({ length: 17 }, (_, index) => ({
    index: index + 1,
    label: `Pipeline layout ${index + 1}`,
    durationMs: 0.1,
  }));
  const breakdownRenderCalls = Array.from({ length: 52 }, (_, index) => ({
    index: index + 1,
    label: `Render pipeline ${index + 1}`,
    durationMs: index === 40 ? 28_000 : 10,
  }));
  const breakdownGroupDefinitions = [
    ["erase-stamps", "Erase stamps", 1, 6],
    ["direct-color-stamps", "Direct color stamps", 7, 18],
    ["precision-color-accumulation", "Precision color accumulation", 19, 30],
    ["coverage-accumulation", "Coverage accumulation", 31, 36],
    ["live-accumulation-resolve", "Live accumulation resolve", 37, 40],
    ["display-and-live-mips", "Display and live mips", 41, 46],
    ["document-composition", "Document composition", 47, 52],
  ];
  const breakdownErrorScopeCalls = [
    { index: 1, label: "Validation error scope drain", durationMs: 1 },
    { index: 2, label: "Out-of-memory error scope drain", durationMs: 1 },
  ];
  const breakdownNativeCallTotalMs = breakdownLayoutCalls.reduce(
    (sum, call) => sum + call.durationMs,
    0,
  ) + breakdownRenderCalls.reduce((sum, call) => sum + call.durationMs, 0)
    + breakdownErrorScopeCalls.reduce((sum, call) => sum + call.durationMs, 0);
  const application4096BreakdownResult = {
    ...APPLICATION_4096_PIPELINE_BREAKDOWN_COMPARISON,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    diagnosticVariant: APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT,
    verdict: "application-4096-pipeline-breakdown-passed",
    conclusion: "All native document-pipeline calls were timed individually.",
    pipelineBreakdown: {
      expectedMeasuredCallCount: 71,
      measuredCallCount: 71,
      phaseElapsedMs: 29_000,
      nativeCallTotalMs: breakdownNativeCallTotalMs,
      preCallDiagnosticTotalMs: 100,
      phaseMinusPreCallDiagnosticMs: 28_900,
      remainingPhaseWorkAndReportingMs: 28_900 - breakdownNativeCallTotalMs,
      pipelineLayoutTotalMs: 1.7,
      renderPipelineTotalMs: 28_510,
      errorScopeDrainTotalMs: 2,
      slowestRenderPipelineIndex: breakdownRenderCalls[40].index,
      slowestRenderPipelineDurationMs: breakdownRenderCalls[40].durationMs,
      pipelineLayouts: breakdownLayoutCalls,
      renderPipelineGroups: breakdownGroupDefinitions.map(([key, label, first, last]) => {
        const calls = breakdownRenderCalls.filter(
          (call) => call.index >= first && call.index <= last,
        );
        return {
          key,
          label,
          totalDurationMs: calls.reduce((sum, call) => sum + call.durationMs, 0),
          calls,
        };
      }),
      failedCallCount: 0,
      errorScopeDrains: breakdownErrorScopeCalls,
    },
    startupTrace: {
      documentPipelinesPhase: {
        phase: "document-pipelines",
        state: "completed",
        phaseElapsedMs: 29_000,
      },
      editorReadyPhase: { phase: "editor-ready", state: "completed", phaseElapsedMs: 20 },
    },
    applicationBoot: {
      statusText: "WebGPU is ready",
      projectSessionReady: true,
      runtimeStatsStarted: true,
    },
  };
  const application4096BreakdownCompletedPayload = createUploadPayload({
    payloadRunCode: application4096BreakdownRunCode,
    payloadWriteToken: application4096BreakdownWriteToken,
    payloadSequence: application4096BreakdownSequence + 1,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: application4096BreakdownResult,
    eventDetail: {
      verdict: "application-4096-pipeline-breakdown-passed",
      measuredCallCount: 71,
      slowestRenderPipelineIndex: 41,
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const application4096BreakdownCompletedResponse = await upload(
    application4096BreakdownCompletedPayload,
  );
  assert.equal(application4096BreakdownCompletedResponse.status, 201);
  const storedApplication4096BreakdownSummary = JSON.parse(
    database.rows.get(application4096BreakdownRunCode).result_summary,
  );
  assertDiagnosticSummary(
    storedApplication4096BreakdownSummary,
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    application4096BreakdownResult,
  );
  assert.equal(
    storedApplication4096BreakdownSummary.result.pipelineBreakdown.measuredCallCount,
    71,
  );
  assert.equal(
    storedApplication4096BreakdownSummary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls).length,
    52,
  );
  assert.equal(
    storedApplication4096BreakdownSummary.result.pipelineBreakdown.slowestRenderPipelineIndex,
    41,
  );
  assert.notEqual(storedApplication4096BreakdownSummary.result.truncated, true);

  const application4096BreakdownSecondCompletedPayload = createUploadPayload({
    payloadRunCode: application4096BreakdownSecondRunCode,
    payloadWriteToken: application4096BreakdownSecondWriteToken,
    payloadSequence: application4096BreakdownSecondSequence + 1,
    testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: application4096BreakdownResult,
    eventDetail: {
      verdict: "application-4096-pipeline-breakdown-passed",
      measuredCallCount: 71,
      slowestRenderPipelineIndex: 41,
    },
    moduleLoaded: true,
    probeFinished: true,
  });
  const application4096BreakdownSecondCompletedResponse = await upload(
    application4096BreakdownSecondCompletedPayload,
  );
  assert.equal(application4096BreakdownSecondCompletedResponse.status, 201);
  const storedApplication4096BreakdownSecondSummary = JSON.parse(
    database.rows.get(application4096BreakdownSecondRunCode).result_summary,
  );
  assertDiagnosticSummary(
    storedApplication4096BreakdownSecondSummary,
    APPLICATION_4096_PIPELINE_BREAKDOWN_TEST_ID,
    application4096BreakdownResult,
  );
  assert.equal(database.rows.get(application4096BreakdownRunCode).sequence, application4096BreakdownSequence + 1);
  assert.equal(
    database.rows.get(application4096BreakdownSecondRunCode).sequence,
    application4096BreakdownSecondSequence + 1,
  );

  const roundTiming = (value) => Math.round(value * 1000) / 1000;
  const attributionLayoutCalls = Array.from({ length: 17 }, (_, index) => ({
    index: index + 1,
    label: `Attribution layout ${index + 1}`,
    durationMs: roundTiming(index + 1.111),
  }));
  const attributionRenderCalls = Array.from({ length: 52 }, (_, index) => ({
    index: index + 1,
    label: `Attribution render pipeline ${index + 1}`,
    durationMs: roundTiming((index + 1) * 10 + 0.123),
  }));
  const attributionDrainCalls = [
    { index: 1, label: "Validation error scope drain", durationMs: 1.234 },
    { index: 2, label: "Out-of-memory error scope drain", durationMs: 2.345 },
  ];
  const attributionGroups = breakdownGroupDefinitions.map(([key, label, first, last]) => {
    const calls = attributionRenderCalls.filter(
      (call) => call.index >= first && call.index <= last,
    );
    return {
      key,
      label,
      totalDurationMs: roundTiming(calls.reduce((sum, call) => sum + call.durationMs, 0)),
      calls,
    };
  });
  const attributionLayoutTotalMs = roundTiming(
    attributionLayoutCalls.reduce((sum, call) => sum + call.durationMs, 0),
  );
  const attributionPipelineTotalMs = roundTiming(
    attributionRenderCalls.reduce((sum, call) => sum + call.durationMs, 0),
  );
  const attributionDrainTotalMs = roundTiming(
    attributionDrainCalls.reduce((sum, call) => sum + call.durationMs, 0),
  );
  const attributionNativeTotalMs = roundTiming(
    attributionLayoutTotalMs + attributionPipelineTotalMs + attributionDrainTotalMs,
  );
  const attributionPreCallMs = 14.2;
  const attributionResidualMs = 3.21;
  const attributionPhaseMs = roundTiming(
    attributionNativeTotalMs + attributionPreCallMs + attributionResidualMs,
  );
  const attributionAsyncStats = {
    format: "rgba16float",
    strategy: "async-bounded",
    requestedConcurrency: 1,
    nativeAsyncSupported: true,
    expectedRenderPipelineCount: 52,
    scheduledCount: 52,
    startedCount: 52,
    completedCount: 52,
    failedCount: 0,
    settledCount: 52,
    activeCount: 0,
    peakActiveCount: 1,
    fallbackCount: 0,
  };
  const application4096AttributionResult = {
    ...APPLICATION_4096_PIPELINE_ATTRIBUTION_COMPARISON,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    diagnosticVariant: APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT,
    verdict: "application-4096-pipeline-attribution-passed",
    conclusion: "All asynchronous render pipelines were timed in startup order.",
    pipelineBreakdown: {
      expectedMeasuredCallCount: 71,
      measuredCallCount: 71,
      phaseElapsedMs: attributionPhaseMs,
      nativeCallTotalMs: attributionNativeTotalMs,
      preCallDiagnosticTotalMs: attributionPreCallMs,
      phaseMinusPreCallDiagnosticMs: roundTiming(
        attributionPhaseMs - attributionPreCallMs,
      ),
      remainingPhaseWorkAndReportingMs: attributionResidualMs,
      pipelineLayoutTotalMs: attributionLayoutTotalMs,
      renderPipelineTotalMs: attributionPipelineTotalMs,
      renderPipelineMethod: "createRenderPipelineAsync",
      renderPipelineTimingsOverlap: false,
      firstRenderPipelineMayIncludePriorQueuedGpuWork: true,
      errorScopeDrainTotalMs: attributionDrainTotalMs,
      slowestRenderPipelineIndex: 52,
      slowestRenderPipelineDurationMs: attributionRenderCalls[51].durationMs,
      pipelineLayouts: attributionLayoutCalls,
      renderPipelineGroups: attributionGroups,
      failedCallCount: 0,
      errorScopeDrains: attributionDrainCalls,
    },
    asyncPipelineCompilation: {
      passed: true,
      issues: [],
      stats: attributionAsyncStats,
    },
    startupTrace: {
      documentPipelinesPhase: {
        phase: "document-pipelines",
        state: "completed",
        phaseElapsedMs: attributionPhaseMs,
        detail: attributionAsyncStats,
      },
      editorReadyPhase: { phase: "editor-ready", state: "completed", phaseElapsedMs: 20 },
    },
    applicationBoot: {
      statusText: "WebGPU is ready",
      projectSessionReady: true,
      runtimeStatsStarted: true,
    },
  };
  const application4096AttributionCompletedResponse = await upload(createUploadPayload({
    payloadRunCode: application4096AttributionRunCode,
    payloadWriteToken: application4096AttributionWriteToken,
    payloadSequence: application4096AttributionSequence + 1,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: application4096AttributionResult,
    eventDetail: {
      verdict: "application-4096-pipeline-attribution-passed",
      measuredCallCount: 71,
      slowestRenderPipelineIndex: 52,
    },
    moduleLoaded: true,
    probeFinished: true,
  }));
  assert.equal(application4096AttributionCompletedResponse.status, 201);
  const storedAttributionRow = database.rows.get(application4096AttributionRunCode);
  const compactAttributionSummary = JSON.parse(storedAttributionRow.result_summary);
  assert.equal(compactAttributionSummary.testId, APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID);
  assert.equal(compactAttributionSummary.diagnosticVariant, APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT);
  assert.equal(compactAttributionSummary.schema, "pipeline-attribution-ms-v1");
  assert.equal(compactAttributionSummary.pipelineIndexBase, 1);
  assert.equal(compactAttributionSummary.pipelineMethod, "createRenderPipelineAsync");
  assert.equal(compactAttributionSummary.firstMayIncludePriorQueuedWork, true);
  assert.deepEqual(compactAttributionSummary.layoutMs, attributionLayoutCalls.map((call) => call.durationMs));
  assert.deepEqual(compactAttributionSummary.pipelineMs, attributionRenderCalls.map((call) => call.durationMs));
  assert.deepEqual(compactAttributionSummary.drainMs, attributionDrainCalls.map((call) => call.durationMs));
  assert.equal(Object.keys(compactAttributionSummary.groupMs).length, 7);
  for (const [key, _label, first, last] of breakdownGroupDefinitions) {
    assert.deepEqual(compactAttributionSummary.groupMs[key], [
      first,
      last,
      roundTiming(
        attributionRenderCalls
          .slice(first - 1, last)
          .reduce((sum, call) => sum + call.durationMs, 0),
      ),
    ]);
  }
  assert.equal(compactAttributionSummary.phaseMs, attributionPhaseMs);
  assert.equal(compactAttributionSummary.nativeMs, attributionNativeTotalMs);
  assert.equal(compactAttributionSummary.residualMs, attributionResidualMs);
  assert.equal(compactAttributionSummary.slowestIndex, 52);
  assert.equal(compactAttributionSummary.slowestMs, attributionRenderCalls[51].durationMs);
  assert.ok(Buffer.byteLength(storedAttributionRow.result_summary, "utf8") <= 1536);
  const storedFullAttributionPayload = JSON.parse(storedAttributionRow.payload_json);
  assertDiagnosticSummary(
    storedFullAttributionPayload.summary,
    APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    application4096AttributionResult,
  );
  assert.equal(
    storedFullAttributionPayload.summary.result.pipelineBreakdown.renderPipelineGroups
      .flatMap((group) => group.calls).length,
    52,
  );
  assert.equal(
    storedFullAttributionPayload.summary.result.pipelineBreakdown.renderPipelineGroups[0]
      .calls[0].label,
    "Attribution render pipeline 1",
  );
  const attributionMismatchedPageResponse = await worker.fetch(
    new Request(
      `https://example.test/gpu-startup-lab?run=${application4096AttributionRunCode}&test=${STORAGE_FORMAT_TEST_ID}`,
    ),
    environment,
  );
  assert.equal(attributionMismatchedPageResponse.status, 409);
  assert.equal((await upload(createUploadPayload({
    payloadRunCode: application4096AttributionRunCode,
    payloadWriteToken: application4096AttributionWriteToken,
    payloadSequence: application4096AttributionSequence + 2,
    testId: STORAGE_FORMAT_TEST_ID,
  }))).status, 409);

  const incompleteAttributionResult = {
    ...application4096AttributionResult,
    verdict: "application-4096-pipeline-attribution-inconclusive",
    pipelineBreakdown: {
      ...application4096AttributionResult.pipelineBreakdown,
      measuredCallCount: 65,
      renderPipelineGroups: attributionGroups.slice(0, 6),
    },
  };
  const incompleteAttributionResponse = await upload(createUploadPayload({
    payloadRunCode: application4096AttributionWarmRunCode,
    payloadWriteToken: application4096AttributionWarmWriteToken,
    payloadSequence: application4096AttributionWarmSequence + 1,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: incompleteAttributionResult,
    moduleLoaded: true,
    probeFinished: true,
  }));
  assert.equal(incompleteAttributionResponse.status, 201);
  const incompleteStoredSummary = JSON.parse(
    database.rows.get(application4096AttributionWarmRunCode).result_summary,
  );
  assert.equal(incompleteStoredSummary.schema, undefined);
  assertDiagnosticSummary(
    incompleteStoredSummary,
    APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    incompleteAttributionResult,
  );
  const largeAttributionTimingMs = 8_450.123;
  const largeAttributionResult = structuredClone(application4096AttributionResult);
  const largeAttributionBreakdown = largeAttributionResult.pipelineBreakdown;
  for (const call of largeAttributionBreakdown.pipelineLayouts) {
    call.durationMs = largeAttributionTimingMs;
  }
  for (const call of largeAttributionBreakdown.renderPipelineGroups.flatMap((group) => group.calls)) {
    call.durationMs = largeAttributionTimingMs;
  }
  for (const call of largeAttributionBreakdown.errorScopeDrains) {
    call.durationMs = largeAttributionTimingMs;
  }
  largeAttributionBreakdown.phaseElapsedMs = 600_000;
  largeAttributionBreakdown.nativeCallTotalMs = roundTiming(71 * largeAttributionTimingMs);
  largeAttributionBreakdown.preCallDiagnosticTotalMs = 10;
  largeAttributionBreakdown.remainingPhaseWorkAndReportingMs = roundTiming(
    600_000 - 10 - largeAttributionBreakdown.nativeCallTotalMs,
  );
  largeAttributionBreakdown.pipelineLayoutTotalMs = roundTiming(
    17 * largeAttributionTimingMs,
  );
  largeAttributionBreakdown.renderPipelineTotalMs = roundTiming(
    52 * largeAttributionTimingMs,
  );
  largeAttributionBreakdown.errorScopeDrainTotalMs = roundTiming(
    2 * largeAttributionTimingMs,
  );
  largeAttributionBreakdown.slowestRenderPipelineDurationMs = largeAttributionTimingMs;
  const warmAttributionCompletedResponse = await upload(createUploadPayload({
    payloadRunCode: application4096AttributionWarmRunCode,
    payloadWriteToken: application4096AttributionWarmWriteToken,
    payloadSequence: application4096AttributionWarmSequence + 2,
    testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST_ID,
    status: "completed",
    latestEvent: "diagnostic-completed",
    result: largeAttributionResult,
    moduleLoaded: true,
    probeFinished: true,
  }));
  assert.equal(warmAttributionCompletedResponse.status, 201);
  const warmCompactAttributionSummary = JSON.parse(
    database.rows.get(application4096AttributionWarmRunCode).result_summary,
  );
  assert.equal(warmCompactAttributionSummary.schema, "pipeline-attribution-ms-v1");
  assert.equal(warmCompactAttributionSummary.compacted, "essential-timings");
  assert.deepEqual(
    warmCompactAttributionSummary.pipelineMs,
    Array.from({ length: 52 }, () => largeAttributionTimingMs),
  );
  assert.equal(Object.keys(warmCompactAttributionSummary.groupMs).length, 7);
  assert.ok(
    Buffer.byteLength(
      database.rows.get(application4096AttributionWarmRunCode).result_summary,
      "utf8",
    ) <= 1536,
  );
  assert.notEqual(
    database.rows.get(application4096AttributionRunCode).write_token_hash,
    database.rows.get(application4096AttributionWarmRunCode).write_token_hash,
  );

  const staleResponse = await upload({
    ...payload,
    sequence: sequence - 1,
    events: [{ ...payload.events[0], sequence: sequence - 1 }],
  });
  assert.equal(staleResponse.status, 200);
  const staleAcknowledgement = await staleResponse.json();
  assert.equal(staleAcknowledgement.acknowledged, true);
  assert.equal(staleAcknowledgement.storedSequence, sequence);

  const invalidTokenResponse = await upload({ ...payload, writeToken: "c".repeat(64) });
  assert.equal(invalidTokenResponse.status, 403);

  const raceRunCode = `diag-${"b".repeat(32)}`;
  await worker.fetch(
    new Request(`https://example.test/gpu-startup-lab?run=${raceRunCode}`),
    environment,
  );
  const competingToken = "e".repeat(64);
  const competingDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(competingToken),
  );
  const competingTokenHash = [...new Uint8Array(competingDigest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  database.claimAfterNextEmptyTokenRead = competingTokenHash;
  const raceSequence = sequence + 100;
  const racedWriteResponse = await upload({
    ...payload,
    runCode: raceRunCode,
    sequence: raceSequence,
    events: [{
      sequence: raceSequence,
      at: clientNow,
      name: "inline-bootstrap-started",
      detail: null,
    }],
  });
  assert.equal(
    racedWriteResponse.status,
    403,
    "A competing capability claim between read and upsert must be rejected atomically.",
  );
  assert.equal(database.rows.get(raceRunCode).write_token_hash, competingTokenHash);

  const oversizedEnvironmentResponse = await upload({
    ...payload,
    environment: { unicode: "界".repeat(4_000) },
  });
  assert.equal(oversizedEnvironmentResponse.status, 400);
  const oversizedRequestResponse = await upload({
    ...payload,
    padding: "x".repeat(70 * 1024),
  });
  assert.equal(oversizedRequestResponse.status, 413);

  const completedSequence = sequence + 1;
  const completedPayload = {
    ...payload,
    sequence: completedSequence,
    status: "completed",
    events: [{
      sequence: completedSequence,
      at: clientNow,
      name: "diagnostic-completed",
      detail: { documentWidth: 2048, documentHeight: 2048 },
    }],
    summary: {
      ...payload.summary,
      latestEvent: "diagnostic-completed",
      moduleLoaded: true,
      probeFinished: true,
    },
  };
  const completedResponse = await upload(completedPayload);
  assert.equal(completedResponse.status, 201);
  const completedAcknowledgement = await completedResponse.json();
  assert.equal(completedAcknowledgement.storedStatus, "completed");
  assert.equal(completedAcknowledgement.storedSequence, completedSequence);
  assert.equal(database.rows.get(runCode)?.latest_event, "diagnostic-completed");

  const lateRunningSequence = completedSequence + 1;
  const lateRunningResponse = await upload({
    ...payload,
    sequence: lateRunningSequence,
    events: [{
      sequence: lateRunningSequence,
      at: clientNow,
      name: "late-running-checkpoint",
      detail: null,
    }],
    summary: {
      ...payload.summary,
      latestEvent: "late-running-checkpoint",
    },
  });
  assert.equal(lateRunningResponse.status, 201);
  const lateRunningAcknowledgement = await lateRunningResponse.json();
  assert.equal(lateRunningAcknowledgement.storedStatus, "completed");
  assert.equal(lateRunningAcknowledgement.storedSequence, completedSequence);
  assert.equal(database.rows.get(runCode)?.status, "completed");

  const readResponse = await worker.fetch(
    new Request("https://example.test/api/gpu-startup-diagnostics"),
    environment,
  );
  assert.equal(readResponse.status, 405, "The diagnostic API must not expose a public read route.");
}

console.log("GPU startup diagnostic laboratory verified.");
