import {
  instrumentGpuDevice,
  type GpuResourceRegistry,
} from "./gpu-resource-registry.ts";

export type GpuDeviceSessionStatus = (message: string) => void;

export interface GpuDeviceSessionRequestOptions {
  /** Defaults to the browser's WebGPU entry point. Injection keeps policy tests deterministic. */
  readonly gpu?: GPU | null;
  /** Defaults to the current browser user agent. */
  readonly userAgent?: string;
  /** Diagnostic-only; normal application sessions keep the device feature-neutral. */
  readonly diagnosticTimestampQueryEnabled?: boolean;
  readonly onStatus?: GpuDeviceSessionStatus;
}

export interface GpuAdapterSessionSelection {
  readonly adapter: GPUAdapter;
  readonly androidCompatibilityFallbackEligible: boolean;
}

export interface GpuDeviceSession {
  readonly adapter: GPUAdapter;
  /** Instrumented once at session creation; instrumentation preserves object identity. */
  readonly device: GPUDevice;
  readonly registry: GpuResourceRegistry;
  readonly requiredFeatures: readonly GPUFeatureName[];
  readonly lost: boolean;
}

function runtimeGpu(): GPU | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.gpu;
}

function runtimeUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

export function gpuAdapterRequestOptionsForUserAgent(
  userAgent: string,
): GPURequestAdapterOptions | undefined {
  const android = /\bAndroid\b/i.test(userAgent);
  return /\bWindows\b/i.test(userAgent) || android
    ? undefined
    : { powerPreference: "high-performance" };
}

export async function requestGpuAdapterForDeviceSession(
  options: GpuDeviceSessionRequestOptions = {},
): Promise<GpuAdapterSessionSelection> {
  const gpu = options.gpu === undefined ? runtimeGpu() : options.gpu ?? undefined;
  if (!gpu) throw new Error("WebGPU is not available in this browser or context.");

  const userAgent = options.userAgent ?? runtimeUserAgent();
  const android = /\bAndroid\b/i.test(userAgent);
  const adapterOptions = gpuAdapterRequestOptionsForUserAgent(userAgent);
  const adapterWaitTimer = globalThis.setTimeout(() => {
    options.onStatus?.(
      "GPU discovery is still in progress… Chrome may take a few seconds.",
    );
  }, 6_000);
  let selectedAdapter: GPUAdapter | null = null;
  let primaryAdapterError: unknown = null;
  try {
    try {
      selectedAdapter = await gpu.requestAdapter(adapterOptions);
    } catch (error) {
      primaryAdapterError = error;
    }
    if (!selectedAdapter && adapterOptions !== undefined) {
      options.onStatus?.("Retrying WebGPU selection without a power preference…");
      selectedAdapter = await gpu.requestAdapter();
    }
    if (!selectedAdapter && android) {
      options.onStatus?.("Trying WebGPU compatibility mode for Android…");
      try {
        selectedAdapter = await gpu.requestAdapter({
          featureLevel: "compatibility",
        } as GPURequestAdapterOptions & { featureLevel: "compatibility" });
      } catch {
        // Older implementations reject this option instead of ignoring it.
      }
    }
  } finally {
    globalThis.clearTimeout(adapterWaitTimer);
  }
  if (!selectedAdapter) {
    if (primaryAdapterError && adapterOptions === undefined) throw primaryAdapterError;
    throw new Error("No compatible WebGPU adapter was found.");
  }
  return {
    adapter: selectedAdapter,
    androidCompatibilityFallbackEligible: android,
  };
}

