# Piano temporaneo di manutenzione e rifattorizzazione

> File operativo temporaneo. Deve essere aggiornato durante il lavoro e cancellato
> soltanto dopo il completamento di tutte le fasi e l'approvazione finale dell'utente.

## Stato generale

- Stato: **Fase 5 completata - pronta la Fase 6**
- Data di creazione: 12 agosto 2026
- Modalita di lavoro: massimo un agente secondario, come richiesto dall'utente
- Obiettivo: rendere il progetto piu semplice da capire, modificare e ottimizzare,
  preservando esattamente il comportamento dell'app attuale

Legenda:

- `[ ]` da eseguire
- `[x]` completato e verificato
- Una fase puo essere marcata completata solo quando supera il proprio gate finale.

## Avanzamento sintetico

- [x] Pianificazione iniziale e audit
- [x] Fase 1 - Baseline affidabile e comando unico di verifica
- [x] Fase 2 - Separazione fra editor di produzione e laboratori
- [x] Fase 3 - Pulizia meccanica e codice obsoleto dimostrato
- [x] Fase 4 - Stato UI esplicito e rimozione della UI legacy
- [x] Fase 5 - `main.ts` come composition root
- [ ] Fase 6 - Confini di pennelli, effetti e scena
- [ ] Fase 7 - Isolamento di cronologia, undo/redo e memoria
- [ ] Fase 8 - Ottimizzazione misurata della memoria
- [ ] Fase 9 - Rifinitura, documentazione corrente e chiusura

## Regole non negoziabili

- Non introdurre nuove funzionalita durante la rifattorizzazione.
- Non combinare modifiche architetturali e ottimizzazioni della memoria nello
  stesso passaggio.
- Non eliminare un modulo soltanto perche non ha import statici: controllare
  anche import dinamici, Worker, test, script e build.
- Non eliminare identificatori o formati persistiti senza una migrazione o un
  adattatore di compatibilita.
- Conservare il risultato visivo, la semantica degli strumenti e il formato dei
  progetti esistenti.
- Lavorare per piccoli gruppi coerenti di modifiche, ognuno verificabile e
  annullabile indipendentemente.
- Aggiornare questo file dopo ogni gruppo di lavoro, includendo verifiche ed
  eventuali decisioni.
- Non eseguire commit, push o pubblicazioni senza una richiesta esplicita.
- Non modificare `artifacts/first-stroke-runtime.png`, che era gia non tracciato
  prima dell'inizio del piano.

## Baseline iniziale conosciuta

- [x] Audit strutturale eseguito senza modificare il codice.
- [x] `npx tsc --noEmit` passa.
- [x] Individuati 135 diagnostici unused con i controlli TypeScript aggiuntivi.
- [x] Verificati 51 comandi `*:verify`: 47 passano e 4 falliscono per controlli
  obsoleti sulla forma/posizione del sorgente (`blend`, `brush-studio`, `stroke`,
  `shadow`).
- [x] Verificati due script non collegati a `package.json`: entrambi passano.
- [x] Confermato che i moduli GPU/lab indicati come morti hanno importatori dinamici
  o test e non possono essere cancellati direttamente.
- [x] Confermato il collegamento nascosto fra UI corrente e `#controlsPanel` legacy.
- [x] Confermata la dipendenza di molti runtime dall'intero `BrushEngine`.
- [x] Confermata la separazione concettuale corretta fra salvataggio progetto e cache
  della cronologia.

---

## Fase 1 - Baseline affidabile e comando unico di verifica

Obiettivo: costruire la rete di sicurezza necessaria prima di spostare o eliminare
codice.

- [x] Inventariare tutti gli script `verify-*.mjs` e stabilire quali sono ancora
  requisiti reali del prodotto.
- [x] Sostituire il controllo obsoleto di `blend:verify` con una verifica sul modulo
  e sul comportamento correnti.
- [x] Sostituire il controllo obsoleto di `brush-studio:verify`.
- [x] Sostituire i controlli obsoleti di `stroke:verify` e `shadow:verify` che
  cercano WGSL in file non piu proprietari di quel codice.
