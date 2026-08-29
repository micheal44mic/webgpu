type DiagnosticStatus = "running" | "completed" | "failed" | "interrupted";
type DiagnosticDelivery = "wait" | "beacon";

export {};

interface StartupDiagnosticBridge {
  readonly build: string;
  readonly runCode: string;
  record(
    name: string,
    detail?: unknown,
    status?: DiagnosticStatus,
    delivery?: DiagnosticDelivery,
  ): PromiseLike<boolean> | boolean;
  recordBreadcrumb(
    name: string,
    detail?: unknown,
    status?: DiagnosticStatus,
  ): PromiseLike<boolean> | boolean;
  display?(name: string, detail?: unknown): void;
  displayBatch?(entries: readonly Record<string, unknown>[]): void;
  finish(
    status: Exclude<DiagnosticStatus, "running">,
    name: string,
    detail?: unknown,
  ): PromiseLike<boolean> | boolean;
  serializeError(value: unknown): unknown;
  setModuleLoaded(): void;
  snapshot(): unknown;
}

declare global {
  interface Window {
    __gpuStartupDiagnostics?: StartupDiagnosticBridge;
  }

  interface Navigator {
    readonly deviceMemory?: number;
    readonly userAgentData?: {
      readonly brands?: readonly { readonly brand: string; readonly version: string }[];
      readonly mobile?: boolean;
      readonly platform?: string;
      getHighEntropyValues?(hints: readonly string[]): Promise<Record<string, unknown>>;
    };
  }

  interface Performance {
    readonly memory?: {
      readonly jsHeapSizeLimit: number;
      readonly totalJSHeapSize: number;
      readonly usedJSHeapSize: number;
    };
  }
}

const earlyBridge = window.__gpuStartupDiagnostics;
if (!earlyBridge) {
  throw new Error("The early diagnostic bootstrap is unavailable.");
}
const bridge: StartupDiagnosticBridge = earlyBridge;

bridge.setModuleLoaded();

function describeError(value: unknown): unknown {
  return bridge.serializeError(value);
}

async function checkpoint(
  name: string,
  detail: unknown = null,
  status: DiagnosticStatus = "running",
  delivery: DiagnosticDelivery = "wait",
): Promise<void> {
  await bridge.record(name, detail, status, delivery);
}

async function withTimeout<Value>(
  operation: Promise<Value>,
  timeoutMs: number,
  label: string,
): Promise<Value> {
  let timer = 0;
  try {
    return await Promise.race([
      operation,
      new Promise<Value>((_resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs} ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

const DIAGNOSTIC_DOCUMENT_WIDTH = 2048;
const DIAGNOSTIC_DOCUMENT_HEIGHT = 2048;
const RGBA16FLOAT_BYTES_PER_PIXEL = 8;
const APPLICATION_BOOT_TEST = "startup-no-tier2-v1";
const APPLICATION_BOOT_VARIANT = "rgba16float-no-texture-formats-tier2-v1";
const STORAGE_FORMAT_AB_TEST = "storage-format-ab-v1";
const STORAGE_FORMAT_AB_VARIANT =
  "storage-format-ab-rgba8unorm-control-rgba16float-target-write-only-1x1-no-tier2-v1";
const DOCUMENT_PIPELINE_TEST = "document-pipeline-bisect-v1";
const DOCUMENT_PIPELINE_VARIANT = "document-pipeline-bisect-rgba16float-no-tier2-v1";
const APPLICATION_4096_TEST = "application-4096-startup-v1";
const APPLICATION_4096_VARIANT = "application-startup-rgba16float-4096x4096-no-tier2-v1";
const APPLICATION_4096_PIPELINES_ASYNC2_TEST = "application-4096-pipelines-async2-v1";
const APPLICATION_4096_PIPELINES_ASYNC2_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipelines-async2-v1";
const APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST =
  "application-4096-pipelines-first-frame-v1";
const APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipelines-first-frame-1-v1";
const APPLICATION_4096_PIPELINE_BREAKDOWN_TEST =
  "application-4096-pipeline-breakdown-v1";
const APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipeline-breakdown-sync-v1";
const APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST =
  "application-4096-pipeline-attribution-async1-v1";
const APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-render-pipeline-attribution-async1-v1";
const APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_TEST =
  "application-4096-pipeline-first-use-controls-v1";
const APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-first-use-controls-async1-v1";
const APPLICATION_4096_CLEAN_QUEUE_CORE_TEST =
  "application-4096-progressive-core-startup-v1";
const APPLICATION_4096_CLEAN_QUEUE_CORE_VARIANT =
  "application-startup-rgba16float-4096x4096-no-tier2-progressive-core-readiness-async1-v1";
const APPLICATION_4096_DOCUMENT_WIDTH = 4096;
const APPLICATION_4096_DOCUMENT_HEIGHT = 4096;
const APPLICATION_DEFERRED_OBSERVATION_MS = 5_000;
const EXPECTED_DOCUMENT_PIPELINE_LAYOUTS = 17;
const EXPECTED_DOCUMENT_RENDER_PIPELINES = 52;
const EXPECTED_FIRST_FRAME_RENDER_PIPELINES = 1;
const EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS = 2;
const EXPECTED_CORE_RENDER_PIPELINES = 3;
const EXPECTED_CORE_PIPELINE_LABELS = [
  "Light Glaze R16F stale dirty-region clear pipeline",
  "Uniformed/Intense RGBA16F stale dirty-region clear pipeline",
  "Single raster RGBA16F display pipeline",
] as const;
const EXPECTED_CORE_PIPELINE_TARGET_FORMATS = [
  "r16float",
  "rgba16float",
  "rgba16float",
] as const;
const diagnosticTest = new URLSearchParams(window.location.search).get("test");
const storageFormatAbEnabled = diagnosticTest === STORAGE_FORMAT_AB_TEST;
const documentPipelineBisectEnabled = diagnosticTest === DOCUMENT_PIPELINE_TEST;
const application4096StartupEnabled = diagnosticTest === APPLICATION_4096_TEST;
const application4096PipelinesAsync2Enabled =
  diagnosticTest === APPLICATION_4096_PIPELINES_ASYNC2_TEST;
const application4096PipelinesFirstFrameEnabled =
  diagnosticTest === APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST;
const application4096PipelineBreakdownEnabled =
  diagnosticTest === APPLICATION_4096_PIPELINE_BREAKDOWN_TEST;
const application4096PipelineAttributionEnabled =
  diagnosticTest === APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST;
const application4096PipelineFirstUseControlsEnabled =
  diagnosticTest === APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_TEST;
const application4096CleanQueueCoreEnabled =
  diagnosticTest === APPLICATION_4096_CLEAN_QUEUE_CORE_TEST;
const application4096PipelineTimingEnabled =
  application4096PipelineBreakdownEnabled
  || application4096PipelineAttributionEnabled
  || application4096PipelineFirstUseControlsEnabled
  || application4096CleanQueueCoreEnabled;

function comparisonPolicy(): Record<string, unknown> {
  if (storageFormatAbEnabled) {
    return {
      testId: STORAGE_FORMAT_AB_TEST,
      diagnosticVariant: STORAGE_FORMAT_AB_VARIANT,
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
  }
  if (documentPipelineBisectEnabled) {
    return {
      testId: DOCUMENT_PIPELINE_TEST,
      diagnosticVariant: DOCUMENT_PIPELINE_VARIANT,
      kind: "document-pipeline-bisect",
      targetPhase: "document-pipelines",
      layerFormat: "rgba16float",
      requiredFeatures: [],
      textureFormatsTier2Requested: false,
      applicationFrame: "isolated-production-startup",
      instrumentation: "native-device-call-boundaries",
      expectedSynchronousPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedSynchronousRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
    };
  }
  if (application4096StartupEnabled) {
    return {
      testId: APPLICATION_4096_TEST,
      diagnosticVariant: APPLICATION_4096_VARIANT,
      kind: "application-startup",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      requiredFeatures: [],
      textureFormatsTier2Requested: false,
      applicationFrame: "isolated-production-startup",
      startupMode: "cold-empty-document",
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
    };
  }
  if (application4096PipelinesAsync2Enabled) {
    return {
      testId: APPLICATION_4096_PIPELINES_ASYNC2_TEST,
      diagnosticVariant: APPLICATION_4096_PIPELINES_ASYNC2_VARIANT,
      kind: "application-startup-pipeline-compilation",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      requiredFeatures: [],
      textureFormatsTier2Requested: false,
      applicationFrame: "isolated-production-startup",
      startupMode: "cold-empty-document",
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
      pipelineCompilationMethod: "createRenderPipelineAsync",
      pipelineCompilationConcurrency: 2,
      expectedRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      asyncFallbackAllowed: false,
    };
  }
  if (application4096PipelinesFirstFrameEnabled) {
    return {
      testId: APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST,
      diagnosticVariant: APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT,
      kind: "application-startup-pipeline-compilation",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      requiredFeatures: [],
      textureFormatsTier2Requested: false,
      applicationFrame: "isolated-production-startup",
      startupMode: "cold-empty-document",
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
      pipelineCompilationScope: "first-frame-diagnostic",
      expectedRenderPipelines: EXPECTED_FIRST_FRAME_RENDER_PIPELINES,
      excludedRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES
        - EXPECTED_FIRST_FRAME_RENDER_PIPELINES,
      editorInteractionEnabled: false,
    };
  }
  if (application4096PipelineBreakdownEnabled) {
    return {
      testId: APPLICATION_4096_PIPELINE_BREAKDOWN_TEST,
      diagnosticVariant: APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT,
      kind: "application-startup-render-pipeline-breakdown",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
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
      expectedPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      capture: "all-native-call-durations",
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
    };
  }
  if (application4096PipelineAttributionEnabled) {
    return {
      testId: APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST,
      diagnosticVariant: APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT,
      kind: "application-startup-render-pipeline-attribution",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
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
      expectedPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      capture: "non-overlapping-async-pipeline-durations",
      timingSemantics: "one-native-async-pipeline-at-a-time",
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
    };
  }
  if (application4096PipelineFirstUseControlsEnabled) {
    return {
      testId: APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_TEST,
      diagnosticVariant: APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_VARIANT,
      kind: "application-startup-render-pipeline-first-use-controls",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
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
      expectedPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      injectedPreflightRenderPipelines: 2,
      totalNativeAsyncPipelineInvocations: 54,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      firstUseSequence: [
        "tiny-independent-rgba16float",
        "shared-brush-source-over-clone",
        "original-eraser",
      ],
      capture: "non-overlapping-first-use-controls-and-application-pipeline-durations",
      timingSemantics: "one-native-async-pipeline-at-a-time",
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
    };
  }
  if (application4096CleanQueueCoreEnabled) {
    return {
      testId: APPLICATION_4096_CLEAN_QUEUE_CORE_TEST,
      diagnosticVariant: APPLICATION_4096_CLEAN_QUEUE_CORE_VARIANT,
      kind: "application-startup-clean-queue-core-attribution",
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      requiredFeatures: [],
      textureFormatsTier2Requested: false,
      applicationFrame: "isolated-production-startup",
      startupMode: "empty-document",
      cleanQueueProbeFormat: "rgba16float",
      cleanQueueProbeBlocking: true,
      cleanQueueProbeBeforeApplicationDeviceExposure: true,
      expectedCoreRenderPipelines: EXPECTED_CORE_RENDER_PIPELINES,
      corePipelineObservationMethod: "sync-create-plus-async-duplicate-readiness",
      coreReadinessBoundaryCount: EXPECTED_CORE_RENDER_PIPELINES + 1,
      coreReadinessBarrierBeforeDocumentPipelines: true,
      postCoreBaselineCount: 1,
      pipelineCompilationMethod: "createRenderPipelineAsync",
      pipelineCompilationConcurrency: 1,
      expectedPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
      expectedRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
      expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
      totalNativeAsyncPipelineInvocations:
        EXPECTED_DOCUMENT_RENDER_PIPELINES + EXPECTED_CORE_RENDER_PIPELINES + 3,
      deferredObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
    };
  }
  return {
    testId: APPLICATION_BOOT_TEST,
    diagnosticVariant: APPLICATION_BOOT_VARIANT,
    layerFormat: "rgba16float",
    canvasFormat: "rgba16float",
    textureFormatsTier2Enabled: false,
    inPlaceGlazeCommitEnabled: false,
    inPlaceGlazeCommitPipelineCreated: false,
  };
}

function readSupportedLimits(limits: GPUSupportedLimits): Record<string, number> {
  const names = [
    "maxTextureDimension2D",
    "maxBindGroups",
    "maxStorageBuffersPerShaderStage",
    "maxStorageTexturesPerShaderStage",
    "maxStorageBufferBindingSize",
    "maxBufferSize",
    "maxComputeInvocationsPerWorkgroup",
    "maxComputeWorkgroupSizeX",
  ];
  const source = limits as unknown as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const name of names) {
    try {
      const value = source[name];
      if (typeof value === "number" && Number.isFinite(value)) result[name] = value;
    } catch {
      // Some compatibility implementations expose throwing getters.
    }
  }
  return result;
}

function readAdapterInfo(adapter: GPUAdapter): Record<string, unknown> {
  try {
    const info = adapter.info;
    return {
      vendor: info.vendor || null,
      architecture: info.architecture || null,
      device: info.device || null,
      description: info.description || null,
      isFallbackAdapter:
        "isFallbackAdapter" in adapter
          ? Boolean((adapter as GPUAdapter & { readonly isFallbackAdapter?: boolean }).isFallbackAdapter)
          : null,
    };
  } catch (error) {
    return { readError: describeError(error) };
  }
}

async function captureHighEntropyEnvironment(): Promise<Record<string, unknown>> {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const memory = performance.memory;
  let highEntropyUserAgent: unknown = null;
  try {
    highEntropyUserAgent = await navigator.userAgentData?.getHighEntropyValues?.([
      "architecture",
      "bitness",
      "formFactors",
      "fullVersionList",
      "model",
      "platformVersion",
      "wow64",
    ]) ?? null;
  } catch (error) {
    highEntropyUserAgent = { readError: describeError(error) };
  }

  let webGl: unknown = null;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl") as WebGLRenderingContext | null;
    if (context) {
      const extension = context.getExtension("WEBGL_debug_renderer_info");
      webGl = {
        version: context.getParameter(context.VERSION),
        shadingLanguageVersion: context.getParameter(context.SHADING_LANGUAGE_VERSION),
        vendor: extension
          ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL)
          : context.getParameter(context.VENDOR),
        renderer: extension
          ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
      };
    }
  } catch (error) {
    webGl = { readError: describeError(error) };
  }

  return {
    highEntropyUserAgent,
    webGl,
    jsHeap: memory ? {
      limitMiB: memory.jsHeapSizeLimit / (1024 * 1024),
      totalMiB: memory.totalJSHeapSize / (1024 * 1024),
      usedMiB: memory.usedJSHeapSize / (1024 * 1024),
    } : null,
    navigation: navigation ? {
      type: navigation.type,
      protocol: navigation.nextHopProtocol,
      responseStartMs: navigation.responseStart,
      responseEndMs: navigation.responseEnd,
      domInteractiveMs: navigation.domInteractive,
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      transferSize: navigation.transferSize,
      encodedBodySize: navigation.encodedBodySize,
      decodedBodySize: navigation.decodedBodySize,
    } : null,
  };
}

type StorageProbeFormat = "rgba8unorm" | "rgba16float";
type StorageProbeErrorFilter = "validation" | "internal" | "out-of-memory";

interface StorageProbeStageReport {
  ok: boolean;
  operationElapsedMs: number;
  scopeDrainElapsedMs: number;
  totalElapsedMs: number;
  thrown: unknown;
  scopePushErrors: Partial<Record<StorageProbeErrorFilter, unknown>>;
  scopeErrors: Partial<Record<StorageProbeErrorFilter, unknown>>;
  scopePopErrors: Partial<Record<StorageProbeErrorFilter, unknown>>;
  result: unknown;
  semanticError: string | null;
}

interface StorageProbeStageOutcome<Value> {
  value: Value | null;
  report: StorageProbeStageReport;
}

interface StorageFormatProbeResult {
  format: StorageProbeFormat;
  passed: boolean;
  failedStage: string | null;
  stages: Record<string, StorageProbeStageReport>;
}

function storageCompilationSummary(info: GPUCompilationInfo): Record<string, unknown> {
  const allMessages = [...info.messages];
  const messages = allMessages.slice(0, 16).map((message) => ({
    type: message.type,
    message: message.message.slice(0, 800),
    lineNum: message.lineNum,
    linePos: message.linePos,
    offset: message.offset,
    length: message.length,
  }));
  return {
    errorCount: allMessages.filter((message) => message.type === "error").length,
    warningCount: allMessages.filter((message) => message.type === "warning").length,
    messageCount: allMessages.length,
    messages,
  };
}

async function runScopedStorageOperation<Value>(
  device: GPUDevice,
  label: string,
  operation: () => Value | Promise<Value>,
  summarize: (value: Value) => unknown,
  semanticValidation?: (value: Value) => string | null,
): Promise<StorageProbeStageOutcome<Value>> {
  const startedAt = performance.now();
  const filters: StorageProbeErrorFilter[] = ["out-of-memory", "internal", "validation"];
  const pushedFilters: StorageProbeErrorFilter[] = [];
  const scopePushErrors: Partial<Record<StorageProbeErrorFilter, unknown>> = {};
  const scopeErrors: Partial<Record<StorageProbeErrorFilter, unknown>> = {};
  const scopePopErrors: Partial<Record<StorageProbeErrorFilter, unknown>> = {};
  for (const filter of filters) {
    try {
      device.pushErrorScope(filter);
      pushedFilters.push(filter);
    } catch (error) {
      scopePushErrors[filter] = describeError(error);
    }
  }

  let value: Value | null = null;
  let thrown: unknown = null;
  const operationStartedAt = performance.now();
  try {
    value = await withTimeout(
      Promise.resolve().then(operation),
      60_000,
      `${label} operation`,
    );
  } catch (error) {
    const reason = typeof error === "object"
      && error !== null
      && "reason" in error
      && typeof error.reason === "string"
      ? error.reason
      : null;
    thrown = reason === null
      ? describeError(error)
      : { error: describeError(error), reason };
  }
  const operationElapsedMs = performance.now() - operationStartedAt;

  const scopeDrainStartedAt = performance.now();
  const pendingScopeErrors = pushedFilters.reverse().map((filter) => {
    try {
      return { filter, promise: device.popErrorScope() };
    } catch (error) {
      scopePopErrors[filter] = describeError(error);
      return { filter, promise: null };
    }
  });
  await Promise.all(pendingScopeErrors.map(async ({ filter, promise }) => {
    if (!promise) return;
    try {
      const error = await withTimeout(
        promise,
        15_000,
        `${label} ${filter} error scope`,
      );
      if (error) scopeErrors[filter] = describeError(error);
    } catch (error) {
      scopePopErrors[filter] = describeError(error);
    }
  }));
  const scopeDrainElapsedMs = performance.now() - scopeDrainStartedAt;
  const semanticError = value !== null && semanticValidation
    ? semanticValidation(value)
    : null;
  const requiredScopePushFailed = Object.keys(scopePushErrors).some(
    (filter) => filter !== "internal",
  );
  const ok = thrown === null
    && semanticError === null
    && !requiredScopePushFailed
    && Object.keys(scopeErrors).length === 0
    && Object.keys(scopePopErrors).length === 0;

  return {
    value,
    report: {
      ok,
      operationElapsedMs,
      scopeDrainElapsedMs,
      totalElapsedMs: performance.now() - startedAt,
      thrown,
      scopePushErrors,
      scopeErrors,
      scopePopErrors,
      result: value === null ? null : summarize(value),
      semanticError,
    },
  };
}

async function runStorageProbePhase<Value>(
  device: GPUDevice,
  diagnosticStartedAt: number,
  phase: string,
  label: string,
  format: StorageProbeFormat,
  operation: () => Value | Promise<Value>,
  summarize: (value: Value) => unknown,
  semanticValidation?: (value: Value) => string | null,
): Promise<StorageProbeStageOutcome<Value>> {
  const phaseStartedAt = performance.now();
  await checkpoint("application-startup-phase", {
    phase,
    label,
    state: "started",
    totalElapsedMs: phaseStartedAt - diagnosticStartedAt,
    phaseElapsedMs: 0,
    detail: { format },
  }, "running", "beacon");
  const outcome = await runScopedStorageOperation(
    device,
    label,
    operation,
    summarize,
    semanticValidation,
  );
  await checkpoint("application-startup-phase", {
    phase,
    label,
    state: outcome.report.ok ? "completed" : "failed",
    totalElapsedMs: performance.now() - diagnosticStartedAt,
    phaseElapsedMs: performance.now() - phaseStartedAt,
    detail: {
      format,
      ...outcome.report,
    },
  }, "running", "beacon");
  return outcome;
}

async function runStorageFormatCase(
  device: GPUDevice,
  diagnosticStartedAt: number,
  format: StorageProbeFormat,
  phasePrefix: "rgba8" | "rgba16",
): Promise<StorageFormatProbeResult> {
  const stages: Record<string, StorageProbeStageReport> = {};
  let failedStage: string | null = null;
  let texture: GPUTexture | null = null;

  const runStage = async <Value>(
    key: string,
    label: string,
    operation: () => Value | Promise<Value>,
    summarize: (value: Value) => unknown,
    semanticValidation?: (value: Value) => string | null,
  ): Promise<Value | null> => {
    const outcome = await runStorageProbePhase(
      device,
      diagnosticStartedAt,
      `${phasePrefix}-${key}`,
      label,
      format,
      operation,
      summarize,
      semanticValidation,
    );
    stages[key] = outcome.report;
    if (!outcome.report.ok && failedStage === null) failedStage = key;
    return outcome.value;
  };

  try {
    const shaderModule = await runStage(
      "shader-module",
      `Creating the ${format} storage shader`,
      () => device.createShaderModule({
        label: `diagnostic-${format}-storage-write-shader`,
        code: `
          @group(0) @binding(0) var outputTexture: texture_storage_2d<${format}, write>;
          @compute @workgroup_size(1)
          fn main() {
            textureStore(outputTexture, vec2<i32>(0, 0), vec4<f32>(1.0, 0.25, 0.0, 1.0));
          }
        `,
      }),
      () => ({ created: true }),
    );
    if (!shaderModule || failedStage) {
      return { format, passed: false, failedStage, stages };
    }

    const compilationInfo = await runStage(
      "compilation-info",
      `Reading the ${format} shader diagnostics`,
      async () => {
        if (typeof shaderModule.getCompilationInfo !== "function") {
          return {
            available: false,
            errorCount: 0,
            warningCount: 0,
            messageCount: 0,
            messages: [],
          };
        }
        const info = await withTimeout(
          shaderModule.getCompilationInfo(),
          20_000,
          `${format} shader compilation info`,
        );
        return { available: true, ...storageCompilationSummary(info) };
      },
      (summary) => summary,
      (summary) => {
        return Number(summary.errorCount) > 0
          ? `${format} shader compilation reported errors.`
          : null;
      },
    );
    if (!compilationInfo || failedStage) {
      return { format, passed: false, failedStage, stages };
    }

    const layouts = await runStage(
      "layout",
      `Creating the ${format} storage layout`,
      () => {
        const bindGroupLayout = device.createBindGroupLayout({
          label: `diagnostic-${format}-storage-layout`,
          entries: [{
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
              access: "write-only",
              format,
              viewDimension: "2d",
            },
          }],
        });
        const pipelineLayout = device.createPipelineLayout({
          label: `diagnostic-${format}-pipeline-layout`,
          bindGroupLayouts: [bindGroupLayout],
        });
        return { bindGroupLayout, pipelineLayout };
      },
      () => ({ created: true, access: "write-only", format }),
    );
    if (!layouts || failedStage) {
      return { format, passed: false, failedStage, stages };
    }

    const pipeline = await runStage(
      "pipeline",
      `Compiling the ${format} storage pipeline`,
      () => device.createComputePipelineAsync({
        label: `diagnostic-${format}-storage-write-pipeline`,
        layout: layouts.pipelineLayout,
        compute: { module: shaderModule, entryPoint: "main" },
      }),
      () => ({ created: true }),
    );
    if (!pipeline || failedStage) {
      return { format, passed: false, failedStage, stages };
    }

    const textureResources = await runStage(
      "texture",
      `Creating the 1x1 ${format} storage texture`,
      () => {
        const createdTexture = device.createTexture({
          label: `diagnostic-1x1-${format}-storage-texture`,
          size: [1, 1, 1],
          format,
          usage: GPUTextureUsage.STORAGE_BINDING,
        });
        return { texture: createdTexture, view: createdTexture.createView() };
      },
      () => ({ created: true, width: 1, height: 1, format, usage: ["storage-binding"] }),
    );
    if (!textureResources || failedStage) {
      return { format, passed: false, failedStage, stages };
    }
    texture = textureResources.texture;

    const bindGroup = await runStage(
      "binding",
      `Binding the ${format} storage texture`,
      () => device.createBindGroup({
        label: `diagnostic-${format}-storage-bind-group`,
        layout: layouts.bindGroupLayout,
        entries: [{ binding: 0, resource: textureResources.view }],
      }),
      () => ({ created: true }),
    );
    if (!bindGroup || failedStage) {
      return { format, passed: false, failedStage, stages };
    }

    await runStage(
      "dispatch",
      `Encoding and submitting the ${format} storage write`,
      () => {
        const encoder = device.createCommandEncoder({
          label: `diagnostic-${format}-storage-write-encoder`,
        });
        const pass = encoder.beginComputePass({
          label: `diagnostic-${format}-storage-write-pass`,
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1, 1, 1);
        pass.end();
        device.queue.submit([encoder.finish()]);
        return true;
      },
      () => ({ submitted: true, workgroups: [1, 1, 1] }),
    );
    if (failedStage) {
      return { format, passed: false, failedStage, stages };
    }
    await runStage(
      "fence",
      `Waiting for the ${format} storage write`,
      () => withTimeout(
        device.queue.onSubmittedWorkDone(),
        30_000,
        `${format} storage queue fence`,
      ),
      () => ({ completed: true }),
    );
    return { format, passed: failedStage === null, failedStage, stages };
  } finally {
    texture?.destroy();
  }
}

function storageProbeErrorText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 1_000);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("error" in record) {
      const nested = storageProbeErrorText(record.error);
      const reason = typeof record.reason === "string" ? `reason=${record.reason}; ` : "";
      return `${reason}${nested ?? "unknown error"}`.slice(0, 1_000);
    }
    const name = typeof record.name === "string" ? record.name : "Error";
    const message = typeof record.message === "string" ? record.message : null;
    if (message) return `${name}: ${message}`.slice(0, 1_000);
  }
  try {
    return JSON.stringify(value).slice(0, 1_000);
  } catch {
    return String(value).slice(0, 1_000);
  }
}

