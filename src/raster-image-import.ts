/**
 * Strict, decode-only ingress for semantic raster-image assets.
 *
 * The module deliberately stops at an ImageBitmap. Upload, mip generation and
 * lifetime ownership belong to the WebGPU asset registry; no Canvas2D or CPU
 * pixel fallback is allowed here. File bytes and the decoded bitmap are kept
 * outside scene snapshots/history by the caller.
 */

export const RASTER_IMAGE_IMPORT_STRATEGY =
  "byte-sniff-static-png-jpeg-webp-avif-create-image-bitmap-v1" as const;

export type RasterImageFormat = "png" | "jpeg" | "webp" | "avif";

export type RasterImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/avif";

export interface RasterImageImportLimits {
  readonly maximumSourceBytes: number;
  readonly maximumWidth: number;
  readonly maximumHeight: number;
  readonly maximumPixels: number;
}

export const DEFAULT_RASTER_IMAGE_IMPORT_LIMITS: RasterImageImportLimits =
  Object.freeze({
    maximumSourceBytes: 64 * 1024 * 1024,
    maximumWidth: 16_384,
    maximumHeight: 16_384,
    maximumPixels: 64 * 1024 * 1024,
  });

export type RasterImageImportErrorCode =
  | "invalid-limits"
  | "invalid-source"
  | "source-empty"
  | "source-too-large"
  | "unsupported-format"
  | "mime-mismatch"
  | "invalid-image"
  | "animated-image"
  | "dimensions-too-large"
  | "decoder-unavailable"
  | "decode-failed";

export class RasterImageImportError extends Error {
  readonly code: RasterImageImportErrorCode;

  constructor(
    code: RasterImageImportErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options && "cause" in options ? { cause: options.cause } : undefined);
    this.name = "RasterImageImportError";
    this.code = code;
  }
}

export interface RasterImageInspection {
  readonly strategy: typeof RASTER_IMAGE_IMPORT_STRATEGY;
  readonly format: RasterImageFormat;
  readonly mimeType: RasterImageMimeType;
  readonly declaredMimeType: string | null;
  readonly sourceBytes: number;
  /** Encoded canvas before EXIF orientation is applied by the browser. */
  readonly encodedWidth: number;
  /** Encoded canvas before EXIF orientation is applied by the browser. */
  readonly encodedHeight: number;
  readonly encodedPixelCount: number;
  readonly animated: false;
}

/** Metadata safe to copy into an engine-owned asset record. */
export interface RasterImageImportMetadata {
  readonly strategy: typeof RASTER_IMAGE_IMPORT_STRATEGY;
  readonly sourceName: string;
  readonly format: RasterImageFormat;
  readonly mimeType: RasterImageMimeType;
  readonly sourceBytes: number;
  /** Final, orientation-correct dimensions of the ImageBitmap. */
  readonly width: number;
  /** Final, orientation-correct dimensions of the ImageBitmap. */
  readonly height: number;
  readonly pixelCount: number;
  readonly animated: false;
}

/**
 * Transient import result. The engine consumes `source`/`bitmap` during its GPU
 * allocation transaction and closes the bitmap; neither belongs in compact
 * scene/history state, and this result is not a persistence/rehydration store.
 */
export interface DecodedRasterImage {
  readonly metadata: RasterImageImportMetadata;
  readonly inspection: RasterImageInspection;
  readonly source: Blob;
  readonly bitmap: ImageBitmap;
}

export interface RasterImageDecodeOptions {
  readonly sourceName?: string;
  readonly limits?: Partial<RasterImageImportLimits>;
  /** Runs after strict byte inspection and before allocating the ImageBitmap. */
  readonly preflight?: (inspection: RasterImageInspection) => void;
}

interface ParsedRasterImage {
  readonly format: RasterImageFormat;
  readonly mimeType: RasterImageMimeType;
  readonly width: number;
  readonly height: number;
}

