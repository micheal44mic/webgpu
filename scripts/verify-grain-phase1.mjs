import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetPath = path.join(projectRoot, "grain-cotton-fleece-2048.png");
const shaderPath = path.join(projectRoot, "src", "shaders.ts");
const enginePath = path.join(projectRoot, "src", "brush-engine.ts");
const mainPath = path.join(projectRoot, "src", "main.ts");
const expectedSize = 2048;
const expectedSha256 = "F353BDF4C8671D56AA69F4242AE60D34993EA883467CB616950A0FC292E8FD4B";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readPngGray8(filePath) {
  const bytes = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(bytes.subarray(0, signature.length).equals(signature), "Firma PNG non valida.");

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compressionMethod = 0;
  let filterMethod = 0;
  let interlaceMethod = 0;
  const chunks = [];
  const idat = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert(dataEnd + 4 <= bytes.length, `Chunk ${type} oltre la fine del file.`);
    chunks.push(type);
    if (type === "IHDR") {
      assert(length === 13, "IHDR non valido.");
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      compressionMethod = bytes[dataStart + 10];
      filterMethod = bytes[dataStart + 11];
      interlaceMethod = bytes[dataStart + 12];
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  assert(width === expectedSize && height === expectedSize, `Asset ${width}×${height}, atteso 2048².`);
  assert(bitDepth === 8, `Bit depth ${bitDepth}, atteso 8.`);
  assert(colorType === 0, `Color type ${colorType}, atteso grayscale opaco (0).`);
  assert(compressionMethod === 0 && filterMethod === 0 && interlaceMethod === 0,
    "PNG deve usare compressione/filtro standard e non essere interlacciata.");
  assert(chunks[0] === "IHDR" && chunks.at(-1) === "IEND" && idat.length > 0,
    "Ordine chunk PNG non valido.");
  assert(chunks.every((type) => type === "IHDR" || type === "IDAT" || type === "IEND"),
    `Metadata inattesi: ${chunks.join(", ")}.`);

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  assert(inflated.length === (width + 1) * height, "Dimensione scanline decompressa non valida.");
  const pixels = Buffer.alloc(width * height);
  let sourceOffset = 0;

  function paeth(left, up, upperLeft) {
    const prediction = left + up - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const upDistance = Math.abs(prediction - up);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
      return left;
    }
    return upDistance <= upperLeftDistance ? up : upperLeft;
  }

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    assert(filter <= 4, `Filtro PNG non supportato: ${filter}.`);
    for (let x = 0; x < width; x += 1) {
      const encoded = inflated[sourceOffset];
      sourceOffset += 1;
      const destination = y * width + x;
      const left = x > 0 ? pixels[destination - 1] : 0;
      const up = y > 0 ? pixels[destination - width] : 0;
      const upperLeft = x > 0 && y > 0 ? pixels[destination - width - 1] : 0;
      const predictor = filter === 1
        ? left
        : filter === 2
          ? up
          : filter === 3
            ? Math.floor((left + up) * 0.5)
            : filter === 4 ? paeth(left, up, upperLeft) : 0;
      pixels[destination] = (encoded + predictor) & 0xff;
    }
  }
  return { width, height, pixels, chunks };
}

function differenceStats(histogram, sampleCount) {
  let sum = 0;
  let seen = 0;
  let p95 = 0;
  let maximum = 0;
  const threshold = Math.ceil(sampleCount * 0.95);
  for (let difference = 0; difference < histogram.length; difference += 1) {
    const count = histogram[difference];
    if (count === 0) {
      continue;
    }
    sum += difference * count;
    seen += count;
    maximum = difference;
    if (p95 === 0 && seen >= threshold) {
      p95 = difference;
    }
  }
  return { mean: sum / sampleCount, p95, max: maximum };
}