- [x] Collegare `verify-noise-mip-smoothing.mjs` alla suite ufficiale.
- [x] Collegare `verify-restored-layer-thumbnails.mjs` alla suite ufficiale.
- [x] Creare `npm run check` come unico ingresso per typecheck, verifiche e build.
- [x] Coprire con verifiche registrate o smoke test reale almeno:
  - [x] avvio editor e primo tratto;
  - [x] Paint, Blend e Fill;
  - [x] aggiunta, eliminazione, duplicazione e merge dei livelli;
  - [x] undo, redo e troncamento del ramo redo;
  - [x] effetti raster principali;
  - [x] testo, SVG e immagini raster;
  - [x] salvataggio e riapertura di un progetto.
- [x] Registrare nel log di questo file i risultati della baseline.

Gate Fase 1:

- [x] `npm run check` termina con codice 0.
- [x] Nessuno script ufficiale resta scollegato accidentalmente.
- [x] Build di produzione completata.
- [x] Smoke test visivo senza regressioni osservabili.

Risultato Fase 1:

- `scripts/verification-suite.mjs` registra esplicitamente tutte le 59 suite.
- `scripts/run-verifications.mjs` rifiuta duplicati, file mancanti e nuovi
  `verify-*.mjs` non registrati, poi esegue tutte le suite raccogliendo i fallimenti.
- I controlli Blend e Brush Studio non dipendono piu da LF/CRLF o dalla vecchia
  firma sincrona del callback.
- I controlli Stroke e Shadow verificano ora la stride packed-f16 per riga usata
  dai documenti rettangolari, inclusa una caratterizzazione su larghezza dispari.
- `npm run check`: typecheck verde, 59/59 suite verdi e build Vite/Sites verde.
- Smoke test browser su progetto 1080 x 1920: home, creazione, inizializzazione
  WebGPU, primo tratto, Undo, Redo, salvataggio e riapertura tutti riusciti.
- Console browser: zero errori, zero warning e nessun overlay Vite.
- Il bundle continua a contenere chunk diagnostici: e un risultato atteso e diventa
  il bersaglio misurabile della Fase 2.

---

## Fase 2 - Separazione fra editor di produzione e laboratori

Obiettivo: impedire che benchmark, golden, stress probe e GPU test siano dipendenze
dell'applicazione distribuita.

- [x] Classificare ogni modulo diagnostico come `lab da conservare`, `fixture di
  test` oppure `candidato alla rimozione`.
- [x] Spostare i tipi di report condivisi in contratti neutrali.
- [x] Rimuovere da `BrushEngine` la responsabilita di avviare golden e benchmark.
- [x] Invertire la dipendenza: i laboratori chiamano l'API pubblica dell'engine.
- [x] Creare un entry point separato per `labs/`.
- [x] Spostare nel nuovo dominio benchmark, golden, stress test e relativi controlli.
- [x] Spostare `loadCanonicalHumanStroke()` fuori dall'avvio dell'editor.
- [x] Verificare separatamente ogni laboratorio conservato.
- [x] Eliminare soltanto i moduli che, dopo la separazione, risultano davvero senza
  importatori, senza entry point e senza valore di fixture.

Gate Fase 2:

- [x] L'editor di produzione non importa moduli lab, neppure dinamicamente.
- [x] Il bundle di produzione non contiene chunk golden/benchmark/stress/GPU test.
- [x] I laboratori conservati restano eseguibili dal loro entry point.
- [x] `npm run check` passa.

Risultato Fase 2:

- `labs.html` e `src/labs/startup.ts` costituiscono un entry point autonomo; i
  laboratori non dipendono piu da query nascoste, pulsanti invisibili o launcher
  dentro `main.ts` e `BrushEngine`.
- Golden, benchmark effetti, GPU test, stress memoria, studio compressione,
  memoria mista, limite iPhone, tratto umano e zoom vettoriale vivono sotto
  `src/labs/`, divisi per dominio.
