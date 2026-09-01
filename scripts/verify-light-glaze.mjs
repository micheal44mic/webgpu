import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { readEngineSource } from "./engine-source.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = readEngineSource();
const shaders = read("../src/shaders.ts");
const html = read("../index.html");
const mixedSceneActivePaint = read("../src/mixed-scene-active-paint-resources.ts");

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Sezione iniziale assente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Sezione finale assente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const closeTo = (actual, expected, epsilon = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Atteso ${expected}, ricevuto ${actual}`,
  );
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const accumulateInsideGesture = (current, candidate) => (
  Math.max(clamp01(current), clamp01(candidate))
);
const sourceOverGesture = (destination, gesture) => {
  const source = clamp01(gesture);
  return source + clamp01(destination) * (1 - source);
};

for (const deposit of [0, 0.08, 0.25, 0.5, 0.73, 1]) {
  let gesture = 0;
  for (let index = 0; index < 4096; index += 1) {
    gesture = accumulateInsideGesture(gesture, deposit);
  }
  closeTo(gesture, deposit);
}

let varyingGesture = 0;
for (const candidate of [0.12, 0.31, 0.18, 0.72, 0.44]) {
  varyingGesture = accumulateInsideGesture(varyingGesture, candidate);
}
closeTo(varyingGesture, 0.72);

const oneGesture = 0.25;
const twoGestures = sourceOverGesture(oneGesture, oneGesture);
closeTo(twoGestures, 0.4375);
assert.ok(twoGestures > oneGesture, "Una gesture successiva deve potersi accumulare.");
closeTo(sourceOverGesture(0, 1), 1);
closeTo(sourceOverGesture(1, 1), 1);

assert(
  engine.includes('"light-r16float-max-per-gesture-source-over-between-gestures"'),
  "Firma pubblica Light Glaze no-build-up assente.",
);

const modeRouting = section(
  engine,
  "function lightGlazeStrategyForBlendMode",
  "function usesStrokeGlazeRenderer",
);
assert.match(
  modeRouting,
  /if \(mode === "light-glaze"\) \{\s*return LIGHT_GLAZE_STRATEGY;/,
  "Light Glaze pubblico non ha una strategy distinta dal vecchio alias M1.",
);
assert.match(
  modeRouting,
  /return mode === "m1-glaze"\s*\? M1_GLAZE_STRATEGY\s*:\s*UNIFORMED_GLAZE_STRATEGY;/,
  "Routing legacy/uniformed non è esplicito.",
);

const storageRouting = section(
  engine,
  "export function lightGlazeStorageModeFor",
  "export function isTexturizedGrainActive",
);
assert.match(
  storageRouting,
  /blendMode === "light-glaze" \|\| blendMode === "m1-glaze"\s*\? "r16float-coverage"/,
  "Light Glaze non usa l'accumulatore coverage R16F isolato per gesture.",
);

const baseMaxPipeline = section(
  engine,
  "const createLightNoBuildUpPipeline",
  "const selectionPipelineByBase",
);
assert.equal(
  (baseMaxPipeline.match(/operation: "max"/g) ?? []).length,
  2,
  "L'accumulatore Light base deve usare MAX per colore e alpha.",
);
assert.doesNotMatch(
  baseMaxPipeline,
  /one-minus-src-alpha/,
  "Gli stamp base della stessa gesture non devono usare source-over.",
);
assert.match(baseMaxPipeline, /format: "r16float"/);
assert.doesNotMatch(baseMaxPipeline, /format: "r8unorm"/);
assert.match(baseMaxPipeline, /Light Glaze circle MAX per gesture r16float/);
assert.match(baseMaxPipeline, /Light Glaze Texturized circle MAX per gesture r16float/);

const selectionMaxPipeline = section(
  engine,
  "const selectionPipelineByBase",
  "const lightGlazeCompositeMipPipeline",
);
assert.equal(
  (selectionMaxPipeline.match(/operation: "max"/g) ?? []).length,
  2,
  "La variante Light con Selezione pixel deve conservare MAX per colore e alpha.",
);
assert.match(selectionMaxPipeline, /maximumBlend/);
assert.match(selectionMaxPipeline, /selectionPipelineByBase\.set\(variant\.base, selectedPipeline\)/);

const submit = section(
  engine,
  "private submitLightGlazeImmediate",
  "submitBlendImmediate",
);
for (const requirement of [
  'const lightNoBuildUp = settings.blendMode === "light-glaze"',
  'opacity: intenseBlending ? settings.opacity : 1',
  'intenseBlending ? 1 : settings.opacity',
  '"light-no-build-up"',
  "this.lightNoBuildUpPipeline",
  "this.lightNoBuildUpShapePipeline",
  "this.lightNoBuildUpShapeOccupancyPipeline",
  "this.grainLightNoBuildUpPipeline",
]) {
  assert(submit.includes(requirement), `Contratto submit Light assente: ${requirement}`);
}
assert.match(
  submit,
  /if \(session\.commitRequested\)[\s\S]*this\.encodeLightGlazePermanentCommit\(/,
  "Light Glaze non viene committato una sola volta al lift.",
);
const permanentCommit = section(
  engine,
  "private encodeLightGlazePermanentCommit",
  "private submitLightGlazeImmediate",
);
assert.match(
  permanentCommit,
  /label: "Commit complete Light Glaze stroke once"/,
  "Il commit finale Light source-over è assente dall'helper condiviso.",
);

const finalComposite = section(
  engine,
  "const lightGlazeCompositePipelinePromise =",
  "const lightGlazeCommitTilePipelinePromise =",
);
assert.equal(
  (finalComposite.match(/one-minus-src-alpha/g) ?? []).length,
  2,
  "Il commit fra gesture deve essere source-over premoltiplicato.",
);
assert.match(finalComposite, /label: `Light Glaze final source-over composite/);
assert.match(
  engine,
  /lightGlazeCompositePipeline,[\s\S]*?lightGlazeCommitTilePipeline,[\s\S]*?= await settleRenderPipelineBatch\(\[[\s\S]*?lightGlazeCompositePipelinePromise,[\s\S]*?lightGlazeCommitTilePipelinePromise,[\s\S]*?\]\);/,
  "Le pipeline finali Light Glaze devono essere pubblicate solo dopo il settlement del batch.",
);

