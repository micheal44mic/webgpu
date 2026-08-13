# Architettura corrente

Questa è la mappa del codice implementato, non una proposta futura. Lo scopo è
indicare subito dove appartiene una modifica e quali confini non devono essere
aggirati.

## Avvio e shell

`index.html` è uno scheletro con marker. `scripts/ui-shell-source.mjs` vi inserisce,
in ordine stabile, i frammenti di `src/ui-shell/`; `src/styles.css` importa nello
stesso modo i fogli di `src/styles/`.

Il flusso di produzione è:

```text
index.html → src/startup.ts → Home progetti oppure import dinamico di src/main.ts
                          → controller UI → BrushEngine → runtime/renderer WebGPU
```

`src/main.ts` crea il motore e tutti i controller, collega callback e lifecycle,
ma non deve possedere una funzionalità completa. I controller ricevono elementi
DOM e porte ristrette; il DOM non è uno store applicativo.

`labs.html` usa la stessa shell ma avvia `src/labs/startup.ts`, che registra
un'estensione diagnostica e poi importa `main.ts`. Il codice di produzione non
può importare `src/labs/`; verifier e controllo del bundle fanno rispettare il
confine.

## Proprietà dei domini

| Dominio | Proprietario | Note |
|---|---|---|
| Stato e hot path Paint/Eraser/Blend | `BrushEngine` | Facciata pubblica, risorse centrali e percorso per-frame/per-stamp |
| Capacità strumenti canvas | `canvas-tool-capabilities.ts` | Fonte autorevole di puntatore, tool pennello, operazione raster, controlli rapidi e intent touch |
| Operazione e pipeline raster | `raster-stroke-operation.ts`, `engine-raster-stroke-pipelines.ts` | Eraser riusa la geometria Paint ma resta un'operazione destination-out separata da preset e schema progetto |
| Impostazioni pennello attive | `BrushSettingsController` | Colore e tool attivi non fanno parte della definizione persistita |
| Definizione e catalogo pennelli | `brush-definition.ts`, `brush-catalog.ts` | Versionamento, normalizzazione e preset |
| Asset pennelli | `brush-builtin-assets.ts`, `engine-brush-assets.ts` | URL builtin e risorse GPU/custom |
| Livelli raster | `LayerStack` e `engine-layer-*-runtime.ts` | Comandi, clipping, superfici, compositing, effetti e residency separati |
| Scena ordinata | `MixedSceneStack` | Modello CPU di raster, testo, SVG e immagini |
| Modelli semantici | `scene-text-model.ts`, `scene-svg-model.ts`, `scene-image-model.ts` | Dati clonabili/persistibili, senza DOM |
| Editing della scena | `MixedSceneController` e runtime `mixed-scene-*` | DOM, interazione, comandi/History e piano di rendering sono moduli distinti |
| Effetti non distruttivi | `RasterStyleController`, `engine-raster-style-runtime.ts` | Stroke, bevel, ombre e color overlay per livello |
| Regolazioni e sessioni distruttive | `destructive-raster-edit-contract.ts`, `RasterAdjustmentsController`, runtime Gaussian/Motion/Noise/Liquify/Transform | Elenco esaustivo delle sessioni, preview e commit transazionale |
| Progetto aperto | `ProjectSessionController` | Dirty state, save/open, thumbnail e ritorno Home |
| Persistenza progetto | moduli `project-storage-*` | Schema, codec, quota, backend e repository separati |
| Cronologia | `HistoryService` | Azioni, cursore, batch, ownership e branch Redo |
| Controlli Undo/Redo | `HistoryControlsController` | Coda e UI; non possiede payload History |

Le facciate `engine-layer-runtime.ts`, `engine-vector-text-runtime.ts` e
`project-storage.ts` esportano i moduli del dominio. Aggiungere la logica al
modulo specifico, non alla facciata.

`canvas-tool-capabilities.ts` è la fonte autorevole per le capacità degli strumenti canvas. `destructive-raster-edit-contract.ts` definisce l'elenco esaustivo delle sessioni raster distruttive.

Il Text Warp è semantico/vettoriale (proprietà del modello testo), distinto dal futuro Raster Warp/Puppet (sessione transazionale distruttiva su pixel).

Ogni nuovo filtro colore futuro deve prima essere classificato:
- **Non distruttivo**: metadati di livello (`RasterStyleController`, `engine-raster-style-runtime.ts`), schema progetto, History raster-property e shader/compositor re-renderabile;
- **Distruttivo**: core, shader, runtime a sessione con preview transazionale e commit con checkpoint pixel esatto in History.

## Flussi operativi

Un tratto segue questo percorso:

```text
evento pointer → CanvasInputController → BrushEngine begin/update/end
               → operazione Paint/Eraser o planner Blend → renderer WebGPU
               → commit azione + payload in HistoryService → callback UI
```

Undo/Redo parte da `HistoryControlsController`, entra nel comando configurato su
`HistoryService` e viene applicato da `engine-history-runtime.ts`. Prima della
mutazione vengono idratati gli eventuali payload freddi; in errore il runtime
tenta il rollback e, se non può garantire coerenza, blocca ulteriori modifiche.

## Cronologia e memoria

La separazione è intenzionalmente a strati:

