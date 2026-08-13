import { readEditorHtml } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";

const stroke = (id, layerId) => ({ id, kind: "stroke", layerId });
const clear = (id, layerId) => ({ id, kind: "clear", layerId });

// La cronologia raster autorevole deve vivere in buffer GPU paginati: sul CPU
// restano soltanto metadati piccoli per l'ordine globale e il replay.
{
  globalThis.GPUBufferUsage ??= { COPY_SRC: 1, COPY_DST: 2, STORAGE: 4 };
  const { GPU_HISTORY_PAGE_BYTES, GpuHistoryStorage } = await import(
    "../../../src/gpu-history-storage.ts"
  );
  const buffers = [];
  const device = {
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
  };
  const storage = new GpuHistoryStorage(device);
  storage.prewarm();
  assert.deepEqual(storage.stats(), {
    allocatedBytes: GPU_HISTORY_PAGE_BYTES,
    usedLogicalBytes: 0,
    usedReservedBytes: 0,
    freeBytes: GPU_HISTORY_PAGE_BYTES,
    pageCount: 1,
    sliceCount: 0,
  });
  const first = storage.allocate(32, "paint");
  storage.trimEmptyPages(true);
  assert.equal(
    storage.stats().pageCount,
    1,
    "una pagina standard viva è già la pagina calda e non va duplicata",
  );
  const second = storage.allocate(GPU_HISTORY_PAGE_BYTES, "second-page");
  assert.equal(storage.stats().allocatedBytes, GPU_HISTORY_PAGE_BYTES * 2);
  assert.equal(storage.stats().usedLogicalBytes, GPU_HISTORY_PAGE_BYTES + 32);
  assert.equal(storage.releaseMany([first, second, first]), 2);
  assert.equal(storage.release(first), false, "una slice non può essere liberata due volte");
  assert.equal(storage.release(second), false, "releaseMany deve liberare entrambe le pagine");
  storage.trimEmptyPages(true);
  assert.equal(storage.stats().allocatedBytes, GPU_HISTORY_PAGE_BYTES);
  assert.equal(storage.stats().pageCount, 1);
  assert.equal(buffers.filter((buffer) => buffer.destroyed).length, 1);
  const aligned = storage.allocate(5, "alignment");
  assert.equal(aligned.logicalBytes, 5);
  assert.equal(aligned.reservedBytes, 8);
  const storageAligned = storage.allocate(12, "storage-alignment", 256);
  assert.equal(storageAligned.offsetBytes % 256, 0);
  const atomicFirst = storage.allocate(16, "atomic-first");
  const atomicLast = storage.allocate(16, "atomic-last");
  const allocatorBeforeInvalidRelease = storage.stats();
  assert.throws(
    () => storage.prepareReleaseMany([
      atomicFirst,
      { ...atomicLast, label: "foreign-copy" },
    ]),
    /non appartenente/,
    "una slice finale non valida deve impedire la release dell'intero set",
  );
  assert.deepEqual(
    storage.stats(),
    allocatorBeforeInvalidRelease,
    "prepareReleaseMany non deve liberare il prefisso prima di validare la coda",
  );
  assert.equal(storage.releaseMany([atomicFirst, atomicLast]), 2);

  const demoted = storage.allocate(20, "stored-only-handle");
  const preparedDemotion = storage.prepareDemoteMany([demoted]);
  assert.equal(preparedDemotion.sliceCount, 1);
  assert.equal(preparedDemotion.commitNoThrow(), 1);
  assert.equal(storage.isResident(demoted), false);
  assert.throws(
    () => demoted.buffer,
    /non reidratata/,
    "un replay senza preflight hydrate deve fallire prima di leggere un buffer morto",
  );
  assert.equal(storage.release(demoted), true, "un handle stored-only resta ritirabile");
  assert.throws(
    () => storage.allocate(4, "bad-alignment", 24),
    /potenza di due/,
  );
  storage.destroy();
  assert.equal(buffers.every((buffer) => buffer.destroyed), true);

  const oversizedStorage = new GpuHistoryStorage(device);
  oversizedStorage.prewarm();
  oversizedStorage.trimEmptyPages(false);
  const oversized = oversizedStorage.allocate(
    GPU_HISTORY_PAGE_BYTES + 4,
    "oversized-live-page",
  );
  oversizedStorage.trimEmptyPages(true);
  assert.equal(
    oversizedStorage.stats().pageCount,
    2,
    "una slice oversized viva deve avere comunque una pagina standard calda",
  );
  assert.equal(oversizedStorage.release(oversized), true);
  oversizedStorage.destroy();
}

