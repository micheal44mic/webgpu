import type { Shadow3dPathData } from "./vector-shadow-3d.ts";

const VECTOR_PATH_IDENTITY_VERSION = "vector-path-v2" as const;

export const VECTOR_PATH_IDENTITY_MAXIMUM_RETAINED_ENTRIES = 256;
export const VECTOR_PATH_IDENTITY_MAXIMUM_RETAINED_BYTES = 32 * 1024 * 1024;

export type VectorPathFingerprint = (path: Readonly<Shadow3dPathData>) => string;

function pathViewBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function avalanche(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b) >>> 0;
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35) >>> 0;
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

export function fingerprintVectorPath(
  path: Readonly<Shadow3dPathData>,
): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let third = 0xc2b2ae35;
  let fourth = 0x165667b1;
  const updateByte = (value: number): void => {
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + 0x9d), 0x85ebca6b) >>> 0;
    third = Math.imul(third ^ (value + 0x3d), 0x27d4eb2f) >>> 0;
    fourth = Math.imul(fourth ^ (value + 0x7f), 0x9e3779b1) >>> 0;
  };
  const updateUint32 = (value: number): void => {
    const normalized = value >>> 0;
    updateByte(normalized & 0xff);
    updateByte((normalized >>> 8) & 0xff);
    updateByte((normalized >>> 16) & 0xff);
    updateByte((normalized >>> 24) & 0xff);
  };
  const updateView = (domain: number, view: ArrayBufferView): void => {
    updateUint32(domain);
    updateUint32(view.byteLength);
    for (const value of pathViewBytes(view)) updateByte(value);
  };

  updateUint32(1);
  updateUint32(Number(path.fillRule));
  updateView(1, path.verbs);
  updateView(2, path.coords);
  updateView(3, path.contourOffsets);
  return [first, second, third, fourth]
    .map((value) => avalanche(value).toString(16).padStart(8, "0"))
    .join("");
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function equalUint32Words(first: Float64Array, second: Float64Array): boolean {
  if (first.length !== second.length) return false;
  const firstWords = new Uint32Array(
    first.buffer,
    first.byteOffset,
    first.byteLength / Uint32Array.BYTES_PER_ELEMENT,
  );
  const secondWords = new Uint32Array(
    second.buffer,
    second.byteOffset,
    second.byteLength / Uint32Array.BYTES_PER_ELEMENT,
  );
  for (let index = 0; index < firstWords.length; index += 1) {
    if (firstWords[index] !== secondWords[index]) return false;
  }
  return true;
}

export function vectorPathsEqualBitwise(
  first: Readonly<Shadow3dPathData>,
  second: Readonly<Shadow3dPathData>,
): boolean {
  if (Number(first.fillRule) !== Number(second.fillRule)) return false;
  if (!equalBytes(first.verbs, second.verbs)) return false;
  if (!equalUint32Words(first.coords, second.coords)) return false;
  if (first.contourOffsets.length !== second.contourOffsets.length) return false;
  for (let index = 0; index < first.contourOffsets.length; index += 1) {
    if (first.contourOffsets[index] !== second.contourOffsets[index]) return false;
  }
  return true;
}

interface VectorPathIdentityEntry {
  readonly identity: string;
  readonly fingerprint: string;
  readonly snapshot: Readonly<Shadow3dPathData>;
  readonly byteLength: number;
  lastUsed: number;
}

interface CachedVectorPathIdentity {
  readonly identity: string;
}

function snapshotVectorPath(
  path: Readonly<Shadow3dPathData>,
): Readonly<Shadow3dPathData> {
  return {
    fillRule: Number(path.fillRule),
    verbs: path.verbs.slice(),
    coords: path.coords.slice(),
    contourOffsets: path.contourOffsets.slice(),
  };
}

function vectorPathByteLength(path: Readonly<Shadow3dPathData>): number {
  return path.verbs.byteLength
    + path.coords.byteLength
    + path.contourOffsets.byteLength;
}

export class VectorPathIdentityPool {
  private readonly fingerprint: VectorPathFingerprint;
  private readonly maximumRetainedEntries: number;
  private readonly maximumRetainedBytes: number;
  private buckets = new Map<string, VectorPathIdentityEntry[]>();
  private entriesByIdentity = new Map<string, VectorPathIdentityEntry>();
  private identitiesByPath = new WeakMap<object, CachedVectorPathIdentity>();
  private retainedBytes = 0;
  private accessSequence = 0;
  private identitySequence = 0;
  private scope = 0;

