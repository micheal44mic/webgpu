/**
 * Utilita' WebGPU trasversali: attesa della compilazione degli shader e
 * descrizione dell'adapter per i report.
 */

function explicitShaderValidationRequested(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("validateShaders") === "1";
}

/**
 * Pipeline creation already validates WGSL. In production, asking every shader
 * module for compilation info first forces a second, eagerly awaited validation
 * pass and is particularly expensive on mobile GPUs. Development keeps the
 * explicit diagnostics; `?validateShaders=1` enables them on a published build.
 */
export async function assertShaderCompiled(module: GPUShaderModule, label: string): Promise<void> {
  if (!explicitShaderValidationRequested()) return;
  const compilationInfo = await module.getCompilationInfo();
  const errors = compilationInfo.messages.filter((message) => message.type === "error");
  if (errors.length === 0) {
    return;
  }

  const description = errors
    .map((error) => `${error.lineNum}:${error.linePos} ${error.message}`)
    .join("\n");
  throw new Error(`Errore WGSL nel modulo ${label}:\n${description}`);
}

/** Uses asynchronous compilation when exposed by the browser, with a fallback
 * for older WebGPU implementations. */
export async function createRenderPipelineAsync(
  device: GPUDevice,
  descriptor: GPURenderPipelineDescriptor,
): Promise<GPURenderPipeline> {
  try {
    if (typeof device.createRenderPipelineAsync === "function") {
      return await device.createRenderPipelineAsync(descriptor);
    }
    return device.createRenderPipeline(descriptor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Pipeline render ${String(descriptor.label ?? "senza etichetta")}: ${message}`);
  }
}

export async function createComputePipelineAsync(
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
): Promise<GPUComputePipeline> {
  try {
    if (typeof device.createComputePipelineAsync === "function") {
      return await device.createComputePipelineAsync(descriptor);
    }
    return device.createComputePipeline(descriptor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Pipeline compute ${String(descriptor.label ?? "senza etichetta")}: ${message}`);
  }
}

/** Lets style/layout and GPU callbacks run between small compilation batches. */
export async function yieldPipelineCompilation(): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

export interface PipelineCompilationEvent {
  readonly state: "start" | "complete" | "error";
  readonly completed: number;
  readonly total: number;
  readonly label: string;
  readonly durationMs: number | null;
  readonly error?: unknown;
}

export interface PipelineCompilationQueue {
  render(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
  compute(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>;
}

/** Two compilers on touch devices protect mobile drivers; desktop uses four. */
export function recommendedPipelineCompilationConcurrency(): number {
  if (typeof navigator === "undefined") return 2;
  const touchDevice = navigator.maxTouchPoints > 1
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return touchDevice ? 2 : 4;
}

/**
 * Shared bounded queue for independent pipeline descriptors. It preserves the
 * exact descriptors while preventing an unbounded driver compile burst.
 */
export function createPipelineCompilationQueue(
  device: GPUDevice,
  options: {
    readonly total: number;
    readonly concurrency?: number;
    readonly onProgress?: (event: PipelineCompilationEvent) => void;
  },
): PipelineCompilationQueue {
  const concurrency = Math.max(
    1,
    Math.min(options.total, Math.floor(
      options.concurrency ?? recommendedPipelineCompilationConcurrency(),
    )),
  );
  let active = 0;
  let completed = 0;
  let firstFailure: unknown = null;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };
  const compile = async <Pipeline>(
    label: string,
    operation: () => Promise<Pipeline>,
  ): Promise<Pipeline> => {
    await acquire();
    if (firstFailure !== null) {
      release();
      throw firstFailure;
    }
    const startedAt = performance.now();
    options.onProgress?.({
      state: "start",
      completed,
      total: options.total,
      label,
      durationMs: null,
    });
    try {
      const pipeline = await operation();
      completed += 1;
      options.onProgress?.({
        state: "complete",
        completed,
        total: options.total,
        label,
        durationMs: performance.now() - startedAt,
      });
      return pipeline;
    } catch (error) {
      firstFailure ??= error;
      options.onProgress?.({
        state: "error",
        completed,
        total: options.total,
        label,
        durationMs: performance.now() - startedAt,
        error,
      });
      throw error;
    } finally {
      if (completed > 0 && completed < options.total && completed % concurrency === 0) {
        await yieldPipelineCompilation();
      }
      release();
    }
  };
  return {
    render: (descriptor) => compile(
      String(descriptor.label ?? "Pipeline render"),
      () => createRenderPipelineAsync(device, descriptor),
    ),
    compute: (descriptor) => compile(
      String(descriptor.label ?? "Pipeline compute"),
      () => createComputePipelineAsync(device, descriptor),
    ),
  };
}

export function describeAdapter(adapter: GPUAdapter): string {
  const info = adapter.info;
  const values = [info.vendor, info.architecture, info.device, info.description]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(" · ") || "GPU WebGPU";
}