function seamStatistics({ width, height, pixels }) {
  const wrapX = new Uint32Array(256);
  const wrapY = new Uint32Array(256);
  const internalX = new Uint32Array(256);
  const internalY = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) {
    wrapX[Math.abs(pixels[y * width] - pixels[y * width + width - 1])] += 1;
    for (let x = 1; x < width; x += 1) {
      internalX[Math.abs(pixels[y * width + x] - pixels[y * width + x - 1])] += 1;
    }
  }
  for (let x = 0; x < width; x += 1) {
    wrapY[Math.abs(pixels[x] - pixels[(height - 1) * width + x])] += 1;
    for (let y = 1; y < height; y += 1) {
      internalY[Math.abs(pixels[y * width + x] - pixels[(y - 1) * width + x])] += 1;
    }
  }
  return {
    wrapX: differenceStats(wrapX, height),
    wrapY: differenceStats(wrapY, width),
    internalX: differenceStats(internalX, height * (width - 1)),
    internalY: differenceStats(internalY, width * (height - 1)),
  };
}

function mipSummary(basePixels, baseSize) {
  let pixels = basePixels;
  let size = baseSize;
  let levels = 1;
  let bytes = pixels.length;
  while (size > 1) {
    const nextSize = size / 2;
    const next = new Uint8Array(nextSize * nextSize);
    for (let y = 0; y < nextSize; y += 1) {
      for (let x = 0; x < nextSize; x += 1) {
        const source = y * 2 * size + x * 2;
        next[y * nextSize + x] = Math.round(
          (pixels[source] + pixels[source + 1] + pixels[source + size] + pixels[source + size + 1]) / 4,
        );
      }
    }
    pixels = next;
    size = nextSize;
    levels += 1;
    bytes += next.length;
  }
  return { levels, bytes };
}

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash;
}

function roundUp(alignment, value) {
  return Math.ceil(value / alignment) * alignment;
}

function wgslTypeLayout(type) {
  if (type === "f32" || type === "i32" || type === "u32") {
    return { alignment: 4, size: 4 };
  }
  const vector = /^vec([234])<(f32|i32|u32)>$/.exec(type);
  assert(vector, `Tipo WGSL non supportato dal controllo ABI Grain: ${type}.`);
  const components = Number(vector[1]);
  return {
    alignment: components === 2 ? 8 : 16,
    size: components * 4,
  };
}