interface IsoBox {
  readonly type: string;
  readonly start: number;
  readonly dataStart: number;
  readonly end: number;
}

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const MIME_TO_FORMAT = new Map<string, RasterImageFormat>([
  ["image/png", "png"],
  ["image/x-png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/jpg", "jpeg"],
  ["image/pjpeg", "jpeg"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function importError(
  code: RasterImageImportErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new RasterImageImportError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function positiveSafeInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    importError(
      "invalid-limits",
      `${label} deve essere un intero positivo sicuro.`,
    );
  }
  return resolved;
}

export function resolveRasterImageImportLimits(
  limits: Partial<RasterImageImportLimits> = {},
): RasterImageImportLimits {
  return Object.freeze({
    maximumSourceBytes: positiveSafeInteger(
      limits.maximumSourceBytes,
      DEFAULT_RASTER_IMAGE_IMPORT_LIMITS.maximumSourceBytes,
      "Il limite dei byte sorgente",
    ),
    maximumWidth: positiveSafeInteger(
      limits.maximumWidth,
      DEFAULT_RASTER_IMAGE_IMPORT_LIMITS.maximumWidth,
      "Il limite di larghezza",
    ),
    maximumHeight: positiveSafeInteger(
      limits.maximumHeight,
      DEFAULT_RASTER_IMAGE_IMPORT_LIMITS.maximumHeight,
      "Il limite di altezza",
    ),
    maximumPixels: positiveSafeInteger(
      limits.maximumPixels,
      DEFAULT_RASTER_IMAGE_IMPORT_LIMITS.maximumPixels,
      "Il limite dei pixel",
    ),
  });
}

function readU16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16);
}

function readU32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function readU32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]
    + (bytes[offset + 1] << 8)
    + (bytes[offset + 2] << 16)
    + bytes[offset + 3] * 0x1000000
  ) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index]);
  }
  return value;
}

function bytesEqualAt(
  bytes: Uint8Array,
  expected: Uint8Array,
  offset = 0,
): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
}

function validateDimensions(
  width: number,
  height: number,
  limits: RasterImageImportLimits,
  stage: "codificata" | "decodificata",
): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    importError(
      "invalid-image",
      `Dimensioni dell’immagine ${stage} non valide (${width}×${height}).`,
    );
  }
  const pixelCountBig = BigInt(width) * BigInt(height);
  if (
    width > limits.maximumWidth
    || height > limits.maximumHeight
    || pixelCountBig > BigInt(limits.maximumPixels)
  ) {
    importError(
      "dimensions-too-large",
      `Immagine ${stage} ${width}×${height} oltre i limiti `
      + `${limits.maximumWidth}×${limits.maximumHeight} / `
      + `${limits.maximumPixels.toLocaleString("it-IT")} pixel.`,
    );
  }
  return width * height;
}