function storageCompilationResultSummary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || !("messageCount" in value)) return null;
  return {
    available: "available" in value ? value.available : true,
    errorCount: "errorCount" in value ? value.errorCount : null,
    warningCount: "warningCount" in value ? value.warningCount : null,
    messageCount: value.messageCount,
    firstMessages: "messages" in value && Array.isArray(value.messages)
      ? value.messages.slice(0, 3).map((message) => {
          if (!message || typeof message !== "object") return String(message).slice(0, 320);
          const type = "type" in message ? String(message.type) : "unknown";
          const lineNum = "lineNum" in message ? String(message.lineNum) : "?";
          const linePos = "linePos" in message ? String(message.linePos) : "?";
          const text = "message" in message && typeof message.message === "string"
            ? message.message
            : "";
          return `${type} ${lineNum}:${linePos} ${text}`.slice(0, 320);
        })
      : [],
  };
}

function storageFormatResultSummary(result: StorageFormatProbeResult): Record<string, unknown> {
  const failedReport = result.failedStage ? result.stages[result.failedStage] : null;
  const stageNames = Object.keys(result.stages);
  const failedResult = failedReport?.result;
  const compilation = storageCompilationResultSummary(
    result.stages["compilation-info"]?.result,
  );
  const scopeErrorText = (
    errors: Partial<Record<StorageProbeErrorFilter, unknown>>,
  ): Partial<Record<StorageProbeErrorFilter, string | null>> => Object.fromEntries(
    Object.entries(errors).map(([filter, error]) => [filter, storageProbeErrorText(error)]),
  );
  const pipelineReason = failedReport?.thrown
    && typeof failedReport.thrown === "object"
    && "reason" in failedReport.thrown
    && typeof failedReport.thrown.reason === "string"
    ? failedReport.thrown.reason
    : null;
  return {
    format: result.format,
    outcome: result.passed ? "passed" : "failed",
    passed: result.passed,
    failedStage: result.failedStage,
    lastStage: stageNames.at(-1) ?? null,
    internalErrorScopeSupported: stageNames.length > 0
      ? stageNames.every(
          (stage) => !Object.hasOwn(result.stages[stage]?.scopePushErrors ?? {}, "internal"),
        )
      : null,
    compilation,
    durationMs: stageNames.reduce(
      (total, stage) => total + (result.stages[stage]?.totalElapsedMs ?? 0),
      0,
    ),
    timingsMs: Object.fromEntries(stageNames.map((stage) => [
      stage,
      [
        Math.round((result.stages[stage]?.operationElapsedMs ?? 0) * 10) / 10,
        Math.round((result.stages[stage]?.scopeDrainElapsedMs ?? 0) * 10) / 10,
      ],
    ])),
    failure: failedReport ? {
      thrown: storageProbeErrorText(failedReport.thrown),
      pipelineReason,
      semanticError: failedReport.semanticError,
      scopePushErrors: scopeErrorText(failedReport.scopePushErrors),
      scopeErrors: scopeErrorText(failedReport.scopeErrors),
      scopePopErrors: scopeErrorText(failedReport.scopePopErrors),
      result: result.failedStage === "compilation-info" ? compilation : failedResult,
    } : null,
  };
}

function storageFormatResultTimedOut(result: StorageFormatProbeResult): boolean {
  if (!result.failedStage) return false;
  const failedReport = result.stages[result.failedStage];
  if (!failedReport) return false;
  try {
    return JSON.stringify({
      thrown: failedReport.thrown,
      scopePopErrors: failedReport.scopePopErrors,
    }).includes("timed out after");
  } catch {
    return false;
  }
}

function markStorageFormatAsyncFailure(
  result: StorageFormatProbeResult,
  stage: "uncaptured-error" | "device-lost",
): void {
  if (!result.passed) return;
  result.passed = false;
  result.failedStage = stage;
}

async function runStorageFormatAbDiagnostic(): Promise<void> {
  const diagnosticStartedAt = performance.now();
  await checkpoint("storage-format-ab-started", {
    ...comparisonPolicy(),
    navigatorGpuPresent: Boolean(navigator.gpu),
    secureContext: window.isSecureContext,
  }, "running", "beacon");
  if (!navigator.gpu) throw new Error("navigator.gpu is not available.");

  const adapterPhaseStartedAt = performance.now();
  await checkpoint("application-startup-phase", {
    phase: "adapter-request",
    label: "Finding a WebGPU adapter",
    state: "started",
    totalElapsedMs: adapterPhaseStartedAt - diagnosticStartedAt,
    phaseElapsedMs: 0,
  }, "running", "beacon");
  const android = /\bAndroid\b/i.test(navigator.userAgent);
  const adapterOptions: GPURequestAdapterOptions | undefined =
    /\bWindows\b/i.test(navigator.userAgent) || android
      ? undefined
      : { powerPreference: "high-performance" };
  let adapter: GPUAdapter | null = null;
  let primaryAdapterError: unknown = null;
  try {
    adapter = await withTimeout(
      navigator.gpu.requestAdapter(adapterOptions),
      20_000,
      "Storage comparison adapter request",
    );
  } catch (error) {
    primaryAdapterError = error;
    await checkpoint("storage-format-adapter-primary-error", {
      error: describeError(error),
    }, "running", "beacon");
  }
  let adapterMode = adapter ? (adapterOptions ? "high-performance" : "neutral") : "none";
  if (!adapter && adapterOptions !== undefined) {
    try {
      adapter = await withTimeout(
        navigator.gpu.requestAdapter(),
        20_000,
        "Storage comparison neutral adapter request",
      );
      if (adapter) adapterMode = "neutral";
    } catch (error) {
      await checkpoint("storage-format-adapter-neutral-error", {
        error: describeError(error),
      }, "running", "beacon");
    }
  }
  if (!adapter && android) {
    try {
      adapter = await withTimeout(
        navigator.gpu.requestAdapter({
          featureLevel: "compatibility",
        } as GPURequestAdapterOptions & { featureLevel: "compatibility" }),
        20_000,
        "Storage comparison compatibility adapter request",
      );
      if (adapter) adapterMode = "compatibility";
    } catch (error) {
      await checkpoint("storage-format-adapter-compatibility-error", {
        error: describeError(error),
      }, "running", "beacon");
    }
  }
  if (!adapter) {
    throw new Error(
      primaryAdapterError
        ? `No compatible WebGPU adapter was found. Primary error: ${String((primaryAdapterError as Error).message ?? primaryAdapterError)}`
        : "No compatible WebGPU adapter was found.",
    );
  }
  const textureFormatsTier2Advertised = adapter.features.has(
    "texture-formats-tier2" as GPUFeatureName,
  );
  await checkpoint("application-startup-phase", {
    phase: "adapter-request",
    label: "Finding a WebGPU adapter",
    state: "completed",
    totalElapsedMs: performance.now() - diagnosticStartedAt,
    phaseElapsedMs: performance.now() - adapterPhaseStartedAt,
    detail: {
      mode: adapterMode,
      info: readAdapterInfo(adapter),
      features: [...adapter.features].map(String).sort().slice(0, 32),
      limits: readSupportedLimits(adapter.limits),
      textureFormatsTier2Advertised,
    },
  }, "running", "beacon");

  const requiredFeatures: GPUFeatureName[] = [];
  const devicePhaseStartedAt = performance.now();
  await checkpoint("application-startup-phase", {
    phase: "device-request",
    label: "Creating a feature-neutral WebGPU device",
    state: "started",
    totalElapsedMs: devicePhaseStartedAt - diagnosticStartedAt,
    phaseElapsedMs: 0,
    detail: { requiredFeatures },
  }, "running", "beacon");
  const deviceRequest = adapter.requestDevice({ requiredFeatures });
  let device: GPUDevice;
  try {
    device = await withTimeout(deviceRequest, 20_000, "Storage comparison device request");
  } catch (error) {
    void deviceRequest.then((lateDevice) => lateDevice.destroy()).catch(() => undefined);
    throw error;
  }
  const textureFormatsTier2Enabled = device.features.has(
    "texture-formats-tier2" as GPUFeatureName,
  );
  await checkpoint("application-startup-phase", {
    phase: "device-request",
    label: "Creating a feature-neutral WebGPU device",
    state: "completed",
    totalElapsedMs: performance.now() - diagnosticStartedAt,
    phaseElapsedMs: performance.now() - devicePhaseStartedAt,
    detail: {
      requiredFeatures,
      enabledFeatures: [...device.features].map(String).sort(),
      textureFormatsTier2Enabled,
      limits: readSupportedLimits(device.limits),
    },
  }, "running", "beacon");
  if (textureFormatsTier2Enabled) {
    device.destroy();
    throw new Error("The feature-neutral device unexpectedly enabled texture-formats-tier2.");
  }

  const uncapturedErrors: unknown[] = [];
  let deviceLostInfo: Record<string, unknown> | null = null;
  let intentionalDestroy = false;
  device.addEventListener("uncapturederror", (event) => {
    const detail = {
      elapsedMs: performance.now() - diagnosticStartedAt,
      error: describeError(event.error),
    };
    uncapturedErrors.push(detail);
    if (uncapturedErrors.length > 12) uncapturedErrors.shift();
    void checkpoint("storage-format-uncaptured-error", detail, "running", "beacon");
  });
  void device.lost.then((info) => {
    if (intentionalDestroy) return;
    deviceLostInfo = {
      elapsedMs: performance.now() - diagnosticStartedAt,
      reason: info.reason,
      message: info.message,
    };
    void checkpoint("storage-format-device-lost", deviceLostInfo, "running", "beacon");
  });

  try {
    const controlErrorStart = uncapturedErrors.length;
    const control = await runStorageFormatCase(
      device,
      diagnosticStartedAt,
      "rgba8unorm",
      "rgba8",
    );
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    if (deviceLostInfo) markStorageFormatAsyncFailure(control, "device-lost");
    if (uncapturedErrors.length > controlErrorStart) {
      markStorageFormatAsyncFailure(control, "uncaptured-error");
    }
    const controlTimedOut = storageFormatResultTimedOut(control);
    const controlSummary = storageFormatResultSummary(control);
    await checkpoint("storage-format-control-completed", controlSummary, "running", "beacon");

    const targetErrorStart = uncapturedErrors.length;
    const target: StorageFormatProbeResult = deviceLostInfo || controlTimedOut
      ? {
          format: "rgba16float" as const,
          passed: false,
          failedStage: deviceLostInfo ? "device-lost" : "control-timeout",
          stages: {},
        }
      : await runStorageFormatCase(
          device,
          diagnosticStartedAt,
          "rgba16float",
          "rgba16",
        );
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    if (deviceLostInfo) markStorageFormatAsyncFailure(target, "device-lost");
    if (uncapturedErrors.length > targetErrorStart) {
      markStorageFormatAsyncFailure(target, "uncaptured-error");
    }
    const targetSummary = storageFormatResultSummary(target);
    await checkpoint("storage-format-target-completed", targetSummary, "running", "beacon");

    let verdict: string;
    let conclusion: string;
    if (deviceLostInfo) {
      verdict = "device-lost";
      conclusion = "The WebGPU device was lost during the storage-format comparison.";
    } else if (controlTimedOut) {
      verdict = "control-timeout";
      conclusion = "The RGBA8 control timed out; the device was not reused for the RGBA16F target.";
    } else if (uncapturedErrors.length > 0) {
      verdict = "uncaptured-error";
      conclusion = "The storage-format comparison produced an uncaptured WebGPU error.";
    } else if (control.passed && target.passed) {
      verdict = "both-formats-passed";
      conclusion = "Both RGBA8 and RGBA16F storage-write paths passed.";
    } else if (control.passed) {
      verdict = "rgba16float-specific-failure";
      conclusion = `RGBA8 passed; RGBA16F failed at ${String(target.failedStage)}.`;
    } else if (target.passed) {
      verdict = "rgba8-control-anomaly";
      conclusion = "RGBA8 failed while RGBA16F passed; the control result is anomalous.";
    } else {
      verdict = "shared-storage-path-failure";
      conclusion = "Both RGBA8 and RGBA16F storage-write paths failed.";
    }
    await checkpoint("environment-captured-after-storage-format-ab", await captureHighEntropyEnvironment());
    const diagnosticCompleted = control.passed
      && deviceLostInfo === null
      && uncapturedErrors.length === 0;
    const compactUncapturedErrors = uncapturedErrors.slice(0, 3).map((entry) => {
      if (!entry || typeof entry !== "object") {
        return { elapsedMs: null, error: storageProbeErrorText(entry) };
      }
      return {
        elapsedMs: "elapsedMs" in entry && Number.isFinite(entry.elapsedMs)
          ? entry.elapsedMs
          : null,
        error: "error" in entry ? storageProbeErrorText(entry.error) : storageProbeErrorText(entry),
      };
    });
    await bridge.finish(
      diagnosticCompleted ? "completed" : "failed",
      diagnosticCompleted ? "diagnostic-completed" : "diagnostic-failed",
      {
        conclusion,
        verdict,
        evidence: "format-acceptance-submit-fence-no-readback",
        adapter: {
          mode: adapterMode,
          textureFormatsTier2Advertised,
          info: readAdapterInfo(adapter),
        },
        device: {
          requiredFeatures,
          textureFormatsTier2Enabled,
          uncapturedErrorCount: uncapturedErrors.length,
          lost: deviceLostInfo,
        },
        control: controlSummary,
        target: targetSummary,
        uncapturedErrors: compactUncapturedErrors,
        uncapturedErrorsTruncated: uncapturedErrors.length > compactUncapturedErrors.length,
        totalElapsedMs: performance.now() - diagnosticStartedAt,
      },
    );
  } finally {
    intentionalDestroy = true;
    device.destroy();
  }
}

