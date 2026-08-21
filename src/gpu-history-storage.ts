export const GPU_HISTORY_STORAGE_STRATEGY =
  "gpu-resident-paged-packed-payload-copy-replay-local-spill-v2" as const;
export const GPU_HISTORY_PAGE_BYTES = 2 * 1024 * 1024;
export const GPU_HISTORY_COPY_ALIGNMENT_BYTES = 4;

export interface GpuHistorySlice {
  readonly id: number;
  readonly pageId: number;
  readonly buffer: GPUBuffer;
  readonly offsetBytes: number;
  readonly logicalBytes: number;
  readonly reservedBytes: number;
  readonly label: string;
}

export interface GpuHistoryStorageStats {
  readonly allocatedBytes: number;
  readonly usedLogicalBytes: number;
  readonly usedReservedBytes: number;
  readonly freeBytes: number;
  readonly pageCount: number;
  /** Resident slices. Stored-only handles deliberately do not count here. */
  readonly sliceCount: number;
}

export interface PreparedGpuHistoryRelease {
  readonly sliceCount: number;
  readonly logicalBytes: number;
  readonly reservedBytes: number;
  commitNoThrow(): number;
}

export interface PreparedGpuHistoryDemotion {
  readonly sliceCount: number;
  readonly logicalBytes: number;
  readonly reservedBytes: number;
  commitNoThrow(): number;
}

interface FreeRange {
  offsetBytes: number;
  sizeBytes: number;
}

interface HistoryPage {
  id: number;
  buffer: GPUBuffer;
  sizeBytes: number;
  freeRanges: FreeRange[];
  liveSliceCount: number;
}

interface SliceBinding {
  readonly page: HistoryPage;
  readonly offsetBytes: number;
  readonly reservedBytes: number;
}

interface ManagedGpuHistorySlice extends GpuHistorySlice {
  readonly alignmentBytes: number;
  binding: SliceBinding | null;
  released: boolean;
}

