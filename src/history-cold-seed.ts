import type { LayerColdStorageResources } from "./engine-layer-resources";

const HISTORY_COLD_SEED_HANDLE = Symbol("history-cold-seed-handle");

export interface HistoryColdSeedHandle extends LayerColdStorageResources {
  readonly [HISTORY_COLD_SEED_HANDLE]: true;
  readonly payloadId: string;
  readonly ownerActionId: number;
  readonly layerId: number;
  readonly resident: boolean;
  readonly retired: boolean;
  residentValue(): LayerColdStorageResources | null;
  attachResident(value: LayerColdStorageResources): void;
  demoteResidentNoThrow(): LayerColdStorageResources | null;
  retireNoThrow(): void;
}

export function createHistoryColdSeedHandle(options: {
  readonly payloadId: string;
  readonly ownerActionId: number;
  readonly layerId: number;
  readonly seed: LayerColdStorageResources;
  readonly onRetire: (handle: HistoryColdSeedHandle) => void;
}): HistoryColdSeedHandle {
  const metadata = {
    tileIndices: [...options.seed.tileIndices],
    memoryBytes: options.seed.memoryBytes,
    generation: options.seed.generation,
    format: options.seed.format,
  } as const;
  let residentValue: LayerColdStorageResources | null = options.seed;
  let retired = false;

  const requireResident = (): LayerColdStorageResources => {
    if (retired) throw new Error("Seed History già ritirato.");
    if (!residentValue) {
      throw new Error("Seed History locale non reidratato prima del replay.");
    }
    return residentValue;
  };

  const handle: HistoryColdSeedHandle = {
    [HISTORY_COLD_SEED_HANDLE]: true,
    payloadId: options.payloadId,
    ownerActionId: options.ownerActionId,
    layerId: options.layerId,
    get resident() {
      return residentValue !== null;
    },
    get retired() {
      return retired;
    },
    get texture() {
      return requireResident().texture;
    },
    tileIndices: metadata.tileIndices,
    memoryBytes: metadata.memoryBytes,
    generation: metadata.generation,
    format: metadata.format,
    residentValue() {
      return residentValue;
    },
    attachResident(value) {
      if (retired) throw new Error("Impossibile reidratare un seed History ritirato.");
      if (residentValue) throw new Error("Seed History già residente.");
      if (
        value.memoryBytes !== metadata.memoryBytes
        || value.generation !== metadata.generation
        || value.format !== metadata.format
        || value.tileIndices.length !== metadata.tileIndices.length
        || value.tileIndices.some((tile, index) => tile !== metadata.tileIndices[index])
      ) {
        throw new Error("Seed History reidratato incompatibile con il descriptor.");
      }
      residentValue = value;
    },
    demoteResidentNoThrow() {
      const value = residentValue;
      residentValue = null;
      return value;
    },
    retireNoThrow() {
      if (retired) return;
      retired = true;
      const value = residentValue;
      residentValue = null;
      try {
        value?.texture.destroy();
      } catch {
        // A driver-side destroy failure may leak a duplicate, never ownership.
      }
      try {
        options.onRetire(handle);
      } catch {
        // Storage cleanup is best-effort and cannot invalidate the document.
      }
    },
  };
  return handle;
}

export function isHistoryColdSeedHandle(
  value: LayerColdStorageResources | null | undefined,
): value is HistoryColdSeedHandle {
  return Boolean(
    value
    && (value as Partial<HistoryColdSeedHandle>)[HISTORY_COLD_SEED_HANDLE] === true,
  );
}

export function historyColdSeedResidentBytes(
  value: LayerColdStorageResources | null | undefined,
): number {
  if (!value) return 0;
  return isHistoryColdSeedHandle(value) && !value.resident ? 0 : value.memoryBytes;
}