function parsePng(bytes: Uint8Array): ParsedRasterImage {
  if (!bytesEqualAt(bytes, PNG_SIGNATURE)) {
    importError("invalid-image", "Firma PNG non valida.");
  }
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let imageDataClosed = false;
  let sawEnd = false;
  let chunkIndex = 0;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      importError("invalid-image", "Chunk PNG troncato.");
    }
    const length = readU32BigEndian(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    for (let index = 0; index < 4; index += 1) {
      const character = bytes[offset + 4 + index];
      const isLetter = (character >= 0x41 && character <= 0x5a)
        || (character >= 0x61 && character <= 0x7a);
      if (!isLetter) importError("invalid-image", "Tipo di chunk PNG non valido.");
    }
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) {
      importError("invalid-image", `Chunk PNG ${type} oltre la fine del file.`);
    }
    if (chunkIndex === 0 && type !== "IHDR") {
      importError("invalid-image", "IHDR deve essere il primo chunk PNG.");
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      importError(
        "animated-image",
        "APNG animato non supportato: importa un PNG statico.",
      );
    }
    if (type === "IHDR") {
      if (sawHeader || length !== 13) {
        importError("invalid-image", "Chunk IHDR PNG duplicato o non valido.");
      }
      width = readU32BigEndian(bytes, dataStart);
      height = readU32BigEndian(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const validDepths = colorType === 0
        ? [1, 2, 4, 8, 16]
        : colorType === 2
          ? [8, 16]
          : colorType === 3
            ? [1, 2, 4, 8]
            : colorType === 4 || colorType === 6
              ? [8, 16]
              : [];
      if (
        width === 0
        || height === 0
        || width > 0x7fffffff
        || height > 0x7fffffff
        || !validDepths.includes(bitDepth)
        || bytes[dataStart + 10] !== 0
        || bytes[dataStart + 11] !== 0
        || bytes[dataStart + 12] > 1
      ) {
        importError("invalid-image", "Parametri IHDR PNG non validi.");
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || imageDataClosed) {
        importError("invalid-image", "Sequenza IDAT PNG non valida.");
      }
      sawImageData = true;
    } else if (sawImageData && type !== "IEND") {
      imageDataClosed = true;
    }
    if (type === "IEND") {
      if (length !== 0 || !sawImageData) {
        importError("invalid-image", "Chunk IEND PNG non valido.");
      }
      sawEnd = true;
      offset = chunkEnd;
      if (offset !== bytes.length) {
        importError("invalid-image", "Dati inattesi dopo IEND nel PNG.");
      }
      break;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (!sawHeader || !sawImageData || !sawEnd) {
    importError("invalid-image", "Struttura PNG incompleta.");
  }
  return { format: "png", mimeType: "image/png", width, height };
}

function isJpegStandaloneMarker(marker: number): boolean {
  return marker === 0x01
    || marker === 0xd8
    || marker === 0xd9
    || (marker >= 0xd0 && marker <= 0xd7);
}

function parseJpeg(bytes: Uint8Array): ParsedRasterImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    importError("invalid-image", "Firma JPEG non valida.");
  }
  let offset = 2;
  let inEntropyData = false;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (inEntropyData) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      if (offset >= bytes.length) break;
    } else if (bytes[offset] !== 0xff) {
      importError("invalid-image", "Marcatore JPEG atteso.");
    }

    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;

    if (inEntropyData && marker === 0x00) {
      continue;
    }
    if (inEntropyData && marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    inEntropyData = false;

    if (marker === 0xd9) {
      sawEnd = true;
      for (let trailing = offset; trailing + 1 < bytes.length; trailing += 1) {
        if (bytes[trailing] === 0xff && bytes[trailing + 1] === 0xd8) {
          importError(
            "invalid-image",
            "Immagini JPEG concatenate dopo EOI non supportate.",
          );
        }
      }
      break;
    }
    if (isJpegStandaloneMarker(marker)) {
      if (marker === 0xd8) {
        importError("invalid-image", "SOI JPEG duplicato.");
      }
      continue;
    }
    if (offset + 2 > bytes.length) {
      importError("invalid-image", "Segmento JPEG troncato.");
    }
    const segmentLength = readU16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      importError("invalid-image", "Lunghezza di segmento JPEG non valida.");
    }
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) {
        importError("invalid-image", "Segmento SOF JPEG troppo corto.");
      }
      const nextHeight = readU16BigEndian(bytes, dataStart + 1);
      const nextWidth = readU16BigEndian(bytes, dataStart + 3);
      if (nextWidth === 0 || nextHeight === 0) {
        importError(
          "invalid-image",
          "JPEG con dimensione differita DNL non supportato.",
        );
      }
      if (sawFrame && (width !== nextWidth || height !== nextHeight)) {
        importError("invalid-image", "JPEG gerarchico con più dimensioni non supportato.");
      }
      width = nextWidth;
      height = nextHeight;
      sawFrame = true;
    }
    if (
      marker === 0xe2
      && dataEnd - dataStart >= 4
      && ascii(bytes, dataStart, 4) === "MPF\0"
    ) {
      importError(
        "animated-image",
        "JPEG MPO/multi-immagine non supportato: importa un JPEG statico.",
      );
    }

    offset = dataEnd;
    if (marker === 0xda) inEntropyData = true;
  }
  if (!sawFrame || !sawEnd) {
    importError("invalid-image", "Struttura JPEG incompleta o senza SOF/EOI.");
  }
  return { format: "jpeg", mimeType: "image/jpeg", width, height };
}