- Il laboratorio del tratto umano conserva fixture canonica, fingerprint,
  registrazione, replay temporizzato, tre rendering, Blend e telemetria; il suo
  caricamento non avviene piu durante il boot dell'editor produttivo.
- Lo zoom vettoriale conserva integralmente stress 64x, confronto A/B e copertura
  C: cache GPU larga, rebuild dopo il ciclo raster, probe alpha, backpressure,
  recovery latest-only e persistenza del report.
- `verify-source-boundaries.mjs` impedisce ai sorgenti produttivi di importare
  `src/labs`; `check-production-bundle.mjs` interrompe la build se un chunk o un
  marcatore diagnostico rientra nel client distribuito.
- La build editor contiene 17 file e nessun laboratorio; la build separata Labs
  produce `labs.html` e i relativi chunk diagnostici.
- Rimossi i wrapper inline obsoleti e l'helper senza importatori
  `resetActiveLayerForMemoryBenchmark`; i test ancora utili sono stati conservati
  e spostati, non cancellati sulla base del solo conteggio degli import statici.
- `npm run check`: typecheck verde, 60/60 suite verdi, build editor verificata e
  build Labs verde.

---

## Fase 3 - Pulizia meccanica e codice obsoleto dimostrato

Obiettivo: ridurre la superficie del codice senza cambiare l'architettura o il
comportamento.

- [x] Rimuovere gli unused misurati in piccoli gruppi per sottosistema: 135 nella
  baseline iniziale, 243 dopo la separazione completa dei Labs.
- [x] Dopo la pulizia, attivare permanentemente `noUnusedLocals`.
- [x] Dopo la pulizia, attivare permanentemente `noUnusedParameters`.
- [x] Rimuovere i rami morti collegati a `mobileUiMediaQuery` sempre vero.
- [x] Rimuovere il feature flag `vectorTextEditorEnabled` se confermato sempre attivo.
- [x] Decidere con un test di compatibilita se rimuovere `setLayerFormat()` e il
  controllo UI disabilitato, mantenendo la lettura dei vecchi formati persistiti.
- [x] Spostare `@types/earcut` nelle `devDependencies`.
- [x] Aggiungere `.editorconfig` e configurazione di formattazione minima.
- [x] Normalizzare CRLF/LF in un cambiamento meccanico isolato dalle modifiche
  logiche.

Gate Fase 3:

- [x] TypeScript passa con entrambi i controlli unused attivi.
- [x] Nessuna API persistita e nessun progetto esistente perde compatibilita.
- [x] `npm run check` passa.
- [x] Smoke test visivo invariato.

Risultato Fase 3:

- Diagnostici unused ridotti da 243 a zero; `noUnusedLocals` e
  `noUnusedParameters` sono ora vincoli permanenti del progetto.
- Rimossi i rami UI sempre veri, il flag duplicato del testo vettoriale e la falsa
  API di cambio formato; la classificazione hardware/memoria mobile resta intatta.
- I progetti storici RGBA8 restano apribili: il restore migra ogni chunk a
  RGBA16F, ne verifica l'integrita e non modifica il documento persistito originale.
- `@types/earcut` e correttamente una dipendenza di sviluppo; `.editorconfig` e
  `.gitattributes` fissano UTF-8, LF e le regole minime di formattazione.
- Tutti i file di testo sono stati normalizzati a LF; scansione finale: zero CR.
- `npm run check`: TypeScript verde, 60/60 suite verdi, build editor di 17 file
  senza Labs e build Labs separata verde.
- Smoke test browser su progetto 1080 x 1920: avvio, primo tratto, Undo e Redo
  invariati; zero errori e zero warning in console.

---

## Fase 4 - Stato UI esplicito e rimozione della UI legacy

Obiettivo: eliminare la dipendenza dai controlli invisibili di `#controlsPanel`.

Avanzamento verificato della fase:

- [x] Introdurre un controller autorevole dei pennelli indipendente dal DOM.
- [x] Collegare Brush Library, Brush Studio e quick controls al controller.
- [x] Introdurre stato esplicito per Fill e Selection e rimuovere i relativi
  controlli legacy.
