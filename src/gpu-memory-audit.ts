/**
 * Revisione della memoria GPU dichiarata contro quella realmente allocata.
 *
 * Il pannello memoria e' un **modello**: somma i costi che il motore dichiara
 * di aver allocato. Un modello puo' divergere dalla realta' in due modi, ed
 * entrambi sono gia' successi in questo repo: un costo cablato che non segue
 * il documento (l'accumulatore Light Glaze fermo a `128 MiB`), oppure una
 * risorsa nuova che nessuno ha aggiunto alla contabilita'.
 *
 * Questo modulo enumera le risorse GPU vive raggiungibili dal motore e ne
 * calcola i byte veri: catena mip inclusa, per formato. Il confronto col
 * totale dichiarato e' l'unico modo per accorgersi della deriva **senza
 * rimisurare a mano**, ed e' cio' che rende il pannello affidabile anche
 * quando il documento cambia taglia.
 */

/** Byte per pixel dei formati che il motore alloca davvero. */
export const GPU_FORMAT_BYTES_PER_PIXEL: Readonly<Record<string, number>> = Object.freeze({
  r8unorm: 1,
  rg8unorm: 2,
  r16float: 2,
  rgba8unorm: 4,
  "rgba8unorm-srgb": 4,
  bgra8unorm: 4,
  "bgra8unorm-srgb": 4,
  rgb10a2unorm: 4,
  r32float: 4,
  r32uint: 4,
  rg16float: 4,
  rg32float: 8,
  rgba16float: 8,
  rgba16uint: 8,
  rgba32float: 16,
  rgba32uint: 16,
});

export interface GpuMemoryAuditEntry {
  readonly path: string;
  readonly label: string;
  readonly kind: "texture" | "buffer";
  readonly format: string | null;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly mipLevelCount: number;
  readonly sampleCount: number;
  readonly bytes: number;
}

export interface GpuMemoryAuditReport {
  readonly textureBytes: number;
  readonly bufferBytes: number;
  readonly measuredBytes: number;
  readonly declaredBytes: number;
  /** Positivo quando il motore alloca piu' di quanto dichiara. */
  readonly deltaBytes: number;
  readonly deltaRatio: number;
  readonly textureCount: number;
  readonly bufferCount: number;
  /** Formati incontrati per cui non conosciamo i byte per pixel. */
  readonly unknownFormats: readonly string[];
  readonly largest: readonly GpuMemoryAuditEntry[];
}

/**
 * Scarto oltre il quale la deriva non e' piu' arrotondamento ma un difetto di
 * contabilita'. Misurato il 6 agosto 2026 su otto configurazioni (due formati
 * livello × due modalita' glaze × effetti on/off): lo scarto reale stava fra
 * `0,17` e `0,20 MiB`, costante e non proporzionale.
 */
export const GPU_MEMORY_AUDIT_TOLERANCE_BYTES = 2 * 1024 * 1024;

export function gpuTextureBytes(texture: {
  format: string;
  width: number;
  height: number;
  depthOrArrayLayers: number;
  mipLevelCount: number;
  sampleCount?: number;
}): number {
  const bytesPerPixel = GPU_FORMAT_BYTES_PER_PIXEL[texture.format];
  if (bytesPerPixel === undefined) return 0;
  let total = 0;
  const sampleCount = Math.max(1, Math.trunc(texture.sampleCount ?? 1));
  for (let mipLevel = 0; mipLevel < Math.max(1, texture.mipLevelCount); mipLevel += 1) {
    total += Math.max(1, texture.width >> mipLevel)
      * Math.max(1, texture.height >> mipLevel)
      * Math.max(1, texture.depthOrArrayLayers)
      * bytesPerPixel
      * sampleCount;
  }
  return total;
}

interface AuditWalkLimits {
  maximumDepth: number;
  maximumCollectionItems: number;
}

const DEFAULT_LIMITS: AuditWalkLimits = {
  maximumDepth: 5,
  maximumCollectionItems: 512,
};

/**
 * Cammina l'oggetto motore raccogliendo texture e buffer. Non segue viste,
 * bind group e pipeline: non possiedono memoria propria e allungherebbero
 * soltanto la visita.
 */