function parseVp8Dimensions(
  bytes: Uint8Array,
  dataStart: number,
  dataEnd: number,
): { width: number; height: number } {
  if (
    dataEnd - dataStart < 10
    || bytes[dataStart + 3] !== 0x9d
    || bytes[dataStart + 4] !== 0x01
    || bytes[dataStart + 5] !== 0x2a
  ) {
    importError("invalid-image", "Bitstream VP8 WebP non valido.");
  }
  return {
    width: readU16LittleEndian(bytes, dataStart + 6) & 0x3fff,
    height: readU16LittleEndian(bytes, dataStart + 8) & 0x3fff,
  };
}

function readU16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function parseVp8lDimensions(
  bytes: Uint8Array,
  dataStart: number,
  dataEnd: number,
): { width: number; height: number } {
  if (dataEnd - dataStart < 5 || bytes[dataStart] !== 0x2f) {
    importError("invalid-image", "Bitstream VP8L WebP non valido.");
  }
  const packed = readU32LittleEndian(bytes, dataStart + 1);
  if ((packed >>> 29) !== 0) {
    importError("invalid-image", "Versione VP8L WebP non supportata.");
  }
  return {
    width: (packed & 0x3fff) + 1,
    height: ((packed >>> 14) & 0x3fff) + 1,
  };
}

function parseWebp(bytes: Uint8Array): ParsedRasterImage {
  if (
    bytes.length < 20
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 4) !== "WEBP"
  ) {
    importError("invalid-image", "Firma RIFF/WebP non valida.");
  }
  const declaredLength = readU32LittleEndian(bytes, 4) + 8;
  if (declaredLength !== bytes.length) {
    importError("invalid-image", "Lunghezza RIFF/WebP incoerente.");
  }

  let offset = 12;
  let width = 0;
  let height = 0;
  let extendedWidth = 0;
  let extendedHeight = 0;
  let imagePayloadCount = 0;
  let sawExtendedHeader = false;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      importError("invalid-image", "Chunk WebP troncato.");
    }
    const type = ascii(bytes, offset, 4);
    const length = readU32LittleEndian(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + (length & 1);
    if (dataEnd < dataStart || chunkEnd > bytes.length) {
      importError("invalid-image", `Chunk WebP ${type} oltre la fine del file.`);
    }

    if (type === "ANIM" || type === "ANMF") {
      importError(
        "animated-image",
        "WebP animato non supportato: importa un WebP statico.",
      );
    }
    if (type === "VP8X") {
      if (sawExtendedHeader || length !== 10) {
        importError("invalid-image", "Header VP8X WebP duplicato o non valido.");
      }
      const flags = bytes[dataStart];
      if ((flags & 0x02) !== 0) {
        importError(
          "animated-image",
          "WebP animato non supportato: importa un WebP statico.",
        );
      }
      if ((flags & 0xc1) !== 0) {
        importError("invalid-image", "Bit riservati VP8X WebP non validi.");
      }
      extendedWidth = readU24LittleEndian(bytes, dataStart + 4) + 1;
      extendedHeight = readU24LittleEndian(bytes, dataStart + 7) + 1;
      sawExtendedHeader = true;
    } else if (type === "VP8 ") {
      const dimensions = parseVp8Dimensions(bytes, dataStart, dataEnd);
      width = dimensions.width;
      height = dimensions.height;
      imagePayloadCount += 1;
    } else if (type === "VP8L") {
      const dimensions = parseVp8lDimensions(bytes, dataStart, dataEnd);
      width = dimensions.width;
      height = dimensions.height;
      imagePayloadCount += 1;
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.length || imagePayloadCount !== 1) {
    importError("invalid-image", "WebP senza un unico payload immagine statico.");
  }
  if (sawExtendedHeader) {
    width = extendedWidth;
    height = extendedHeight;
  }
  if (width <= 0 || height <= 0) {
    importError("invalid-image", "Dimensioni WebP non valide.");
  }
  return { format: "webp", mimeType: "image/webp", width, height };
}

function readIsoBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (box: IsoBox) => void,
): void {
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) {
      importError("invalid-image", "Box ISO-BMFF troncato.");
    }
    const compactSize = readU32BigEndian(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    let headerBytes = 8;
    let boxSize: number;
    if (compactSize === 1) {
      if (offset + 16 > end) {
        importError("invalid-image", `Box ISO-BMFF ${type} esteso troncato.`);
      }
      const high = readU32BigEndian(bytes, offset + 8);
      const low = readU32BigEndian(bytes, offset + 12);
      const extendedSize = BigInt(high) * 0x1_0000_0000n + BigInt(low);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        importError("invalid-image", `Box ISO-BMFF ${type} troppo grande.`);
      }
      boxSize = Number(extendedSize);
      headerBytes = 16;
    } else {
      boxSize = compactSize === 0 ? end - offset : compactSize;
    }
    if (boxSize < headerBytes || offset + boxSize > end) {
      importError("invalid-image", `Dimensione box ISO-BMFF ${type} non valida.`);
    }
    const box: IsoBox = {
      type,
      start: offset,
      dataStart: offset + headerBytes,
      end: offset + boxSize,
    };
    visit(box);
    offset = box.end;
    if (compactSize === 0 && offset !== end) {
      importError("invalid-image", `Box ISO-BMFF ${type} a dimensione zero non finale.`);
    }
  }
  if (offset !== end) {
    importError("invalid-image", "Struttura box ISO-BMFF non allineata.");
  }
}