- [x] Spostare lo stato globale dell'app fuori dal pannello invisibile.
- [x] Migrare testo, SVG ed effetti vettoriali preservando il lifecycle Undo.
- [x] Migrare Stroke, effetti raster e regolazioni distruttive.
- [x] Migrare i livelli.
- [x] Rimuovere gli ultimi proxy/eventi sintetici e l'intero `#controlsPanel`.

- [x] Definire stato e comandi espliciti per tool, pennello, effetti, selezione e
  pannelli.
- [x] Migrare un pannello alla volta, mantenendo funzionante l'app dopo ogni passo.
- [x] Migrare Tool Settings senza leggere o scrivere controlli legacy.
- [x] Migrare Brush Library e Brush Studio.
- [x] Migrare Stroke ed effetti raster.
- [x] Migrare controlli livello, testo, SVG e immagini.
- [x] Eliminare `sourceControl()`, `dispatchMirroredValue()` e gli eventi sintetici
  usati per comandare la vecchia UI.
- [x] Verificare che non restino letture di stato da elementi DOM nascosti.
- [x] Eliminare il blocco `#controlsPanel`, i relativi ID, listener e CSS.
- [x] Conservare per ora i nomi `mobile-*` dei componenti ormai universali:
  rinominarli tutti insieme produrrebbe un diff ampio senza migliorare i confini.

Gate Fase 4:

- [x] Nessuna logica applicativa dipende da elementi DOM nascosti.
- [x] Nessun evento sintetico viene usato come bus di stato.
- [x] UI verificata almeno su layout stretto e largo.
- [x] `npm run check` passa.

---

## Fase 5 - `main.ts` come composition root

Obiettivo: spostare la logica funzionale fuori dal file di bootstrap.

- [x] Estrarre `ProjectSessionController`.
- [x] Estrarre `CanvasInputController`.
- [x] Estrarre `HistoryControlsController`.
- [x] Estrarre `BrushLibraryController`.
- [x] Estrarre `BrushStudioController`.
- [x] Estrarre `LayerPanelController`.
- [x] Estrarre `EditorToolsController`.
- [x] Estrarre `SceneEditorController`.
- [x] Rendere esplicite le dipendenze di ogni controller tramite parametri/porte.
- [x] Lasciare in `main.ts` soltanto composizione, bootstrap e lifecycle generale.

Gate Fase 5:

- [x] Nessuna funzionalita completa vive direttamente in `main.ts`.
- [x] I controller non effettuano lookup arbitrari nel DOM globale fuori dalla
  propria root.
- [x] `npm run check` passa.
- [x] Smoke test visivo invariato.

---

## Fase 6 - Confini di pennelli, effetti e scena

### Pennelli e Brush Studio

- [ ] Definire una sola `BrushDefinition` versionata.
- [ ] Tenere colore attivo e tool attivo fuori dalla definizione del pennello.
- [ ] Aggiungere normalizzazione e migrazioni delle versioni persistite.
- [ ] Creare un registro unico per metadati e URL degli asset builtin.
- [ ] Separare catalogo, storage, preview e transfer codec.
- [ ] Collegare Brush Studio tramite porte ristrette, non tramite l'intero engine.
- [ ] Conservare gli ID persistiti storici dietro un livello `compat/`.

### Effetti

- [ ] Separare chiaramente effetti distruttivi e non distruttivi.
- [ ] Estrarre il comportamento comune dei bottom sheet in un controller condiviso.
- [ ] Conservare gli attuali moduli core/renderer/runtime che hanno responsabilita
  gia chiare.

### Scena, vettori e immagini

- [ ] Rinominare il sottosistema `prototype` quando non rappresenta piu un flag.
- [ ] Separare modello scena, testo, SVG, immagini e trasformazioni.
- [ ] Dividere `mixed-vector-text-controller.ts` per responsabilita.
- [ ] Convertire `vector-shadow-3d.js` in TypeScript.
- [ ] Rimuovere soltanto gli export pubblici dimostrati inutilizzati.

