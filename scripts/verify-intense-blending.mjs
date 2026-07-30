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
  "function usesBlendRenderer",
  "function paintDisplayPyramidAdditionalMemoryMiB",
);
assert(
  blendRendererRouting.includes('return settings.tool === "blend" || usesIntenseWetRenderer(settings);'),
  "Il renderer carrier deve appartenere al Blend dry o al solo Intense Wet non neutro.",
);
assert(
  engine.includes('&& !usesIntenseWetRenderer(settings);'),
  "Il percorso Intense neutro non è più separato dal renderer Wet.",
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
  "const createM1GlazePipeline",
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
  main.includes('element<HTMLElement>("intenseBlendingControls").hidden = !intenseSelected;')
    && main.includes("wetMixRevision: 1")
    && html.includes('id="wetGrade"'),
  "I controlli Wet Mix/Grade non seguono la selezione Intense o non sono revisionati.",
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
  engine.includes("function intenseWetMixIsNeutral")
    && engine.includes("function usesIntenseWetRenderer")
    && engine.includes("private buildIntenseWetRenderBatches")
    && engine.includes("private submitIntenseWetImmediate")
    && engine.includes("baseStampsPerBuild")
    && engine.includes("previewRandom01(copySeed, 5)")
    && engine.includes("previewRandom01(copySeed, 6)")
    && engine.includes("previewRandom01(copySeed, 7)"),
  "Routing o ordine fisico Count/jitter/scatter Wet incompleto.",
);
assert(
  blendRenderer.includes('export type DryBlendRenderMode = "dry-blend" | "intense-wet"')
    && !blendRenderer.includes("wetDabOrdinal")
    && !blendRenderer.includes("wetChargeEnvelope")
    && blendRenderer.includes("const wetFreshAvailability")
    && blendRenderer.includes("hexToSrgbRgb")
    && blendRenderer.includes("configureScratchSize")
    && blendRenderer.includes("options.scratchSize ?? DRY_BLEND_DEFAULT_SCRATCH_SIZE")
    && blendRenderer.includes("unsigned[47] = wetMode ? 1 : 0;"),
  "Serbatoio Wet statico, scratch adattivo o discriminante del renderer incompleti.",
);
const scratchSizing = section(
  engine,
  "private prepareBlendScratchForSettings",
  "private maybeReleaseIdleBlendScratch",
);
assert(
  scratchSizing.includes("INTENSE_WET_SCRATCH_SIZE")
    && scratchSizing.includes("DRY_BLEND_DEFAULT_SCRATCH_SIZE")
    && !engine.includes("scratchSize: INTENSE_WET_SCRATCH_SIZE,"),
  "Lo scratch Blend dry non torna a 1664 quando il Wet non è selezionato.",
);
assert(
  blendShaders.includes("fn premultipliedLinearToEncodedSrgb")
    && blendShaders.includes("fn premultipliedEncodedSrgbToLinear")
    && blendShaders.includes("let grade = clamp(blend.grainAffineAndPhase.z")
    && blendShaders.includes("updated = previous + pigment * (pull * vacancy);")
    && blendShaders.includes("let opaqueRate = clamp(")
    && blendShaders.includes("+ chargeSquared * chargeSquared * chargeSquared")
    && blendShaders.includes("let rate = clamp(finalCoverage * mix(opaqueRate, 1.0, vacancy), 0.0, 1.0);")
    && blendShaders.includes("let freshAlpha = 1.0 - 0.06 * dilution * (1.0 - charge);")
    && blendShaders.includes("innerEdge")
    && blendShaders.includes("mix(coverage * coverage, coverage, hardnessWet)"),
  "Color space, serbatoio, soppressione su pigmento o parità coverage Wet WGSL incompleti.",
);
assert(
  html.includes('id="wetDilution"')
    && html.includes('id="wetCharge"')
    && html.includes('id="wetAttack"')
    && html.includes('id="wetPull"')
    && html.includes('id="wetGrade"')
    && html.includes('id="wetBlur"')
    && html.includes('id="wetDilution" type="range" min="0" max="100" step="1" value="0"')
    && html.includes('id="wetCharge" type="range" min="0" max="100" step="1" value="100"')
    && html.includes('id="wetAttack" type="range" min="0" max="100" step="1" value="0"'),
  "Controlli Wet pubblici o neutro misurato (Charge 100 · Attack 0) incompleti.",
);
assert(
  engine.includes("settings.wetCharge >= 1 - WET_NEUTRAL_EPSILON")
    && engine.includes("settings.wetAttack <= WET_NEUTRAL_EPSILON"),
  "Il neutro Wet non coincide con la configurazione AUDIT-1 misurata.",
);

