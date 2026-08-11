import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEngineSource } from "./engine-source.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetPath = path.join(projectRoot, "Grainpencil.png");
const shaderPath = path.join(projectRoot, "src", "shaders.ts");
const blendShaderPath = path.join(projectRoot, "src", "blend-shaders.ts");
const blendRendererPath = path.join(projectRoot, "src", "blend-renderer.ts");
const mobileBrushStudioPath = path.join(projectRoot, "src", "mobile-brush-studio.ts");
const brushStrokePreviewPath = path.join(
  projectRoot,
  "src",
  "brush-stroke-preview-renderer.ts",
);
const stampUploadPath = path.join(projectRoot, "src", "engine-stamp-upload.ts");
const mainPath = path.join(projectRoot, "src", "main.ts");
const htmlPath = path.join(projectRoot, "index.html");
const expectedSize = 800;
const expectedSha256 = "2AF322275A8A1EBC9E410C123115EEF2CBB3AB8F4EE5823BBB6CF3F495D07528";

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

function movingUv(documentPosition, stampCenter, period, movement) {
  const inversePeriod = 1 / period;
  const dragged = (documentPosition - stampCenter) * inversePeriod + 0.5;
  const fixed = documentPosition * inversePeriod;
  return dragged + (fixed - dragged) * movement;
}

// Contract numerico della coordinata Moving: il patch trascinato e il roller
// condividono la stessa frequenza. Scale agisce anche a Movement 0; traslare
// insieme stamp e documento lascia il drag invariato, mentre 100% resta fisso
// nel documento come Texturized.
assert(movingUv(120, 100, 40, 0) === 1, "Moving 0 non usa il patch locale scalato.");
assert(movingUv(120, 100, 80, 0) === 0.75, "Scale non agisce su Moving 0.");
assert(movingUv(160, 140, 40, 0) === 1, "Moving 0 non segue la traslazione dello stamp.");
assert(movingUv(120, 100, 40, 1) === 3, "Moving 100% non converge a Texturized.");
assert(movingUv(120, 100, 40, 0.5) === 2, "Movement non interpola drag e roller.");

const decoded = readPngHeader(assetPath);
assert(decoded.width === expectedSize && decoded.height === expectedSize,
  `Asset ${decoded.width}×${decoded.height}, atteso 800² nativo.`);
assert(decoded.bitDepth === 8, `Bit depth ${decoded.bitDepth}, atteso 8.`);
assert(decoded.colorType === 0, `Color type ${decoded.colorType}, atteso grayscale (0).`);
assert(
  decoded.compressionMethod === 0
    && decoded.filterMethod === 0
    && decoded.interlaceMethod === 0,
  "PNG deve usare compressione/filtro standard e non essere interlacciato.",
);
const assetSha256 = crypto.createHash("sha256").update(decoded.bytes).digest("hex").toUpperCase();
assert(assetSha256 === expectedSha256,
  `SHA-256 asset ${assetSha256}, atteso ${expectedSha256}.`);
const mip = nativeMipSummary(expectedSize, 2);
assert(mip.levels === 10, `Catena mip ${mip.levels}, attesi 10 livelli.`);

const shaders = fs.readFileSync(shaderPath, "utf8");
const legacyEnd = shaders.indexOf("export const texturizedGrainShader");
const grainMipStart = shaders.indexOf("export const grainMipShader");
assert(legacyEnd > 0 && grainMipStart > legacyEnd, "Shader Grain WebGPU/WGSL separati non trovati.");
const legacyShader = shaders.slice(0, legacyEnd);
const grainShader = shaders.slice(legacyEnd, grainMipStart);
const grainUniformLayout = wgslStructLayout(grainShader, "GrainUniforms");
assert(!legacyShader.includes("grainTexture") && !legacyShader.includes("GrainUniforms"),
  "Il modulo brush Grain Off contiene binding Grain.");
assert(grainShader.includes("(input.position.xy + brush.renderTargetOrigin) * grain.inversePeriod"),
  "Fixed M1 non è ancorato alle coordinate autorevoli del layer.");
assert(legacyShader.includes("@location(2) localBrushPixels: vec2<f32>")
  && legacyShader.includes("output.localBrushPixels = localPosition * stamp.radius"),
  "Il vertex Grain non trasmette le coordinate locali fisiche dello stamp.");
assert(grainShader.includes("grain.coordinateMode != 0u"),
  "Selezione Fixed/Moving assente dallo shader WGSL.");
