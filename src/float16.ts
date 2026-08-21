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