export async function requestGpuDeviceForSession(
  adapter: GPUAdapter,
  options: Pick<
    GpuDeviceSessionRequestOptions,
    "diagnosticTimestampQueryEnabled" | "onStatus"
  > = {},
): Promise<{ readonly device: GPUDevice; readonly requiredFeatures: readonly GPUFeatureName[] }> {
  const requestTimestampQuery = options.diagnosticTimestampQueryEnabled === true
    && adapter.features.has("timestamp-query");
  const requestedFeatures: GPUFeatureName[] = requestTimestampQuery
    ? ["timestamp-query"]
    : [];
  const deviceWaitTimer = globalThis.setTimeout(() => {
    options.onStatus?.("WebGPU device creation is still in progress…");
  }, 6_000);
  try {
    try {
      return {
        device: await adapter.requestDevice({ requiredFeatures: requestedFeatures }),
        requiredFeatures: requestedFeatures,
      };
    } catch (error) {
      if (!requestTimestampQuery) throw error;
      options.onStatus?.(
        "GPU timestamp counters unavailable; continuing with queue timing…",
      );
      const requiredFeatures = requestedFeatures.filter(
        (feature) => feature !== "timestamp-query",
      );
      return {
        device: await adapter.requestDevice({ requiredFeatures }),
        requiredFeatures,
      };
    }
  } finally {
    globalThis.clearTimeout(deviceWaitTimer);
  }
}

function trackGpuDeviceSession(
  adapter: GPUAdapter,
  rawDevice: GPUDevice,
  requiredFeatures: readonly GPUFeatureName[],
): GpuDeviceSession {
  const instrumented = instrumentGpuDevice(rawDevice);
  if (instrumented.device !== rawDevice) {
    throw new Error("GPU resource instrumentation must preserve device identity.");
  }
  let lost = false;
  void instrumented.device.lost.then(
    () => {
      lost = true;
    },
    () => {
      lost = true;
    },
  );
  return {
    adapter,
    device: instrumented.device,
    registry: instrumented.registry,
    requiredFeatures: Object.freeze([...requiredFeatures]),
    get lost() {
      return lost;
    },
  };
}

export function gpuDeviceSessionIsUsable(session: GpuDeviceSession): boolean {
  return !session.lost;
}

/**
 * Requests only an adapter and a device. It deliberately creates no buffers,
 * textures, canvas contexts, or document-sized resources.
 */
export async function requestGpuDeviceSession(
  options: GpuDeviceSessionRequestOptions = {},
): Promise<GpuDeviceSession> {
  const selection = await requestGpuAdapterForDeviceSession(options);
  return requestGpuDeviceSessionFromAdapter(selection.adapter, options);
}

export async function requestGpuDeviceSessionFromAdapter(
  adapter: GPUAdapter,
  options: Pick<
    GpuDeviceSessionRequestOptions,
    "diagnosticTimestampQueryEnabled" | "onStatus"
  > = {},
): Promise<GpuDeviceSession> {
  const requested = await requestGpuDeviceForSession(adapter, options);
  return trackGpuDeviceSession(
    adapter,
    requested.device,
    requested.requiredFeatures,
  );
}

export interface GpuDeviceSessionPrewarmer {
  /** Concurrent and subsequent calls share one promise until failure or device loss. */
  prepare(): Promise<GpuDeviceSession>;
  /** Forgets the reusable promise without destroying a device another owner may have adopted. */
  invalidate(): void;
}

export function createGpuDeviceSessionPrewarmer(
  options: GpuDeviceSessionRequestOptions = {},
): GpuDeviceSessionPrewarmer {
  let sessionPromise: Promise<GpuDeviceSession> | null = null;
  let resolvedSession: GpuDeviceSession | null = null;

  const invalidatePromise = (expected: Promise<GpuDeviceSession>): void => {
    if (sessionPromise !== expected) return;
    sessionPromise = null;
    resolvedSession = null;
  };

  return {
    prepare(): Promise<GpuDeviceSession> {
      if (sessionPromise && resolvedSession?.lost === true) {
        sessionPromise = null;
        resolvedSession = null;
      }
      if (sessionPromise) return sessionPromise;

      const pending = requestGpuDeviceSession(options);
      sessionPromise = pending;
      void pending.then(
        (session) => {
          if (sessionPromise !== pending) return;
          resolvedSession = session;
          void session.device.lost.then(
            () => invalidatePromise(pending),
            () => invalidatePromise(pending),
          );
        },
        () => invalidatePromise(pending),
      );
      return pending;
    },
    invalidate(): void {
      sessionPromise = null;
      resolvedSession = null;
    },
  };
}