function alignBytes(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function assertAlignment(alignmentBytes: number): void {
  if (
    !Number.isInteger(alignmentBytes)
    || alignmentBytes < GPU_HISTORY_COPY_ALIGNMENT_BYTES
    || (alignmentBytes & (alignmentBytes - 1)) !== 0
  ) {
    throw new RangeError(
      "GPU history alignment must be a power of two >= 4.",
    );
  }
}

export class GpuHistoryStorage {
  private readonly pages: HistoryPage[] = [];
  private readonly device: GPUDevice;
  private readonly pageBytes: number;
  /** Stable logical handles, including payloads whose authority is on disk. */
  private readonly handles = new Map<number, ManagedGpuHistorySlice>();
  /** Physical bindings only. */
  private readonly resident = new Map<number, SliceBinding>();
  private releaseListener: ((slice: GpuHistorySlice) => void) | null = null;
  private nextPageId = 1;
  private nextSliceId = 1;
  private allocatedBytes = 0;
  private usedLogicalBytes = 0;
  private usedReservedBytes = 0;
  private destroyed = false;

  constructor(device: GPUDevice, pageBytes = GPU_HISTORY_PAGE_BYTES) {
    this.device = device;
    this.pageBytes = pageBytes;
    if (!Number.isInteger(pageBytes) || pageBytes <= 0) {
      throw new RangeError("A GPU history page must have a positive size.");
    }
  }

  prewarm(): void {
    this.assertAlive();
    if (this.pages.length === 0) this.pages.push(this.createPage(this.pageBytes));
  }

  setReleaseListener(listener: ((slice: GpuHistorySlice) => void) | null): void {
    this.releaseListener = listener;
  }

  allocate(
    logicalBytes: number,
    label: string,
    alignmentBytes = GPU_HISTORY_COPY_ALIGNMENT_BYTES,
  ): GpuHistorySlice {
    this.assertAlive();
    if (!Number.isInteger(logicalBytes) || logicalBytes <= 0) {
      throw new RangeError("A GPU history slice must contain at least one byte.");
    }
    assertAlignment(alignmentBytes);
    const binding = this.reserveBinding(logicalBytes, alignmentBytes);
    const id = this.nextSliceId++;
    let handle!: ManagedGpuHistorySlice;
    const requireBinding = (): SliceBinding => {
      if (handle.released) throw new Error(`History slice ${id} has already been released.`);
      if (!handle.binding) {
        throw new Error(`Local History slice ${id} was not rehydrated before replay.`);
      }
      return handle.binding;
    };
    handle = {
      id,
      logicalBytes,
      reservedBytes: binding.reservedBytes,
      label,
      alignmentBytes,
      binding,
      released: false,
      get pageId() {
        return requireBinding().page.id;
      },
      get buffer() {
        return requireBinding().page.buffer;
      },
      get offsetBytes() {
        return requireBinding().offsetBytes;
      },
    };
    this.handles.set(id, handle);
    this.resident.set(id, binding);
    return handle;
  }

  contains(slice: GpuHistorySlice): boolean {
    return this.handles.get(slice.id) === slice
      && !(slice as ManagedGpuHistorySlice).released;
  }

  isResident(slice: GpuHistorySlice): boolean {
    return this.contains(slice) && this.resident.has(slice.id);
  }

  /** O(1) lookup for diagnostics/storage ownership without journal rescans. */
  sliceById(id: number): GpuHistorySlice | null {
    return this.handles.get(id) ?? null;
  }

  alignmentBytes(slice: GpuHistorySlice): number {
    return this.requireOwnedHandle(slice).alignmentBytes;
  }

  residentSlices(): readonly GpuHistorySlice[] {
    return [...this.resident.keys()].map((id) => this.handles.get(id)!);
  }

  release(slice: GpuHistorySlice): boolean {
    const owned = this.handles.get(slice.id);
    if (!owned) return false;
    if (owned !== slice) {
      throw new Error("The GPU history slice does not belong to this allocator.");
    }
    return this.prepareReleaseMany([slice]).commitNoThrow() === 1;
  }

  /**
   * Validates the complete set before mutating allocator state. The returned
   * commit contains no user callback or further ownership check and is safe at
   * the durable-manifest boundary.
   */
  prepareReleaseMany(slices: readonly GpuHistorySlice[]): PreparedGpuHistoryRelease {
    this.assertAlive();
    const handles = this.validateUniqueOwnedSlices(slices, false);
    const logicalBytes = handles.reduce((total, slice) => total + slice.logicalBytes, 0);
    const reservedBytes = handles.reduce((total, slice) => (
      total + (slice.binding?.reservedBytes ?? 0)
    ), 0);
    let committed = false;
    return {
      sliceCount: handles.length,
      logicalBytes,
      reservedBytes,
      commitNoThrow: () => {
        if (committed) return 0;
        committed = true;
        const released = this.commitBindingsNoThrow(handles, true);
        for (const handle of handles) {
          try {
            this.releaseListener?.(handle);
          } catch {
            // Cleanup observers cannot make an ownership commit fail.
          }
        }
        return released;
      },
    };
  }

  releaseMany(slices: readonly GpuHistorySlice[]): number {
    this.assertAlive();
    // Preserve the established idempotent convenience API. Callers that need
    // an atomic ownership boundary use prepareReleaseMany directly.
    const unique: GpuHistorySlice[] = [];
    const seen = new Set<number>();
    for (const slice of slices) {
      if (seen.has(slice.id)) continue;
      seen.add(slice.id);
      const owned = this.handles.get(slice.id);
      if (!owned) continue;
      if (owned !== slice) {
        throw new Error("The GPU history slice does not belong to this allocator.");
      }
      unique.push(slice);
    }
    return this.prepareReleaseMany(unique).commitNoThrow();
  }

  prepareDemoteMany(slices: readonly GpuHistorySlice[]): PreparedGpuHistoryDemotion {
    this.assertAlive();
    const handles = this.validateUniqueOwnedSlices(slices, true);
    const logicalBytes = handles.reduce((total, slice) => total + slice.logicalBytes, 0);
    const reservedBytes = handles.reduce((total, slice) => (
      total + (slice.binding?.reservedBytes ?? 0)
    ), 0);
    let committed = false;
    return {
      sliceCount: handles.length,
      logicalBytes,
      reservedBytes,
      commitNoThrow: () => {
        if (committed) return 0;
        committed = true;
        return this.commitBindingsNoThrow(handles, false);
      },
    };
  }

  /** Restores a stored-only handle as a reconstructible resident cache. */
  hydrate(slice: GpuHistorySlice, bytes: Uint8Array): void {
    this.assertAlive();
    const handle = this.requireOwnedHandle(slice);
    if (handle.binding) return;
    if (bytes.byteLength !== handle.logicalBytes) {
      throw new Error(
        `Hydrate slice ${slice.id}: ${bytes.byteLength} B; expected ${handle.logicalBytes} B.`,
      );
    }
    const binding = this.reserveBinding(handle.logicalBytes, handle.alignmentBytes);
    try {
      const maximumWriteBytes = 16 * 1024 * 1024;
      let offset = 0;
      while (offset < bytes.byteLength) {
        const remaining = bytes.byteLength - offset;
        const logicalChunkBytes = Math.min(maximumWriteBytes, remaining);
        const alignedChunkBytes = alignBytes(logicalChunkBytes, GPU_HISTORY_COPY_ALIGNMENT_BYTES);
        if (alignedChunkBytes === logicalChunkBytes) {
          this.device.queue.writeBuffer(
            binding.page.buffer,
            binding.offsetBytes + offset,
            bytes,
            offset,
            logicalChunkBytes,
          );
        } else {
          const padded = new Uint8Array(alignedChunkBytes);
          padded.set(bytes.subarray(offset, offset + logicalChunkBytes));
          this.device.queue.writeBuffer(
            binding.page.buffer,
            binding.offsetBytes + offset,
            padded,
          );
        }
        offset += logicalChunkBytes;
      }
      handle.binding = binding;
      this.resident.set(handle.id, binding);
    } catch (error) {
      this.releaseBindingNoThrow(handle.logicalBytes, binding);
      throw error;
    }
  }

  releaseAll(): void {
    this.assertAlive();
    this.prepareReleaseMany([...this.handles.values()]).commitNoThrow();
  }

  trimEmptyPages(keepWarmPage = true): void {
    this.assertAlive();
    let warmPageKept = false;
    for (let index = this.pages.length - 1; index >= 0; index -= 1) {
      const page = this.pages[index];
      if (page.liveSliceCount !== 0) {
        if (keepWarmPage && page.sizeBytes === this.pageBytes) warmPageKept = true;
        continue;
      }
      if (keepWarmPage && !warmPageKept && page.sizeBytes === this.pageBytes) {
        warmPageKept = true;
        continue;
      }
      page.buffer.destroy();
      this.allocatedBytes -= page.sizeBytes;
      this.pages.splice(index, 1);
    }
    if (keepWarmPage && !warmPageKept) this.pages.push(this.createPage(this.pageBytes));
  }

  stats(): GpuHistoryStorageStats {
    return {
      allocatedBytes: this.allocatedBytes,
      usedLogicalBytes: this.usedLogicalBytes,
      usedReservedBytes: this.usedReservedBytes,
      freeBytes: Math.max(0, this.allocatedBytes - this.usedReservedBytes),
      pageCount: this.pages.length,
      sliceCount: this.resident.size,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.releaseAll();
    this.destroyed = true;
    this.releaseListener = null;
    for (const page of this.pages) page.buffer.destroy();
    this.pages.length = 0;
    this.handles.clear();
    this.resident.clear();
    this.allocatedBytes = 0;
    this.usedLogicalBytes = 0;
    this.usedReservedBytes = 0;
  }

  private validateUniqueOwnedSlices(
    slices: readonly GpuHistorySlice[],
    requireResident: boolean,
  ): ManagedGpuHistorySlice[] {
    const seen = new Set<number>();
    const result: ManagedGpuHistorySlice[] = [];
    for (const slice of slices) {
      if (seen.has(slice.id)) throw new Error(`Duplicate History slice ${slice.id}.`);
      seen.add(slice.id);
      const handle = this.requireOwnedHandle(slice);
      if (requireResident && !handle.binding) {
        throw new Error(`History slice ${slice.id} is not resident.`);
      }
      result.push(handle);
    }
    return result;
  }

  private requireOwnedHandle(slice: GpuHistorySlice): ManagedGpuHistorySlice {
    const handle = this.handles.get(slice.id);
    if (!handle || handle !== slice || handle.released) {
      throw new Error(`History slice ${slice.id} does not belong to the allocator.`);
    }
    return handle;
  }

  private commitBindingsNoThrow(
    handles: readonly ManagedGpuHistorySlice[],
    retire: boolean,
  ): number {
    const releasedByPage = new Map<HistoryPage, FreeRange[]>();
    let releasedResidentCount = 0;
    for (const handle of handles) {
      const binding = handle.binding;
      if (binding) {
        handle.binding = null;
        this.resident.delete(handle.id);
        binding.page.liveSliceCount -= 1;
        this.usedLogicalBytes -= handle.logicalBytes;
        this.usedReservedBytes -= binding.reservedBytes;
        const ranges = releasedByPage.get(binding.page) ?? [];
        ranges.push({ offsetBytes: binding.offsetBytes, sizeBytes: binding.reservedBytes });
        releasedByPage.set(binding.page, ranges);
        releasedResidentCount += 1;
      }
      if (retire) {
        handle.released = true;
        this.handles.delete(handle.id);
      }
    }
    for (const [page, ranges] of releasedByPage) {
      page.freeRanges.push(...ranges);
      this.mergeFreeRanges(page);
    }
    return retire ? handles.length : releasedResidentCount;
  }

  private reserveBinding(logicalBytes: number, alignmentBytes: number): SliceBinding {
    const reservedBytes = alignBytes(logicalBytes, GPU_HISTORY_COPY_ALIGNMENT_BYTES);
    let page: HistoryPage | null = null;
    let rangeIndex = -1;
    let alignedOffsetBytes = -1;
    for (const candidate of this.pages) {
      const candidateRangeIndex = candidate.freeRanges.findIndex((range) => {
        const alignedOffset = alignBytes(range.offsetBytes, alignmentBytes);
        return alignedOffset + reservedBytes <= range.offsetBytes + range.sizeBytes;
      });
      if (candidateRangeIndex >= 0) {
        page = candidate;
        rangeIndex = candidateRangeIndex;
        alignedOffsetBytes = alignBytes(
          candidate.freeRanges[candidateRangeIndex].offsetBytes,
          alignmentBytes,
        );
        break;
      }
    }
    if (!page) {
      page = this.createPage(alignBytes(Math.max(this.pageBytes, reservedBytes), this.pageBytes));
      this.pages.push(page);
      rangeIndex = 0;
      alignedOffsetBytes = 0;
    }
    const range = page.freeRanges[rangeIndex];
    const allocationEnd = alignedOffsetBytes + reservedBytes;
    const rangeEnd = range.offsetBytes + range.sizeBytes;
    const replacement: FreeRange[] = [];
    if (alignedOffsetBytes > range.offsetBytes) {
      replacement.push({
        offsetBytes: range.offsetBytes,
        sizeBytes: alignedOffsetBytes - range.offsetBytes,
      });
    }
    if (allocationEnd < rangeEnd) {
      replacement.push({ offsetBytes: allocationEnd, sizeBytes: rangeEnd - allocationEnd });
    }
    page.freeRanges.splice(rangeIndex, 1, ...replacement);
    page.liveSliceCount += 1;
    this.usedLogicalBytes += logicalBytes;
    this.usedReservedBytes += reservedBytes;
    return { page, offsetBytes: alignedOffsetBytes, reservedBytes };
  }

  private releaseBindingNoThrow(logicalBytes: number, binding: SliceBinding): void {
    binding.page.liveSliceCount -= 1;
    this.usedLogicalBytes -= logicalBytes;
    this.usedReservedBytes -= binding.reservedBytes;
    binding.page.freeRanges.push({
      offsetBytes: binding.offsetBytes,
      sizeBytes: binding.reservedBytes,
    });
    this.mergeFreeRanges(binding.page);
  }

  private createPage(sizeBytes: number): HistoryPage {
    const id = this.nextPageId++;
    const buffer = this.device.createBuffer({
      label: `GPU raster history · page ${id} · ${sizeBytes} B`,
      size: sizeBytes,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    this.allocatedBytes += sizeBytes;
    return {
      id,
      buffer,
      sizeBytes,
      freeRanges: [{ offsetBytes: 0, sizeBytes }],
      liveSliceCount: 0,
    };
  }

  private mergeFreeRanges(page: HistoryPage): void {
    page.freeRanges.sort((left, right) => left.offsetBytes - right.offsetBytes);
    const merged: FreeRange[] = [];
    for (const range of page.freeRanges) {
      const previous = merged.at(-1);
      if (previous && previous.offsetBytes + previous.sizeBytes === range.offsetBytes) {
        previous.sizeBytes += range.sizeBytes;
      } else {
        merged.push({ ...range });
      }
    }
    page.freeRanges = merged;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("The GPU history allocator has already been destroyed.");
  }
}
