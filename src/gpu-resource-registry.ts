/**
 * Contabilita' GPU **misurata**, non dichiarata.
 *
 * Il pannello memoria e' sempre stato un modello scritto a mano: un secondo
 * elenco di costi da tenere allineato al codice. Un elenco parallelo deriva per
 * costruzione — e' gia' successo due volte in questo repo (l'accumulatore
 * Light Glaze fermo a `128 MiB`, e la memoria del livello ferma a `128/64`).
 * Un revisore che confronta i due elenchi trova la deriva ma non la elimina:
 * resta comunque un modello da aggiornare a mano.
 *
 * Qui il modello sparisce. Si intercetta l'unico punto da cui il motore ottiene
 * il device (`requestDevice`) e si registra ogni texture e ogni buffer al
 * momento della creazione, con i byte esatti del descrittore. Nessun sito di
 * allocazione va toccato, e ogni risorsa futura e' contabilizzata da subito.
 *
 * Conseguenza pratica: un documento di taglia diversa, un canvas personalizzato
 * o un effetto nuovo non richiedono **nessuna** modifica alla contabilita'.
 */

import { GPU_FORMAT_BYTES_PER_PIXEL } from "./gpu-memory-audit.ts";

export const GPU_RESOURCE_REGISTRY_STRATEGY =
  "device-intercepted-exact-descriptor-bytes-label-categorised-v1" as const;

export type GpuResourceKind = "texture" | "buffer";

export interface GpuResourceRecord {
  readonly id: number;
  readonly kind: GpuResourceKind;
  readonly label: string;
  readonly category: string;
  readonly bytes: number;
  readonly format: string | null;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly mipLevelCount: number;
  /** Il formato non e' nella tabella: i byte non sono calcolabili, non valgono zero. */
  readonly unmeasurable: boolean;
}

export interface GpuCategoryTotal {
  readonly category: string;
  readonly bytes: number;
  readonly count: number;
}

export interface GpuRegistrySnapshot {
  readonly totalBytes: number;
  readonly textureBytes: number;
  readonly bufferBytes: number;
  readonly textureCount: number;
  readonly bufferCount: number;
  /** Risorse vive il cui formato non sappiamo misurare: il totale le esclude. */
  readonly unmeasurableCount: number;
  readonly unmeasurableFormats: readonly string[];
  readonly categories: readonly GpuCategoryTotal[];
  readonly liveCount: number;
  readonly createdCount: number;
  readonly destroyedCount: number;
  /** Risorse sparite senza `destroy()`, riconciliate dal garbage collector. */
  readonly collectedCount: number;
}

/**
 * Etichetta → categoria. L'ordine conta: vince la prima regola che combacia.
 * Le etichette sono gia' descrittive in tutto il motore, quindi la categoria si
 * legge da li' senza toccare i siti di allocazione. Cio' che non combacia
 * finisce in `Non categorizzato`, che resta **visibile**: una risorsa nuova non
 * puo' sparire dal conto, al massimo sta in una riga che chiede un nome.
 */
const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/authoritative paint layer|Transparent layer placeholder/i, "Livelli raster"],
  [/cold tile|cold storage|compress/i, "Livelli · cold storage"],
  // Lo scratch condiviso del banco effetti va nominato prima delle regole
  // generiche: senza, i suoi `16 MiB` finivano in `Non categorizzato`. E' stato
  // il catch-all a rivelarlo, ed e' il motivo per cui deve restare visibile.
  [/banco effetti|scratch condiviso|scratch pool/i, "Banco effetti · scratch"],
  // Il glaze precede la Traccia perche' la sua etichetta autorevole e'
  // «Lazy Light Glaze **stroke** accumulator»: invertendo l'ordine i suoi
  // 32 MiB verrebbero attribuiti alla Traccia. Colto da `document:verify`.
  [/Light Glaze|glaze/i, "Light Glaze"],
  // Le piramidi possedute da un effetto stanno con l'effetto, non in una riga
  // generica: `Traccia styled derived mip` e' memoria della Traccia.
  [/Smusso|bevel/i, "Smusso"],
  [/Traccia|stroke/i, "Traccia"],
  [/Ombra|shadow/i, "Ombre"],
  [/display pyramid|derived mip|logical mip|composited/i, "Piramidi mip"],
  [/Cronologia|history/i, "Cronologia raster"],
  [/Riempimento|fill/i, "Riempimento"],
  [/Selezione|selection|lasso/i, "Selezione"],
  [/Blend dry|blend/i, "Fusione e Blend"],
  [/mixed scene|scene lineare|ping-pong/i, "Scena mista"],
  [/presentation|presentazione|swap/i, "Presentazione"],
  [/grain|shape|stamp|brush|pennello/i, "Pennello, grana e shape"],
  [/vector text|testo/i, "Testo vettoriale"],
  [/thickness|stabilizzazione|stabilization|tail/i, "Code predittive"],
  [/uniform|parameter|indirect|metadata|argument/i, "Uniformi e parametri"],
]);

export function categoriseGpuResource(label: string): string {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(label)) return category;
  }
  return "Non categorizzato";
}