export function collectGpuMemoryEntries(
  root: object,
  rootLabel = "engine",
  limits: AuditWalkLimits = DEFAULT_LIMITS,
): GpuMemoryAuditEntry[] {
  const seen = new WeakSet<object>();
  const entries: GpuMemoryAuditEntry[] = [];
  const hasTexture = typeof GPUTexture !== "undefined";
  const hasBuffer = typeof GPUBuffer !== "undefined";

  const walk = (value: unknown, path: string, depth: number): void => {
    if (!value || typeof value !== "object" || depth > limits.maximumDepth) return;
    const node = value as object;
    if (seen.has(node)) return;
    seen.add(node);

    if (hasTexture && node instanceof GPUTexture) {
      entries.push({
        path,
        label: node.label ?? "",
        kind: "texture",
        format: node.format,
        width: node.width,
        height: node.height,
        layers: node.depthOrArrayLayers,
        mipLevelCount: node.mipLevelCount,
        sampleCount: node.sampleCount,
        bytes: gpuTextureBytes(node),
      });
      return;
    }
    if (hasBuffer && node instanceof GPUBuffer) {
      entries.push({
        path,
        label: node.label ?? "",
        kind: "buffer",
        format: null,
        width: 0,
        height: 0,
        layers: 0,
        mipLevelCount: 0,
        sampleCount: 1,
        bytes: node.size,
      });
      return;
    }
    if (
      (typeof GPUTextureView !== "undefined" && node instanceof GPUTextureView)
      || (typeof GPUBindGroup !== "undefined" && node instanceof GPUBindGroup)
      || (typeof GPURenderPipeline !== "undefined" && node instanceof GPURenderPipeline)
      || (typeof GPUComputePipeline !== "undefined" && node instanceof GPUComputePipeline)
      || (typeof GPUDevice !== "undefined" && node instanceof GPUDevice)
      || (typeof GPUCanvasContext !== "undefined" && node instanceof GPUCanvasContext)
      || ArrayBuffer.isView(node)
      || node instanceof ArrayBuffer
    ) {
      return;
    }

    if (node instanceof Map) {
      let index = 0;
      for (const item of node.values()) {
        if (index >= limits.maximumCollectionItems) break;
        walk(item, `${path}{${index++}}`, depth + 1);
      }
      return;
    }
    if (node instanceof Set) {
      let index = 0;
      for (const item of node.values()) {
        if (index >= limits.maximumCollectionItems) break;
        walk(item, `${path}<${index++}>`, depth + 1);
      }
      return;
    }
    if (Array.isArray(node)) {
      const count = Math.min(node.length, limits.maximumCollectionItems);
      for (let index = 0; index < count; index += 1) {
        walk(node[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }

    let keys: string[] = [];
    try {
      keys = Object.keys(node);
    } catch {
      return;
    }
    for (const key of keys) {
      let child: unknown;
      try {
        child = (node as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      walk(child, `${path}.${key}`, depth + 1);
    }
  };

  walk(root, rootLabel, 0);
  return entries;
}

export function buildGpuMemoryAuditReport(
  entries: readonly GpuMemoryAuditEntry[],
  declaredBytes: number,
  largestCount = 12,
): GpuMemoryAuditReport {
  let textureBytes = 0;
  let bufferBytes = 0;
  const unknownFormats = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "texture") {
      textureBytes += entry.bytes;
      if (entry.format && GPU_FORMAT_BYTES_PER_PIXEL[entry.format] === undefined) {
        unknownFormats.add(entry.format);
      }
    } else {
      bufferBytes += entry.bytes;
    }
  }
  const measuredBytes = textureBytes + bufferBytes;
  return {
    textureBytes,
    bufferBytes,
    measuredBytes,
    declaredBytes,
    deltaBytes: measuredBytes - declaredBytes,
    deltaRatio: measuredBytes > 0 ? (measuredBytes - declaredBytes) / measuredBytes : 0,
    textureCount: entries.filter((entry) => entry.kind === "texture").length,
    bufferCount: entries.filter((entry) => entry.kind === "buffer").length,
    unknownFormats: [...unknownFormats],
    largest: [...entries].sort((left, right) => right.bytes - left.bytes).slice(0, largestCount),
  };
}
