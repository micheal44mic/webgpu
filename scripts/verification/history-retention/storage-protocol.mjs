import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Storage locale: ordine di commit, hydrate preflight e fallback ---------
// Queste sono cuciture di sicurezza: i test puri non vedono l'ordine delle
// mutazioni runtime, quindi una release spostata accidentalmente sopra il CAS
// renderebbe verde il planner e perderebbe comunque l'unica copia dei pixel.
{
  const coordinator = readFileSync(
    new URL("../../../src/history-storage-coordinator.ts", import.meta.url),
    "utf8",
  );
  const historyRuntime = readFileSync(
    new URL("../../../src/engine-history-runtime.ts", import.meta.url),
    "utf8",
  );
  const maintenance = readFileSync(
    new URL("../../../src/history-maintenance-runtime.ts", import.meta.url),
    "utf8",
  );
  const idb = readFileSync(
    new URL("../../../src/history-storage-idb.ts", import.meta.url),
    "utf8",
  );
  const opfs = readFileSync(
    new URL("../../../src/history-storage-opfs-worker.ts", import.meta.url),
    "utf8",
  );
  const opfsClient = readFileSync(
    new URL("../../../src/history-storage-opfs-client.ts", import.meta.url),
    "utf8",
  );
  const replayPlanner = readFileSync(
    new URL("../../../src/history-replay-plan.ts", import.meta.url),
    "utf8",
  );
  const rasterImageRuntime = readFileSync(
    new URL("../../../src/engine-raster-image-runtime.ts", import.meta.url),
    "utf8",
  );
  const fillRuntime = readFileSync(
    new URL("../../../src/engine-fill-runtime.ts", import.meta.url),
    "utf8",
  );
  const gpuStorage = readFileSync(
    new URL("../../../src/gpu-history-storage.ts", import.meta.url),
    "utf8",
  );

  const spill = coordinator.slice(
    coordinator.indexOf("private async spillOneSegment"),
    coordinator.indexOf("private async serializeGpuPayload"),
  );
  const manifestCommit = spill.indexOf("await this.catalog.commitSegmentCAS(");
  const ownershipCommit = spill.indexOf("gpuDemotion.commitNoThrow();");
  assert(manifestCommit >= 0 && ownershipCommit > manifestCommit,
    "la release residente deve avvenire soltanto dopo il manifest durable");
  assert(
    spill.indexOf("prepareDemoteMany(gpuSlices)") < manifestCommit,
    "l'intero set GPU va prevalidato prima del CAS, senza release incrementali",
  );
  const postManifest = spill.slice(manifestCommit);
  assert(
    postManifest.includes("demotionStillSafe")
      && postManifest.indexOf("if (demotionStillSafe)")
        < postManifest.indexOf("gpuDemotion.commitNoThrow();"),
    "un gesto foreground durante il CAS deve lasciare residenti i payload prevalidati",
  );
  assert.match(
    maintenance,
    /historyCursor === engine\.historyActions\.length;[\s\S]*?historyLocalStorage\.spillIfNeeded/,
    "lo spill v1 deve partire soltanto al journal end",
  );
  assert(
    maintenance.includes("historyMaintenanceEngineIdle(engine, true)"),
    "lo spill non deve auto-annullarsi quando pubblica busy=spilling",
  );

  const move = historyRuntime.slice(
    historyRuntime.indexOf("export async function moveHistoryCursor"),
    historyRuntime.indexOf("export async function rebuildActiveLayerFromHistory"),
  );
  assert(
    move.indexOf("await engine.historyLocalStorage.prepareHistoryStep(delta);")
      < move.indexOf("engine.history.setCursor(nextCursor);"),
    "target e rollback devono essere residenti prima che il cursore cambi",
  );
  assert(move.includes("cancelHistoryMaintenance(engine);"));
  assert(coordinator.includes("planRasterHistoryReplay({"));
  assert(coordinator.includes("this.host.periodicCheckpointChain("));
  assert(replayPlanner.includes("selectLayerReplayAfterCheckpoint("));
  assert(coordinator.includes("addRasterReplayRequirements("));
  assert(coordinator.includes("[previousCursor, nextCursor]"));
  const prepare = coordinator.slice(
    coordinator.indexOf("async prepareHistoryStep"),
    coordinator.indexOf("private async initializeSession"),
  );
  assert(
    prepare.indexOf("await this.waitForForegroundStorageAccess();")
      < prepare.indexOf("this.payloadsRequiredForStep(delta)"),
    "Undo deve attendere lo spill e ricalcolare poi le dipendenze residenti",
  );
  assert(
    coordinator.includes("this.host.periodicCheckpoints()")
      && coordinator.includes("prepareRasterReplayAtCursor")
      && maintenance.includes("historyColdSeedResidentBytes(checkpoint.seed)")
      && maintenance.includes("rebaseRequiredForReplayBudget")
      && maintenance.includes("currentReplayChainBytes + bytesOf(deltaMask)"),
    "i checkpoint periodici devono poter essere spillati e preidratati con accounting residente",
  );
  const fill = fillRuntime.slice(
    fillRuntime.indexOf("export async function fillAtClientPoint"),
    fillRuntime.indexOf("export const", fillRuntime.indexOf("export async function fillAtClientPoint") + 1),
  );
  assert(
    fill.indexOf("await engine.historyLocalStorage.prepareRasterReplayAtCursor(")
      < fill.indexOf("renderer.encodeLiveCommit("),
    "il Fill deve preidratare il piano di rollback prima di mutare i pixel",
  );
  assert(coordinator.includes("this.host.store.selectionClipBindGroups.clear();"));
  assert(coordinator.includes("Azione History troppo grande per il budget locale"));
  assert(coordinator.includes("diskBudgetBlockedActionIds"));
  assert(coordinator.includes('if (result === "budget-skip") continue;'));
  const diskBudgetGateStart = spill.indexOf(
    "diskBudget.hardBytes <= this.committedBytes",
  );
  assert(diskBudgetGateStart >= 0, "gate budget History non individuato");
  const diskBudgetGate = spill.slice(
    diskBudgetGateStart,
    spill.indexOf("const segmentId = makeId"),
  );
  assert(diskBudgetGate.includes("this.diskBudgetBlockedActionIds.add(actionId)"));
  assert(
    !diskBudgetGate.includes("this.writable = false"),
    "un singolo merge oversize non deve disabilitare globalmente gli spill successivi",
  );
  assert(coordinator.includes("this.consecutiveSpillFailures >= 3"));
  assert(coordinator.includes("failureSignature === this.lastSpillFailureSignature"));
  assert(coordinator.includes("trimHydratedWorkingSetAfterStep"));
  assert(historyRuntime.includes("trimHydratedWorkingSetAfterStep(delta)"));
  assert(!coordinator.includes("localStorage."), "i payload History non vanno in localStorage");

  const floorRetirement = maintenance.slice(
    maintenance.indexOf("// The global floor makes structural Undo below it unreachable."),
    maintenance.indexOf("state.floorCursor = candidateFloor;"),
  );
  assert.match(floorRetirement, /index < candidateFloor/);
  assert.match(floorRetirement, /destroyLayerColdStorage\(input\.entry\.seed\)/);
  assert.match(floorRetirement, /input\.entry\.seed = null/);
  assert.match(floorRetirement, /input\.state = null/);
  assert.match(floorRetirement, /destroyLayerColdStorage\(action\.output\.seed\)/);
  assert.match(floorRetirement, /action\.output\.seed = null/);
  assert.match(floorRetirement, /action\.payloadsRetiredBelowFloor = true/);
  assert(
    maintenance.indexOf("rebuildHistoryAccounting(engine);", maintenance.indexOf(floorRetirement)) >= 0,
    "dopo i tombstone merge il ledger residente deve essere ricostruito",
  );
  assert.match(
    coordinator,
    /onRetire: \(retired\)[\s\S]*?retireStoredPayload\(retired\.payloadId\)/,
    "ritirare un seed merge stored-only deve rimuoverne anche l'ownership locale",
  );

  const serializeGpu = coordinator.slice(
    coordinator.indexOf("private async serializeGpuPayload"),
    coordinator.indexOf("private async serializeColdPayload"),
  );
  assert(
    serializeGpu.indexOf("const rawBytes = raw.byteLength;")
      < serializeGpu.indexOf("await writer.append(bytes)")
      && serializeGpu.indexOf("const rawHash32 = historyHash32(raw);")
        < serializeGpu.indexOf("await writer.append(bytes)"),
    "metadata e hash GPU vanno catturati prima che OPFS detach il buffer",
  );
  const serializeCold = coordinator.slice(
    coordinator.indexOf("private async serializeColdPayload"),
    coordinator.indexOf("private async beginCandidate"),
  );
  assert(
    serializeCold.includes("raw.slice()"),
    "il fallback raw deve sopravvivere al transfer del worker di compressione",
  );
  assert(
    coordinator.includes("await opfs.deleteSegment(sessionId, segmentId);")
      && coordinator.includes("removeSegmentCAS({"),
    "candidati OPFS abortiti e segmenti morti devono essere reclamati",
  );
  assert(
    coordinator.includes("optionalLockManager()")
      && coordinator.includes("ifAvailable: true"),
    "il GC cross-tab deve cancellare soltanto sotto Web Lock esclusivo",
  );
  assert(
    !coordinator.includes(
      'addGpu(batch.selectionMask.gpuSlice, "selection-mask-gpu", batch.actionId, batch.layerId)',
    )
      && !coordinator.includes(
        'addGpu(snapshot.gpuSlice, "selection-mask-gpu", action.id, action.layerId)',
      ),
    "le maschere selezione condivise non devono ereditare un layerId instabile",
  );
  assert(
    maintenance.includes("isHistoryColdSeedHandle(value as LayerColdStorageResources)")
      && maintenance.includes("engine.historyGpuStorage.contains(value as GpuHistorySlice)"),
    "l'estimatore strutturale deve trattare gli handle stored-only come opachi",
  );
  assert(
    rasterImageRuntime.includes("historyColdSeedResidentBytes(seed)"),
    "il budget import deve contare soltanto i seed History residenti",
  );
  assert(
    gpuStorage.includes("sliceById(id: number)")
      && !coordinator.includes("private findGpuSlice"),
    "la telemetria lunga deve usare lookup GPU O(1), non riscansioni del journal",
  );

  assert(idb.includes('const MANIFEST_STORE = "manifestHeads"'));
  assert(idb.includes('const CHUNK_STORE = "idbChunks"'));
  assert(idb.includes("expectedManifestGeneration"));
  assert(idb.includes('durability: "strict"'));
  assert(idb.includes("[SESSION_STORE, MANIFEST_STORE, SEGMENT_STORE]"));
  assert(idb.includes("sessionStore.put({ ...session, opfsMayExist: true })"));
  assert(idb.includes("async removeSegmentCAS(options:"));
  assert(idb.includes("lockProtected: record.lockProtected ?? false"));
  assert(idb.includes("index.openKeyCursor(range)"));
  assert(idb.includes("store.delete(cursor.primaryKey)"));
  assert(!idb.includes("cursor.delete()"));
  assert(idb.includes("Older Safari versions reject the optional third argument"));
  assert(opfs.includes("createSyncAccessHandle"));
  assert(opfs.includes("HISTORY_LOCAL_STORAGE_COMMIT_MAGIC"));
  assert(opfs.includes("writeAll("), "le write parziali OPFS devono avanzare in ciclo");
  assert(opfs.includes("let access: SyncAccessHandle | null = null;"));
  assert(opfs.includes("if (!isNotFound(error)) throw error;"));
  assert(opfsClient.includes("error.name = response.name;"));
  const requireOpfs = coordinator.slice(
    coordinator.indexOf("private async requireOpfs"),
    coordinator.indexOf("private captureToken"),
  );
  assert.doesNotMatch(
    requireOpfs,
    /selfTest\(/,
    "lettura e cleanup OPFS non devono dipendere da una prova di scrittura",
  );
  const deleteSession = coordinator.slice(
    coordinator.indexOf("private async deleteSessionBestEffort"),
    coordinator.lastIndexOf("\n}"),
  );
  assert.doesNotMatch(deleteSession, /selfTest\(/);
  assert(coordinator.includes("cleanupOpfsGarbageCandidates"));
  assert(coordinator.includes("candidate.leaseExpiresAt <= now"));
  assert(coordinator.includes("candidate.lockProtected"));
  assert(coordinator.includes("markSessionLockProtected"));
  assert(coordinator.includes('this.backend = "indexeddb-chunks"'));
  assert(coordinator.includes('this.backend = "memory-only"'));
}

console.log("Session-local History storage protocol verified.");