| File | Responsabilità |
|---|---|
| `history-service.ts` | Proprietario del journal: pubblicazione atomica di azione/batch, cursore, troncamento Redo, payload scartati e invarianti |
| `history-action-matrix.ts` | Inventario verificabile delle famiglie di azioni e delle loro politiche |
| `engine-history-types.ts` | Tipi delle azioni e dei payload |
| `history-journal.ts`, `history-replay-plan.ts` | Selezione e pianificazione pure dei passi da riprodurre |
| `engine-history-runtime.ts` | Replay applicato al documento; dipende dal motore perché deve mutare texture, livelli e scena |
| `history-host.ts` | Porte runtime, maintenance e storage ristrette |
| `engine-history-storage-host.ts` | Unico adattatore fra le porte History e il motore vivo |
| `gpu-history-storage.ts` | Allocazione e ownership fisica dei payload GPU |
| `history-maintenance-runtime.ts` | Checkpoint, accounting, retention e lavoro incrementale |
| `history-retention-core.ts` | Politiche pure di budget, checkpoint, spill ed eviction |
| `history-storage-coordinator.ts` | Spill/hydration della cache di sessione e protocollo di pubblicazione |
| `history-storage-core.ts`, `history-storage-idb.ts`, `history-storage-opfs-*` | Formato, pianificazione e backend della cache locale |

Le sessioni ancora aperte di Transform o filtro restano nel relativo runtime o
nel `BrushEngine`: sono stato operativo del documento, non journal committato.
I getter History presenti sul motore sono una facciata di compatibilità verso
`HistoryService`, non un secondo proprietario.

La memoria generale è separata dalla policy History:

- `gpu-resource-registry.ts` misura texture e buffer realmente creati;
- `memory-governor-core.ts` e `memory-governor-limits.ts` decidono ammissione e
  reclaim;
- `engine-memory-model.ts` contiene stime deterministiche;
- `layer-memory-admission-core.ts` pianifica operazioni costose sui livelli;
- `effects-scratch-pool.ts` riusa lo scratch degli effetti;
- cold storage, compressione e History GPU mantengono ownership proprie.

Questi confini sono pronti per ottimizzazioni future, ma i parametri di retention,
checkpoint, compressione e spill non sono ancora stati ottimizzati dalla Fase 9:
vanno cambiati soltanto con benchmark confrontabili nei Labs.

Tre integrazioni restano volutamente concrete: `engine-history-runtime.ts` applica
il replay al motore, l'adapter della maintenance elenca le capability necessarie e
`history-storage-coordinator.ts` possiede l'intero lifecycle della cache locale.
Sono punti di lavoro misurabili per una futura ottimizzazione, non duplicazioni
del proprietario History.

## Persistenza progetto

La persistenza durevole non usa la cache History:

```text
ProjectSessionController
  → engine-project-runtime.ts (capture/restore del documento)
  → project-storage.ts (facciata)
  → schema + codec + quota + backend + repository
  → IndexedDB, con fallback in memoria
```

`project-storage-schema.ts` e `src/compat/` sono confini di compatibilità. Non
rinominare discriminanti, ID o campi persistiti senza migrazione e verifier.

## Dove effettuare una modifica

| Richiesta | Punto di partenza |
|---|---|
| Nuovo parametro di pennello | `brush-definition.ts`, poi settings/controller, shader/runtime e transfer codec |
| Cambiare Paint o Blend | `stroke-core.ts`/`blend-core.ts`, renderer dedicato e hot path in `BrushEngine` |
| Cambiare un comando livello | `engine-layer-command-runtime.ts` o `engine-layer-structure-runtime.ts` |
| Cambiare clipping/compositing | `engine-layer-clipping-runtime.ts`, `engine-layer-composite-runtime.ts` o `engine-layer-fold-runtime.ts` |
| Cambiare testo/SVG/immagini | modello `scene-*`, controller/runtime scena, poi runtime GPU vettoriale |
| Cambiare Undo/Redo | matrice azioni, `HistoryService`, replay engine e verifier History |
| Cambiare memoria | registry/modello/governor oppure retention/storage History; prima aggiungere una baseline Labs |
| Cambiare salvataggio | schema/codec/repository e `engine-project-runtime.ts` |
| Cambiare UI | frammento in `src/ui-shell/`, relativo controller e foglio in `src/styles/` |
| Aggiungere diagnostica | `src/labs/`; mai importarla dal client di produzione |

## Invarianti protetti

- Documento autorevole in RGBA16F lineare; compatibilità di lettura dei progetti
  storici preservata.
- Una gesture editabile produce una sola azione Undo mediante begin/update/commit
  o cancel.
- Azione History e relativi batch diventano visibili atomicamente.
- La cache History può essere eliminata senza modificare un progetto salvato.
- Controller e runtime non usano eventi DOM sintetici come bus di stato.
- Ogni risorsa GPU ha un proprietario e un percorso esplicito di release/rollback.
- Produzione e Labs hanno entry point e bundle separati.
- Un nuovo `verify-*.mjs` deve essere registrato in
  `scripts/verification-suite.mjs`.

`qa/`, `research/` e `benchmarks/` documentano confronti o misure: non entrano
nel runtime dell'app e non vanno trattati come asset di produzione.
