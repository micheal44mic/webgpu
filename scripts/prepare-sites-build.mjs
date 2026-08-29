import { cp, copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";

const distDirectory = new URL("../dist/", import.meta.url);
const clientDirectory = new URL("client/", distDirectory);
const serverDirectory = new URL("server/", distDirectory);
const hostingDirectory = new URL(".openai/", distDirectory);
const workerFile = new URL("index.js", serverDirectory);
const gpuStartupDiagnosticHtmlFile = new URL(
  "../dist-gpu-diagnostics/gpu-startup-diagnostics.html",
  import.meta.url,
);
const gpuStartupDiagnosticAssetsDirectory = new URL(
  "../dist-gpu-diagnostics/assets/",
  import.meta.url,
);

async function copyAssetsCollisionSafe(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = new URL(entry.name + (entry.isDirectory() ? "/" : ""), sourceDirectory);
    const destination = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      destinationDirectory,
    );
    if (entry.isDirectory()) {
      await copyAssetsCollisionSafe(source, destination);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported diagnostic asset entry: ${entry.name}`);
    }
    const sourceBytes = await readFile(source);
    let destinationBytes;
    try {
      destinationBytes = await readFile(destination);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await copyFile(source, destination);
      continue;
    }
    if (!sourceBytes.equals(destinationBytes)) {
      throw new Error(`Diagnostic asset collision has different bytes: ${entry.name}`);
    }
  }
}

await mkdir(clientDirectory, { recursive: true });

for (const entry of await readdir(distDirectory, { withFileTypes: true })) {
  if (entry.name === "client" || entry.name === "server") {
    continue;
  }

  await rename(
    new URL(entry.name, distDirectory),
    new URL(entry.name, clientDirectory),
  );
}

await copyAssetsCollisionSafe(
  gpuStartupDiagnosticAssetsDirectory,
  new URL("assets/", clientDirectory),
);

await mkdir(serverDirectory, { recursive: true });
await mkdir(hostingDirectory, { recursive: true });
await copyFile(
  new URL("../.openai/hosting.json", import.meta.url),
  new URL("hosting.json", hostingDirectory),
);
await cp(
  new URL("../.openai/drizzle/", import.meta.url),
  new URL("drizzle/", hostingDirectory),
  { recursive: true, force: true },
);
const indexHtmlFile = new URL("index.html", clientDirectory);
const indexHtml = (await readFile(indexHtmlFile, "utf8")).replace(/\r\n?/g, "\n");
const gpuStartupDiagnosticHtml = (
  await readFile(gpuStartupDiagnosticHtmlFile, "utf8")
).replace(/\r\n?/g, "\n");
const gpuStartupAppFrameBootstrap = String.raw`<script>
(function () {
  "use strict";

  var CHANNEL = "gpu-startup-app-frame-v3";
  var MAX_STRING_LENGTH = 1200;
  var DOCUMENT_PIPELINE_TEST_ID = "document-pipeline-bisect-v1";
  var APPLICATION_4096_TEST_ID = "application-4096-startup-v1";
  var APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID = "application-4096-pipelines-async2-v1";
  var APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID =
    "application-4096-pipelines-first-frame-v1";
  var DOCUMENT_PIPELINE_PHASE = "document-pipelines";
  var EXPECTED_DOCUMENT_PIPELINE_LAYOUTS = 17;
  var EXPECTED_DOCUMENT_RENDER_PIPELINES = 52;
  var EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS = 2;
  var diagnosticTestId = new URLSearchParams(window.location.search).get("test") || "";
  var documentPipelineInstrumentationEnabled = diagnosticTestId === DOCUMENT_PIPELINE_TEST_ID;
  var application4096PipelinesAsync2Enabled =
    diagnosticTestId === APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID;
  var application4096PipelinesFirstFrameEnabled =
    diagnosticTestId === APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID;
  var application4096StartupEnabled =
    diagnosticTestId === APPLICATION_4096_TEST_ID
    || application4096PipelinesAsync2Enabled
    || application4096PipelinesFirstFrameEnabled;
  if (application4096PipelinesFirstFrameEnabled) {
    if (document.documentElement && document.documentElement.style) {
      document.documentElement.style.pointerEvents = "none";
    }
    window.addEventListener("keydown", function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    if (typeof document.addEventListener === "function") {
      document.addEventListener("DOMContentLoaded", function () {
        if (document.body) document.body.inert = true;
      }, { once: true });
    }
  }
  var activeStartupPhase = null;
  var activeStartupPhaseState = null;
  var documentGpuCallIndex = 0;
  var documentPipelineLayoutIndex = 0;
  var documentRenderPipelineIndex = 0;
  var documentErrorScopeDrainIndex = 0;
  var completedDocumentGpuCalls = 0;
  var completedDocumentPipelineLayouts = 0;
  var completedDocumentRenderPipelines = 0;
  var completedDocumentErrorScopeDrains = 0;
  var failedDocumentGpuCalls = 0;
  var scopeErrorCount = 0;
  var lastStartedDocumentGpuCall = null;
  var currentDocumentGpuCall = null;
  var lastCompletedRenderPipeline = null;
  var slowestCompletedRenderPipeline = null;
  var patchedAdapters = [];
  var patchedDevices = [];
  var observedApplicationAdapters = [];
  var observedApplicationDevices = [];
  var originalConsoleError = console.error;

  window.__gpuStartupDiagnosticTeardown = false;
  window.addEventListener("pagehide", function () {
    window.__gpuStartupDiagnosticTeardown = true;
  }, { once: true });

  function clippedString(value, maximumLength) {
    var text;
    try {
      text = String(value);
    } catch (_error) {
      text = "[unprintable]";
    }
    text = text.replace(/\b(?:https?:\/\/|blob:https?:\/\/)[^\s<>"']+/gi, function () {
      return "[url-redacted]";
    });
    return text.length <= maximumLength
      ? text
      : text.slice(0, maximumLength) + "...[truncated]";
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function errorDetail(error) {
    if (error instanceof Error) {
      return {
        name: clippedString(error.name || "Error", 120),
        message: clippedString(error.message || String(error), MAX_STRING_LENGTH),
        stack: typeof error.stack === "string"
          ? clippedString(error.stack, 2400)
          : null,
      };
    }
    if (error && typeof error === "object") {
      var objectMessage = null;
      var objectName = null;
      var objectStack = null;
      try {
        objectMessage = typeof error.message === "string"
          ? clippedString(error.message, MAX_STRING_LENGTH)
          : null;
      } catch (_error) {}
      try {
        objectName = typeof error.name === "string"
          ? clippedString(error.name, 120)
          : null;
      } catch (_error) {}
      try {
        objectStack = typeof error.stack === "string"
          ? clippedString(error.stack, 2400)
          : null;
      } catch (_error) {}
      if (objectMessage || objectName || objectStack) {
        return {
          name: objectName,
          message: objectMessage || clippedString(error, MAX_STRING_LENGTH),
          stack: objectStack,
        };
      }
    }
    return {
      name: null,
      message: clippedString(error, MAX_STRING_LENGTH),
      stack: null,
    };
  }

  function safeValue(value, depth) {
    if (value === null || value === undefined) return value === null ? null : "undefined";
    if (typeof value === "string") return clippedString(value, MAX_STRING_LENGTH);
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "boolean") return value;
    if (value instanceof Error) return errorDetail(value);
    if (depth >= 2) return clippedString(value, MAX_STRING_LENGTH);
    if (Array.isArray(value)) {
      return value.slice(0, 8).map(function (entry) {
        return safeValue(entry, depth + 1);
      });
    }
    if (typeof value === "object") {
      var result = {};
      var keys;
      try {
        keys = Object.keys(value).slice(0, 24);
      } catch (_error) {
        return "[uninspectable object]";
      }
      keys.forEach(function (key) {
        try {
          result[clippedString(key, 120)] = safeValue(value[key], depth + 1);
        } catch (_error) {
          result[clippedString(key, 120)] = "[unavailable]";
        }
      });
      return result;
    }
    return clippedString(value, MAX_STRING_LENGTH);
  }

  function emit(type, detail) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({
        channel: CHANNEL,
        type: type,
        detail: safeValue(detail, 0),
      }, window.location.origin);
    } catch (_error) {
      // Reporting must never alter the editor bootstrap path.
    }
  }

  function parentDiagnosticBridge() {
    if (window.parent === window) return null;
    try {
      var candidate = window.parent.__gpuStartupDiagnostics;
      return candidate && typeof candidate.record === "function" ? candidate : null;
    } catch (_error) {
      return null;
    }
  }

  function durableRecord(name, detail, status) {
    var bridge = parentDiagnosticBridge();
    if (!bridge) return false;
    try {
      if (typeof bridge.recordBreadcrumb === "function") {
        bridge.recordBreadcrumb(name, detail, status || "running");
      } else {
        bridge.record(name, detail, status || "running", "beacon");
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  function documentPipelinePhaseActive() {
    return documentPipelineInstrumentationEnabled
      && activeStartupPhase === DOCUMENT_PIPELINE_PHASE
      && activeStartupPhaseState === "started";
  }

  function documentPipelineSummary() {
    return {
      enabled: documentPipelineInstrumentationEnabled,
      targetPhase: DOCUMENT_PIPELINE_PHASE,
      expectedSynchronousPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedSynchronousRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      activePhase: activeStartupPhase,
      phaseState: activeStartupPhaseState,
      adapterPatchCount: patchedAdapters.length,
      devicePatchCount: patchedDevices.length,
      startedCallCount: documentGpuCallIndex,
      completedCallCount: completedDocumentGpuCalls,
      failedCallCount: failedDocumentGpuCalls,
      scopeErrorCount: scopeErrorCount,
      pipelineLayoutStartedCount: documentPipelineLayoutIndex,
      pipelineLayoutCompletedCount: completedDocumentPipelineLayouts,
      renderPipelineStartedCount: documentRenderPipelineIndex,
      renderPipelineCompletedCount: completedDocumentRenderPipelines,
      popErrorScopeStartedCount: documentErrorScopeDrainIndex,
      popErrorScopeCompletedCount: completedDocumentErrorScopeDrains,
      lastStartedCall: lastStartedDocumentGpuCall,
      lastCompletedRenderPipeline: lastCompletedRenderPipeline,
      slowestCompletedRenderPipeline: slowestCompletedRenderPipeline,
    };
  }

  function replaceMethod(target, name, replacement) {
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: replacement,
      });
      if (target[name] === replacement) return true;
    } catch (_error) {
      // Fall through to assignment for extensible compatibility objects.
    }
    try {
      target[name] = replacement;
      if (target[name] === replacement) return true;
    } catch (_error) {
      // Fall through to the WebIDL prototype when the instance is not extensible.
    }
    try {
      var prototype = Object.getPrototypeOf(target);
      if (!prototype) return false;
      Object.defineProperty(prototype, name, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: replacement,
      });
      return target[name] === replacement;
    } catch (_error) {
      return false;
    }
  }

  function renderPipelineDescriptorSummary(descriptor) {
    var summary = {
      label: null,
      vertexEntryPoint: null,
      fragmentEntryPoint: null,
      targetFormats: [],
      topology: null,
    };
    if (!descriptor || typeof descriptor !== "object") return summary;
    try {
      summary.label = typeof descriptor.label === "string"
        ? clippedString(descriptor.label, 300)
        : null;
    } catch (_error) {}
    try {
      summary.vertexEntryPoint = typeof descriptor.vertex?.entryPoint === "string"
        ? clippedString(descriptor.vertex.entryPoint, 120)
        : null;
    } catch (_error) {}
    try {
      summary.fragmentEntryPoint = typeof descriptor.fragment?.entryPoint === "string"
        ? clippedString(descriptor.fragment.entryPoint, 120)
        : null;
    } catch (_error) {}
    try {
      summary.targetFormats = Array.from(descriptor.fragment?.targets || [])
        .slice(0, 4)
        .map(function (target) {
          return target && typeof target.format === "string"
            ? clippedString(target.format, 80)
            : null;
        });
    } catch (_error) {}
    try {
      summary.topology = typeof descriptor.primitive?.topology === "string"
        ? clippedString(descriptor.primitive.topology, 80)
        : null;
    } catch (_error) {}
    return summary;
  }

  function beginDocumentGpuCall(method, descriptor) {
    documentGpuCallIndex += 1;
    var isPipelineLayout = method === "createPipelineLayout";
    var isRenderPipeline = method === "createRenderPipeline";
    var isErrorScopeDrain = method === "popErrorScope";
    if (isPipelineLayout) documentPipelineLayoutIndex += 1;
    if (isRenderPipeline) documentRenderPipelineIndex += 1;
    if (isErrorScopeDrain) documentErrorScopeDrainIndex += 1;
    var descriptorSummary = isRenderPipeline
      ? renderPipelineDescriptorSummary(descriptor)
      : {
          label: isErrorScopeDrain
            ? (documentErrorScopeDrainIndex === 1
                ? "Validation error scope drain"
                : documentErrorScopeDrainIndex === 2
                  ? "Out-of-memory error scope drain"
                  : "GPU error scope drain")
            : (typeof descriptor?.label === "string"
                ? clippedString(descriptor.label, 300)
                : method),
          vertexEntryPoint: null,
          fragmentEntryPoint: null,
          targetFormats: [],
          topology: null,
        };
    var detail = {
      callIndex: documentGpuCallIndex,
      method: method,
      pipelineLayoutIndex: isPipelineLayout ? documentPipelineLayoutIndex : null,
      renderPipelineIndex: isRenderPipeline ? documentRenderPipelineIndex : null,
      errorScopeDrainIndex: isErrorScopeDrain ? documentErrorScopeDrainIndex : null,
      expectedPipelineLayoutCount: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedRenderPipelineCount: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedErrorScopeDrainCount: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      label: descriptorSummary.label,
      vertexEntryPoint: descriptorSummary.vertexEntryPoint,
      fragmentEntryPoint: descriptorSummary.fragmentEntryPoint,
      targetFormats: descriptorSummary.targetFormats,
      topology: descriptorSummary.topology,
      previousCompletedRenderPipeline: lastCompletedRenderPipeline,
      checkpointStartedAtMs: finiteNumber(performance.now()),
      nativeStartedAtMs: null,
      durableCheckpoint: false,
    };
    detail.durableCheckpoint = durableRecord(
      "application-document-gpu-call-started",
      detail,
      "running",
    );
    detail.nativeStartedAtMs = finiteNumber(performance.now());
    lastStartedDocumentGpuCall = detail;
    currentDocumentGpuCall = detail;
    emit("document-gpu-call-started", detail);
    return detail;
  }

  function completeDocumentGpuCall(call, result) {
    completedDocumentGpuCalls += 1;
    if (call.method === "createPipelineLayout") completedDocumentPipelineLayouts += 1;
    if (call.method === "createRenderPipeline") completedDocumentRenderPipelines += 1;
    if (call.method === "popErrorScope") completedDocumentErrorScopeDrains += 1;
    var durationMs = Math.max(0, performance.now() - Number(call.nativeStartedAtMs || 0));
    var detail = {
      ...call,
      durationMs: finiteNumber(durationMs),
      completedAtMs: finiteNumber(performance.now()),
      durableCheckpoint: false,
    };
    if (call.method === "createRenderPipeline") {
      lastCompletedRenderPipeline = {
        renderPipelineIndex: call.renderPipelineIndex,
        label: call.label,
        targetFormats: call.targetFormats,
        durationMs: finiteNumber(durationMs),
      };
      if (
        !slowestCompletedRenderPipeline
        || durationMs > Number(slowestCompletedRenderPipeline.durationMs || 0)
      ) {
        slowestCompletedRenderPipeline = lastCompletedRenderPipeline;
      }
      if (call.renderPipelineIndex === EXPECTED_DOCUMENT_RENDER_PIPELINES) {
        detail.durableCheckpoint = durableRecord(
          "application-document-pipeline-sequence-completed",
          {
            ...documentPipelineSummary(),
            finalCall: detail,
          },
          "running",
        );
      }
    }
    if (call.method === "popErrorScope" && result) {
      scopeErrorCount += 1;
      var scopeErrorDetail = {
        ...detail,
        scopeError: errorDetail(result),
        durableCheckpoint: false,
      };
      scopeErrorDetail.durableCheckpoint = durableRecord(
        "application-document-gpu-scope-error",
        scopeErrorDetail,
        "failed",
      );
      emit("document-gpu-scope-error", scopeErrorDetail);
    }
    if (currentDocumentGpuCall === call) currentDocumentGpuCall = null;
    emit("document-gpu-call-completed", detail);
  }

  function failDocumentGpuCall(call, error) {
    failedDocumentGpuCalls += 1;
    var detail = {
      ...call,
      durationMs: Math.max(0, performance.now() - Number(call.nativeStartedAtMs || 0)),
      error: errorDetail(error),
      pipelineReason: error && typeof error.reason === "string"
        ? clippedString(error.reason, 120)
        : null,
      durableCheckpoint: false,
    };
    detail.durableCheckpoint = durableRecord(
      "application-document-gpu-call-failed",
      detail,
      "failed",
    );
    if (currentDocumentGpuCall === call) currentDocumentGpuCall = null;
    emit("document-gpu-call-failed", detail);
  }

  function wrapDocumentGpuMethod(device, method, asynchronous) {
    var original;
    try {
      original = device[method];
    } catch (_error) {
      return false;
    }
    if (typeof original !== "function") return false;
    var wrapped = function () {
      if (!documentPipelinePhaseActive()) {
        return Reflect.apply(original, device, arguments);
      }
      var call = beginDocumentGpuCall(method, arguments[0]);
      var result;
      try {
        result = Reflect.apply(original, device, arguments);
      } catch (error) {
        failDocumentGpuCall(call, error);
        throw error;
      }
      if (!asynchronous) {
        completeDocumentGpuCall(call, result);
        return result;
      }
      return Promise.resolve(result).then(function (value) {
        completeDocumentGpuCall(call, value);
        return value;
      }, function (error) {
        failDocumentGpuCall(call, error);
        throw error;
      });
    };
    return replaceMethod(device, method, wrapped);
  }

  function patchDocumentGpuDevice(device, requestDescriptor) {
    if (!device || patchedDevices.indexOf(device) >= 0) return device;
    patchedDevices.push(device);
    var pipelineLayoutPatched = wrapDocumentGpuMethod(device, "createPipelineLayout", false);
    var renderPipelinePatched = wrapDocumentGpuMethod(device, "createRenderPipeline", false);
    var popErrorScopePatched = wrapDocumentGpuMethod(device, "popErrorScope", true);
    var requiredFeatures = [];
    try {
      requiredFeatures = Array.from(requestDescriptor?.requiredFeatures || []).map(function (feature) {
        return clippedString(feature, 120);
      });
    } catch (_error) {}
    var detail = {
      devicePatchCount: patchedDevices.length,
      pipelineLayoutPatched: pipelineLayoutPatched,
      renderPipelinePatched: renderPipelinePatched,
      popErrorScopePatched: popErrorScopePatched,
      requiredFeatures: requiredFeatures,
      textureFormatsTier2Enabled: device.features?.has("texture-formats-tier2") === true,
    };
    emit("document-pipeline-device-patched", detail);
    if (!pipelineLayoutPatched || !renderPipelinePatched || !popErrorScopePatched) {
      durableRecord("application-document-pipeline-instrumentation-failed", detail, "failed");
    }
    try {
      device.addEventListener("uncapturederror", function (event) {
        if (window.__gpuStartupDiagnosticTeardown === true) return;
        var error = event?.error || event;
        var duringTargetPhase = documentPipelinePhaseActive();
        var errorEventDetail = {
          source: "uncapturederror",
          error: errorDetail(error),
          activePhase: activeStartupPhase,
          phaseState: activeStartupPhaseState,
          duringTargetPhase: duringTargetPhase,
          currentCall: currentDocumentGpuCall,
          lastCompletedRenderPipeline: lastCompletedRenderPipeline,
          durableCheckpoint: false,
        };
        if (duringTargetPhase) {
          errorEventDetail.durableCheckpoint = durableRecord(
            "application-document-gpu-uncaptured-error",
            errorEventDetail,
            "failed",
          );
        }
        emit("document-gpu-uncaptured-error", errorEventDetail);
      });
    } catch (_error) {}
    try {
      Promise.resolve(device.lost).then(function (info) {
        if (window.__gpuStartupDiagnosticTeardown === true) return;
        var duringTargetPhase = documentPipelinePhaseActive();
        var lostDetail = {
          reason: typeof info?.reason === "string" ? clippedString(info.reason, 120) : null,
          message: typeof info?.message === "string" ? clippedString(info.message, 600) : null,
          activePhase: activeStartupPhase,
          phaseState: activeStartupPhaseState,
          duringTargetPhase: duringTargetPhase,
          currentCall: currentDocumentGpuCall,
          lastCompletedRenderPipeline: lastCompletedRenderPipeline,
          durableCheckpoint: false,
        };
        if (duringTargetPhase) {
          lostDetail.durableCheckpoint = durableRecord(
            "application-document-gpu-device-lost",
            lostDetail,
            "failed",
          );
        }
        emit("document-gpu-device-lost", lostDetail);
      });
    } catch (_error) {}
    return device;
  }

  function patchDocumentGpuAdapter(adapter) {
    if (!adapter || patchedAdapters.indexOf(adapter) >= 0) return adapter;
    patchedAdapters.push(adapter);
    var originalRequestDevice;
    try {
      originalRequestDevice = adapter.requestDevice;
    } catch (_error) {
      originalRequestDevice = null;
    }
    if (typeof originalRequestDevice !== "function") {
      emit("document-pipeline-adapter-patched", { requestDevicePatched: false });
      return adapter;
    }
    var wrappedRequestDevice = function (descriptor) {
      var request;
      try {
        request = Reflect.apply(originalRequestDevice, adapter, arguments);
      } catch (error) {
        emit("document-pipeline-device-request-failed", errorDetail(error));
        throw error;
      }
      return Promise.resolve(request).then(function (device) {
        return patchDocumentGpuDevice(device, descriptor || {});
      }, function (error) {
        emit("document-pipeline-device-request-failed", errorDetail(error));
        throw error;
      });
    };
    var patched = replaceMethod(adapter, "requestDevice", wrappedRequestDevice);
    emit("document-pipeline-adapter-patched", {
      requestDevicePatched: patched,
      adapterPatchCount: patchedAdapters.length,
    });
    if (!patched) {
      durableRecord("application-document-pipeline-instrumentation-failed", {
        stage: "adapter-request-device",
      }, "failed");
    }
    return adapter;
  }

  function installDocumentPipelineInstrumentation() {
    if (!documentPipelineInstrumentationEnabled) return;
    var gpu = navigator.gpu;
    var originalRequestAdapter = gpu?.requestAdapter;
    if (!gpu || typeof originalRequestAdapter !== "function") {
      var unavailableDetail = { installed: false, stage: "gpu-request-adapter" };
      durableRecord("application-document-pipeline-instrumentation-failed", unavailableDetail, "failed");
      emit("document-pipeline-instrumentation", unavailableDetail);
      return;
    }
    var wrappedRequestAdapter = function () {
      var request;
      try {
        request = Reflect.apply(originalRequestAdapter, gpu, arguments);
      } catch (error) {
        emit("document-pipeline-adapter-request-failed", errorDetail(error));
        throw error;
      }
      return Promise.resolve(request).then(function (adapter) {
        return patchDocumentGpuAdapter(adapter);
      }, function (error) {
        emit("document-pipeline-adapter-request-failed", errorDetail(error));
        throw error;
      });
    };
    var installed = replaceMethod(gpu, "requestAdapter", wrappedRequestAdapter);
    var detail = {
      installed: installed,
      testId: diagnosticTestId,
      targetPhase: DOCUMENT_PIPELINE_PHASE,
      expectedSynchronousRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedSynchronousPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      instrumentedMethods: ["createPipelineLayout", "createRenderPipeline", "popErrorScope"],
    };
    emit("document-pipeline-instrumentation", detail);
    if (!installed) {
      durableRecord("application-document-pipeline-instrumentation-failed", detail, "failed");
    }
  }

  function observeApplicationGpuDevice(device, requestDescriptor) {
    if (!device || observedApplicationDevices.indexOf(device) >= 0) return device;
    observedApplicationDevices.push(device);
    var requiredFeatures = [];
    try {
      requiredFeatures = Array.from(requestDescriptor?.requiredFeatures || []).map(function (feature) {
        return clippedString(feature, 120);
      });
    } catch (_error) {}
    emit("application-gpu-device-observed", {
      deviceCount: observedApplicationDevices.length,
      requiredFeatures: requiredFeatures,
      textureFormatsTier2Enabled: device.features?.has("texture-formats-tier2") === true,
    });
    try {
      device.addEventListener("uncapturederror", function (event) {
        if (window.__gpuStartupDiagnosticTeardown === true) return;
        var detail = {
          source: "uncapturederror",
          error: errorDetail(event?.error || event),
          activePhase: activeStartupPhase,
          phaseState: activeStartupPhaseState,
          durableCheckpoint: false,
        };
        detail.durableCheckpoint = durableRecord(
          "application-gpu-uncaptured-error",
          detail,
          "failed",
        );
        emit("application-gpu-uncaptured-error", detail);
      });
    } catch (_error) {}
    try {
      Promise.resolve(device.lost).then(function (info) {
        if (window.__gpuStartupDiagnosticTeardown === true) return;
        var detail = {
          reason: typeof info?.reason === "string" ? clippedString(info.reason, 120) : null,
          message: typeof info?.message === "string" ? clippedString(info.message, 600) : null,
          activePhase: activeStartupPhase,
          phaseState: activeStartupPhaseState,
          durableCheckpoint: false,
        };
        detail.durableCheckpoint = durableRecord(
          "application-gpu-device-lost",
          detail,
          "failed",
        );
        emit("application-gpu-device-lost", detail);
      });
    } catch (_error) {}
    return device;
  }

  function observeApplicationGpuAdapter(adapter) {
    if (!adapter || observedApplicationAdapters.indexOf(adapter) >= 0) return adapter;
    observedApplicationAdapters.push(adapter);
    var originalRequestDevice;
    try {
      originalRequestDevice = adapter.requestDevice;
    } catch (_error) {
      originalRequestDevice = null;
    }
    if (typeof originalRequestDevice !== "function") return adapter;
    var wrappedRequestDevice = function (descriptor) {
      var request;
      try {
        request = Reflect.apply(originalRequestDevice, adapter, arguments);
      } catch (error) {
        durableRecord("application-gpu-device-request-failed", errorDetail(error), "failed");
        throw error;
      }
      return Promise.resolve(request).then(function (device) {
        return observeApplicationGpuDevice(device, descriptor || {});
      }, function (error) {
        durableRecord("application-gpu-device-request-failed", errorDetail(error), "failed");
        throw error;
      });
    };
    var installed = replaceMethod(adapter, "requestDevice", wrappedRequestDevice);
    emit("application-gpu-adapter-observed", {
      requestDeviceObserved: installed,
      adapterCount: observedApplicationAdapters.length,
    });
    return adapter;
  }

  function installApplicationGpuObservation() {
    if (!application4096StartupEnabled) return;
    var gpu = navigator.gpu;
    var originalRequestAdapter = gpu?.requestAdapter;
    if (!gpu || typeof originalRequestAdapter !== "function") return;
    var wrappedRequestAdapter = function () {
      var request;
      try {
        request = Reflect.apply(originalRequestAdapter, gpu, arguments);
      } catch (error) {
        durableRecord("application-gpu-adapter-request-attempt-failed", errorDetail(error), "running");
        throw error;
      }
      return Promise.resolve(request).then(function (adapter) {
        return observeApplicationGpuAdapter(adapter);
      }, function (error) {
        durableRecord("application-gpu-adapter-request-attempt-failed", errorDetail(error), "running");
        throw error;
      });
    };
    var installed = replaceMethod(gpu, "requestAdapter", wrappedRequestAdapter);
    emit("application-gpu-observation", {
      installed: installed,
      testId: diagnosticTestId,
      nativePipelineMethodsWrapped: false,
    });
  }

  function updateApplicationStartupPhase(progress) {
    if (!progress || typeof progress !== "object") return false;
    activeStartupPhase = typeof progress.phase === "string" ? progress.phase : null;
    activeStartupPhaseState = typeof progress.state === "string" ? progress.state : null;
    var durableCheckpoint = false;
    if (application4096StartupEnabled) {
      durableCheckpoint = durableRecord(
        "application-startup-phase",
        progress,
        activeStartupPhaseState === "failed" ? "failed" : "running",
      );
    }
    if (
      documentPipelineInstrumentationEnabled
      && activeStartupPhase === DOCUMENT_PIPELINE_PHASE
      && (activeStartupPhaseState === "completed" || activeStartupPhaseState === "failed")
    ) {
      var summary = documentPipelineSummary();
      var status = activeStartupPhaseState === "failed" ? "failed" : "running";
      durableRecord("application-document-pipeline-phase-" + activeStartupPhaseState, summary, status);
      emit("document-pipeline-phase", summary);
    }
    return durableCheckpoint;
  }

  window.addEventListener("error", function (event) {
    emit("window-error", {
      message: clippedString(event.message || "Window error", MAX_STRING_LENGTH),
      filename: clippedString(event.filename || "", 600),
      line: finiteNumber(event.lineno),
      column: finiteNumber(event.colno),
      error: event.error ? errorDetail(event.error) : null,
    });
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    emit("unhandled-rejection", {
      reason: errorDetail(event.reason),
    });
  }, true);

  console.error = function () {
    var argumentsList = Array.prototype.slice.call(arguments, 0, 8);
    try {
      Reflect.apply(originalConsoleError, console, arguments);
    } finally {
      emit("console-error", {
        arguments: argumentsList.map(function (entry) {
          return safeValue(entry, 0);
        }),
      });
    }
  };

  installDocumentPipelineInstrumentation();
  installApplicationGpuObservation();

  window.__editorExtensionBootstrap = {
    engineOptions: application4096PipelinesFirstFrameEnabled
      ? { documentPipelineCompilationScope: "first-frame-diagnostic" }
      : application4096PipelinesAsync2Enabled
        ? { documentPipelineCompilationConcurrency: 2 }
        : {},
    restorePersistedBrushOnStartup: true,
    startupProgressEnabled: true,
    create: function (host) {
      emit("extension-created", {});
      return {
        isBusy: function () {
          return false;
        },
        syncControls: function () {},
        handleEngineStartupProgress: function (progress) {
          var durableCheckpoint = updateApplicationStartupPhase(progress);
          emit("startup-progress", {
            ...progress,
            durableCheckpoint: durableCheckpoint,
          });
        },
        afterEngineInitialized: async function () {
          var engine = host.engine;
          var stats = engine.getStats();
          var storage = stats.layerStorageStudy || {};
          var gpuMemory = stats.gpuMemory || {};
          emit("engine-ready", {
            documentWidth: finiteNumber(engine.documentWidth),
            documentHeight: finiteNumber(engine.documentHeight),
            diagnosticVariant: clippedString(
              new URLSearchParams(window.location.search).get("diagnosticVariant") || "",
              120,
            ),
            featureIsolation: {
              textureFormatsTier2Advertised: engine.adapter?.features?.has("texture-formats-tier2") === true,
              textureFormatsTier2Enabled: engine.device.features.has("texture-formats-tier2"),
              inPlaceGlazeCommitEnabled: engine.lightGlazeInPlaceCommitSupported === true,
              inPlaceGlazeCommitPipelineCreated: engine.lightGlazeInPlaceCommitPipeline != null,
            },
            layerFormat: typeof stats.layerFormat === "string"
              ? stats.layerFormat
              : clippedString(engine.layerFormat, 80),
            canvasFormat: clippedString(engine.canvasFormat, 80),
            layerCount: finiteNumber(stats.layerCount),
            layerMemoryMiB: finiteNumber(stats.layerMemoryMiB),
            storage: {
              bytesPerPixel: finiteNumber(storage.bytesPerPixel),
              fullLayerMiB: finiteNumber(storage.fullLayerMiB),
              eagerFullRawMiB: finiteNumber(storage.eagerFullRawMiB),
              actualRawMiB: finiteNumber(storage.actualRawMiB),
              tileSizePx: finiteNumber(storage.tileSizePx),
              tileCount: finiteNumber(storage.tileCount),
            },
            gpu: {
              label: clippedString(stats.gpuLabel || "", 300),
              countedTotalMiB: finiteNumber(gpuMemory.countedTotalMiB),
              registeredCurrentMiB: finiteNumber(gpuMemory.registeredCurrentMiB),
            },
            documentPipelineProbe: documentPipelineInstrumentationEnabled
              ? documentPipelineSummary()
              : null,
          });
        },
        handleEngineInitializationError: function (error) {
          emit("engine-error", errorDetail(error));
        },
      };
    },
  };

  emit("bootstrap-ready", {
    secureContext: window.isSecureContext,
    visibilityState: document.visibilityState,
    restorePersistedBrushOnStartup: true,
  });
}());
</script>`;
const gpuStartupAppFrameHtml = indexHtml.replace(
  /(?=<script\s+type="module"(?=\s|>))/,
  `${gpuStartupAppFrameBootstrap}\n`,
);
if (gpuStartupAppFrameHtml === indexHtml) {
  throw new Error("The diagnostic app-frame bootstrap insertion point is unavailable.");
}
await writeFile(indexHtmlFile, indexHtml);
await writeFile(
  workerFile,
  `const INDEX_HTML = ${JSON.stringify(indexHtml)};