const beginStroke = section(engine, "beginStrokeAtLayer", "extendStroke(");
assert.match(beginStroke, /this\.startLightGlazeSession\(historyActionId, lightGlazeSettings\)/);
const endStroke = section(engine, "endStroke(timeMs?", "cancelStrokeBeforeRender");
assert.match(endStroke, /this\.lightGlazeSession\.endRequested = true/);

const activateLayer = section(
  engine,
  "  async activateLayer(",
  "  destroyThicknessTailOverlayResources(): void",
);
assert.doesNotMatch(
  activateLayer,
  /destroyLightGlazeResources\(this\)/,
  "Il cambio livello non deve distruggere lo scratch Glaze e sacrificare la prima pennellata.",
);
assert.match(
  activateLayer,
  /await this\.rebuildMergedLayerSurfaces\(caller\);[\s\S]*if \(!this\.selectedBrushPreparationDeferred\) \{\s*await this\.ensureCurrentBrushResources\(\);\s*\}[\s\S]*commitActiveLayerResidency/,
  "Dopo il primo uso, il livello deve attendere le risorse del pennello corrente.",
);

const brushReadiness = section(
  engine,
  "  private brushDependenciesReady(settings: BrushSettings): boolean",
  "  async ensureOptionalEditorResources(): Promise<void>",
);
for (const requirement of [
  "this.selectedBrushPreparationDeferred = false",
  "this.grainLoadingPromise === null",
  "this.shapeLoadingPromise === null",
  "this.lightGlazeLoadingPromise === null",
  "this.blendRenderer?.selectedVariantPipelinesReady(settings) === true",
  "this.selectionPipelinesReady",
  "await this.ensureGrainResources",
  "await this.ensureShapeResources",
  "await this.ensureLightGlazeResources",
  "await this.ensureBlendRendererResources(settings)",
  "await this.ensureSelectedBrushPresentationPipelines(settings)",
  "await this.ensureSelectedBrushGpuReady(settings)",
  "this.completedBrushGpuWarmupKeys.has(this.brushGpuWarmupKey(settings))",
  "await this.device.queue.onSubmittedWorkDone()",
]) {
  assert(
    brushReadiness.includes(requirement),
    `Barriera prima pennellata incompleta: ${requirement}`,
  );
}

