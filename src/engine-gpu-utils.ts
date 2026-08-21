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
  throw new Error(`WGSL error in module ${label}:\n${description}`);
}

/** Uses asynchronous compilation when exposed by the browser, with a fallback
 * for older WebGPU implementations. */
export async function createRenderPipelineAsync(
  device: GPUDevice,
  descriptor: GPURenderPipelineDescriptor,
): Promise<GPURenderPipeline> {
  if (typeof device.createRenderPipelineAsync === "function") {
    return device.createRenderPipelineAsync(descriptor);
  }
  return device.createRenderPipeline(descriptor);
}

export function describeAdapter(adapter: GPUAdapter): string {
  const info = adapter.info;
  const values = [info.vendor, info.architecture, info.device, info.description]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(" · ") || "GPU WebGPU";
}
