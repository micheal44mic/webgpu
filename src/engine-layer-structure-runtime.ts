/**
 * Mutazioni strutturali di livello: creazione e cancellazione, annullabili.
 *
 * Il modello non e' nuovo. `raster-import` e' gia' un'azione journaled che crea
 * un livello conservandone record, posizione nello stack e nella scena, e pixel
 * in un seed; il suo Undo lo stacca e il suo Redo lo riattacca. Cancellare un
 * livello **e'** quell'Undo, e annullare la cancellazione **e'** quel Redo.
 * Questo modulo estrae quelle due direzioni e le riusa per entrambe le azioni,
 * invece di duplicarle: due percorsi paralleli sarebbero destinati a divergere.
 *
 * Cancellare un parent di ritaglio si porta via **l'intera unita'**. Una
 * maschera senza il suo parent verrebbe disegnata come livello normale e
 * cambierebbe l'immagine; promuoverla in silenzio sarebbe peggio che rifiutare.
 * L'operazione e' annullabile, quindi il costo di sbagliare e' un tap.
 */
import type { BrushEngine } from "./brush-engine";
import type {
  DeletedLayerEntry,
  LayerAddHistoryAction,
  LayerDeleteHistoryAction,
} from "./engine-history-types";
import type { LayerGpuResources } from "./engine-layer-resources";
import { destroyLayerColdStorage } from "./engine-cold-storage";
import {
  allocateLayerGpuResources,
  destroyLayerGpuResources,
} from "./engine-layer-runtime";
import {
  hydrateLayerFromSeed,
  switchActiveForStructuralHistory,
} from "./engine-raster-image-runtime";
import {
  clearVectorTextPresentationForTransaction,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";

export const LAYER_STRUCTURE_HISTORY_STRATEGY =
  "journaled-add-and-delete-clipping-unit-atomic-seeded-restore-v1" as const;

/**
 * Stacca un livello vivo conservandone il record. Non distrugge il record:
 * l'azione di storia lo tiene per poterlo riattaccare, ed e' la stessa cosa che
 * fa l'Undo di un import raster.
 *
 * Restituisce le posizioni osservate **al momento reale dello stacco**, non
 * quelle attese: fra la registrazione dell'azione e la sua esecuzione il
 * documento puo' essere stato riordinato.
 */
async function detachLayer(
  engine: BrushEngine,
  layerId: number,
  fallbackLayerId: number,
): Promise<{ rasterLayerIndex: number; sceneIndex: number }> {
  const scene = requireMixedSceneStack(engine);
  const targetIndex = engine.layerStack.indexOfId(layerId);
  if (targetIndex < 0) throw new Error(`Livello ${layerId} da staccare non presente.`);
  const sceneIndex = scene.indexOfKey(`raster:${layerId}`);
  if (sceneIndex < 0) {
    throw new Error(`Livello ${layerId} assente dalla scena mista durante lo stacco.`);
  }
  const gpu = engine.layerGpu.get(layerId);
  if (!gpu) throw new Error(`Risorse GPU del livello ${layerId} mancanti.`);
  const record = engine.layerStack.at(targetIndex);

  // Prima la scena, poi lo stack: il contrario lascia una chiave raster che
  // punta a un livello inesistente, e la presentazione lo rileva subito.
  scene.removeRaster(layerId, fallbackLayerId);
  const detachedIndex = engine.layerStack.indexOfId(layerId);
  const detached = engine.layerStack.remove(detachedIndex);
  if (detached !== record) throw new Error(`Stacco del livello ${layerId} incoerente.`);
  engine.layerGpu.delete(layerId);
  destroyLayerGpuResources(engine, gpu);
  return { rasterLayerIndex: targetIndex, sceneIndex };
}

/**
 * Riattacca un livello staccato, reidratandone i pixel quando esistono. Un
 * `seed` nullo e' il caso legittimo del livello vuoto: non c'e' nulla da
 * ricostruire, e allocare comunque una texture piena sarebbe memoria sprecata.
 */
async function attachLayer(
  engine: BrushEngine,
  entry: DeletedLayerEntry,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const layerId = entry.layerRecord.id;
  if (engine.layerStack.indexOfId(layerId) >= 0) {
    throw new Error(`Livello ${layerId} gia' presente durante il ripristino.`);
  }
  if (engine.layerGpu.has(layerId)) {
    throw new Error(`Risorse GPU del livello ${layerId} gia' presenti durante il ripristino.`);
  }
  // L'ultimo livello non e' cancellabile, quindi esiste sempre un raster vivo
  // che puo' ricevere la selezione se la compensazione deve rimuovere la voce
  // appena inserita nella scena.
  const fallbackLayerId = engine.layerStack.active.id;
  let gpu: LayerGpuResources | null = null;
  try {
    if (entry.seed) {
      gpu = await hydrateLayerFromSeed(engine, layerId, entry.seed);
      if (entry.baseBounds) {
        entry.layerRecord.contentBounds = { ...entry.baseBounds };
        entry.layerRecord.hasContent = true;
      }
    } else {
      gpu = await allocateLayerGpuResources(
        engine,
        engine.layerFormat,
        `Ripristino livello vuoto ${layerId}`,
      );
    }
    if (!gpu) throw new Error(`Risorse del livello ${layerId} non allocate.`);
    const rasterInsertionIndex = Math.min(entry.rasterLayerIndex, engine.layerStack.count);
    const sceneInsertionIndex = Math.min(entry.sceneIndex, scene.items.length);
    engine.layerStack.attach(entry.layerRecord, rasterInsertionIndex);
    engine.layerGpu.set(layerId, gpu);
    scene.insertRasterAt(layerId, sceneInsertionIndex, true);
    if (entry.clippingParentId !== null) {
      engine.layerStack.setClippingParent(
        engine.layerStack.indexOfId(layerId),
        entry.clippingParentId,
      );
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];

    // I metodi mutanti possono lanciare dopo aver scritto: per decidere cosa
    // compensare si osserva lo stato vivo, non un flag aggiornato dal chiamante.
    if (scene.indexOfKey(`raster:${layerId}`) >= 0) {
      try {
        scene.removeRaster(layerId, fallbackLayerId);
      } catch (sceneError) {
        if (scene.indexOfKey(`raster:${layerId}`) >= 0) rollbackErrors.push(sceneError);
      }
    }
    const stackIndex = engine.layerStack.indexOfId(layerId);
    if (stackIndex >= 0) {
      try {
        engine.layerStack.remove(stackIndex);
      } catch (stackError) {
        if (engine.layerStack.indexOfId(layerId) >= 0) rollbackErrors.push(stackError);
      }
    }

    if (engine.layerStack.indexOfId(layerId) < 0) {
      if (engine.layerGpu.get(layerId) === gpu) engine.layerGpu.delete(layerId);
      try {
        if (gpu) destroyLayerGpuResources(engine, gpu);
      } catch (gpuError) {
        rollbackErrors.push(gpuError);
      }
    } else {
      rollbackErrors.push(
        new Error(`Livello ${layerId} rimasto nello stack dopo attach fallito.`),
      );
    }

    if (rollbackErrors.length > 0) {
      engine.latchDocumentStateInconsistent(
        "Ripristino livello fallito e compensazione incompleta: ricarica la pagina.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const details = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      throw new Error(`${originalMessage}; rollback attach fallito: ${details}`);
    }
    throw error;
  }
}

/**
 * Annulla la parte strutturale gia' applicata quando la transazione fallisce a
 * meta'. Serve perche' lo stacco e' **distruttivo**: toglie il record dallo
 * stack e distrugge le risorse GPU. Ripristinare la sola scena rimetterebbe la
 * chiave `raster:N` senza il livello dietro, e da quel momento ogni lettura
 * delle statistiche fallirebbe per sempre invece di una volta sola.
 *
 * I livelli staccati si riattaccano nell'ordine originale (inverso dello
 * stacco, che va dall'alto in basso) cosi' ogni indice di inserimento e'
 * ancora valido mentre la pila ricresce.
 */
async function rollbackStructuralMutation(
  engine: BrushEngine,
  detached: DeletedLayerEntry[],
  attached: DeletedLayerEntry[],
): Promise<void> {
  for (const entry of [...detached].reverse()) await attachLayer(engine, entry);
  if (attached.length === 0) return;
  // Il fallback dello stacco deve essere un livello che sopravvive: quelli
  // appena attaccati stanno per sparire, e `attach()` ha selezionato l'ultimo.
  const attachedIds = new Set(attached.map((entry) => entry.layerRecord.id));
  const survivor = engine.layerStack.layers.find((layer) => !attachedIds.has(layer.id));
  if (!survivor) throw new Error("Nessun livello superstite per annullare il ripristino.");
  for (const entry of [...attached].reverse()) {
    await detachLayer(engine, entry.layerRecord.id, survivor.id);
  }
}

/**
 * Primo raster rimasto nella scena senza livello nello stack. E' l'invariante
 * che `createMixedSceneSnapshot()` pretende: verificarla qui trasforma un
 * rollback riuscito a meta' in un errore dichiarato una volta, invece che in
 * un documento che lancia a ogni frame senza dire perche'.
 */
function firstSceneRasterMissingFromStack(
  engine: BrushEngine,
  scene: ReturnType<typeof requireMixedSceneStack>,
): number | null {
  for (const item of scene.items) {
    if (item.kind !== "raster") continue;
    if (engine.layerStack.indexOfId(item.rasterLayerId) < 0) return item.rasterLayerId;
  }
  return null;
}

/** Invariante simmetrica: ogni record raster deve avere una voce nella scena. */
function firstStackRasterMissingFromScene(
  engine: BrushEngine,
  scene: ReturnType<typeof requireMixedSceneStack>,
): number | null {
  for (const layer of engine.layerStack.layers) {
    if (scene.indexOfKey(`raster:${layer.id}`) < 0) return layer.id;
  }
  return null;
}

function restoreReferenceLayerId(
  engine: BrushEngine,
  layerId: number | null,
): void {
  if (layerId === null) {
    engine.layerStack.setReferenceIndex(null);
    return;
  }
  const index = engine.layerStack.indexOfId(layerId);
  if (index < 0) {
    throw new Error(`Raster di riferimento ${layerId} non ripristinabile.`);
  }
  engine.layerStack.setReferenceIndex(index);
}

/** Libera i seed di un'azione di cancellazione abbandonata dal Redo. */
export function destroyLayerDeleteHistorySeeds(action: LayerDeleteHistoryAction): void {
  for (const entry of action.entries) destroyLayerColdStorage(entry.seed);
}

/**
 * Applica o annulla una cancellazione. `delta > 0` esegue la cancellazione
 * (Redo), `delta < 0` la annulla ripristinando i livelli dal basso verso
 * l'alto, cosi' gli indici di inserimento restano validi mentre la pila cresce.
 */
export async function applyLayerDeleteHistory(
  engine: BrushEngine,
  action: LayerDeleteHistoryAction,
  delta: -1 | 1,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const sceneState = scene.captureState();
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  const previousActiveLayerId = engine.layerStack.active.id;
  const previousReferenceLayerId = engine.layerStack.referenceLayerId;
  // Cosa e' stato mutato **davvero**, non cosa si voleva mutare: il rollback
  // deve annullare la struttura, non solo la scena. Vedi
  // `rollbackStructuralMutation`.
  const detached: DeletedLayerEntry[] = [];
  const attached: DeletedLayerEntry[] = [];
  let presentationMayNeedRetarget = false;
  engine.layerSwitchBusy = true;
  try {
    if (delta < 0) {
      // Solo il ramo che **attacca** prepara il cambio: quello che stacca lo
      // delega a `switchActiveForStructuralHistory`, che persiste e prepara al
      // suo interno. Prepararlo due volte evacua la texture del livello attivo
      // e la seconda attivazione la trova non residente.
      const outgoingActiveLayerId = engine.layerStack.active.id;
      presentationMayNeedRetarget = true;
      engine.persistActiveLayerState();
      await engine.prepareActiveLayerForSwitch();
      for (const entry of action.entries) {
        await attachLayer(engine, entry);
        attached.push(entry);
      }
      const restoredIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
      if (restoredIndex < 0) {
        throw new Error("Raster attivo precedente alla cancellazione non ripristinabile.");
      }
      const outgoingIndexAfterAttachment = engine.layerStack.indexOfId(
        outgoingActiveLayerId,
      );
      if (outgoingIndexAfterAttachment < 0) {
        throw new Error("Raster attivo superstite perso durante il ripristino.");
      }
      // `LayerStack.attach()` seleziona ogni record inserito. L'ultimo puo'
      // quindi essere proprio `restoredIndex`: l'helper di switch vedrebbe un
      // indice gia' attivo e uscirebbe senza riattivare, lasciando il freeze di
      // `prepareActiveLayerForSwitch()` acceso. Come il Redo di raster-import,
      // dopo l'inserimento si imposta l'indice desiderato e si esegue sempre la
      // riattivazione completa a partire dal superstite uscente.
      restoreReferenceLayerId(engine, action.referenceRasterLayerIdBefore);
      engine.layerStack.setActiveIndex(restoredIndex);
      await engine.activateLayer(outgoingIndexAfterAttachment, "structural-history");
      if (scene.indexOfKey(action.selectedKeyBefore) >= 0) {
        scene.select(action.selectedKeyBefore);
      }
    } else {
      const survivorIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdAfter);
      if (survivorIndex < 0) {
        throw new Error("Raster superstite della cancellazione non presente.");
      }
      presentationMayNeedRetarget = true;
      await switchActiveForStructuralHistory(engine, survivorIndex);
      // `switchActiveForStructuralHistory` finisce con un'attivazione riuscita,
      // e quella **scongela** la presentazione. Lo stacco procederebbe quindi a
      // presentazione viva: il gate dei frame guarda `layerPresentationFrozen`,
      // non `layerSwitchBusy`, cosi' un frame passa fra lo stacco e la
      // riattivazione e trova i segmenti di composizione che citano ancora il
      // livello staccato — `clippingUnit()` lancia "Livello N assente dallo
      // stack". Serve una scena **segmentata** per vederlo: con soli raster c'e'
      // una tratta sola e nessuna cita il livello che se ne va, quindi il caso
      // si manifesta solo con un vettore fra i raster (testo, SVG, immagine).
      // Lo spegne la riattivazione qui sotto, che ricostruisce i segmenti.
      //
      // Si drena prima di congelare: la commutazione si chiude pubblicando il
      // retarget degli effetti, che sporca il display e chiede un frame.
      // Congelare con quel lavoro gia' in coda farebbe abortire la transazione
      // dalla guardia di `waitForIdle` ("Presentazione congelata con lavoro
      // render pendente"). Lo stacco in se' non ne aggiunge altro.
      await engine.waitForIdle();
      engine.layerPresentationFrozen = true;
      // Dall'alto verso il basso: staccare il piu' alto per primo lascia
      // invariati gli indici di quelli sotto.
      for (const entry of [...action.entries].reverse()) {
        const observed = await detachLayer(
          engine,
          entry.layerRecord.id,
          action.activeRasterLayerIdAfter,
        );
        entry.rasterLayerIndex = observed.rasterLayerIndex;
        entry.sceneIndex = observed.sceneIndex;
        detached.push(entry);
      }
      // `switchActiveForStructuralHistory` congela la presentazione; lo stacco
      // sposta gli indici e sporca il display. Senza questa seconda attivazione
      // la presentazione resta congelata con lavoro pendente e la transazione
      // successiva si interrompe. E' lo stesso secondo `activateLayer` che fa
      // l'Undo dell'import raster dopo aver mutato la scena.
      const survivorAfterDetach = engine.layerStack.indexOfId(
        action.activeRasterLayerIdAfter,
      );
      if (survivorAfterDetach < 0) {
        throw new Error("Raster superstite perso durante lo stacco.");
      }
      restoreReferenceLayerId(engine, action.referenceRasterLayerIdAfter);
      if (scene.indexOfKey(action.selectedKeyAfter) >= 0) {
        scene.select(action.selectedKeyAfter);
      }
      engine.layerStack.setActiveIndex(survivorAfterDetach);
      await engine.activateLayer(survivorAfterDetach, "structural-history");
    }
    engine.vectorTextPreviewExcludedNodeId = scene.selected.kind === "text"
      ? scene.selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.clearVectorTextPresentation();
    engine.publishActiveLayerChange();
  } catch (error) {
    try {
      const structureChanged = detached.length > 0 || attached.length > 0;
      const mustRetarget = presentationMayNeedRetarget
        || structureChanged
        || engine.layerPresentationFrozen;
      // Un'attivazione riuscita ha gia' riaperto il rendering e puo' aver
      // lasciato un frame in coda. Drenarlo prima di congelare impedisce al
      // rollback di distruggere risorse ancora referenziate.
      if (mustRetarget && !engine.layerPresentationFrozen) {
        await engine.waitForIdle();
        engine.layerPresentationFrozen = true;
      }
      await rollbackStructuralMutation(engine, detached, attached);
      scene.restoreState(sceneState);
      engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      restoreReferenceLayerId(engine, previousReferenceLayerId);
      clearVectorTextPresentationForTransaction(engine);
      const previousActiveIndex = engine.layerStack.indexOfId(previousActiveLayerId);
      if (previousActiveIndex < 0) {
        throw new Error(`Raster attivo ${previousActiveLayerId} perso durante il rollback.`);
      }
      // Il freeze della presentazione lo spegne solo una riattivazione vera:
      // il `finally` ricostruisce la cache ma lascia acceso il flag, e la
      // transazione **successiva** si rifiuterebbe di partire. Si ritenta
      // anche se e' proprio l'attivazione ad aver fallito: annullata la
      // mutazione il tentativo parte da uno stato coerente, e se fallisce di
      // nuovo il `catch` esterno dichiara il documento inconsistente invece di
      // lasciarlo mezzo commutato.
      const outgoingIndex = engine.layerStack.indexOfId(engine.layerStack.active.id);
      engine.layerStack.setActiveIndex(previousActiveIndex);
      if (mustRetarget) {
        await engine.activateLayer(outgoingIndex, "structural-history");
      }
      const orphan = firstSceneRasterMissingFromStack(engine, scene);
      if (orphan !== null) {
        throw new Error(`Raster ${orphan} restato nella scena senza livello.`);
      }
      const missing = firstStackRasterMissingFromScene(engine, scene);
      if (missing !== null) {
        throw new Error(`Livello raster ${missing} restato nello stack senza scena.`);
      }
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "Mutazione strutturale fallita e rollback incompleto: ricarica la pagina.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(`${first}; rollback strutturale fallito: ${second}`);
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.publishStats();
    engine.scheduleLayerColdCompression();
  }
}

/**
 * Applica o annulla una creazione. E' la cancellazione al contrario, con un
 * solo livello e senza seed: quando l'Undo attraversa la creazione ogni azione
 * successiva e' gia' stata annullata, quindi il livello e' vuoto.
 */
export async function applyLayerAddHistory(
  engine: BrushEngine,
  action: LayerAddHistoryAction,
  delta: -1 | 1,
): Promise<void> {
  const entry: DeletedLayerEntry = {
    layerRecord: action.layerRecord,
    rasterLayerIndex: action.rasterLayerIndex,
    sceneIndex: action.sceneIndex,
    clippingParentId: action.clippingParentId,
    seed: null,
    baseBounds: null,
  };
  const addedKey = `raster:${action.layerRecord.id}` as const;
  await applyLayerDeleteHistory(
    engine,
    {
      id: action.id,
      kind: "layer-delete",
      entries: [entry],
      // Prima della cancellazione sintetica siamo nello stato dopo Add.
      selectedKeyBefore: addedKey,
      selectedKeyAfter: action.selectedKeyBefore,
      activeRasterLayerIdBefore: action.layerRecord.id,
      activeRasterLayerIdAfter: action.activeRasterLayerIdBefore,
      referenceRasterLayerIdBefore: action.referenceRasterLayerIdBefore,
      referenceRasterLayerIdAfter: action.referenceRasterLayerIdBefore,
    },
    // Creare e' l'inverso di cancellare: annullare una creazione stacca.
    delta < 0 ? 1 : -1,
  );
  action.rasterLayerIndex = entry.rasterLayerIndex;
  action.sceneIndex = entry.sceneIndex;
}