// A plain SVG enters through the small vector-shape gate and does not prepare
// the active-raster Glaze family. The brush readiness barrier must select and
// await the exact mixed-scene family before any stamp can reach the renderer.
const mixedSceneBrushReadiness = section(
  engine,
  "  private selectedBrushPresentationPipelinesReady(settings: BrushSettings): boolean",
  "  /**\n   * Dependencies are separate from the GPU fence",
);
assert.match(
  mixedSceneBrushReadiness,
  /const mixedSceneReady = this\.selectedMixedScenePaintPipelinesReady\(settings\)/,
  "La readiness del pennello deve includere la famiglia active-raster del compositor semantico.",
);
assert.match(
  mixedSceneBrushReadiness,
  /this\.ensureSelectedMixedScenePaintPipelines\(settings\)[\s\S]*await Promise\.all\(preparations\)/,
  "Il warm-up del pennello deve attendere la famiglia active-raster selezionata.",
);
assert.match(
  mixedSceneBrushReadiness,
  /scene\.selected\.kind === "raster"[\s\S]*this\.usesOrderedScenePresentation\(\)[\s\S]*!this\.usesLayerBlendTilePresentation\(\)/,
  "Il gate misto deve seguire lo stesso percorso segmented usato dal renderer.",
);
assert.match(
  mixedSceneBrushReadiness,
  /if \(this\.styleStackNeedsCompositor\(\)\) return "raster-stroke";[\s\S]*if \(usesStrokeGlazeRenderer\(settings\)\) return "light-glaze";[\s\S]*return "thickness-tail";/,
  "La selezione capability deve rispettare la precedenza effettiva del renderer.",
);
assert.match(
  mixedSceneBrushReadiness,
  /if \(family === "light-glaze"\) \{\s*return mixedSceneActiveLightGlazePipelinesReady\(this\);\s*\}/,
  "La readiness Glaze deve leggere la famiglia active-raster, non quella canvas.",
);
assert.match(
  mixedSceneBrushReadiness,
  /if \(this\.mixedScenePaintNeedsFullCompositor\(\)\) \{\s*await this\.ensureMixedSceneEditorResources\(\);\s*return;\s*\}/,
  "Il clipping segmented deve conservare il gate completo richiesto dal preflight.",
);
assert.match(
  mixedSceneBrushReadiness,
  /this\.layerStack\.active\.cutoutMode !== "off"[\s\S]*record\.cutoutMode === "document"/,
  "Glaze e thickness-tail devono includere il matte base per cutout attivo e Deep cutout.",
);

const mixedSceneSelection = section(
  engine,
  "  async setActiveMixedSceneItem(",
  "  updateVectorTextNode(",
);
const selectionPreparation = mixedSceneSelection.indexOf(
  "await this.ensureMixedScenePaintPipelines(this.settings);",
);
const selectionMutation = mixedSceneSelection.indexOf("mutableScene.select(key);");
assert.ok(
  selectionPreparation >= 0 && selectionMutation > selectionPreparation,
  "La selezione del raster gia' residente deve completare la capability prima di pubblicarla.",
);

const addLayer = section(
  engine,
  "  async addLayer(",
  "  private layerColdBytesForMemoryAdmission(",
);
assert(
  addLayer.includes("const result = await this.activateLayer(outgoingIndexAfterInsertion);"),
  "L'inserimento raster deve passare dall'attivazione che prepara la capability incoming.",
);
assert.match(
  activateLayer,
  /await ensureEffectRenderersForRecord\(this, record\);\s*[\s\S]*await this\.ensureSelectedMixedScenePaintPipelines\(this\.settings\);\s*[\s\S]*await this\.rebuildMergedLayerSurfaces\(caller\);/,
  "L'attivazione deve scegliere la capability dopo aver caricato gli effetti del raster incoming.",
);

