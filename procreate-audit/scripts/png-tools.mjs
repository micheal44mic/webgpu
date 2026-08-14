import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBuffer, data]);
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

export function createRgbaImage(width, height, color = [0, 0, 0, 0]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  }
  return { width, height, pixels };
}

export function writeRgbaPng(path, image) {
  const { width, height, pixels } = image;
  if (pixels.length !== width * height * 4) {
    throw new Error(`RGBA buffer non valido: ${pixels.length} byte per ${width}x${height}.`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const gamma = Buffer.alloc(4);
  gamma.writeUInt32BE(45455, 0);

  const raw = Buffer.allocUnsafe(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    raw[rowOffset] = 0;
    Buffer.from(
      pixels.buffer,
      pixels.byteOffset + y * width * 4,
      width * 4,
    ).copy(raw, rowOffset + 1);
  }

  const encoded = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("sRGB", Buffer.from([0])),
    pngChunk("gAMA", gamma),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND"),
  ]);
  writeFileSync(path, encoded);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function readPng(path) {
  const encoded = readFileSync(path);
  if (!encoded.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${path}: firma PNG non valida.`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat = [];
  const chunks = [];

  while (offset + 12 <= encoded.length) {
    const length = encoded.readUInt32BE(offset);
    const type = encoded.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > encoded.length) {
      throw new Error(`${path}: chunk ${type} troncato.`);
    }
    const data = encoded.subarray(dataStart, dataEnd);
    chunks.push(type);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (bitDepth !== 8) {
    throw new Error(`${path}: bit depth ${bitDepth} non supportato; serve PNG 8-bit.`);
  }
  if (interlace !== 0) {
    throw new Error(`${path}: PNG interlacciato non supportato.`);
  }

  const channelsByColorType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByColorType.get(colorType);
  if (!channels) {
    throw new Error(`${path}: color type PNG ${colorType} non supportato.`);
  }

  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const expectedBytes = height * (stride + 1);
  if (inflated.length !== expectedBytes) {
    throw new Error(
      `${path}: dati raster ${inflated.length}, attesi ${expectedBytes}.`,
    );
  }

  const decoded = new Uint8Array(width * height * channels);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * stride;
    const previousOffset = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= channels ? decoded[rowOffset + x - channels] : 0;
      const up = y > 0 ? decoded[previousOffset + x] : 0;
      const upLeft = y > 0 && x >= channels
        ? decoded[previousOffset + x - channels]
        : 0;
      let value;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4:
          value = raw + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`${path}: filtro PNG ${filter} non supportato.`);
      }
      decoded[rowOffset + x] = value & 0xff;
    }
    sourceOffset += stride;
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 4;
    if (colorType === 0) {
      pixels[target] = decoded[source];
      pixels[target + 1] = decoded[source];
      pixels[target + 2] = decoded[source];
      pixels[target + 3] = 255;
    } else if (colorType === 2) {
      pixels[target] = decoded[source];
      pixels[target + 1] = decoded[source + 1];
      pixels[target + 2] = decoded[source + 2];
      pixels[target + 3] = 255;
    } else if (colorType === 4) {
      pixels[target] = decoded[source];
      pixels[target + 1] = decoded[source];
      pixels[target + 2] = decoded[source];
      pixels[target + 3] = decoded[source + 1];
    } else {
      pixels[target] = decoded[source];
      pixels[target + 1] = decoded[source + 1];
      pixels[target + 2] = decoded[source + 2];
      pixels[target + 3] = decoded[source + 3];
    }
  }

  return {
    path,
    width,
    height,
    pixels,
    bitDepth,
    colorType,
    chunks,
  };
}

function compositeChannel(source, destination, sourceAlpha) {
  return Math.round(source * sourceAlpha + destination * (1 - sourceAlpha));
}

export function setPixel(image, x, y, color) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return;
  const offset = (iy * image.width + ix) * 4;
  const sourceAlpha = color[3] / 255;
  const destinationAlpha = image.pixels[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) {
    image.pixels.fill(0, offset, offset + 4);
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const sourcePremul = color[channel] * sourceAlpha;
    const destinationPremul = image.pixels[offset + channel] * destinationAlpha;
    image.pixels[offset + channel] = Math.round(
      (sourcePremul + destinationPremul * (1 - sourceAlpha)) / outputAlpha,
    );
  }
  image.pixels[offset + 3] = Math.round(outputAlpha * 255);
}

export function fillRect(image, x, y, width, height, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(image.width, Math.ceil(x + width));
  const bottom = Math.min(image.height, Math.ceil(y + height));
  if (color[3] === 255) {
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) {
        const offset = (py * image.width + px) * 4;
        image.pixels[offset] = color[0];
        image.pixels[offset + 1] = color[1];
        image.pixels[offset + 2] = color[2];
        image.pixels[offset + 3] = 255;
      }
    }
    return;
  }
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      setPixel(image, px, py, color);
    }
  }
}

export function strokeRect(image, x, y, width, height, thickness, color) {
  fillRect(image, x, y, width, thickness, color);
  fillRect(image, x, y + height - thickness, width, thickness, color);
  fillRect(image, x, y, thickness, height, color);
  fillRect(image, x + width - thickness, y, thickness, height, color);
}

export function fillCircle(image, centerX, centerY, radius, color) {
  const radiusSquared = radius * radius;
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(image.width - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(image.height - 1, Math.ceil(centerY + radius));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        setPixel(image, x, y, color);
      }
    }
  }
}

export function strokeCircle(image, centerX, centerY, radius, thickness, color) {
  const outerSquared = radius * radius;
  const innerRadius = Math.max(0, radius - thickness);
  const innerSquared = innerRadius * innerRadius;
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(image.width - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(image.height - 1, Math.ceil(centerY + radius));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared <= outerSquared && distanceSquared >= innerSquared) {
        setPixel(image, x, y, color);
      }
    }
  }
}

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

export function measureText(text, scale = 1) {
  const normalized = text.toUpperCase();
  return {
    width: Math.max(0, normalized.length * 6 * scale - scale),
    height: 7 * scale,
  };
}

export function drawText(image, text, x, y, scale, color) {
  const normalized = text.toUpperCase();
  let cursor = Math.round(x);
  for (const character of normalized) {
    const glyph = FONT[character] ?? FONT[" "];
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row][column] === "1") {
          fillRect(
            image,
            cursor + column * scale,
            y + row * scale,
            scale,
            scale,
            color,
          );
        }
      }
    }
    cursor += 6 * scale;
  }
}

export function drawCenteredText(image, text, centerX, y, scale, color) {
  const measurement = measureText(text, scale);
  drawText(image, text, centerX - measurement.width / 2, y, scale, color);
}

export function rgbaAt(image, x, y) {
  const ix = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const offset = (iy * image.width + ix) * 4;
  return Array.from(image.pixels.subarray(offset, offset + 4));
}

export function sourceOverStraight(source, destination) {
  const sourceAlpha = source[3] / 255;
  const destinationAlpha = destination[3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return [0, 0, 0, 0];
  return [
    compositeChannel(source[0], destination[0], sourceAlpha),
    compositeChannel(source[1], destination[1], sourceAlpha),
    compositeChannel(source[2], destination[2], sourceAlpha),
    Math.round(outputAlpha * 255),
  ];
}