function parseAvif(bytes: Uint8Array): ParsedRasterImage {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") {
    importError("invalid-image", "Firma AVIF/ISO-BMFF non valida.");
  }
  let sawFileType = false;
  let sawMeta = false;
  let sequenceBrand = false;
  let sequenceTrack = false;
  let hasAvifBrand = false;
  let primaryItemId: number | null = null;
  let sawPropertyContainer = false;
  const allDimensions: { width: number; height: number }[] = [];
  const propertyDimensions = new Map<number, { width: number; height: number }>();
  const itemPropertyAssociations = new Map<number, number[]>();

  const requireFullBox = (box: IsoBox): { version: number; flags: number } => {
    if (box.end - box.dataStart < 4) {
      importError("invalid-image", `Full box AVIF ${box.type} troncato.`);
    }
    return {
      version: bytes[box.dataStart],
      flags:
        (bytes[box.dataStart + 1] << 16)
        | (bytes[box.dataStart + 2] << 8)
        | bytes[box.dataStart + 3],
    };
  };

  const scanPropertyAssociations = (box: IsoBox): void => {
    const { version, flags } = requireFullBox(box);
    let offset = box.dataStart + 4;
    if (offset + 4 > box.end) {
      importError("invalid-image", "Conteggio ipma AVIF troncato.");
    }
    const entryCount = readU32BigEndian(bytes, offset);
    offset += 4;
    const wideItemId = version >= 1;
    const widePropertyIndex = (flags & 1) !== 0;
    for (let entry = 0; entry < entryCount; entry += 1) {
      const itemIdBytes = wideItemId ? 4 : 2;
      if (offset + itemIdBytes + 1 > box.end) {
        importError("invalid-image", "Voce ipma AVIF troncata.");
      }
      const itemId = wideItemId
        ? readU32BigEndian(bytes, offset)
        : readU16BigEndian(bytes, offset);
      offset += itemIdBytes;
      const associationCount = bytes[offset];
      offset += 1;
      const associations = itemPropertyAssociations.get(itemId) ?? [];
      for (let association = 0; association < associationCount; association += 1) {
        const associationBytes = widePropertyIndex ? 2 : 1;
        if (offset + associationBytes > box.end) {
          importError("invalid-image", "Associazione ipma AVIF troncata.");
        }
        const encoded = widePropertyIndex
          ? readU16BigEndian(bytes, offset)
          : bytes[offset];
        offset += associationBytes;
        const propertyIndex = encoded & (widePropertyIndex ? 0x7fff : 0x7f);
        if (propertyIndex !== 0) associations.push(propertyIndex);
      }
      itemPropertyAssociations.set(itemId, associations);
    }
    if (offset !== box.end) {
      importError("invalid-image", "Dati inattesi nel box ipma AVIF.");
    }
  };

  const scanItemProperties = (box: IsoBox): void => {
    if (sawPropertyContainer) {
      importError("invalid-image", "Box iprp AVIF duplicato.");
    }
    sawPropertyContainer = true;
    readIsoBoxes(bytes, box.dataStart, box.end, (child) => {
      if (child.type === "ipco") {
        let propertyIndex = 0;
        readIsoBoxes(bytes, child.dataStart, child.end, (property) => {
          propertyIndex += 1;
          if (property.type !== "ispe") return;
          if (property.end - property.dataStart < 12) {
            importError("invalid-image", "Proprietà ispe AVIF troncata.");
          }
          const width = readU32BigEndian(bytes, property.dataStart + 4);
          const height = readU32BigEndian(bytes, property.dataStart + 8);
          if (width === 0 || height === 0) {
            importError("invalid-image", "Dimensioni ispe AVIF non valide.");
          }
          const dimensions = { width, height };
          propertyDimensions.set(propertyIndex, dimensions);
          allDimensions.push(dimensions);
        });
      } else if (child.type === "ipma") {
        scanPropertyAssociations(child);
      }
    });
  };

  const scanMeta = (box: IsoBox): void => {
    requireFullBox(box);
    readIsoBoxes(bytes, box.dataStart + 4, box.end, (child) => {
      if (child.type === "pitm") {
        const { version } = requireFullBox(child);
        const offset = child.dataStart + 4;
        const itemIdBytes = version === 0 ? 2 : 4;
        if (offset + itemIdBytes !== child.end) {
          importError("invalid-image", "Box pitm AVIF non valido.");
        }
        primaryItemId = itemIdBytes === 2
          ? readU16BigEndian(bytes, offset)
          : readU32BigEndian(bytes, offset);
      } else if (child.type === "iprp") {
        scanItemProperties(child);
      }
    });
  };

  readIsoBoxes(bytes, 0, bytes.length, (box) => {
    if (box.start === 0 && box.type !== "ftyp") {
      importError("invalid-image", "ftyp deve essere il primo box AVIF.");
    }
    if (box.type === "ftyp") {
      if (sawFileType || box.end - box.dataStart < 8) {
        importError("invalid-image", "Box ftyp AVIF duplicato o troncato.");
      }
      const brandBytes = box.end - box.dataStart;
      if ((brandBytes - 8) % 4 !== 0) {
        importError("invalid-image", "Lista dei brand AVIF non valida.");
      }
      const brands = [ascii(bytes, box.dataStart, 4)];
      for (let offset = box.dataStart + 8; offset < box.end; offset += 4) {
        brands.push(ascii(bytes, offset, 4));
      }
      hasAvifBrand = brands.includes("avif") || brands.includes("avis");
      sequenceBrand = brands.includes("avis");
      sawFileType = true;
    } else if (box.type === "meta") {
      if (sawMeta) {
        importError("invalid-image", "Box meta AVIF duplicato.");
      }
      sawMeta = true;
      scanMeta(box);
    } else if (box.type === "moov") {
      // AVIF still images are item-based. A movie box identifies a timed image
      // sequence even if a broken encoder forgot the mandatory `avis` brand.
      sequenceTrack = true;
    }
  });

  if (!sawFileType || !hasAvifBrand) {
    importError("unsupported-format", "Il file ISO-BMFF non dichiara il brand AVIF.");
  }
  if (sequenceBrand || sequenceTrack) {
    importError(
      "animated-image",
      "Sequenza AVIF animata non supportata: importa un AVIF statico.",
    );
  }
  if (!sawMeta || allDimensions.length === 0) {
    importError("invalid-image", "AVIF statico senza metadata/ispe leggibili.");
  }
  const associatedDimensions = primaryItemId === null
    ? []
    : (itemPropertyAssociations.get(primaryItemId) ?? [])
      .map((propertyIndex) => propertyDimensions.get(propertyIndex))
      .filter((value): value is { width: number; height: number } => value !== undefined);
  const primaryDimensions = associatedDimensions.length > 0
    ? associatedDimensions
    : allDimensions.length === 1
      ? allDimensions
      : [];
  if (primaryDimensions.length === 0) {
    importError(
      "invalid-image",
      "AVIF con più immagini senza associazione ispe leggibile per l’item primario.",
    );
  }
  const selected = primaryDimensions[0];
  for (const candidate of primaryDimensions.slice(1)) {
    if (candidate.width !== selected.width || candidate.height !== selected.height) {
      importError("invalid-image", "Item primario AVIF con dimensioni ispe incoerenti.");
    }
  }
  return {
    format: "avif",
    mimeType: "image/avif",
    width: selected.width,
    height: selected.height,
  };
}