const lightGlazeFamily = section(
  mixedSceneActivePaint,
  "export async function ensureMixedSceneActiveLightGlazePipelines(",
  "\n}",
);
assert.match(
  lightGlazeFamily,
  /const \[display, source, sourceAtop\] = await Promise\.all\(/,
  "Le tre pipeline mixed Glaze devono essere compilate come una sola capability.",
);
const familyAwait = lightGlazeFamily.indexOf(
  "const [display, source, sourceAtop] = await Promise.all(",
);
for (const publication of [
  "engine.mixedSceneActiveLightGlazeDisplayPipeline = display;",
  "engine.mixedSceneActiveLightGlazeSourcePipeline = source;",
  "engine.mixedSceneActiveLightGlazeSourceAtopPipeline = sourceAtop;",
]) {
  assert.ok(
    lightGlazeFamily.indexOf(publication) > familyAwait,
    `La famiglia Glaze non deve essere pubblicata parzialmente: ${publication}`,
  );
}
assert.match(
  mixedSceneActivePaint,
  /const lightGlazeCreationPromises = new WeakMap<BrushEngine, Promise<void>>\(\)/,
  "Le richieste concorrenti Glaze devono condividere una sola compilazione.",
);

const glazeMaterialization = section(
  engine,
  "export async function initializeLightGlazeResourceSet",
  "export function encodeLightGlazeDisplayPyramid",
);
assert.match(glazeMaterialization, /clearAttachment\(resources\.view/);
assert.match(glazeMaterialization, /resources\.compositeMipViews\.forEach/);
assert.match(
  glazeMaterialization,
  /queue\.submit\(\[encoder\.finish\(\)\]\);[\s\S]*queue\.onSubmittedWorkDone\(\)/,
  "Il clear delle texture Glaze deve terminare sulla GPU prima della readiness.",
);

const glazeRetarget = section(
  engine,
  "export function retargetLightGlazeBindGroups",
  "export function destroyLightGlazeResources",
);
for (const binding of [
  "resource: engine.layerView",
  "resource: engine.layerSamplingView",
  "resource: engine.mergedBelowView()",
  "resource: engine.mergedAboveView()",
  "resource: engine.activeClippingPrefixView()",
  "resource: engine.activeClippingSuffixView()",
]) {
  assert(glazeRetarget.includes(binding), `Retarget Glaze incompleto: ${binding}`);
}
const mergedRebuild = section(
  engine,
  "  async rebuildMergedLayerSurfaces(",
  "  recordVectorHistoryAction(",
);
assert.match(
  mergedRebuild,
  /this\.mergedBelow = candidateBelow;[\s\S]*rebuildLayerDisplayBindGroups\(this\);[\s\S]*retargetLightGlazeBindGroups\(this\);[\s\S]*this\.layerPresentationFrozen = false;/,
  "I bind group Glaze devono seguire le nuove superfici prima di sbloccare la presentazione.",
);
const deferredBlendWarmup = section(
  engine,
  "engine.blendRendererWarmup = options.deferBlendRenderer",
  "engine.activeLayerDisplayPyramid = nextDisplayPyramid",
);
assert.match(
  deferredBlendWarmup,
  /candidate\.retarget\(engine\.layerView, engine\.layerSamplingView\);[\s\S]*engine\.blendRenderer = candidate;/,
  "Un renderer Blend compilato durante lo switch può ancora pubblicare le view del livello uscente.",
);
// Ancorato alla firma del metodo: il solo nome atterrerebbe in un commento
// JSDoc migliaia di righe prima, allargando la sezione a mezzo motore.
const renderFrame = section(engine, "  renderFrame(timestamp: number): void", "recordRenderedFrame(");
assert.match(
  renderFrame,
  /let hasPendingStampForGesture = false[\s\S]*for \(let index = batchSize;[\s\S]*commitRequested = lightGlazeSession\.endRequested[\s\S]*&& !hasPendingStampForGesture/,
  "Il commit Light deve attendere ogni stamp non incluso nel batch finale della gesture.",
);

const livePyramid = section(
  engine,
  "export function encodeLightGlazeDisplayPyramid",
  "export function currentLightGlazeResourceSet",
);
assert.match(
  livePyramid,
  /requestedContent: "active-only" \| "final-raster-stack" = "active-only"/,
  "La piramide live deve dichiarare esplicitamente quale contenuto rappresenta.",
);
assert.match(
  livePyramid,
  /session\.mipContent !== requestedContent[\s\S]*session\.mipValidThroughLevel = 0/,
  "Un cambio di semantica deve invalidare tutta la catena live.",
);
assert.match(
  livePyramid,
  /const needsFullBuild = mipLevel > previousValidThroughLevel/,
  "Il primo uso di ogni livello mip deve costruirlo interamente.",
);
assert.match(
  livePyramid,
  /requestedContent === "final-raster-stack"\s*\? engine\.lightGlazeFinalRasterStackCompositeMipPipeline/,
  "Mip 1 live deve poter comporre lo stack raster finale prima del box filter.",
);

assert.match(
  submit,
  /const useLiveFinalRasterStack = session\.hasContent[\s\S]*!this\.usesOrderedScenePresentation\(\)[\s\S]*!this\.usesLayerBlendTilePresentation\(\)[\s\S]*this\.finalRasterStackMipAvailable\(true\)/,
  "Il percorso live finale deve restare limitato allo stack raster semplice e compatibile.",
);
assert.match(
  submit,
  /encodeLightGlazeDisplayPyramid\([\s\S]*useLiveFinalRasterStack \? "final-raster-stack" : "active-only"/,
  "La pennellata deve chiedere la semantica final-stack quando è sicura.",
);
assert.match(
  submit,
  /\(!useLiveFinalRasterStack \|\| displaySelectedMipLevel === 0\)[\s\S]*&& !tileBlendOwnsPyramid[\s\S]*encodeMergedDisplayPyramids/,
  "Solo LOD 1+ final-stack può evitare i merged mip; LOD 0 li usa nel fast path.",
);
assert.match(
  submit,
  /useLiveFinalRasterStack\s*\? this\.lightGlazeFinalRasterStackDisplayPipeline\s*:\s*this\.lightGlazeDisplayPipeline/,
  "Il display live deve leggere direttamente lo stack finale senza un secondo source-over.",
);
assert.match(
  submit,
  /const requestFinalRasterStackMip = displayRequiredMipLevel > 0[\s\S]*requestFinalRasterStackMip \? "final-raster-stack" : "active-only"[\s\S]*this\.paintDisplayPyramidContent === "final-raster-stack"/,
  "Il frame di commit deve conservare la stessa semantica final-stack del frame live.",
);

const liveDisplayShader = section(
  shaders,
  "export const lightGlazeDisplayShader",
  "export const lightGlazeCompositeMipShader",
);
assert.match(liveDisplayShader, /fn compositedFinalRasterStackTexel\(/);
assert.match(
  liveDisplayShader,
  /fn sampleCompositedFinalRasterStackLinear[\s\S]*compositedFinalRasterStackTexel\(lower\)[\s\S]*compositedFinalRasterStackTexel\(lower \+ vec2<i32>\(1, 1\)\)[\s\S]*return mix\(/,
  "LOD 0 live deve comporre i quattro texel finali prima della bilineare.",
);
assert.match(
  liveDisplayShader,
  /fn finalStackFragmentMain[\s\S]*let lod = max\(display\.selectedMipLevel, 0\.0\)[\s\S]*let mipOne = textureSampleLevel\(compositedMipTexture[\s\S]*let lowerMip = floor\(lod\)[\s\S]*let upperMip = ceil\(lod\)/,
  "Il display live deve fondere mip 0 e la piramide composta, poi i livelli adiacenti.",
);
assert.match(
  liveDisplayShader,
  /jointFinalStackFilteringCandidate[\s\S]*stackAlphaGradient = fwidth\(activePaint\.a\)[\s\S]*needsJointFinalStackFiltering/,
  "Il costo LOD 0 aggiuntivo deve restare confinato ai bordi alpha.",
);

const liveMipShader = section(
  shaders,
  "export const lightGlazeCompositeMipShader",
  "export const lightGlazeCommitTileShader",
);
assert.match(liveMipShader, /@group\(0\) @binding\(6\) var mergedBelowTexture/);
assert.match(liveMipShader, /@group\(0\) @binding\(7\) var mergedAboveTexture/);
assert.match(
  liveMipShader,
  /fn compositedFinalStackSource[\s\S]*loadMergedBelow\(sourcePosition\)[\s\S]*sourceOver\(activeGroup, paint\)[\s\S]*loadMergedAbove\(sourcePosition\)/,
  "Mip 1 live deve rispettare l'ordine below, gruppo active, above per texel.",
);
assert.match(
  liveMipShader,
  /fn finalStackFragmentMain[\s\S]*let p00 = compositedFinalStackSource\(sourceOrigin\)[\s\S]*let p11 = compositedFinalStackSource\(sourceOrigin \+ vec2<i32>\(1, 1\)\)[\s\S]*return \(p00 \+ p10 \+ p01 \+ p11\) \* 0\.25/,
  "Mip 1 live deve mediare quattro risultati finali premoltiplicati.",
);

assert.match(
  shaders,
  /coverage \* brush\.controls\.x \* brush\.baseHslAlpha\.w \* brush\.controls\.z/,
  "Flow non raggiunge il deposito candidato dello stamp.",
);
assert.match(shaders, /fn highPrecisionCoveragePaint[\s\S]*return vec4<f32>\(alpha\)/);
assert.doesNotMatch(shaders, /pack4x8unorm\(vec4<f32>\(alpha\)\)/);
assert.match(shaders, /fn storedLightCoverage\(value: f32\)/);
assert.match(shaders, /fn storedLightCoverage\(value: f32\) -> f32 \{\s*return clamp\(value, 0\.0, 1\.0\);/);
assert.match(
  shaders,
  /if \(lightGlaze\.accumulationMode == 1u\)[\s\S]*tintLinear\.rgb \* coverage, coverage\) \* opacity/,
  "Opacity non viene applicata una sola volta al risultato MAX della gesture.",
);

assert.match(html, /data-mobile-brush-rendering="light-glaze"[\s\S]{0,80}Light Glaze/);
assert.doesNotMatch(html, /data-mobile-brush-rendering="m1-glaze"/);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let ensureMixedSceneActiveLightGlazePipelines;
try {
  ({ ensureMixedSceneActiveLightGlazePipelines } = await moduleServer.ssrLoadModule(
    "/src/mixed-scene-active-paint-resources.ts",
  ));
} finally {
  await moduleServer.close();
}

function mixedGlazeHarness({ delayed = false, failOnce = false } = {}) {
  const calls = [];
  const pending = [];
  let failurePending = failOnce;
  const device = {
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline: (descriptor) => ({ descriptor }),
    createRenderPipelineAsync(descriptor) {
      calls.push(descriptor.label);
      if (failurePending) {
        failurePending = false;
        return Promise.reject(new Error("Injected mixed Glaze pipeline failure."));
      }
      if (!delayed) return Promise.resolve({ descriptor });
      return new Promise((resolve) => pending.push(() => resolve({ descriptor })));
    },
  };
  return {
    calls,
    pending,
    engine: {
      device,
      deviceLostError: null,
      lightGlazeDisplayBindGroupLayout: {},
      lightGlazeDisplayShaderModule: {},
      mixedSceneActiveLightGlazeDisplayPipeline: null,
      mixedSceneActiveLightGlazeSourcePipeline: null,
      mixedSceneActiveLightGlazeSourceAtopPipeline: null,
    },
  };
}

const delayedFamily = mixedGlazeHarness({ delayed: true });
const delayedFirst = ensureMixedSceneActiveLightGlazePipelines(delayedFamily.engine);
const delayedSecond = ensureMixedSceneActiveLightGlazePipelines(delayedFamily.engine);
await Promise.resolve();
assert.equal(delayedFamily.calls.length, 3, "le richieste concorrenti devono compilare tre pipeline");
assert([
  delayedFamily.engine.mixedSceneActiveLightGlazeDisplayPipeline,
  delayedFamily.engine.mixedSceneActiveLightGlazeSourcePipeline,
  delayedFamily.engine.mixedSceneActiveLightGlazeSourceAtopPipeline,
].every((pipeline) => pipeline === null), "nessuna pipeline deve apparire durante la compilazione");
delayedFamily.pending.shift()();
await Promise.resolve();
assert([
  delayedFamily.engine.mixedSceneActiveLightGlazeDisplayPipeline,
  delayedFamily.engine.mixedSceneActiveLightGlazeSourcePipeline,
  delayedFamily.engine.mixedSceneActiveLightGlazeSourceAtopPipeline,
].every((pipeline) => pipeline === null), "una famiglia parziale non deve essere osservabile");
for (const resolve of delayedFamily.pending.splice(0)) resolve();
await Promise.all([delayedFirst, delayedSecond]);
assert([
  delayedFamily.engine.mixedSceneActiveLightGlazeDisplayPipeline,
  delayedFamily.engine.mixedSceneActiveLightGlazeSourcePipeline,
  delayedFamily.engine.mixedSceneActiveLightGlazeSourceAtopPipeline,
].every(Boolean), "la famiglia completa deve essere pubblicata insieme");
await ensureMixedSceneActiveLightGlazePipelines(delayedFamily.engine);
assert.equal(delayedFamily.calls.length, 3, "una famiglia pronta deve essere riusata");

const retryFamily = mixedGlazeHarness({ failOnce: true });
await assert.rejects(
  ensureMixedSceneActiveLightGlazePipelines(retryFamily.engine),
  /Injected mixed Glaze pipeline failure/,
);
assert([
  retryFamily.engine.mixedSceneActiveLightGlazeDisplayPipeline,
  retryFamily.engine.mixedSceneActiveLightGlazeSourcePipeline,
  retryFamily.engine.mixedSceneActiveLightGlazeSourceAtopPipeline,
].every((pipeline) => pipeline === null), "un errore non deve pubblicare una famiglia parziale");
await ensureMixedSceneActiveLightGlazePipelines(retryFamily.engine);
assert.equal(retryFamily.calls.length, 6, "la capability fallita deve essere ritentabile");

console.log("Light Glaze contract verification passed.");
