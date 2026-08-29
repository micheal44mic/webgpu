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
const engineSource = read("src/brush-engine.ts");
const featurePolicySource = read("src/gpu-startup-feature-policy.ts");

const DIAGNOSTIC_BUILD = "gpu-diagnostics-storage-format-ab-v7";
const DEFAULT_TEST_ID = "startup-no-tier2-v1";
const DEFAULT_VARIANT = "rgba16float-no-texture-formats-tier2-v1";
const STORAGE_FORMAT_TEST_ID = "storage-format-ab-v1";
const STORAGE_FORMAT_VARIANT =
  "storage-format-ab-rgba8unorm-control-rgba16float-target-write-only-1x1-no-tier2-v1";
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
assert.match(html, /MAX_SNAPSHOT_BYTES = 48 \* 1024/);
assert.match(html, /MAX_DIAGNOSTIC_RESULT_BYTES = 12 \* 1024/);
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
assert.match(html, /requestedTestId \|\| "startup-no-tier2-v1"/);
assert.match(html, /DIAGNOSTIC_TEST_ID === "storage-format-ab-v1"/);
assert.match(html, /diagnosticVariant: DIAGNOSTIC_VARIANT/);
assert.match(html, /testId: DIAGNOSTIC_TEST_ID/);
assert.match(html, /result: diagnosticResult/);
assert.match(html, /textureFormatsTier2Enabled: false/);

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
assert.match(moduleSource, /if \(diagnosticTest && diagnosticTest !== STORAGE_FORMAT_AB_TEST\)[\s\S]*Unsupported GPU diagnostic test/);
assert.match(moduleSource, /if \(storageFormatAbEnabled\) \{\s*await runStorageFormatAbDiagnostic\(\);\s*return;/);
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
assert.match(moduleSource, /target\.searchParams\.set\("diagnosticVariant", APPLICATION_BOOT_VARIANT\)/);
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

assert.match(engineSource, /suppressTextureFormatsTier2ForGpuStartup/);
assert.match(engineSource, /const requestInPlaceGlazeCommit = !suppressTier2ForDiagnostic/);
assert.match(engineSource, /&& !forceGlazeCommitFallback/);

assert.match(workerBuilder, /GPU_STARTUP_DIAGNOSTIC_HTML/);
assert.match(workerBuilder, /GPU_STARTUP_DIAGNOSTIC_PAGE_PATH = "\/gpu-startup-lab"/);
assert.match(workerBuilder, /GPU_STARTUP_APP_FRAME_PATH = "\/gpu-startup-app-frame"/);
assert.match(workerBuilder, /restorePersistedBrushOnStartup: true/);
assert.match(workerBuilder, /startupProgressEnabled: true/);
assert.match(workerBuilder, /handleEngineStartupProgress/);
assert.match(workerBuilder, /textureFormatsTier2Enabled: engine\.device\.features\.has\("texture-formats-tier2"\)/);
assert.match(workerBuilder, /textureFormatsTier2Advertised: engine\.adapter\?\.features\?\.has\("texture-formats-tier2"\) === true/);
assert.match(workerBuilder, /inPlaceGlazeCommitEnabled: engine\.lightGlazeInPlaceCommitSupported === true/);
assert.match(workerBuilder, /inPlaceGlazeCommitPipelineCreated: engine\.lightGlazeInPlaceCommitPipeline != null/);
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
    sendBeacon() { return true; },
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
    sharedSessionStorage,
    sharedLocalStorage,
    copiedText: () => copiedText,
    selectionCount: () => selectionCount,
    legacyCopyCommands,
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
  assert.equal(sharedSessionStorage.size, 2);
  assert.equal(sharedLocalStorage.size, 2);
  assert.ok([...sharedSessionStorage.keys()].some((key) => key.endsWith(`:${DEFAULT_TEST_ID}`)));
  assert.ok([...sharedSessionStorage.keys()].some((key) => key.endsWith(`:${STORAGE_FORMAT_TEST_ID}`)));
  assert.ok([...sharedLocalStorage.keys()].some((key) => key.endsWith(`:${DEFAULT_TEST_ID}`)));
  assert.ok([...sharedLocalStorage.keys()].some((key) => key.endsWith(`:${STORAGE_FORMAT_TEST_ID}`)));

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
  assert.equal(defaultReload.browser.__gpuStartupDiagnostics.snapshot().writeToken, defaultToken);
  assert.equal(storageReload.browser.__gpuStartupDiagnostics.snapshot().writeToken, storageToken);
  const defaultBackup = JSON.parse(defaultReload.browser.__gpuStartupDiagnostics.manualBackup());
  const storageBackup = JSON.parse(storageReload.browser.__gpuStartupDiagnostics.manualBackup());
  assert.equal(defaultBackup.testId, DEFAULT_TEST_ID);
  assert.equal(storageBackup.testId, STORAGE_FORMAT_TEST_ID);
  assert.ok(JSON.stringify(defaultBackup.recoveredAttempts).includes("default-only-checkpoint"));
  assert.ok(!JSON.stringify(defaultBackup.recoveredAttempts).includes("storage-only-checkpoint"));
  assert.ok(JSON.stringify(storageBackup.recoveredAttempts).includes("storage-only-checkpoint"));
  assert.ok(!JSON.stringify(storageBackup.recoveredAttempts).includes("default-only-checkpoint"));
  assertDiagnosticSummary(defaultBackup.currentAttempt.summary, DEFAULT_TEST_ID, null);
  assertDiagnosticSummary(storageBackup.currentAttempt.summary, STORAGE_FORMAT_TEST_ID, null);
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
  assert.equal(uploadResponse.status, 201);
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

  const raceRunCode = `diag-${"d".repeat(32)}`;
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
