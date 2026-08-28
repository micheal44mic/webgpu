export type GrayscalePngBitDepth = 8 | 16;

export interface DecodedGrayscalePng16 {
  readonly width: number;
  readonly height: number;
  /** Authoritative unsigned grayscale samples, always normalized to 0...65535. */
  readonly pixels: Uint16Array;
  /** Precision declared by IHDR before 8-bit samples are expanded with v * 257. */
  readonly sourceBitDepth: GrayscalePngBitDepth;
}

/** Compatibility view for callers that explicitly need an 8-bit proxy. */
export interface DecodedGrayscalePng {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_BYTES = 13;

function readChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
  );
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function unfilterGrayscaleScanlines(
  inflated: Uint8Array,
  width: number,
  height: number,
  bytesPerSample: 1 | 2,
): Uint8Array {
  const scanlineBytes = width * bytesPerSample;
  const rowStride = scanlineBytes + 1;
  const expectedBytes = rowStride * height;
  if (inflated.byteLength !== expectedBytes) {
    throw new Error(
      `Invalid decompressed PNG data: expected ${expectedBytes} bytes, found ${inflated.byteLength}.`,
    );
  }

  const samples = new Uint8Array(scanlineBytes * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * rowStride;
    const destinationRow = y * scanlineBytes;
    const filter = inflated[sourceRow];
    if (filter > 4) throw new Error(`Unsupported PNG filter: ${filter}.`);

    for (let byteIndex = 0; byteIndex < scanlineBytes; byteIndex += 1) {
      const encoded = inflated[sourceRow + 1 + byteIndex];
      const left = byteIndex >= bytesPerSample
        ? samples[destinationRow + byteIndex - bytesPerSample]
        : 0;
      const up = y > 0 ? samples[destinationRow - scanlineBytes + byteIndex] : 0;
      const upperLeft = byteIndex >= bytesPerSample && y > 0
        ? samples[destinationRow - scanlineBytes + byteIndex - bytesPerSample]
        : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) * 0.5);
      else if (filter === 4) predictor = paethPredictor(left, up, upperLeft);
      samples[destinationRow + byteIndex] = (encoded + predictor) & 0xff;
    }
  }
  return samples;
}

export async function decodeGrayscalePng(
  source: ArrayBuffer,
): Promise<DecodedGrayscalePng16> {
  const bytes = new Uint8Array(source);
  if (bytes.byteLength < PNG_SIGNATURE.byteLength + 12) {
    throw new Error("The PNG file is too short.");
  }
  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error("Invalid PNG signature.");
  }

  const view = new DataView(source);
  const idatChunks: Uint8Array[] = [];
  let idatByteLength = 0;
  let width = 0;
  let height = 0;
  let sourceBitDepth: GrayscalePngBitDepth = 8;
  let sawHeader = false;
  let sawEnd = false;
  let offset = PNG_SIGNATURE.byteLength;

  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, false);
    const chunkTypeOffset = offset + 4;
    const chunkDataOffset = offset + 8;
    const chunkDataEnd = chunkDataOffset + chunkLength;
    const nextOffset = chunkDataEnd + 4;
    if (chunkDataEnd < chunkDataOffset || nextOffset > bytes.byteLength) {
      throw new Error("PNG chunk extends beyond the end of the file.");
    }

    const chunkType = readChunkType(bytes, chunkTypeOffset);
    if (chunkType === "IHDR") {
      if (sawHeader || chunkLength !== PNG_IHDR_BYTES) throw new Error("Invalid PNG header.");
      width = view.getUint32(chunkDataOffset, false);
      height = view.getUint32(chunkDataOffset + 4, false);
      const bitDepth = bytes[chunkDataOffset + 8];
      const colorType = bytes[chunkDataOffset + 9];
      const compressionMethod = bytes[chunkDataOffset + 10];
      const filterMethod = bytes[chunkDataOffset + 11];
      const interlaceMethod = bytes[chunkDataOffset + 12];
      if (width <= 0 || height <= 0) throw new Error("Invalid PNG dimensions.");
      if (
        (bitDepth !== 8 && bitDepth !== 16)
        || colorType !== 0
        || compressionMethod !== 0
        || filterMethod !== 0
        || interlaceMethod !== 0
      ) {
        throw new Error(
          "Shape or Grain requires a non-interlaced 8-bit or 16-bit grayscale PNG with standard compression.",
        );
      }
      sourceBitDepth = bitDepth;
      sawHeader = true;
    } else if (chunkType === "IDAT") {
      if (!sawHeader || sawEnd) throw new Error("Invalid PNG chunk order.");
      const chunk = bytes.slice(chunkDataOffset, chunkDataEnd);
      idatChunks.push(chunk);
      idatByteLength += chunk.byteLength;
    } else if (chunkType === "IEND") {
      sawEnd = true;
      break;
    }
    offset = nextOffset;
  }

  if (!sawHeader || !sawEnd || idatChunks.length === 0) {
    throw new Error("The PNG file is incomplete.");
  }
  const compressed = new Uint8Array(idatByteLength);
  let compressedOffset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.byteLength;
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is unavailable.");
  }
  const decompressedStream = new Blob([compressed]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  const inflated = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
  const bytesPerSample = sourceBitDepth === 16 ? 2 : 1;
  const unfiltered = unfilterGrayscaleScanlines(inflated, width, height, bytesPerSample);
  const pixels = new Uint16Array(width * height);
  if (sourceBitDepth === 16) {
    for (let index = 0, byteIndex = 0; index < pixels.length; index += 1, byteIndex += 2) {
      pixels[index] = (unfiltered[byteIndex] << 8) | unfiltered[byteIndex + 1];
    }
  } else {
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = unfiltered[index] * 257;
    }
  }
  return { width, height, pixels, sourceBitDepth };
}

export async function decodeGrayscalePng8(source: ArrayBuffer): Promise<DecodedGrayscalePng> {
  const decoded = await decodeGrayscalePng(source);
  const pixels = new Uint8Array(decoded.pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = Math.round(decoded.pixels[index] / 257);
  }
  return { width: decoded.width, height: decoded.height, pixels };
}
