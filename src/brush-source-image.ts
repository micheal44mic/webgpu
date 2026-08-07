export const BRUSH_SOURCE_MAX_DIMENSION = 2048;
export const BRUSH_SOURCE_MAX_INPUT_PIXELS = 16_777_216;

export interface BrushSourceDimensions {
  readonly width: number;
  readonly height: number;
}

export interface BrushSourceResizePlan extends BrushSourceDimensions {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  );
}

function bytesEqualAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function jpegDimensions(bytes: Uint8Array): BrushSourceDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let markerIndex = offset + 1;
    while (markerIndex < bytes.length && bytes[markerIndex] === 0xff) markerIndex += 1;
    if (markerIndex >= bytes.length) return null;
    const marker = bytes[markerIndex];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerIndex + 1;
      continue;
    }
    if (markerIndex + 2 >= bytes.length) return null;
    const segmentLength = uint16BigEndian(bytes, markerIndex + 1);
    if (segmentLength < 2) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (markerIndex + 8 >= bytes.length || segmentLength < 7) return null;
      return {
        height: uint16BigEndian(bytes, markerIndex + 4),
        width: uint16BigEndian(bytes, markerIndex + 6),
      };
    }
    offset = markerIndex + 1 + segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): BrushSourceDimensions | null {
  if (
    bytes.length < 30
    || !bytesEqualAscii(bytes, 0, "RIFF")
    || !bytesEqualAscii(bytes, 8, "WEBP")
  ) {
    return null;
  }
  if (bytesEqualAscii(bytes, 12, "VP8X")) {
    return {
      width: uint24LittleEndian(bytes, 24) + 1,
      height: uint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (
    bytesEqualAscii(bytes, 12, "VP8 ")
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (bytesEqualAscii(bytes, 12, "VP8L") && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1
        + ((bytes[22] & 0xc0) >> 6)
        + (bytes[23] << 2)
        + ((bytes[24] & 0x0f) << 10),
    };
  }
  return null;
}

export function brushSourceDimensionsFromBytes(
  bytes: Uint8Array,
): BrushSourceDimensions | null {
  const png = bytes.length >= 24
    && bytes[0] === 0x89
    && bytesEqualAscii(bytes, 1, "PNG\r\n\x1a\n")
    && bytesEqualAscii(bytes, 12, "IHDR");
  if (png) {
    return {
      width: uint32BigEndian(bytes, 16),
      height: uint32BigEndian(bytes, 20),
    };
  }
  return jpegDimensions(bytes) ?? webpDimensions(bytes);
}

export function brushSourceResizePlan(
  sourceWidth: number,
  sourceHeight: number,
  maximumDimension = BRUSH_SOURCE_MAX_DIMENSION,
): BrushSourceResizePlan {
  if (
    !Number.isInteger(sourceWidth)
    || !Number.isInteger(sourceHeight)
    || sourceWidth < 1
    || sourceHeight < 1
  ) {
    throw new Error("The selected image has no readable dimensions.");
  }
  if (sourceWidth * sourceHeight > BRUSH_SOURCE_MAX_INPUT_PIXELS) {
    throw new Error(
      "This image is too large to decode safely on a phone. Resize it below 16 megapixels.",
    );
  }
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight));
  return {
    sourceWidth,
    sourceHeight,
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