const selectedGrainUv = grainShader.match(
  /fn selectedGrainUv\(input: FragmentInput\)[\s\S]*?\n}/,
)?.[0] ?? "";
assert(selectedGrainUv.includes(
  "input.localBrushPixels * grain.inversePeriod + vec2<f32>(0.5)",
) && selectedGrainUv.includes("return mix(movingUv, fixedUv, movement)"),
"Movement non interpola coordinate stamp/layer alla stessa scala fisica.");
assert(!selectedGrainUv.includes("input.localPosition * 0.5"),
  "Moving usa ancora UV stamp 0..1 che ignorano Scale.");
assert(grainShader.includes("max(1u, grain.mipLevelCount) - 1u"),
  "Il numero di mip Grain non è più dinamico nell'uniform.");
// La sorgente Pencil viene convertita una volta nel campo scalare R16F usato
// dalla pittura. Il percorso resta valido anche per Grain custom RGB/RGBA.
assert(shaders.includes("export const grainLumaShader")
  && shaders.match(
    /grainLumaShader[\s\S]*?dot\(texel\.rgb, vec3<f32>\(0\.299, 0\.587, 0\.114\)\)/,
  ),
  "Conversione luma RGB della grana non trovata nel caricamento.");
assert(shaders.match(/grainLumaShader[\s\S]*?textureLoad\(sourceTexture/),
  "La conversione luma deve leggere texel a texel, non campionare filtrato.");
assert(grainShader.includes("let source = sourceSample.r;"),
  "Il fragment shader di pittura non consuma il campo scalare della grana.");
assert(!grainShader.includes("dot(sourceSample.rgb"),
  "La luma non deve essere ricalcolata a ogni campionamento.");
assert(grainShader.includes("shapeOccupancyCoverageFragmentMain")
  && grainShader.includes("coverageFragmentMain"),
  "Entry point coverage mancanti nel Grain WGSL.");
assert(shaders.includes("export const grainMipShader")
  && shaders.includes("textureSampleLevel(sourceTexture, sourceSampler"),
  "Generazione mip WebGPU/WGSL assente.");
assert(grainUniformLayout.size === 32,
  `ABI WGSL GrainUniforms ${grainUniformLayout.size} byte, attesi 32.`);
assert(grainUniformLayout.offsets.coordinateMode === 20,
  `Offset coordinateMode ${grainUniformLayout.offsets.coordinateMode}, atteso 20.`);

const engine = readEngineSource();
assert(!engine.includes("graincottonfleece.PNG")
  && engine.includes('url: new URL("../Grainpencil.png", import.meta.url)')
  && engine.includes("fetch(asset.url)"),
  "Il runtime non instrada il Grain Pencil senza il Cotton Fleece rimosso.");
assert(engine.includes('const GRAIN_TEXTURE_SIZE = 800;')
  && engine.includes('format: "r16float"')
  && engine.includes("mipLevelCountForSize(width, height)"),
  "Dimensione/formato nativi del Grain non configurati.");
// Lo staging RGBA e' un transitorio: se sopravvivesse alla conversione, il
// risparmio verrebbe annullato dal doppio della memoria al carico.
assert(engine.includes("stagingTexture.destroy()"),
  "Lo staging RGBA della grana non viene distrutto dopo la conversione.");
assert(engine.includes("r16MipChainBytes(width, height)"),
  "La contabilita' della grana non segue il formato scalare.");
assert(engine.includes('"r16float-dynamic-fixed-coverage-multiply"')
  && engine.includes('"r16float-dynamic-moving-scaled-drag-to-roller-coverage-multiply"'),
  "Marker Fixed/Moving dinamici assenti.");
const samplerRouting = engine.match(
  /export function grainCoordinateMode\([\s\S]*?\n}/,
)?.[0] ?? "";
assert(samplerRouting.includes('return "fixed";')
  && !samplerRouting.includes("grainMovement"),
"Moving scalato non usa sempre il sampler repeat.");

const blendShader = fs.readFileSync(blendShaderPath, "utf8");
const blendRenderer = fs.readFileSync(blendRendererPath, "utf8");
assert(blendShader.includes(
  "bestLocal.brushPixels * blend.grainControls.x + vec2<f32>(0.5)",
) && blendShader.includes("grainUv = mix(movingUv, fixedUv, movement)")
  && blendShader.includes("movingUvDx = vec2<f32>(cosine, -sine)"),
"Blend dry non usa il mapping Moving scalato e rotation-aware.");
assert(blendShader.includes("let source = sourceSample.r;"),
  "Blend dry non consuma il campo scalare R16F della grana.");
assert(!blendShader.includes("dot(sourceSample.rgb"),
  "Blend dry ricalcola ancora la luma RGB su una texture Grain R16F.");
assert(blendRenderer.includes('const grainMode = "fixed" as const;'),
  "Blend dry Moving non seleziona il sampler repeat.");

const mobileBrushStudio = fs.readFileSync(mobileBrushStudioPath, "utf8");
const brushStrokePreview = fs.readFileSync(brushStrokePreviewPath, "utf8");
const stampUpload = fs.readFileSync(stampUploadPath, "utf8");
assert(mobileBrushStudio.includes(
  "await this.options.previewRenderer.render(this.previewCanvas, settings)",
) && !mobileBrushStudio.includes("previewDocumentScale")
  && !mobileBrushStudio.includes("applyPreviewGrain("),
"Brush Studio non delega il Grain al renderer WebGPU autorevole.");
assert(brushStrokePreview.includes("populateGrainUniformUpload(")
  && brushStrokePreview.includes("projectionScale,")
  && brushStrokePreview.includes("grainCoordinateMode(settings)")
  && brushStrokePreview.includes("isTexturizedGrainActive(settings)"),
"La preview WebGPU non riusa uniforme, coordinate e routing Grain autorevoli.");
assert(stampUpload.includes("coordinateScale = 1")
  && stampUpload.includes("coordinateScale) * authoredScale")
  && stampUpload.includes("1 / (Math.max(1, textureWidth) * projectedScale)"),
"La proiezione della preview non conserva il periodo fisico Scale × asset.");
assert(engine.includes('export type BlendMode =')
  && engine.includes('| "light-glaze"')
  && engine.includes('| "uniformed-glaze"')
  && engine.includes('| "intense-blending"')
  && engine.includes('| "m1-glaze"'),
  "I tre rendering pubblici o la compatibilità M1 storica sono assenti.");
const glazeSessionSource = engine.match(
  /startLightGlazeSession\(historyActionId: number, settings: BrushSettings\)[\s\S]*?abandonLightGlazeSession\(\): void/,
)?.[0] ?? "";
assert(glazeSessionSource.includes("...settings")
  && !glazeSessionSource.includes("blendMode: settings.blendMode"),
  "La sessione glaze rinomina la modalità pubblica e può scambiare lo storage durante il tratto.");
assert(engine.includes('"allocate-on-glaze-select-release-when-idle-deselected"')
  && engine.includes("maybeReleaseIdleLightGlazeResources"),
  "Light Glaze storage lifecycle (alloca al select, rilascia al deselect) mancante");
assert(engine.includes('"allocate-on-grain-select-release-when-idle-unused"')
  && engine.includes("maybeReleaseIdleGrainResources")
  && engine.includes("rebuildGrainBrushBindGroups")
  && engine.includes("Grain placeholder 1×1 while released"),
  "Grain lifecycle (lazy alla selezione, rilascio quando inutilizzato) mancante");
assert(engine.includes('"allocate-on-shape-select-release-when-idle-unused"')
  && engine.includes("maybeReleaseIdleShapeResources")
  && engine.includes("rebuildShapeBrushBindGroups")
  && engine.includes("Shape placeholder 1×1 while released"),
  "Shape 2K lifecycle (lazy alla selezione, rilascio quando inutilizzata) mancante");
assert(engine.includes('operation: "max"')
  && engine.includes("lightNoBuildUpPipeline")
  && engine.includes("grainLightNoBuildUpPipeline"),
  "Pipeline MAX coverage Light Glaze assenti.");
assert(!shaders.includes("unpack4x8unorm(pack4x8unorm(vec4<f32>(alpha)")
  && engine.includes("light-r16float-max-per-gesture-source-over-between-gestures")
  && engine.includes("m1-r16float-max-coverage-plus-composited-mips-single-commit")
  && engine.includes('format: "r16float"')
  && engine.includes("lightGlazeCompositeMipTexture")
  && engine.includes('storageMode === "r16float-coverage"'),
  "Semantica coverage R16F nativa M1 e mip compositati separati assenti.");
assert(engine.includes("session.tintLinear")
  && engine.includes('"light-no-build-up"'),
  "Tint per gesture e resolve Light Glaze non collegati.");
assert(shaders.includes("@group(0) @binding(5) var compositedMipTexture")
  && shaders.includes("logicalMip - 1.0")
  && shaders.includes("fn sampleCompositedActiveLogicalMip(")
  && engine.includes("lightGlazeMipDownsampleBindGroups[mipLevel - 2]"),
  "Catena mip compositata separata Light/M1 Glaze non collegata correttamente.");
assert(shaders.includes("fn storedLightCoverage(value: f32)")
  && shaders.includes("return clamp(value, 0.0, 1.0);"),
  "Lettura continua dell'accumulatore M1 R16F assente.");

let compositedMipPixels = 0;
for (let mipLevel = 1; mipLevel < 13; mipLevel += 1) {
  compositedMipPixels += Math.max(1, 4_096 >> mipLevel) ** 2;
}
const compositedRgba16MiB = compositedMipPixels * 8 / (1024 * 1024);
const m1Rgba16MiB = 32 + compositedRgba16MiB;
const highPrecisionRgba16MiB = 128 + compositedRgba16MiB + 8;
assert(Number(m1Rgba16MiB.toFixed(1)) === 74.7,
  `Memoria M1 R16F/RGBA16F ${m1Rgba16MiB.toFixed(1)} MiB, attesi 74.7.`);
assert(Number(highPrecisionRgba16MiB.toFixed(1)) === 178.7,
  `Memoria high-precision su RGBA16F ${highPrecisionRgba16MiB.toFixed(1)} MiB, attesi 178.7.`);
assert(Number((highPrecisionRgba16MiB - m1Rgba16MiB).toFixed(1)) === 104.0,
  "Delta high-precision vs M1 R16F/RGBA16F diverso da 104.0 MiB.");
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
  && main.includes('type HumanStrokeTestBlendMode = "light-glaze" | "uniformed-glaze" | "intense-blending"')
  && main.includes('blendIntensity: 1')
  && main.includes('humanStrokeTestGrainModeSelect.value === "texturized" ? "texturized" : "off"')
  && main.includes('canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4'),
  "Il replay iPhone non espone i tre rendering e la suite Base/Grain Off one-tap rev4.");