  constructor(
    fingerprint: VectorPathFingerprint = fingerprintVectorPath,
    maximumRetainedEntries = VECTOR_PATH_IDENTITY_MAXIMUM_RETAINED_ENTRIES,
    maximumRetainedBytes = VECTOR_PATH_IDENTITY_MAXIMUM_RETAINED_BYTES,
  ) {
    if (
      !Number.isSafeInteger(maximumRetainedEntries)
      || maximumRetainedEntries < 1
    ) {
      throw new Error("The vector path identity entry limit must be a positive integer.");
    }
    if (!Number.isSafeInteger(maximumRetainedBytes) || maximumRetainedBytes < 1) {
      throw new Error("The vector path identity byte limit must be a positive integer.");
    }
    this.fingerprint = fingerprint;
    this.maximumRetainedEntries = maximumRetainedEntries;
    this.maximumRetainedBytes = maximumRetainedBytes;
  }

  intern(path: Readonly<Shadow3dPathData>): string {
    const cached = this.identitiesByPath.get(path);
    if (cached) {
      const retained = this.entriesByIdentity.get(cached.identity);
      if (retained) this.touch(retained);
      return cached.identity;
    }

    const fingerprint = this.fingerprint(path);
    const bucket = this.buckets.get(fingerprint) ?? [];
    for (const entry of bucket) {
      if (vectorPathsEqualBitwise(entry.snapshot, path)) {
        this.touch(entry);
        this.identitiesByPath.set(path, { identity: entry.identity });
        return entry.identity;
      }
    }

    const identity = [
      VECTOR_PATH_IDENTITY_VERSION,
      `scope-${this.scope}`,
      fingerprint,
      `entry-${this.identitySequence}`,
    ].join(":");
    this.identitySequence += 1;
    this.identitiesByPath.set(path, { identity });
    const byteLength = vectorPathByteLength(path);
    if (byteLength > this.maximumRetainedBytes) {
      return identity;
    }

    this.pruneRetainedEntries(byteLength);
    const snapshot = snapshotVectorPath(path);
    const entry: VectorPathIdentityEntry = {
      identity,
      fingerprint,
      snapshot,
      byteLength,
      lastUsed: this.nextAccessSequence(),
    };
    const retainedBucket = this.buckets.get(fingerprint) ?? [];
    retainedBucket.push(entry);
    this.buckets.set(fingerprint, retainedBucket);
    this.entriesByIdentity.set(identity, entry);
    this.retainedBytes += entry.byteLength;
    return identity;
  }

  /**
   * Invalidates the object-identity fast path before a caller mutates a
   * published path in place. Normal geometry edits create a new path object.
   */
  invalidate(path: Readonly<Shadow3dPathData>): void {
    this.identitiesByPath.delete(path);
  }

  retainedEntryCount(): number {
    return this.entriesByIdentity.size;
  }

  retainedByteLength(): number {
    return this.retainedBytes;
  }

  clear(): void {
    if (this.scope >= Number.MAX_SAFE_INTEGER) {
      throw new Error("The vector path identity scope is exhausted.");
    }
    this.scope += 1;
    this.buckets = new Map();
    this.entriesByIdentity = new Map();
    this.identitiesByPath = new WeakMap();
    this.retainedBytes = 0;
    this.accessSequence = 0;
    this.identitySequence = 0;
  }

  private nextAccessSequence(): number {
    this.accessSequence += 1;
    return this.accessSequence;
  }

  private touch(entry: VectorPathIdentityEntry): void {
    entry.lastUsed = this.nextAccessSequence();
  }

  private pruneRetainedEntries(incomingBytes: number): void {
    while (
      this.entriesByIdentity.size >= this.maximumRetainedEntries
      || this.retainedBytes + incomingBytes > this.maximumRetainedBytes
    ) {
      let oldest: VectorPathIdentityEntry | null = null;
      for (const entry of this.entriesByIdentity.values()) {
        if (!oldest || entry.lastUsed < oldest.lastUsed) {
          oldest = entry;
        }
      }
      if (!oldest) return;
      this.entriesByIdentity.delete(oldest.identity);
      this.retainedBytes -= oldest.byteLength;
      const bucket = this.buckets.get(oldest.fingerprint);
      if (!bucket) continue;
      const retainedBucket = bucket.filter(
        (entry) => entry.identity !== oldest.identity,
      );
      if (retainedBucket.length === 0) {
        this.buckets.delete(oldest.fingerprint);
      } else {
        this.buckets.set(oldest.fingerprint, retainedBucket);
      }
    }
  }
}
