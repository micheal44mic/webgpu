export const GPU_HISTORY_STORAGE_STRATEGY =
  "gpu-resident-paged-packed-payload-copy-replay" as const;
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
  readonly sliceCount: number;
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

interface LiveSlice {
  slice: GpuHistorySlice;
  page: HistoryPage;
}

function alignBytes(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export class GpuHistoryStorage {
  private readonly pages: HistoryPage[] = [];
  private readonly device: GPUDevice;
  private readonly pageBytes: number;
  private readonly liveSlices = new Map<number, LiveSlice>();
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
      throw new RangeError("La pagina della cronologia GPU deve avere dimensione positiva.");
    }
  }

  prewarm(): void {
    this.assertAlive();
    if (this.pages.length === 0) {
      this.pages.push(this.createPage(this.pageBytes));
    }
  }

  allocate(
    logicalBytes: number,
    label: string,
    alignmentBytes = GPU_HISTORY_COPY_ALIGNMENT_BYTES,
  ): GpuHistorySlice {
    this.assertAlive();
    if (!Number.isInteger(logicalBytes) || logicalBytes <= 0) {
      throw new RangeError("La slice della cronologia GPU deve contenere almeno un byte.");
    }
    if (
      !Number.isInteger(alignmentBytes)
      || alignmentBytes < GPU_HISTORY_COPY_ALIGNMENT_BYTES
      || (alignmentBytes & (alignmentBytes - 1)) !== 0
    ) {
      throw new RangeError("L'allineamento della cronologia GPU deve essere una potenza di due >= 4.");
    }
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
      page = this.createPage(alignBytes(
        Math.max(this.pageBytes, reservedBytes),
        this.pageBytes,
      ));
      this.pages.push(page);
      rangeIndex = 0;
      alignedOffsetBytes = 0;
    }
    if (rangeIndex < 0) {
      throw new Error("Allocatore cronologia GPU incoerente: pagina senza spazio.");
    }
    const range = page.freeRanges[rangeIndex];
    const offsetBytes = alignedOffsetBytes;
    const rangeEnd = range.offsetBytes + range.sizeBytes;
    const allocationEnd = offsetBytes + reservedBytes;
    const replacement: FreeRange[] = [];
    if (offsetBytes > range.offsetBytes) {
      replacement.push({
        offsetBytes: range.offsetBytes,
        sizeBytes: offsetBytes - range.offsetBytes,
      });
    }
    if (allocationEnd < rangeEnd) {
      replacement.push({
        offsetBytes: allocationEnd,
        sizeBytes: rangeEnd - allocationEnd,
      });
    }
    page.freeRanges.splice(rangeIndex, 1, ...replacement);
    page.liveSliceCount += 1;
    const slice: GpuHistorySlice = {
      id: this.nextSliceId++,
      pageId: page.id,
      buffer: page.buffer,
      offsetBytes,
      logicalBytes,
      reservedBytes,
      label,
    };
    this.liveSlices.set(slice.id, { slice, page });
    this.usedLogicalBytes += logicalBytes;
    this.usedReservedBytes += reservedBytes;
    return slice;
  }

  release(slice: GpuHistorySlice): boolean {
    const live = this.liveSlices.get(slice.id);
    if (!live) {
      return false;
    }
    if (
      live.slice !== slice
      || live.page.id !== slice.pageId
      || live.page.buffer !== slice.buffer
    ) {
      throw new Error("Slice della cronologia GPU non appartenente a questo allocatore.");
    }
    this.liveSlices.delete(slice.id);
    live.page.liveSliceCount -= 1;
    this.usedLogicalBytes -= slice.logicalBytes;
    this.usedReservedBytes -= slice.reservedBytes;
    this.insertFreeRange(live.page, {
      offsetBytes: slice.offsetBytes,
      sizeBytes: slice.reservedBytes,
    });
    return true;
  }

  releaseMany(slices: readonly GpuHistorySlice[]): number {
    this.assertAlive();
    const releasedByPage = new Map<HistoryPage, FreeRange[]>();
    let releasedCount = 0;
    for (const slice of slices) {
      const live = this.liveSlices.get(slice.id);
      if (!live) {
        continue;
      }
      if (
        live.slice !== slice
        || live.page.id !== slice.pageId
        || live.page.buffer !== slice.buffer
      ) {
        throw new Error("Slice della cronologia GPU non appartenente a questo allocatore.");
      }
      this.liveSlices.delete(slice.id);
      live.page.liveSliceCount -= 1;
      this.usedLogicalBytes -= slice.logicalBytes;
      this.usedReservedBytes -= slice.reservedBytes;
      const ranges = releasedByPage.get(live.page) ?? [];
      ranges.push({
        offsetBytes: slice.offsetBytes,
        sizeBytes: slice.reservedBytes,
      });
      releasedByPage.set(live.page, ranges);
      releasedCount += 1;
    }
    for (const [page, ranges] of releasedByPage) {
      page.freeRanges.push(...ranges);
      this.mergeFreeRanges(page);
    }
    return releasedCount;
  }

  releaseAll(): void {
    this.assertAlive();
    this.liveSlices.clear();
    this.usedLogicalBytes = 0;
    this.usedReservedBytes = 0;
    for (const page of this.pages) {
      page.liveSliceCount = 0;
      page.freeRanges = [{ offsetBytes: 0, sizeBytes: page.sizeBytes }];
    }
  }

  trimEmptyPages(keepWarmPage = true): void {
    this.assertAlive();
    let warmPageKept = false;
    for (let index = this.pages.length - 1; index >= 0; index -= 1) {
      const page = this.pages[index];
      if (page.liveSliceCount !== 0) {
        if (keepWarmPage && page.sizeBytes === this.pageBytes) {
          warmPageKept = true;
        }
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
    if (keepWarmPage && !warmPageKept) {
      this.pages.push(this.createPage(this.pageBytes));
    }
  }

  stats(): GpuHistoryStorageStats {
    return {
      allocatedBytes: this.allocatedBytes,
      usedLogicalBytes: this.usedLogicalBytes,
      usedReservedBytes: this.usedReservedBytes,
      freeBytes: Math.max(0, this.allocatedBytes - this.usedReservedBytes),
      pageCount: this.pages.length,
      sliceCount: this.liveSlices.size,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.liveSlices.clear();
    this.allocatedBytes = 0;
    this.usedLogicalBytes = 0;
    this.usedReservedBytes = 0;
    for (const page of this.pages) {
      page.buffer.destroy();
    }
    this.pages.length = 0;
  }

  private createPage(sizeBytes: number): HistoryPage {
    const id = this.nextPageId++;
    const buffer = this.device.createBuffer({
      label: `Cronologia raster GPU · pagina ${id} · ${sizeBytes} B`,
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

  private insertFreeRange(page: HistoryPage, released: FreeRange): void {
    page.freeRanges.push(released);
    this.mergeFreeRanges(page);
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
    if (this.destroyed) {
      throw new Error("Allocatore della cronologia GPU già distrutto.");
    }
  }
}
