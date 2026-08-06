export interface DecodedGrayscalePng {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_BYTES = 13;

function readChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function unfilterGrayscaleScanlines(
  inflated: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowStride = width + 1;
  const expectedBytes = rowStride * height;
  if (inflated.byteLength !== expectedBytes) {
    throw new Error(
      `Dati PNG decompressi non validi: attesi ${expectedBytes} byte, trovati ${inflated.byteLength}.`,
    );
  }

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * rowStride;
    const destinationRow = y * width;
    const filter = inflated[sourceRow];
    if (filter > 4) {
      throw new Error(`Filtro PNG non supportato: ${filter}.`);
    }

    for (let x = 0; x < width; x += 1) {
      const encoded = inflated[sourceRow + 1 + x];
      const left = x > 0 ? pixels[destinationRow + x - 1] : 0;
      const up = y > 0 ? pixels[destinationRow - width + x] : 0;
      const upperLeft = x > 0 && y > 0 ? pixels[destinationRow - width + x - 1] : 0;
      let predictor = 0;

      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = Math.floor((left + up) * 0.5);
      } else if (filter === 4) {
        predictor = paethPredictor(left, up, upperLeft);
      }

      pixels[destinationRow + x] = (encoded + predictor) & 0xff;
    }
  }

  return pixels;
}

export async function decodeGrayscalePng8(source: ArrayBuffer): Promise<DecodedGrayscalePng> {
  const bytes = new Uint8Array(source);
  if (bytes.byteLength < PNG_SIGNATURE.byteLength + 12) {
    throw new Error("PNG troppo corta.");
  }
  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("Firma PNG non valida.");
    }
  }

  const view = new DataView(source);
  const idatChunks: Uint8Array[] = [];
  let idatByteLength = 0;
  let width = 0;
  let height = 0;
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
      throw new Error("Chunk PNG oltre la fine del file.");
    }

    const chunkType = readChunkType(bytes, chunkTypeOffset);
    if (chunkType === "IHDR") {
      if (sawHeader || chunkLength !== PNG_IHDR_BYTES) {
        throw new Error("Header PNG non valido.");
      }
      width = view.getUint32(chunkDataOffset, false);
      height = view.getUint32(chunkDataOffset + 4, false);
      const bitDepth = bytes[chunkDataOffset + 8];
      const colorType = bytes[chunkDataOffset + 9];
      const compressionMethod = bytes[chunkDataOffset + 10];
      const filterMethod = bytes[chunkDataOffset + 11];
      const interlaceMethod = bytes[chunkDataOffset + 12];
      if (width <= 0 || height <= 0) {
        throw new Error("Dimensioni PNG non valide.");
      }
      if (
        bitDepth !== 8
        || colorType !== 0
        || compressionMethod !== 0
        || filterMethod !== 0
        || interlaceMethod !== 0
      ) {
        throw new Error(
          "La Shape richiede una PNG grayscale 8-bit, non interlacciata e con compressione standard.",
        );
      }
      sawHeader = true;
    } else if (chunkType === "IDAT") {
      if (!sawHeader || sawEnd) {
        throw new Error("Ordine dei chunk PNG non valido.");
      }
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
    throw new Error("PNG incompleta.");
  }

  const compressed = new Uint8Array(idatByteLength);
  let compressedOffset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.byteLength;
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream non disponibile.");
  }
  const decompressedStream = new Blob([compressed]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  const inflated = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
  return {
    width,
    height,
    pixels: unfilterGrayscaleScanlines(inflated, width, height),
  };
}