export function textureDescriptorBytes(descriptor: {
  format: string;
  size: GPUExtent3DStrict;
  mipLevelCount?: number;
}): { bytes: number; unmeasurable: boolean; width: number; height: number; layers: number } {
  const size = descriptor.size as
    | { width: number; height?: number; depthOrArrayLayers?: number }
    | readonly number[];
  const width = Array.isArray(size) ? (size[0] ?? 1) : (size as { width: number }).width;
  const height = Array.isArray(size)
    ? (size[1] ?? 1)
    : ((size as { height?: number }).height ?? 1);
  const layers = Array.isArray(size)
    ? (size[2] ?? 1)
    : ((size as { depthOrArrayLayers?: number }).depthOrArrayLayers ?? 1);
  const bytesPerPixel = GPU_FORMAT_BYTES_PER_PIXEL[descriptor.format];
  if (bytesPerPixel === undefined) {
    return { bytes: 0, unmeasurable: true, width, height, layers };
  }
  const levels = Math.max(1, descriptor.mipLevelCount ?? 1);
  let bytes = 0;
  for (let level = 0; level < levels; level += 1) {
    bytes += Math.max(1, width >> level)
      * Math.max(1, height >> level)
      * Math.max(1, layers)
      * bytesPerPixel;
  }
  return { bytes, unmeasurable: false, width, height, layers };
}

export class GpuResourceRegistry {
  private readonly live = new Map<number, GpuResourceRecord>();
  private nextId = 1;
  private createdCount = 0;
  private destroyedCount = 0;
  private collectedCount = 0;
  private readonly finalization = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<number>((id) => {
      // Risorsa abbandonata senza `destroy()`: il driver la libera comunque, e
      // senza questa riconciliazione il totale resterebbe gonfio per sempre.
      if (this.live.delete(id)) this.collectedCount += 1;
    })
    : null;

  register(record: Omit<GpuResourceRecord, "id">, resource: object): number {
    const id = this.nextId++;
    this.live.set(id, { ...record, id });
    this.createdCount += 1;
    this.finalization?.register(resource, id, resource as WeakKey);
    return id;
  }

  release(id: number, resource: object): void {
    if (!this.live.delete(id)) return;
    this.destroyedCount += 1;
    this.finalization?.unregister(resource as WeakKey);
  }

  records(): GpuResourceRecord[] {
    return [...this.live.values()];
  }

  snapshot(): GpuRegistrySnapshot {
    let textureBytes = 0;
    let bufferBytes = 0;
    let textureCount = 0;
    let bufferCount = 0;
    let unmeasurableCount = 0;
    const unmeasurableFormats = new Set<string>();
    const categories = new Map<string, { bytes: number; count: number }>();
    for (const record of this.live.values()) {
      if (record.unmeasurable) {
        unmeasurableCount += 1;
        if (record.format) unmeasurableFormats.add(record.format);
      }
      if (record.kind === "texture") {
        textureBytes += record.bytes;
        textureCount += 1;
      } else {
        bufferBytes += record.bytes;
        bufferCount += 1;
      }
      const bucket = categories.get(record.category) ?? { bytes: 0, count: 0 };
      bucket.bytes += record.bytes;
      bucket.count += 1;
      categories.set(record.category, bucket);
    }
    return {
      totalBytes: textureBytes + bufferBytes,
      textureBytes,
      bufferBytes,
      textureCount,
      bufferCount,
      unmeasurableCount,
      unmeasurableFormats: [...unmeasurableFormats],
      categories: [...categories.entries()]
        .map(([category, bucket]) => ({ category, ...bucket }))
        .sort((left, right) => right.bytes - left.bytes),
      liveCount: this.live.size,
      createdCount: this.createdCount,
      destroyedCount: this.destroyedCount,
      collectedCount: this.collectedCount,
    };
  }
}

/**
 * Avvolge il device cosi' che ogni `createTexture`/`createBuffer` venga
 * contabilizzato. Restituisce lo stesso oggetto device con i due metodi
 * sostituiti: i 125 siti di allocazione del motore non cambiano di una riga, e
 * qualunque codice futuro e' incluso automaticamente.
 */
export function instrumentGpuDevice(device: GPUDevice): {
  device: GPUDevice;
  registry: GpuResourceRegistry;
} {
  const registry = new GpuResourceRegistry();
  const createTexture = device.createTexture.bind(device);
  const createBuffer = device.createBuffer.bind(device);

  device.createTexture = (descriptor: GPUTextureDescriptor): GPUTexture => {
    const texture = createTexture(descriptor);
    const measured = textureDescriptorBytes(descriptor);
    const label = descriptor.label ?? texture.label ?? "";
    const id = registry.register({
      kind: "texture",
      label,
      category: categoriseGpuResource(label),
      bytes: measured.bytes,
      format: descriptor.format,
      width: measured.width,
      height: measured.height,
      layers: measured.layers,
      mipLevelCount: Math.max(1, descriptor.mipLevelCount ?? 1),
      unmeasurable: measured.unmeasurable,
    }, texture);
    const destroy = texture.destroy.bind(texture);
    texture.destroy = () => {
      registry.release(id, texture);
      destroy();
    };
    return texture;
  };

  device.createBuffer = (descriptor: GPUBufferDescriptor): GPUBuffer => {
    const buffer = createBuffer(descriptor);
    const label = descriptor.label ?? buffer.label ?? "";
    const id = registry.register({
      kind: "buffer",
      label,
      category: categoriseGpuResource(label),
      bytes: descriptor.size,
      format: null,
      width: 0,
      height: 0,
      layers: 0,
      mipLevelCount: 0,
      unmeasurable: false,
    }, buffer);
    const destroy = buffer.destroy.bind(buffer);
    buffer.destroy = () => {
      registry.release(id, buffer);
      destroy();
    };
    return buffer;
  };

  return { device, registry };
}