const GPU_STARTUP_DIAGNOSTIC_HTML = ${JSON.stringify(gpuStartupDiagnosticHtml)};
const GPU_STARTUP_APP_FRAME_HTML = ${JSON.stringify(gpuStartupAppFrameHtml)};
const HUMAN_STROKE_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS human_stroke_benchmark (id TEXT PRIMARY KEY NOT NULL CHECK (id = 'canonical'), payload_json TEXT NOT NULL, captured_at TEXT NOT NULL)";
const HUMAN_STROKE_ID = "canonical";
const HUMAN_STROKE_PRESET_REVISION = 4;
const BENCHMARK_RUNS_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS benchmark_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const BENCHMARK_RUNS_INDEX_SQL = "CREATE INDEX IF NOT EXISTS benchmark_runs_created_at_idx ON benchmark_runs (created_at DESC)";
const IPHONE_MEMORY_LIMIT_BUILD = "iphone-rgba16f-gpu-plus-compressed-cpu-peaks-v3";
const IPHONE_MEMORY_LIMIT_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL)";
const IPHONE_MEMORY_LIMIT_INDEX_SQL = "CREATE INDEX IF NOT EXISTS iphone_memory_limit_runs_updated_at_idx ON iphone_memory_limit_runs (updated_at DESC)";
const IPHONE_MEMORY_LIMIT_STATUSES = new Set(["running", "completed", "interrupted", "error"]);
const LAYER_COMPRESSION_BUILD = "lossless-gzip-256-tile-1mib-streamed-measurement-v1";
const LAYER_COMPRESSION_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS layer_compression_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const LAYER_COMPRESSION_INDEX_SQL = "CREATE INDEX IF NOT EXISTS layer_compression_runs_created_at_idx ON layer_compression_runs (created_at DESC)";
const VECTOR_ZOOM_C_STRATEGY = "ten-semantic-text-dual-gpu-fallback-auto-post-raster-window2-roi-aware-zoom8-to-0.3-v7";
const VECTOR_ZOOM_RUNS_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS vector_zoom_runs (run_code TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const VECTOR_ZOOM_RUN_CODE = /^[2-9A-HJ-NP-Z]{8}$/;
const GPU_STARTUP_DIAGNOSTIC_BUILD = "gpu-diagnostics-application-4096-startup-v14";
const GPU_STARTUP_DEFAULT_TEST_ID = "startup-no-tier2-v1";
const GPU_STARTUP_STORAGE_FORMAT_TEST_ID = "storage-format-ab-v1";
const GPU_STARTUP_DOCUMENT_PIPELINE_TEST_ID = "document-pipeline-bisect-v1";
const GPU_STARTUP_APPLICATION_4096_TEST_ID = "application-4096-startup-v1";
const GPU_STARTUP_APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID = "application-4096-pipelines-async2-v1";
const GPU_STARTUP_APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID = "application-4096-pipelines-first-frame-v1";
const GPU_STARTUP_DEFAULT_VARIANT = "rgba16float-no-texture-formats-tier2-v1";
const GPU_STARTUP_STORAGE_FORMAT_VARIANT = "storage-format-ab-rgba8unorm-control-rgba16float-target-write-only-1x1-no-tier2-v1";
const GPU_STARTUP_DOCUMENT_PIPELINE_VARIANT = "document-pipeline-bisect-rgba16float-no-tier2-v1";
const GPU_STARTUP_APPLICATION_4096_VARIANT = "application-startup-rgba16float-4096x4096-no-tier2-v1";
const GPU_STARTUP_APPLICATION_4096_PIPELINES_ASYNC2_VARIANT = "application-startup-rgba16float-4096x4096-no-tier2-render-pipelines-async2-v1";
const GPU_STARTUP_APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT = "application-startup-rgba16float-4096x4096-no-tier2-render-pipelines-first-frame-1-v1";
const GPU_STARTUP_DIAGNOSTIC_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS gpu_startup_diagnostic_runs (run_code TEXT PRIMARY KEY NOT NULL, write_token_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL, sequence INTEGER NOT NULL, latest_event TEXT NOT NULL DEFAULT 'html-requested', result_summary TEXT NOT NULL DEFAULT '', payload_bytes INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL)";
const GPU_STARTUP_DIAGNOSTIC_INDEX_SQL = "CREATE INDEX IF NOT EXISTS gpu_startup_diagnostic_runs_expires_at_idx ON gpu_startup_diagnostic_runs (expires_at)";
const GPU_STARTUP_DIAGNOSTIC_RUN_CODE = /^diag-[a-f0-9]{32}$/;
const GPU_STARTUP_DIAGNOSTIC_WRITE_TOKEN = /^[a-f0-9]{64}$/;
const GPU_STARTUP_DIAGNOSTIC_STATUSES = new Set(["running", "completed", "failed", "interrupted"]);
const GPU_STARTUP_DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const GPU_STARTUP_DIAGNOSTIC_PAGE_PATH = "/gpu-startup-lab";
const GPU_STARTUP_APP_FRAME_PATH = "/gpu-startup-app-frame";

function gpuStartupDiagnosticDefinition(testId) {
  if (testId === GPU_STARTUP_DEFAULT_TEST_ID) {
    return {
      testId,
      diagnosticVariant: GPU_STARTUP_DEFAULT_VARIANT,
      comparison: {
        layerFormat: "rgba16float",
        canvasFormat: "rgba16float",
        textureFormatsTier2Enabled: false,
        inPlaceGlazeCommitEnabled: false,
        inPlaceGlazeCommitPipelineCreated: false,
      },
    };
  }
  if (testId === GPU_STARTUP_STORAGE_FORMAT_TEST_ID) {
    return {
      testId,
      diagnosticVariant: GPU_STARTUP_STORAGE_FORMAT_VARIANT,
      comparison: {
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
      },
    };
  }
  if (testId === GPU_STARTUP_DOCUMENT_PIPELINE_TEST_ID) {
    return {
      testId,
      diagnosticVariant: GPU_STARTUP_DOCUMENT_PIPELINE_VARIANT,
      comparison: {
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
      },
    };
  }
  if (testId === GPU_STARTUP_APPLICATION_4096_TEST_ID) {
    return {
      testId,
      diagnosticVariant: GPU_STARTUP_APPLICATION_4096_VARIANT,
      comparison: {
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
      },
    };
  }
  if (testId === GPU_STARTUP_APPLICATION_4096_PIPELINES_ASYNC2_TEST_ID) {
    return {
      testId,
      diagnosticVariant: GPU_STARTUP_APPLICATION_4096_PIPELINES_ASYNC2_VARIANT,
      comparison: {
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
      },
    };
  }
  if (testId === GPU_STARTUP_APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST_ID) {
    return {
      testId,
      diagnosticVariant: GPU_STARTUP_APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT,
      comparison: {
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
      },
    };
  }
  return null;
}

function gpuStartupDiagnosticDefinitionFromUrl(url) {
  const requestedTestId = url.searchParams.get("test") || GPU_STARTUP_DEFAULT_TEST_ID;
  return gpuStartupDiagnosticDefinition(requestedTestId);
}

function validGpuStartupDiagnosticComparison(comparison, expected) {
  if (!isRecord(comparison)) return false;
  const actualKeys = Object.keys(comparison).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return false;
  return expectedKeys.every((key) => (
    JSON.stringify(comparison[key]) === JSON.stringify(expected[key])
  ));
}
const VECTOR_ZOOM_CHECK_NAMES = [
  "exactlyTenDistributedTexts",
  "fixedFastZoomOutCompleted",
  "fallbackPreparedBeforeGesture",
  "fallbackPixelsPresent",
  "rasterLifecycleRebuiltFallback",
  "finalFastFrameAcknowledged",
  "fastCompositePixelsPresent",
  "witnessesExerciseReveal",
  "everyZoomStepCovered",
  "noClippedOrExactWorkDuringGesture",
  "fastPresentationFlowed",
  "framePacingWithinBudget",
  "recoveryWithinBudget",
  "exactRecoveryLatestOnly",
  "finalModePrecise",
  "effectsStayedSettled",
  "environmentStayedStable",
];
const VECTOR_ZOOM_PROFILE_ORDER = [
  "arch", "drop-shadow", "block-shadow", "inner-shadow", "arch",
  "drop-shadow", "block-shadow", "inner-shadow", "arch", "drop-shadow",
];
const IMMUTABLE_ASSET_PATH = /^\\/assets\\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$/;
const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function ensureHumanStrokeSchema(db) {
  await db.prepare(HUMAN_STROKE_SCHEMA_SQL).run();
}

async function ensureBenchmarkRunsSchema(db) {
  await db.batch([
    db.prepare(BENCHMARK_RUNS_SCHEMA_SQL),
    db.prepare(BENCHMARK_RUNS_INDEX_SQL),
  ]);
}

async function ensureIphoneMemoryLimitSchema(db) {
  await db.batch([
    db.prepare(IPHONE_MEMORY_LIMIT_SCHEMA_SQL),
    db.prepare(IPHONE_MEMORY_LIMIT_INDEX_SQL),
  ]);
}

async function ensureLayerCompressionSchema(db) {
  await db.batch([
    db.prepare(LAYER_COMPRESSION_SCHEMA_SQL),
    db.prepare(LAYER_COMPRESSION_INDEX_SQL),
  ]);
}

async function ensureVectorZoomRunsSchema(db) {
  await db.prepare(VECTOR_ZOOM_RUNS_SCHEMA_SQL).run();
}

async function ensureGpuStartupDiagnosticSchema(db) {
  await db.batch([
    db.prepare(GPU_STARTUP_DIAGNOSTIC_SCHEMA_SQL),
    db.prepare(GPU_STARTUP_DIAGNOSTIC_INDEX_SQL),
  ]);
}

function finiteNumberArray(value, maximumLength = 360) {
  return Array.isArray(value)
    && value.length <= maximumLength
    && value.every((entry) => Number.isFinite(entry));
}

function finiteNumberInRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function finiteNonNegativeNumberArray(value, maximumLength = 360) {
  return finiteNumberArray(value, maximumLength)
    && value.every((entry) => entry >= 0 && entry <= 60_000);
}

async function readLimitedJson(request, maximumBytes) {
  if (!request.body) return { error: "invalid" };
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return { error: "too-large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: "invalid" };
  }
}

function normalizeHumanStrokeBenchmark(payload) {
  if (!payload || typeof payload !== "object" || !payload.settings || typeof payload.settings !== "object") {
    return payload;
  }

  if (
    payload.presetRevision === HUMAN_STROKE_PRESET_REVISION &&
    payload.settings.blendIntensity === 1 &&
    payload.settings.stabilization === 0 &&
    !Object.hasOwn(payload.settings, "speedThickness") &&
    !Object.hasOwn(payload.settings, "pressureSize") &&
    !Object.hasOwn(payload.settings, "pressureOpacity")
  ) {
    return payload;
  }

  const settings = {
    ...payload.settings,
    blendIntensity: 1,
    stabilization: 0,
  };
  delete settings.speedThickness;
  delete settings.pressureSize;
  delete settings.pressureOpacity;

  return {
    ...payload,
    presetRevision: HUMAN_STROKE_PRESET_REVISION,
    settings,
  };
}

async function handleHumanStroke(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Benchmark storage non disponibile." }, 503);
  }

  await ensureHumanStrokeSchema(env.DB);

  if (request.method === "GET") {
    const record = await env.DB
      .prepare("SELECT payload_json FROM human_stroke_benchmark WHERE id = ?1")
      .bind(HUMAN_STROKE_ID)
      .first();
    if (!record) {
      return jsonResponse({ error: "Nessun tratto registrato." }, 404);
    }
    const canonical = normalizeHumanStrokeBenchmark(JSON.parse(record.payload_json));
    const canonicalJson = JSON.stringify(canonical);
    if (canonicalJson !== record.payload_json) {
      await env.DB
        .prepare("UPDATE human_stroke_benchmark SET payload_json = ?1 WHERE id = ?2")
        .bind(canonicalJson, HUMAN_STROKE_ID)
        .run();
    }
    return new Response(canonicalJson, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 900_000) {
      return jsonResponse({ error: "Il tratto registrato è troppo grande." }, 413);
    }

    const payload = await request.json();
    if (
      !payload ||
      payload.version !== 1 ||
      !payload.settings ||
      !Array.isArray(payload.points) ||
      payload.points.length < 2 ||
      payload.points.length > 20000
    ) {
      return jsonResponse({ error: "Il tratto registrato non è valido." }, 400);
    }

    const canonical = normalizeHumanStrokeBenchmark(payload);
    const payloadJson = JSON.stringify(canonical);
    if (payloadJson.length > 900_000) {
      return jsonResponse({ error: "Il tratto registrato è troppo grande." }, 413);
    }

    const insert = await env.DB
      .prepare("INSERT OR IGNORE INTO human_stroke_benchmark (id, payload_json, captured_at) VALUES (?1, ?2, ?3)")
      .bind(HUMAN_STROKE_ID, payloadJson, String(payload.capturedAt ?? new Date().toISOString()))
      .run();

    if ((insert.meta?.changes ?? 0) === 0) {
      const existing = await env.DB
        .prepare("SELECT payload_json FROM human_stroke_benchmark WHERE id = ?1")
        .bind(HUMAN_STROKE_ID)
        .first();
      return new Response(existing?.payload_json ?? "{}", {
        status: 409,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return jsonResponse(canonical, 201);
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleBenchmarkRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Benchmark storage non disponibile." }, 503);
  }

  await ensureBenchmarkRunsSchema(env.DB);

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 100_000) {
      return jsonResponse({ error: "Il risultato del benchmark è troppo grande." }, 413);
    }

    const payload = await request.json();
    if (
      !payload ||
      payload.version !== 1 ||
      !payload.benchmark ||
      !payload.playback ||
      !payload.performance ||
      !payload.environment
    ) {
      return jsonResponse({ error: "Il risultato del benchmark non è valido." }, 400);
    }

    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 100_000) {
      return jsonResponse({ error: "Il risultato del benchmark è troppo grande." }, 413);
    }

    const createdAt = new Date().toISOString();
    const insert = await env.DB
      .prepare("INSERT INTO benchmark_runs (created_at, payload_json) VALUES (?1, ?2)")
      .bind(createdAt, payloadJson)
      .run();
    return jsonResponse({ id: Number(insert.meta?.last_row_id ?? 0), createdAt }, 201);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "1000");
    const limit = Math.min(1000, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 1000));
    const result = await env.DB
      .prepare("SELECT id, created_at, payload_json FROM benchmark_runs ORDER BY id ASC LIMIT ?1")
      .bind(limit)
      .all();
    const runs = (result.results ?? []).map((record) => ({
      id: Number(record.id),
      createdAt: record.created_at,
      ...JSON.parse(record.payload_json),
    }));
    return jsonResponse({ version: 1, exportedAt: new Date().toISOString(), runs });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleIphoneMemoryLimitRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Archivio limite iPhone non disponibile." }, 503);
  }

  await ensureIphoneMemoryLimitSchema(env.DB);

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 100_000) {
      return jsonResponse({ error: "Il checkpoint del limite iPhone è troppo grande." }, 413);
    }

    const payload = await request.json();
    if (
      !payload
      || payload.version !== 1
      || payload.build !== IPHONE_MEMORY_LIMIT_BUILD
      || typeof payload.runId !== "string"
      || !/^iphone-[a-z0-9-]{12,80}$/i.test(payload.runId)
      || typeof payload.createdAt !== "string"
      || typeof payload.updatedAt !== "string"
      || !IPHONE_MEMORY_LIMIT_STATUSES.has(payload.status)
      || !payload.plan
      || !payload.environment
      || !payload.variant
      || typeof payload.variant.layerColdCompressionEnabled !== "boolean"
      || !(
        payload.variant.layerColdCompressionRuntimeBuild === null
        || typeof payload.variant.layerColdCompressionRuntimeBuild === "string"
      )
      || typeof payload.variant.layerColdDirectHotHydrationEnabled !== "boolean"
      || typeof payload.variant.layerColdAdjacentPrefetchEnabled !== "boolean"
      || !Array.isArray(payload.events)
      || payload.events.length > 64
      || !Number.isFinite(payload.lastSafeMiB)
      || !Number.isFinite(payload.highestObservedPeakMiB)
      || !Number.isFinite(payload.lastSafeCountedGpuPlusCompressedCpuMiB)
      || !Number.isFinite(payload.highestObservedCountedGpuPlusCompressedCpuPeakMiB)
      || !payload.latestMemory
    ) {
      return jsonResponse({ error: "Il checkpoint del limite iPhone non è valido." }, 400);
    }

    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 100_000) {
      return jsonResponse({ error: "Il checkpoint del limite iPhone è troppo grande." }, 413);
    }

    await env.DB
      .prepare("INSERT INTO iphone_memory_limit_runs (id, created_at, updated_at, status, payload_json) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, status = excluded.status, payload_json = excluded.payload_json")
      .bind(payload.runId, payload.createdAt, payload.updatedAt, payload.status, payloadJson)
      .run();
    return jsonResponse({
      runId: payload.runId,
      status: payload.status,
      updatedAt: payload.updatedAt,
    }, 201);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const runId = url.searchParams.get("id");
    if (runId) {
      if (!/^iphone-[a-z0-9-]{12,80}$/i.test(runId)) {
        return jsonResponse({ error: "Identificativo run non valido." }, 400);
      }
      const record = await env.DB
        .prepare("SELECT payload_json FROM iphone_memory_limit_runs WHERE id = ?1")
        .bind(runId)
        .first();
      if (!record) {
        return jsonResponse({ error: "Run limite iPhone non trovata." }, 404);
      }
      return jsonResponse({ run: JSON.parse(record.payload_json) });
    }

    const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20),
    );
    const result = await env.DB
      .prepare("SELECT payload_json FROM iphone_memory_limit_runs ORDER BY updated_at DESC LIMIT ?1")
      .bind(limit)
      .all();
    const runs = (result.results ?? []).map((record) => JSON.parse(record.payload_json));
    return jsonResponse({
      version: 1,
      exportedAt: new Date().toISOString(),
      runs,
    });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleLayerCompressionRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Archivio compressione livelli non disponibile." }, 503);
  }

  await ensureLayerCompressionSchema(env.DB);

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 100_000) {
      return jsonResponse({ error: "Il report compressione è troppo grande." }, 413);
    }
    const payload = await request.json();
    if (
      !payload
      || payload.version !== 1
      || payload.build !== LAYER_COMPRESSION_BUILD
      || payload.passed !== true
      || payload.measurementOnly !== true
      || payload.byteIdentical !== true
      || payload.codec !== "compression-stream-gzip"
      || !Number.isFinite(payload.rawMiB)
      || !Number.isFinite(payload.adaptiveStoredMiB)
      || !Number.isFinite(payload.encodeMs)
      || !Number.isFinite(payload.decodeMs)
      || !payload.environment
      || !Array.isArray(payload.layers)
      || payload.layers.length < 1
      || payload.layers.length > 16
    ) {
      return jsonResponse({ error: "Il report compressione non è valido." }, 400);
    }
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 100_000) {
      return jsonResponse({ error: "Il report compressione è troppo grande." }, 413);
    }
    const createdAt = new Date().toISOString();
    const insert = await env.DB
      .prepare("INSERT INTO layer_compression_runs (created_at, payload_json) VALUES (?1, ?2)")
      .bind(createdAt, payloadJson)
      .run();
    return jsonResponse({
      id: Number(insert.meta?.last_row_id ?? 0),
      createdAt,
    }, 201);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20),
    );
    const result = await env.DB
      .prepare("SELECT id, created_at, payload_json FROM layer_compression_runs ORDER BY id DESC LIMIT ?1")
      .bind(limit)
      .all();
    const runs = (result.results ?? []).map((record) => ({
      id: Number(record.id),
      createdAt: record.created_at,
      ...JSON.parse(record.payload_json),
    }));
    return jsonResponse({ version: 1, exportedAt: new Date().toISOString(), runs });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleVectorZoomRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Archivio test zoom vettoriale non disponibile." }, 503);
  }
  await ensureVectorZoomRunsSchema(env.DB);

  if (request.method === "POST") {
    const requestOrigin = request.headers.get("Origin");
    if (requestOrigin !== new URL(request.url).origin) {
      return jsonResponse({ error: "Origine non consentita." }, 403);
    }
    if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
      return jsonResponse({ error: "Content-Type JSON richiesto." }, 415);
    }
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 65_536) {
      return jsonResponse({ error: "Il report zoom è troppo grande." }, 413);
    }
    const decoded = await readLimitedJson(request, 65_536);
    if (decoded.error === "too-large") {
      return jsonResponse({ error: "Il report zoom è troppo grande." }, 413);
    }
    if (decoded.error) {
      return jsonResponse({ error: "JSON del report zoom non valido." }, 400);
    }
    const payload = decoded.value;
    const report = payload?.report;
    const checks = report && typeof report.checks === "object" && report.checks
      ? report.checks
      : null;
    const timingFields = report ? [
      report.idleFrameMedianMs,
      report.gestureDurationMs,
      report.frameP50Ms,
      report.frameP95Ms,
      report.frameMaximumMs,
      report.eventToNextFrameP95Ms,
      report.queuePrefixAndCallbackWaitMs,
      report.finalFastAckDurationMs,
      report.fastCompositeProbeDurationMs,
      report.fastVerificationDurationMs,
      report.recoveryDurationMs,
      report.totalMeasuredDurationMs,
    ] : [];
    const counterFields = report ? [
      report.framesOver20Ms,
      report.framesOver33Ms,
      report.normalizedMissedFrameCount,
      report.exactRenderDeltaDuringGesture,
      report.exactRenderDeltaDuringRecovery,
      report.safeReprojectionDelta,
      report.fallbackReprojectionDelta,
      report.clippedReprojectionDelta,
      report.unsafeExactRefreshStartedDelta,
      report.unsafeExactRefreshCompletedDelta,
      report.fastPresentationSubmitDelta,
      report.fastPresentationCoalescedDelta,
      report.requiredFastPresentationSubmitCount,
      report.fastPresentationMaximumInFlight,
      report.fastPresentationInFlightAtTraceEnd,
      report.rasterLayerCountAfterFallbackRebuild,
      report.automaticFallbackRebuildDelta,
      report.latestViewRevision,
      report.finalFastRequestedRevision,
      report.finalFastSubmittedRevision,
      report.finalFastCompletedRevision,
    ] : [];
    const greenReportIsConsistent = !report?.passed || (
      report.initialRasterWasEmpty === true
      && report.textCount === 10
      && Math.abs(report.startZoom - 8) <= 1e-4
      && Math.abs(report.finalZoom - 0.3) <= 1e-4
      && Math.abs(report.fallbackCaptureZoom - 0.2) <= 1e-4
      && report.fallbackTextureCount === 1
      && report.fallbackRunCount === 1
      && report.fallbackFullViewportGpuMemoryMiB > 0
      && (report.vectorTextRoiCacheEnabled
        ? report.fallbackGpuMemoryMiB > 0
          && report.fallbackGpuMemoryMiB < report.fallbackFullViewportGpuMemoryMiB
        : Math.abs(
            report.fallbackGpuMemoryMiB - report.fallbackFullViewportGpuMemoryMiB,
          ) < 1e-6)
      && Array.isArray(report.fallbackProbeAlphaPixelCounts)
      && report.fallbackProbeAlphaPixelCounts.length === 10
      && report.fallbackProbeAlphaPixelCounts.every((count) => count > 0)
      && report.rasterLayerCountAfterFallbackRebuild === 2
      && report.selectedRasterAfterFallbackRebuild === true
      && report.automaticFallbackRebuildDelta >= 1
      && Array.isArray(report.fastCompositeProbeAlphaPixelCounts)
      && report.fastCompositeProbeAlphaPixelCounts.length === 10
      && report.fastCompositeProbeAlphaPixelCounts.every((count) => count > 0)
      && report.witnessesOutsideStartCount >= 8
      && report.witnessesInsideTargetCount === 10
      && Array.isArray(report.presentationModes)
      && report.presentationModes.every((mode) => (
        mode === "reproject" || mode === "reproject-fallback"
      ))
      && report.exactRenderDeltaDuringGesture === 0
      && report.clippedReprojectionDelta === 0
      && report.unsafeExactRefreshStartedDelta === 0
      && report.unsafeExactRefreshCompletedDelta === 0
      && report.fallbackReprojectionDelta > 0
      && report.fastPresentationSubmitDelta >= report.requiredFastPresentationSubmitCount
      && report.fastPresentationCoalescedDelta <= Math.ceil(report.sampleCount * 0.1)
      && report.fastPresentationMaximumInFlight >= 1
      && report.fastPresentationMaximumInFlight <= 2
      && report.fastPresentationInFlightAtTraceEnd <= 2
      && report.fastSubmittedRevisionLagMaximum <= 2
      && report.fastCompletedRevisionLagP95 <= 2
      && report.fastCompletedRevisionLagMaximum <= 2
      && report.finalFastSubmittedRevision === report.finalFastRequestedRevision
      && report.finalFastCompletedRevision === report.finalFastRequestedRevision
      && report.finalFastAckDurationMs <= 250
      && report.queuePrefixAndCallbackWaitMs <= 250
      && report.recoveryDurationMs <= 1200
      && report.exactRecoveryDelta === 1
      && Array.isArray(report.profileOrder)
      && report.profileOrder.every((profile, index) => (
        profile === VECTOR_ZOOM_PROFILE_ORDER[index]
      ))
    );
    if (
      !payload
      || payload.version !== 1
      || payload.kind !== "vector-zoom-c"
      || typeof payload.runCode !== "string"
      || !VECTOR_ZOOM_RUN_CODE.test(payload.runCode)
      || !report
      || report.version !== 1
      || report.strategy !== VECTOR_ZOOM_C_STRATEGY
      || report.variant !== "C"
      || report.runCode !== payload.runCode
      || typeof report.passed !== "boolean"
      || typeof report.initialRasterWasEmpty !== "boolean"
      || typeof report.vectorTextRoiCacheEnabled !== "boolean"
      || typeof report.traceFingerprint !== "string"
      || report.traceFingerprint.length > 512
      || !integerInRange(report.textCount, 0, 100)
      || report.idleFrameCount !== 30
      || !Number.isInteger(report.sampleCount)
      || report.sampleCount < 2
      || report.sampleCount > 120
      || report.gestureTargetDurationMs !== 650
      || !finiteNumberInRange(report.startZoom, 0.02, 64)
      || report.targetZoom !== 0.3
      || !finiteNumberInRange(report.finalZoom, 0.02, 64)
      || !finiteNumberInRange(report.fallbackCaptureZoom, 0, 64)
      || !integerInRange(report.fallbackTextureCount, 0, 64)
      || !integerInRange(report.fallbackRunCount, 0, 64)
      || !finiteNumberInRange(report.fallbackGpuMemoryMiB, 0, 1024)
      || !finiteNumberInRange(report.fallbackFullViewportGpuMemoryMiB, 0, 1024)
      || !finiteNumberArray(report.fallbackProbeAlphaPixelCounts, 10)
      || !report.fallbackProbeAlphaPixelCounts.every((count) => (
        integerInRange(count, 0, 16_384)
      ))
      || !integerInRange(report.rasterLayerCountAfterFallbackRebuild, 0, 64)
      || typeof report.selectedRasterAfterFallbackRebuild !== "boolean"
      || !integerInRange(report.automaticFallbackRebuildDelta, 0, 1_000_000)
      || !finiteNumberArray(report.fastCompositeProbeAlphaPixelCounts, 10)
      || !report.fastCompositeProbeAlphaPixelCounts.every((count) => (
        integerInRange(count, 0, 16_384)
      ))
      || !integerInRange(report.witnessesOutsideStartCount, 0, 10)
      || !integerInRange(report.witnessesInsideTargetCount, 0, 10)
      || !finiteNonNegativeNumberArray(report.idleFrameIntervalsMs)
      || !finiteNonNegativeNumberArray(report.gestureFrameIntervalsMs, 120)
      || !finiteNonNegativeNumberArray(report.eventToNextFrameMs, 120)
      || !finiteNonNegativeNumberArray(report.fastSubmittedRevisionLagSamples, 120)
      || !finiteNonNegativeNumberArray(report.fastCompletedRevisionLagSamples, 120)
      || report.idleFrameIntervalsMs.length !== report.idleFrameCount
      || report.gestureFrameIntervalsMs.length !== report.sampleCount
      || report.eventToNextFrameMs.length !== report.sampleCount
      || report.fastSubmittedRevisionLagSamples.length !== report.sampleCount
      || report.fastCompletedRevisionLagSamples.length !== report.sampleCount
      || !Array.isArray(report.presentationModes)
      || report.presentationModes.length !== report.sampleCount
      || !report.presentationModes.every((mode) => (
        mode === "precise"
        || mode === "reproject"
        || mode === "reproject-fallback"
        || mode === "reproject-clipped"
      ))
      || timingFields.length !== 12
      || !timingFields.every((value) => finiteNumberInRange(value, 0, 60_000))
      || !counterFields.every((value) => integerInRange(value, -1_000_000, 1_000_000_000))
      || !finiteNumberInRange(report.fastSubmittedRevisionLagMaximum, 0, 1_000_000)
      || !finiteNumberInRange(report.fastCompletedRevisionLagP95, 0, 1_000_000)
      || !finiteNumberInRange(report.fastCompletedRevisionLagMaximum, 0, 1_000_000)
      || !finiteNumberInRange(report.fastPresentationRateHz, 0, 10_000)
      || !integerInRange(report.fastPresentationMaximumInFlight, 0, 1_000_000)
      || !integerInRange(report.fastPresentationInFlightAtTraceEnd, 0, 1_000_000)
      || (report.fastVerificationError !== null && (
        typeof report.fastVerificationError !== "string"
        || report.fastVerificationError.length > 1024
      ))
      || !report.environment
      || typeof report.environment.userAgent !== "string"
      || report.environment.userAgent.length > 1024
      || typeof report.environment.gpuLabel !== "string"
      || report.environment.gpuLabel.length > 512
      || typeof report.environment.visibilityAtStart !== "string"
      || typeof report.environment.visibilityAtEnd !== "string"
      || !finiteNumberInRange(report.environment.devicePixelRatioAtStart, 0.1, 20)
      || !finiteNumberInRange(report.environment.devicePixelRatioAtEnd, 0.1, 20)
      || !integerInRange(report.environment.viewportWidthAtStart, 1, 32_768)
      || !integerInRange(report.environment.viewportHeightAtStart, 1, 32_768)
      || !integerInRange(report.environment.viewportWidthAtEnd, 1, 32_768)
      || !integerInRange(report.environment.viewportHeightAtEnd, 1, 32_768)
      || !integerInRange(report.environment.canvasWidthAtStart, 1, 32_768)
      || !integerInRange(report.environment.canvasHeightAtStart, 1, 32_768)
      || !integerInRange(report.environment.canvasWidthAtEnd, 1, 32_768)
      || !integerInRange(report.environment.canvasHeightAtEnd, 1, 32_768)
      || !Array.isArray(report.profileOrder)
      || report.profileOrder.length !== 10
      || !report.profileOrder.every((profile) => (
        typeof profile === "string" && profile.length <= 64
      ))
      || !integerInRange(report.exactRecoveryDelta, -1_000_000, 1_000_000_000)
      || !checks
      || Object.keys(checks).length !== VECTOR_ZOOM_CHECK_NAMES.length
      || !VECTOR_ZOOM_CHECK_NAMES.every((name) => typeof checks[name] === "boolean")
      || report.passed !== VECTOR_ZOOM_CHECK_NAMES.every((name) => checks[name])
      || !greenReportIsConsistent
    ) {
      return jsonResponse({ error: "Il report zoom vettoriale non è valido." }, 400);
    }
    const payloadJson = JSON.stringify(report);
    if (new TextEncoder().encode(payloadJson).byteLength > 65_536) {
      return jsonResponse({ error: "Il report zoom è troppo grande." }, 413);
    }
    const createdAt = new Date().toISOString();
    await env.DB
      .prepare("INSERT INTO vector_zoom_runs (run_code, created_at, payload_json) VALUES (?1, ?2, ?3) ON CONFLICT(run_code) DO UPDATE SET created_at = excluded.created_at, payload_json = excluded.payload_json")
      .bind(payload.runCode, createdAt, payloadJson)
      .run();
    return jsonResponse({ runCode: payload.runCode, createdAt }, 201);
  }

  if (request.method === "GET") {
    const runCode = new URL(request.url).searchParams.get("code")?.toUpperCase() ?? "";
    if (!VECTOR_ZOOM_RUN_CODE.test(runCode)) {
      return jsonResponse({ error: "Codice del test zoom non valido." }, 400);
    }
    const record = await env.DB
      .prepare("SELECT created_at, payload_json FROM vector_zoom_runs WHERE run_code = ?1")
      .bind(runCode)
      .first();
    if (!record) {
      return jsonResponse({ error: "Report zoom non trovato." }, 404);
    }
    return jsonResponse({
      version: 1,
      runCode,
      createdAt: record.created_at,
      report: JSON.parse(record.payload_json),
    });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIsoDate(value) {
  return typeof value === "string"
    && value.length >= 20
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function validGpuStartupDiagnosticEvent(event) {
  if (!isRecord(event)) return false;
  const allowedKeys = new Set(["sequence", "at", "name", "detail"]);
  if (Object.keys(event).some((key) => !allowedKeys.has(key))) return false;
  return Number.isSafeInteger(event.sequence)
    && event.sequence > 0
    && validIsoDate(event.at)
    && typeof event.name === "string"
    && /^[a-z0-9-]{1,96}$/.test(event.name);
}

function normalizeGpuStartupDiagnosticPayload(payload) {
  if (!isRecord(payload)) return null;
  const allowedKeys = new Set([
    "version",
    "build",
    "runCode",
    "writeToken",
    "sequence",
    "createdAt",
    "updatedAt",
    "status",
    "privacy",
    "environment",
    "events",
    "summary",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) return null;
  const eventsValid = Array.isArray(payload.events)
    && payload.events.length >= 1
    && payload.events.length <= 24
    && payload.events.every(validGpuStartupDiagnosticEvent)
    && payload.events.every((event, index) => (
      index === 0 || event.sequence > payload.events[index - 1].sequence
    ));
  const lastEvent = eventsValid ? payload.events[payload.events.length - 1] : null;
  const summaryJson = isRecord(payload.summary) ? JSON.stringify(payload.summary) : "";
  const comparison = isRecord(payload.summary?.comparison) ? payload.summary.comparison : null;
  const definition = typeof payload.summary?.testId === "string"
    ? gpuStartupDiagnosticDefinition(payload.summary.testId)
    : null;
  const environmentJson = isRecord(payload.environment) ? JSON.stringify(payload.environment) : "";
  if (
    payload.version !== 1
    || payload.build !== GPU_STARTUP_DIAGNOSTIC_BUILD
    || typeof payload.runCode !== "string"
    || !GPU_STARTUP_DIAGNOSTIC_RUN_CODE.test(payload.runCode)
    || typeof payload.writeToken !== "string"
    || !GPU_STARTUP_DIAGNOSTIC_WRITE_TOKEN.test(payload.writeToken)
    || !Number.isSafeInteger(payload.sequence)
    || payload.sequence <= 0
    || !validIsoDate(payload.createdAt)
    || !validIsoDate(payload.updatedAt)
    || !GPU_STARTUP_DIAGNOSTIC_STATUSES.has(payload.status)
    || typeof payload.privacy !== "string"
    || payload.privacy.length > 400
    || !isRecord(payload.environment)
    || new TextEncoder().encode(environmentJson).byteLength > 8 * 1024
    || !eventsValid
    || !isRecord(payload.summary)
    || new TextEncoder().encode(summaryJson).byteLength > 24 * 1024
    || !definition
    || payload.summary.diagnosticVariant !== definition.diagnosticVariant
    || !validGpuStartupDiagnosticComparison(comparison, definition.comparison)
    || typeof payload.summary.latestEvent !== "string"
    || payload.summary.latestEvent !== lastEvent?.name
    || payload.sequence !== lastEvent?.sequence
  ) {
    return null;
  }
  return {
    version: 1,
    build: GPU_STARTUP_DIAGNOSTIC_BUILD,
    runCode: payload.runCode,
    sequence: payload.sequence,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    status: payload.status,
    privacy: payload.privacy,
    environment: payload.environment,
    events: payload.events,
    summary: payload.summary,
    writeToken: payload.writeToken,
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deleteExpiredGpuStartupDiagnostics(db, now) {
  await db
    .prepare("DELETE FROM gpu_startup_diagnostic_runs WHERE expires_at < ?1")
    .bind(now)
    .run();
}

async function recordGpuStartupDiagnosticPageRequest(request, env) {
  if (!env.DB) return true;
  const url = new URL(request.url);
  const definition = gpuStartupDiagnosticDefinitionFromUrl(url);
  if (!definition) return false;
  const runCode = url.searchParams.get("run") ?? "";
  if (!GPU_STARTUP_DIAGNOSTIC_RUN_CODE.test(runCode)) return true;
  await ensureGpuStartupDiagnosticSchema(env.DB);
  const existing = await env.DB
    .prepare("SELECT result_summary FROM gpu_startup_diagnostic_runs WHERE run_code = ?1")
    .bind(runCode)
    .first();
  if (existing?.result_summary) {
    try {
      const existingSummary = JSON.parse(existing.result_summary);
      if (existingSummary?.testId !== definition.testId) return false;
    } catch {
      return false;
    }
  }
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + GPU_STARTUP_DIAGNOSTIC_RETENTION_MS).toISOString();
  const payload = {
    version: 1,
    build: GPU_STARTUP_DIAGNOSTIC_BUILD,
    runCode,
    sequence: 0,
    createdAt,
    updatedAt: createdAt,
    status: "html-requested",
    privacy: "Server request metadata and normalized diagnostic test ID only. No IP address, cookies, referrer, artwork, project data, or raw URL query is stored.",
    environment: {
      serverRequest: {
        userAgent: request.headers.get("User-Agent"),
        acceptLanguage: request.headers.get("Accept-Language"),
        secChUa: request.headers.get("Sec-CH-UA"),
        secChUaMobile: request.headers.get("Sec-CH-UA-Mobile"),
        secChUaPlatform: request.headers.get("Sec-CH-UA-Platform"),
      },
    },
    events: [{ sequence: 0, at: createdAt, name: "html-requested", detail: null }],
    summary: {
      testId: definition.testId,
      diagnosticVariant: definition.diagnosticVariant,
      comparison: definition.comparison,
      result: null,
      latestEvent: "html-requested",
      moduleLoaded: false,
      probeFinished: false,
    },
  };
  const payloadJson = JSON.stringify(payload);
  await env.DB
    .prepare("INSERT OR IGNORE INTO gpu_startup_diagnostic_runs (run_code, write_token_hash, created_at, updated_at, expires_at, status, sequence, latest_event, result_summary, payload_bytes, payload_json) VALUES (?1, '', ?2, ?2, ?3, 'html-requested', 0, 'html-requested', ?4, ?5, ?6)")
    .bind(
      runCode,
      createdAt,
      expiresAt,
      JSON.stringify(payload.summary),
      new TextEncoder().encode(payloadJson).byteLength,
      payloadJson,
    )
    .run();
  await deleteExpiredGpuStartupDiagnostics(env.DB, createdAt);
  return true;
}

async function handleGpuStartupDiagnostics(request, env) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (!env.DB) {
    return jsonResponse({ error: "Diagnostic storage is unavailable." }, 503);
  }
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== "same-origin")) {
    return jsonResponse({ error: "Cross-origin diagnostic writes are not accepted." }, 403);
  }
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/plain") && !contentType.startsWith("application/json")) {
    return jsonResponse({ error: "Unsupported diagnostic content type." }, 415);
  }

  const decoded = await readLimitedJson(request, 64 * 1024);
  if (decoded.error) {
    return jsonResponse({ error: decoded.error === "too-large" ? "Diagnostic payload is too large." : "Diagnostic payload is invalid." }, decoded.error === "too-large" ? 413 : 400);
  }
  const payload = normalizeGpuStartupDiagnosticPayload(decoded.value);
  if (!payload) {
    return jsonResponse({ error: "Diagnostic payload is invalid." }, 400);
  }

  await ensureGpuStartupDiagnosticSchema(env.DB);
  const tokenHash = await sha256Hex(payload.writeToken);
  const existing = await env.DB
    .prepare("SELECT write_token_hash, created_at, sequence, status, latest_event, result_summary, payload_bytes FROM gpu_startup_diagnostic_runs WHERE run_code = ?1")
    .bind(payload.runCode)
    .first();
  if (existing?.write_token_hash && existing.write_token_hash !== tokenHash) {
    return jsonResponse({ error: "Diagnostic write capability is invalid." }, 403);
  }
  if (existing?.result_summary) {
    try {
      const existingSummary = JSON.parse(existing.result_summary);
      if (existingSummary?.testId !== payload.summary.testId) {
        return jsonResponse({ error: "Diagnostic test mode does not match this run." }, 409);
      }
    } catch {
      return jsonResponse({ error: "Stored diagnostic metadata is invalid." }, 409);
    }
  }
  if (existing && Number(existing.sequence) > payload.sequence) {
    return jsonResponse({
      acknowledged: true,
      runCode: payload.runCode,
      storedStatus: existing.status,
      storedSequence: Number(existing.sequence),
      latestEvent: existing.latest_event,
      payloadBytes: Number(existing.payload_bytes),
      stale: true,
    }, 200);
  }

  const serverNow = new Date().toISOString();
  const expiresAt = new Date(Date.now() + GPU_STARTUP_DIAGNOSTIC_RETENTION_MS).toISOString();
  const storedPayload = {
    version: payload.version,
    build: payload.build,
    runCode: payload.runCode,
    sequence: payload.sequence,
    createdAt: existing?.created_at ?? serverNow,
    clientCreatedAt: payload.createdAt,
    clientUpdatedAt: payload.updatedAt,
    serverUpdatedAt: serverNow,
    status: payload.status,
    privacy: payload.privacy,
    summary: payload.summary,
    environment: payload.environment,
    events: payload.events,
  };
  const storedJson = JSON.stringify(storedPayload);
  const storedBytes = new TextEncoder().encode(storedJson).byteLength;
  if (storedBytes > 64 * 1024) {
    return jsonResponse({ error: "Diagnostic payload is too large." }, 413);
  }
  const latestEvent = payload.events[payload.events.length - 1].name;
  const resultSummary = JSON.stringify(payload.summary);

  const writeResult = await env.DB
    .prepare("INSERT INTO gpu_startup_diagnostic_runs (run_code, write_token_hash, created_at, updated_at, expires_at, status, sequence, latest_event, result_summary, payload_bytes, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(run_code) DO UPDATE SET write_token_hash = CASE WHEN gpu_startup_diagnostic_runs.write_token_hash = '' THEN excluded.write_token_hash ELSE gpu_startup_diagnostic_runs.write_token_hash END, updated_at = excluded.updated_at, expires_at = excluded.expires_at, status = excluded.status, sequence = excluded.sequence, latest_event = excluded.latest_event, result_summary = excluded.result_summary, payload_bytes = excluded.payload_bytes, payload_json = excluded.payload_json WHERE (gpu_startup_diagnostic_runs.write_token_hash = '' OR gpu_startup_diagnostic_runs.write_token_hash = excluded.write_token_hash) AND excluded.sequence >= gpu_startup_diagnostic_runs.sequence AND (gpu_startup_diagnostic_runs.status NOT IN ('completed', 'failed') OR excluded.status IN ('completed', 'failed'))")
    .bind(
      payload.runCode,
      tokenHash,
      existing?.created_at ?? serverNow,
      serverNow,
      expiresAt,
      payload.status,
      payload.sequence,
      latestEvent,
      resultSummary,
      storedBytes,
      storedJson,
    )
    .run();
  const stored = await env.DB
    .prepare("SELECT write_token_hash, status, sequence, latest_event, payload_bytes FROM gpu_startup_diagnostic_runs WHERE run_code = ?1")
    .bind(payload.runCode)
    .first();
  if (!stored) {
    return jsonResponse({ error: "Diagnostic acknowledgement is unavailable." }, 503);
  }
  if (stored.write_token_hash !== tokenHash) {
    return jsonResponse({ error: "Diagnostic write capability is invalid." }, 403);
  }
  const retainedTerminalStatus = (stored.status === "completed" || stored.status === "failed")
    && payload.status !== "completed"
    && payload.status !== "failed";
  if (
    Number(writeResult?.meta?.changes ?? 0) === 0
    && Number(stored.sequence) < payload.sequence
    && !retainedTerminalStatus
  ) {
    return jsonResponse({ error: "Diagnostic acknowledgement is unavailable." }, 503);
  }
  await deleteExpiredGpuStartupDiagnostics(env.DB, serverNow);
  return jsonResponse({
    acknowledged: true,
    runCode: payload.runCode,
    storedStatus: stored.status,
    storedSequence: Number(stored.sequence),
    latestEvent: stored.latest_event,
    payloadBytes: Number(stored.payload_bytes),
    storedAt: serverNow,
  }, 201);
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);

    if (url.pathname === "/api/human-stroke") {
      return handleHumanStroke(request, env);
    }

    if (url.pathname === "/api/benchmark-runs") {
      return handleBenchmarkRuns(request, env);
    }

    if (url.pathname === "/api/layer-compression-runs") {
      return handleLayerCompressionRuns(request, env);
    }
    if (url.pathname === "/api/iphone-memory-limit-runs") {
      return handleIphoneMemoryLimitRuns(request, env);
    }
    if (url.pathname === "/api/vector-zoom-runs") {
      return handleVectorZoomRuns(request, env);
    }
    if (url.pathname === "/api/gpu-startup-diagnostics") {
      return handleGpuStartupDiagnostics(request, env);
    }

    if (
      (request.method === "GET" || request.method === "HEAD")
      && url.pathname === GPU_STARTUP_DIAGNOSTIC_PAGE_PATH
    ) {
      if (!gpuStartupDiagnosticDefinitionFromUrl(url)) {
        return jsonResponse({ error: "Unknown GPU diagnostic test." }, 400);
      }
      if (request.method === "GET") {
        const accepted = await recordGpuStartupDiagnosticPageRequest(request, env);
        if (!accepted) {
          return jsonResponse({ error: "Diagnostic run is already bound to another test." }, 409);
        }
      }
      return new Response(request.method === "HEAD" ? null : GPU_STARTUP_DIAGNOSTIC_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store, max-age=0",
          "CDN-Cache-Control": "no-store",
          "Cloudflare-CDN-Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (
      (request.method === "GET" || request.method === "HEAD")
      && url.pathname === GPU_STARTUP_APP_FRAME_PATH
      && url.searchParams.get("diagnosticBoot") === "1"
    ) {
      return new Response(request.method === "HEAD" ? null : GPU_STARTUP_APP_FRAME_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store, max-age=0",
          "CDN-Cache-Control": "no-store",
          "Cloudflare-CDN-Cache-Control": "no-store",
          "Content-Security-Policy": "frame-ancestors 'self'",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
          "X-Robots-Tag": "noindex, noarchive",
        },
      });
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      return new Response(request.method === "HEAD" ? null : INDEX_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    if (
      (request.method === "GET" || request.method === "HEAD")
      && response.ok
      && IMMUTABLE_ASSET_PATH.test(url.pathname)
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  },
};
`,
);