Gate Fase 6:

- [ ] Ogni dominio ha un proprietario chiaro dello stato.
- [ ] Nessun formato persistito viene cambiato senza migrazione.
- [ ] `npm run check` passa.
- [ ] Parita visiva di pennelli, effetti e scena verificata.

---

## Fase 7 - Isolamento di cronologia, undo/redo e memoria

Obiettivo: rendere la cronologia modificabile in futuro senza coinvolgere l'intero
`BrushEngine`. In questa fase non si ottimizzano ancora gli algoritmi.

- [ ] Completare una matrice di caratterizzazione per tutte le azioni registrabili:
  - [ ] Paint e Blend;
  - [ ] Fill, filtri e trasformazioni raster;
  - [ ] proprieta dei livelli ed effetti;
  - [ ] aggiunta, eliminazione, duplicazione, riordino e merge;
  - [ ] selezione;
  - [ ] testo, SVG, immagini e rasterizzazione vettoriale.
- [ ] Verificare commit, cancel, undo, redo e troncamento redo.
- [ ] Verificare rollback e rilascio risorse tramite fault injection.
- [ ] Definire un'interfaccia `HistoryHost` con le sole dipendenze necessarie.
- [ ] Rimuovere la dipendenza diretta dei moduli History dall'intero `BrushEngine`.
- [ ] Riunire azioni, cursore, batch, checkpoint e accounting sotto un proprietario
  esplicito dello stato.
- [ ] Esporre un'API ristretta: begin, commit, cancel, undo, redo, reset, stato e
  telemetria.
- [ ] Conservare invariati GPU history storage, retention, checkpoint full/delta,
  memory governor e spill IDB/OPFS.
- [ ] Mantenere il salvataggio progetto separato dalla cache evictable di History.
- [ ] Trasformare progressivamente `BrushEngine` in una facade dei sottosistemi.

Gate Fase 7:

- [ ] Stessa profondita e semantica di undo/redo.
- [ ] Stesso risultato visivo dopo replay.
- [ ] Nessuna perdita di risorse dopo errori o cancellazioni.
- [ ] Accounting della memoria coerente con la baseline.
- [ ] `npm run check` passa.

---

## Fase 8 - Ottimizzazione misurata della memoria

Obiettivo: migliorare RAM, VRAM e latenza della cronologia soltanto dopo il suo
isolamento architetturale.

- [ ] Registrare baseline RAM, VRAM, memoria History, latenza undo/redo e tempi di
  hydration/spill per classe di dispositivo.
- [ ] Definire una metrica e un criterio di promozione per ogni esperimento.
- [ ] Provare un solo cambiamento alla volta, scegliendo fra:
  - [ ] frequenza dei checkpoint;
  - [ ] rapporto checkpoint full/delta;
  - [ ] compressione dei tile;
  - [ ] profondita della History calda;
  - [ ] spill su IDB/OPFS;
  - [ ] politica di eviction;
  - [ ] budget specifici per dispositivo.
- [ ] Confrontare ogni esperimento con la baseline a parita di documento e azioni.
- [ ] Ritirare completamente gli esperimenti che peggiorano latenza, affidabilita o
  risultato visivo.
- [ ] Promuovere soltanto ottimizzazioni misurate e documentate.

Gate Fase 8:

- [ ] Nessuna regressione funzionale o visiva.
- [ ] Miglioramento misurabile rispetto alla baseline concordata.
- [ ] Undo/redo affidabile anche sotto pressione di memoria.
- [ ] `npm run check` passa.

---

## Fase 9 - Rifinitura, documentazione corrente e chiusura

- [ ] Dividere `project-storage.ts` in schema, validazione, backend e repository se
  ancora necessario dopo le fasi precedenti.
- [ ] Dividere `styles.css` per componenti senza cambiare il rendering.
- [ ] Riordinare fixture, golden, benchmark e materiale di ricerca nelle rispettive
  directory.
