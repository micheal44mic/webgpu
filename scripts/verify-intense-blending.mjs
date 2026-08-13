import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = readEngineSource();
const main = read("../src/main.ts");
const humanLab = read("../src/labs/human-stroke-lab.ts");
const shaders = read("../src/shaders.ts");
const strokeRenderer = read("../src/stroke-renderer.ts");
const bevelRenderer = read("../src/bevel-renderer.ts");
const shadowRenderer = read("../src/shadow-renderer.ts");
const blendCore = read("../src/blend-core.ts");
const blendRenderer = read("../src/blend-renderer.ts");
const html = read("../index.html");
const sitesBuild = read("./prepare-sites-build.mjs");

assert.match(
  engine,
  /layerFormat: LayerFormat = "rgba16float";/,
  "Il default autorevole di BrushEngine deve essere RGBA16F.",
);
assert.doesNotMatch(html, /id="layerFormat"|data-layer-format-label/,
  "Un formato permanente non deve essere rappresentato come controllo UI.");
assert.doesNotMatch(
  main,
  /engine\.layerFormat\s*=/,
  "main non deve sovrascrivere il default autorevole di BrushEngine.",
);
assert.doesNotMatch(
  main,
  /if \(MOBILE_DEVICE_CLASS\) \{[\s\S]{0,200}(?:engine\.layerFormat|layerFormatSelect)/,
  "Il formato documento non deve dipendere dalla classe mobile.",
);
assert.doesNotMatch(
  engine,
  /\bsetLayerFormat\(/,
  "L'API di cambio formato irraggiungibile non deve rientrare nel motore.",
);

// Il motore è diviso in più moduli concatenati da `readEngineSource()`: un
// marcatore disallineato non deve più poter allargare la finestra a mezzo
// sorgente, altrimenti l'asserzione passa senza verificare più nulla.
const SECTION_MAXIMUM_BYTES = 40_000;
const section = (source, start, end, maximumBytes = SECTION_MAXIMUM_BYTES) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Sezione iniziale assente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Sezione finale assente: ${end}`);
  assert.ok(
    endIndex - startIndex <= maximumBytes,
    `Marcatore disallineato: la sezione ${start} → ${end} misura `
    + `${endIndex - startIndex} byte, oltre il limite di ${maximumBytes}.`,
  );
  return source.slice(startIndex, endIndex);
};

assert(engine.includes('| "intense-blending"'), "BlendMode non include Intense Blending.");
assert(
  engine.includes('"intense-physical-stamps-source-over-srgb-rgba16float-live-single-commit"'),
  "Strategy Intense encoded-sRGB live assente.",
);
assert(
  /export type LightGlazeStorageMode =[\s\S]{0,120}\| "r16float-coverage";/.test(engine)
    && engine.includes(': "rgba16float-stroke";')
    && engine.includes(': "rgba16float";'),
  "Light/Uniformed/Intense non dichiarano gli accumulatori autorevoli R16F/RGBA16F.",
);
// L'accumulatore e' full-document: il suo costo si deriva dalle dimensioni e
// dai byte per pixel della modalita', non da un numero cablato. Il `128` che
// stava qui era il costo a 4096² e faceva dichiarare al pannello `137,3 MiB`
// invece di `41,3` su un telefono a 2048².
assert(
  engine.includes("lightGlazeAccumulatorBytesPerPixel(storageMode)")
    && engine.includes('return storageMode === "r16float-coverage" ? 2 : 8;')
    && engine.includes(
      "(width * height * lightGlazeAccumulatorBytesPerPixel(storageMode)) / MEBIBYTE_BYTES",
    )
    && engine.includes('const commitTileMiB = storageMode === "rgba16float-stroke"'),
  "La contabilità non include accumulator R16F/RGBA16F full-document e scratch tile.",
);
assert(
  !/const accumulatorMiB = [\s\S]{0,200}: 128;/.test(engine),
  "L'accumulatore Light Glaze non deve tornare a un costo cablato.",
);

const glazeModeRouting = section(
  engine,
  "function isStrokeGlazeBlendMode",
  "function usesStrokeGlazeRenderer",
);
assert(
  glazeModeRouting.includes('mode === "intense-blending"'),
  "Intense non viene instradato nello storage per-stroke.",
);
assert(
  glazeModeRouting.includes("return INTENSE_BLENDING_STAMP_STRATEGY"),
  "La telemetria non firma la strategy Intense fisica.",
);

assert(!engine.includes("const usesIntenseBlending"), "È rimasto il vecchio carrier Intense.");
assert(!engine.includes('intenseBlending ? "blend"'), "Intense viene rinominato come Blend.");
const submit = section(
  engine,
  "private submitLightGlazeImmediate",
  "submitBlendImmediate",
  // Il routing di presentazione document-space dei blend di livello aggiunge
  // tre rami espliciti al submit live; il final-stack mip coerente aggiunge i
  // gate live/commit, ma la finestra resta stretta sui due marcatori.
  42_000,
);
for (const requirement of [
  'const intenseBlending = settings.blendMode === "intense-blending";',
  "opacity: intenseBlending ? settings.opacity : 1",
  "intenseBlending ? 1 : settings.opacity",
  '"encoded-srgb-source-over"',
  "stampCount * settings.count",
  "this.intenseBlendingPipeline",
  "this.intenseBlendingShapePipeline",
  "this.intenseBlendingShapeOccupancyPipeline",
  "this.grainIntenseBlendingPipeline",
  "this.grainIntenseBlendingShapePipeline",
  "this.grainIntenseBlendingShapeOccupancyPipeline",
]) {
  assert(submit.includes(requirement), `Percorso Intense incompleto: ${requirement}`);
}
assert(
  submit.includes('session.settings.blendMode === "uniformed-glaze"')
    && submit.includes('session.settings.blendMode === "intense-blending"')
    && submit.includes("LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES")
    && submit.includes("tilePass.setViewport(0, 0, tileWidth, tileHeight, 0, 1)")
    && submit.includes("[tileIndex * LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES]")
    && submit.includes("encoder.copyTextureToTexture(")
    && submit.includes("this.device.queue.writeBuffer(")
    && submit.includes("tileUniformUpload"),
  "Commit esatto Uniformed/Intense a tile con dynamic offset mancante.",
);
assert.equal(
  (submit.match(/this\.device\.queue\.writeBuffer\(\s*this\.lightGlazeCommitTileUniformBuffer/g) ?? []).length,
  1,
  "Il commit tile riscrive la stessa uniform durante l'encoding invece di fare un upload unico.",
);

const pipelineBlock = section(
  engine,
  "const createRgba16FloatGlazePipeline",
  "const createLightNoBuildUpPipeline",
);
assert(
  pipelineBlock.includes('format: "rgba16float"')
    && pipelineBlock.includes('srcFactor: "one"')
    && pipelineBlock.includes('dstFactor: "one-minus-src-alpha"'),
  "Pipeline high-precision source-over non configurata.",
);
for (const entryPoint of [
  '"encodedSrgbFragmentMain"',
  '"encodedSrgbShapeFragmentMain"',
  '"encodedSrgbShapeOccupancyFragmentMain"',
]) {
  assert(
    (pipelineBlock.match(new RegExp(entryPoint, "g")) ?? []).length >= 2,
    `Entry point Intense circle/shape/grain incompleto: ${entryPoint}`,
  );
}
for (const entryPoint of [
  "fn encodedSrgbFragmentMain",
  "fn encodedSrgbShapeFragmentMain",
  "fn encodedSrgbShapeOccupancyFragmentMain",
]) {
  assert(
    (shaders.match(new RegExp(entryPoint, "g")) ?? []).length === 2,
    `Shader encoded-sRGB deve esistere esattamente per brush e grain: ${entryPoint}`,
  );
}
assert(
  shaders.includes("return vec4<f32>(linearToSrgb(input.pointColor) * alpha, alpha);")
    && shaders.includes("lightGlaze.accumulationMode == 2u"),
  "Gli stamp Intense non vengono accumulati come premoltiplicato encoded-sRGB.",
);

for (const [label, source] of [
  ["display/mip/commit", shaders],
  ["Traccia", strokeRenderer],
  ["Smusso", bevelRenderer],
  ["Ombre", shadowRenderer],
]) {
  assert(
    source.includes("fn linearPremultipliedToEncodedSrgb")
      && source.includes("fn encodedSrgbPremultipliedToLinear")
      && source.includes("if (strokePaint.a <= 0.0)")
      && source.includes("return permanentPaint;")
      && source.includes("let extendedResidual = permanentPaint.rgb - boundedPermanentRgb;")
      && source.includes("vec4<f32>(boundedPermanentRgb, permanentAlpha)")
      && source.includes("let compositedEncoded = strokePaint + permanentEncoded * (1.0 - strokePaint.a);")
      && source.includes("let boundedResult = encodedSrgbPremultipliedToLinear(compositedEncoded);")
      && source.includes("boundedResult.rgb + extendedResidual * (1.0 - strokePaint.a)")
      && source.includes("vec3<f32>(-65504.0)")
      && source.includes("vec3<f32>(65504.0)"),
    `${label}: compositing Intense signed/HDR-safe incompleto.`,
  );
}
const fixedFunctionComposite = section(
  shaders,
  "export const lightGlazeCompositeShader",
  "export const layerCompositeShader",
);
assert(
  !fixedFunctionComposite.includes("resolvedEncodedSrgbStroke")
    && fixedFunctionComposite.includes("return vec4<f32>(0.0);")
    && fixedFunctionComposite.includes("must never use this fixed-function"),
  "Il compositore fixed-function conserva un branch Intense matematicamente invalido.",
);

assert(
  shaders.includes("export const lightGlazeCommitTileShader")
    && engine.includes("hasDynamicOffset: true")
    && engine.includes("minBindingSize: LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES")
    && engine.includes("LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES = 256")
    && engine.includes("LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT"),
  "Infrastruttura commit tile deterministica incompleta.",
);
const glazeAllocation = section(
  engine,
  "ensureLightGlazeResources(blendMode: BlendMode)",
  "  startLightGlazeSession(historyActionId: number",
);
assert(
  glazeAllocation.includes("this.lightGlazeDesiredStorageMode = storageMode;")
    && glazeAllocation.includes("this.lightGlazeLoadingStorageMode")
    && glazeAllocation.includes("`Retarget rendering glaze ${storageMode}`")
    && glazeAllocation.includes("`Ripristino rendering glaze ${previous.storageMode}`")
    && glazeAllocation.includes("currentLightGlazeResourceSet(this)")
    && glazeAllocation.includes("applyLightGlazeResourceSet(this, previous)")
    && glazeAllocation.includes("destroyLightGlazeResourceSet(resources)"),
  "Transazione/rollback/latest-only dello storage glaze incompleti.",
);
assert(
  engine.includes("this.lightGlazeLoadingPromise !== null")
    && engine.includes("Rendering glaze in preparazione: riprova tra un istante"),
  "Un tratto può ancora partire durante un retarget glaze in volo.",
);
assert(
  engine.includes("while (this.lightGlazeLoadingPromise)")
    && engine.includes("await engine.ensureLightGlazeResources(batch.settings.blendMode);")
    && engine.includes("Rendering glaze in preparazione: riprova tra un istante"),
  "Prewarm/attesa delle risorse glaze asincrone incompleta.",
);
assert(
  submit.includes('label: "Accumulate Light Glaze stroke"')
    && submit.includes("if (session.needsClear)")
    && submit.includes("this.lightGlazeStaleRect")
    && submit.includes("this.lightGlazeClearRgba16FloatPipeline")
    && submit.includes("lightGlazeClearEncoded = true")
    && submit.indexOf("session.needsClear = false")
      > submit.indexOf("this.device.queue.submit([encoder.finish()])")
    && !submit.includes('label: "Clear previous glaze stroke dirty region"')
    && !submit.includes('loadOp: session.needsClear ? "clear" : "load"'),
  "Il dirty-clear non è scissored nello stesso pass degli stamp o viene committato prima del submit.",
);
assert(
  engine.includes("floats[14] = 1;")
    && !engine.includes("floats[14] = settings.blendIntensity;")
    && !engine.includes("candidateSettings.blendIntensity"),
  "Blend Intensity legacy non è completamente inerte nel rendering e nella preview.",
);
assert(
  sitesBuild.includes("const HUMAN_STROKE_PRESET_REVISION = 4;")
    && sitesBuild.includes("payload.settings.blendIntensity === 1")
    && sitesBuild.includes("blendIntensity: 1,"),
  "Il payload canonico Sites conserva ancora la vecchia intensità 4×.",
);

assert(
  shaders.includes("random01(copySeed, 5u)")
    && shaders.includes("random01(copySeed, 6u)")
    && shaders.includes("random01(copySeed, 7u)"),
  "Jitter laterale/lineare o scatter Shape assente dal percorso fisico.",
);

assert(
  humanLab.includes("countedTotalTransitionPeakMiB")
    && humanLab.includes("lightGlazeTransitionPeakMiB")
    && humanLab.includes("countedTotalSteadyMiB"),
  "La suite confonde ancora memoria stabile e picco transitorio old+new.",
);
assert(
  humanLab.includes("HUMAN_RENDERING_SUITE_REVISION = 4 as const")
    && humanLab.includes('strategy: "canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4"')
    && humanLab.includes('CANONICAL_HUMAN_STROKE_FINGERPRINT = "18982412"')
    && humanLab.includes("CANONICAL_HUMAN_STROKE_POINT_COUNT = 1_583"),
  "Suite iPhone canonica one-tap rev3 assente.",
);
for (const id of [
  "light-base-grain-off",
  "uniformed-base-grain-off",
  "intense-base-grain-off",
]) {
  assert(humanLab.includes(`"${id}"`), `Caso suite mancante: ${id}`);
}
for (const setting of [
  "size: 750",
  "spacingPercent: 1",
  "count: 16",
  "flow: 1",
  "opacity: 1",
  "hardness: 1",
]) {
  assert(humanLab.includes(setting), `Preset canonico incompleto: ${setting}`);
}
assert(
  humanLab.includes('renderingStorageMiB = blendMode === "light-glaze"')
    && humanLab.includes('|| blendMode === "intense-blending"'),
  "Il report suite non distingue R16F da RGBA16F.",
);
assert(
  html.includes("Rendering · Light R16F / Uniformed e Intense RGBA16F")
    && html.includes("Blend dry · scratch")
    && !html.includes("Intense Blending · scratch"),
  "UI suite o memoria rendering non coerente.",
);
assert(
  !blendCore.includes("INTENSE_BLENDING")
    && !blendRenderer.includes('blendMode === "intense-blending"'),
  "Il vecchio esperimento carrier Intense altera ancora il Blend dry.",
);
const sourceOverByte = (sourceByte, count) => Math.round(
  255 * (1 - (1 - sourceByte / 255) ** count),
);
const measuredPlateaus = [46, 84, 115, 140, 161, 178, 192];
assert.deepEqual(
  measuredPlateaus.map((_, index) => sourceOverByte(46, index + 1)),
  measuredPlateaus,
  "La ricorrenza source-over non riproduce i plateau Procreate misurati.",
);

const flow = 0.5;
const opacity = 0.5;
const overlaps = 4;
const intenseAlpha = 1 - (1 - flow * opacity) ** overlaps;
const uniformedAlpha = opacity * (1 - (1 - flow) ** overlaps);
assert.equal(intenseAlpha, 0.68359375);
assert.equal(uniformedAlpha, 0.46875);
assert(intenseAlpha > uniformedAlpha, "Intense e Uniformed hanno perso Opacity distinta.");
assert(
  1 - (1 - 0.5) ** 16 > 0.99998,
  "Flow 50% non converge alla piena opacità con overlap sufficienti.",
);

const paintAlphaBodies = [...shaders.matchAll(
  /fn paintAlpha\(input: (?:VertexOutput|FragmentInput), coverage: f32\) -> f32 \{([\s\S]*?)\n\}/g,
)].map((match) => match[1]);
assert.equal(
  paintAlphaBodies.length,
  2,
  "I due percorsi Shape/base devono condividere un contratto alpha verificabile.",
);
for (const body of paintAlphaBodies) {
  assert.match(
    body,
    /coverage\s*\*\s*brush\.controls\.x\s*\*\s*brush\.baseHslAlpha\.w\s*\*\s*brush\.controls\.z/,
    "L'alpha deve dipendere solo da mask, Flow, Opacity e guadagno del timbro.",
  );
  assert.doesNotMatch(
    body,
    /pointColor|\.rgb|linearToSrgb/,
    "Il colore selezionato non deve alterare l'alpha del timbro.",
  );
}

const stampSourceOver = (colorByte, maskByte, stampFlow, stampOpacity) => {
  const alpha = Math.min(0.999999, Math.max(
    0,
    (maskByte / 255) * stampFlow * stampOpacity,
  ));
  return {
    premultipliedColor: (colorByte / 255) * alpha,
    alpha,
  };
};
const darkFlow100 = stampSourceOver(0x33, 128, 1, 1);
const lightFlow100 = stampSourceOver(0xdd, 128, 1, 1);
assert.equal(
  darkFlow100.alpha,
  lightFlow100.alpha,
  "Flow 100% deve produrre lo stesso alpha per #333333 e #dddddd a parità di Shape.",
);
assert.notEqual(
  darkFlow100.premultipliedColor,
  lightFlow100.premultipliedColor,
  "Il colore deve cambiare solo il canale RGB premoltiplicato, non la copertura.",
);

const linearToSrgb = (value) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;
const srgbToLinear = (value) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const compositeIntenseExtended = (permanent, stroke) => {
  if (stroke[3] <= 0) return [...permanent];
  const permanentAlpha = clamp01(permanent[3]);
  const boundedPermanent = permanent.slice(0, 3).map((value) => (
    permanentAlpha > 0 ? clamp01(value / permanentAlpha) * permanentAlpha : 0
  ));
  const residual = permanent.slice(0, 3).map(
    (value, index) => value - boundedPermanent[index],
  );
  const permanentEncoded = boundedPermanent.map((value) => (
    permanentAlpha > 0 ? linearToSrgb(value / permanentAlpha) * permanentAlpha : 0
  ));
  const inverseStrokeAlpha = 1 - stroke[3];
  const compositedAlpha = stroke[3] + permanentAlpha * inverseStrokeAlpha;
  const compositedEncoded = permanentEncoded.map(
    (value, index) => stroke[index] + value * inverseStrokeAlpha,
  );
  const boundedResult = compositedEncoded.map((value) => (
    compositedAlpha > 0 ? srgbToLinear(clamp01(value / compositedAlpha)) * compositedAlpha : 0
  ));
  return [
    ...boundedResult.map(
      (value, index) => value + residual[index] * inverseStrokeAlpha,
    ),
    compositedAlpha,
  ];
};
const extendedPermanent = [-0.25, 1.25, 0.4, 1];
assert.deepEqual(
  compositeIntenseExtended(extendedPermanent, [0, 0, 0, 0]),
  extendedPermanent,
  "Intense deve essere identico sui pixel senza copertura, inclusi RGB signed/HDR.",
);
const partialExtendedComposite = compositeIntenseExtended(
  extendedPermanent,
  [0.25, 0, 0, 0.25],
);
assert(
  partialExtendedComposite[0] < 0 && partialExtendedComposite[1] > 0.5,
  "Il residuo signed/HDR del permanente non sopravvive sotto una copertura parziale.",
);
assert.equal(
  partialExtendedComposite[3],
  1,
  "La preservazione HDR non deve cambiare la legge alpha source-over.",
);
const encodedWhiteOverBlackByte = Math.round(0.5 * 255);
const linearWhiteOverBlackByte = Math.round(linearToSrgb(0.5) * 255);
assert.equal(encodedWhiteOverBlackByte, 128);
assert.equal(linearWhiteOverBlackByte, 188);
assert.notEqual(
  encodedWhiteOverBlackByte,
  linearWhiteOverBlackByte,
  "Il discriminante encoded-sRGB/lineare non separa i due modelli.",
);
assert.deepEqual(
  [Math.round(0.5 * 255), Math.round(0.5 * 255), 0],
  [128, 128, 0],
  "Rosso 50% su verde non produce il discriminante sRGB atteso.",
);

console.log("Intense dry verification passed.");
