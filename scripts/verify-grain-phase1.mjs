import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetPath = path.join(projectRoot, "graincottonfleece.PNG");
const shaderPath = path.join(projectRoot, "src", "shaders.ts");
const enginePath = path.join(projectRoot, "src", "brush-engine.ts");
const mainPath = path.join(projectRoot, "src", "main.ts");
const htmlPath = path.join(projectRoot, "index.html");
const expectedSize = 2500;
const expectedSha256 = "9AA1CE073885B83EA223AF0941EF74604548A85F54442228EC15522ACE3EF2D7";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readPngHeader(filePath) {
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
  let idatBytes = 0;

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
      idatBytes += length;
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      break;
    }
  }

  assert(chunks[0] === "IHDR" && chunks.at(-1) === "IEND", "Ordine chunk PNG non valido.");
  assert(idatBytes > 0, "Il PNG non contiene dati immagine.");
  return {
    bytes,
    width,
    height,
    bitDepth,
    colorType,
    compressionMethod,
    filterMethod,
    interlaceMethod,
    chunks,
    idatBytes,
  };
}

function nativeMipSummary(size, bytesPerPixel) {
  const dimensions = [];
  let dimension = size;
  let pixels = 0;
  while (true) {
    dimensions.push(dimension);
    pixels += dimension * dimension;
    if (dimension === 1) {
      break;
    }
    dimension = Math.max(1, Math.floor(dimension / 2));
  }
  return {
    dimensions,
    levels: dimensions.length,
    pixels,
    bytes: pixels * bytesPerPixel,
  };
}

function roundUp(alignment, value) {
  return Math.ceil(value / alignment) * alignment;
}

function wgslTypeLayout(type) {
  if (type === "f32" || type === "i32" || type === "u32") {
    return { alignment: 4, size: 4 };
  }
  const vector = /^vec([234])<(f32|i32|u32)>$/.exec(type);
  assert(vector, `Tipo WGSL non supportato dal controllo ABI: ${type}.`);
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
      const parsed = /^([A-Za-z_]\w*)\s*:\s*([^,\s]+)$/.exec(member);
      assert(parsed, `Membro WGSL ${name} non riconosciuto: ${member}.`);
      return { name: parsed[1], type: parsed[2] };
    });

  let offset = 0;
  let alignment = 1;
  const offsets = {};
  for (const member of members) {
    const layout = wgslTypeLayout(member.type);
    offset = roundUp(layout.alignment, offset);
    offsets[member.name] = offset;
    offset += layout.size;
    alignment = Math.max(alignment, layout.alignment);
  }
  return { members, offsets, alignment, size: roundUp(alignment, offset) };
}

const decoded = readPngHeader(assetPath);
assert(decoded.width === expectedSize && decoded.height === expectedSize,
  `Asset ${decoded.width}×${decoded.height}, atteso 2500² nativo.`);
assert(decoded.bitDepth === 8, `Bit depth ${decoded.bitDepth}, atteso 8.`);
assert(decoded.colorType === 6, `Color type ${decoded.colorType}, atteso RGBA (6).`);
assert(
  decoded.compressionMethod === 0
    && decoded.filterMethod === 0
    && decoded.interlaceMethod === 0,
  "PNG deve usare compressione/filtro standard e non essere interlacciato.",
);
assert(decoded.chunks.includes("iCCP"), "Il profilo colore ICC originale è stato rimosso.");

const assetSha256 = crypto.createHash("sha256").update(decoded.bytes).digest("hex").toUpperCase();
assert(assetSha256 === expectedSha256,
  `SHA-256 asset ${assetSha256}, atteso ${expectedSha256}.`);
const mip = nativeMipSummary(expectedSize, 4);
assert(mip.levels === 12, `Catena mip ${mip.levels}, attesi 12 livelli.`);

const shaders = fs.readFileSync(shaderPath, "utf8");
const legacyEnd = shaders.indexOf("export const texturizedGrainShader");
const grainMipStart = shaders.indexOf("export const grainMipShader");
assert(legacyEnd > 0 && grainMipStart > legacyEnd, "Shader Grain WebGPU/WGSL separati non trovati.");
const legacyShader = shaders.slice(0, legacyEnd);
const grainShader = shaders.slice(legacyEnd, grainMipStart);
const grainUniformLayout = wgslStructLayout(grainShader, "GrainUniforms");
assert(!legacyShader.includes("grainTexture") && !legacyShader.includes("GrainUniforms"),
  "Il modulo brush Grain Off contiene binding Grain.");
assert(grainShader.includes("input.position.xy * grain.inversePeriod"),
  "Fixed M1 non è ancorato alle coordinate autorevoli del layer.");
assert(grainShader.includes("input.localPosition * 0.5 + vec2<f32>(0.5)"),
  "Moving M1 non usa le coordinate locali dello stamp.");
assert(grainShader.includes("grain.coordinateMode == 1u"),
  "Selezione Fixed/Moving assente dallo shader WGSL.");
assert(grainShader.includes("dot(sourceSample.rgb, vec3<f32>(0.299, 0.587, 0.114))"),
  "Luma RGB dell'asset M1 originale non trovata.");
assert(grainShader.includes("shapeOccupancyCoverageFragmentMain")
  && grainShader.includes("coverageFragmentMain"),
  "Entry point coverage M1 mancanti nel Grain WGSL.");
