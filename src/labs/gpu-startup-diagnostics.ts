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
  await checkpoint("device-request-started", { requiredFeatures }, "running", "beacon");
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
  }, "running", "beacon");
  let applicationBoot: Record<string, unknown>;
  try {
    applicationBoot = await runFullApplicationBoot();
  } catch (applicationError) {
    await checkpoint("environment-captured-after-app-failure", await captureHighEntropyEnvironment());
    await checkpoint("application-boot-failed", {
      error: describeError(applicationError),
      nextStep: "Run the isolated WebGPU probe after the failed cold application boot.",
    }, "failed", "beacon");
    try {
      await runDirectWebGpuProbe();
      await bridge.finish("failed", "diagnostic-failed", {
        conclusion: "The full application startup failed, but the isolated 2048 RGBA16F probe passed.",
        applicationError: describeError(applicationError),
        isolatedProbeCompleted: true,
      });
    } catch (probeError) {
      await bridge.finish("failed", "diagnostic-failed", {
        conclusion: "Both the full application startup and the isolated WebGPU probe failed.",
        applicationError: describeError(applicationError),
        isolatedProbeError: describeError(probeError),
        isolatedProbeCompleted: false,
      });
    }
    return;
  }

  await checkpoint("environment-captured-after-app-boot", await captureHighEntropyEnvironment());
  await bridge.finish("completed", "diagnostic-completed", {
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
    error: describeError(error),
  });
}
