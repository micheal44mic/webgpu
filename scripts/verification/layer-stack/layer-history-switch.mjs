import assert from "node:assert/strict";
import { readEngineSource } from "../../engine-source.mjs";
import {
  assertBoundedSourceSection as assertSection,
  readRepositorySource,
} from "../source-contract.mjs";

const engineSource = readEngineSource();
const historyReplayPlanSource = readRepositorySource("src/history-replay-plan.ts");

// Replay is layer-aware through the same pure selector exercised behaviorally by
// history:verify. This assertion is only the integration seam: it prevents the
// engine from drifting back to a second, untested implementation.
const rebuildStart = engineSource.indexOf("export async function rebuildActiveLayerFromHistory(");
assert.notEqual(rebuildStart, -1, "il replay deve dichiarare di ricostruire il livello ATTIVO");
const rebuildBody = engineSource.slice(rebuildStart, rebuildStart + 1_500);
assert.match(
  rebuildBody,
  /const replayPlan = planRasterHistoryReplay\(\{\s*actions: engine\.historyActions,\s*cursor: engine\.historyCursor,\s*batches: engine\.historyBatches,\s*layerId,\s*periodicSelection,\s*\}\)/,
  "il replay reale deve usare l'unico planner condiviso con il preflight storage",
);
assert.match(
  historyReplayPlanSource,
  /const journalSelection = selectLayerReplayAfterCheckpoint\(\s*options\.actions,\s*options\.cursor,\s*options\.batches,\s*options\.layerId,\s*\)/,
  "il planner condiviso deve restare per-livello e checkpoint-aware",
);
assert.match(
  rebuildBody,
  /periodicCheckpointChainForReplay\(engine, layerId\)/,
  "il replay deve preferire il checkpoint periodico più vicino quando è più recente",
);
// Nothing in the replay may index the unfiltered array, or a single stray index
// would reintroduce another layer's batch.
// Il ricevitore è alternato: nella classe è `this`, nei moduli estratti è
// `engine`. Un negativo ancorato a un solo ricevitore non fallirebbe mai.
assert.doesNotMatch(
  engineSource.slice(rebuildStart, rebuildStart + 5_000),
  /(this|engine)\.historyBatches\[/,
  "il replay non deve indicizzare l'array non filtrato",
);

// Crossing another LIVE layer is supported transactionally. Only a step whose
// owner was deleted is refused, both in button state and in the engine API.
assert.match(
  engineSource,
  /export function historyStepBlockedByLayer\(engine: BrushEngine, delta: -1 \| 1\): boolean \{/,
);
const historyGateStart = engineSource.indexOf("export function historyStepBlockedByLayer(");
const historyGateEnd = engineSource.indexOf(
  "export function maybeInjectHistoryReplayFault(",
  historyGateStart,
);
assertSection("historyStepBlockedByLayer", historyGateStart, historyGateEnd);
const historyGateBody = engineSource.slice(historyGateStart, historyGateEnd);
assert.match(
  historyGateBody,
  /return historyStepTargetsMissingLayer\(/,
  "anche il gate per-passo deve usare la funzione pura testata",
);
assert.match(engineSource, /const undoBlockedReason = this\.historyBlockedReason\(-1\)/);
assert.match(engineSource, /const redoBlockedReason = this\.historyBlockedReason\(1\)/);
assert.match(engineSource, /canUndo: undoBlockedReason === null/);
assert.match(engineSource, /canRedo: redoBlockedReason === null/);
const cursorStart = engineSource.indexOf("export async function moveHistoryCursor(");
const cursorEnd = engineSource.indexOf(
  "export async function rebuildActiveLayerFromHistory(",
  cursorStart,
);
const cursorBody = engineSource.slice(cursorStart, cursorEnd);
assert.match(
  cursorBody,
  /if \(historyStepBlockedByLayer\(engine, delta\)\) \{/,
  "il gate deve valere anche chiamando l'API, non solo il bottone",
);
assert.match(
  cursorBody,
  /delta < 0[\s\S]*impossibile annullarlo[\s\S]*impossibile ripristinarlo/,
  "il messaggio del gate deve distinguere Undo da Redo",
);

// The cross-layer transaction has three non-interchangeable phases: derive the
// switch before the awaited activation, restore a partially written TARGET under
// the old cursor, then reactivate the original layer. Reversing the last two loses
// pixels while CPU cursor/index state still looks correct.
const evictStart = engineSource.indexOf("export function evictReconstructibleLayerResources(");
const evictEnd = engineSource.indexOf("export async function ensureActiveLayerHot(", evictStart);
const evictBody = engineSource.slice(evictStart, evictEnd);
assert.match(
  evictBody,
  /if \(record\.hasContent && !gpu\.cold && !gpu\.compressed\)[\s\S]*?throw new Error/,
  "un hot con contenuto non può essere evacuato senza storage raw o compresso autorevole",
);
const evictFreeze = evictBody.indexOf("engine.layerPresentationFrozen = true;");
const evictBake = evictBody.indexOf("engine.destroyLayerBake(gpu.bake);");
const evictHot = evictBody.indexOf("destroyLayerHot(gpu.hot);");
assert.ok(
  evictFreeze >= 0 && evictBake > evictFreeze && evictHot > evictBake,
  "l'evizione deve congelare il display e liberare bake e hot in quest'ordine",
);
const prepareStart = engineSource.indexOf("async prepareActiveLayerForSwitch(");
const prepareBody = engineSource.slice(prepareStart, prepareStart + 1_800);
assert.match(
  prepareBody,
  /if \(import\.meta\.env\.DEV && this\.layerBakeFaultQueue\.length > 0\) \{\s*await bakeActiveLayerForSwitch\(this\);/,
  "il bake completo resta soltanto come sonda transazionale DEV",
);
assert.match(
  prepareBody,
  /this\.layerStack\.active\.id === this\.layerStack\.referenceLayerId[\s\S]*?this\.layerPresentationFrozen = true;[\s\S]*?return;/,
  "il riferimento deve restare hot e autorevole quando si attiva la destinazione",
);
const prepareFreeze = prepareBody.indexOf("await freezeActiveLayerToCold(this);");
const prepareEvict = prepareBody.indexOf(
  "evictReconstructibleLayerResources(this, this.layerStack.active);",
);
assert.ok(
  prepareFreeze >= 0 && prepareEvict > prepareFreeze,
  "la preparazione deve completare il cold autorevole prima dell'evizione",
);
assert.match(prepareBody, /catch \(error\)[\s\S]*?this\.destroyLayerBake\(gpu\.bake\)/,
  "un pack fallito deve rilasciare l'eventuale bake della sonda DEV");

// Moving the one Reference identity is a strict GPU-residency transaction.
// The outgoing Reference becomes cold only after its candidate has completed;
// allocation failure restores the old identity and never substitutes a slower
// source. This protects the no-fallback contract from a future refactor.
const referenceSetStart = engineSource.indexOf("export async function setLayerReference(");
const referenceSetEnd = engineSource.indexOf(
  "export async function shrinkEffectsScratchAfterIdle(",
  referenceSetStart,
);
assertSection("setLayerReference", referenceSetStart, referenceSetEnd);
const referenceSetBody = engineSource.slice(referenceSetStart, referenceSetEnd);
const referenceCandidate = referenceSetBody.indexOf(
  "demotion = await createReferenceLayerDemotion(engine, previousReference);",
);
const referenceIdentityChange = referenceSetBody.indexOf(
  "engine.layerStack.setReferenceIndex(enabled ? index : null);",
);
const referenceColdPublish = referenceSetBody.indexOf(
  "demotion.gpu.cold = demotion.cold;",
);
const referenceHotDestroy = referenceSetBody.indexOf("destroyLayerHot(demotion.hot);");
assert.ok(
  referenceCandidate >= 0
    && referenceCandidate < referenceIdentityChange
    && referenceIdentityChange < referenceColdPublish
    && referenceColdPublish < referenceHotDestroy,
  "il nuovo cold deve completarsi prima del cambio identità e l'hot uscente va distrutto per ultimo",
);
assert.match(
  referenceSetBody,
  /catch \(error\) \{[\s\S]*?if \(referenceChanged\) \{[\s\S]*?setReferenceIndex\(previousIndex >= 0 \? previousIndex : null\);[\s\S]*?retargetFillRendererSource\(engine\);/,
  "un errore prima del commit deve ripristinare identità e sorgente Fill precedenti",
);
assert.match(
  referenceSetBody,
  /if \(demotion\?\.cold\) \{\s*destroyLayerColdStorage\(demotion\.cold\);\s*\}[\s\S]*?throw error;/,
  "il candidato non pubblicato va distrutto e l'errore deve propagarsi senza fallback",
);
assert.doesNotMatch(
  referenceSetBody,
  /ensureActiveLayerHot|createHydratedLayerTexture|setReferenceIndex\(null\)[\s\S]*?return true/,
  "il cambio Riferimento non deve reidratare o degradare silenziosamente sull'attivo",
);

const residencyCommitStart = engineSource.indexOf(
  "export function commitActiveLayerResidency(",
);
const residencyCommitEnd = engineSource.indexOf(
  "export function rebuildActiveLayerPyramidBindings(",
  residencyCommitStart,
);
assertSection("commitActiveLayerResidency", residencyCommitStart, residencyCommitEnd);
const residencyCommitBody = engineSource.slice(residencyCommitStart, residencyCommitEnd);
const referenceResidencyGate = residencyCommitBody.indexOf(
  "previousRecord.id === engine.layerStack.referenceLayerId",
);
const outgoingHotDestroy = residencyCommitBody.indexOf("destroyLayerHot(previousGpu.hot);");
assert.ok(
  referenceResidencyGate >= 0 && outgoingHotDestroy > referenceResidencyGate,
  "il commit dello switch deve uscire prima di distruggere l'hot del Riferimento",
);
const switchedDeclaration = cursorBody.indexOf("const switched =");
const historyOutgoingPrepare = cursorBody.indexOf("await engine.prepareActiveLayerForSwitch();");
const forwardIndexChange = cursorBody.indexOf("engine.layerStack.setActiveIndex(targetIndex);");
const forwardActivation = cursorBody.indexOf(
  'await engine.activateLayer(previousActiveIndex, "history-replay");',
);
assert.ok(switchedDeclaration >= 0 && switchedDeclaration < forwardActivation,
  "switched deve essere noto prima che activateLayer possa fallire");
assert.ok(
  historyOutgoingPrepare > switchedDeclaration && historyOutgoingPrepare < forwardIndexChange,
  "Undo/Redo cross-layer deve preparare il cold ed evacuare l'uscente prima del target",
);
const operationCatch = cursorBody.indexOf("catch (operationError)");
const cursorRestore = cursorBody.indexOf(
  "engine.history.setCursor(previousCursor);",
  operationCatch,
);
const targetRestore = cursorBody.indexOf(
  "await rebuildActiveLayerFromHistory(engine);",
  operationCatch,
);
const rollbackPrepare = cursorBody.indexOf(
  "await engine.prepareActiveLayerForSwitch();",
  operationCatch,
);
const reverseIndex = cursorBody.indexOf(
  "engine.layerStack.setActiveIndex(previousActiveIndex);",
  operationCatch,
);
const reverseActivation = cursorBody.indexOf(
  'await engine.activateLayer(targetIndex, "history-replay");',
  operationCatch,
);
assert.ok(
  operationCatch >= 0
    && cursorRestore > operationCatch
    && targetRestore > cursorRestore
    && rollbackPrepare > targetRestore
    && reverseIndex > rollbackPrepare
    && reverseActivation > reverseIndex,
  "il rollback deve ripristinare, impacchettare e poi lasciare il target",
);
const rollbackEvict = cursorBody.indexOf(
  "evictReconstructibleLayerResources(engine, engine.layerStack.at(targetIndex));",
  operationCatch,
);
assert.ok(
  rollbackEvict > rollbackPrepare && rollbackEvict < reverseIndex,
  "il rollback history deve evacuare il target fallito prima di reidratare l'origine",
);
assert.match(cursorBody, /engine\.historyStateInconsistent = true;/,
  "un rollback fallito deve alzare il latch fatale");
assert.match(cursorBody, /if \(switched && targetPreparedForRelease\)/,
  "un pack fallito deve conservare il full-canvas e impedire lo switch inverso distruttivo");
assert.match(cursorBody, /Ricarica la pagina prima di continuare/,
  "anche l'errore propagato alla UI deve dire che serve il reload");
assert.match(cursorBody, /engine\.historyBusy = engine\.historyStateInconsistent;/,
  "il latch fatale deve mantenere bloccate le mutazioni");
assert.match(cursorBody, /engine\.historyReplayFaultQueue = \[\];/,
  "un fault point non consumato non deve contaminare la transazione successiva");
assert.match(cursorBody, /engine\.layerColdStorageFaultQueue = \[\];/,
  "un fault cold non consumato non deve contaminare la transazione successiva");
assert.match(engineSource, /inconsistent: this\.historyStateInconsistent/,
  "lo stato fatale deve essere osservabile dalla UI e dai test");
// One fault point lands in the half-switch window, after engine/Blend changed
// source but before the workbench; the other lands only after a real GPU submit.
const activateStart = engineSource.indexOf("  async activateLayer(");
const activateEnd = engineSource.indexOf(
  "  destroyThicknessTailOverlayResources(): void",
  activateStart,
);
assertSection("activateLayer", activateStart, activateEnd);
const activateBody = engineSource.slice(activateStart, activateEnd);
const blendRetarget = activateBody.indexOf("this.blendRenderer?.retarget(");
const switchFault = activateBody.indexOf(
  'maybeInjectHistoryReplayFault(this, "during-switch-activation")',
);
const workbenchRetarget = activateBody.indexOf("retargetEffectsWorkingSetInternal(this, ");
assert.ok(
  blendRetarget >= 0 && switchFault > blendRetarget && workbenchRetarget > switchFault,
  "il fault di attivazione deve discriminare davvero uno switch parziale",
);
const replayEnd = engineSource.indexOf(
  "export async function applyVectorHistoryState(",
  rebuildStart,
);
assertSection("rebuildActiveLayerFromHistory", rebuildStart, replayEnd);
const replayBody = engineSource.slice(rebuildStart, replayEnd);
assert.match(replayBody, /maybeInjectHistoryReplayFault\(engine, "after-first-replay-submit"\)/);
assert.ok(
  [...replayBody.matchAll(/observeReplaySubmit\(\);/g)].length >= 4,
  "ogni variante del primo submit Paint/Blend/clear deve raggiungere il fault point",
);
const vectorHistoryStart = replayEnd;
const vectorHistoryEnd = engineSource.indexOf(
  "export function recordBlendHistoryBatch(",
  vectorHistoryStart,
);
assertSection("applyVectorHistoryState", vectorHistoryStart, vectorHistoryEnd);
const vectorHistoryBody = engineSource.slice(vectorHistoryStart, vectorHistoryEnd);
assert.match(
  vectorHistoryBody,
  /caller: EffectsRetargetCaller = "layer-switch"/,
  "il ripristino diretto vettoriale conserva il gate di layer switch",
);
assert.equal(
  (vectorHistoryBody.match(/rebuildMergedLayerSurfaces\(\s*caller,/g) ?? []).length,
  2,
  "commit e rollback vettoriali devono propagare lo stesso caller",
);
assert.match(
  engineSource,
  /crossedAction\.kind === "vector"[\s\S]{0,500}applyVectorHistoryState\([\s\S]{0,240}"history-replay"/,
  "Undo/Redo vettoriale deve dichiarare il contesto History al banco effetti",
);
assert.match(
  vectorHistoryBody,
  /const combined = new Error\([\s\S]*?latchDocumentStateInconsistent\([\s\S]*?combined/,
  "il doppio fallimento vettoriale deve restare diagnosticabile",
);