function wgslStructLayout(source, name) {
  const match = new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\};`).exec(source);
  assert(match, `Struct WGSL ${name} non trovata.`);
  const members = match[1]
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean)
    .map((member) => {
      const memberMatch = /^([A-Za-z_]\w*)\s*:\s*([^,\s]+)$/.exec(member);
      assert(memberMatch, `Membro WGSL ${name} non riconosciuto: ${member}.`);
      return { name: memberMatch[1], type: memberMatch[2] };
    });

  let offset = 0;
  let structAlignment = 1;
  const offsets = {};
  for (const member of members) {
    const layout = wgslTypeLayout(member.type);
    offset = roundUp(layout.alignment, offset);
    offsets[member.name] = offset;
    offset += layout.size;
    structAlignment = Math.max(structAlignment, layout.alignment);
  }
  return {
    members,
    offsets,
    alignment: structAlignment,
    size: roundUp(structAlignment, offset),
  };
}

const decoded = readPngGray8(assetPath);
const assetSha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(assetPath))
  .digest("hex")
  .toUpperCase();
assert(assetSha256 === expectedSha256,
  `SHA-256 asset ${assetSha256}, atteso ${expectedSha256}.`);
const seams = seamStatistics(decoded);
const mip = mipSummary(decoded.pixels, decoded.width);
assert(mip.levels === 12, `Catena mip ${mip.levels}, attesi 12 livelli.`);
assert(mip.bytes === 5_592_405, `Memoria mip ${mip.bytes}, attesi 5.592.405 byte.`);
assert(seams.wrapX.mean <= seams.internalX.mean * 1.15,
  `Seam X troppo forte: ${seams.wrapX.mean} contro ${seams.internalX.mean}.`);
assert(seams.wrapY.mean <= seams.internalY.mean * 1.15,
  `Seam Y troppo forte: ${seams.wrapY.mean} contro ${seams.internalY.mean}.`);
assert(seams.wrapX.p95 <= seams.internalX.p95 + 2,
  `Seam X p95 troppo forte: ${seams.wrapX.p95} contro ${seams.internalX.p95}.`);
assert(seams.wrapY.p95 <= seams.internalY.p95 + 2,
  `Seam Y p95 troppo forte: ${seams.wrapY.p95} contro ${seams.internalY.p95}.`);

const shaders = fs.readFileSync(shaderPath, "utf8");
const legacyEnd = shaders.indexOf("export const texturizedGrainShader");
assert(legacyEnd > 0, "Modulo fragment grain separato non trovato.");
const grainEnd = shaders.indexOf("\nexport const ", legacyEnd + 1);
assert(grainEnd > legacyEnd, "Fine del modulo fragment grain non trovata.");
const legacyShader = shaders.slice(0, legacyEnd);
const grainShader = shaders.slice(legacyEnd, grainEnd);
const grainUniformLayout = wgslStructLayout(grainShader, "GrainUniforms");
assert(!legacyShader.includes("grainTexture") && !legacyShader.includes("GrainUniforms"),
  "Il modulo brush legacy contiene binding o uniform Grain.");
assert(grainShader.includes("input.position.xy * grain.inversePeriod"),
  "Le UV Texturized non sono ancorate alla posizione layer.");
assert(!grainShader.includes("viewCenter") && !grainShader.includes("display.zoom"),
  "Il fragment Grain dipende dal viewport/display.");
assert(grainUniformLayout.size === 32,
  `ABI WGSL GrainUniforms ${grainUniformLayout.size} byte, attesi 32.`);
assert(grainUniformLayout.members.length === 8
  && grainUniformLayout.members.every((member) => member.type === "f32" || member.type === "u32"),
  "GrainUniforms deve restare composta da otto scalari a 32 bit.");

const engine = fs.readFileSync(enginePath, "utf8");
assert(engine.includes('grainMode: "off"'), "Il default engine Grain Off non è esplicito.");
const grainUniformBytesMatch = /const\s+GRAIN_UNIFORM_BYTES\s*=\s*(\d+)\s*;/.exec(engine);
assert(grainUniformBytesMatch, "Costante CPU GRAIN_UNIFORM_BYTES non trovata.");
const grainUniformCpuBytes = Number(grainUniformBytesMatch[1]);
assert(grainUniformCpuBytes === grainUniformLayout.size,
  `ABI Grain CPU ${grainUniformCpuBytes} byte, WGSL ${grainUniformLayout.size} byte.`);
assert(engine.includes("separate-opt-in-pipelines"), "Marker pipeline Grain separata assente.");
assert(engine.includes("this.grainNormalPipeline") && engine.includes("this.normalPipeline"),
  "Selezione pipeline Grain/legacy non trovata.");
assert(engine.includes("grainTextureIdentity") && engine.includes("expectedGrainIdentity"),
  "Identità Grain non protetta nel journal/replay.");
assert(engine.includes("profile.grainAdaptivePreviewSkips")
  && engine.includes("this.startAdaptivePreviewProbe(false)"),
  "Preview Grain o probe adattivo non protetti.");

const main = fs.readFileSync(mainPath, "utf8");
assert(main.includes('setControlValue("grainMode", "off")'),
  "Il preset canonico non forza Grain Off.");
assert(main.includes('benchmark.settings.grainMode === "texturized" ? "texturized" : "off"'),
  "La normalizzazione dei settings legacy a Grain Off non è presente.");
assert(main.includes("testGrainMode"), "Il marker benchmark testGrainMode non è presente.");
assert(main.includes("performanceTelemetryRevision: 22"),
  "Revisione telemetria Grain 22 assente.");

console.log(JSON.stringify({
  asset: path.relative(projectRoot, assetPath),
  sha256: assetSha256,
  width: decoded.width,
  height: decoded.height,
  format: "grayscale-8-opaque",
  chunks: decoded.chunks,
  mipLevels: mip.levels,
  mipBytes: mip.bytes,
  identityFnv1a: fnv1a(decoded.pixels),
  grainUniformAbiBytes: grainUniformLayout.size,
  seams,
  invariants: {
    grainUniformCpuWgslAbiMatches: true,
    legacyShaderHasNoGrainBindings: true,
    texturizedUvUsesAuthoritativeLayerPosition: true,
    historyChecksGrainIdentity: true,
    adaptivePreviewDisabledButProbeActive: true,
    legacySettingsNormalizeToOff: true,
    canonicalReplayForcesOff: true,
  },
}, null, 2));