async function validationCheck(
  device: GPUDevice,
  name: string,
  operation: () => void | Promise<void>,
): Promise<boolean> {
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  let thrown: unknown = null;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  const validationError = await device.popErrorScope();
  const outOfMemoryError = await device.popErrorScope();
  const ok = !thrown && !validationError && !outOfMemoryError;
  await checkpoint(name, {
    ok,
    thrown: describeError(thrown),
    validationError: describeError(validationError),
    outOfMemoryError: describeError(outOfMemoryError),
  });
  if (!ok) {
    throw new Error(`${name} failed WebGPU validation or memory checks.`);
  }
  return ok;
}

async function runDirectWebGpuProbe(): Promise<void> {
  await checkpoint("webgpu-presence-check", {
    navigatorGpuPresent: Boolean(navigator.gpu),
    secureContext: window.isSecureContext,
  }, "running", "beacon");
  if (!navigator.gpu) {
    throw new Error("navigator.gpu is not available.");
  }

  const isAndroid = /\bAndroid\b/i.test(navigator.userAgent);
  const adapterOptions: GPURequestAdapterOptions | undefined =
    /\bWindows\b/i.test(navigator.userAgent) || isAndroid
      ? undefined
      : { powerPreference: "high-performance" };
  await checkpoint("adapter-request-started", {
    strategy: adapterOptions ? "high-performance" : "neutral",
  }, "running", "beacon");

  let adapter: GPUAdapter | null = null;
  let primaryError: unknown = null;
  try {
    adapter = await withTimeout(
      navigator.gpu.requestAdapter(adapterOptions),
      20_000,
      "Primary adapter request",
    );
  } catch (error) {
    primaryError = error;
    await checkpoint("adapter-primary-error", { error: describeError(error) }, "running", "beacon");
  }

  if (primaryError instanceof Error && primaryError.message.includes("timed out after")) {
    throw primaryError;
  }

  let adapterMode = adapter ? (adapterOptions ? "high-performance" : "neutral") : "none";
  if (!adapter && adapterOptions !== undefined) {
    await checkpoint("adapter-neutral-retry-started", null, "running", "beacon");
    adapter = await withTimeout(
      navigator.gpu.requestAdapter(),
      20_000,
      "Neutral adapter request",
    );
    if (adapter) adapterMode = "neutral";
  }
  if (!adapter && isAndroid) {
    await checkpoint("adapter-compatibility-retry-started", null, "running", "beacon");
    try {
      adapter = await withTimeout(
        navigator.gpu.requestAdapter({
          featureLevel: "compatibility",
        } as GPURequestAdapterOptions & { featureLevel: "compatibility" }),
        20_000,
        "Compatibility adapter request",
      );
      if (adapter) adapterMode = "compatibility";
    } catch (error) {
      await checkpoint("adapter-compatibility-error", { error: describeError(error) }, "running", "beacon");
    }
  }
  if (!adapter) {
    throw new Error(
      primaryError
        ? `No compatible adapter was found. Primary error: ${String((primaryError as Error).message ?? primaryError)}`
        : "No compatible adapter was found.",
    );
  }

  const adapterFeatures = [...adapter.features].map(String).sort();
  const adapterLimits = readSupportedLimits(adapter.limits);
  const wgslLanguageFeatures = navigator.gpu.wgslLanguageFeatures
    ? [...navigator.gpu.wgslLanguageFeatures].map(String).sort()
    : [];
  await checkpoint("adapter-acquired", {
    mode: adapterMode,
    info: readAdapterInfo(adapter),
    featureCount: adapterFeatures.length,
    features: adapterFeatures.slice(0, 24),
    limits: adapterLimits,
    wgslLanguageFeatures: wgslLanguageFeatures.slice(0, 24),
  });
  if ((adapterLimits.maxTextureDimension2D ?? 0) < DIAGNOSTIC_DOCUMENT_WIDTH) {
    throw new Error(
      `The adapter texture limit is below ${DIAGNOSTIC_DOCUMENT_WIDTH}px.`,
    );
  }

  const textureFormatsTier2 = "texture-formats-tier2" as GPUFeatureName;
  const needsTextureFormatsTier2 = wgslLanguageFeatures.includes(
    "readonly_and_readwrite_storage_textures",
  ) && adapter.features.has(textureFormatsTier2);
  const requiredFeatures: GPUFeatureName[] = needsTextureFormatsTier2
    ? [textureFormatsTier2]
    : [];
  await checkpoint("device-request-started", {
    requiredFeatures,
    probeVariant: "advertised-tier2-baseline",
    textureFormatsTier2Requested: needsTextureFormatsTier2,
  }, "running", "beacon");
  const deviceRequest = adapter.requestDevice({ requiredFeatures });
  let device: GPUDevice;
  try {
    device = await withTimeout(
      deviceRequest,
      20_000,
      "WebGPU device request",
    );
  } catch (error) {
    // Promise.race cannot cancel requestDevice(). If an implementation resolves
    // after our deadline, release that device instead of leaking it in the lab.
    void deviceRequest.then((lateDevice) => lateDevice.destroy()).catch(() => undefined);
    throw error;
  }
  let intentionalDestroy = false;
  device.addEventListener("uncapturederror", (event) => {
    void checkpoint("device-uncaptured-error", {
      error: describeError(event.error),
    }, "failed", "beacon");
  });
  void device.lost.then((info) => {
    if (intentionalDestroy) return;
    void checkpoint("probe-device-lost", {
      reason: info.reason,
      message: info.message,
    }, "failed", "beacon");
  });
  await checkpoint("device-acquired", {
    features: [...device.features].map(String).sort().slice(0, 24),
    limits: readSupportedLimits(device.limits),
    probeVariant: "advertised-tier2-baseline",
    textureFormatsTier2Requested: needsTextureFormatsTier2,
  });

  let probeTexture: GPUTexture | null = null;
  let context: GPUCanvasContext | null = null;
  try {
    const probeCanvas = document.getElementById("gpuDiagnosticProbeCanvas") as HTMLCanvasElement | null;
    if (!probeCanvas) throw new Error("The probe canvas is missing.");
    context = probeCanvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("Could not obtain a GPUCanvasContext.");
    const configuredContext = context;

  await checkpoint("rgba16float-canvas-configure-started", {
    width: probeCanvas.width,
    height: probeCanvas.height,
    usage: ["render-attachment", "copy-dst"],
  }, "running", "beacon");
  configuredContext.configure({
    device,
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    alphaMode: "opaque",
    colorSpace: "srgb",
  });

  await validationCheck(device, "rgba16float-canvas-presented", async () => {
    const encoder = device.createCommandEncoder({ label: "diagnostic-rgba16float-canvas" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: configuredContext.getCurrentTexture().createView(),
        clearValue: { r: 1, g: 0.2, b: 0.02, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    await withTimeout(device.queue.onSubmittedWorkDone(), 15_000, "RGBA16F canvas submission");
  });

  await validationCheck(device, "rgba16float-combined-usage-texture", () => {
    probeTexture = device.createTexture({
      label: "diagnostic-2048-rgba16float-combined-usage",
      size: [DIAGNOSTIC_DOCUMENT_WIDTH, DIAGNOSTIC_DOCUMENT_HEIGHT, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
  });

  if (probeTexture) {
    await validationCheck(device, "rgba16float-document-texture-cleared", async () => {
      const encoder = device.createCommandEncoder({ label: "diagnostic-2048-rgba16float-clear" });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: probeTexture!.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
      await withTimeout(device.queue.onSubmittedWorkDone(), 20_000, "2048 RGBA16F document clear");
    });

    await validationCheck(device, "rgba16float-storage-write-pipeline", async () => {
      const module = device.createShaderModule({
        label: "diagnostic-rgba16float-storage-write",
        code: `
          @group(0) @binding(0) var outputTexture: texture_storage_2d<rgba16float, write>;
          @compute @workgroup_size(1)
          fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            textureStore(outputTexture, vec2<i32>(id.xy), vec4<f32>(1.0, 0.25, 0.0, 1.0));
          }
        `,
      });
      const pipeline = await device.createComputePipelineAsync({
        label: "diagnostic-rgba16float-storage-write",
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: probeTexture!.createView() }],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1, 1, 1);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await withTimeout(device.queue.onSubmittedWorkDone(), 15_000, "RGBA16F storage submission");
    });
  }

  await validationCheck(device, "vertex-stage-storage-buffer-layout", () => {
    device.createBindGroupLayout({
      label: "diagnostic-vertex-storage-layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      }],
    });
  });

  await validationCheck(device, "compute-workgroup-256-pipeline", async () => {
    const module = device.createShaderModule({
      label: "diagnostic-workgroup-256",
      code: "@compute @workgroup_size(256) fn main() {}",
    });
    await device.createComputePipelineAsync({
      label: "diagnostic-workgroup-256",
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  });

  } finally {
    (probeTexture as GPUTexture | null)?.destroy();
    context?.unconfigure();
    intentionalDestroy = true;
    device.destroy();
  }
  await checkpoint("direct-webgpu-probe-completed", {
    probeVariant: "advertised-tier2-baseline",
    textureFormatsTier2Requested: needsTextureFormatsTier2,
    adapterMode,
    rgba16floatCanvasConfigured: true,
    documentTexture: {
      width: DIAGNOSTIC_DOCUMENT_WIDTH,
      height: DIAGNOSTIC_DOCUMENT_HEIGHT,
      format: "rgba16float",
      bytes: DIAGNOSTIC_DOCUMENT_WIDTH
        * DIAGNOSTIC_DOCUMENT_HEIGHT
        * RGBA16FLOAT_BYTES_PER_PIXEL,
      mebibytes: DIAGNOSTIC_DOCUMENT_WIDTH
        * DIAGNOSTIC_DOCUMENT_HEIGHT
        * RGBA16FLOAT_BYTES_PER_PIXEL
        / (1024 * 1024),
    },
  });
  await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
}

function frameState(frame: HTMLIFrameElement): Record<string, unknown> {
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  if (!frameWindow || !frameDocument) {
    return { accessible: false };
  }
  const status = frameDocument.getElementById("status");
  const canvas = frameDocument.getElementById("gpuCanvas") as HTMLCanvasElement | null;
  const app = frameDocument.getElementById("app") as HTMLElement | null;
  const homeButton = frameDocument.getElementById("projectHomeButton") as HTMLButtonElement | null;
  const fps = frameDocument.getElementById("fpsStat");
  const gpu = frameDocument.getElementById("gpuStat");
  return {
    accessible: true,
    readyState: frameDocument.readyState,
    title: frameDocument.title.slice(0, 160),
    statusText: status?.textContent?.trim().slice(0, 1000) ?? null,
    statusClass: status?.className.slice(0, 240) ?? null,
    appHidden: app?.hidden ?? null,
    projectSessionReady: homeButton ? !homeButton.disabled : false,
    runtimeStatsStarted: Boolean(
      fps && fps.textContent?.trim() && fps.textContent.trim() !== "—",
    ),
    fpsText: fps?.textContent?.trim().slice(0, 40) ?? null,
    gpuText: gpu?.textContent?.trim().slice(0, 240) ?? null,
    canvas: canvas ? {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
    } : null,
  };
}

function compactFrameResourceSummary(frame: HTMLIFrameElement): Record<string, unknown> {
  const entries = frame.contentWindow?.performance.getEntriesByType("resource") ?? [];
  const failed = entries.filter((entry) => {
    const timing = entry as PerformanceResourceTiming & { readonly responseStatus?: number };
    return typeof timing.responseStatus === "number" && timing.responseStatus >= 400;
  });
  return {
    resourceCount: entries.length,
    failedResources: failed.slice(0, 12).map((entry) => {
      try {
        const url = new URL(entry.name);
        return url.pathname.split("/").pop() || url.pathname;
      } catch {
        return "unreadable-resource";
      }
    }),
  };
}

const APP_FRAME_DIAGNOSTIC_CHANNEL = "gpu-startup-app-frame-v3";
const APPLICATION_DOCUMENT_LOAD_TIMEOUT_MS = 3 * 60_000;
const APPLICATION_BOOT_TIMEOUT_MS = 10 * 60_000;

interface DocumentPipelineTraceState {
  instrumentationInstalled: boolean | null;
  adapterRequestDevicePatched: boolean | null;
  adapterPatchCount: number;
  devicePatchCount: number;
  pipelineLayoutPatched: boolean | null;
  renderPipelinePatched: boolean | null;
  renderPipelineMethod: string | null;
  popErrorScopePatched: boolean | null;
  requiredFeatures: unknown[] | null;
  textureFormatsTier2Enabled: boolean | null;
  phaseState: string | null;
  startedCallCount: number;
  completedCallCount: number;
  failedCallCount: number;
  scopeErrorCount: number;
  pipelineLayoutStartedCount: number;
  pipelineLayoutCompletedCount: number;
  renderPipelineStartedCount: number;
  renderPipelineCompletedCount: number;
  popErrorScopeStartedCount: number;
  popErrorScopeCompletedCount: number;
  deviceLost: unknown;
  uncapturedError: unknown;
  lastStartedCall: Record<string, unknown> | null;
  lastCompletedCall: Record<string, unknown> | null;
  lastFailedCall: Record<string, unknown> | null;
  lastScopeError: Record<string, unknown> | null;
  slowestCompletedRenderPipeline: Record<string, unknown> | null;
  engineProbe: Record<string, unknown> | null;
  firstUseSequenceStarted: boolean;
  firstUseSequenceCompleted: boolean;
  firstUseSequenceFailed: boolean;
  firstUseSequenceError: unknown;
  firstUseSequenceSteps: Array<Record<string, unknown>>;
  cleanQueueProbe: Record<string, unknown> | null;
  coreReadinessSequenceStarted: boolean;
  coreReadinessSequenceCompleted: boolean;
  coreReadinessSequenceFailed: boolean;
  coreReadinessBarrierState: string | null;
  coreReadinessEntries: Array<Record<string, unknown>>;
  coreReadinessSummary: Record<string, unknown> | null;
  postCoreBaseline: Record<string, unknown> | null;
  calls: Array<Record<string, unknown>>;
}

interface ApplicationBootOptions {
  readonly diagnosticVariant?: string;
  readonly diagnosticTestId?: string;
  readonly documentPipelineTrace?: DocumentPipelineTraceState;
  readonly documentWidth?: number;
  readonly documentHeight?: number;
  readonly requiredStartupPhases?: readonly string[];
  readonly requireStorageSummary?: boolean;
  readonly requireGpuObservation?: boolean;
  readonly startupTrace?: ApplicationStartupTraceState;
}

interface ApplicationStartupTraceState {
  lastProgress: Record<string, unknown> | null;
  readonly phaseStates: Record<string, string>;
  readonly phaseProgress: Record<string, Record<string, unknown>>;
  deviceLost: unknown;
  uncapturedError: unknown;
  observationInstalled: boolean | null;
  requestDeviceObserved: boolean | null;
  adapterCount: number;
  deviceCount: number;
  requiredFeatures: unknown[] | null;
  textureFormatsTier2Enabled: boolean | null;
}

interface ApplicationEngineReportExpectations {
  readonly diagnosticVariant: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly requireStorageSummary: boolean;
}

function createApplicationStartupTraceState(): ApplicationStartupTraceState {
  return {
    lastProgress: null,
    phaseStates: {},
    phaseProgress: {},
    deviceLost: null,
    uncapturedError: null,
    observationInstalled: null,
    requestDeviceObserved: null,
    adapterCount: 0,
    deviceCount: 0,
    requiredFeatures: null,
    textureFormatsTier2Enabled: null,
  };
}

function applicationGpuObservationPassed(trace: ApplicationStartupTraceState): boolean {
  return trace.observationInstalled === true
    && trace.requestDeviceObserved === true
    && trace.adapterCount === 1
    && trace.deviceCount === 1
    && Array.isArray(trace.requiredFeatures)
    && trace.requiredFeatures.length === 0
    && trace.textureFormatsTier2Enabled === false
    && trace.deviceLost === null
    && trace.uncapturedError === null;
}

function createDocumentPipelineTraceState(): DocumentPipelineTraceState {
  return {
    instrumentationInstalled: null,
    adapterRequestDevicePatched: null,
    adapterPatchCount: 0,
    devicePatchCount: 0,
    pipelineLayoutPatched: null,
    renderPipelinePatched: null,
    renderPipelineMethod: null,
    popErrorScopePatched: null,
    requiredFeatures: null,
    textureFormatsTier2Enabled: null,
    phaseState: null,
    startedCallCount: 0,
    completedCallCount: 0,
    failedCallCount: 0,
    scopeErrorCount: 0,
    pipelineLayoutStartedCount: 0,
    pipelineLayoutCompletedCount: 0,
    renderPipelineStartedCount: 0,
    renderPipelineCompletedCount: 0,
    popErrorScopeStartedCount: 0,
    popErrorScopeCompletedCount: 0,
    deviceLost: null,
    uncapturedError: null,
    lastStartedCall: null,
    lastCompletedCall: null,
    lastFailedCall: null,
    lastScopeError: null,
    slowestCompletedRenderPipeline: null,
    engineProbe: null,
    firstUseSequenceStarted: false,
    firstUseSequenceCompleted: false,
    firstUseSequenceFailed: false,
    firstUseSequenceError: null,
    firstUseSequenceSteps: [],
    cleanQueueProbe: null,
    coreReadinessSequenceStarted: false,
    coreReadinessSequenceCompleted: false,
    coreReadinessSequenceFailed: false,
    coreReadinessBarrierState: null,
    coreReadinessEntries: [],
    coreReadinessSummary: null,
    postCoreBaseline: null,
    calls: [],
  };
}

function compactDocumentPipelineError(value: unknown): unknown {
  if (!isRecord(value)) {
    return typeof value === "string" ? value.slice(0, 600) : value ?? null;
  }
  return {
    name: typeof value.name === "string" ? value.name.slice(0, 120) : null,
    message: typeof value.message === "string" ? value.message.slice(0, 600) : null,
  };
}

function compactDocumentPipelineGpuEvent(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  return {
    source: detail.source ?? null,
    reason: detail.reason ?? null,
    message: detail.message ?? null,
    activePhase: detail.activePhase ?? null,
    phaseState: detail.phaseState ?? null,
    duringTargetPhase: detail.duringTargetPhase === true,
    currentCall: isRecord(detail.currentCall)
      ? traceCallDetail(detail.currentCall, "active")
      : null,
    lastCompletedRenderPipeline: detail.lastCompletedRenderPipeline ?? null,
    error: compactDocumentPipelineError(detail.error),
  };
}

function traceCallDetail(detail: Record<string, unknown>, state: string): Record<string, unknown> {
  return {
    callIndex: detail.callIndex ?? null,
    method: detail.method ?? null,
    pipelineLayoutIndex: detail.pipelineLayoutIndex ?? null,
    renderPipelineIndex: detail.renderPipelineIndex ?? null,
    errorScopeDrainIndex: detail.errorScopeDrainIndex ?? null,
    label: detail.label ?? null,
    vertexEntryPoint: detail.vertexEntryPoint ?? null,
    fragmentEntryPoint: detail.fragmentEntryPoint ?? null,
    targetFormats: Array.isArray(detail.targetFormats) ? detail.targetFormats.slice(0, 4) : [],
    topology: detail.topology ?? null,
    durationMs: detail.durationMs ?? null,
    instrumentationPreparationMs: detail.instrumentationPreparationMs ?? null,
    pipelineReason: detail.pipelineReason ?? null,
    error: compactDocumentPipelineError(detail.error),
    scopeError: compactDocumentPipelineError(detail.scopeError),
    state,
  };
}

function traceFirstUseSequenceStep(
  detail: Record<string, unknown>,
  state: string,
): Record<string, unknown> {
  return {
    sequenceId: detail.sequenceId ?? null,
    sequenceStepIndex: detail.sequenceStepIndex ?? null,
    stepKey: detail.stepKey ?? null,
    label: detail.label ?? null,
    ordinaryRenderPipelineIndex: detail.ordinaryRenderPipelineIndex ?? null,
    vertexEntryPoint: detail.vertexEntryPoint ?? null,
    fragmentEntryPoint: detail.fragmentEntryPoint ?? null,
    targetFormats: Array.isArray(detail.targetFormats) ? detail.targetFormats.slice(0, 4) : [],
    topology: detail.topology ?? null,
    shaderModuleCreationMs: finiteDurationMilliseconds(detail.shaderModuleCreationMs),
    descriptorPreparationMs: finiteDurationMilliseconds(detail.descriptorPreparationMs),
    nativePipelineMs: finiteDurationMilliseconds(detail.nativePipelineMs ?? detail.durationMs),
    durationMs: finiteDurationMilliseconds(detail.durationMs ?? detail.totalStepMs),
    instrumentationPreparationMs: finiteDurationMilliseconds(
      detail.instrumentationPreparationMs,
    ),
    error: compactDocumentPipelineError(detail.error),
    pipelineReason: detail.pipelineReason ?? null,
    state,
  };
}

function updateFirstUseSequenceTrace(
  trace: DocumentPipelineTraceState,
  type: string,
  detail: Record<string, unknown>,
): boolean {
  if (type === "document-pipeline-first-use-sequence-started") {
    trace.firstUseSequenceStarted = true;
    return true;
  }
  if (type === "document-pipeline-first-use-sequence-completed") {
    trace.firstUseSequenceCompleted = true;
    return true;
  }
  if (type === "document-pipeline-first-use-sequence-failed") {
    trace.firstUseSequenceFailed = true;
    trace.firstUseSequenceError = compactDocumentPipelineError(detail.error);
    return true;
  }
  if (
    type !== "document-pipeline-first-use-step-started"
    && type !== "document-pipeline-first-use-step-completed"
    && type !== "document-pipeline-first-use-step-failed"
  ) {
    return false;
  }
  const state = type === "document-pipeline-first-use-step-started"
    ? "started"
    : type === "document-pipeline-first-use-step-completed"
      ? "completed"
      : "failed";
  const step = traceFirstUseSequenceStep(detail, state);
  const stepIndex = typeof step.sequenceStepIndex === "number" ? step.sequenceStepIndex : null;
  const existing = stepIndex === null
    ? null
    : trace.firstUseSequenceSteps.find((entry) => entry.sequenceStepIndex === stepIndex) ?? null;
  if (existing) Object.assign(existing, step);
  else trace.firstUseSequenceSteps.push(step);
  trace.firstUseSequenceSteps.sort((left, right) => (
    Number(left.sequenceStepIndex ?? 0) - Number(right.sequenceStepIndex ?? 0)
  ));
  if (state === "failed") {
    trace.firstUseSequenceFailed = true;
    trace.firstUseSequenceError = step.error;
  }
  return true;
}

function compactCleanQueueProbe(detail: Record<string, unknown>): Record<string, unknown> {
  return {
    state: detail.state ?? null,
    format: detail.format ?? null,
    blocking: detail.blocking === true,
    beforeApplicationDeviceExposure: detail.beforeApplicationDeviceExposure === true,
    priorDeviceGpuCallCount: detail.priorDeviceGpuCallCount ?? null,
    shaderModuleCreationMs: finiteDurationMilliseconds(detail.shaderModuleCreationMs),
    nativePipelineMs: finiteDurationMilliseconds(detail.nativePipelineMs),
    scopeDrainMs: finiteDurationMilliseconds(detail.scopeDrainMs),
    totalDurationMs: finiteDurationMilliseconds(detail.totalDurationMs),
    scopeErrors: Array.isArray(detail.scopeErrors) ? detail.scopeErrors.slice(0, 4) : [],
    error: compactDocumentPipelineError(detail.error),
    pipelineReason: detail.pipelineReason ?? null,
  };
}

function compactCoreReadinessEntry(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    corePipelineIndex: value.corePipelineIndex ?? null,
    label: value.label ?? null,
    targetFormats: Array.isArray(value.targetFormats) ? value.targetFormats.slice(0, 4) : [],
    syncReturnMs: finiteDurationMilliseconds(value.syncReturnMs),
    readinessMs: finiteDurationMilliseconds(value.readinessMs),
    completionOffsetMs: finiteDurationMilliseconds(value.completionOffsetMs),
    fifoDeltaMs: finiteDurationMilliseconds(value.fifoDeltaMs),
    completionRank: value.completionRank ?? null,
    state: value.state ?? null,
    error: compactDocumentPipelineError(value.error),
    pipelineReason: value.pipelineReason ?? null,
  };
}

function compactCoreReadinessSummary(detail: Record<string, unknown>): Record<string, unknown> {
  return {
    expectedPipelineCount: detail.expectedPipelineCount ?? null,
    startedPipelineCount: detail.startedPipelineCount ?? null,
    completedPipelineCount: detail.completedPipelineCount ?? null,
    failedPipelineCount: detail.failedPipelineCount ?? null,
    completionOrder: Array.isArray(detail.completionOrder)
      ? detail.completionOrder.slice(0, EXPECTED_CORE_RENDER_PIPELINES + 1)
      : [],
    completionOrderPreserved: detail.completionOrderPreserved === true,
    totalDurationMs: finiteDurationMilliseconds(detail.totalDurationMs),
    barrierState: detail.barrierState ?? null,
    barrierWaitMs: finiteDurationMilliseconds(detail.barrierWaitMs),
    postCoreBaseline: isRecord(detail.postCoreBaseline)
      ? {
          state: detail.postCoreBaseline.state ?? null,
          format: detail.postCoreBaseline.format ?? null,
          shaderModuleCreationMs: finiteDurationMilliseconds(
            detail.postCoreBaseline.shaderModuleCreationMs,
          ),
          nativePipelineMs: finiteDurationMilliseconds(
            detail.postCoreBaseline.nativePipelineMs,
          ),
          totalDurationMs: finiteDurationMilliseconds(
            detail.postCoreBaseline.totalDurationMs,
          ),
          error: compactDocumentPipelineError(detail.postCoreBaseline.error),
          pipelineReason: detail.postCoreBaseline.pipelineReason ?? null,
        }
      : null,
    entries: Array.isArray(detail.entries)
      ? detail.entries
        .slice(0, EXPECTED_CORE_RENDER_PIPELINES + 1)
        .map(compactCoreReadinessEntry)
        .filter(isRecord)
      : [],
  };
}

function updateCleanQueueCoreTrace(
  trace: DocumentPipelineTraceState,
  type: string,
  detail: Record<string, unknown>,
): boolean {
  if (type.startsWith("document-pipeline-clean-queue-probe-")) {
    trace.cleanQueueProbe = compactCleanQueueProbe(detail);
    return true;
  }
  if (type === "document-pipeline-core-readiness-sequence-started") {
    trace.coreReadinessSequenceStarted = true;
    trace.coreReadinessSummary = compactCoreReadinessSummary(detail);
    return true;
  }
  if (
    type === "document-pipeline-core-readiness-entry-started"
    || type === "document-pipeline-core-readiness-entry-completed"
    || type === "document-pipeline-core-readiness-entry-failed"
  ) {
    const entry = compactCoreReadinessEntry(detail);
    if (entry) {
      const entryIndex = Number(entry.corePipelineIndex);
      const existing = trace.coreReadinessEntries.find((candidate) => (
        Number(candidate.corePipelineIndex) === entryIndex
      ));
      if (existing) Object.assign(existing, entry);
      else trace.coreReadinessEntries.push(entry);
      trace.coreReadinessEntries.sort((left, right) => (
        Number(left.corePipelineIndex ?? 0) - Number(right.corePipelineIndex ?? 0)
      ));
    }
    if (type.endsWith("-failed")) trace.coreReadinessSequenceFailed = true;
    return true;
  }
  if (type === "document-pipeline-core-readiness-sequence-completed") {
    trace.coreReadinessSequenceCompleted = true;
    trace.coreReadinessSummary = compactCoreReadinessSummary(detail);
    trace.coreReadinessEntries = Array.isArray(trace.coreReadinessSummary.entries)
      ? [...trace.coreReadinessSummary.entries] as Array<Record<string, unknown>>
      : [];
    return true;
  }
  if (type === "document-pipeline-core-readiness-barrier-started") {
    trace.coreReadinessBarrierState = "started";
    return true;
  }
  if (type === "document-pipeline-core-readiness-barrier-completed") {
    trace.coreReadinessBarrierState = "completed";
    trace.coreReadinessSummary = compactCoreReadinessSummary(detail);
    trace.coreReadinessEntries = Array.isArray(trace.coreReadinessSummary.entries)
      ? [...trace.coreReadinessSummary.entries] as Array<Record<string, unknown>>
      : [];
    trace.postCoreBaseline = isRecord(trace.coreReadinessSummary.postCoreBaseline)
      ? { ...trace.coreReadinessSummary.postCoreBaseline }
      : null;
    return true;
  }
  if (type === "document-pipeline-core-readiness-barrier-failed") {
    trace.coreReadinessBarrierState = "failed";
    trace.coreReadinessSequenceFailed = true;
    trace.coreReadinessSummary = compactCoreReadinessSummary(detail);
    return true;
  }
  if (type.startsWith("document-pipeline-post-core-baseline-")) {
    trace.postCoreBaseline = {
      state: detail.state ?? null,
      format: detail.format ?? null,
      shaderModuleCreationMs: finiteDurationMilliseconds(detail.shaderModuleCreationMs),
      nativePipelineMs: finiteDurationMilliseconds(detail.nativePipelineMs),
      totalDurationMs: finiteDurationMilliseconds(detail.totalDurationMs),
      error: compactDocumentPipelineError(detail.error),
      pipelineReason: detail.pipelineReason ?? null,
    };
    if (type.endsWith("-failed")) trace.coreReadinessSequenceFailed = true;
    return true;
  }
  return false;
}

function updateDocumentPipelineTrace(
  trace: DocumentPipelineTraceState,
  type: string,
  rawDetail: unknown,
): void {
  const detail = isRecord(rawDetail) ? rawDetail : {};
  if (updateCleanQueueCoreTrace(trace, type, detail)) return;
  if (updateFirstUseSequenceTrace(trace, type, detail)) return;
  if (type === "document-pipeline-instrumentation") {
    trace.instrumentationInstalled = detail.installed === true;
    return;
  }
  if (type === "document-pipeline-adapter-patched") {
    trace.adapterRequestDevicePatched = detail.requestDevicePatched === true;
    trace.adapterPatchCount = typeof detail.adapterPatchCount === "number"
      ? detail.adapterPatchCount
      : trace.adapterPatchCount + 1;
    return;
  }
  if (type === "document-pipeline-device-patched") {
    trace.devicePatchCount = typeof detail.devicePatchCount === "number"
      ? detail.devicePatchCount
      : trace.devicePatchCount + 1;
    trace.pipelineLayoutPatched = detail.pipelineLayoutPatched === true;
    trace.renderPipelinePatched = detail.renderPipelinePatched === true;
    trace.renderPipelineMethod = typeof detail.renderPipelineMethod === "string"
      ? detail.renderPipelineMethod
      : null;
    trace.popErrorScopePatched = detail.popErrorScopePatched === true;
    trace.requiredFeatures = Array.isArray(detail.requiredFeatures)
      ? detail.requiredFeatures.slice(0, 16)
      : null;
    trace.textureFormatsTier2Enabled = detail.textureFormatsTier2Enabled === true;
    return;
  }
  if (type === "document-pipeline-phase") {
    trace.phaseState = typeof detail.phaseState === "string" ? detail.phaseState : trace.phaseState;
    return;
  }
  if (type === "document-gpu-device-lost") {
    const existingDuringTarget = isRecord(trace.deviceLost)
      && trace.deviceLost.duringTargetPhase === true;
    if (trace.deviceLost === null || (!existingDuringTarget && detail.duringTargetPhase === true)) {
      trace.deviceLost = compactDocumentPipelineGpuEvent(detail);
    }
    return;
  }
  if (type === "document-gpu-uncaptured-error") {
    const existingDuringTarget = isRecord(trace.uncapturedError)
      && trace.uncapturedError.duringTargetPhase === true;
    if (
      trace.uncapturedError === null
      || (!existingDuringTarget && detail.duringTargetPhase === true)
    ) {
      trace.uncapturedError = compactDocumentPipelineGpuEvent(detail);
    }
    return;
  }
  if (type === "document-gpu-scope-error") {
    trace.scopeErrorCount += 1;
    trace.lastScopeError = traceCallDetail(detail, "scope-error");
    return;
  }
  if (
    type !== "document-gpu-call-started"
    && type !== "document-gpu-call-completed"
    && type !== "document-gpu-call-failed"
  ) {
    return;
  }

  const callIndex = typeof detail.callIndex === "number" ? detail.callIndex : null;
  const method = typeof detail.method === "string" ? detail.method : null;
  const pipelineLayout = method === "createPipelineLayout";
  const renderPipeline = method === "createRenderPipeline"
    || method === "createRenderPipelineAsync";
  const errorScopeDrain = method === "popErrorScope";
  const callState = type === "document-gpu-call-started"
    ? "started"
    : type === "document-gpu-call-completed"
      ? "completed"
      : "failed";
  const compactCall = traceCallDetail(detail, callState);
  const existing = callIndex === null
    ? null
    : trace.calls.find((entry) => entry.callIndex === callIndex) ?? null;
  if (existing) {
    Object.assign(existing, compactCall);
  } else {
    trace.calls.push(compactCall);
    if (trace.calls.length > 96) trace.calls.shift();
  }

  if (callState === "started") {
    trace.startedCallCount += 1;
    if (pipelineLayout) trace.pipelineLayoutStartedCount += 1;
    if (renderPipeline) trace.renderPipelineStartedCount += 1;
    if (errorScopeDrain) trace.popErrorScopeStartedCount += 1;
    trace.lastStartedCall = compactCall;
    return;
  }
  if (callState === "failed") {
    trace.failedCallCount += 1;
    trace.lastFailedCall = compactCall;
    return;
  }

  trace.completedCallCount += 1;
  if (pipelineLayout) trace.pipelineLayoutCompletedCount += 1;
  trace.lastCompletedCall = compactCall;
  if (errorScopeDrain) trace.popErrorScopeCompletedCount += 1;
  if (renderPipeline) {
    trace.renderPipelineCompletedCount += 1;
    const durationMs = typeof detail.durationMs === "number" ? detail.durationMs : -1;
    const slowestDuration = typeof trace.slowestCompletedRenderPipeline?.durationMs === "number"
      ? trace.slowestCompletedRenderPipeline.durationMs
      : -1;
    if (durationMs > slowestDuration) trace.slowestCompletedRenderPipeline = compactCall;
  }
}

function documentPipelineTraceSummary(
  trace: DocumentPipelineTraceState,
): Record<string, unknown> {
  const unmatchedStartedCall = trace.startedCallCount
    > trace.completedCallCount + trace.failedCallCount;
  return {
    instrumentationInstalled: trace.instrumentationInstalled,
    adapterRequestDevicePatched: trace.adapterRequestDevicePatched,
    adapterPatchCount: trace.adapterPatchCount,
    devicePatchCount: trace.devicePatchCount,
    pipelineLayoutPatched: trace.pipelineLayoutPatched,
    renderPipelinePatched: trace.renderPipelinePatched,
    renderPipelineMethod: trace.renderPipelineMethod,
    popErrorScopePatched: trace.popErrorScopePatched,
    requiredFeatures: trace.requiredFeatures,
    textureFormatsTier2Enabled: trace.textureFormatsTier2Enabled,
    phaseState: trace.phaseState,
    expectedSynchronousPipelineLayouts: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
    expectedSynchronousRenderPipelines: EXPECTED_DOCUMENT_RENDER_PIPELINES,
    expectedErrorScopeDrains: EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
    startedCallCount: trace.startedCallCount,
    completedCallCount: trace.completedCallCount,
    failedCallCount: trace.failedCallCount,
    scopeErrorCount: trace.scopeErrorCount,
    pipelineLayoutStartedCount: trace.pipelineLayoutStartedCount,
    pipelineLayoutCompletedCount: trace.pipelineLayoutCompletedCount,
    renderPipelineStartedCount: trace.renderPipelineStartedCount,
    renderPipelineCompletedCount: trace.renderPipelineCompletedCount,
    popErrorScopeStartedCount: trace.popErrorScopeStartedCount,
    popErrorScopeCompletedCount: trace.popErrorScopeCompletedCount,
    deviceLost: trace.deviceLost,
    uncapturedError: trace.uncapturedError,
    lastStartedCall: unmatchedStartedCall ? trace.lastStartedCall : null,
    lastCompletedCall: trace.lastCompletedCall,
    lastFailedCall: trace.lastFailedCall,
    lastScopeError: trace.lastScopeError,
    slowestCompletedRenderPipeline: trace.slowestCompletedRenderPipeline,
    engineProbe: trace.engineProbe,
    firstUseSequence: firstUseSequenceSummary(trace),
    cleanQueueProbe: trace.cleanQueueProbe,
    coreReadinessSequenceStarted: trace.coreReadinessSequenceStarted,
    coreReadinessSequenceCompleted: trace.coreReadinessSequenceCompleted,
    coreReadinessSequenceFailed: trace.coreReadinessSequenceFailed,
    coreReadinessBarrierState: trace.coreReadinessBarrierState,
    coreReadiness: trace.coreReadinessSummary,
    postCoreBaseline: trace.postCoreBaseline,
    calls: trace.calls.slice(-4),
  };
}

const DOCUMENT_RENDER_PIPELINE_GROUPS = [
  { key: "erase-stamps", label: "Erase stamps", first: 1, last: 6 },
  { key: "direct-color-stamps", label: "Direct color stamps", first: 7, last: 18 },
  {
    key: "precision-color-accumulation",
    label: "Precision color accumulation",
    first: 19,
    last: 30,
  },
  { key: "coverage-accumulation", label: "Coverage accumulation", first: 31, last: 36 },
  { key: "live-accumulation-resolve", label: "Live accumulation resolve", first: 37, last: 40 },
  { key: "display-and-live-mips", label: "Display and live mips", first: 41, last: 46 },
  { key: "document-composition", label: "Document composition", first: 47, last: 52 },
] as const;

function finiteDurationMilliseconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000) / 1_000
    : null;
}

function firstUseSequenceSummary(trace: DocumentPipelineTraceState): Record<string, unknown> | null {
  if (
    !trace.firstUseSequenceStarted
    && !trace.firstUseSequenceCompleted
    && !trace.firstUseSequenceFailed
    && trace.firstUseSequenceSteps.length === 0
  ) {
    return null;
  }
  const steps = trace.firstUseSequenceSteps.map((step) => ({ ...step }));
  const duration = (step: Record<string, unknown> | undefined): number => (
    typeof step?.durationMs === "number" ? step.durationMs : 0
  );
  const nativeDuration = (step: Record<string, unknown> | undefined): number => (
    typeof step?.nativePipelineMs === "number" ? step.nativePipelineMs : duration(step)
  );
  const first = steps[0];
  const second = steps[1];
  const third = steps[2];
  return {
    sequenceId: steps.find((step) => typeof step.sequenceId === "string")?.sequenceId
      ?? "first-use-controls-v1",
    started: trace.firstUseSequenceStarted,
    completed: trace.firstUseSequenceCompleted,
    failed: trace.firstUseSequenceFailed,
    steps,
    totalDurationMs: finiteDurationMilliseconds(
      duration(first) + duration(second) + duration(third),
    ),
    injectedPreflightDurationMs: finiteDurationMilliseconds(duration(first) + duration(second)),
    injectedPreflightNativePipelineMs: finiteDurationMilliseconds(
      nativeDuration(first) + nativeDuration(second),
    ),
    originalEraserDurationMs: finiteDurationMilliseconds(duration(third)),
    error: trace.firstUseSequenceError,
  };
}

function firstUseSequencePassed(trace: DocumentPipelineTraceState): boolean {
  if (!application4096PipelineFirstUseControlsEnabled) return true;
  const expectedKeys = [
    "tiny-independent-rgba16float",
    "shared-brush-source-over-clone",
    "original-eraser",
  ];
  return trace.firstUseSequenceStarted
    && trace.firstUseSequenceCompleted
    && !trace.firstUseSequenceFailed
    && trace.firstUseSequenceSteps.length === expectedKeys.length
    && trace.firstUseSequenceSteps.every((step, index) => (
      step.sequenceId === "first-use-controls-v1"
      && step.sequenceStepIndex === index + 1
      && step.stepKey === expectedKeys[index]
      && step.state === "completed"
      && typeof step.durationMs === "number"
      && Number.isFinite(step.durationMs)
      && step.durationMs >= 0
      && typeof step.nativePipelineMs === "number"
      && Number.isFinite(step.nativePipelineMs)
      && step.nativePipelineMs >= 0
      && Array.isArray(step.targetFormats)
      && step.targetFormats.length === 1
      && step.targetFormats[0] === "rgba16float"
      && step.vertexEntryPoint === "vertexMain"
      && step.fragmentEntryPoint === "fragmentMain"
      && step.ordinaryRenderPipelineIndex === (index === 2 ? 1 : null)
      && step.topology === (index === 0 ? "triangle-list" : "triangle-strip")
  ));
}

function cleanQueueCoreAttributionPassed(trace: DocumentPipelineTraceState): boolean {
  if (!application4096CleanQueueCoreEnabled) return true;
  const probe = trace.cleanQueueProbe;
  const core = trace.coreReadinessSummary;
  const entries = isRecord(core) && Array.isArray(core.entries)
    ? core.entries.filter(isRecord)
    : [];
  const completionOrder = isRecord(core) && Array.isArray(core.completionOrder)
    ? core.completionOrder
    : [];
  const ordered = isRecord(core) && core.completionOrderPreserved === true;
  const validDuration = (value: unknown): boolean => (
    typeof value === "number" && Number.isFinite(value) && value >= 0
  );
  const expectedLabels = ["Pre-core queue boundary", ...EXPECTED_CORE_PIPELINE_LABELS];
  const completionPermutation = completionOrder.length === EXPECTED_CORE_RENDER_PIPELINES + 1
    && [...completionOrder]
      .map(Number)
      .sort((left, right) => left - right)
      .every((value, index) => value === index);
  return isRecord(probe)
    && probe.state === "completed"
    && probe.format === "rgba16float"
    && probe.blocking === true
    && probe.beforeApplicationDeviceExposure === true
    && probe.priorDeviceGpuCallCount === 0
    && validDuration(probe.shaderModuleCreationMs)
    && validDuration(probe.nativePipelineMs)
    && validDuration(probe.scopeDrainMs)
    && validDuration(probe.totalDurationMs)
    && Array.isArray(probe.scopeErrors)
    && probe.scopeErrors.length === 0
    && trace.coreReadinessSequenceStarted
    && trace.coreReadinessSequenceCompleted
    && !trace.coreReadinessSequenceFailed
    && trace.coreReadinessBarrierState === "completed"
    && isRecord(core)
    && core.expectedPipelineCount === EXPECTED_CORE_RENDER_PIPELINES
    && core.startedPipelineCount === EXPECTED_CORE_RENDER_PIPELINES
    && core.completedPipelineCount === EXPECTED_CORE_RENDER_PIPELINES + 1
    && core.failedPipelineCount === 0
    && validDuration(core.totalDurationMs)
    && validDuration(core.barrierWaitMs)
    && completionPermutation
    && entries.length === EXPECTED_CORE_RENDER_PIPELINES + 1
    && entries.every((entry, index) => (
      entry.corePipelineIndex === index
      && entry.label === expectedLabels[index]
      && Array.isArray(entry.targetFormats)
      && entry.targetFormats.length === 1
      && entry.targetFormats[0] === (
        index === 0 ? "rgba16float" : EXPECTED_CORE_PIPELINE_TARGET_FORMATS[index - 1]
      )
      && entry.state === "completed"
      && validDuration(entry.readinessMs)
      && validDuration(entry.completionOffsetMs)
      && validDuration(entry.completionRank)
      && (index === 0 ? entry.syncReturnMs === null : validDuration(entry.syncReturnMs))
      && (ordered ? validDuration(entry.fifoDeltaMs) : entry.fifoDeltaMs === null)
    ))
    && isRecord(core.postCoreBaseline)
    && core.postCoreBaseline.state === "completed"
    && core.postCoreBaseline.format === "rgba16float"
    && validDuration(core.postCoreBaseline.shaderModuleCreationMs)
    && validDuration(core.postCoreBaseline.nativePipelineMs)
    && validDuration(core.postCoreBaseline.totalDurationMs);
}

function cleanQueueCoreAttributionSummary(
  trace: DocumentPipelineTraceState,
): Record<string, unknown> {
  const probe = isRecord(trace.cleanQueueProbe) ? trace.cleanQueueProbe : {};
  const core = isRecord(trace.coreReadinessSummary) ? trace.coreReadinessSummary : {};
  const entries = Array.isArray(core.entries) ? core.entries.filter(isRecord) : [];
  const ordered = core.completionOrderPreserved === true;
  return {
    probeFormat: probe.format ?? "rgba16float",
    probeBlocking: probe.blocking === true,
    probeBeforeApplicationDeviceExposure: probe.beforeApplicationDeviceExposure === true,
    priorDeviceGpuCallCount: probe.priorDeviceGpuCallCount ?? null,
    probeShaderModuleCreationMs: finiteDurationMilliseconds(probe.shaderModuleCreationMs),
    probeNativePipelineMs: finiteDurationMilliseconds(probe.nativePipelineMs),
    probeScopeDrainMs: finiteDurationMilliseconds(probe.scopeDrainMs),
    probeTotalMs: finiteDurationMilliseconds(probe.totalDurationMs),
    coreCompletionOrderPreserved: ordered,
    coreCompletionOrder: Array.isArray(core.completionOrder)
      ? core.completionOrder.slice(0, EXPECTED_CORE_RENDER_PIPELINES + 1)
      : [],
    coreDrainMs: finiteDurationMilliseconds(core.totalDurationMs),
    coreBarrierWaitMs: finiteDurationMilliseconds(core.barrierWaitMs),
    coreSyncReturnMs: entries.slice(1).map((entry) => (
      finiteDurationMilliseconds(entry.syncReturnMs)
    )),
    coreSentinelElapsedMs: entries.map((entry) => (
      finiteDurationMilliseconds(entry.readinessMs)
    )),
    coreCumulativeMs: entries.map((entry) => (
      finiteDurationMilliseconds(entry.completionOffsetMs)
    )),
    coreIntervalMs: ordered
      ? entries.slice(1).map((entry) => finiteDurationMilliseconds(entry.fifoDeltaMs))
      : [],
    preCoreBacklogMs: ordered && isRecord(entries[0])
      ? finiteDurationMilliseconds(entries[0].fifoDeltaMs)
      : null,
    coreEntries: entries,
    postCoreBaseline: isRecord(core.postCoreBaseline)
      ? { ...core.postCoreBaseline }
      : null,
    individualCoreAttributionValid: ordered,
  };
}

function compactTimedDocumentPipelineCall(
  call: Record<string, unknown>,
  indexKey: "pipelineLayoutIndex" | "renderPipelineIndex" | "errorScopeDrainIndex",
): Record<string, unknown> {
  const rawLabel = typeof call.label === "string" ? call.label : "GPU component";
  const compactCall: Record<string, unknown> = {
    index: typeof call[indexKey] === "number" ? call[indexKey] : null,
    label: rawLabel.replace(/\s+(?:rgba16float|rgba8unorm|bgra8unorm)$/i, "").slice(0, 80),
    durationMs: finiteDurationMilliseconds(call.durationMs),
  };
  if (call.state === "failed") compactCall.failed = true;
  return compactCall;
}

function documentPipelineBreakdownSummary(
  trace: DocumentPipelineTraceState,
  phaseElapsedMs: unknown,
): Record<string, unknown> {
  const measuredCalls = trace.calls.filter(
    (call) => call.state === "completed" || call.state === "failed",
  );
  const layoutCalls = measuredCalls
    .filter((call) => call.method === "createPipelineLayout")
    .map((call) => compactTimedDocumentPipelineCall(call, "pipelineLayoutIndex"));
  const renderCalls = measuredCalls
    .filter((call) => (
      call.method === "createRenderPipeline"
      || call.method === "createRenderPipelineAsync"
    ))
    .map((call) => compactTimedDocumentPipelineCall(call, "renderPipelineIndex"));
  const errorScopeCalls = measuredCalls
    .filter((call) => call.method === "popErrorScope")
    .map((call) => compactTimedDocumentPipelineCall(call, "errorScopeDrainIndex"));
  const durationSum = (calls: readonly Record<string, unknown>[]): number => calls.reduce(
    (sum, call) => sum + (typeof call.durationMs === "number" ? call.durationMs : 0),
    0,
  );
  const layoutTotalMs = durationSum(layoutCalls);
  const renderPipelineTotalMs = durationSum(renderCalls);
  const errorScopeTotalMs = durationSum(errorScopeCalls);
  const sequence = firstUseSequenceSummary(trace);
  const injectedPreflightNativePipelineMs = isRecord(sequence)
    && typeof sequence.injectedPreflightNativePipelineMs === "number"
    ? sequence.injectedPreflightNativePipelineMs
    : 0;
  const nativeCallTotalMs = layoutTotalMs
    + renderPipelineTotalMs
    + errorScopeTotalMs
    + injectedPreflightNativePipelineMs;
  const ordinaryInstrumentationPreparationTotalMs = measuredCalls.reduce(
    (sum, call) => sum + (
      typeof call.instrumentationPreparationMs === "number"
        ? call.instrumentationPreparationMs
        : 0
    ),
    0,
  );
  const injectedPreflightInstrumentationMs = isRecord(sequence)
    && Array.isArray(sequence.steps)
    ? sequence.steps.slice(0, 2).reduce((sum, step) => (
        sum + (
          isRecord(step) && typeof step.instrumentationPreparationMs === "number"
            ? step.instrumentationPreparationMs
            : 0
        )
      ), 0)
    : 0;
  const instrumentationPreparationTotalMs = ordinaryInstrumentationPreparationTotalMs
    + injectedPreflightInstrumentationMs;
  const finitePhaseElapsedMs = finiteDurationMilliseconds(phaseElapsedMs);
  const slowestRenderPipeline = [...renderCalls]
    .sort((left, right) => (
      (typeof right.durationMs === "number" ? right.durationMs : -1)
      - (typeof left.durationMs === "number" ? left.durationMs : -1)
    ))
    [0] ?? null;
  const failedCallCount = measuredCalls.filter((call) => call.state === "failed").length;
  return {
    expectedMeasuredCallCount: EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      + EXPECTED_DOCUMENT_RENDER_PIPELINES
      + EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
    measuredCallCount: measuredCalls.length,
    phaseElapsedMs: finitePhaseElapsedMs,
    nativeCallTotalMs: finiteDurationMilliseconds(nativeCallTotalMs),
    preCallDiagnosticTotalMs: finiteDurationMilliseconds(
      instrumentationPreparationTotalMs,
    ),
    phaseMinusPreCallDiagnosticMs: finitePhaseElapsedMs === null
      ? null
      : finiteDurationMilliseconds(
        Math.max(0, finitePhaseElapsedMs - instrumentationPreparationTotalMs),
      ),
    remainingPhaseWorkAndReportingMs: finitePhaseElapsedMs === null
      ? null
      : finiteDurationMilliseconds(Math.max(
        0,
        finitePhaseElapsedMs - nativeCallTotalMs - instrumentationPreparationTotalMs,
      )),
    pipelineLayoutTotalMs: finiteDurationMilliseconds(layoutTotalMs),
    renderPipelineTotalMs: finiteDurationMilliseconds(renderPipelineTotalMs),
    injectedPreflightPipelineTotalMs: application4096PipelineFirstUseControlsEnabled
      ? finiteDurationMilliseconds(injectedPreflightNativePipelineMs)
      : null,
    renderPipelineMethod: trace.renderPipelineMethod,
    renderPipelineTimingsOverlap: trace.renderPipelineMethod === "createRenderPipelineAsync"
      ? false
      : null,
    firstRenderPipelineMayIncludePriorQueuedGpuWork:
      trace.renderPipelineMethod === "createRenderPipelineAsync"
        ? !application4096PipelineFirstUseControlsEnabled
          && !application4096CleanQueueCoreEnabled
        : null,
    firstUseSequence: sequence,
    errorScopeDrainTotalMs: finiteDurationMilliseconds(errorScopeTotalMs),
    slowestRenderPipelineIndex: isRecord(slowestRenderPipeline)
      ? slowestRenderPipeline.index ?? null
      : null,
    slowestRenderPipelineDurationMs: isRecord(slowestRenderPipeline)
      ? slowestRenderPipeline.durationMs ?? null
      : null,
    pipelineLayouts: layoutCalls,
    renderPipelineGroups: DOCUMENT_RENDER_PIPELINE_GROUPS.map((group) => {
      const calls = renderCalls.filter((call) => (
        typeof call.index === "number"
        && call.index >= group.first
        && call.index <= group.last
      ));
      return {
        key: group.key,
        label: group.label,
        totalDurationMs: finiteDurationMilliseconds(durationSum(calls)),
        calls,
      };
    }),
    failedCallCount,
    errorScopeDrains: errorScopeCalls,
  };
}

function documentPipelineApplicationSummary(
  applicationBoot: Record<string, unknown>,
): Record<string, unknown> {
  const reporter = isRecord(applicationBoot.reporter) ? applicationBoot.reporter : {};
  const engine = isRecord(applicationBoot.engine) ? applicationBoot.engine : {};
  return {
    accessible: applicationBoot.accessible ?? null,
    statusText: applicationBoot.statusText ?? null,
    statusClass: applicationBoot.statusClass ?? null,
    projectSessionReady: applicationBoot.projectSessionReady ?? null,
    runtimeStatsStarted: applicationBoot.runtimeStatsStarted ?? null,
    canvas: applicationBoot.canvas ?? null,
    startupPhaseStates: applicationBoot.startupPhaseStates ?? null,
    rgba16floatLayerBytes: applicationBoot.rgba16floatLayerBytes ?? null,
    resourceCount: applicationBoot.resourceCount ?? null,
    failedResources: applicationBoot.failedResources ?? null,
    deferredStartupObservationMs: applicationBoot.deferredStartupObservationMs ?? null,
    reporter: {
      channel: reporter.channel ?? null,
      bootstrapReady: reporter.bootstrapReady ?? null,
      extensionCreated: reporter.extensionCreated ?? null,
      frameMessageCount: reporter.frameMessageCount ?? null,
      lastStartupProgress: reporter.lastStartupProgress ?? null,
    },
    engine: {
      documentWidth: engine.documentWidth ?? null,
      documentHeight: engine.documentHeight ?? null,
      diagnosticVariant: engine.diagnosticVariant ?? null,
      layerFormat: engine.layerFormat ?? null,
      canvasFormat: engine.canvasFormat ?? null,
      featureIsolation: engine.featureIsolation ?? null,
      layerCount: engine.layerCount ?? null,
      layerMemoryMiB: engine.layerMemoryMiB ?? null,
      storage: engine.storage ?? null,
      gpu: engine.gpu ?? null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalFiniteNumber(
  source: Record<string, unknown>,
  key: string,
): number | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The application engine report contains an invalid ${key}.`);
  }
  return value;
}

function validateApplicationEngineReport(
  detail: unknown,
  expectations: ApplicationEngineReportExpectations,
): Record<string, unknown> {
  if (!isRecord(detail)) {
    throw new Error("The application frame did not provide a structured engine report.");
  }

  const documentWidth = readOptionalFiniteNumber(detail, "documentWidth");
  const documentHeight = readOptionalFiniteNumber(detail, "documentHeight");
  if (
    documentWidth !== expectations.documentWidth
    || documentHeight !== expectations.documentHeight
  ) {
    throw new Error(
      `The application engine initialized ${String(documentWidth)}x${String(documentHeight)} instead of `
        + `${expectations.documentWidth}x${expectations.documentHeight}.`,
    );
  }
  if (detail.layerFormat !== "rgba16float") {
    throw new Error(
      `The authoritative application layer format is ${String(detail.layerFormat)}, not rgba16float.`,
    );
  }
  if (detail.canvasFormat !== "rgba16float") {
    throw new Error(
      `The authoritative application canvas format is ${String(detail.canvasFormat)}, not rgba16float.`,
    );
  }
  if (detail.diagnosticVariant !== expectations.diagnosticVariant) {
    throw new Error(
      `The application frame reported variant ${String(detail.diagnosticVariant)} instead of `
        + `${expectations.diagnosticVariant}.`,
    );
  }
  const featureIsolation = detail.featureIsolation;
  if (
    !isRecord(featureIsolation)
    || typeof featureIsolation.textureFormatsTier2Advertised !== "boolean"
    || featureIsolation.textureFormatsTier2Enabled !== false
    || featureIsolation.inPlaceGlazeCommitEnabled !== false
    || featureIsolation.inPlaceGlazeCommitPipelineCreated !== false
  ) {
    throw new Error(
      "The RGBA16F comparison did not keep texture-formats-tier2 and its in-place commit path disabled.",
    );
  }
  if (expectations.diagnosticVariant === DOCUMENT_PIPELINE_VARIANT) {
    const probe = detail.documentPipelineProbe;
    if (
      !isRecord(probe)
      || probe.enabled !== true
      || probe.targetPhase !== "document-pipelines"
      || probe.phaseState !== "completed"
      || probe.adapterPatchCount !== 1
      || probe.devicePatchCount !== 1
      || probe.expectedSynchronousPipelineLayouts !== EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      || probe.expectedSynchronousRenderPipelines !== EXPECTED_DOCUMENT_RENDER_PIPELINES
      || probe.expectedErrorScopeDrains !== EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
      || probe.pipelineLayoutStartedCount !== EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      || probe.pipelineLayoutCompletedCount !== EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      || probe.renderPipelineStartedCount !== EXPECTED_DOCUMENT_RENDER_PIPELINES
      || probe.renderPipelineCompletedCount !== EXPECTED_DOCUMENT_RENDER_PIPELINES
      || probe.popErrorScopeStartedCount !== EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
      || probe.popErrorScopeCompletedCount !== EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
      || probe.startedCallCount !== (
        EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
        + EXPECTED_DOCUMENT_RENDER_PIPELINES
        + EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
      )
      || probe.completedCallCount !== (
        EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
        + EXPECTED_DOCUMENT_RENDER_PIPELINES
        + EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
      )
      || probe.failedCallCount !== 0
      || probe.scopeErrorCount !== 0
    ) {
      throw new Error("The document-pipeline probe did not complete all expected native call boundaries.");
    }
  }

  const expectedLayerMiB = expectations.documentWidth
    * expectations.documentHeight
    * RGBA16FLOAT_BYTES_PER_PIXEL
    / (1024 * 1024);
  const layerCount = readOptionalFiniteNumber(detail, "layerCount");
  if (layerCount !== null && (!Number.isInteger(layerCount) || layerCount !== 1)) {
    throw new Error(`The isolated application initialized ${layerCount} layers instead of one.`);
  }
  if (expectations.requireStorageSummary && layerCount !== 1) {
    throw new Error("The application engine report did not prove one initialized layer.");
  }
  const layerMemoryMiB = readOptionalFiniteNumber(detail, "layerMemoryMiB");
  if (
    expectations.requireStorageSummary
    && (
      layerMemoryMiB === null
      || Math.abs(layerMemoryMiB - expectedLayerMiB) > 0.05
    )
  ) {
    throw new Error(
      `The application engine did not report ${expectedLayerMiB} MiB of active layer storage.`,
    );
  }

  const storageValue = detail.storage;
  if (expectations.requireStorageSummary && !isRecord(storageValue)) {
    throw new Error("The application engine report did not provide the required storage summary.");
  }
  if (storageValue !== undefined && storageValue !== null) {
    if (!isRecord(storageValue)) {
      throw new Error("The application engine report contains an invalid storage summary.");
    }
    const bytesPerPixel = readOptionalFiniteNumber(storageValue, "bytesPerPixel");
    const fullLayerMiB = readOptionalFiniteNumber(storageValue, "fullLayerMiB");
    const eagerFullRawMiB = readOptionalFiniteNumber(storageValue, "eagerFullRawMiB");
    const actualRawMiB = readOptionalFiniteNumber(storageValue, "actualRawMiB");
    const tileSizePx = readOptionalFiniteNumber(storageValue, "tileSizePx");
    const tileCount = readOptionalFiniteNumber(storageValue, "tileCount");
    const isNear = (left: number, right: number): boolean => Math.abs(left - right) <= 0.05;

    if (
      expectations.requireStorageSummary
      && (
        bytesPerPixel === null
        || fullLayerMiB === null
        || eagerFullRawMiB === null
        || actualRawMiB === null
        || tileSizePx === null
        || tileCount === null
      )
    ) {
      throw new Error("The application engine report contains an incomplete storage summary.");
    }

    if (bytesPerPixel !== null && bytesPerPixel !== RGBA16FLOAT_BYTES_PER_PIXEL) {
      throw new Error(`The application layer storage uses ${bytesPerPixel} bytes per pixel instead of 8.`);
    }
    if (fullLayerMiB !== null && !isNear(fullLayerMiB, expectedLayerMiB)) {
      throw new Error(
        `The application reports ${fullLayerMiB} MiB per layer instead of ${expectedLayerMiB} MiB.`,
      );
    }
    if (
      eagerFullRawMiB !== null
      && layerCount !== null
      && !isNear(eagerFullRawMiB, expectedLayerMiB * layerCount)
    ) {
      throw new Error("The eager layer-storage total does not match the observed RGBA16F layer count.");
    }
    if (
      actualRawMiB !== null
      && layerCount === 1
      && !isNear(actualRawMiB, expectedLayerMiB)
    ) {
      throw new Error(
        `The active layer's raw storage does not match one full `
          + `${expectations.documentWidth}x${expectations.documentHeight} RGBA16F layer.`,
      );
    }
    if (tileSizePx !== null && (!Number.isInteger(tileSizePx) || tileSizePx <= 0)) {
      throw new Error("The application engine report contains an invalid storage tile size.");
    }
    if (tileCount !== null && (!Number.isInteger(tileCount) || tileCount <= 0)) {
      throw new Error("The application engine report contains an invalid storage tile count.");
    }
    if (
      bytesPerPixel !== null
      && tileSizePx !== null
      && tileCount !== null
      && !isNear(
        tileSizePx * tileSizePx * tileCount * bytesPerPixel / (1024 * 1024),
        expectedLayerMiB,
      )
    ) {
      throw new Error(
        `The reported tile geometry does not cover one full `
          + `${expectations.documentWidth}x${expectations.documentHeight} RGBA16F layer.`,
      );
    }

    if (
      layerMemoryMiB !== null
      && actualRawMiB !== null
      && !isNear(layerMemoryMiB, actualRawMiB)
    ) {
      throw new Error("The engine layer-memory total disagrees with its raw storage summary.");
    }
  }

  return { ...detail };
}

async function runFullApplicationBoot(
  options: ApplicationBootOptions = {},
): Promise<Record<string, unknown>> {
  const frame = document.getElementById("gpuDiagnosticAppFrame") as HTMLIFrameElement | null;
  if (!frame) throw new Error("The isolated application frame is missing.");
  const expectedDiagnosticVariant = options.diagnosticVariant ?? APPLICATION_BOOT_VARIANT;
  const documentPipelineTrace = options.documentPipelineTrace ?? null;
  const documentWidth = options.documentWidth ?? DIAGNOSTIC_DOCUMENT_WIDTH;
  const documentHeight = options.documentHeight ?? DIAGNOSTIC_DOCUMENT_HEIGHT;
  if (
    !Number.isInteger(documentWidth)
    || !Number.isInteger(documentHeight)
    || documentWidth <= 0
    || documentHeight <= 0
  ) {
    throw new Error("The diagnostic application dimensions are invalid.");
  }
  const requiredStartupPhases = [...(options.requiredStartupPhases ?? [])];
  const startupPhaseStates: Record<string, string> = options.startupTrace?.phaseStates ?? {};
  const engineReportExpectations: ApplicationEngineReportExpectations = {
    diagnosticVariant: expectedDiagnosticVariant,
    documentWidth,
    documentHeight,
    requireStorageSummary: options.requireStorageSummary === true,
  };

  const target = new URL("/gpu-startup-app-frame", window.location.origin);
  target.searchParams.set("diagnosticBoot", "1");
  target.searchParams.set("documentWidth", String(documentWidth));
  target.searchParams.set("documentHeight", String(documentHeight));
  if (documentWidth === documentHeight) {
    target.searchParams.set("documentSize", String(documentWidth));
  }
  target.searchParams.set("deviceClass", "mobile");
  target.searchParams.set("diagnosticVariant", expectedDiagnosticVariant);
  if (options.diagnosticTestId) target.searchParams.set("test", options.diagnosticTestId);
  target.searchParams.set(
    "diagnosticNonce",
    [
      bridge.runCode || "local",
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
    ].join("-"),
  );
  target.searchParams.set("forceGlazeCommitFallback", "1");
  let bootstrapReady = false;
  let extensionCreated = false;
  let engineReport: Record<string, unknown> | null = null;
  let applicationRuntimeError: unknown = null;
  const applicationConsoleErrors: unknown[] = [];
  let frameMessageCount = 0;
  let lastStartupProgress: Record<string, unknown> | null = null;
  let observer: MutationObserver | null = null;
  let observedFrameWindow: Window | null = null;
  let tearingDown = false;

  const handleFrameWindowError = (event: ErrorEvent): void => {
    if (tearingDown) return;
    applicationRuntimeError = event.error ?? new Error(event.message);
    void bridge.record("application-window-error-fallback", {
      message: event.message,
      source: event.filename ? event.filename.split("/").pop() : null,
      line: event.lineno,
      column: event.colno,
      error: describeError(event.error),
    }, "failed", "beacon");
  };
  const handleFrameUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (tearingDown) return;
    applicationRuntimeError = event.reason;
    void bridge.record("application-unhandled-rejection-fallback", {
      error: describeError(event.reason),
    }, "failed", "beacon");
  };

  const handleFrameMessage = (event: MessageEvent<unknown>): void => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    if (!isRecord(event.data) || event.data.channel !== APP_FRAME_DIAGNOSTIC_CHANNEL) return;
    const type = event.data.type;
    if (typeof type !== "string") return;
    const detail = event.data.detail ?? null;
    frameMessageCount += 1;
    if (type === "bootstrap-ready") {
      bootstrapReady = true;
      void bridge.record("application-frame-bootstrap-ready", detail, "running", "beacon");
      return;
    }
    if (type === "extension-created") {
      extensionCreated = true;
      void bridge.record("application-frame-extension-created", detail, "running", "beacon");
      return;
    }
    if (type === "startup-progress") {
      lastStartupProgress = isRecord(detail) ? { ...detail } : null;
      if (lastStartupProgress && typeof lastStartupProgress.phase === "string") {
        const phaseState = typeof lastStartupProgress.state === "string"
          ? lastStartupProgress.state
          : "unknown";
        startupPhaseStates[lastStartupProgress.phase] = phaseState;
      }
      if (options.startupTrace) {
        options.startupTrace.lastProgress = lastStartupProgress;
        if (lastStartupProgress && typeof lastStartupProgress.phase === "string") {
          options.startupTrace.phaseProgress[lastStartupProgress.phase] = {
            ...lastStartupProgress,
            detail: isRecord(lastStartupProgress.detail)
              ? { ...lastStartupProgress.detail }
              : (lastStartupProgress.detail ?? null),
          };
        }
      }
      if (
        documentPipelineTrace
        && isRecord(detail)
        && detail.phase === "document-pipelines"
        && typeof detail.state === "string"
      ) {
        documentPipelineTrace.phaseState = detail.state;
      }
      const durableCheckpoint = isRecord(detail) && detail.durableCheckpoint === true;
      if (!durableCheckpoint) {
        void bridge.record("application-startup-phase", detail, "running", "beacon");
      }
      return;
    }
    if (
      type === "application-gpu-observation"
      || type === "application-gpu-adapter-observed"
      || type === "application-gpu-device-observed"
    ) {
      if (options.startupTrace && isRecord(detail)) {
        if (type === "application-gpu-observation") {
          options.startupTrace.observationInstalled = detail.installed === true;
        } else if (type === "application-gpu-adapter-observed") {
          options.startupTrace.requestDeviceObserved = detail.requestDeviceObserved === true;
          if (typeof detail.adapterCount === "number") {
            options.startupTrace.adapterCount = detail.adapterCount;
          }
        } else {
          if (typeof detail.deviceCount === "number") {
            options.startupTrace.deviceCount = detail.deviceCount;
          }
          options.startupTrace.requiredFeatures = Array.isArray(detail.requiredFeatures)
            ? [...detail.requiredFeatures]
            : null;
          options.startupTrace.textureFormatsTier2Enabled =
            typeof detail.textureFormatsTier2Enabled === "boolean"
              ? detail.textureFormatsTier2Enabled
              : null;
        }
      }
      void bridge.record(`application-frame-${type}`, detail, "running", "beacon");
      return;
    }
    if (type === "application-gpu-device-lost" || type === "application-gpu-uncaptured-error") {
      const durableCheckpoint = isRecord(detail) && detail.durableCheckpoint === true;
      if (options.startupTrace) {
        if (type === "application-gpu-device-lost") options.startupTrace.deviceLost = detail;
        else options.startupTrace.uncapturedError = detail;
      }
      applicationRuntimeError = { type, detail };
      if (!durableCheckpoint) {
        void bridge.record(`application-frame-${type}`, detail, "failed", "beacon");
      }
      return;
    }
    if (type.startsWith("document-pipeline-") || type.startsWith("document-gpu-")) {
      if (documentPipelineTrace) updateDocumentPipelineTrace(documentPipelineTrace, type, detail);
      if (
        application4096PipelineBreakdownEnabled
        && (type === "document-gpu-call-completed" || type === "document-gpu-call-failed")
      ) {
        bridge.display?.(
          type === "document-gpu-call-completed"
            ? "application-document-gpu-call-completed"
            : "application-document-gpu-call-failed",
          detail,
        );
      }
      const durableCheckpoint = isRecord(detail) && detail.durableCheckpoint === true;
      if (
        type === "document-pipeline-instrumentation"
        || type === "document-pipeline-adapter-patched"
        || type === "document-pipeline-device-patched"
      ) {
        void bridge.record(`application-frame-${type}`, detail, "running", "beacon");
      } else if (type.startsWith("document-pipeline-first-use-") && !durableCheckpoint) {
        const failed = type.endsWith("-failed");
        void bridge.record(
          `application-${type}`,
          detail,
          failed ? "failed" : "running",
          "beacon",
        );
      } else if (type === "document-gpu-call-started" && !durableCheckpoint) {
        void bridge.record("application-document-gpu-call-started", detail, "running", "beacon");
      } else if (
        (
          type === "document-gpu-call-failed"
          || type === "document-gpu-scope-error"
          || type === "document-pipeline-adapter-request-failed"
          || type === "document-pipeline-device-request-failed"
        )
        && !durableCheckpoint
      ) {
        void bridge.record(`application-frame-${type}`, detail, "failed", "beacon");
      } else if (
        (type === "document-gpu-device-lost" || type === "document-gpu-uncaptured-error")
        && !durableCheckpoint
      ) {
        const targetPhaseFailure = isRecord(detail) && detail.duringTargetPhase === true;
        void bridge.record(
          `application-frame-${type}`,
          detail,
          targetPhaseFailure ? "failed" : "running",
          "beacon",
        );
      }
      return;
    }
    if (type === "engine-ready") {
      void bridge.record("application-frame-engine-ready", detail, "running", "beacon");
      try {
        if (documentPipelineTrace && isRecord(detail) && isRecord(detail.documentPipelineProbe)) {
          documentPipelineTrace.engineProbe = { ...detail.documentPipelineProbe };
        }
        engineReport = validateApplicationEngineReport(detail, engineReportExpectations);
      } catch (error) {
        applicationRuntimeError = error;
        void bridge.record("application-frame-engine-report-invalid", {
          error: describeError(error),
          report: detail,
        }, "failed", "beacon");
      }
      return;
    }
    if (type === "console-error") {
      applicationConsoleErrors.push(detail);
      if (applicationConsoleErrors.length > 8) applicationConsoleErrors.shift();
      void bridge.record("application-frame-console-error", detail, "running", "beacon");
      return;
    }
    if (type === "engine-error" || type === "window-error" || type === "unhandled-rejection") {
      applicationRuntimeError = { type, detail };
      void bridge.record(`application-frame-${type}`, detail, "failed", "beacon");
    }
  };
  window.addEventListener("message", handleFrameMessage);

  try {
    await checkpoint("application-navigation-started", {
      path: target.pathname,
      documentWidth,
      documentHeight,
      deviceClass: "mobile",
      persistedProjectRestore: false,
      persistedBrushRestore: true,
      reporterChannel: APP_FRAME_DIAGNOSTIC_CHANNEL,
      diagnosticVariant: expectedDiagnosticVariant,
      diagnosticTestId: options.diagnosticTestId ?? APPLICATION_BOOT_TEST,
      layerFormat: "rgba16float",
      canvasFormat: "rgba16float",
      textureFormatsTier2: "disabled",
    }, "running", "beacon");

    const loaded = new Promise<void>((resolve, reject) => {
      const handleLoad = (): void => {
        try {
          const loadedUrl = new URL(frame.contentWindow?.location.href ?? "about:blank");
          if (
            loadedUrl.origin === target.origin
            && loadedUrl.pathname === target.pathname
            && loadedUrl.searchParams.get("diagnosticBoot") === "1"
          ) {
            frame.removeEventListener("load", handleLoad);
            resolve();
          }
        } catch {
          // Ignore the iframe's initial about:blank load and wait for the target.
        }
      };
      frame.addEventListener("load", handleLoad);
      frame.addEventListener("error", () => reject(new Error("The application frame failed to load.")), {
        once: true,
      });
    });
    frame.src = target.href;
    await withTimeout(
      loaded,
      APPLICATION_DOCUMENT_LOAD_TIMEOUT_MS,
      "Full application document load",
    );
    await checkpoint("application-document-loaded", {
      ...frameState(frame),
      bootstrapReady,
      extensionCreated,
      frameMessageCount,
    });

    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument) {
      throw new Error("The same-origin application frame could not be inspected.");
    }
    observedFrameWindow = frameWindow;

    // The injected reporter is installed before the application module. These
    // listeners remain as a same-origin fallback for failures after document load.
    frameWindow.addEventListener("error", handleFrameWindowError);
    frameWindow.addEventListener("unhandledrejection", handleFrameUnhandledRejection);

    const status = frameDocument.getElementById("status");
    let lastStatusSignature = "";
    const publishStatus = (): void => {
      const state = frameState(frame);
      const signature = JSON.stringify({
        statusText: state.statusText,
        statusClass: state.statusClass,
        projectSessionReady: state.projectSessionReady,
      });
      if (signature === lastStatusSignature) return;
      lastStatusSignature = signature;
      void bridge.record("application-status-changed", state, "running", "beacon");
    };
    observer = status ? new MutationObserver(publishStatus) : null;
    observer?.observe(status!, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    publishStatus();

    const deadline = Date.now() + APPLICATION_BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (applicationRuntimeError) {
        throw new Error(
          `Full application startup raised an uncaught error: ${JSON.stringify(describeError(applicationRuntimeError))}`,
        );
      }
      const state = frameState(frame);
      const statusText = String(state.statusText ?? "");
      const statusClass = String(state.statusClass ?? "");
      if (/\berror\b/.test(statusClass)) {
        throw new Error(`Full application startup reported an error: ${statusText}`);
      }
      const engineReady = /\bok\b/.test(statusClass)
        && statusText.includes("WebGPU is ready");
      const failedStartupPhase = requiredStartupPhases.find(
        (phase) => startupPhaseStates[phase] === "failed",
      );
      if (failedStartupPhase) {
        throw new Error(`Required GPU startup phase failed: ${failedStartupPhase}.`);
      }
      const requiredStartupPhasesCompleted = requiredStartupPhases.every(
        (phase) => startupPhaseStates[phase] === "completed",
      );
      if (
        engineReady
        && state.projectSessionReady === true
        && bootstrapReady
        && extensionCreated
        && engineReport !== null
        && requiredStartupPhasesCompleted
      ) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, APPLICATION_DEFERRED_OBSERVATION_MS);
        });
        if (applicationRuntimeError) {
          throw new Error(
            `Full application startup raised a deferred uncaught error: ${JSON.stringify(describeError(applicationRuntimeError))}`,
          );
        }
        const completedState = frameState(frame);
        const completedStatusText = String(completedState.statusText ?? "");
        const completedStatusClass = String(completedState.statusClass ?? "");
        if (
          !/\bok\b/.test(completedStatusClass)
          || !completedStatusText.includes("WebGPU is ready")
          || completedState.projectSessionReady !== true
          || completedState.runtimeStatsStarted !== true
          || !bootstrapReady
          || !extensionCreated
          || engineReport === null
          || (
            options.requireGpuObservation === true
            && (
              options.startupTrace === undefined
              || !applicationGpuObservationPassed(options.startupTrace)
            )
          )
        ) {
          throw new Error(
            `The application did not remain ready through deferred startup: ${JSON.stringify(completedState)}`,
          );
        }
        if (applicationConsoleErrors.length > 0) {
          throw new Error(
            `The application logged errors during startup: ${JSON.stringify(applicationConsoleErrors)}`,
          );
        }
        if (!requiredStartupPhases.every((phase) => startupPhaseStates[phase] === "completed")) {
          throw new Error(
            "A required GPU startup phase regressed during deferred observation.",
          );
        }
        const observedEngineReport = validateApplicationEngineReport(
          engineReport,
          engineReportExpectations,
        );
        const result = {
          ...completedState,
          ...compactFrameResourceSummary(frame),
          reporter: {
            channel: APP_FRAME_DIAGNOSTIC_CHANNEL,
            bootstrapReady,
            extensionCreated,
            frameMessageCount,
            lastStartupProgress,
            documentPipelineTrace: documentPipelineTrace
              ? documentPipelineTraceSummary(documentPipelineTrace)
              : null,
          },
          engine: observedEngineReport,
          startupPhaseStates: { ...startupPhaseStates },
          rgba16floatLayerBytes: documentWidth
            * documentHeight
            * RGBA16FLOAT_BYTES_PER_PIXEL,
          deferredStartupObservationMs: APPLICATION_DEFERRED_OBSERVATION_MS,
        };
        await checkpoint("application-boot-completed", result);
        if (applicationRuntimeError) {
          throw new Error(
            `Full application startup raised an error while saving completion: `
              + `${JSON.stringify(describeError(applicationRuntimeError))}`,
          );
        }
        return result;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
    }
    throw new Error(
      `Full application startup timed out. Last state: ${JSON.stringify({
        ...frameState(frame),
        bootstrapReady,
        extensionCreated,
        engineReportReceived: engineReport !== null,
        frameMessageCount,
        lastStartupProgress,
        startupPhaseStates,
        documentPipelineTrace: documentPipelineTrace
          ? documentPipelineTraceSummary(documentPipelineTrace)
          : null,
        timeoutMs: APPLICATION_BOOT_TIMEOUT_MS,
      })}`,
    );
  } finally {
    tearingDown = true;
    observer?.disconnect();
    window.removeEventListener("message", handleFrameMessage);
    observedFrameWindow?.removeEventListener("error", handleFrameWindowError);
    observedFrameWindow?.removeEventListener(
      "unhandledrejection",
      handleFrameUnhandledRejection,
    );
    try {
      const diagnosticFrameWindow = frame.contentWindow as (
        Window & { __gpuStartupDiagnosticTeardown?: boolean }
      ) | null;
      if (diagnosticFrameWindow) diagnosticFrameWindow.__gpuStartupDiagnosticTeardown = true;
    } catch {
      // A navigated frame may no longer be same-origin; removal is still safe.
    }
    frame.remove();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
  }
}

