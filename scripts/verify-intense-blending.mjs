import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = read("../src/brush-engine.ts");
const main = read("../src/main.ts");
const shaders = read("../src/shaders.ts");
const strokeRenderer = read("../src/stroke-renderer.ts");
const bevelRenderer = read("../src/bevel-renderer.ts");
const shadowRenderer = read("../src/shadow-renderer.ts");
const blendCore = read("../src/blend-core.ts");
const blendRenderer = read("../src/blend-renderer.ts");
const blendShaders = read("../src/blend-shaders.ts");
const wetMix = read("../src/wet-mix.ts");
const html = read("../index.html");
const sitesBuild = read("./prepare-sites-build.mjs");

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Sezione iniziale assente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Sezione finale assente: ${end}`);
  return source.slice(startIndex, endIndex);
};

assert(engine.includes('| "intense-blending"'), "BlendMode non include Intense Blending.");
assert(
  engine.includes('"intense-physical-stamps-source-over-srgb-rgba16float-live-single-commit"'),
  "Strategy Intense encoded-sRGB live assente.",
);
assert(
  engine.includes('export type LightGlazeStorageMode = "none" | "rgba16float-stroke" | "r8-coverage"')
    && engine.includes(': "rgba16float-stroke";')
    && engine.includes(': "rgba16float";'),
  "Uniformed/Intense non usano l'accumulatore autorevole RGBA16F.",
);
assert(
  engine.includes('const accumulatorMiB = storageMode === "r8-coverage"')
    && engine.includes(': 128;')
    && engine.includes('const commitTileMiB = storageMode === "rgba16float-stroke"'),
  "La contabilità non include accumulator RGBA16F e scratch tile.",
);

const glazeModeRouting = section(
  engine,
  "function isStrokeGlazeBlendMode",
  "function usesBlendRenderer",
);
assert(
  glazeModeRouting.includes('mode === "intense-blending"'),
  "Intense non viene instradato nello storage per-stroke.",
);
assert(
  glazeModeRouting.includes("return INTENSE_BLENDING_STAMP_STRATEGY"),
  "La telemetria non firma la strategy Intense fisica.",
);

const blendRendererRouting = section(
  engine,
  "function usesRuwaWetRenderer",
  "function paintDisplayPyramidAdditionalMemoryMiB",
);
assert(
  blendRendererRouting.includes('settings.blendMode === "uniformed-glaze"')
    && blendRendererRouting.includes('settings.blendMode === "intense-blending"')
    && blendRendererRouting.includes("settings.wetMixEnabled")
    && blendRendererRouting.includes("RUWA_WET_MIX_REVISION")
    && blendRendererRouting.includes('return settings.tool === "blend" || usesRuwaWetRenderer(settings);'),
  "Il Wet Ruwa non è instradato in Uniformed e Intense con un gate esplicito.",
);
assert(
  engine.includes("&& !usesRuwaWetRenderer(settings);"),
  "Il percorso dry non è separato dal renderer Wet Ruwa.",
);
assert(!engine.includes("const usesIntenseBlending"), "È rimasto il vecchio carrier Intense.");
assert(!engine.includes('intenseBlending ? "blend"'), "Intense viene rinominato come Blend.");
const submit = section(
  engine,
  "private submitLightGlazeImmediate",
  "private submitBlendImmediate",
);
for (const requirement of [
  'const intenseBlending = settings.blendMode === "intense-blending";',
  "opacity: intenseBlending ? settings.opacity : 1",
  "intenseBlending ? 1 : settings.opacity",
  '"encoded-srgb-source-over"',
  "stamps.length * settings.count",
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
      && source.includes("let permanentEncoded = linearPremultipliedToEncodedSrgb(permanentPaint);")
      && source.includes("let compositedEncoded = strokePaint + permanentEncoded * (1.0 - strokePaint.a);")
      && source.includes("encodedSrgbPremultipliedToLinear(compositedEncoded)"),
    `${label}: compositing Intense completo in encoded-sRGB mancante.`,
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
  "private ensureLightGlazeResources",
  "private destroyLightGlazeResources",
);
assert(
  glazeAllocation.includes("this.lightGlazeDesiredStorageMode = storageMode;")
    && glazeAllocation.includes("this.lightGlazeLoadingStorageMode")
    && glazeAllocation.includes("`Retarget rendering glaze ${storageMode}`")
    && glazeAllocation.includes("`Ripristino rendering glaze ${previous.storageMode}`")
    && glazeAllocation.includes("this.currentLightGlazeResourceSet()")
    && glazeAllocation.includes("this.applyLightGlazeResourceSet(previous)")
    && glazeAllocation.includes("this.destroyLightGlazeResourceSet(resources)"),
  "Transazione/rollback/latest-only dello storage glaze incompleti.",
);
assert(
  engine.includes("this.lightGlazeLoadingPromise !== null")
    && engine.includes("Rendering glaze in preparazione: riprova tra un istante"),
  "Un tratto può ancora partire durante un retarget glaze in volo.",
);
assert(
  engine.includes("while (this.lightGlazeLoadingPromise)")
    && engine.includes("await this.ensureLightGlazeResources(batch.settings.blendMode);")
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
  main.includes("countedTotalTransitionPeakMiB")
    && main.includes("lightGlazeTransitionPeakMiB")
    && main.includes("countedTotalSteadyMiB")
    && main.includes("picco transizione"),
  "La suite confonde ancora memoria stabile e picco transitorio old+new.",
);
assert(
  main.includes("const RENDERING_MODE_SUITE_REVISION = 4 as const")
    && main.includes('strategy: "canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4"')
    && main.includes('const CANONICAL_HUMAN_STROKE_FINGERPRINT = "18982412";')
    && main.includes("const CANONICAL_HUMAN_STROKE_POINT_COUNT = 1_583;"),
  "Suite iPhone canonica one-tap rev3 assente.",
);
for (const id of [
  "light-base-grain-off",
  "uniformed-base-grain-off",
  "intense-base-grain-off",
]) {
  assert(main.includes(`id: "${id}"`), `Caso suite mancante: ${id}`);
}
for (const setting of [
  "size: 750",
  "spacingPercent: 1",
  "count: 16",
  "flow: 1",
  "opacity: 1",
  "hardness: 1",
]) {
  assert(main.includes(setting), `Preset canonico incompleto: ${setting}`);
}
assert(
  main.includes('storageClass: result.run.benchmark.testBlendMode === "light-glaze"')
    && main.includes(': "rgba16float-stroke"'),
  "Il report suite non distingue R8 da RGBA16F.",
);
assert(
  html.includes("Confronta 3 rendering · Base 1% · 1 tap")
    && html.includes("Rendering · Light / Uniformed / Intense")
    && html.includes("Blend / Wet Mix · scratch")
    && !html.includes("Intense Blending · scratch"),
  "UI suite o memoria rendering non coerente.",
);
assert(
  !blendCore.includes("INTENSE_BLENDING")
    && !blendRenderer.includes('blendMode === "intense-blending"')
    && !blendShaders.includes("mixWetSrgb"),
  "Il vecchio esperimento carrier Intense altera ancora il Blend dry.",
);
assert(
  engine.includes("function usesRuwaWetRenderer")
    && engine.includes("private buildRuwaWetRenderBatches")
    && engine.includes("private submitRuwaWetImmediate")
    && engine.includes("baseStampsPerBuild")
    && engine.includes("reservoirTrackId: copyIndex")
    && engine.includes("previewRandom01(copySeed, 5)")
    && engine.includes("previewRandom01(copySeed, 6)")
    && engine.includes("previewRandom01(copySeed, 7)"),
  "Routing o ordine fisico Count/jitter/scatter Wet Ruwa incompleto.",
);
assert(
  blendRenderer.includes('export type DryBlendRenderMode = "dry-blend" | "ruwa-wet"')
    && blendRenderer.includes("RUWA_WET_RESERVOIR_GRID_SIZE = 32")
    && blendRenderer.includes("RUWA_WET_RESERVOIR_TRACK_COUNT = 24")
    && blendRenderer.includes("wetReservoirBuffer")
    && blendRenderer.includes("ruwaWetRatePerDab")
    && blendRenderer.includes("ruwaWetBuildupCoatPerDab")
    && blendRenderer.includes("configureScratchSize")
    && blendRenderer.includes("unsigned[47] = wetMode ? 1 : 0;"),
  "Serbatoio spaziale, normalizzazione per distanza o scratch adattivo incompleti.",
);
const scratchSizing = section(
  engine,
  "private prepareBlendScratchForSettings",
  "private maybeReleaseIdleBlendScratch",
);
assert(
  scratchSizing.includes("RUWA_WET_SCRATCH_SIZE")
    && scratchSizing.includes("DRY_BLEND_DEFAULT_SCRATCH_SIZE")
    && !engine.includes("scratchSize: RUWA_WET_SCRATCH_SIZE,"),
  "Lo scratch Blend dry non torna a 1664 quando il Wet non è selezionato.",
);
assert(
  blendShaders.includes("fn premultipliedLinearToEncodedSrgb")
    && blendShaders.includes("fn premultipliedEncodedSrgbToLinear")
    && blendShaders.includes("fn sampleReservoir")
    && blendShaders.includes("fn sampleWetReservoir")
    && blendShaders.includes("previousDocumentLocal = local + localTravel")
    && blendShaders.includes("let canvasWeight = exchangeCoverage")
    && blendShaders.includes("let advectedWeight = remainder * advection")
    && blendShaders.includes("let coatPerDab = blend.grainControls.y")
    && blendShaders.includes("mix(coverage * coverage, coverage, hardnessWet)"),
  "Color space, reservoir/advezione, Buildup o coverage Wet WGSL incompleti.",
);
for (const id of [
  "wetBlending",
  "wetDilution",
  "wetSpread",
  "wetLength",
  "wetFlow",
  "wetBuildup",
  "wetDrying",
]) {
  assert(html.includes(`id="${id}"`), `Controllo Wet pubblico mancante: ${id}`);
}
for (const preset of ["ruwa-wet-1", "ruwa-wet-2", "ruwa-wet-3"]) {
  assert(html.includes(`value="${preset}"`), `Preset Wet pubblico mancante: ${preset}`);
  assert(wetMix.includes(`"${preset}": Object.freeze({`), `Valori preset mancanti: ${preset}`);
}
assert(
  wetMix.includes("wetBlending: 1,")
    && wetMix.includes("wetSpread: 0.3,")
    && wetMix.includes("wetLength: 0.62,")
    && wetMix.includes("wetSpread: 0.41,")
    && wetMix.includes("wetLength: 0.25,")
    && wetMix.includes("wetBlending: 0.27,")
    && wetMix.includes("wetSpread: 0.26,")
    && wetMix.includes("wetLength: 0.78,")
    && wetMix.includes("wetFlow: 0.75,"),
  "I tre preset Ruwa non conservano i sette valori pubblicati.",
);
assert(
  main.includes('element<HTMLElement>("wetMixControls").hidden = !wetAvailable;')
    && main.includes('renderingMode === "uniformed-glaze" || renderingMode === "intense-blending"')
    && main.includes('setControlValue("wetPreset", "custom")')
    && main.includes("wetPresetParameters(presetId)")
    && main.includes("wetMixRevision: RUWA_WET_MIX_REVISION"),
  "UI Wet, preset atomici o passaggio automatico a Personalizzato incompleti.",
);
assert(
  !html.includes('id="wetCharge"')
    && !html.includes('id="wetAttack"')
    && !html.includes('id="wetPull"')
    && !html.includes('id="wetGrade"')
    && !html.includes('id="wetBlur"'),
  "Sono rimasti controlli del vecchio modello Procreate.",
);

const wetRatePerDab = (rate, distance, radius) => {
  if (rate <= 0) return 0;
  if (rate >= 1) return 1;
  const travel = Math.min(Math.max(0, distance) / Math.max(0.5 * radius, 1), 16);
  return 1 - (1 - rate) ** travel;
};
assert.equal(wetRatePerDab(0.5, 0, 100), 0, "Un dab fermo non deve accumulare Wet.");
assert.equal(wetRatePerDab(0.5, 50, 100), 0.5, "La rate per mezzo raggio è errata.");
assert.equal(wetRatePerDab(0.5, 100, 100), 0.75, "La rate non è stabile sulla distanza.");
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

const linearToSrgb = (value) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;
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

console.log("Intense dry + Ruwa Wet spatial reservoir verification passed.");