function detectAndParse(bytes: Uint8Array): ParsedRasterImage {
  if (bytesEqualAt(bytes, PNG_SIGNATURE)) return parsePng(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return parseJpeg(bytes);
  }
  if (
    bytes.length >= 12
    && ascii(bytes, 0, 4) === "RIFF"
    && ascii(bytes, 8, 4) === "WEBP"
  ) {
    return parseWebp(bytes);
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    return parseAvif(bytes);
  }
  importError(
    "unsupported-format",
    "Formato non supportato: usa PNG, JPEG, WebP statico oppure AVIF statico.",
  );
}

function normalizedDeclaredMimeType(source: Blob): string {
  return source.type.trim().toLowerCase().split(";", 1)[0];
}

function validateDeclaredMimeType(
  source: Blob,
  parsed: ParsedRasterImage,
): string | null {
  const declared = normalizedDeclaredMimeType(source);
  if (GENERIC_MIME_TYPES.has(declared)) return declared || null;
  const declaredFormat = MIME_TO_FORMAT.get(declared);
  if (!declaredFormat) {
    importError(
      "unsupported-format",
      `Tipo MIME ${declared || "sconosciuto"} non supportato.`,
    );
  }
  if (declaredFormat !== parsed.format) {
    importError(
      "mime-mismatch",
      `Il contenuto ${parsed.format.toUpperCase()} non coincide con il tipo MIME ${declared}.`,
    );
  }
  return declared;
}

