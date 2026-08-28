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
  /**
   * Authoritative scalar coverage samples. PNG grayscale sources should supply
   * this directly so no browser color or 8-bit canvas conversion is involved.
   */
  readonly scalar16?: Uint16Array;
  readonly sourceBitDepth?: 8 | 16;
  /** Unpremultiplied RGBA8 proxy or legacy source. The registry takes a copy. */
  readonly rgba?: Uint8Array | Uint8ClampedArray;
  readonly name?: string;
  readonly mimeType?: string;
}

export interface CustomBrushAssetSnapshot {
  readonly id: CustomBrushShapeAssetId | CustomBrushGrainAssetId;
  readonly kind: "shape" | "grain";
  readonly width: number;
  readonly height: number;
  readonly scalar16: Uint16Array;
  readonly sourceBitDepth: 8 | 16;
  /** Derived display proxy; never the authoritative source when scalar16 exists. */
  readonly rgba: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

export interface RegisteredCustomBrushAsset extends Omit<
  CustomBrushAssetSnapshot,
  "rgba" | "scalar16"
> {
  readonly rgba: Uint8Array;
  readonly scalar16: Uint16Array;
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

interface ValidatedDecodedImage {
  readonly rgba: Uint8Array;
  readonly scalar16: Uint16Array;
  readonly sourceBitDepth: 8 | 16;
}

function rgbaProxyFromScalar16(samples: Uint16Array): Uint8Array {
  const rgba = new Uint8Array(samples.length * 4);
  for (let index = 0, rgbaIndex = 0; index < samples.length; index += 1, rgbaIndex += 4) {
    const value = Math.round(samples[index] / 257);
    rgba[rgbaIndex] = value;
    rgba[rgbaIndex + 1] = value;
    rgba[rgbaIndex + 2] = value;
    rgba[rgbaIndex + 3] = 255;
  }
  return rgba;
}

function scalar16FromRgba(
  rgba: Uint8Array,
  kind: "shape" | "grain",
): Uint16Array {
  const scalar16 = new Uint16Array(rgba.length / 4);
  for (
    let pixelIndex = 0, rgbaIndex = 0;
    pixelIndex < scalar16.length;
    pixelIndex += 1, rgbaIndex += 4
  ) {
    const luminance = kind === "shape"
      ? rgba[rgbaIndex] * 0.2126 + rgba[rgbaIndex + 1] * 0.7152 + rgba[rgbaIndex + 2] * 0.0722
      : rgba[rgbaIndex] * 0.299 + rgba[rgbaIndex + 1] * 0.587 + rgba[rgbaIndex + 2] * 0.114;
    if (kind === "shape") {
      const luminance8 = Math.round(luminance);
      const coverage8 = Math.round(luminance8 * (rgba[rgbaIndex + 3] / 255));
      scalar16[pixelIndex] = coverage8 * 257;
    } else {
      // Preserve the fractional BT.601 result that the previous shader
      // produced from 8-bit RGB channels instead of rounding it to gray8.
      scalar16[pixelIndex] = Math.round(luminance * 257);
    }
  }
  return scalar16;
}

function validateDecodedImage(
  source: DecodedCustomBrushImage,
  kind: "shape" | "grain",
): ValidatedDecodedImage {
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
  const expectedPixels = source.width * source.height;
  const expectedBytes = expectedPixels * 4;
  if (!source.scalar16 && !source.rgba) {
    throw new RangeError("A brush asset must include scalar16 samples or an RGBA8 legacy source.");
  }
  if (source.scalar16 && source.scalar16.length !== expectedPixels) {
    throw new RangeError(
      `Scalar16 asset: ${source.scalar16.length} samples, expected ${expectedPixels}.`,
    );
  }
  if (source.rgba && source.rgba.byteLength !== expectedBytes) {
    throw new RangeError(`RGBA8 asset: ${source.rgba.byteLength} B, expected ${expectedBytes} B.`);
  }
  if (source.sourceBitDepth !== undefined && source.sourceBitDepth !== 8 && source.sourceBitDepth !== 16) {
    throw new RangeError("Brush source bit depth must be 8 or 16.");
  }
  const rgba = source.rgba ? new Uint8Array(source.rgba) : null;
  const scalar16 = source.scalar16
    ? new Uint16Array(source.scalar16)
    : scalar16FromRgba(rgba!, kind);
  return {
    rgba: rgba ?? rgbaProxyFromScalar16(scalar16),
    scalar16,
    sourceBitDepth: source.sourceBitDepth ?? (source.scalar16 ? 16 : 8),
  };
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hashScalar16(samples: Uint16Array): number {
  let hash = 0x811c9dc5;
  for (const value of samples) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= value >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function uint16ArraysEqual(left: Uint16Array, right: Uint16Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
    const decoded = validateDecodedImage(source, "shape");
    const id = requestedId ?? this.createId("shape", source.width, source.height, decoded.scalar16);
    if (!isCustomShapeAssetId(id)) {
      throw new TypeError("Invalid custom Shape ID.");
    }
    this.store({
      id,
      kind: "shape",
      width: source.width,
      height: source.height,
      ...decoded,
      name: source.name?.trim() || "Custom Shape",
      mimeType: source.mimeType?.trim() || "image/png",
    });
    return id;
  }

  registerGrain(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushGrainAssetId,
  ): CustomBrushGrainAssetId {
    const decoded = validateDecodedImage(source, "grain");
    const id = requestedId ?? this.createId("grain", source.width, source.height, decoded.scalar16);
    if (!isCustomGrainAssetId(id)) {
      throw new TypeError("Invalid custom Grain ID.");
    }
    this.store({
      id,
      kind: "grain",
      width: source.width,
      height: source.height,
      ...decoded,
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
    return asset
      ? { ...asset, rgba: asset.rgba.slice(), scalar16: asset.scalar16.slice() }
      : null;
  }

  has(id: BrushShapeAssetId | BrushGrainAssetId): boolean {
    return this.assets.has(id);
  }

  remove(id: BrushShapeAssetId | BrushGrainAssetId): boolean {
    return this.assets.delete(id);
  }

  memoryBytes(): number {
    let bytes = 0;
    for (const asset of this.assets.values()) {
      bytes += asset.rgba.byteLength + asset.scalar16.byteLength;
    }
    return bytes;
  }

  private createId(
    kind: "shape" | "grain",
    width: number,
    height: number,
    scalar16: Uint16Array,
  ): CustomBrushShapeAssetId | CustomBrushGrainAssetId {
    const hash = hashScalar16(scalar16).toString(16).padStart(8, "0");
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
      || previous.sourceBitDepth !== asset.sourceBitDepth
      || previous.name !== asset.name
      || previous.mimeType !== asset.mimeType
      || !uint16ArraysEqual(previous.scalar16, asset.scalar16)
      || !byteArraysEqual(previous.rgba, asset.rgba)
    ) {
      throw new Error(`Asset ID ${asset.id} is immutable and is already registered.`);
    }
  }
}
