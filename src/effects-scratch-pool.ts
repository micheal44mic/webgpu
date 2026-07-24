export const EFFECTS_SCRATCH_POOL_STRATEGY =
  "single-buffer-aliased-effect-layouts-grow-immediate-shrink-idle-hysteresis" as const;

export const EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS = 1_500;

export interface EffectsScratchIdleState {
  initialized: boolean;
  activeStroke: boolean;
  historyBusy: boolean;
  rasterStrokeBusy: boolean;
  rasterBevelBusy: boolean;
  queuedWork: boolean;
}

export function effectsScratchCanShrink(state: EffectsScratchIdleState): boolean {
  return state.initialized
    && !state.activeStroke
    && !state.historyBusy
    && !state.rasterStrokeBusy
    && !state.rasterBevelBusy
    && !state.queuedWork;
}

export interface EffectsScratchRangeRequest {
  id: string;
  label: string;
  size: number;
}

export interface EffectsScratchRange {
  offset: number;
  size: number;
}

export interface EffectsScratchLease {
  buffer: GPUBuffer;
  effectId: string;
  footprintBytes: number;
  generation: number;
  layoutVersion: number;
  ranges: Readonly<Record<string, EffectsScratchRange>>;
}

export interface EffectsScratchPoolSnapshot {
  strategy: typeof EFFECTS_SCRATCH_POOL_STRATEGY;
  currentBytes: number;
  peakBytes: number;
  generation: number;
  allocationCount: number;
  shrinkCount: number;
  requirements: Readonly<Record<string, number>>;
}

export interface EffectsScratchPoolOptions {
  canReallocate?: () => boolean;
}

interface StoredRequirement {
  footprintBytes: number;
  layoutVersion: number;
  ranges: Readonly<Record<string, EffectsScratchRange>>;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function normalizedBytes(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Dimensione scratch ${label} non valida: ${value}.`);
  }
  return align(Math.ceil(value), 4);
}

function sameRanges(
  left: Readonly<Record<string, EffectsScratchRange>>,
  right: Readonly<Record<string, EffectsScratchRange>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) =>
      right[key]?.offset === left[key].offset
      && right[key]?.size === left[key].size);
}

/**
 * One physical GPUBuffer shared by temporally disjoint effects.
 *
 * Every effect receives a private layout starting at byte zero. Layouts from
 * different effects intentionally alias; ranges inside one layout never do.
 * Growth is immediate. Shrink is explicit so the engine can wait for GPU idle
 * and apply its interaction hysteresis before replacing the buffer.
 */
export class EffectsScratchPool {
  private readonly device: GPUDevice;
  private readonly storageAlignment: number;
  private readonly maximumBufferBytes: number;
  private readonly maximumBindingBytes: number;
  private readonly canReallocate: () => boolean;
  private readonly requirements = new Map<string, StoredRequirement>();
  private buffer: GPUBuffer | null = null;
  private _currentBytes = 0;
  private _peakBytes = 0;
  private _generation = 0;
  private _allocationCount = 0;
  private _shrinkCount = 0;
  private destroyed = false;

  constructor(device: GPUDevice, options: EffectsScratchPoolOptions = {}) {
    this.device = device;
    this.canReallocate = options.canReallocate ?? (() => true);
    this.storageAlignment = Math.max(
      4,
      Number(device.limits.minStorageBufferOffsetAlignment),
    );
    this.maximumBufferBytes = Number(device.limits.maxBufferSize);
    this.maximumBindingBytes = Number(device.limits.maxStorageBufferBindingSize);
  }

  get currentBytes(): number {
    return this._currentBytes;
  }

  get peakBytes(): number {
    return this._peakBytes;
  }

  get generation(): number {
    return this._generation;
  }

  get allocationCount(): number {
    return this._allocationCount;
  }

  get shrinkCount(): number {
    return this._shrinkCount;
  }

  setRequirement(
    effectId: string,
    rangeRequests: readonly EffectsScratchRangeRequest[],
  ): EffectsScratchLease {
    this.assertLive();
    if (!effectId) {
      throw new Error("Identità effetto scratch mancante.");
    }
    if (rangeRequests.length === 0) {
      throw new Error(`L'effetto ${effectId} non ha dichiarato range scratch.`);
    }