function documentPipelineNativeCallsCompleted(trace: DocumentPipelineTraceState): boolean {
  return trace.phaseState === "completed"
    && trace.pipelineLayoutStartedCount === EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
    && trace.pipelineLayoutCompletedCount === EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
    && trace.renderPipelineStartedCount === EXPECTED_DOCUMENT_RENDER_PIPELINES
    && trace.renderPipelineCompletedCount === EXPECTED_DOCUMENT_RENDER_PIPELINES
    && trace.popErrorScopeStartedCount === EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
    && trace.popErrorScopeCompletedCount === EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
    && trace.startedCallCount === (
      EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      + EXPECTED_DOCUMENT_RENDER_PIPELINES
      + EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
    )
    && trace.completedCallCount === (
      EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      + EXPECTED_DOCUMENT_RENDER_PIPELINES
      + EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
    )
    && trace.failedCallCount === 0
    && trace.scopeErrorCount === 0;
}

function documentPipelineTracePassed(trace: DocumentPipelineTraceState): boolean {
  const expectedRenderPipelineMethod = (
    application4096PipelineAttributionEnabled
    || application4096PipelineFirstUseControlsEnabled
    || application4096CleanQueueCoreEnabled
  )
    ? "createRenderPipelineAsync"
    : "createRenderPipeline";
  return trace.instrumentationInstalled === true
    && trace.adapterRequestDevicePatched === true
    && trace.adapterPatchCount === 1
    && trace.devicePatchCount === 1
    && trace.pipelineLayoutPatched === true
    && trace.renderPipelinePatched === true
    && trace.renderPipelineMethod === expectedRenderPipelineMethod
    && trace.popErrorScopePatched === true
    && Array.isArray(trace.requiredFeatures)
    && trace.requiredFeatures.length === 0
    && trace.textureFormatsTier2Enabled === false
    && documentPipelineNativeCallsCompleted(trace)
    && trace.deviceLost === null
    && trace.uncapturedError === null;
}