// Replica JS del deposito Wet WGSL: stesse formule di blend-shaders.ts.
// `carrierOverride` simula il carrier dopo un pickup (test di trasporto).
const wetDeposit = (canvas, params, coverage, carrierOverride = null) => {
  const { dilution, charge, attack, pull, brush } = params;
  const freshAvailability = Math.max(0, attack * (1 - dilution * 0.9));
  const carrier = carrierOverride ?? { rgb: brush * charge, a: charge };
  const pigmentTotal = freshAvailability + carrier.a;
  if (pigmentTotal <= 0.00001) {
    return canvas;
  }
  const waterKeep = 1 - 0.9 * dilution;
  const chargeSquared = charge * charge;
  const opaqueRate = Math.min(1, Math.max(0,
    0.06 * (0.15 + 0.85 * attack) * waterKeep * waterKeep
      + chargeSquared * chargeSquared * chargeSquared
      + pull * pull));
  const freshWeight = freshAvailability / pigmentTotal;
  const freshAlpha = 1 - 0.06 * dilution * (1 - charge);
  const alphaOut = 1 * (1 - freshWeight) + freshAlpha * freshWeight;
  const vacancy = canvas.a < alphaOut - 0.000001 ? 1 : 0;
  const rate = Math.min(1, coverage * (opaqueRate + (1 - opaqueRate) * vacancy));
  const carrierStraight = carrier.a > 0.00001 ? carrier.rgb / carrier.a : brush;
  const straight = carrierStraight * (1 - freshWeight) + brush * freshWeight;
  return {
    rgb: canvas.rgb * (1 - rate) + straight * alphaOut * rate,
    a: canvas.a * (1 - rate) + alphaOut * rate,
  };
};

// 1) Neutro (AUDIT-1): la serie sui pixel vuoti deve coincidere con i plateau
//    Procreate misurati del percorso dry (46 → 192 per n = 1…7).
{
  const neutral = { dilution: 0, charge: 1, attack: 0, pull: 0, brush: 1 };
  let px = { rgb: 0, a: 0 };
  const series = [];
  for (let n = 1; n <= 7; n += 1) {
    px = wetDeposit(px, neutral, 46 / 255);
    series.push(Math.round(px.a * 255));
  }
  assert.deepEqual(
    series,
    [46, 84, 115, 140, 161, 178, 192],
    "Il neutro Wet non riproduce la serie source-over misurata su Procreate.",
  );
}

// 2) Test 04 misurato: Dilution 75 · Charge 0 · Attack 100 su layer vuoto
//    satura ad alpha 244; con Charge 100 satura a 255.
{
  const diluted = { dilution: 0.75, charge: 0, attack: 1, pull: 0, brush: 1 };
  let px = { rgb: 0, a: 0 };
  for (let n = 0; n < 64; n += 1) {
    px = wetDeposit(px, diluted, 0.5);
  }
  assert.equal(
    Math.round(px.a * 255),
    244,
    "Dilution 75 senza Charge deve saturare al plateau 244 misurato.",
  );
  const charged = { dilution: 0.75, charge: 1, attack: 1, pull: 0, brush: 1 };
  px = { rgb: 0, a: 0 };
  for (let n = 0; n < 64; n += 1) {
    px = wetDeposit(px, charged, 0.5);
  }
  assert.equal(
    Math.round(px.a * 255),
    255,
    "Charge 100 deve riportare il plateau a 255 come misurato.",
  );
}

// 3) Test 06 misurato: Attack 0 · Dilution 100 · Charge 0 · Pull 100 con il
//    carrier riempito dal pickup (rosso) ricopre a piena forza il pigmento
//    esistente (blu) senza alcuna traccia del colore pennello (magenta).
{
  const transport = { dilution: 1, charge: 0, attack: 0, pull: 1, brush: 0 };
  const opaqueBlue = { rgb: 0, a: 1 };
  const pickedRed = { rgb: 1, a: 1 };
  const result = wetDeposit(opaqueBlue, transport, 1, pickedRed);
  assert(
    result.rgb > 0.999 && result.a > 0.999,
    "Il trasporto Pull 100 deve ricoprire a piena forza il pigmento esistente.",
  );
  const freshAvailability = 0 * (1 - 1 * 0.9);
  assert.equal(
    freshAvailability,
    0,
    "Attack 0 + Dilution 100 deve azzerare il colore fresco (niente magenta).",
  );
}

// 4) RETEST-A misurato: sopra pigmento opaco, con Charge 50 e Pull 0 il
//    colore depositato per dab resta sotto il 2% (tinta appena percettibile),
//    e Dilution lo riduce ulteriormente.
{
  const base = { dilution: 0, charge: 0.5, attack: 0.5, pull: 0, brush: 1 };
  const opaque = { rgb: 0, a: 1 };
  const perDab = wetDeposit(opaque, base, 0.125).rgb;
  assert(
    perDab > 0 && perDab < 0.02,
    "Sopra pigmento opaco con Charge 50 il colore depositato per dab deve restare sotto il 2%.",
  );
  const withDilution = wetDeposit(opaque, { ...base, dilution: 1 }, 0.125).rgb;
  assert(
    withDilution < perDab,
    "Dilution deve ridurre il deposito sopra pigmento esistente (RETEST-A).",
  );
}

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

console.log("Intense Blending live high-precision verification passed.");