    let cursor = 0;
    const ranges: Record<string, EffectsScratchRange> = {};
    for (const request of rangeRequests) {
      if (!request.id || ranges[request.id]) {
        throw new Error(`Range scratch duplicato o senza identità per ${effectId}.`);
      }
      const size = normalizedBytes(request.size, `${effectId}/${request.label}`);
      if (size > this.maximumBindingBytes) {
        throw new Error(
          `Scratch ${effectId} ${request.label} (${size} byte) `
          + "oltre maxStorageBufferBindingSize.",
        );
      }
      cursor = align(cursor, this.storageAlignment);
      ranges[request.id] = { offset: cursor, size };
      cursor += size;
    }
    const footprintBytes = align(cursor, this.storageAlignment);
    if (footprintBytes > this.maximumBufferBytes) {
      throw new Error(
        `Scratch ${effectId} (${footprintBytes} byte) oltre maxBufferSize.`,
      );
    }

    const previous = this.requirements.get(effectId);
    const layoutVersion = previous && sameRanges(previous.ranges, ranges)
      ? previous.layoutVersion
      : (previous?.layoutVersion ?? 0) + 1;
    this.requirements.set(effectId, {
      footprintBytes,
      layoutVersion,
      ranges: Object.freeze(ranges),
    });
    this.ensureCapacity(this.requiredCapacity());
    return this.requireLease(effectId);
  }

  releaseRequirement(effectId: string): void {
    this.assertLive();
    this.requirements.delete(effectId);
  }

  lease(effectId: string): EffectsScratchLease | null {
    this.assertLive();
    return this.requirements.has(effectId) ? this.requireLease(effectId) : null;
  }

  shrinkToFit(): boolean {
    this.assertLive();
    const targetBytes = this.requiredCapacity();
    if (targetBytes >= this._currentBytes) {
      return false;
    }
    this.replaceBuffer(targetBytes, true);
    return true;
  }

  snapshot(): EffectsScratchPoolSnapshot {
    const requirements: Record<string, number> = {};
    for (const [effectId, requirement] of this.requirements) {
      requirements[effectId] = requirement.footprintBytes;
    }
    return {
      strategy: EFFECTS_SCRATCH_POOL_STRATEGY,
      currentBytes: this._currentBytes,
      peakBytes: this._peakBytes,
      generation: this._generation,
      allocationCount: this._allocationCount,
      shrinkCount: this._shrinkCount,
      requirements,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.buffer?.destroy();
    this.buffer = null;
    this.requirements.clear();
    this._currentBytes = 0;
    this._generation += 1;
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new Error("Pool scratch effetti già distrutto.");
    }
  }

  private requiredCapacity(): number {
    let required = 0;
    for (const requirement of this.requirements.values()) {
      required = Math.max(required, requirement.footprintBytes);
    }
    return required;
  }

  private ensureCapacity(requiredBytes: number): void {
    if (requiredBytes <= this._currentBytes) {
      return;
    }
    this.replaceBuffer(requiredBytes, false);
  }

  private replaceBuffer(requiredBytes: number, shrink: boolean): void {
    const size = requiredBytes > 0
      ? align(requiredBytes, this.storageAlignment)
      : 0;
    if (size > this.maximumBufferBytes) {
      throw new Error(`Pool scratch effetti ${size} byte oltre maxBufferSize.`);
    }
    if (size !== this._currentBytes && !this.canReallocate()) {
      throw new Error(
        "Riallocazione del pool scratch effetti vietata durante una pennellata attiva.",
      );
    }
    const nextBuffer = size > 0
      ? this.device.createBuffer({
        label: `Banco effetti scratch condiviso ${size} byte`,
        size,
        usage: GPUBufferUsage.STORAGE,
      })
      : null;
    const previousBuffer = this.buffer;
    this.buffer = nextBuffer;
    this._currentBytes = size;
    this._peakBytes = Math.max(this._peakBytes, size);
    this._generation += 1;
    this._allocationCount += size > 0 ? 1 : 0;
    this._shrinkCount += shrink ? 1 : 0;
    previousBuffer?.destroy();
  }

  private requireLease(effectId: string): EffectsScratchLease {
    const requirement = this.requirements.get(effectId);
    if (!requirement || !this.buffer) {
      throw new Error(`Lease scratch ${effectId} non disponibile.`);
    }
    return {
      buffer: this.buffer,
      effectId,
      footprintBytes: requirement.footprintBytes,
      generation: this._generation,
      layoutVersion: requirement.layoutVersion,
      ranges: requirement.ranges,
    };
  }
}
