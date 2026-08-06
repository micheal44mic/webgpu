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
  let gpu: LayerGpuResources | null = null;
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
  engine.layerSwitchBusy = true;
  try {
    if (delta < 0) {
      // Solo il ramo che **attacca** prepara il cambio: quello che stacca lo
      // delega a `switchActiveForStructuralHistory`, che persiste e prepara al
      // suo interno. Prepararlo due volte evacua la texture del livello attivo
      // e la seconda attivazione la trova non residente.
      const outgoingActiveLayerId = engine.layerStack.active.id;
      engine.persistActiveLayerState();
      await engine.prepareActiveLayerForSwitch();
      for (const entry of action.entries) await attachLayer(engine, entry);
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
      await switchActiveForStructuralHistory(engine, survivorIndex);
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
      scene.restoreState(sceneState);
      engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      clearVectorTextPresentationForTransaction(engine);
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
  await applyLayerDeleteHistory(
    engine,
    {
      id: action.id,
      kind: "layer-delete",
      entries: [entry],
      selectedKeyBefore: action.selectedKeyBefore,
      activeRasterLayerIdBefore: action.activeRasterLayerIdBefore,
      activeRasterLayerIdAfter: action.activeRasterLayerIdBefore,
    },
    // Creare e' l'inverso di cancellare: annullare una creazione stacca.
    delta < 0 ? 1 : -1,
  );
  action.rasterLayerIndex = entry.rasterLayerIndex;
  action.sceneIndex = entry.sceneIndex;
}
