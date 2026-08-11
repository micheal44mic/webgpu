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
 * In sviluppo blocchiamo l'avvio finche' ogni modulo WGSL e' stato validato,
 * cosi' gli errori restano immediati e attribuiti al modulo corretto. In una
 * build pubblicata le pipeline eseguono gia' la validazione WebGPU: aspettare
 * anche `getCompilationInfo()` per tutti i moduli serializzava inutilmente lo
 * startup, soprattutto sui telefoni. `?validateShaders=1` riattiva il gate
 * esplicito anche in produzione quando serve una diagnosi.
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

export function describeAdapter(adapter: GPUAdapter): string {
  const info = adapter.info;
  const values = [info.vendor, info.architecture, info.device, info.description]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(" · ") || "GPU WebGPU";
}
