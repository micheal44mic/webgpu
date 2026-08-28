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

function readSupportedLimits(limits: GPUSupportedLimits): Record<string, number> {
  const names = new Set<string>([
    ...Object.keys(limits),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(limits) ?? {}),
    "maxTextureDimension1D",
    "maxTextureDimension2D",
    "maxTextureDimension3D",
    "maxTextureArrayLayers",
    "maxBindGroups",
    "maxBindGroupsPlusVertexBuffers",
    "maxBindingsPerBindGroup",
    "maxDynamicUniformBuffersPerPipelineLayout",
    "maxDynamicStorageBuffersPerPipelineLayout",
    "maxSampledTexturesPerShaderStage",
    "maxSamplersPerShaderStage",
    "maxStorageBuffersPerShaderStage",
    "maxStorageTexturesPerShaderStage",
    "maxUniformBuffersPerShaderStage",
    "maxUniformBufferBindingSize",
    "maxStorageBufferBindingSize",
    "minUniformBufferOffsetAlignment",
    "minStorageBufferOffsetAlignment",
    "maxVertexBuffers",
    "maxBufferSize",
    "maxVertexAttributes",
    "maxVertexBufferArrayStride",
    "maxInterStageShaderVariables",
    "maxColorAttachments",
    "maxColorAttachmentBytesPerSample",
    "maxComputeWorkgroupStorageSize",
    "maxComputeInvocationsPerWorkgroup",
    "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupSizeY",
    "maxComputeWorkgroupSizeZ",
    "maxComputeWorkgroupsPerDimension",
    "maxStorageBuffersInVertexStage",
    "maxStorageTexturesInVertexStage",
    "maxSampledTexturesInVertexStage",
    "maxSamplersInVertexStage",
  ]);
  const source = limits as unknown as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const name of [...names].sort()) {
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
    features: adapterFeatures,
    limits: adapterLimits,
    wgslLanguageFeatures,
  });

  const textureFormatsTier2 = "texture-formats-tier2" as GPUFeatureName;
  const needsTextureFormatsTier2 = wgslLanguageFeatures.includes(
    "readonly_and_readwrite_storage_textures",
  ) && adapter.features.has(textureFormatsTier2);
  const requiredFeatures: GPUFeatureName[] = needsTextureFormatsTier2
    ? [textureFormatsTier2]
    : [];
  await checkpoint("device-request-started", { requiredFeatures }, "running", "beacon");
  const device = await withTimeout(
    adapter.requestDevice({ requiredFeatures }),
    20_000,
    "WebGPU device request",
  );
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
    features: [...device.features].map(String).sort(),
    limits: readSupportedLimits(device.limits),
  });

  const probeCanvas = document.getElementById("gpuDiagnosticProbeCanvas") as HTMLCanvasElement | null;
  if (!probeCanvas) throw new Error("The probe canvas is missing.");
  const context = probeCanvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) throw new Error("Could not obtain a GPUCanvasContext.");

  await checkpoint("rgba16float-canvas-configure-started", {
    width: probeCanvas.width,
    height: probeCanvas.height,
    usage: ["render-attachment", "copy-dst"],
  }, "running", "beacon");
  context.configure({
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
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 1, g: 0.2, b: 0.02, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    await withTimeout(device.queue.onSubmittedWorkDone(), 15_000, "RGBA16F canvas submission");
  });

  let probeTexture: GPUTexture | null = null;
  await validationCheck(device, "rgba16float-combined-usage-texture", () => {
    probeTexture = device.createTexture({
      label: "diagnostic-rgba16float-combined-usage",
      size: [64, 64, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
  });

  if (probeTexture) {
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

  (probeTexture as GPUTexture | null)?.destroy();
  context.unconfigure();
  intentionalDestroy = true;
  device.destroy();
  await checkpoint("direct-webgpu-probe-completed", {
    adapterMode,
    rgba16floatCanvasConfigured: true,
  });
  await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
}

async function runRealEngineStartup(): Promise<void> {
  const search = new URLSearchParams(window.location.search);
  const documentWidth = Number(search.get("documentWidth") ?? "2048");
  const documentHeight = Number(search.get("documentHeight") ?? "2048");
  await checkpoint("engine-module-import-started", {
    documentWidth,
    documentHeight,
  }, "running", "beacon");
  const engineModule = await withTimeout(
    import("../brush-engine"),
    30_000,
    "Engine module import",
  );
  await checkpoint("engine-module-imported", null);

  const engineCanvas = document.getElementById("gpuDiagnosticEngineCanvas") as HTMLCanvasElement | null;
  if (!engineCanvas) throw new Error("The engine diagnostic canvas is missing.");
  engineCanvas.width = 64;
  engineCanvas.height = 64;

  const engineStatuses: Array<{ message: string; kind: string; at: string }> = [];
  const engine = new engineModule.BrushEngine(engineCanvas, {
    onStatus: (message, kind) => {
      engineStatuses.push({ message, kind, at: new Date().toISOString() });
      if (engineStatuses.length > 32) engineStatuses.shift();
      void bridge.record("engine-status", {
        message,
        kind,
        history: engineStatuses.slice(),
      }, kind === "error" ? "failed" : "running", "beacon");
    },
  });
  await checkpoint("engine-initialize-started", {
    documentWidth,
    documentHeight,
    canvasFormatExpected: "rgba16float",
    layerFormatExpected: "rgba16float",
  }, "running", "beacon");

  await withTimeout(engine.initialize(), 90_000, "Full engine initialization");
  const stats = engine.getStats();
  const measured = engine.measuredGpuMemory();
  await checkpoint("engine-initialize-completed", {
    webGpu: engine.getWebGpuDiagnosticInfo(),
    gpuLabel: stats.gpuLabel,
    gpuMemory: stats.gpuMemory,
    measuredGpuMemory: {
      currentMiB: measured.currentBytes / (1024 * 1024),
      peakMiB: measured.peakBytes / (1024 * 1024),
      textureCount: measured.textureCount,
      bufferCount: measured.bufferCount,
      unmeasurableCount: measured.unmeasurableCount,
    },
    statusHistory: engineStatuses,
  });
}

async function run(): Promise<void> {
  await checkpoint("diagnostic-module-started", {
    build: bridge.build,
    runCodeSuffix: bridge.runCode.slice(-8),
  }, "running", "beacon");
  await checkpoint("environment-captured", await captureHighEntropyEnvironment());
  await runDirectWebGpuProbe();
  await runRealEngineStartup();
  await bridge.finish("completed", "diagnostic-completed", {
    conclusion: "The direct WebGPU probe and the full engine startup both completed.",
  });
}

try {
  await run();
} catch (error) {
  await bridge.finish("failed", "diagnostic-failed", {
    error: describeError(error),
  });
}