function occurredDuringDocumentPipeline(value: unknown): boolean {
  return isRecord(value) && value.duringTargetPhase === true;
}

async function runDocumentPipelineBisectDiagnostic(): Promise<void> {
  const trace = createDocumentPipelineTraceState();
  let applicationBoot: Record<string, unknown>;
  try {
    applicationBoot = await runFullApplicationBoot({
      diagnosticVariant: DOCUMENT_PIPELINE_VARIANT,
      diagnosticTestId: DOCUMENT_PIPELINE_TEST,
      documentPipelineTrace: trace,
    });
  } catch (applicationError) {
    const traceSummary = documentPipelineTraceSummary(trace);
    let verdict = "document-pipeline-inconclusive";
    let conclusion = "The real document-pipeline path failed without a complete native-call classification.";
    const unmatchedStartedCall = trace.startedCallCount
      > trace.completedCallCount + trace.failedCallCount;
    if (unmatchedStartedCall) {
      verdict = "document-gpu-call-interrupted";
      conclusion = "The last recorded native document-pipeline call started but did not report completion.";
    } else if (trace.lastFailedCall !== null) {
      verdict = "document-gpu-call-failed";
      conclusion = "A native WebGPU call failed inside the real document-pipeline phase.";
    } else if (trace.lastScopeError !== null) {
      verdict = "document-pipeline-error-scope-failure";
      conclusion = "The document-pipeline validation or memory scope reported an error after the synchronous calls returned.";
    } else if (occurredDuringDocumentPipeline(trace.deviceLost)) {
      verdict = "document-pipeline-device-lost";
      conclusion = "The WebGPU device was lost while the real document-pipeline path was running.";
    } else if (occurredDuringDocumentPipeline(trace.uncapturedError)) {
      verdict = "document-pipeline-uncaptured-error";
      conclusion = "The real document-pipeline path produced an uncaptured WebGPU error.";
    } else if (documentPipelineNativeCallsCompleted(trace)) {
      verdict = "document-pipelines-passed-later-startup-failed";
      conclusion = "All real document pipelines passed; the application failed later in startup.";
    } else if (trace.deviceLost !== null || trace.uncapturedError !== null) {
      verdict = "startup-failed-outside-document-pipelines";
      conclusion = "A WebGPU error occurred before or outside the target document-pipeline phase.";
    } else if (trace.startedCallCount === 0) {
      verdict = "startup-failed-before-document-pipelines";
      conclusion = "Startup failed before the first instrumented document-pipeline call was observed.";
    }
    await checkpoint(
      "environment-captured-after-document-pipeline-failure",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict,
      conclusion,
      applicationError: compactDocumentPipelineError(describeError(applicationError)),
      documentPipelineTrace: traceSummary,
    });
    return;
  }

  const traceSummary = documentPipelineTraceSummary(trace);
  if (!documentPipelineTracePassed(trace)) {
    let verdict = "document-pipeline-instrumentation-inconclusive";
    let conclusion = "The application opened, but the document-pipeline instrumentation did not observe the complete expected path.";
    if (occurredDuringDocumentPipeline(trace.deviceLost)) {
      verdict = "document-pipeline-device-lost";
      conclusion = "The WebGPU device was lost during the real document-pipeline phase.";
    } else if (occurredDuringDocumentPipeline(trace.uncapturedError)) {
      verdict = "document-pipeline-uncaptured-error";
      conclusion = "The real document-pipeline phase produced an uncaptured WebGPU error.";
    } else if (
      documentPipelineNativeCallsCompleted(trace)
      && (trace.deviceLost !== null || trace.uncapturedError !== null)
    ) {
      verdict = "document-pipelines-passed-outside-gpu-error";
      conclusion = "All real document-pipeline calls passed, but a WebGPU error was observed outside the target phase.";
    }
    await checkpoint(
      "environment-captured-after-document-pipeline-inconclusive",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict,
      conclusion,
      documentPipelineTrace: traceSummary,
      applicationBoot: documentPipelineApplicationSummary(applicationBoot),
    });
    return;
  }

  await checkpoint(
    "environment-captured-after-document-pipeline-pass",
    await captureHighEntropyEnvironment(),
  );
  await bridge.finish("completed", "diagnostic-completed", {
    ...comparisonPolicy(),
    verdict: "document-pipelines-passed",
    conclusion: "All 17 real pipeline layouts, 52 synchronous render pipelines, and both final error-scope drains passed with Tier 2 disabled.",
    documentWidth: DIAGNOSTIC_DOCUMENT_WIDTH,
    documentHeight: DIAGNOSTIC_DOCUMENT_HEIGHT,
    documentPipelineTrace: traceSummary,
    applicationBoot: documentPipelineApplicationSummary(applicationBoot),
  });
}