assert(shaders.includes("export const grainMipShader")
  && shaders.includes("textureSampleLevel(sourceTexture, sourceSampler"),
  "Generazione mip WebGPU/WGSL assente.");
assert(grainUniformLayout.size === 32,
  `ABI WGSL GrainUniforms ${grainUniformLayout.size} byte, attesi 32.`);
assert(grainUniformLayout.offsets.coordinateMode === 20,
  `Offset coordinateMode ${grainUniformLayout.offsets.coordinateMode}, atteso 20.`);

const engine = fs.readFileSync(enginePath, "utf8");
assert(engine.includes('fetch(new URL("../graincottonfleece.PNG", import.meta.url))'),
  "Il runtime non carica l'asset M1 originale.");
assert(engine.includes('const GRAIN_TEXTURE_SIZE = 2500;')
  && engine.includes('format: "rgba8unorm"'),
  "Dimensione/formato nativi del Grain non configurati.");
assert(engine.includes('"rgba8-native-2500-fixed-coverage-multiply"')
  && engine.includes('"rgba8-native-2500-moving-coverage-multiply"'),
  "Marker Fixed/Moving nativi assenti.");
assert(engine.includes('export type BlendMode = "normal" | "additive" | "light-glaze" | "m1-glaze"'),
  "Blend mode M1 Glaze assente.");
assert(engine.includes('operation: "max"')
  && engine.includes("m1GlazePipeline")
  && engine.includes("grainM1GlazePipeline"),
  "Pipeline MAX coverage M1 Glaze assenti.");
assert(shaders.includes("unpack4x8unorm(pack4x8unorm")
  && engine.includes("m1-r8-quantized-max-coverage-rgba-compat-single-commit"),
  "Semantica coverage R8 quantizzata M1 assente.");
assert(engine.includes("session.tintLinear")
  && engine.includes('"m1-max-coverage"'),
  "Tint per tratto e resolve M1 Glaze non collegati.");
assert(engine.includes("grainTextureIdentity") && engine.includes("expectedGrainIdentity"),
  "Identità Grain non protetta nel journal/replay.");
assert(engine.includes("const polarity = settings.grainInvert ? -1 : 1")
  && engine.includes("settings.grainBrightness, -1, 1) * polarity")
  && engine.includes("settings.grainContrast, -1, 1)) * polarity"),
  "Invert Grain non è incorporato nei coefficienti esistenti.");

const main = fs.readFileSync(mainPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
assert(main.includes('setControlValue("grainMode", "off")'),
  "Il preset canonico non forza Grain Off.");
assert(main.includes('benchmark.settings.grainMode === "moving"'),
  "La normalizzazione delle impostazioni manuali Moving è assente.");
assert(main.includes('type HumanStrokeTestGrainMode = Extract<GrainMode, "off" | "texturized">')
  && main.includes('blendIntensity: blendMode === "m1-glaze" ? 1 : 4')
  && main.includes('humanStrokeTestGrainModeSelect.value === "texturized" ? "texturized" : "off"'),
  "Il replay iPhone non espone correttamente Grain Off/Fixed o le intensità Normal 4× / M1 1×.");
assert(html.includes('value="texturized">Texturized — Fixed M1')
  && html.includes('value="moving">Texturized — Moving M1'),
  "Le due impostazioni Grain M1 non sono esposte nella UI.");
assert(html.includes('id="grainInvert" type="checkbox"')
  && main.includes('grainInvert: element<HTMLInputElement>("grainInvert").checked')
  && main.includes('element<HTMLInputElement>("grainInvert").checked = false'),
  "Il controllo Invert Grain o il default canonico Off non sono collegati.");
assert(html.includes('value="m1-glaze">M1 Glaze — non accumulativo'),
  "M1 Glaze non è esposto nella UI.");
assert(html.includes('value="normal">Normal accumulativo — 4×')
  && html.includes('value="m1-glaze">M1 Glaze non accumulativo — 1×')
  && html.includes('value="off">Off — senza texture')
  && html.includes('value="texturized">Texturized — Fixed M1 (fisso)'),
  "La matrice iPhone Normal 4× / M1 1× con Grain Off/Fixed non è esposta correttamente.");
assert(main.includes("performanceTelemetryRevision: 24"),
  "Revisione telemetria attesa assente.");

console.log(JSON.stringify({
  asset: path.relative(projectRoot, assetPath),
  sha256: assetSha256,
  width: decoded.width,
  height: decoded.height,
  format: "rgba8-original-with-icc",
  sourceBytes: decoded.bytes.length,
  mipDimensions: mip.dimensions,
  mipLevels: mip.levels,
  gpuMipBytes: mip.bytes,
  gpuMipMiB: mip.bytes / (1024 * 1024),
  grainUniformAbiBytes: grainUniformLayout.size,
  invariants: {
    originalM1AssetUnmodified: true,
    webGpuWgslOnlyRenderingPath: true,
    fixedUsesLayerCoordinates: true,
    movingUsesStampLocalCoordinates: true,
    movingIgnoresScaleControl: true,
    invertUsesExistingAffineUniforms: true,
    iphoneReplayOffersOffOrFixedTexturized: true,
    iphoneReplayUsesNormal4xAndM1Glaze1x: true,
    m1GlazeUsesR8QuantizedMaxCoverage: true,
    legacyLightGlazePreserved: true,
    canonicalReplayForcesGrainOff: true,
  },
}, null, 2));
