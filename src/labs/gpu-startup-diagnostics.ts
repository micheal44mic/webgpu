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
const diagnosticTest = new URLSearchParams(window.location.search).get("test");
const storageFormatAbEnabled = diagnosticTest === STORAGE_FORMAT_AB_TEST;

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
          @group(0) @binding(0) var target: texture_storage_2d<${format}, write>;
          @compute @workgroup_size(1)
          fn main() {
            textureStore(target, vec2<i32>(0, 0), vec4<f32>(1.0, 0.25, 0.0, 1.0));
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
          @group(0) @binding(0) var target: texture_storage_2d<rgba16float, write>;
          @compute @workgroup_size(1)
          fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            textureStore(target, vec2<i32>(id.xy), vec4<f32>(1.0, 0.25, 0.0, 1.0));
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

function validateApplicationEngineReport(detail: unknown): Record<string, unknown> {
  if (!isRecord(detail)) {
    throw new Error("The application frame did not provide a structured engine report.");
  }

  const documentWidth = readOptionalFiniteNumber(detail, "documentWidth");
  const documentHeight = readOptionalFiniteNumber(detail, "documentHeight");
  if (
    documentWidth !== DIAGNOSTIC_DOCUMENT_WIDTH
    || documentHeight !== DIAGNOSTIC_DOCUMENT_HEIGHT
  ) {
    throw new Error(
      `The application engine initialized ${String(documentWidth)}x${String(documentHeight)} instead of `
        + `${DIAGNOSTIC_DOCUMENT_WIDTH}x${DIAGNOSTIC_DOCUMENT_HEIGHT}.`,
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
  if (detail.diagnosticVariant !== APPLICATION_BOOT_VARIANT) {
    throw new Error(
      `The application frame reported variant ${String(detail.diagnosticVariant)} instead of `
        + `${APPLICATION_BOOT_VARIANT}.`,
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

  const expectedLayerMiB = DIAGNOSTIC_DOCUMENT_WIDTH
    * DIAGNOSTIC_DOCUMENT_HEIGHT
    * RGBA16FLOAT_BYTES_PER_PIXEL
    / (1024 * 1024);
  const layerCount = readOptionalFiniteNumber(detail, "layerCount");
  if (layerCount !== null && (!Number.isInteger(layerCount) || layerCount !== 1)) {
    throw new Error(`The isolated application initialized ${layerCount} layers instead of one.`);
  }

  const storageValue = detail.storage;
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
      throw new Error("The active layer's raw storage does not match one full 2048 RGBA16F layer.");
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
      throw new Error("The reported tile geometry does not cover one full 2048 RGBA16F layer.");
    }

    const layerMemoryMiB = readOptionalFiniteNumber(detail, "layerMemoryMiB");
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

async function runFullApplicationBoot(): Promise<Record<string, unknown>> {
  const frame = document.getElementById("gpuDiagnosticAppFrame") as HTMLIFrameElement | null;
  if (!frame) throw new Error("The isolated application frame is missing.");

  const target = new URL("/gpu-startup-app-frame", window.location.origin);
  target.searchParams.set("diagnosticBoot", "1");
  target.searchParams.set("documentWidth", String(DIAGNOSTIC_DOCUMENT_WIDTH));
  target.searchParams.set("documentHeight", String(DIAGNOSTIC_DOCUMENT_HEIGHT));
  target.searchParams.set("documentSize", String(DIAGNOSTIC_DOCUMENT_WIDTH));
  target.searchParams.set("deviceClass", "mobile");
  target.searchParams.set("diagnosticVariant", APPLICATION_BOOT_VARIANT);
  target.searchParams.set("forceGlazeCommitFallback", "1");
  let bootstrapReady = false;
  let extensionCreated = false;
  let engineReport: Record<string, unknown> | null = null;
  let applicationRuntimeError: unknown = null;
  const applicationConsoleErrors: unknown[] = [];
  let frameMessageCount = 0;
  let lastStartupProgress: Record<string, unknown> | null = null;
  let observer: MutationObserver | null = null;

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
      void bridge.record("application-startup-phase", detail, "running", "beacon");
      return;
    }
    if (type === "engine-ready") {
      void bridge.record("application-frame-engine-ready", detail, "running", "beacon");
      try {
        engineReport = validateApplicationEngineReport(detail);
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
      documentWidth: DIAGNOSTIC_DOCUMENT_WIDTH,
      documentHeight: DIAGNOSTIC_DOCUMENT_HEIGHT,
      deviceClass: "mobile",
      persistedProjectRestore: false,
      persistedBrushRestore: true,
      reporterChannel: APP_FRAME_DIAGNOSTIC_CHANNEL,
      diagnosticVariant: APPLICATION_BOOT_VARIANT,
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

    // The injected reporter is installed before the application module. These
    // listeners remain as a same-origin fallback for failures after document load.
    frameWindow.addEventListener("error", (event) => {
      applicationRuntimeError = event.error ?? new Error(event.message);
      void bridge.record("application-window-error-fallback", {
        message: event.message,
        source: event.filename ? event.filename.split("/").pop() : null,
        line: event.lineno,
        column: event.colno,
        error: describeError(event.error),
      }, "failed", "beacon");
    });
    frameWindow.addEventListener("unhandledrejection", (event) => {
      applicationRuntimeError = event.reason;
      void bridge.record("application-unhandled-rejection-fallback", {
        error: describeError(event.reason),
      }, "failed", "beacon");
    });

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
      if (
        engineReady
        && state.projectSessionReady === true
        && bootstrapReady
        && extensionCreated
        && engineReport !== null
      ) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 5_000));
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
        const observedEngineReport = validateApplicationEngineReport(engineReport);
        const result = {
          ...completedState,
          ...compactFrameResourceSummary(frame),
          reporter: {
            channel: APP_FRAME_DIAGNOSTIC_CHANNEL,
            bootstrapReady,
            extensionCreated,
            frameMessageCount,
            lastStartupProgress,
          },
          engine: observedEngineReport,
          rgba16floatLayerBytes: DIAGNOSTIC_DOCUMENT_WIDTH
            * DIAGNOSTIC_DOCUMENT_HEIGHT
            * RGBA16FLOAT_BYTES_PER_PIXEL,
          deferredStartupObservationMs: 5_000,
        };
        await checkpoint("application-boot-completed", result);
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
        timeoutMs: APPLICATION_BOOT_TIMEOUT_MS,
      })}`,
    );
  } finally {
    observer?.disconnect();
    window.removeEventListener("message", handleFrameMessage);
    frame.remove();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
  }
}

async function run(): Promise<void> {
  await checkpoint("diagnostic-module-started", {
    build: bridge.build,
    runCodeSuffix: bridge.runCode.slice(-8),
    ...comparisonPolicy(),
  }, "running", "beacon");
  if (diagnosticTest && diagnosticTest !== STORAGE_FORMAT_AB_TEST) {
    throw new Error(`Unsupported GPU diagnostic test: ${diagnosticTest}.`);
  }
  if (storageFormatAbEnabled) {
    await runStorageFormatAbDiagnostic();
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
