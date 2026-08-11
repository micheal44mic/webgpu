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
  "device-intercepted-exact-descriptor-bytes-msaa-current-peak-categorised-v2" as const;

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
  readonly sampleCount: number;
  /** Il formato non e' nella tabella: i byte non sono calcolabili, non valgono zero. */
  readonly unmeasurable: boolean;
}

export interface GpuCategoryTotal {
  readonly category: string;
  /** Byte correnti: ogni risorsa appartiene a una sola categoria. */
  readonly bytes: number;
  /** Massimo storico della sola categoria; i picchi di categorie diverse non si sommano. */
  readonly peakBytes: number;
  readonly count: number;
}

export interface GpuRegistrySnapshot {
  /** Alias esplicito del totale corrente. */
  readonly currentBytes: number;
  /** Alias storico di `currentBytes`, mantenuto per i consumatori esistenti. */
  readonly totalBytes: number;
  /** Massimo totale osservato dopo una createTexture/createBuffer. */
  readonly peakBytes: number;
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
export const GPU_MEMORY_CATEGORY_ORDER = Object.freeze([
  "Layer documento",
  "Piramidi mip",
  "Maschere continue R16F",
  "Heightfield R32F",
  "Cache vettoriali",
  "Scratch temporanei",
  "Composite livelli",
  "Cronologia · Undo",
  "Cold storage livelli",
  "Import e trasformazioni raster",
  "Presentazione",
  "Effetti raster",
  "Light / Uniformed / Intense",
  "Fusione e Blend",
  "Riempimento e selezione",
  "Pennello, grana e shape",
  "Code predittive",
  "Uniformi e parametri",
  "Non categorizzato",
] as const);

const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/authoritative paint layer/i, "Layer documento"],
  [/Transparent layer placeholder/i, "Presentazione"],
  // Scratch/readback precede ogni proprietario semantico: una cache vettoriale
  // persistente e il suo scratch temporaneo devono restare righe disgiunte.
  [/scratch|arena comune|arena segmenti|readback|rect probe|pixel probe|witness/i,
    "Scratch temporanei"],
  [/Heightfield|heightfield/i, "Heightfield R32F"],
  [/(?:R16F|r16float|f16).*(?:coverage|matte|mask|accumulator|snapshot)|(?:coverage|matte|blur cache|blurred mask|accumulator|snapshot).*(?:R16F|r16float|f16)|GPU blur cache/i,
    "Maschere continue R16F"],
  // Cronologia e cold storage erano una riga sola, e la riga sola non si poteva
  // leggere: la cronologia ha un budget in byte che la tiene a bada, il cold
  // storage dei livelli inattivi no. Sommarle nascondeva proprio la distinzione
  // che serve per capire perche' la memoria e' salita. L'ordine conta: il seed
  // di un checkpoint si chiama `Cold tile History livello N`, quindi la regola
  // della cronologia deve venire prima di quella del cold storage.
  // Le superfici merged sono la cache del composito sopra e sotto il livello
  // attivo: ricostruibili dai pixel autorevoli, e la voce piu' pesante dopo il
  // livello stesso. Restavano in `Non categorizzato`, che e' la riga che chiede
  // un nome — questo e' il nome.
  [/Merged (?:below|above|[a-z]+) |Layer composite/i, "Composite livelli"],
  [/Cronologia|history/i, "Cronologia · Undo"],
  [/cold tile|cold storage|Cold ripristinato|compress/i, "Cold storage livelli"],
  [/vector text|vector svg|semantic vector|mixed scene|scene lineare|ordered layer blend|ordered clipping-group/i,
    "Cache vettoriali"],
  // Questi sono piccoli buffer di lookup del pennello, non texture di
  // visualizzazione. La parola "mip" nell'etichetta non deve gonfiare il
  // numero di risorse mostrato nella categoria delle piramidi.
  [/Shape conservative occupancy bitmask/i, "Pennello, grana e shape"],
  [/display pyramid|derived mip|logical mip|sampling chain|\bmip(?:map)?\b/i,
    "Piramidi mip"],
  [/raster import|raster Transform|Trasforma raster|Native raster/i,
    "Import e trasformazioni raster"],
  [/presentation|presentazione|swap|thumbnail/i, "Presentazione"],
  [/Light Glaze|Uniformed|Intense|glaze/i, "Light / Uniformed / Intense"],
  [/Smusso|bevel|Traccia|stroke|Ombra|shadow/i, "Effetti raster"],
  [/Riempimento|fill|Selezione|selection|lasso/i, "Riempimento e selezione"],
  [/Blend dry|blend|compositor|compositore/i, "Fusione e Blend"],
  [/grain|shape|stamp|brush|pennello/i, "Pennello, grana e shape"],
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
  sampleCount?: number;
}): {
  bytes: number;
  unmeasurable: boolean;
  width: number;
  height: number;
  layers: number;
  sampleCount: number;
} {
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
  const sampleCount = Math.max(1, Math.trunc(descriptor.sampleCount ?? 1));
  if (bytesPerPixel === undefined) {
    return { bytes: 0, unmeasurable: true, width, height, layers, sampleCount };
  }
  const levels = Math.max(1, descriptor.mipLevelCount ?? 1);
  let bytes = 0;
  for (let level = 0; level < levels; level += 1) {
    bytes += Math.max(1, width >> level)
      * Math.max(1, height >> level)
      * Math.max(1, layers)
      * bytesPerPixel
      * sampleCount;
  }
  return { bytes, unmeasurable: false, width, height, layers, sampleCount };
}