export async function inspectRasterImage(
  source: Blob,
  limits: Partial<RasterImageImportLimits> = {},
): Promise<RasterImageInspection> {
  if (!(source instanceof Blob) || !Number.isSafeInteger(source.size)) {
    importError("invalid-source", "La sorgente raster deve essere un Blob valido.");
  }
  const resolvedLimits = resolveRasterImageImportLimits(limits);
  if (source.size === 0) {
    importError("source-empty", "Il file immagine è vuoto.");
  }
  if (source.size > resolvedLimits.maximumSourceBytes) {
    importError(
      "source-too-large",
      `File da ${source.size.toLocaleString("it-IT")} byte oltre il limite di `
      + `${resolvedLimits.maximumSourceBytes.toLocaleString("it-IT")} byte.`,
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await source.arrayBuffer();
  } catch (cause) {
    importError("invalid-source", "Impossibile leggere il file immagine.", cause);
  }
  const parsed = detectAndParse(new Uint8Array(buffer));
  const declaredMimeType = validateDeclaredMimeType(source, parsed);
  const encodedPixelCount = validateDimensions(
    parsed.width,
    parsed.height,
    resolvedLimits,
    "codificata",
  );
  return Object.freeze({
    strategy: RASTER_IMAGE_IMPORT_STRATEGY,
    format: parsed.format,
    mimeType: parsed.mimeType,
    declaredMimeType,
    sourceBytes: source.size,
    encodedWidth: parsed.width,
    encodedHeight: parsed.height,
    encodedPixelCount,
    animated: false,
  });
}

function defaultSourceName(source: Blob, format: RasterImageFormat): string {
  const fileName = typeof File !== "undefined" && source instanceof File
    ? source.name
    : "";
  const sanitized = fileName.trim().replace(/^.*[\\/]/, "");
  if (sanitized) return sanitized;
  return `immagine.${format === "jpeg" ? "jpg" : format}`;
}

function normalizedSourceName(
  source: Blob,
  format: RasterImageFormat,
  requested?: string,
): string {
  const sanitized = (requested ?? defaultSourceName(source, format))
    .trim()
    .replace(/^.*[\\/]/, "");
  return sanitized || defaultSourceName(source, format);
}

export async function decodeRasterImage(
  source: Blob,
  options: RasterImageDecodeOptions = {},
): Promise<DecodedRasterImage> {
  const limits = resolveRasterImageImportLimits(options.limits);
  const inspection = await inspectRasterImage(source, limits);
  options.preflight?.(inspection);
  if (typeof createImageBitmap !== "function") {
    importError(
      "decoder-unavailable",
      "createImageBitmap non è disponibile: nessun fallback Canvas2D è consentito.",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, {
      colorSpaceConversion: "default",
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
    });
  } catch (cause) {
    importError(
      "decode-failed",
      `Decodifica ${inspection.format.toUpperCase()} non riuscita nel browser.`,
      cause,
    );
  }

  try {
    const pixelCount = validateDimensions(
      bitmap.width,
      bitmap.height,
      limits,
      "decodificata",
    );
    if (
      (inspection.format === "png" || inspection.format === "webp")
      && (
        bitmap.width !== inspection.encodedWidth
        || bitmap.height !== inspection.encodedHeight
      )
    ) {
      importError(
        "invalid-image",
        `Dimensioni ${inspection.format.toUpperCase()} incoerenti fra header `
        + `(${inspection.encodedWidth}×${inspection.encodedHeight}) e decoder `
        + `(${bitmap.width}×${bitmap.height}).`,
      );
    }
    if (
      inspection.format === "jpeg"
      && !(
        (
          bitmap.width === inspection.encodedWidth
          && bitmap.height === inspection.encodedHeight
        )
        || (
          bitmap.width === inspection.encodedHeight
          && bitmap.height === inspection.encodedWidth
        )
      )
    ) {
      importError(
        "invalid-image",
        `Dimensioni JPEG incoerenti fra SOF (${inspection.encodedWidth}×`
        + `${inspection.encodedHeight}) e decoder (${bitmap.width}×${bitmap.height}).`,
      );
    }
    const metadata: RasterImageImportMetadata = Object.freeze({
      strategy: RASTER_IMAGE_IMPORT_STRATEGY,
      sourceName: normalizedSourceName(source, inspection.format, options.sourceName),
      format: inspection.format,
      mimeType: inspection.mimeType,
      sourceBytes: inspection.sourceBytes,
      width: bitmap.width,
      height: bitmap.height,
      pixelCount,
      animated: false,
    });
    return Object.freeze({ metadata, inspection, source, bitmap });
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

export function releaseDecodedRasterImage(decoded: DecodedRasterImage): void {
  decoded.bitmap.close();
}
