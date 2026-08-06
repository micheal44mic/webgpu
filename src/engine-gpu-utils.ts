/**
 * Utilita' WebGPU trasversali: attesa della compilazione degli shader e
 * descrizione dell'adapter per i report.
 */

export async function assertShaderCompiled(module: GPUShaderModule, label: string): Promise<void> {
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

export function describeAdapter(adapter: GPUAdapter): string {
  const info = adapter.info;
  const values = [info.vendor, info.architecture, info.device, info.description]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(" · ") || "GPU WebGPU";
}