const REQUIRED_APPLICATION_4096_STARTUP_PHASES = [
  "document-display-textures",
  "document-layer-texture",
  "document-bindings",
  "first-frame-submit",
  "first-frame-gpu",
  "editor-ready",
] as const;
const REQUIRED_APPLICATION_4096_ASYNC2_STARTUP_PHASES = [
  "document-pipelines",
  ...REQUIRED_APPLICATION_4096_STARTUP_PHASES,
] as const;

function applicationStartupTraceSummary(
  trace: ApplicationStartupTraceState,
): Record<string, unknown> {
  return {
    lastProgress: trace.lastProgress,
    phaseStates: { ...trace.phaseStates },
    documentPipelinesPhase: trace.phaseProgress["document-pipelines"] ?? null,
    editorReadyPhase: trace.phaseProgress["editor-ready"] ?? null,
    requiredPhaseStates: Object.fromEntries(
      REQUIRED_APPLICATION_4096_STARTUP_PHASES.map((phase) => [
        phase,
        trace.phaseStates[phase] ?? null,
      ]),
    ),
    deviceLost: trace.deviceLost,
    uncapturedError: trace.uncapturedError,
    gpuObservation: {
      installed: trace.observationInstalled,
      requestDeviceObserved: trace.requestDeviceObserved,
      adapterCount: trace.adapterCount,
      deviceCount: trace.deviceCount,
      requiredFeatures: trace.requiredFeatures,
      textureFormatsTier2Enabled: trace.textureFormatsTier2Enabled,
    },
  };
}