assert(html.includes('value="texturized">Texturized — Fixed')
  && html.includes('value="moving">Texturized — Moving'),
  "Le due impostazioni Grain non sono esposte nella UI.");
assert(html.includes('id="grainInvert" type="checkbox"')
  && main.includes('grainInvert: element<HTMLInputElement>("grainInvert").checked')
  && main.includes('element<HTMLInputElement>("grainInvert").checked = false'),
  "Il controllo Invert Grain o il default canonico Off non sono collegati.");
assert(html.includes('value="light-glaze">Light Glaze')
  && html.includes('value="uniformed-glaze">Uniformed Glaze')
  && html.includes('value="intense-blending">Intense Blending'),
  "I tre rendering finali non sono esposti nella UI.");
assert(html.includes('id="runRenderingModeSuite"')
  && html.includes('value="off">Off — senza texture')
  && html.includes('value="texturized">Texturized — Fixed (fisso)'),
  "La suite iPhone one-tap con Grain Off/Fixed non è esposta correttamente.");
assert(main.includes("performanceTelemetryRevision: 64"),
  "Revisione telemetria compositing livelli attesa assente.");

console.log(JSON.stringify({
  asset: path.relative(projectRoot, assetPath),
  sha256: assetSha256,
  width: decoded.width,
  height: decoded.height,
  format: "gray8-original",
  sourceBytes: decoded.bytes.length,
  mipDimensions: mip.dimensions,
  mipLevels: mip.levels,
  gpuMipBytes: mip.bytes,
  gpuMipMiB: mip.bytes / (1024 * 1024),
  grainUniformAbiBytes: grainUniformLayout.size,
  invariants: {
    pencilAssetUnmodified: true,
    webGpuWgslOnlyRenderingPath: true,
    fixedUsesLayerCoordinates: true,
    movingUsesScaledStampLocalCoordinates: true,
    movingScaleAppliesAtEveryMovement: true,
    movingUsesRepeatSampler: true,
    movingHundredPercentEqualsTexturizedCoordinates: true,
    movingPreviewShowsDragToRoller: true,
    invertUsesExistingAffineUniforms: true,
    iphoneReplayOffersOffOrFixedTexturized: true,
    iphoneReplayUsesThreeFinalRenderingsAtFixedIntensity1x: true,
    m1GlazeUsesR16FloatMaxCoverage: true,
    legacyLightGlazePreserved: true,
    canonicalReplayForcesGrainOff: true,
  },
}, null, 2));
