/**
 * Portable IEEE-754 binary16 helpers. JavaScript still has no universally
 * available Float16Array, while WebGPU project payloads store real f16 bytes.
 */
const FLOAT16_CONVERSION_F32 = new Float32Array(1);
const FLOAT16_CONVERSION_U32 = new Uint32Array(FLOAT16_CONVERSION_F32.buffer);

export function encodeFloat16(value: number): number {
  FLOAT16_CONVERSION_F32[0] = value;
  const source = FLOAT16_CONVERSION_U32[0];
  let result = (source >>> 16) & 0x8000;
  let mantissa = (source >>> 12) & 0x07ff;
  const exponent = (source >>> 23) & 0xff;
  if (exponent < 103) return result;
  if (exponent > 142) {
    result |= 0x7c00;
    if (exponent === 0xff && (source & 0x007fffff) !== 0) result |= 0x0200;
    return result;
  }
  if (exponent < 113) {
    mantissa |= 0x0800;
    result |= (mantissa >>> (114 - exponent))
      + ((mantissa >>> (113 - exponent)) & 1);
    return result;
  }
  result |= ((exponent - 112) << 10) | (mantissa >>> 1);
  return result + (mantissa & 1);
}

export function decodeFloat16(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export const RGBA16_FLOAT_BYTES_PER_PIXEL = 8;
export const RGBA8_UNORM_BYTES_PER_PIXEL = 4;

let float16ToUnorm8Table: Uint8Array<ArrayBuffer> | null = null;

function float16ToUnorm8(bits: number): number {
  if (!float16ToUnorm8Table) {
    const table = new Uint8Array(0x1_0000);
    for (let candidate = 0; candidate < table.length; candidate += 1) {
      const decoded = decodeFloat16(candidate);
      const clamped = Number.isNaN(decoded)
        ? 0
        : Math.min(1, Math.max(0, decoded));
      table[candidate] = Math.round(clamped * 255);
    }
    float16ToUnorm8Table = table;
  }
  return float16ToUnorm8Table[bits & 0xffff];
}

/**
 * Converts padded RGBA16F rows to tightly packed RGBA8 at an explicit output
 * boundary. WebGPU texture copies preserve binary16 channel words in little
 * endian order; values outside the display range are clamped before rounding.
 */
export function rgba16FloatRowsToRgba8Unorm(
  source: Uint8Array,
  width: number,
  height: number,
  sourceBytesPerRow: number,
): Uint8Array<ArrayBuffer> {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 0
    || height < 0
  ) {
    throw new Error("RGBA16F dimensions must be non-negative safe integers.");
  }
  const sourceTightBytesPerRow = width * RGBA16_FLOAT_BYTES_PER_PIXEL;
  if (
    !Number.isSafeInteger(sourceBytesPerRow)
    || sourceBytesPerRow < sourceTightBytesPerRow
  ) {
    throw new Error("RGBA16F row stride is smaller than one packed source row.");
  }
  const requiredBytes = height === 0
    ? 0
    : (height - 1) * sourceBytesPerRow + sourceTightBytesPerRow;
  if (source.byteLength < requiredBytes) {
    throw new Error("RGBA16F source does not contain every requested row.");
  }

  const target = new Uint8Array(
    width * height * RGBA8_UNORM_BYTES_PER_PIXEL,
  );
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const sourceOffset = row * sourceBytesPerRow
        + column * RGBA16_FLOAT_BYTES_PER_PIXEL;
      const targetOffset = (row * width + column) * RGBA8_UNORM_BYTES_PER_PIXEL;
      for (let channel = 0; channel < 4; channel += 1) {
        const channelOffset = sourceOffset + channel * 2;
        const bits = source[channelOffset] | (source[channelOffset + 1] << 8);
        target[targetOffset + channel] = float16ToUnorm8(bits);
      }
    }
  }
  return target;
}

const UNORM8_TO_FLOAT16 = Uint16Array.from(
  { length: 256 },
  (_, value) => encodeFloat16(value / 255),
);

/**
 * Migrates linear-premultiplied RGBA8 project bytes to the authoritative
 * RGBA16F representation without changing their normalized channel values.
 */
export function rgba8UnormToRgba16FloatBytes(
  source: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (source.byteLength % 4 !== 0) {
    throw new Error("The RGBA8 payload must contain complete pixels.");
  }
  const target = new Uint16Array(source.byteLength);
  for (let index = 0; index < source.byteLength; index += 1) {
    target[index] = UNORM8_TO_FLOAT16[source[index]];
  }
  return new Uint8Array(target.buffer);
}