function validateAsyncPipelineCompilation(
  trace: ApplicationStartupTraceState,
  requestedConcurrency = 2,
): Record<string, unknown> {
  const phase = trace.phaseProgress["document-pipelines"] ?? null;
  const stats = isRecord(phase?.detail) ? phase.detail : null;
  const issues: string[] = [];
  const expect = (condition: boolean, issue: string): void => {
    if (!condition) issues.push(issue);
  };
  expect(phase?.state === "completed", "document-pipelines did not complete");
  expect(stats !== null, "document-pipelines did not report compilation statistics");
  if (stats) {
    expect(stats.format === "rgba16float", "pipeline format was not rgba16float");
    expect(stats.strategy === "async-bounded", "strategy was not async-bounded");
    expect(
      stats.requestedConcurrency === requestedConcurrency,
      `requested concurrency was not ${requestedConcurrency}`,
    );
    expect(stats.nativeAsyncSupported === true, "native createRenderPipelineAsync was unavailable");
    expect(
      stats.expectedRenderPipelineCount === EXPECTED_DOCUMENT_RENDER_PIPELINES,
      "expected render-pipeline count was not 52",
    );
    for (const field of ["scheduledCount", "startedCount", "completedCount", "settledCount"]) {
      expect(stats[field] === EXPECTED_DOCUMENT_RENDER_PIPELINES, `${field} was not 52`);
    }
    expect(stats.failedCount === 0, "one or more render pipelines failed");
    expect(stats.activeCount === 0, "render-pipeline work remained active after the phase");
    expect(stats.fallbackCount === 0, "a synchronous fallback was used");
    const peakActiveCount = stats.peakActiveCount;
    expect(
      typeof peakActiveCount === "number"
        && Number.isInteger(peakActiveCount)
        && peakActiveCount === requestedConcurrency,
      `peak active render-pipeline work did not reach the requested concurrency of ${requestedConcurrency}`,
    );
  }
  return {
    passed: issues.length === 0,
    issues,
    phase,
    stats,
  };
}

function validateFirstFramePipelineCompilation(
  trace: ApplicationStartupTraceState,
): Record<string, unknown> {
  const phase = trace.phaseProgress["document-pipelines"] ?? null;
  const stats = isRecord(phase?.detail) ? phase.detail : null;
  const issues: string[] = [];
  const expect = (condition: boolean, issue: string): void => {
    if (!condition) issues.push(issue);
  };
  expect(phase?.state === "completed", "document-pipelines did not complete");
  expect(stats !== null, "document-pipelines did not report compilation statistics");
  if (stats) {
    expect(
      stats.scope === "first-frame-diagnostic",
      "pipeline compilation scope was not first-frame-diagnostic",
    );
    expect(stats.strategy === "sync-sequential", "strategy was not sync-sequential");
    expect(stats.requestedConcurrency === 1, "requested concurrency was not 1");
    expect(
      typeof stats.nativeAsyncSupported === "boolean",
      "native async support was not reported as a boolean",
    );
    expect(
      stats.expectedRenderPipelineCount === EXPECTED_FIRST_FRAME_RENDER_PIPELINES,
      "expected render-pipeline count was not 1",
    );
    expect(
      stats.logicalRenderPipelineCount === EXPECTED_DOCUMENT_RENDER_PIPELINES,
      "logical render-pipeline count was not 52",
    );
    expect(
      stats.excludedRenderPipelineCount
        === EXPECTED_DOCUMENT_RENDER_PIPELINES - EXPECTED_FIRST_FRAME_RENDER_PIPELINES,
      "excluded render-pipeline count was not 51",
    );
    expect(
      Array.isArray(stats.compiledPipelineKeys)
        && stats.compiledPipelineKeys.length === 1
        && stats.compiledPipelineKeys[0] === "paint-mip-downsample",
      "the compiled first-frame pipeline key was not paint-mip-downsample",
    );
    for (const field of ["scheduledCount", "startedCount", "completedCount", "settledCount"]) {
      expect(stats[field] === EXPECTED_FIRST_FRAME_RENDER_PIPELINES, `${field} was not 1`);
    }
    expect(stats.failedCount === 0, "the first-frame render pipeline failed");
    expect(stats.activeCount === 0, "render-pipeline work remained active after the phase");
    expect(stats.fallbackCount === 0, "a synchronous fallback was used");
    expect(stats.peakActiveCount === 1, "peak active render-pipeline work was not 1");
  }
  return {
    passed: issues.length === 0,
    issues,
    phase,
    stats,
  };
}

interface Application4096DiagnosticOptions {
  readonly asynchronousPipelineCompilation?: boolean;
  readonly firstFramePipelineCompilation?: boolean;
}