{
  const engine = readEngineSource();
  const blendRenderer = readFileSync(
    new URL("../../../src/blend-renderer.ts", import.meta.url),
    "utf8",
  );
  const brushEngine = readFileSync(
    new URL("../../../src/brush-engine.ts", import.meta.url),
    "utf8",
  );
  const rasterStyleRuntime = readFileSync(
    new URL("../../../src/engine-raster-style-runtime.ts", import.meta.url),
    "utf8",
  );
  const selectionRuntime = readFileSync(
    new URL("../../../src/engine-selection-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyRuntime = readFileSync(
    new URL("../../../src/engine-history-runtime.ts", import.meta.url),
    "utf8",
  );
  const mixedSceneMutationRuntime = readFileSync(
    new URL("../../../src/engine-mixed-scene-mutation-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyService = readFileSync(
    new URL("../../../src/history-service.ts", import.meta.url),
    "utf8",
  );
  const transformRuntime = readFileSync(
    new URL("../../../src/engine-raster-transform-runtime.ts", import.meta.url),
    "utf8",
  );
  const main = readFileSync(new URL("../../../src/main.ts", import.meta.url), "utf8");
  const gpuMemoryPanel = readFileSync(
    new URL("../../../src/gpu-memory-panel-controller.ts", import.meta.url),
    "utf8",
  );
  const rasterAdjustments = readFileSync(
    new URL("../../../src/raster-adjustments-controller.ts", import.meta.url),
    "utf8",
  );
  const canvasInput = readFileSync(
    new URL("../../../src/canvas-input-controller.ts", import.meta.url),
    "utf8",
  );
  const humanLab = readFileSync(
    new URL("../../../src/labs/human-stroke-lab.ts", import.meta.url),
    "utf8",
  );
  const html = readEditorHtml();
  const effectsSheet = readFileSync(
    new URL("../../../src/mobile-raster-effects-sheet.ts", import.meta.url),
    "utf8",
  );
  const strokeSheet = readFileSync(
    new URL("../../../src/mobile-stroke-sheet.ts", import.meta.url),
    "utf8",
  );
  const toolSheet = readFileSync(
    new URL("../../../src/mobile-tool-settings-sheet.ts", import.meta.url),
    "utf8",
  );
  const paintBatch = engine.slice(
    engine.indexOf("interface PaintHistoryRenderBatch"),
    engine.indexOf("interface BlendHistoryRenderBatch"),
  );
  assert(!paintBatch.includes("stamps:"), "La storia Paint non deve trattenere array Stamp CPU.");
  assert(paintBatch.includes("gpuSlice: GpuHistorySlice"));
  assert(paintBatch.includes("stampCount: number"));
  assert(paintBatch.includes("selectionMask: SelectionHistoryMaskSnapshot | null"));
  assert(engine.includes('"gpu-only-packed-payload-no-cpu-stamp-arrays"'));
  assert(engine.includes('"clear-and-gpu-buffer-copy-replay"'));
  assert(engine.includes("replayBatch.gpuSlice.buffer"));
  assert(engine.includes("this.instanceBuffer,"));
  assert(engine.includes("slice.buffer,"));
  assert(
    engine.includes(
      "GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST",
    ),
    "Il buffer stamp deve poter essere copiato nella cronologia GPU.",
  );
  assert(engine.includes("historyGpuMiB,"));
  assert(engine.includes("historyGpuUsedMiB,"));
  assert(engine.includes("historyGpuPageCount: historyGpu.pageCount"));
  assert(engine.includes("selectionRevisionsToRelease"));
  assert(engine.includes("releaseSlicePhase("));
  assert(engine.includes("selectionHistoryMasksByAction"));
  assert(engine.includes("selectionHistoryMasksByRevision"));
  assert(selectionRuntime.includes("identity: engine.pixelSelectionIdentity"));
  assert(selectionRuntime.includes("engine.selectionHistoryMasksByRevision.get(revision)"));
  assert(selectionRuntime.includes("engine.selectionHistoryMasksByRevision.set(revision, snapshot)"));
  const beginStroke = brushEngine.slice(
    brushEngine.indexOf("  beginStrokeAtLayer(point: LayerPoint): boolean"),
    brushEngine.indexOf("  extendStroke(samples: readonly PointerSample[]): void"),
  );
  assert(beginStroke.includes("return false;"));
  assert(beginStroke.includes("return true;"));
  assert(
    beginStroke.indexOf("capturePaintSelectionHistoryMask(this, historyActionId)") >= 0
      && beginStroke.indexOf("capturePaintSelectionHistoryMask(this, historyActionId)")
        < beginStroke.indexOf("this.history.reserveActionId()"),
    "Paint deve congelare la selezione storica prima di avanzare o renderizzare l'azione.",
  );
  const rasterPropertyHandshake = brushEngine.slice(
    brushEngine.indexOf("  beginRasterLayerMetadataHistoryEdit("),
    brushEngine.indexOf("  beginVectorHistoryEdit("),
  );
  assert.match(
    rasterPropertyHandshake,
    /\): number \| null[\s\S]*?active\.layerId === layerId && active\.property === property[\s\S]*?\? active\.token[\s\S]*?: null/,
    "Un edit già aperto deve restituire il token soltanto per lo stesso livello e proprietà.",
  );
  assert.match(
    rasterPropertyHandshake,
    /commitRasterLayerMetadataHistoryEdit\(token: number\)[\s\S]*?!edit \|\| edit\.token !== token/,
    "Un commit stale non deve chiudere la transazione di un altro controllo.",
  );
  assert.match(
    rasterPropertyHandshake,
    /edit\.layerId !== before\.layerId \|\| edit\.property !== property/,
    "Bevel, Shadow e Stroke non devono mai assorbirsi nella stessa azione.",
  );
  assert.match(
    rasterPropertyHandshake,
    /cancelRasterLayerMetadataHistoryEdit\(token: number\)[\s\S]*?rasterLayerMetadataHistoryStatesEqual\(edit, current\)/,
    "Cancel può abbandonare soltanto un handshake ancora immutato, mai perdere un effetto già visibile.",
  );
  for (const [method, property] of [
    ["applyRasterColorOverlayStyle", "color-overlay"],
    ["applyRasterStrokeStyle", "stroke"],
    ["applyRasterBevelStyle", "bevel"],
    ["applyRasterOuterShadowStyle", "outer-shadow"],
    ["applyRasterInnerShadowStyle", "inner-shadow"],
  ]) {
    assert.match(
      rasterStyleRuntime,
      new RegExp(`function ${method}\\([\\s\\S]{0,180}?style: unknown[\\s\\S]{0,900}?history\\.allows\\("${property}"\\)`),
      `${method} deve rifiutare una transazione di un altro effetto prima di mutare risorse.`,
    );
  }
  assert.match(
    brushEngine,
    /rasterStyleHistoryPort\(\)[\s\S]{0,260}rasterLayerMetadataHistoryEditAllows\(property\)[\s\S]{0,180}recordRasterLayerMetadataMutation\(property, before\)/,
    "la facade deve esporre al runtime stile soltanto le due porte History necessarie",
  );
  assert.match(
    main,
    /historyState\.openEdit === "transform"[\s\S]{0,260}rasterAdjustmentsController\?\.hasActiveHistoryEdit\(historyState\)[\s\S]{0,180}historyState\.openEdit === "raster-property"/,
    "Le modifiche ai pixel devono restare bloccate finché l'effetto non ha committato la cronologia.",
  );
  assert.match(
    rasterAdjustments,
    /history\.openEdit === "liquify"[\s\S]{0,180}history\.openEdit === "gaussian-blur"[\s\S]{0,180}history\.openEdit === "motion-blur"[\s\S]{0,180}history\.openEdit === "noise"/,
    "Il controller deve riconoscere tutti e quattro gli edit distruttivi aperti.",
  );
  assert.match(
    main,
    /function canvasViewOperationLocked\(\)[\s\S]{0,260}rasterAdjustmentsController\?\.allowsCanvasViewOperation\(historyState\)/,
    "I Blur distruttivi devono separare la navigazione del canvas dal lock delle modifiche ai pixel.",
  );
  const canvasPointerDown = canvasInput.slice(
    canvasInput.indexOf("const handlePointerDown ="),
    canvasInput.indexOf("const handlePointerMove ="),
  );
  assert(
    canvasPointerDown.indexOf("if (!engine.beginStroke(paintSample))") >= 0
      && canvasPointerDown.indexOf("if (!engine.beginStroke(paintSample))")
        < canvasPointerDown.lastIndexOf("canvas.setPointerCapture(event.pointerId)"),
    "Un begin Paint rifiutato non deve acquisire il puntatore né simulare uno stroke attivo.",
  );
  const recordPaintBatch = brushEngine.slice(
    brushEngine.indexOf("  recordHistoryBatch("),
    brushEngine.indexOf("  resetHistoryState(): void"),
  );
  assert(recordPaintBatch.includes("this.selectionHistoryMasksByAction.get(actionId) ?? null"));
  assert(!recordPaintBatch.includes("capturePaintSelectionHistoryMask("));
  assert(historyRuntime.includes("engine.pixelSelectionIdentity === expectedSelection.identity"));
  assert(historyRuntime.includes("await restorePixelSelectionHistoryMask(engine, targetSelection)"));
  assert(historyRuntime.includes(
    "wand/lasso/color selection must survive raster Undo/Redo unchanged",
  ));
  assert(engine.includes("lastVisiblePaintBatchIndexByAction"));
  assert(
    engine.indexOf("historyGpuMiB,", engine.indexOf("const countedTotalMiB")) >= 0,
    "Le pagine GPU della cronologia devono essere incluse nel totale.",
  );
  const blendGeometry = blendRenderer.slice(
    blendRenderer.indexOf("export interface DryBlendHistoryGeometry"),
    blendRenderer.indexOf("export interface DryBlendGpuCopyRegion"),
  );
  assert(!blendGeometry.includes("steps:"), "La storia Blend non deve trattenere step CPU.");
  assert(blendRenderer.includes("historyTransfer.replay.buffer"));
  assert(blendRenderer.includes("historyTransfer.capture.buffer"));
  assert(gpuMemoryPanel.includes('["gpuMemoryHistory", "historyGpuMiB"]'));
  assert(!engine.includes("runHistoryCapturePerformanceProbe"));
  assert(!main.includes("runHistoryPerformanceProbeDev"));
  assert(humanLab.includes("performance: profile"));
  assert(!main.includes("history CPU"));
  assert(gpuMemoryPanel.includes("historyGpuUsedMiB"));
  assert(html.includes('id="gpuMemoryHistoryLabel"'));
  assert(html.includes("La cronologia raster mostra pagine GPU riservate"));
  assert(engine.includes('kind: "layer-metadata"'));
  assert(engine.includes("captureRasterLayerMetadataHistoryState"));
  assert(engine.includes("applyRasterLayerMetadataHistoryState"));
  assert(engine.includes("restoreClippingHistoryState("));
  assert(engine.includes('action.property === "visibility"'));
  assert(engine.includes('action.property === "opacity"'));
  assert(engine.includes('action.property === "clipping"'));
  assert.match(
    engine,
    /restoreEffectsWorkbenchToActiveLayer\(\s*engine,\s*"history-replay",\s*true,\s*"content-bounds",\s*\)/,
    "Undo/Redo di un singolo effetto deve ricostruire soltanto il dominio visivo del contenuto.",
  );
  assert(!engine.includes("restoreClippingHistoryState(target.clipping)"));
  assert(!engine.includes("record.visible = target.visible"));
  assert(!engine.includes("record.opacity = target.opacity"));
  assert(engine.includes("undoBlockedReason"));
  assert(engine.includes("redoBlockedReason"));
  assert(effectsSheet.includes("commitHistoryEditIfIdle"));
  assert(strokeSheet.includes("commitHistoryEditIfIdle"));
  assert.match(effectsSheet, /applyLoop = null;[\s\S]{0,180}commitHistoryEditIfIdle/);
  assert.match(strokeSheet, /applyLoop = null;[\s\S]{0,180}commitHistoryEditIfIdle/);
  assert.match(toolSheet, /visibilitychange[\s\S]{0,180}commitOpenHistoryEdits/);
  assert.match(toolSheet, /pagehide[\s\S]{0,100}commitOpenHistoryEdits/);
  assert.match(
    toolSheet,
    /commitOpenHistoryEdits\(\): void \{[\s\S]{0,120}finishSvgPaintEdit\(\)[\s\S]{0,120}finishVectorPropertyEdit\(\)/,
  );
  assert.match(
    toolSheet,
    /input\.addEventListener\("change"[\s\S]{0,500}finally[\s\S]{0,100}finishSvgPaintEdit/,
  );

  const moveCursor = engine.slice(
    engine.indexOf("export async function moveHistoryCursor"),
    engine.indexOf("export async function rebuildActiveLayerFromHistory"),
  );
  assert.match(engine, /publishStatus\(message: string, kind:[\s\S]{0,220}catch \(error\)/);
  assert.doesNotMatch(
    moveCursor,
    /callbacks\.onStatus/,
    "gli observer UI non devono lasciare historyBusy bloccato prima del finally",
  );
  assert.match(
    moveCursor,
    /await rebuildActiveLayerFromHistory\(engine\);[\s\S]{0,4200}publishRasterSceneAfterUnlock = true;[\s\S]{0,2500}engine\.historyBusy = engine\.historyStateInconsistent;[\s\S]{0,250}publishMixedScene\(engine\);[\s\S]{0,120}engine\.publishStats\(\);/,
    "il replay raster deve aggiornare la bbox dell'overlay dopo Undo/Redo",
  );
  const addLayer = engine.slice(
    engine.indexOf("  async addLayer("),
    engine.indexOf("  async setActiveLayer("),
  );
  // Contratto cambiato il 6 agosto 2026: la creazione di un livello e' ora
  // journaled. Prima troncava il Redo perche' un'inserzione non registrata
  // rendeva inapplicabili le azioni `scene-reorder`, che conservano un ordine
  // assoluto; registrandola, lo stato a qualsiasi cursore si ottiene applicando
  // le azioni in ordine. Senza queste asserzioni un ritorno al vecchio
  // comportamento renderebbe la creazione non annullabile senza che nulla lo
  // segnali.
  assert.match(
    addLayer,
    /kind: "layer-add"/,
    "la creazione di un livello deve registrare un'azione journaled",
  );
  assert.match(
    addLayer,
    /const selectedKeyBefore = this\.mixedSceneStack\?\.selected\.key \?\? null;/,
    "lo stato selezionato va catturato prima dell'inserimento, non dopo",
  );
  assert.match(
    addLayer,
    /const activeRasterLayerIdBefore = this\.layerStack\.active\.id;/,
    "il raster attivo precedente va catturato prima dell'inserimento",
  );
  assert.match(
    addLayer,
    /commitHistoryActionAtomically\(this, action\);/,
    "l'azione di creazione deve pubblicare journal e troncamento Redo atomicamente",
  );

  // Ogni lista allungata dal piano di branch appartiene alla stessa transazione
  // del nuovo proprietario History. Un fault deve ripristinare journal, batch,
  // accounting e tutte le liste senza riusare push.
  const atomicCommit = historyRuntime.slice(
    historyRuntime.indexOf("export function commitHistoryActionAtomically("),
    historyRuntime.indexOf("export function historyStepBlockedByLayer("),
  );
  assert.ok(atomicCommit.length > 0, "helper di commit history atomico non individuato");
  assert.match(
    atomicCommit,
    /engine\.history\.commitAction\(action, options\)/,
    "il runtime deve delegare la pubblicazione all'unico proprietario History",
  );
  for (const [field, snapshot] of [
    ["discardedVectorRasterActions", "discardedVectorLength"],
    ["discardedRasterImportActions", "discardedImportLength"],
    ["discardedRasterTransformActions", "discardedTransformLength"],
    ["discardedLayerAddActions", "discardedLayerAddLength"],
    ["discardedLayerDeleteActions", "discardedLayerDeleteLength"],
    ["discardedLayerMergeActions", "discardedLayerMergeLength"],
  ]) {
    assert.match(
      historyService,
      new RegExp(`this\\.${field}\\.length = snapshot\\.${snapshot}`),
      `${field} deve tornare alla propria lunghezza se la pubblicazione fallisce`,
    );
  }
  assert.match(
    historyService,
    /target\[prefixLength \+ index\] = tail\[index\]/,
    "il ramo Redo va ricostruito senza riusare il push eventualmente guastato",
  );
  assert.match(
    historyService,
    /const preparedBranchCut = snapshot\.redoActions\.length > 0[\s\S]*?this\.hooks\.prepareBranchCut\(\)/,
    "il branch storage deve essere preparato prima di mutare il journal",
  );
  assert.match(
    brushEngine.slice(
      brushEngine.indexOf("  commitRasterImportHistory("),
      brushEngine.indexOf("  beginRasterLayerTransform("),
    ),
    /commitHistoryActionAtomically\(this, action\)/,
    "anche l'import raster deve usare il commit che ripristina tutte le liste di scarto",
  );
  assert.match(
    transformRuntime,
    /commitHistoryActionAtomically\(engine, action\)/,
    "Trasforma deve usare il commit che ripristina anche le layer-delete scartate",
  );
  for (const [name, body] of [
    ["deleteLayer", brushEngine.slice(
      brushEngine.indexOf("  async deleteLayer("),
      brushEngine.indexOf("  measuredGpuMemory()"),
    )],
    ["rasterizeVectorNode", brushEngine.slice(
      brushEngine.indexOf("  private async rasterizeVectorNode("),
      brushEngine.indexOf("  async rasterizeVectorTextNode("),
    )],
  ]) {
    assert.match(body, /commitHistoryActionAtomically\(this, action\)/,
      `${name}: il journal va pubblicato atomicamente`);
    assert.match(body, /catch \(error\)[\s\S]*rollback|catch \(error\)[\s\S]*apply.*-1/,
      `${name}: un commit rifiutato deve annullare anche la mutazione del documento`);
  }

  // Il compattatore non deve fidarsi ciecamente della lista di scarto: una
  // layer-delete ancora trattenuta nel journal conserva i propri seed.
  assert.match(
    historyRuntime,
    /retainedLayerDeleteIds\.add\(action\.id\)/,
    "le layer-delete vive vanno marcate durante la scansione del journal",
  );
  assert.match(
    historyRuntime,
    /if \(!retainedLayerDeleteIds\.has\(action\.id\)\) layerDeleteActionsToDestroy\.push\(action\)/,
    "solo le layer-delete davvero abbandonate possono essere distrutte",
  );
  assert.doesNotMatch(
    historyRuntime,
    /for \(const action of engine\.discardedLayerDeleteHistoryActions\) \{\s*destroyLayerDeleteHistorySeeds/,
    "vietata la distruzione incondizionata della lista layer-delete",
  );
  assert.match(
    historyRuntime,
    /retainedLayerMergeIds\.add\(action\.id\)/,
    "i merge vivi vanno marcati durante la scansione del journal",
  );
  assert.match(
    historyRuntime,
    /if \(!retainedLayerMergeIds\.has\(action\.id\)\) layerMergeActionsToDestroy\.push\(action\)/,
    "solo i merge davvero abbandonati possono perdere i seed input/output",
  );

  // Le raster-run sono nominate dagli ID, non dagli stili: una modifica raster
  // non puo' usare l'ottimizzazione riservata alle sole mutazioni vettoriali.
  const metadataPresentation = historyRuntime.slice(
    historyRuntime.indexOf("async function refreshRasterLayerMetadataPresentation("),
    historyRuntime.indexOf("export async function applyRasterLayerMetadataHistoryState("),
  );
  assert.doesNotMatch(
    metadataPresentation,
    /reuseUnchangedRasterRuns: true/,
    "Undo/Redo metadata raster deve rigenerare le run cambiate",
  );
  assert.match(
    metadataPresentation,
    /else \{[\s\S]*await engine\.rebuildMergedLayerSurfaces\([\s\S]*"history-replay"/,
    "anche gli effetti di un raster inattivo devono ricostruire la sua run",
  );

  const rasterReplay = engine.slice(
    engine.indexOf("export async function rebuildActiveLayerFromHistory"),
    engine.indexOf("export async function applyVectorHistoryState"),
  );
  const seedBranchStart = rasterReplay.indexOf("if (hasReplaySeed) {");
  const seedClear = rasterReplay.indexOf(
    "engine.submitImmediate(\n        [],\n        true,\n        engine.settings,\n        false,\n        null,",
    seedBranchStart,
  );
  const seedHydration = rasterReplay.indexOf(
    "encodeLayerColdHydration(encoder, replaySeed, hot);",
    seedClear,
  );
  const seedOnlyPresentation = rasterReplay.indexOf(
    "if (lastVisibleBatchIndex < 0) {",
    seedHydration,
  );
  const seedOnlyDirtyBounds = rasterReplay.indexOf(
    "replaySeedBounds,\n          true,",
    seedOnlyPresentation,
  );
  assert(
    seedBranchStart >= 0
      && seedClear > seedBranchStart
      && seedHydration > seedClear
      && seedOnlyPresentation > seedHydration
      && seedOnlyDirtyBounds > seedOnlyPresentation,
    "Undo Fill sul raster vettoriale deve fare clear nascosto, hydration e una sola presentazione del seed",
  );
  assert.doesNotMatch(
    rasterReplay.slice(seedBranchStart, seedHydration),
    /lastVisibleBatchIndex < 0/,
    "il clear precedente al seed non deve mai diventare la presentazione finale",
  );
  assert(rasterReplay.includes("periodicCheckpointChainForReplay(engine, layerId)"));
  assert(rasterReplay.includes("periodicChain.flatMap"));

  const vectorMutation = mixedSceneMutationRuntime;
  const vectorHistoryApply = engine.slice(
    engine.indexOf("export async function applyVectorHistoryState"),
    engine.indexOf("export function recordBlendHistoryBatch"),
  );
  const layerActivation = engine.slice(
    engine.indexOf("  async activateLayer("),
    engine.indexOf("  destroyThicknessTailOverlayResources(): void"),
  );
  for (const [label, source] of [
    ["mutazione vettoriale", vectorMutation],
    ["Undo/Redo vettoriale", vectorHistoryApply],
  ]) {
    assert(source.includes("clearVectorTextPresentationForTransaction(engine)"),
      `${label}: il clear deve restare transazionale`);
    assert(source.includes("reuseUnchangedRasterRuns: true"),
      `${label}: i raster-run invariati devono restare residenti`);
    assert(!/(this|engine)\.clearVectorTextPresentation\(\);/.test(source),
      `${label}: un clear normale riaprirebbe il ciclo freeze/waitForIdle`);
  }
  assert.match(
    layerActivation,
    /caller === "history-replay"[\s\S]*?clearVectorTextPresentationForTransaction\(this\)/,
    "il cambio layer attraversato dalla cronologia non deve invalidare mentre è congelato",
  );
}