- [ ] Scrivere `README.md` basato esclusivamente sul progetto corrente.
- [ ] Scrivere `ARCHITECTURE.md` con i confini effettivamente implementati.
- [ ] Scrivere un `AGENTS.md` breve contenente soltanto regole stabili e comandi
  verificati.
- [ ] Eseguire la verifica finale completa.
- [ ] Ottenere l'approvazione finale dell'utente.
- [ ] Cancellare `PIANO-MANUTENZIONE-TEMP.md`.

Gate Fase 9:

- [ ] App, build e test completi verdi.
- [ ] Architettura documentata e coerente con il codice reale.
- [ ] Nessun file temporaneo del piano rimasto nel repository.

---

## Decisioni aperte da non anticipare

- [x] Conservati i laboratori con fixture, copertura o benchmark ancora utili;
  rimossi soltanto wrapper e helper senza proprietario o valore diagnostico.
- [x] `setLayerFormat()` rimosso dopo aver introdotto la migrazione esplicita dei
  progetti storici RGBA8 verso RGBA16F durante il restore.
- [ ] Forma definitiva dello store UI: evitare un nuovo store globale monolitico.
- [x] Usare `ProjectSessionController` come prima prova delle interfacce ristrette
  dell'engine.
- [ ] Metriche e dispositivi della futura baseline memoria.

## Registro di avanzamento