async function runApplication4096StartupDiagnostic(
  options: Application4096DiagnosticOptions = {},
): Promise<void> {
  const asynchronousPipelineCompilation = options.asynchronousPipelineCompilation === true;
  const firstFramePipelineCompilation = options.firstFramePipelineCompilation === true;
  if (asynchronousPipelineCompilation && firstFramePipelineCompilation) {
    throw new Error("Pipeline startup diagnostic modes are mutually exclusive.");
  }
  const diagnosticVariant = firstFramePipelineCompilation
    ? APPLICATION_4096_PIPELINES_FIRST_FRAME_VARIANT
    : asynchronousPipelineCompilation
      ? APPLICATION_4096_PIPELINES_ASYNC2_VARIANT
      : APPLICATION_4096_VARIANT;
  const diagnosticTestId = firstFramePipelineCompilation
    ? APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST
    : asynchronousPipelineCompilation
      ? APPLICATION_4096_PIPELINES_ASYNC2_TEST
      : APPLICATION_4096_TEST;
  const requiredStartupPhases = asynchronousPipelineCompilation || firstFramePipelineCompilation
    ? REQUIRED_APPLICATION_4096_ASYNC2_STARTUP_PHASES
    : REQUIRED_APPLICATION_4096_STARTUP_PHASES;
  const startupTrace = createApplicationStartupTraceState();
  let applicationBoot: Record<string, unknown>;
  try {
    applicationBoot = await runFullApplicationBoot({
      diagnosticVariant,
      diagnosticTestId,
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
      requiredStartupPhases,
      requireStorageSummary: true,
      requireGpuObservation: true,
      startupTrace,
    });
  } catch (applicationError) {
    const describedError = describeError(applicationError);
    const serializedError = JSON.stringify(describedError).toLowerCase();
    const lastProgress = startupTrace.lastProgress;
    const explicitlyFailedPhase = Object.entries(startupTrace.phaseStates)
      .find(([, state]) => state === "failed")?.[0] ?? null;
    const startedRequiredPhase = requiredStartupPhases.find(
      (phase) => startupTrace.phaseStates[phase] === "started",
    ) ?? null;
    const missingRequiredPhase = requiredStartupPhases.find(
      (phase) => startupTrace.phaseStates[phase] !== "completed",
    ) ?? null;
    const activeDevicePhase = isRecord(startupTrace.deviceLost)
      && typeof startupTrace.deviceLost.activePhase === "string"
      ? startupTrace.deviceLost.activePhase
      : isRecord(startupTrace.uncapturedError)
        && typeof startupTrace.uncapturedError.activePhase === "string"
        ? startupTrace.uncapturedError.activePhase
        : null;
    const failedPhase = explicitlyFailedPhase
      ?? activeDevicePhase
      ?? startedRequiredPhase
      ?? missingRequiredPhase
      ?? (typeof lastProgress?.phase === "string" ? lastProgress.phase : null);
    const lastPhaseState = typeof lastProgress?.state === "string"
      ? lastProgress.state
      : null;
    let verdict = "application-4096-startup-failed";
    let conclusion = "The real 4096x4096 application document did not complete startup.";
    if (
      asynchronousPipelineCompilation
      && /native createrenderpipelineasync is required|createrenderpipelineasync[^.]*unavailable/.test(
        serializedError,
      )
    ) {
      verdict = "application-4096-pipelines-async2-unsupported";
      conclusion = "This run is inconclusive because native createRenderPipelineAsync was unavailable and no synchronous fallback was allowed.";
    } else if (startupTrace.deviceLost !== null) {
      verdict = "application-4096-device-lost";
      conclusion = "The WebGPU device was lost while the real 4096x4096 application document was starting.";
    } else if (startupTrace.uncapturedError !== null) {
      verdict = "application-4096-uncaptured-error";
      conclusion = "The real 4096x4096 application document produced an uncaptured WebGPU error.";
    } else if (/out[- ]of[- ]memory|\boom\b|gpuoutofmemoryerror/.test(serializedError)) {
      verdict = "application-4096-out-of-memory";
      conclusion = "The real 4096x4096 application document failed with explicit out-of-memory evidence.";
    } else if (/maxtexturedimension2d|texture limit|dimension.*4096|4096.*dimension/.test(serializedError)) {
      verdict = "application-4096-limit-rejected";
      conclusion = "A reported WebGPU or document-dimension limit rejected the real 4096x4096 startup.";
    } else if (
      lastPhaseState === "completed"
      && !applicationGpuObservationPassed(startupTrace)
    ) {
      verdict = "application-4096-inconclusive";
      conclusion = "The application advanced, but the diagnostic device observer did not prove a clean 4096x4096 run.";
    } else if (startedRequiredPhase !== null || lastPhaseState === "started") {
      verdict = "application-4096-startup-interrupted";
      conclusion = "The real 4096x4096 application document stopped during an identified startup phase.";
    }
    await checkpoint(
      "environment-captured-after-application-4096-failure",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict,
      conclusion,
      failedPhase,
      applicationError: describedError,
      startupTrace: applicationStartupTraceSummary(startupTrace),
      ...(asynchronousPipelineCompilation
        ? { asyncPipelineCompilation: validateAsyncPipelineCompilation(startupTrace) }
        : firstFramePipelineCompilation
          ? { firstFramePipelineCompilation: validateFirstFramePipelineCompilation(startupTrace) }
          : {}),
    });
    return;
  }

  const asyncPipelineCompilation = asynchronousPipelineCompilation
    ? validateAsyncPipelineCompilation(startupTrace)
    : null;
  const firstFramePipelineCompilationResult = firstFramePipelineCompilation
    ? validateFirstFramePipelineCompilation(startupTrace)
    : null;
  if (
    asyncPipelineCompilation
    && asyncPipelineCompilation.passed !== true
  ) {
    await checkpoint(
      "environment-captured-after-application-4096-async-pipeline-inconclusive",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict: "application-4096-pipelines-async2-inconclusive",
      conclusion: "The real 4096x4096 application opened, but the bounded asynchronous pipeline contract was not fully observed.",
      asyncPipelineCompilation,
      startupTrace: applicationStartupTraceSummary(startupTrace),
      applicationBoot: documentPipelineApplicationSummary(applicationBoot),
    });
    return;
  }
  if (
    firstFramePipelineCompilationResult
    && firstFramePipelineCompilationResult.passed !== true
  ) {
    await checkpoint(
      "environment-captured-after-application-4096-first-frame-pipeline-inconclusive",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict: "application-4096-pipelines-first-frame-inconclusive",
      conclusion: "The real 4096x4096 application opened, but the one-pipeline first-frame contract was not fully observed.",
      firstFramePipelineCompilation: firstFramePipelineCompilationResult,
      startupTrace: applicationStartupTraceSummary(startupTrace),
      applicationBoot: documentPipelineApplicationSummary(applicationBoot),
    });
    return;
  }

  await checkpoint(
    "environment-captured-after-application-4096-pass",
    await captureHighEntropyEnvironment(),
  );
  await bridge.finish("completed", "diagnostic-completed", {
    ...comparisonPolicy(),
    verdict: firstFramePipelineCompilation
      ? "application-4096-pipelines-first-frame-passed"
      : asynchronousPipelineCompilation
        ? "application-4096-pipelines-async2-passed"
        : "application-4096-startup-passed",
    conclusion: firstFramePipelineCompilation
      ? "The real 4096x4096 empty application completed its first GPU frame after compiling only the one document render pipeline that frame uses."
      : asynchronousPipelineCompilation
        ? "The real 4096x4096 application completed startup after all 52 render pipelines settled through the native bounded asynchronous path."
        : "The real 4096x4096 application document completed its first GPU frame and remained ready for five seconds.",
    rgba16floatLayerBytes: APPLICATION_4096_DOCUMENT_WIDTH
      * APPLICATION_4096_DOCUMENT_HEIGHT
      * RGBA16FLOAT_BYTES_PER_PIXEL,
    startupTrace: applicationStartupTraceSummary(startupTrace),
    ...(asyncPipelineCompilation ? { asyncPipelineCompilation } : {}),
    ...(firstFramePipelineCompilationResult
      ? { firstFramePipelineCompilation: firstFramePipelineCompilationResult }
      : {}),
    applicationBoot: documentPipelineApplicationSummary(applicationBoot),
  });
}

function documentPipelineBreakdownPassed(
  trace: DocumentPipelineTraceState,
  breakdown: Record<string, unknown>,
  renderPipelineMethod: "createRenderPipeline" | "createRenderPipelineAsync",
): boolean {
  const completedCalls = trace.calls.filter((call) => call.state === "completed");
  const sequentialIndexes = (
    method: string,
    indexKey: "pipelineLayoutIndex" | "renderPipelineIndex" | "errorScopeDrainIndex",
    expectedCount: number,
  ): boolean => {
    const calls = completedCalls.filter((call) => call.method === method);
    return calls.length === expectedCount && calls.every((call, index) => (
      call[indexKey] === index + 1
      && typeof call.durationMs === "number"
      && Number.isFinite(call.durationMs)
      && call.durationMs >= 0
    ));
  };
  return documentPipelineTracePassed(trace)
    && firstUseSequencePassed(trace)
    && sequentialIndexes(
      "createPipelineLayout",
      "pipelineLayoutIndex",
      EXPECTED_DOCUMENT_PIPELINE_LAYOUTS,
    )
    && sequentialIndexes(
      renderPipelineMethod,
      "renderPipelineIndex",
      EXPECTED_DOCUMENT_RENDER_PIPELINES,
    )
    && sequentialIndexes(
      "popErrorScope",
      "errorScopeDrainIndex",
      EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS,
    )
    && breakdown.measuredCallCount === (
      EXPECTED_DOCUMENT_PIPELINE_LAYOUTS
      + EXPECTED_DOCUMENT_RENDER_PIPELINES
      + EXPECTED_DOCUMENT_ERROR_SCOPE_DRAINS
    )
    && typeof breakdown.phaseElapsedMs === "number"
    && typeof breakdown.nativeCallTotalMs === "number"
    && breakdown.nativeCallTotalMs <= breakdown.phaseElapsedMs + 0.1;
}

async function runApplication4096PipelineBreakdownDiagnostic(): Promise<void> {
  const firstUseControlsEnabled = application4096PipelineFirstUseControlsEnabled;
  const cleanQueueCoreEnabled = application4096CleanQueueCoreEnabled;
  const attributionEnabled = application4096PipelineAttributionEnabled
    || firstUseControlsEnabled
    || cleanQueueCoreEnabled;
  const diagnosticVariant = cleanQueueCoreEnabled
    ? APPLICATION_4096_CLEAN_QUEUE_CORE_VARIANT
    : firstUseControlsEnabled
      ? APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_VARIANT
      : attributionEnabled
        ? APPLICATION_4096_PIPELINE_ATTRIBUTION_VARIANT
        : APPLICATION_4096_PIPELINE_BREAKDOWN_VARIANT;
  const diagnosticTestId = cleanQueueCoreEnabled
    ? APPLICATION_4096_CLEAN_QUEUE_CORE_TEST
    : firstUseControlsEnabled
      ? APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_TEST
      : attributionEnabled
        ? APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST
        : APPLICATION_4096_PIPELINE_BREAKDOWN_TEST;
  const renderPipelineMethod = attributionEnabled
    ? "createRenderPipelineAsync"
    : "createRenderPipeline";
  const verdictPrefix = cleanQueueCoreEnabled
    ? "application-4096-clean-queue-core-attribution"
    : firstUseControlsEnabled
      ? "application-4096-pipeline-first-use-controls"
      : attributionEnabled
        ? "application-4096-pipeline-attribution"
        : "application-4096-pipeline-breakdown";
  const documentPipelineTrace = createDocumentPipelineTraceState();
  const startupTrace = createApplicationStartupTraceState();
  const displayAttributionTrace = (): void => {
    if (!attributionEnabled) return;
    bridge.displayBatch?.(documentPipelineTrace.calls);
    if (firstUseControlsEnabled) {
      bridge.display?.(
        "application-document-pipeline-first-use-sequence",
        firstUseSequenceSummary(documentPipelineTrace),
      );
    }
    if (cleanQueueCoreEnabled) {
      bridge.display?.(
        "application-clean-queue-core-attribution",
        cleanQueueCoreAttributionSummary(documentPipelineTrace),
      );
    }
  };
  let applicationBoot: Record<string, unknown>;
  try {
    applicationBoot = await runFullApplicationBoot({
      diagnosticVariant,
      diagnosticTestId,
      documentPipelineTrace,
      documentWidth: APPLICATION_4096_DOCUMENT_WIDTH,
      documentHeight: APPLICATION_4096_DOCUMENT_HEIGHT,
      requiredStartupPhases: REQUIRED_APPLICATION_4096_ASYNC2_STARTUP_PHASES,
      requireStorageSummary: true,
      requireGpuObservation: true,
      startupTrace,
    });
  } catch (applicationError) {
    displayAttributionTrace();
    const phase = startupTrace.phaseProgress["document-pipelines"] ?? null;
    const breakdown = documentPipelineBreakdownSummary(
      documentPipelineTrace,
      phase?.phaseElapsedMs ?? null,
    );
    await checkpoint(
      "environment-captured-after-application-4096-pipeline-breakdown-failure",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict: `${verdictPrefix}-failed`,
      conclusion: "The 4096x4096 application did not complete the measured document-pipeline path.",
      applicationError: compactDocumentPipelineError(describeError(applicationError)),
      pipelineBreakdown: breakdown,
      ...(firstUseControlsEnabled
        ? { firstUseSequence: firstUseSequenceSummary(documentPipelineTrace) }
        : {}),
      ...(cleanQueueCoreEnabled
        ? { cleanQueueCoreAttribution: cleanQueueCoreAttributionSummary(documentPipelineTrace) }
        : {}),
      documentPipelineTrace: documentPipelineTraceSummary(documentPipelineTrace),
      startupTrace: applicationStartupTraceSummary(startupTrace),
    });
    return;
  }

  displayAttributionTrace();
  const phase = startupTrace.phaseProgress["document-pipelines"] ?? null;
  const breakdown = documentPipelineBreakdownSummary(
    documentPipelineTrace,
    phase?.phaseElapsedMs ?? null,
  );
  const asyncPipelineCompilation = attributionEnabled
    ? validateAsyncPipelineCompilation(startupTrace, 1)
    : null;
  if (
    !documentPipelineBreakdownPassed(documentPipelineTrace, breakdown, renderPipelineMethod)
    || !cleanQueueCoreAttributionPassed(documentPipelineTrace)
    || (asyncPipelineCompilation !== null && asyncPipelineCompilation.passed !== true)
  ) {
    await checkpoint(
      "environment-captured-after-application-4096-pipeline-breakdown-inconclusive",
      await captureHighEntropyEnvironment(),
    );
    await bridge.finish("failed", "diagnostic-failed", {
      ...comparisonPolicy(),
      verdict: `${verdictPrefix}-inconclusive`,
      conclusion: attributionEnabled
        ? cleanQueueCoreEnabled
          ? "The application opened, but the blocking empty-queue RGBA16F probe, complete core readiness ladder, drained-queue baseline, and 52-pipeline contract were not all observed."
          : firstUseControlsEnabled
            ? "The application opened, but the complete three-step first-use control sequence and 52-pipeline attribution contract were not observed."
            : "The application opened, but the complete non-overlapping 52-pipeline attribution contract was not observed."
        : "The application opened, but the complete 71-call timing contract was not observed.",
      pipelineBreakdown: breakdown,
      ...(firstUseControlsEnabled
        ? { firstUseSequence: firstUseSequenceSummary(documentPipelineTrace) }
        : {}),
      ...(cleanQueueCoreEnabled
        ? { cleanQueueCoreAttribution: cleanQueueCoreAttributionSummary(documentPipelineTrace) }
        : {}),
      ...(asyncPipelineCompilation ? { asyncPipelineCompilation } : {}),
      documentPipelineTrace: documentPipelineTraceSummary(documentPipelineTrace),
      startupTrace: applicationStartupTraceSummary(startupTrace),
      applicationBoot: documentPipelineApplicationSummary(applicationBoot),
    });
    return;
  }

  await checkpoint(
    "environment-captured-after-application-4096-pipeline-breakdown-pass",
    await captureHighEntropyEnvironment(),
  );
  await bridge.finish("completed", "diagnostic-completed", {
    ...comparisonPolicy(),
    verdict: `${verdictPrefix}-passed`,
    conclusion: attributionEnabled
      ? cleanQueueCoreEnabled
        ? "The blocking empty-queue RGBA16F probe completed before the application received its device; the three core render pipelines, drained-queue baseline, and all 52 document pipelines were then observed separately."
        : firstUseControlsEnabled
          ? "The independent control, shared brush-module control, original Eraser pipeline, and all 52 application render pipelines were timed sequentially without overlap during the isolated 4096x4096 startup."
          : "All 52 native asynchronous render pipelines were compiled one at a time and timed without overlap during the isolated 4096x4096 startup."
      : "All 17 layouts, 52 synchronous render pipelines, and two error-scope drains were timed individually during the real 4096x4096 startup.",
    pipelineBreakdown: breakdown,
    ...(firstUseControlsEnabled
      ? { firstUseSequence: firstUseSequenceSummary(documentPipelineTrace) }
      : {}),
    ...(cleanQueueCoreEnabled
      ? { cleanQueueCoreAttribution: cleanQueueCoreAttributionSummary(documentPipelineTrace) }
      : {}),
    ...(asyncPipelineCompilation ? { asyncPipelineCompilation } : {}),
    startupTrace: applicationStartupTraceSummary(startupTrace),
    applicationBoot: documentPipelineApplicationSummary(applicationBoot),
  });
}

async function run(): Promise<void> {
  await checkpoint("diagnostic-module-started", {
    build: bridge.build,
    runCodeSuffix: bridge.runCode.slice(-8),
    ...comparisonPolicy(),
  }, "running", "beacon");
  if (
    diagnosticTest
    && diagnosticTest !== STORAGE_FORMAT_AB_TEST
    && diagnosticTest !== DOCUMENT_PIPELINE_TEST
    && diagnosticTest !== APPLICATION_4096_TEST
    && diagnosticTest !== APPLICATION_4096_PIPELINES_ASYNC2_TEST
    && diagnosticTest !== APPLICATION_4096_PIPELINES_FIRST_FRAME_TEST
    && diagnosticTest !== APPLICATION_4096_PIPELINE_BREAKDOWN_TEST
    && diagnosticTest !== APPLICATION_4096_PIPELINE_ATTRIBUTION_TEST
    && diagnosticTest !== APPLICATION_4096_PIPELINE_FIRST_USE_CONTROLS_TEST
    && diagnosticTest !== APPLICATION_4096_CLEAN_QUEUE_CORE_TEST
  ) {
    throw new Error(`Unsupported GPU diagnostic test: ${diagnosticTest}.`);
  }
  if (storageFormatAbEnabled) {
    await runStorageFormatAbDiagnostic();
    return;
  }
  if (documentPipelineBisectEnabled) {
    await runDocumentPipelineBisectDiagnostic();
    return;
  }
  if (application4096StartupEnabled) {
    await runApplication4096StartupDiagnostic();
    return;
  }
  if (application4096PipelinesAsync2Enabled) {
    await runApplication4096StartupDiagnostic({ asynchronousPipelineCompilation: true });
    return;
  }
  if (application4096PipelinesFirstFrameEnabled) {
    await runApplication4096StartupDiagnostic({ firstFramePipelineCompilation: true });
    return;
  }
  if (application4096PipelineTimingEnabled) {
    await runApplication4096PipelineBreakdownDiagnostic();
    return;
  }
  let applicationBoot: Record<string, unknown>;
  try {
    applicationBoot = await runFullApplicationBoot();
  } catch (applicationError) {
    await checkpoint("environment-captured-after-app-failure", await captureHighEntropyEnvironment());
    await checkpoint("application-boot-failed", {
      ...comparisonPolicy(),
      error: describeError(applicationError),
      nextStep: "Run the isolated WebGPU probe after the failed cold application boot.",
    }, "failed", "beacon");
    try {
      await runDirectWebGpuProbe();
      await bridge.finish("failed", "diagnostic-failed", {
        ...comparisonPolicy(),
        conclusion: "The no-Tier-2 application startup failed, but the follow-up advertised-Tier-2 baseline probe passed.",
        applicationError: describeError(applicationError),
        isolatedProbeVariant: "advertised-tier2-baseline",
        isolatedProbeCompleted: true,
      });
    } catch (probeError) {
      await bridge.finish("failed", "diagnostic-failed", {
        ...comparisonPolicy(),
        conclusion: "Both the no-Tier-2 application startup and the follow-up advertised-Tier-2 baseline probe failed.",
        applicationError: describeError(applicationError),
        isolatedProbeError: describeError(probeError),
        isolatedProbeVariant: "advertised-tier2-baseline",
        isolatedProbeCompleted: false,
      });
    }
    return;
  }

  await checkpoint("environment-captured-after-app-boot", await captureHighEntropyEnvironment());
  await bridge.finish("completed", "diagnostic-completed", {
    ...comparisonPolicy(),
    conclusion: "The cold full application remained ready through its deferred startup window.",
    documentWidth: DIAGNOSTIC_DOCUMENT_WIDTH,
    documentHeight: DIAGNOSTIC_DOCUMENT_HEIGHT,
    applicationBoot,
  });
}

try {
  await run();
} catch (error) {
  await bridge.finish("failed", "diagnostic-failed", {
    ...comparisonPolicy(),
    error: describeError(error),
  });
}
