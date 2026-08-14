import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import { effectsRetargetCallerForHistoryReplay } from "../../../src/engine-layer-resources.ts";
import { assertBoundedSourceSection as assertSection } from "../source-contract.mjs";

// The pixel probe is what makes multi-layer claims falsifiable: correctness
// cannot be read off the screen, because the display shows one composite and a
// dropped submit leaves the previous image in place. Guard it against silent
// removal, and against losing its dev gate.
const engineSource = readEngineSource();
const layerThumbnailSource = readFileSync(
  new URL("../../../src/layer-thumbnail-renderer.ts", import.meta.url),
  "utf8",
);
const layerThumbnailControllerSource = readFileSync(
  new URL("../../../src/layer-thumbnail-controller.ts", import.meta.url),
  "utf8",
);
const layerPanelSource = readFileSync(
  new URL("../../../src/layer-panel-controller.ts", import.meta.url),
  "utf8",
);
const layerThumbnailGeometrySource = readFileSync(
  new URL("../../../src/layer-thumbnail-geometry.ts", import.meta.url),
  "utf8",
);
const mobileSemanticThumbnailSource = readFileSync(
  new URL("../../../src/mobile-semantic-layer-thumbnail.ts", import.meta.url),
  "utf8",
);
const clippingGroupShaderSource = readFileSync(
  new URL("../../../src/clipping-group-shader.ts", import.meta.url),
  "utf8",
);
const layerBlendTileRuntimeSource = readFileSync(
  new URL("../../../src/engine-layer-blend-tile-runtime.ts", import.meta.url),
  "utf8",
);
const strokeRendererBlendSource = readFileSync(
  new URL("../../../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
const mixedSceneStackSource = readFileSync(
  new URL("../../../src/mixed-scene-stack.ts", import.meta.url),
  "utf8",
);
const historyReplayPlanSource = readFileSync(
  new URL("../../../src/history-replay-plan.ts", import.meta.url),
  "utf8",
);
const compositionSegmentsStart = mixedSceneStackSource.indexOf("  compositionSegments(");
const compositionSegmentsReturn = mixedSceneStackSource.indexOf(
  "    return segments;",
  compositionSegmentsStart,
);
const compositionSegmentsEnd = compositionSegmentsReturn < 0
  ? -1
  : compositionSegmentsReturn + "    return segments;".length;
assertSection(
  "segmentazione scena mista",
  compositionSegmentsStart,
  compositionSegmentsEnd,
);
const compositionSegmentsBody = mixedSceneStackSource.slice(
  compositionSegmentsStart,
  compositionSegmentsEnd,
);
assert.match(
  compositionSegmentsBody,
  /const vector = item\.kind === "text"\s*\? this\.textById\(item\.textNodeId\)\s*: this\.svgById\(item\.svgNodeId\)/,
  "la segmentazione deve consultare lo stato vivo sia del testo sia dell'SVG",
);
assert.match(
  compositionSegmentsBody,
  /if \(!vector\.visible \|\| vector\.opacity <= 0\) \{\s*continue;\s*\}[\s\S]*?flushRasterRun\(\);\s*textRun\.push\(item\)/,
  "testo e SVG invisibili o trasparenti devono essere ignorati prima di spezzare le run",
);
assert.match(
  engineSource,
  /async readLayerPixels\(rect\?: DirtyRect, layerIndex\?: number\): Promise<Uint8Array>/,
);
assert.match(
  engineSource,
  /rasterClippingParentId: record\.clippingParentId/,
  "lo snapshot pubblico deve serializzare l'id stabile del parent, mai un indice di stack",
);
assert.match(
  engineSource,
  /rasterClippingParentId: number \| null/,
  "lo snapshot distingue esplicitamente un raster ordinario da un ritaglio",
);
// Reading a NAMED layer is what makes the test bilateral: "A kept its pixels
// while B was rebuilt" needs both records. Cold records are rehydrated only for
// the probe and the temporary full texture must be released in finally.
const probeStart = engineSource.indexOf("async readLayerPixels(");
const probeBody = engineSource.slice(probeStart, probeStart + 2_600);
assert.match(probeBody, /import\.meta\.env\.DEV/, "la sonda deve restare solo-dev");
assert.match(probeBody, /const record = layerIndex === undefined/);
assert.match(probeBody, /if \(gpu\.hot\)/);
assert.match(probeBody, /await createHydratedLayerTexture\(this,/);
assert.match(
  probeBody,
  /finally \{\s*destroyTransientLayerHydration\(this, hydration\);/,
  "la sonda cold deve sempre rilasciare la reidratazione full-canvas",
);
const textureProbeStart = engineSource.indexOf("async readTexturePixels(");
const textureProbeBody = engineSource.slice(textureProbeStart, textureProbeStart + 3_000);
assert.match(textureProbeBody, /copyTextureToBuffer/);
assert.match(textureProbeBody, /\{ texture: target, mipLevel, origin:/,
  "la sonda deve inoltrare esplicitamente il mip richiesto");
assert.match(textureProbeBody, /Math\.ceil\(unpaddedBytesPerRow \/ 256\) \* 256/,
  "bytesPerRow deve restare allineato a 256");
assert.match(
  textureProbeBody,
  /destroyTrackedReadbackBuffer\(this, readbackBuffer, readbackBytes\)/,
  "la sonda deve rilasciare il buffer attraverso la contabilità dev",
);
const destroyReadbackStart = engineSource.indexOf("export function destroyTrackedReadbackBuffer(");
const destroyReadbackBody = engineSource.slice(destroyReadbackStart, destroyReadbackStart + 500);
assert.match(destroyReadbackBody, /buffer\.destroy\(\)/, "il rilascio tracciato deve distruggere il buffer");
assert.match(destroyReadbackBody, /engine\.devReadbackActiveBytes -= size/,
  "il rilascio tracciato deve azzerare la residenza temporanea");

// Steps 12–14: analytic bakes are transactional, transient and bounded by the
// conservative union of every active effect's final-pixel domain. A successful
// rebuild folds them into at most two persistent surfaces, then releases every
// per-layer bake. Raw inactive layers own no mip chain.
assert.match(engineSource, /LAYER_BAKE_STRATEGY =\s*\n\s*"transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces"/);
assert.match(
  engineSource,
  /LAYER_COMPOSITE_STRATEGY =\s*\n\s*"merged-above-over-isolated-active-clipping-group-over-merged-below-source-atop-live-prefix-suffix-compose-before-filter-parent-opacity-once-direct-authoritative-cold-tiles-normal-no-effects-deferred-to-fold-fence-bounded-visual-rect"/,
);
assert.ok(
  (engineSource.match(/layerBakeStrategy: LAYER_BAKE_STRATEGY/g) ?? []).length >= 2,
  "stats e benchmark devono firmare la strategia dei bake",
);
assert.ok(
  (engineSource.match(/layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY/g) ?? []).length >= 2,
  "stats e benchmark devono firmare la strategia di compositing",
);
const clippingToggleStart = engineSource.indexOf("export async function setLayerClipping(");
const clippingToggleEnd = engineSource.indexOf(
  "export async function setLayerPresentation(",
  clippingToggleStart,
);
assertSection("toggle maschera raster", clippingToggleStart, clippingToggleEnd);
const clippingToggleBody = engineSource.slice(clippingToggleStart, clippingToggleEnd);
assert.match(clippingToggleBody, /await engine\.waitForIdle\(\)/);
assert.match(clippingToggleBody, /engine\.layerStack\.setClippingEnabled\(index, enabled\)/);
assert.match(clippingToggleBody, /await engine\.rebuildMergedLayerSurfaces\(\)/,
  "il toggle deve ricostruire gruppo attivo e lati fusi dalla relazione nuova");
assert.match(
  clippingToggleBody,
  /engine\.layerStack\.setClippingEnabled\(index, previousEnabled\)[\s\S]*?await engine\.rebuildMergedLayerSurfaces\("layer-switch"\)/,
  "un errore GPU deve ripristinare relazione e compositi precedenti",
);
assert.match(clippingToggleBody, /publishMixedScene\(engine\)/,
  "la UI mista deve ricevere subito i nuovi parent id");
const layerBlendStart = engineSource.indexOf("export async function setLayerBlendMode(");
const layerBlendEnd = engineSource.indexOf(
  "export function resolveFillSource(",
  layerBlendStart,
);
assertSection("fusione livello raster", layerBlendStart, layerBlendEnd);
const layerBlendBody = engineSource.slice(layerBlendStart, layerBlendEnd);
assert.equal(effectsRetargetCallerForHistoryReplay(false), "layer-switch");
assert.equal(effectsRetargetCallerForHistoryReplay(true), "history-replay");
assert.match(layerBlendBody, /isLayerBlendMode\(blendMode\)/,
  "l'API non deve accettare codici WGSL o stringhe arbitrarie");
assert.match(layerBlendBody, /const previousBlendMode = record\.blendMode/);
assert.match(layerBlendBody, /record\.blendMode = blendMode/);
assert.ok(
  layerBlendBody.indexOf("prewarmMixedSceneLinearTextureForLayerBlend(")
    < layerBlendBody.indexOf("record.blendMode = blendMode"),
  "cache ordered, ping-pong e tile devono superare validation/OOM prima dei metadata",
);
assert.match(
  layerBlendBody,
  /const visibleSemantics = Boolean\(engine\.mixedSceneStack\?\.visibleSemanticCount\)[\s\S]*?candidateNeedsTile = candidateAdvanced && !visibleSemantics[\s\S]*?candidateNeedsViewportBlend = candidateAdvanced && visibleSemantics/,
  "il prewarm deve allocare soltanto la famiglia realmente usata dalla scena candidata",
);
assert.match(
  layerBlendBody,
  /const rebuildCaller = effectsRetargetCallerForHistoryReplay\(historyReplay\)/,
  "Undo/Redo della fusione deve propagare l'esenzione della transazione History",
);
assert.equal(
  (layerBlendBody.match(/rebuildMergedLayerSurfaces\(rebuildCaller\)/g) ?? []).length,
  2,
  "sia il compositing sia il rollback della fusione devono usare lo stesso caller",
);
assert.match(
  layerBlendBody,
  /record\.blendMode = previousBlendMode;[\s\S]*?await engine\.rebuildMergedLayerSurfaces\(rebuildCaller\)/,
  "un errore GPU deve ripristinare metadata e superfici precedenti",
);
assert.match(
  layerBlendBody,
  /const combined = new Error\([\s\S]*?latchDocumentStateInconsistent\([\s\S]*?combined/,
  "un doppio fallimento deve conservare l'errore completo nel rapporto diagnostico",
);
assert.match(
  engineSource,
  /async setLayerBlendMode\(index: number, blendMode: LayerBlendMode\): Promise<boolean>[\s\S]{0,1200}kind: "layer-blend-mode"[\s\S]{0,300}before,[\s\S]{0,200}after: blendMode/,
  "una scelta riuscita deve produrre una sola azione before/after",
);
assert.match(
  engineSource,
  /export async function prewarmMixedSceneLinearTextureForLayerBlend\([\s\S]*?runGpuAllocationTransaction\([\s\S]*?oldTexture\?\.destroy\(\)/,
  "il prewarm viewport deve pubblicare il candidato solo dopo i due error scope",
);
assert.match(
  layerBlendTileRuntimeSource,
  /runGpuAllocationTransaction\([\s\S]*?Renderer Traccia per compositore fusione livello[\s\S]*?deferRollback\(\(\) => releaseRasterStrokeRenderer\(engine, true\)\)/,
  "anche l'attach finale del renderer Traccia deve restare transazionale",
);
assert.match(
  strokeRendererBlendSource,
  /const BAKE_PARAMETER_CAPACITY = 32;[\s\S]*?bakeParameterBuffer[\s\S]*?Traccia isolated tile-bake parameters/,
  "i bake tile devono usare un ring GPU separato dai dispatch live Traccia",
);
assert.match(
  strokeRendererBlendSource,
  /encodeBake\([\s\S]*?deferParameterUpload[\s\S]*?this\.bakeParameterBuffer[\s\S]*?bakeBindGroup/,
  "encodeBake non deve più riscrivere il parameterBuffer dei dispatch già codificati",
);
assert.match(
  layerBlendTileRuntimeSource,
  /prepareBakeStyle\(engine\.rasterBevelStyle\)[\s\S]*?deferParameterUpload: true[\s\S]*?sharedStylePrepared: true[\s\S]*?flushBakeParameters\(bakeParameterSlot\)/,
  "il tile path deve preparare lo stile e caricare tutti i parametri bake una volta per frame",
);
assert.match(
  engineSource,
  /if \(crossedAction\.kind === "layer-blend-mode"\)[\s\S]{0,900}await setLayerBlendMode\([\s\S]{0,220}true,[\s\S]{0,180}engine\.history\.setCursor\(nextCursor\)/,
  "Undo/Redo deve cambiare solo compositing e avanzare il cursore dopo il successo",
);
const retargetStart = engineSource.indexOf("export async function retargetEffectsWorkingSetInternal(");
const retargetEnd = engineSource.indexOf("export function releaseLayerBlendFoldScratch(", retargetStart);
assertSection("retarget effects working set", retargetStart, retargetEnd);
const retargetBody = engineSource.slice(retargetStart, retargetEnd);
assert.match(retargetBody, /completionPolicy: LayerGpuCompletionPolicy = "await-immediately"/);
assert.match(retargetBody, /rebuildDomain: LayerEffectsRebuildDomain = "full-document"/);
assert.match(retargetBody, /styleStackRetargetBounds = rebuildDomain === "content-bounds"/,
  "solo il fold inattivo può restringere il dominio del rebuild analitico");
assert.match(
  retargetBody,
  /if \(completionPolicy === "await-immediately"\) \{\s*await engine\.waitForIdle\(\{\s*allowFrozenDerivedPresentation: caller !== "public",\s*\}\);/,
  "il retarget pubblico deve conservare il fence iniziale e solo i caller strutturali possono coalescere un frame congelato",
);
assert.match(retargetBody, /if \(completionPolicy === "await-immediately"\) \{\s*await engine\.waitForGpuCapped\(`Retarget banco effetti #\$\{generation\}`\);/,
  "solo la catena fold può rinviare il timeout GPU al fence del record");
const bakeCandidateStart = engineSource.indexOf("async createLayerBakeCandidate(");
const bakeCandidateEnd = engineSource.indexOf("async bakeActiveLayerForSwitch(", bakeCandidateStart);
const bakeCandidateBody = engineSource.slice(bakeCandidateStart, bakeCandidateEnd);
assert.match(bakeCandidateBody, /runGpuAllocationTransaction\(/,
  "il bake deve restare dentro allocation, validation, submit e rollback atomici");
assert.match(bakeCandidateBody, /GPUTextureUsage\.STORAGE_BINDING/);
assert.match(bakeCandidateBody, /GPUTextureUsage\.TEXTURE_BINDING/);
assert.match(bakeCandidateBody, /GPUTextureUsage\.COPY_SRC/);
assert.match(bakeCandidateBody, /renderer\.encodeBake\(/,
  "la fusione deve partire dal compositore analitico promosso dal golden");
assert.match(bakeCandidateBody, /const nonTransparentBounds = layerCompositeVisualBounds\(this, record\)/);
assert.match(bakeCandidateBody, /rect: nonTransparentBounds/,
  "il bake analitico inattivo non deve tornare al dispatch 4096²");
assert.match(bakeCandidateBody, /nonTransparentBounds: \{ \.\.\.nonTransparentBounds \}/);
assert.match(bakeCandidateBody, /await this\.waitForGpuCapped\(`/,
  "ogni nuovo submit atteso deve avere un timeout");
assert.match(bakeCandidateBody, /maybeInjectLayerBakeFault\(this, "after-candidate-submit"\)/);
assert.match(engineSource, /readonly liveLayerBakeTextures = new Map<GPUTexture, number>\(\)/);
assert.match(engineSource, /transaction\.deferRollback\(\(\) => destroyLayerBakeTexture\(this, texture\)\)/,
  "il fault post-submit deve rendere osservabile anche il rilascio del candidato");

// Il percorso raster è condiviso anche dallo stack misto; includi l'helper
// estratto nel corpo verificato, non soltanto il wrapper legacy.
const mergedStart = engineSource.indexOf(
  "export async function foldRasterRecordIntoMergedSurface(",
);
const mergedEnd = engineSource.indexOf(
  "export async function restoreEffectsWorkbenchToActiveLayer(",
  mergedStart,
);
assert.ok(mergedStart >= 0 && mergedEnd > mergedStart, "sezione merged surface non trovata");
const mergedBody = engineSource.slice(mergedStart, mergedEnd);
assert.match(mergedBody, /record\.visible && record\.opacity > 0 && record\.hasContent/);
assert.match(mergedBody, /await materializeLayerCompositeSource\(engine, record, caller\)/);
assert.match(
  mergedBody,
  /const contentBounds = unionMergedSurfaceRects\([\s\S]*?visibleRecords\.map\([\s\S]*?layerCompositeVisualBounds\(engine, record\)/,
  "anche il compositore raster legacy deve derivare una bbox visiva conservativa",
);
assert.match(
  mergedBody,
  /const allocationBounds = alignedMergedSurfaceBounds\(\s*contentBounds,\s*DOCUMENT_WIDTH,\s*64,\s*64,\s*DOCUMENT_HEIGHT,?\s*\)[\s\S]*?visibleRecords\.length,[\s\S]*?allocationBounds/,
  "la merged raster legacy non deve tornare a una texture full-document",
);
assert.doesNotMatch(
  mergedBody,
  /alignedMergedSurfaceBounds\(contentBounds, LAYER_SIZE\)/,
  "i bounds merged non devono ricostruire un documento quadrato dal lato massimo",
);
assert.match(
  engineSource,
  /export async function restoreEffectsWorkbenchToActiveLayer\([\s\S]*?rebuildDomain: LayerEffectsRebuildDomain = "full-document"[\s\S]*?"await-immediately",\s*rebuildDomain/,
  "il retarget attivo deve conservare il dominio full di default e permettere il dominio contenuto soltanto ai chiamanti espliciti",
);
assert.match(
  engineSource,
  /layerCompositeVisualBounds\([\s\S]*?rasterStrokeEffectRect[\s\S]*?rasterBevelEffectRect[\s\S]*?rasterOuterShadowEffectRect[\s\S]*?rasterInnerShadowEffectRect/,
  "i bounds del bake devono unire Traccia, Smusso e le due Ombre",
);
assert.match(
  engineSource,
  /export async function materializeLayerCompositeSource\([\s\S]*?"defer-to-fold-fence"[\s\S]*?"defer-to-fold-fence"[\s\S]*?"defer-to-fold-fence"/,
  "hydrate, retarget e bake temporanei devono appartenere allo stesso fence del fold",
);
const foldViewStart = engineSource.indexOf("async function foldViewIntoMergedSurface(");
const foldViewEnd = engineSource.indexOf("function recordHasLiveContent(", foldViewStart);
assertSection("fold view into merged surface", foldViewStart, foldViewEnd);
const foldViewBody = engineSource.slice(foldViewStart, foldViewEnd);
assert.ok(
  foldViewBody.indexOf("engine.device.queue.submit([encoder.finish()]);")
    < foldViewBody.indexOf("await engine.waitForGpuCapped(label);"),
  "il fence unico del fold deve seguire il submit",
);
assert.match(foldViewBody, /pass\.setScissorRect\(/,
  "i fold renderizzati devono restare limitati ai bounds conservativi");
assert.match(foldViewBody, /loadOp: clearDestination \? "clear" : "load"/,
  "il primo fold deve pulire la superficie e i successivi caricarla");
const foldUniformStart = engineSource.indexOf("function packLayerCompositeUniforms(");
const foldUniformEnd = engineSource.indexOf("async function foldViewIntoMergedSurface(", foldUniformStart);
assertSection("layer composite uniforms", foldUniformStart, foldUniformEnd);
const foldUniformBody = engineSource.slice(foldUniformStart, foldUniformEnd);
assert.match(foldUniformBody, /new ArrayBuffer\(LAYER_COMPOSITE_UNIFORM_BYTES\)/);
assert.match(foldUniformBody, /f32\[0\] = destinationOrigin\.x/);
assert.match(foldUniformBody, /f32\[1\] = destinationOrigin\.y/);
assert.match(foldUniformBody, /f32\[2\] = destinationScale/);
assert.match(foldUniformBody, /f32\[3\] = opacity/);
assert.match(foldUniformBody, /f32\[4\] = sourceOrigin\.x/);
assert.match(foldUniformBody, /f32\[5\] = sourceOrigin\.y/);
assert.match(foldUniformBody, /f32\[6\] = sourceScale/);
assert.match(foldUniformBody, /u32\[10\] = LAYER_BLEND_MODE_CODES\[blendMode\]/);
assert.match(foldUniformBody, /u32\[11\] = operator === "source-atop" \? 1 : 0/);
assert.match(
  foldUniformBody,
  /packLayerCompositeUniforms\([\s\S]*?destination\.bounds,[\s\S]*?destination\.resolutionScale,/,
  "il wrapper Normal deve conservare l'ABI document-space originale",
);
assert.match(foldViewBody, /mergedSurfacePhysicalRect\(/);
assert.match(foldViewBody, /if \(blendMode === "normal"\)/,
  "Normal deve conservare il percorso fixed-function senza scratch");
assert.match(
  foldViewBody,
  /operator === "source-atop"[\s\S]*?engine\.layerSourceAtopPipeline[\s\S]*?engine\.layerCompositePipeline/,
  "Normal deve scegliere le pipeline hardware source-atop/source-over preesistenti",
);
assert.match(foldViewBody, /engine\.layerBlendFoldPipeline/,
  "i modi avanzati devono usare lo shader che campiona il backdrop");
assert.match(foldViewBody, /binding: 0, resource: backdropScratchView/,
  "il fold avanzato deve campionare il tile backdrop separato");
assert.match(foldViewBody, /view: outputScratchView/,
  "il fold avanzato non può campionare la propria render attachment");
assert.match(foldViewBody, /destination\.blendFoldTileWidth/,
  "la dirty rect deve essere suddivisa nei tile scratch riusabili");
assert.match(foldViewBody, /packLayerCompositeUniforms\([\s\S]*?tile\.x \/ destination\.resolutionScale/,
  "ogni tile deve conservare le coordinate document-space globali");
assert.match(foldViewBody, /pass\.setBindGroup\(0, bindGroup, \[tileIndex \* uniformStride\]\)/,
  "un solo upload deve alimentare i record uniform dinamici di tutti i tile");
assert.equal(
  (foldViewBody.match(/encoder\.copyTextureToTexture\(/g) ?? []).length,
  2,
  "ogni tile deve copiare canonical→backdrop e output→canonical",
);
assert.match(mergedBody, /engine\.destroyLayerBake\(source\.transientBake\)/);
assert.match(
  engineSource,
  /async rebuildMergedLayerSurfaces\(\s*caller: EffectsRetargetCaller = "layer-switch",\s*view: VectorTextViewState = this\.getVectorTextViewState\(\),\s*options: RebuildMergedLayerSurfacesOptions = \{\},\s*\): Promise<void>/,
);
const rebuildMethodStart = engineSource.indexOf("async rebuildMergedLayerSurfaces(");
const rebuildMethodEnd = engineSource.indexOf("  async addLayer(", rebuildMethodStart);
const rebuildMethodBody = engineSource.slice(rebuildMethodStart, rebuildMethodEnd);
const rebuildFreeze = rebuildMethodBody.indexOf("this.layerPresentationFrozen = true;");
const rebuildDestroyBelow = rebuildMethodBody.indexOf("this.destroyMergedSurface(previousBelow);");
const rebuildDestroyAbove = rebuildMethodBody.indexOf("this.destroyMergedSurface(previousAbove);");
const rebuildFirstCandidate = rebuildMethodBody.indexOf("candidateBelow = await buildMergedSurfaceCandidate(this, ");
assert.ok(
  rebuildFreeze >= 0
    && rebuildDestroyBelow > rebuildFreeze
    && rebuildDestroyAbove > rebuildFreeze
    && rebuildFirstCandidate > rebuildDestroyBelow
    && rebuildFirstCandidate > rebuildDestroyAbove,
  "le superfici fuse precedenti devono essere evacuate prima di allocare i candidati",
);
assert.match(
  rebuildMethodBody,
  /rebuildLayerDisplayBindGroups\(this\);[\s\S]*?this\.layerPresentationFrozen = false;/,
  "la presentazione può ripartire solo dopo la pubblicazione dei nuovi bind group",
);
assert.match(
  engineSource,
  /renderFrame\(timestamp: number\): void \{[\s\S]*?if \(this\.layerPresentationFrozen\) \{[\s\S]*?return;/,
  "nessun frame deve referenziare view evacuate durante la ricostruzione",
);
assert.match(
  engineSource,
  /record\.visible = previousVisible;[\s\S]*?record\.opacity = previousOpacity;[\s\S]*?await engine\.rebuildMergedLayerSurfaces\("layer-switch"\)/,
  "il rollback dello stile deve ricostruire le superfici evacuate dai raw autorevoli",
);
assert.match(
  engineSource,
  /export async function materializeLayerCompositeSource\([\s\S]*?caller: EffectsRetargetCaller,[\s\S]*?retargetEffectsWorkingSetInternal\([\s\S]*?caller,/,
  "la fusione deve conservare l'esenzione history-replay durante i retarget temporanei",
);
assert.match(
  engineSource,
  /foldRasterRecordIntoMergedSurface\([\s\S]*?caller: EffectsRetargetCaller,[\s\S]*?materializeLayerCompositeSource\(engine, record, caller\)/,
);
assert.match(
  engineSource,
  /async activateLayer\([\s\S]*?caller: EffectsRetargetCaller = "layer-switch",[\s\S]*?rebuildMergedLayerSurfaces\(caller\)/,
  "Undo/Redo cross-layer deve propagare il caller anche al compositing dei livelli",
);
assert.match(engineSource, /maybeInjectLayerCompositeFault\(this, "after-candidate-submit"\)/);
assert.match(engineSource, /let activeWorkbenchRestored = false;/);
assert.match(engineSource, /if \(!activeWorkbenchRestored\) \{[\s\S]*?restoreEffectsWorkbenchToActiveLayer\(this, caller, true\)/,
  "un errore durante la fusione deve forzare il retarget inverso del banco");
assert.match(engineSource, /Stato incoerente dopo il compositing: ricarica prima di continuare/);
assert.match(
  engineSource,
  /latchDocumentStateInconsistent\(message: string, trigger\?: unknown\): void/,
  "il latch documentale deve poter conservare l'errore originale e il suo stack",
);
assert.match(engineSource, /firstDocumentInconsistentDiagnostic/);
assert.match(engineSource, /this\.historyStateInconsistent = true;[\s\S]*?this\.historyBusy = true;/,
  "il latch documentale deve bloccare ogni mutazione successiva");
assert.match(engineSource, /releaseFusedLayerBakes\(this\)/);
assert.match(engineSource, /readonly liveMergedSurfaceTextures = new Map<GPUTexture, MergedSurfaceResources>\(\)/);
assert.match(engineSource, /layerCompositeMiB/,
  "le superfici fuse e i bake transitori devono avere righe di memoria distinte");
const compositePipelineStart = engineSource.indexOf("const layerCompositePipelinePromise = compilePipeline(");
const compositePipelineBody = engineSource.slice(compositePipelineStart, compositePipelineStart + 1_100);
assert.match(
  compositePipelineBody,
  /srcFactor: "one", dstFactor: "one-minus-src-alpha"/,
  "la fusione deve usare source-over premoltiplicato",
);
const sourceAtopPipelineStart = engineSource.indexOf(
  "const layerSourceAtopPipelinePromise = compilePipeline(",
);
const sourceAtopPipelineBody = engineSource.slice(sourceAtopPipelineStart, sourceAtopPipelineStart + 1_100);
assert.match(sourceAtopPipelineBody, /srcFactor: "dst-alpha"/,
  "il colore del child deve essere moltiplicato per l'alpha continuo del parent");
assert.match(sourceAtopPipelineBody, /dstFactor: "one-minus-src-alpha"/);
assert.match(sourceAtopPipelineBody, /alpha: \{ operation: "add", srcFactor: "zero", dstFactor: "one" \}/,
  "source-atop deve conservare esattamente l'alpha del parent");
assert.match(clippingGroupShaderSource, /let matte = clamp\(destination\.a, 0\.0, 1\.0\)/);
assert.match(clippingGroupShaderSource, /source\.rgb \* matte \+ destination\.rgb \* \(1\.0 - sourceAlpha\)/);
assert.match(clippingGroupShaderSource, /return group \* display\.clippingParentOpacity/,
  "l'opacità del parent va applicata una sola volta al gruppo isolato");
assert.doesNotMatch(clippingGroupShaderSource, /step\s*\(|threshold|discard/i,
  "i bordi morbidi devono usare tutti i valori alpha, senza soglie");

const clippingSuffixBuildStart = engineSource.indexOf(
  "async function buildActiveClippingSuffixResources(",
);
const clippingSuffixBuildEnd = engineSource.indexOf(
  "async function buildClippingPrefixSurface(",
  clippingSuffixBuildStart,
);
assertSection(
  "suffix ritaglio live ordinato",
  clippingSuffixBuildStart,
  clippingSuffixBuildEnd,
);
const clippingSuffixBuildBody = engineSource.slice(
  clippingSuffixBuildStart,
  clippingSuffixBuildEnd,
);
assert.match(
  clippingSuffixBuildBody,
  /visible\.every\(\(record\) => record\.blendMode === "normal"\)[\s\S]*?buildClippingOverlaySurface\(/,
  "il suffix tutto-Normal deve conservare la superficie aggregata veloce",
);
assert.match(
  clippingSuffixBuildBody,
  /for \(const record of visible\)[\s\S]*?suffixSteps\.push\(\{[\s\S]*?blendMode: record\.blendMode,[\s\S]*?opacity: record\.opacity/,
  "un suffix avanzato deve conservare modo e opacità di ogni child in ordine",
);
assert.match(
  engineSource,
  /buildClippingSuffixStepSurface\([\s\S]*?alignedMergedSurfaceBounds\(bounded, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT\),[\s\S]*?1,[\s\S]*?false,[\s\S]*?foldViewIntoMergedSurface\([\s\S]*?\n\s*1,[\s\S]*?\n\s*DOCUMENT_WIDTH,[\s\S]*?\n\s*DOCUMENT_HEIGHT,[\s\S]*?\n\s*1,[\s\S]*?\n\s*bounded,[\s\S]*?"normal",[\s\S]*?"source-over"/,
  "l'operando child deve essere mip0-only e non deve incorporare l'opacità",
);
assert.match(
  engineSource,
  /buildClippingSuffixStepSurface\([\s\S]*?runGpuAllocationTransaction\([\s\S]*?transaction\.deferRollback\(\(\) => engine\.destroyMergedSurface\(candidate\)\)/,
  "validation/OOM di un operando child deve distruggere il candidato prima del rollback esterno",
);
assert.match(
  layerBlendTileRuntimeSource,
  /for \(const step of activeGroup\.suffixSteps\)[\s\S]*?step\.blendMode,[\s\S]*?step\.opacity,[\s\S]*?"source-atop"/,
  "il tile runtime deve applicare i child avanzati source-atop nell'ordine dello stack",
);
assert.match(
  layerBlendTileRuntimeSource,
  /if \(activeGroup\?\.suffix\)[\s\S]*?sourceForSurface\(activeGroup\.suffix\),[\s\S]*?"normal",[\s\S]*?1,[\s\S]*?"source-atop"/,
  "il tile runtime deve mantenere il fold unico per il suffix tutto-Normal",
);
assert.match(
  layerBlendTileRuntimeSource,
  /const corners = \[[\s\S]*?\[0, 0\],[\s\S]*?\[canvasWidth, 0\],[\s\S]*?\[0, canvasHeight\],[\s\S]*?\[canvasWidth, canvasHeight\]/,
  "la ricostruzione LOD0 deve delimitare il viewport tramite tutti i quattro angoli",
);
assert.match(
  layerBlendTileRuntimeSource,
  /documentX = engine\.viewCenterX[\s\S]*?engine\.viewRotationCos \* displayX[\s\S]*?engine\.viewRotationSin \* displayY[\s\S]*?documentY = engine\.viewCenterY[\s\S]*?- engine\.viewRotationSin \* displayX[\s\S]*?engine\.viewRotationCos \* displayY/,
  "la bbox visibile deve usare la stessa trasformazione inversa ruotata del display WGSL",
);
assert.match(layerBlendTileRuntimeSource, /const margin = 2;/,
  "la bbox LOD0 deve conservare due pixel documento di margine");
assert.match(
  layerBlendTileRuntimeSource,
  /reuseFinalPyramid[\s\S]*?: requiresFullRebuild[\s\S]*?selectedMipLevel === 0[\s\S]*?visibleLodZeroDocumentRect\(engine\)[\s\S]*?: fullDocumentRect/,
  "ogni full rebuild LOD0 deve delimitarsi al viewport, indipendentemente dallo zoom",
);
assert.match(
  layerBlendTileRuntimeSource,
  /function dirtyTileCores\([\s\S]*?for \(let y = rect\.y; y < bottom; y \+= coreExtent\)[\s\S]*?for \(let x = rect\.x; x < right; x \+= coreExtent\)/,
  "un update parziale deve partire dalla dirty reale, non dalla griglia globale da 1022 px",
);
assert.match(
  layerBlendTileRuntimeSource,
  /requireEvenEdges[\s\S]*?rect\.x % 2 !== 0[\s\S]*?rect\.y % 2 !== 0[\s\S]*?rect\.width % 2 !== 0[\s\S]*?rect\.height % 2 !== 0/,
  "i chunk destinati al mip 1 devono conservare bordi document-space pari per il box 2×2",
);
assert.match(
  layerBlendTileRuntimeSource,
  /requiresFullRebuild[\s\S]*?selectedMipLevel > 0[\s\S]*?alignedTileCores\(documentRect, coreExtent\)[\s\S]*?: dirtyTileCores\(documentRect, coreExtent, false\)[\s\S]*?: dirtyTileCores\(documentRect, coreExtent, selectedMipLevel > 0\)/,
  "solo i full rebuild mip 1+ devono restare agganciati alla griglia globale dei core",
);
assert.match(
  layerBlendTileRuntimeSource,
  /selectedMipLevel > 0[\s\S]*?\? core[\s\S]*?: clampDocumentRect\(expandRect\(core, 1\)\)!/,
  "ogni chunk LOD0 deve mantenere l'apron bilineare di un pixel",
);
assert.match(
  layerBlendTileRuntimeSource,
  /targetRect: \{[\s\S]*?x: core\.x \/ 2,[\s\S]*?y: core\.y \/ 2,[\s\S]*?width: core\.width \/ 2,[\s\S]*?height: core\.height \/ 2/,
  "il core mip pari deve essere ridotto esattamente sulla griglia 2×2",
);
assert.match(
  engineSource,
  /group\.suffixSteps\.forEach\(\(step\) => \{[\s\S]*?step\.viewportSegment\.uniformBuffer\.destroy\(\);[\s\S]*?engine\.destroyMergedSurface\(step\.surface\)/,
  "distruzione e rollback devono rilasciare binding viewport e operando child",
);
assert.match(
  engineSource,
  /activeClippingGroup\?\.suffixSteps\.map\(\(step\) => step\.surface\)/,
  "gli operandi child devono entrare nella contabilità GPU del gruppo live",
);

// Oracle premoltiplicato: anche con due child opachi il bordo al 25% del
// parent resta al 25%, invece di crescere a ogni composizione.
const sourceAtop = (source, destination) => {
  const matte = destination[3];
  return [
    source[0] * matte + destination[0] * (1 - source[3]),
    source[1] * matte + destination[1] * (1 - source[3]),
    source[2] * matte + destination[2] * (1 - source[3]),
    matte,
  ];
};
const softParent = [0.25, 0, 0, 0.25];
const firstClip = sourceAtop([0, 1, 0, 1], softParent);
const secondClip = sourceAtop([0, 0, 1, 1], firstClip);
assert.equal(firstClip[3], 0.25);
assert.equal(secondClip[3], 0.25);
assert.deepEqual(secondClip, [0, 0, 0.25, 0.25]);