| Data | Fase | Operazione | Verifica | Risultato/note |
|---|---:|---|---|---|
| 2026-08-12 | Piano | Creato il tracker temporaneo | Nessun file applicativo modificato | In attesa di approvazione per iniziare la Fase 1 |
| 2026-08-12 | 1 | Corrette le quattro verifiche obsolete | Esecuzione individuale di Blend, Brush Studio, Stroke e Shadow | Tutte verdi; nessuna modifica al codice applicativo |
| 2026-08-12 | 1 | Creati registro e runner unico delle verifiche | `npm run verify` | 59/59 suite verdi; inclusi i due script prima scollegati |
| 2026-08-12 | 1 | Creato il gate unico del repository | `npm run check` | Typecheck, tutte le suite e build completati con codice 0 |
| 2026-08-12 | 1 | Smoke test reale su canvas rettangolare 1080 x 1920 | Browser locale: primo tratto, Undo/Redo, save e reopen | Parita visiva osservata; zero errori/warning; Fase 1 completata |
| 2026-08-12 | 2 | Creati entry `labs.html`, bootstrap e contratto neutrale dell'estensione | `npm run typecheck` | Editor produttivo e laboratori hanno entry e dipendenze separate |
| 2026-08-12 | 2 | Spostati golden, GPU test, benchmark effetti e stress memoria sotto `src/labs/` | `npm run typecheck` e build incrementali | I test conservati hanno un proprietario esplicito fuori dall'editor |
| 2026-08-12 | 2 | Invertite le operazioni lab fuori da `BrushEngine` e `engine-reports` | Ricerca import e `npm run typecheck` | Nessun launcher lab resta proprieta del motore |
| 2026-08-12 | 2 | Migrati zoom vettoriale, memoria mista, limite iPhone e studio compressione | `npm run typecheck` | Recupero checkpoint e persistenza report conservati nel nuovo entry; vecchia UI memoria rimossa |
| 2026-08-12 | 2 | Ripristinata la parita completa dei lab tratto umano e zoom vettoriale | Verifiche Grain, History, Blend, Stroke, Touch, View e Vector | Contratti, telemetria, probe GPU e salvataggi conservati fuori dall'editor |
| 2026-08-12 | 2 | Aggiunti i gate permanenti sui confini sorgente e sul bundle | `verify-source-boundaries.mjs` e `check-production-bundle.mjs` | Produzione senza dipendenze o chunk Labs; Labs compilato separatamente |
| 2026-08-12 | 2 | Chiuso il gate finale della fase | `npm run check` e `git diff --check` | TypeScript verde, 60/60 suite verdi, entrambe le build verdi; Fase 2 completata |
| 2026-08-12 | 3 | Rimossi import, variabili, parametri e helper inutilizzati | TypeScript con `noUnusedLocals` e `noUnusedParameters` | Diagnostici unused passati da 243 a zero; controlli resi permanenti |
| 2026-08-12 | 3 | Eliminati gate UI sempre veri e flag vettoriale duplicato | Verifiche UI, Brush Studio e Vector Text | Rami morti rimossi; inizializzazione vettoriale rispetta il contratto dell'engine |
| 2026-08-12 | 3 | Rimossi selettore e API fittizi del formato livello | Verifiche Project Storage, Document Size, Intense Blending e Layer Stack | Restore legacy RGBA8 migrato chunk per chunk a RGBA16F senza alterare il progetto salvato |
| 2026-08-12 | 3 | Sistemate dipendenze, configurazione editor e terminatori di riga | Typecheck, parsing CSS, scansione EOL e `git diff --check` | `@types/earcut` solo sviluppo; tutti i file di testo in LF, zero CR residui |
| 2026-08-12 | 3 | Chiuso il gate finale della fase | `npm run check` e smoke browser 1080 x 1920 | 60/60 suite e due build verdi; tratto, Undo/Redo e console invariati; Fase 3 completata |
| 2026-08-13 | 4 | Introdotti controller e porte esplicite per pennelli, Fill, Selection e Tool Settings | Typecheck e verifier mirati | Brush Library, Brush Studio e controlli rapidi non usano piu input nascosti come stato condiviso |
| 2026-08-13 | 4 | Migrati testo, SVG, effetti vettoriali, Stroke, effetti raster e regolazioni | Verifier vector/effects/stroke/adjustments e lifecycle History | Gesti begin/update/commit preservano una sola azione Undo; rimossi proxy ed eventi sintetici |
| 2026-08-13 | 4 | Migrati livelli, stato app e telemetria produttiva | Verifier Layer Stack, Fill, History e GPU memory | Lista livelli visibile autorevole; status e memoria spostati fuori dalla UI legacy |
| 2026-08-13 | 4 | Eliminati `#controlsPanel`, ID, listener, sezioni HTML e CSS orfani | Scansioni sorgente, `npm run typecheck` e `git diff --check` | Nessun controllo nascosto resta come bus di stato; mantenuti solo file input, canvas e live region tecnici |
| 2026-08-13 | 4 | Chiuso il gate finale della fase | `npm run check` e browser locale 1280 x 720 / 390 x 700 | 60/60 suite, bundle produzione e Labs verdi; Tools/Layers verificati, WebGPU pronto, zero errori/warning; Fase 4 completata |
| 2026-08-13 | 5 | Estratta la sessione progetto da `main.ts` tramite porta motore ristretta | Typecheck, Project Home, Project Storage e build produzione | Save/restore, dirty tracking, thumbnail, shortcut e ritorno Home sono isolati nel `ProjectSessionController`; nessun handler legacy resta nel bootstrap |
| 2026-08-13 | 5 | Estratti comandi e coda Undo/Redo nel `HistoryControlsController` | Typecheck, verifier controller dedicato e 61/61 suite | Il motore resta autorevole; coda FIFO, lock, scorciatoie, diagnostica e refresh post-replay sono isolati senza trascinare payload History nella UI |
| 2026-08-13 | 5 | Estratta la libreria pennelli nel `BrushLibraryController` | Typecheck, verifier transazionale dedicato e 62/62 suite | Catalogo, preview, import/export, selezioni serializzate e rollback GPU sono fuori da `main.ts`; gli asset temporanei vengono rilasciati anche in errore |
| 2026-08-13 | 5 | Reso autonomo il `MobileBrushStudioController` esistente | Typecheck, verifier lifecycle/concorrenza, 62/62 suite e bundle produzione | Porta motore ristretta, DOM confinato alla root, dispose attendibile, lock Undo/Redo, salvataggi/import non cancellabili a meta e retry asset protetti dalla cronologia |
| 2026-08-13 | 5 | Estratto `EditorToolsController` da `main.ts` | Typecheck, verifier dedicato, 63/63 suite e bundle produzione | Apertura, ricerca, gesture e routing tipizzato sono isolati; import vettoriali bloccati durante Undo/Redo, lifecycle `inert`/dispose verificato e contratti tool/effetti centralizzati |
| 2026-08-13 | 5 | Estratti `LayerPanelController`, `LayerThumbnailController` e read model della scena | Typecheck, verifier dedicati, 65/65 suite e bundle produzione | Lista, merge, riordino e lifecycle sono fuori da `main.ts`; miniature CPU bounded e readback GPU serializzati distinguono ensure/invalidate, scartano risultati obsoleti e conservano la cache utile a Undo/Redo |
| 2026-08-13 | 5 | Estratto `SceneEditorController` con porte motore ristrette e chiavi stabili | `npm run check`, 66/66 suite e smoke browser Layers | Add/select/duplicate, visibilità, proprietà, merge, delete e loader sono fuori da `main.ts`; Undo/Redo reale ripristina la riga duplicata, dispose impedisce mutazioni tardive e la console resta senza errori |
| 2026-08-13 | 5 | Estratto `CanvasInputController` con porte ristrette e lifecycle proprietario | Typecheck, 67/67 suite, build produzione/Labs e smoke browser | Paint/coalesced input, touch intent, pinch/pan/rotate, Fill, Selection, Liquify, shortcut e resize sono fuori da `main.ts`; dispose chiude le transazioni e il reload `pagehide` non produce errori |
| 2026-08-13 | 5 | Estratti lifecycle documento e controlli rapidi dei pennelli | Typecheck, verifier comportamentali dedicati e 69/69 suite | Selezione testo, compressione durante focus/pointer, prevenzione doppio tap, colore, slider, preview e commit dei quick control hanno proprietari espliciti e cleanup verificato |
| 2026-08-13 | 5 | Estratto `RasterAdjustmentsController` | Typecheck, verifier transazionale dedicato e suite effetti mirate | Liquify, Gaussian Blur, Motion Blur e Noise condividono mutua esclusione e recovery senza vivere nel bootstrap; preview, Apply, Cancel, focus, navigazione e una sola transazione History sono caratterizzati; `main.ts` ridotto da 4.360 a 2.893 righe |
| 2026-08-13 | 5 | Estratto `CanvasToolController` | Typecheck, verifier comportamentale dedicato e suite Fill/Selection/Vector/UI riallineate | Stato Paint/Blend/Fill/Selection/Transform/Liquify, revisioni async, accessibilita tastiera e lifecycle Distort sono fuori dal bootstrap; i verifier legacy controllano il nuovo proprietario e `main.ts` e sceso a 2.660 righe |
| 2026-08-13 | 5 | Estratti stile raster, diagnostica app e pannello memoria GPU | Verifier dedicati e suite Stroke/Effects/History/Compression riallineate | Mutazioni degli effetti non distruttivi, report diagnostico, accounting e rendering della memoria hanno proprietari e porte ristrette; nessuna logica equivalente resta nel bootstrap |
| 2026-08-13 | 5 | Confinati DOM e runtime browser dei controller produttivi | `verify-controller-boundaries.mjs` su 28 proprietari e typecheck | Stroke, effetti raster, Tool Settings, vettori e Home ricevono root/document/browser espliciti; vietati lookup DOM globali e clock impliciti nei controller |
| 2026-08-13 | 5 | Estratti `PixelSelectionController` e `RuntimeStatsController` | Verifier comportamentali dedicati | Selezione asincrona, lock UI, recovery, telemetria visibile, polling, diagnostica e dispose non vivono piu in `main.ts` |
| 2026-08-13 | 5 | Chiuso il gate finale della fase | `npm run check`, `git diff --check` e browser locale 1280×720 / 390×700 | TypeScript verde, 76/76 suite, bundle produzione senza Labs e build Labs verdi; Paint, Undo/Redo, Fill, Selection, livelli, Stroke, Color Overlay, memoria e diagnostica verificati con zero errori/warning; `main.ts` ridotto da 4.360 a 1.757 righe |
