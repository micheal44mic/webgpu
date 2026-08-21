import type {
  BrushGrainAssetId,
  BrushShapeAssetId,
  CustomBrushGrainAssetId,
  CustomBrushShapeAssetId,
} from "./engine-types";

const CUSTOM_ASSET_MAX_DIMENSION = 4096;
const CUSTOM_ASSET_ID_MAX_LENGTH = 192;

export interface DecodedCustomBrushImage {
  readonly width: number;
  readonly height: number;
  /** Unpremultiplied RGBA8 pixels in row-major order. The registry takes a copy. */
  readonly rgba: Uint8Array | Uint8ClampedArray;
  readonly name?: string;
  readonly mimeType?: string;
}

export interface CustomBrushAssetSnapshot {
  readonly id: CustomBrushShapeAssetId | CustomBrushGrainAssetId;
  readonly kind: "shape" | "grain";
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

export interface RegisteredCustomBrushAsset extends Omit<CustomBrushAssetSnapshot, "rgba"> {
  readonly rgba: Uint8Array;
}

function isValidCustomAssetId(value: string, prefix: "custom-shape:" | "custom-grain:"): boolean {
  return value.startsWith(prefix)
    && value.length > prefix.length
    && value.length <= CUSTOM_ASSET_ID_MAX_LENGTH
    && /^[a-z0-9][a-z0-9._-]*$/i.test(value.slice(prefix.length));
}

export function isCustomShapeAssetId(value: unknown): value is CustomBrushShapeAssetId {
  return typeof value === "string" && isValidCustomAssetId(value, "custom-shape:");
}

export function isCustomGrainAssetId(value: unknown): value is CustomBrushGrainAssetId {
  return typeof value === "string" && isValidCustomAssetId(value, "custom-grain:");
}

function validateDecodedImage(source: DecodedCustomBrushImage): Uint8Array {
  if (
    !Number.isInteger(source.width)
    || !Number.isInteger(source.height)
    || source.width < 1
    || source.height < 1
    || source.width > CUSTOM_ASSET_MAX_DIMENSION
    || source.height > CUSTOM_ASSET_MAX_DIMENSION
  ) {
    throw new RangeError(
      `A brush asset must measure between 1 and ${CUSTOM_ASSET_MAX_DIMENSION} px per side.`,
    );
  }
  const expectedBytes = source.width * source.height * 4;
  if (source.rgba.byteLength !== expectedBytes) {
    throw new RangeError(`RGBA8 asset: ${source.rgba.byteLength} B, expected ${expectedBytes} B.`);
  }
  return new Uint8Array(source.rgba);
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * CPU-side immutable source registry owned by one BrushEngine. GPU residency
 * remains in the engine's existing transactional/latest-only resource swap.
 */
export class CustomBrushAssetRegistry {
  private readonly assets = new Map<string, RegisteredCustomBrushAsset>();
  private sequence = 1;

  registerShape(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushShapeAssetId,
  ): CustomBrushShapeAssetId {
    const rgba = validateDecodedImage(source);
    const id = requestedId ?? this.createId("shape", source.width, source.height, rgba);
    if (!isCustomShapeAssetId(id)) {
      throw new TypeError("Invalid custom Shape ID.");
    }
    this.store({
      id,
      kind: "shape",
      width: source.width,
      height: source.height,
      rgba,
      name: source.name?.trim() || "Custom Shape",
      mimeType: source.mimeType?.trim() || "image/png",
    });
    return id;
  }

  registerGrain(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushGrainAssetId,
  ): CustomBrushGrainAssetId {
    const rgba = validateDecodedImage(source);
    const id = requestedId ?? this.createId("grain", source.width, source.height, rgba);
    if (!isCustomGrainAssetId(id)) {
      throw new TypeError("Invalid custom Grain ID.");
    }
    this.store({
      id,
      kind: "grain",
      width: source.width,
      height: source.height,
      rgba,
      name: source.name?.trim() || "Custom Grain",
      mimeType: source.mimeType?.trim() || "image/png",
    });
    return id;
  }

  resolveShape(id: BrushShapeAssetId): RegisteredCustomBrushAsset | null {
    if (!isCustomShapeAssetId(id)) return null;
    const asset = this.assets.get(id);
    if (!asset || asset.kind !== "shape") {
      throw new Error(`Custom Shape asset is not registered: ${id}.`);
    }
    return asset;
  }

  resolveGrain(id: BrushGrainAssetId): RegisteredCustomBrushAsset | null {
    if (!isCustomGrainAssetId(id)) return null;
    const asset = this.assets.get(id);
    if (!asset || asset.kind !== "grain") {
      throw new Error(`Custom Grain asset is not registered: ${id}.`);
    }
    return asset;
  }

  snapshot(id: BrushShapeAssetId | BrushGrainAssetId): CustomBrushAssetSnapshot | null {
    const asset = this.assets.get(id);
    return asset ? { ...asset, rgba: asset.rgba.slice() } : null;
  }

  has(id: BrushShapeAssetId | BrushGrainAssetId): boolean {
    return this.assets.has(id);
  }

  remove(id: BrushShapeAssetId | BrushGrainAssetId): boolean {
    return this.assets.delete(id);
  }

  memoryBytes(): number {
    let bytes = 0;
    for (const asset of this.assets.values()) bytes += asset.rgba.byteLength;
    return bytes;
  }

  private createId(
    kind: "shape" | "grain",
    width: number,
    height: number,
    rgba: Uint8Array,
  ): CustomBrushShapeAssetId | CustomBrushGrainAssetId {
    const hash = hashBytes(rgba).toString(16).padStart(8, "0");
    const suffix = `${width}x${height}-${hash}-${this.sequence.toString(36)}`;
    this.sequence += 1;
    return `custom-${kind}:${suffix}`;
  }

  private store(asset: RegisteredCustomBrushAsset): void {
    const previous = this.assets.get(asset.id);
    if (!previous) {
      this.assets.set(asset.id, asset);
      return;
    }
    if (
      previous.kind !== asset.kind
      || previous.width !== asset.width
      || previous.height !== asset.height
      || previous.name !== asset.name
      || previous.mimeType !== asset.mimeType
      || !byteArraysEqual(previous.rgba, asset.rgba)
    ) {
      throw new Error(`Asset ID ${asset.id} is immutable and is already registered.`);
    }
  }
}