export class GpuResourceRegistry {
  private readonly live = new Map<number, GpuResourceRecord>();
  private nextId = 1;
  private createdCount = 0;
  private destroyedCount = 0;
  private collectedCount = 0;
  private currentBytes = 0;
  private peakBytes = 0;
  private readonly categoryCurrentBytes = new Map<string, number>();
  private readonly categoryPeakBytes = new Map<string, number>();
  private readonly finalization = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<number>((id) => {
      // Risorsa abbandonata senza `destroy()`: il driver la libera comunque, e
      // senza questa riconciliazione il totale resterebbe gonfio per sempre.
      const record = this.live.get(id);
      if (record && this.live.delete(id)) {
        this.removeLiveBytes(record);
        this.collectedCount += 1;
      }
    })
    : null;

  register(record: Omit<GpuResourceRecord, "id">, resource: object): number {
    const id = this.nextId++;
    this.live.set(id, { ...record, id });
    this.createdCount += 1;
    this.addLiveBytes(record);
    this.finalization?.register(resource, id, resource as WeakKey);
    return id;
  }

  release(id: number, resource: object): void {
    const record = this.live.get(id);
    if (!record || !this.live.delete(id)) return;
    this.removeLiveBytes(record);
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
    // Conserva una riga a zero anche dopo il rilascio dell'ultima risorsa:
    // altrimenti il picco storico della categoria sparirebbe dal pannello.
    for (const category of this.categoryPeakBytes.keys()) {
      categories.set(category, { bytes: 0, count: 0 });
    }
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
    const currentBytes = textureBytes + bufferBytes;
    return {
      currentBytes,
      totalBytes: currentBytes,
      peakBytes: this.peakBytes,
      textureBytes,
      bufferBytes,
      textureCount,
      bufferCount,
      unmeasurableCount,
      unmeasurableFormats: [...unmeasurableFormats],
      categories: [...categories.entries()]
        .map(([category, bucket]) => ({
          category,
          ...bucket,
          peakBytes: this.categoryPeakBytes.get(category) ?? bucket.bytes,
        }))
        .sort((left, right) => right.bytes - left.bytes),
      liveCount: this.live.size,
      createdCount: this.createdCount,
      destroyedCount: this.destroyedCount,
      collectedCount: this.collectedCount,
    };
  }

  private addLiveBytes(record: Omit<GpuResourceRecord, "id">): void {
    this.currentBytes += record.bytes;
    this.peakBytes = Math.max(this.peakBytes, this.currentBytes);
    const categoryBytes = (this.categoryCurrentBytes.get(record.category) ?? 0) + record.bytes;
    this.categoryCurrentBytes.set(record.category, categoryBytes);
    this.categoryPeakBytes.set(
      record.category,
      Math.max(this.categoryPeakBytes.get(record.category) ?? 0, categoryBytes),
    );
  }

  private removeLiveBytes(record: GpuResourceRecord): void {
    this.currentBytes = Math.max(0, this.currentBytes - record.bytes);
    const categoryBytes = Math.max(
      0,
      (this.categoryCurrentBytes.get(record.category) ?? 0) - record.bytes,
    );
    this.categoryCurrentBytes.set(record.category, categoryBytes);
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
      sampleCount: measured.sampleCount,
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
      sampleCount: 1,
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
