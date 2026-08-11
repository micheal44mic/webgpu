import type { MemoryRequest } from "./memory-governor-core";

/**
 * Stime conservative dei picchi per le operazioni strutturali sui layer.
 *
 * I valori vengono calcolati dai tile effettivamente occupati e non dal
 * numero dei livelli: due livelli pieni possono costare molto piu' di molte
 * decine di livelli quasi vuoti. Le superfici full-document restano invece
 * una parte inevitabile del percorso WebGPU e sono incluse esplicitamente.
 */
export const LAYER_MEMORY_ADMISSION_STRATEGY =
  "tile-aware-merge-create-duplicate-and-layer-switch-peak-reservations-v2" as const;

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} deve essere un numero finito non negativo.`);
  }
}

function totalBytes(values: readonly number[], label: string): number {
  return values.reduce((total, value, index) => {
    assertNonNegativeFinite(value, `${label}[${index}]`);
    return total + value;
  }, 0);
}

export interface LayerMergeCreateMemoryInput {
  /** Texture hot dell'output unito. */
  readonly fullLayerBytes: number;
  /** Seed History che devono essere creati, non quelli gia' posseduti cold. */
  readonly inputSeedBytes: readonly number[];
  /**
   * Picco della piega: una sorgente reidratata, un bake transitorio e una
   * superficie merged con mip. E' limitato a una sola sorgente alla volta.
   */
  readonly foldTransientBytes: number;
  /** Seed dell'output; il chiamante passa il bound sicuro noto prima del render. */
  readonly outputSeedBytes: number;
}

/**
 * Riserva il picco del primo merge, prima che l'output o i checkpoint History
 * possano essere allocati. I seed cold gia' appartenenti ai layer selezionati
 * vengono trasferiti a History, quindi non vengono contati una seconda volta.
 */
export function planLayerMergeCreateMemory(
  input: LayerMergeCreateMemoryInput,
): MemoryRequest {
  assertNonNegativeFinite(input.fullLayerBytes, "fullLayerBytes");
  assertNonNegativeFinite(input.foldTransientBytes, "foldTransientBytes");
  assertNonNegativeFinite(input.outputSeedBytes, "outputSeedBytes");
  const inputSeedBytes = totalBytes(input.inputSeedBytes, "inputSeedBytes");
  const steadyBytes = input.fullLayerBytes + input.outputSeedBytes;
  return {
    category: "layer-merge-create",
    steadyBytes,
    peakBytes: steadyBytes + inputSeedBytes + input.foldTransientBytes,
    priority: "normal",
  };
}

export interface LayerSwitchMemoryInput {
  /** Nuovo cold store dell'uscente, misurato dalla sua maschera tile. */
  readonly outgoingColdBytes: number;
  /** Texture hot piena da creare per l'entrante, se non e' gia' hot. */
  readonly incomingHotBytes: number;
  /** Eventuale prefetch cold dei due vicini del layer entrante. */
  readonly adjacentPrefetchBytes: number;
  /** Una superficie merged full-document completa di mip. */
  readonly fullMergedSurfaceBytes: number;
  /** Una sorgente cold reidratata e il suo bake analitico transitorio. */
  readonly foldTransientBytes: number;
}

/**
 * Riserva il picco di un cambio layer normale. Le vecchie superfici merged
 * vengono rilasciate prima della ricostruzione, ma il nuovo composito puo'
 * mantenere un lato sotto e uno sopra mentre viene piegato un input.
 */
export function planLayerSwitchMemory(
  input: LayerSwitchMemoryInput,
): MemoryRequest {
  for (const [label, value] of Object.entries(input)) {
    assertNonNegativeFinite(value, label);
  }
  return {
    category: "layer-switch",
    // Un cambio conserva un solo hot layer: il residuo e' gia' registrato dal
    // device una volta che la transazione ha completato.
    steadyBytes: 0,
    peakBytes: input.outgoingColdBytes
      + input.incomingHotBytes
      + input.adjacentPrefetchBytes
      + input.fullMergedSurfaceBytes * 2
      + input.foldTransientBytes,
    priority: "normal",
  };
}

export interface LayerDuplicateMemoryInput {
  /** Checkpoint History tiled che resta autorevole per Undo/Redo e replay. */
  readonly historySeedBytes: number;
  /** Cold tiled dell'originale creato prima di evacuarne la texture hot. */
  readonly sourceColdBytes: number;
  /**
   * Hot addizionale a regime: zero quando sostituisce quella dell'originale,
   * una texture piena quando l'originale Reference deve restare residente.
   */
  readonly additionalHotBytes: number;
  /** Una superficie merged full-document completa di mip. */
  readonly fullMergedSurfaceBytes: number;
  /** Una sorgente reidratata e un bake transitorio durante la piega. */
  readonly foldTransientBytes: number;
}

/**
 * Riserva il Duplicate prima della cattura del checkpoint. I pixel restano
 * sempre GPU→GPU: un seed tiled per History, un cold tiled per l'originale e
 * una sola nuova texture hot. Il caso Reference dichiara esplicitamente la
 * seconda hot residente, invece di nasconderla in una stima media.
 */
export function planLayerDuplicateMemory(
  input: LayerDuplicateMemoryInput,
): MemoryRequest {
  for (const [label, value] of Object.entries(input)) {
    assertNonNegativeFinite(value, label);
  }
  const steadyBytes = input.historySeedBytes
    + input.sourceColdBytes
    + input.additionalHotBytes;
  return {
    category: "layer-duplicate",
    steadyBytes,
    peakBytes: steadyBytes
      + input.fullMergedSurfaceBytes * 2
      + input.foldTransientBytes,
    priority: "normal",
  };
}
