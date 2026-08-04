# Memoria operativa: motore pennelli WebGPU

Questa è la sintesi operativa. Il log integrale — protocolli completi, tabelle
di ogni run e motivazioni estese — è conservato in
[AGENTS-STORICO.md](AGENTS-STORICO.md). I numeri di run (`#N`) si riferiscono al
registro D1, che è append-only.

## Obiettivo e regole

- Il tratto deve seguire il dito con la minima latenza possibile **senza
  modificare il risultato visivo del pennello**. Non cambiare Count, size,
  spacing, flow, hardness, blend intensity, jitter, seed, ordine degli stamp o
  blending per ottenere prestazioni. Unica eccezione promossa: lo spacing
  adattivo sulla congestione (vedi sotto), richiesto esplicitamente dall'utente.
- Un solo esperimento isolato per run; ogni run va confrontata con la baseline
  giusta a parità di dispositivo, canvas, fingerprint e firme di telemetria.
  Verificare le firme **prima** di leggere le prestazioni.
- La decisione finale è sempre dell'utente; il criterio è il comportamento
  end-to-end senza lag, non il confronto a carico forzatamente identico.
- Aggiornare questo file dopo ogni passo misurato. Non sostituire il benchmark
  canonico o i suoi parametri senza richiesta esplicita.
- `dist/` è un artefatto generato e ignorato da Git: rigenerarlo con
  `npm run build` per ogni pubblicazione, impacchettarlo per Sites e non
  commettere i bundle con hash.
- Le icone dell'interfaccia provengono esclusivamente dal catalogo ufficiale
  **Lucide** (`https://lucide.dev/icons/`), pacchetto npm `lucide`, licenza
  ISC. Importare soltanto le icone nominate che servono, mantenere lo stile
  outline Lucide da `20 px` con cap/join arrotondati e non mescolare altre
  famiglie, emoji o SVG disegnati a mano. Sul canvas mobile usare la doppia
  traccia già definita in CSS: avorio `#f2f0e9` sopra antracite `#202226`,
  senza ombre.
- Preferenza esplicita dell'utente: **niente agenti o subagenti**; il modello
  principale legge, progetta, implementa, revisiona e pubblica da solo.

Avvertenze di misura permanenti:

- `estimatedScissorPixels` è la somma delle bounding rect scissor, non i
  frammenti realmente rasterizzati.
- Safari/iPhone non espone `timestamp-query`: i probe
  `GPUQueue.onSubmittedWorkDone()` misurano il completamento di un prefisso
  FIFO **più** il ritardo della callback JS, mai tempo GPU isolato o
  percentuale di utilizzo.
- La risoluzione di `performance.now()` su Safari è ~1 ms: non usare i
  percentili CPU per distinguere frazioni di millisecondo.

## Benchmark canonico e baseline

**Play tratto registrato — protocollo storico rev `3`**: traccia umana fissa,
fingerprint `18982412`, `1583` punti. Il preset storico usa size `750 px`,
spacing `1%`, Count `16`, flow/hardness `100%`, blend intensity `4×`, Opacità
`100%`, jitter come registrato e pressione ininfluente. Le run storiche
Normal/M1/Light restano leggibili ma non sono aggregabili con la nuova suite.

**Suite rendering pubblica rev `4` — candidata per il prossimo run iPhone**:
un solo tap esegue esattamente `3` casi sulla stessa traccia canonica:
`Light Glaze`, `Uniformed Glaze` e `Intense Blending`, tutti `Base` (cerchio),
Grain `Off`. Preset: size `750 px`, spacing `1%`, Count `16`,
Flow/Opacity/Hardness `100%`, Blend Intensity fisso `1×` e jitter canonico del
profilo Base. Il report include firme, stamp base/copie fisiche, pacing, memoria
stabile e picco logico transitorio old+new per caso. Non promuovere una nuova
baseline finché la suite non passa sulla traccia canonica
reale su iPhone; non aggregare i suoi risultati con la vecchia matrice rev `2`.
Non aggregare mai run di varianti diverse. Con lo spacing adattivo attivo,
`spacingPercent: 1` **non** implica più `12107` stamp: leggere sempre
`adaptiveSpacingEvents`, spacing finale e numero di stamp.

**Play Blend registrato**: stessa traccia sul tool Blend, sfondo deterministico
a sei bande dipinte con Paint prima del profilo; forza size `750`, spacing
`1%`, flow/hardness `100%`, Paint `0%`, Stretch `20%`, Circle, Grain Off. Le
run `cold` (prima allocazione scratch) e `warm` non vanno aggregate.

Baseline attive:

- **#37 Base / #38 Fur** — layout fullscreen + cache di presentazione
  (Sites `42`, commit `c01ac1c`): baseline Paint correnti.
- **#70–#73** — quartetto Grain Off/Fixed × Normal/M1 (Sites `61`).
- **#76** — baseline Blend dry (precedente al drenaggio a budget e al
  renderer compute; la prossima run Blend valida va confrontata con questa).

Baseline storiche utili per leggere run vecchie: `#1` quad originale, `#11`
strip 4 vertici, `#14` telemetria v2, `#19` monolitica finale (commit
`ad37505`), `#28/#29` Fur full quad, `#32` Fur bitmask, `#33/#34` history,
`#35/#36` controlli fullscreen pre-cache, `#42/#44` tip patch, `#49/#50`
telemetria probe, `#53/#54` spacing adattivo, `#61/#63` piramide mip + fix
stale.

## Struttura del sorgente del motore (31 luglio 2026)

`src/brush-engine.ts` non è più un file unico: **20.758 → 8.810 righe (−58%)**.
La classe `BrushEngine` conserva lo stato e il percorso caldo del tratto; tutto
il resto vive in moduli dedicati:

| modulo | contenuto |
|---|---|
| `engine-types` | tipi pubblici e `defaultBrushSettings` |
| `engine-strategies` | tutte le firme di strategia e il routing dei blend mode |
| `engine-stats` | forme dei report di telemetria |
| `engine-limits` | dimensioni, budget, taglie degli uniform |
| `engine-math` | funzioni numeriche pure |
| `engine-memory-model` | costo in MiB di ogni risorsa |
| `engine-geometry` | rect sporchi, mip, bounding box |
| `engine-gpu-utils` | attesa shader, descrizione adapter |
| `engine-stamp-upload` | impacchettamento stamp e uniform pennello |
| `engine-reports` | corpi di benchmark, stats, studi e diagnostica |
| `engine-cold-storage` | archiviazione fredda e compressione livelli |
| `engine-layer-runtime` | allocazione livelli, merged surface, bake, compositing |
| `engine-vector-text-runtime` | presentazione GPU del testo vettoriale e scena mista |
| `engine-history-runtime` | cursore cronologia, replay, stato vettoriale |
| `engine-fill-runtime` | lifecycle, transazione e replay del Riempimento GPU |
| `engine-glaze-runtime` | risorse e sessione Light/Uniformed/Intense |
| `engine-adaptive-preview-runtime` | sonde e patch dell'anteprima adattiva |
| `engine-resource-setup` | creazione risorse statiche e renderer effetti |
| `engine-runtime-misc` | rotazione vista, coordinate, lifecycle geometria Traccia |
| `engine-*-types`, `engine-*-resources` | record interni e risorse GPU |
| `stroke-curve-core`, `stroke-stabilization-core` | planner causali preallocati di curva e stabilizzazione Paint |
| `shape-occupancy`, `shape-mask-decode`, `adaptive-preview-runtime`, `vector-text-types` | domini specifici |

Convenzione sulla visibilità, dichiarata sopra la classe e da rispettare:

- `private` = dettaglio della classe;
- **senza modificatore** = interno al motore, condiviso con i moduli `engine-*`.
  Non è API pubblica: fuori da `src/engine-*.ts` non va usato;
- i metodi API (quelli chiamati da `main.ts`, benchmark e strumenti DEV)
  restano metodi della classe anche quando il corpo è stato spostato: nel corpo
  resta la sola chiamata alla funzione estratta, così la firma non cambia mai.

**Il percorso caldo GPU per tratto non è stato toccato dal refactoring e non
va toccato senza un esperimento isolato**:
`submitImmediate`, `submitLightGlazeImmediate`, `encodeRasterStrokeUpdate`,
`renderFrame` e i loro aiutanti per stamp restano nella classe. Nessun buffer,
batch o encoder era cambiato durante quell'estrazione. Il planner curva Paint
del 3 agosto 2026 opera a monte, nella generazione causale delle posizioni, e
ha una misura e una firma proprie descritte sotto.

Le suite `*:verify` non leggono più `brush-engine.ts` da sola: usano
`scripts/engine-source.mjs`, che concatena la classe e i moduli estratti
elencati in `ENGINE_SOURCE_FILES`. **Quando si estrae un nuovo modulo dal
motore va aggiunto a quella lista**, altrimenti le verifiche statiche smettono
di vederne il contenuto. L'helper fallisce apposta se un modulo elencato non è
più importato da `brush-engine.ts`, così la lista non invecchia in silenzio.

Prove raccolte durante lo spostamento, tutte su questa macchina:

- le 238 dichiarazioni spostate fuori dalla classe sono risultate identiche
  byte per byte all'originale (solo il prefisso `export` aggiunto a 174), e a
  quel punto il corpo della classe era ancora invariato a 722.376 byte;
- golden pixel Traccia confrontato A/B con un worktree su `HEAD`: hash
  `8d5a75a6…f6dcb0`, **identico prima e dopo** ogni fase, comprese le nove
  estrazioni di metodi. Attenzione: su questa macchina il verdetto è "Golden
  diverso" **anche sul codice non modificato**, perché la baseline
  `goldens/raster-stroke-rgba8-v1.json` è stata catturata su un altro
  dispositivo. Il confronto valido è fra le due run, non col file;
- `tsc --noEmit`, le quindici suite `*:verify` e `npm run build` verdi dopo
  ogni fase.

Costo pagato, da tenere presente: circa 340 membri hanno perso `private`. In
TypeScript è solo un'annotazione di compilazione, quindi a runtime non cambia
nulla, ma l'incapsulamento ora sta al confine dei moduli e non più a quello
della classe. Le suite `*:verify` che asserivano `private X` sono state
aggiornate alla forma nuova, non rimosse.

Codice morto rimosso (verificato con grep su tutto il repo, markdown compreso,
una sola occorrenza = la dichiarazione): **36 export** inutilizzati — 26 in
`bevel-core`, 2 in `stroke-core`, 1 in `shadow-core`, 1 in
`vector-text-transform`, 6 in `mixed-scene-stack` — più due helper privati
rimasti orfani in `bevel-core`, e la classe `VectorTextPrototype` (554 righe)
superata da `mixed-vector-text-controller`, che usa gli stessi id DOM (due dei
quali non esistevano più in `index.html`, quindi il costruttore avrebbe
comunque lanciato). Il file residuo, soli contratti di tipo, è stato rinominato
`src/vector-text-types.ts`.

Audit avversariale del refactoring (5 revisori indipendenti, 31/07/2026). Ha
trovato e fatto correggere: un delegante `Promise<void>` senza `await`
(`seedActiveLayerMemoryStress`, 6 chiamanti vivi che proseguivano in anticipo)
più due latenti; cinque asserzioni indebolite in silenzio, tra cui due finestre
di sezione collassate a `slice(start, -1)` perché il marcatore di fine non
esisteva più, e alcuni `doesNotMatch` diventati infalsificabili perché
cercavano `this.X` dentro moduli dove `this` non compare mai. Da qui due
difese permanenti: `assertSection()` in `verify-layer-stack` e il limite di
dimensione in `section()` di `verify-intense-blending` fanno fallire una
sezione disallineata invece di lasciarla passare; `readEngineSource()` fallisce
se esiste un `src/engine-*.ts` non registrato in `ENGINE_SOURCE_FILES`.
I negativi ora usano l'alternanza `(this|engine)\.` perché il ricevitore
dipende da dove vive il codice.

## Stato attuale del motore (tutto ciò che è attivo)

Paint:

- Quad `triangle-strip` da 4 vertici per copia (passo 3, run `#11`: `+3%` FPS,
  p95 `−16%`). Fragment con coverage generica `smoothstep`.
- Riuso esatto di `copySeed` per il jitter colore (passo 6, `#16`).
- Color Dynamics non ha più il moltiplicatore ambiguo «Intensità globale»:
  Hue, Saturation, Lightness e Darkness sono controlli diretti. Il campo
  `jitterMaster` resta nell'ABI/history per compatibilità, ma viene normalizzato
  a `1` e non partecipa più né alle uniform GPU né alla preview Canvas2D.
- Dirty rect direzionale conservativo sui jitter di posizione (passo 7, `#19`:
  `−36,6%` area scissor, FPS invariati; mantenuto come base per binning
  futuro, non come vittoria FPS).
- Le curve Paint non uniscono più i campioni grezzi con sole corde: il planner
  Hermite causale endpoint-exact
  `causal-endpoint-exact-predictive-hermite-corrective-tangents-quarter-pixel-target-v1`
  produce ogni segmento appena arriva il suo endpoint, senza look-ahead né un
  intervallo aggiuntivo di latenza. Predice la tangente finale dal turn
  osservato, corregge subito una previsione incoerente oltre `15°`, conserva
  gli angoli intenzionali oltre `60°` e linearizza la cubica con target
  conservativo `≤0,25 px` (cap di sicurezza `512`, sufficiente anche a un
  attraversamento di `192000 px` a `59°`). È rounding fedele dei segmenti:
  passa per ogni input e non è un filtro che cancella il micro-jitter. Lo
  spacing è esatto sulla micro-poligonale subpixel autorevole, non sulla
  lunghezza analitica della cubica; sulla traccia canonica la poligonale misura
  `9,353 px` meno dell'arco ad alta risoluzione. Count, seed, `emitStamp`,
  shader, batching GPU, glaze, taper e payload
  Undo/Redo restano quelli autorevoli; Blend dry è escluso. Il solo stato
  aggiunto è un planner preallocato una volta nel motore e resettato a ogni
  gesto (nessuna risorsa GPU, allocazione per gesto o allocazione per segmento).
  La tangente è continua quando la previsione resta coerente; correzioni e
  angoli intenzionali introducono apposta un raccordo non-C1 per evitare hook.
- Misura locale del 3 agosto 2026 sulla traccia canonica rev `3`, prima dello
  spacing adattivo: `1565` segmenti non nulli diventano `4417` microcorde,
  lunghezza `+0,0884%` e stamp base `12107→12117` (`+10`, `+0,083%`); con
  Count `16` sono `+160` copie fisiche e la history packed cresce di soli
  `320 B`. Bound massimo osservato `0,249974 px`. Microbenchmark Node desktop:
  costo aggiunto `~0,207 µs` per input non nullo, circa `0,324 ms` sull'intera
  traccia di `1583` punti/`6,8 s`; non è una misura iPhone. QA browser reale,
  Circle `80 px`, spacing `1%`, Count `1`, jitter/Grain off: il cerchio a `25`
  punti non mostra più i lati e coincide visivamente con quello a `181` punti
  in Light, Uniformed e Intense; Undo e Redo ripristinano lo stesso risultato.
  Telemetria `61` firma strategia e contatori; `stroke-curve:verify` blocca
  causalità, endpoint, soglie scale-invariant, bound, batch invariance,
  routing Paint/Blend e regressione canonica opzionale. Replay canonico Light
  reale nella stessa app desktop: `12117` stamp / `193872` copie, spacing
  adattivo fermo `1,00→1,00%`, CPU frame p95 `1,10 ms`, submit p95 `0,40 ms`,
  probe coda FIFO `11,70 ms`, `137 FPS` medi e `15` frame oltre `20 ms`; è QA
  locale, non una nuova baseline e non una misura GPU isolata.
- Stabilizzazione Paint aggiunta il 3 agosto 2026, esposta `0–100%` soltanto
  nei tre rendering glaze pubblici. Strategia
  `causal-linear-input-ema-speed-lag-mature-prefix-smoothstep-revision-tail-endpoint-exact-v1`:
  un EMA causale integrato esattamente sul moto lineare crea un ritardo che
  cresce con la velocità; la costante massima è `160 ms` e scala col quadrato
  del controllo. La parte matura resta filtrata al 100%, mentre negli ultimi
  `tau` millisecondi un smoothstep cubico porta la forza fino a `0%` sul
  campione più recente. L'endpoint geometrico è quindi sempre quello raw sotto
  il puntatore; `finish()` congela esattamente l'ultima geometria mostrata,
  senza ageing al lift, catch-up o snap. A `0%` il ramo precedente è eseguito
  direttamente e il planner non viene coinvolto.
- La coda non viene committata e poi corretta: Light MAX e Uniformed/Intense
  source-over non sono invertibili. L'accumulatore per-gesture contiene prefisso
  maturo più ultima revisione; a ogni frame una texture patch dello stesso
  formato ripristina il prefisso sotto la vecchia coda, vengono aggiunti una
  volta gli stamp appena maturi, si salva il nuovo prefisso e infine si disegna
  la coda latest-only con le pipeline WebGPU autorevoli di Shape, Grain, Count,
  jitter e glaze. La patch è quantizzata a `128 px`, cresce geometricamente e
  persiste fra gesti finché la stabilizzazione resta attiva; è R8 per Light e
  RGBA16F per Uniformed/Intense, non una seconda texture `4096²` obbligatoria.
  `stabilizationTailMiB` la include nel totale GPU contato e lo slider a zero la
  rilascia quando il motore è idle.
- Dirty rect provvisoria e autorevole sono separate: la prima invalida display,
  mip ed effetti per cancellare ogni revisione precedente; soltanto la seconda
  viene committata nel layer, marca tile/contenuto e alimenta il payload packed
  Undo/Redo. Preview e risultato finale condividono clone dello stesso planner
  Hermite, stato spacing e sequenza seed; la preview usa buffer già residenti e
  oggetti Stamp riutilizzati. Il core usa typed array preallocati (circa
  `0,17 MiB`) e non alloca per campione. Telemetria rev `62` registra forza,
  campioni, punti maturi, frame/stamp/copie provvisori e massimo footprint della
  patch; i benchmark canonici e le registrazioni legacy forzano esplicitamente
  `0%`, quindi non cambiano in silenzio.
- Verifica locale del 3 agosto: TypeScript, tutte le venti suite
  `*:verify`, `git diff --check` e build Vite/Sites verdi. QA browser reale su
  NVIDIA Ampere/RGBA8, Light, Circle `80 px`, spacing `1%`, Count `1`, Flow e
  Hardness `100%`, jitter posizione/colore e Grain a zero, stabilizzazione
  `100%`: curva continua, Undo e Redo completati, nessun warning/error browser
  o WebGPU. È una prova funzionale desktop; non è ancora una misura canonica
  iPhone né una pubblicazione.
- Shape 2K: decodifica PNG grayscale deterministica (`png-gray8-direct`,
  SHA-256 `69978b6e…`) + pre-mappa di occupazione conservativa `256²` sui mip
  `0–4` con fallback automatico (radius `<128`, LOD `>4`, copertura `>50%`).
  Run `#32`: `+18,5%` FPS, coda finale `−96,9%`, frame lenti `−89%`.
- Undo/Redo usa ora una sola timeline globale ordinata per azione raster e
  vettoriale. Il payload raster autorevole non conserva più array `Stamp` o
  step sul CPU: vive packed in buffer GPU paginati da `2 MiB` (`32 B` per stamp
  Paint e uniform dinamiche per Blend dry), con strategia
  `gpu-resident-paged-packed-payload-copy-replay`. Sul CPU restano soltanto i
  metadati necessari a ordine, impostazioni, dirty rect e slice. Il submit live
  conserva i byte con una copia buffer→buffer GPU; Undo/Redo li ricopia nei
  buffer istanze/uniformi prima degli stessi shader, senza repack o upload CPU
  (`clear-and-gpu-buffer-copy-replay`). Testo e SVG registrano delta compatti
  del solo nodo interessato, posizione nello stack e selezione, condividendo il
  documento SVG immutabile invece di duplicarne path e typed array. Il limite
  di memoria della cronologia raster resta aperto per uso prolungato.
- La cronologia vettoriale è **per gesto**, non per evento intermedio: una
  digitazione fino a blur/change, un trascinamento di posizione/scala/rotazione
  o Distort e una sessione slider producono al massimo un'azione; un gesto che
  termina byte-equivalente allo stato iniziale non crea storia né cancella il
  Redo. Pan e semplice selezione non entrano nella cronologia.
- UI full-canvas con cassetto overlay e navigazione a due dita; il canvas più
  grande costò `−30%` FPS (`#35/#36`), recuperati da…
- Header telefono del 4 agosto 2026, attivo soltanto sotto `700 px`: overlay
  completamente trasparente sul canvas, Home a sinistra e Tools/Livelli/Salva
  a destra. Nella prima versione le quattro azioni erano visual-only e
  disabilitate; icone
  outline avorio `#f2f0e9` con sottotraccia antracite `#202226`, senza fondo,
  bordo dell'header, blur o ombre. Tablet e desktop conservano la topbar
  precedente. Follow-up dello stesso giorno: il selettore brand è stato reso
  abbastanza specifico da rimuovere davvero il nome prima di Home sul layout
  compatto; rimossi integralmente dalla UI anche i badge «Zoom vettori · GPU»
  e percentuale/PIXEL, conservando invariati zoom, soglia nearest e renderer.
  Follow-up: aggiunta al centro del bordo sinistro una rail mobile con lo stesso
  fondo `#0d0f13`, senza ombre, e controlli da `44 px` per colore pennello,
  Gomma, Blend, Undo e Redo. Colore, Blend e cronologia riusano le azioni già
  autorevoli; la Gomma resta visual-only e disabilitata finché non esisterà una
  semantica di cancellazione nel motore. Tutte le icone mobile, incluse quelle
  dell'header, sono ora Lucide `1.28.0` importate singolarmente e condividono la
  doppia traccia avorio/antracite. Secondo follow-up: inserito Pennello subito
  sotto il colore; Pennello e Blend selezionano il tool reale e hanno icona
  avorio soltanto quando attivi, mentre i tool inattivi e Undo/Redo non
  disponibili usano grigio `#85888f`. Rimossi sia il contorno focus blu sia il
  tap highlight mobile e anche il fondo di selezione: lo stato è espresso dal
  solo colore dell'icona. La Gomma rimane grigia e disabilitata, non viene
  rappresentata falsamente come attiva. Terzo follow-up: tutte le icone e il
  selettore colore mobile sono `20×20 px`; altezza utile dell'header e larghezza
  della rail sono entrambe `52 px` (l'header somma soltanto la safe area
  superiore). Le aree touch restano `44×44 px`. Quarto follow-up: sotto
  `700 px` il vecchio pannello completo dei parametri parte chiuso ed è nascosto
  dal layout, così come il suggerimento «Un dito disegna…». Il pulsante Tools
  dell'header apre ora un bottom sheet non modale, senza ombra e con fondo
  `#0d0f13`, trascinabile soltanto dalla maniglia `42×5 px` fra due snap:
  expanded a `77 px + safe-area` dal bordo alto, cioè `25 px` sotto l'header
  mobile da `52 px`, e peek con circa il `26%`
  dell'altezza visibile (clamp `160–240 px`). Il contenuto è scrollabile; per
  ora contiene solo una ricerca con icona Lucide avorio, placeholder inglese
  grigio e bordo `#dd5c35`. Tap sulla maniglia alterna gli snap, Tools chiude
  interamente il foglio e il focus della ricerca lo espande soltanto se non è
  già nello snap alto. Il campo usa `16 px`, così Safari iPhone non applica lo
  zoom automatico al focus. Lo zoom pagina al doppio tap è bloccato su mobile
  da viewport, superfici UI con `touch-action` restrittivo e un fallback
  `touchend`/`dblclick` non-passive da `350 ms` e `32 px`; il multitouch resetta
  subito il riconoscitore, quindi la navigazione WebGPU a due dita del canvas
  resta invariata. Quinto follow-up: quando Search viene toccato dallo snap
  basso, il foglio raggiunge lo snap alto senza transizione prima che Safari assegni il
  focus; il focus programmatico usa `preventScroll`, evitando che lo snap del
  foglio e il pan automatico della tastiera si sommino e portino la ricerca
  fuori schermo. Se il foglio è già alto non viene riposizionato. Non esiste
  loop UI: offset e snap vengono ricalcolati solo durante drag, apertura o
  resize. Sesto follow-up: durante il drag dalla maniglia il foglio può superare
  lo snap peek fino a uscire interamente; rilasciandolo con non più di `48 px`
  visibili viene chiuso davvero (stato, ARIA e focus inclusi), mentre un rilascio
  precedente torna a peek e un `pointercancel` ripristina lo snap di partenza.
  Settimo follow-up: il foglio contiene ora quattro categorie in quest'ordine:
  `Drawing`, `Select & Edit`, `Insert`, `Effects`. Tutti i titoli e i nomi tool
  visibili del foglio sono in inglese. Ogni titolo è allineato a
  sinistra a `18 px` dal bordo e precede una griglia a quattro colonne con icona
  Lucide `20×20 px` e nome sotto, senza card, ombre o fondi di selezione. Gli
  strumenti canvas selezionano il routing reale e chiudono il foglio; Testo,
  SVG e Immagine inoltrano le azioni esistenti; gli effetti commutano i controlli
  autorevoli del raster selezionato. Gomma resta visibile ma disabilitata perché
  non è ancora implementata. Search filtra a ogni input per nome e sinonimi,
  ignorando maiuscole e accenti; una categoria resta visibile se conserva almeno
  un risultato, lo scroll torna all'inizio e appare uno stato vuoto soltanto con
  zero corrispondenze. Il filtro visita solo i quattordici elementi quando viene
  digitato testo o aperto il foglio: nessun polling o loop permanente.
  Ottavo follow-up: Layers è ora attivo e apre, in mutua esclusione con Tools,
  un pannello mobile largo `240 px`, staccato dall'header ma agganciato al bordo
  destro come la rail sinistra, centrato verticalmente nello spazio utile e alto soltanto quanto
  toolbar e layer presenti (fino al limite disponibile, poi scrollabile),
  senza ombre e con lo stesso fondo `#0d0f13`. La toolbar
  superiore usa le icone Lucide `Plus`, `Copy` e `SquareDashed`: `+` crea un
  vero raster, Mask crea una vera clipping mask sopra il raster selezionato,
  mentre Copy resta esplicitamente disabilitato. Lo stack misto è mostrato
  top-first; ogni riga seleziona il nodo autorevole, espone `R` soltanto sui
  raster e usa `Eye`/`EyeOff` per la visibilità di raster, testo, SVG e immagini.
  Ogni card usa una sola riga: miniatura, nome, `R` ed Eye; i controlli a destra
  conservano target `44×44 px` e sono centrati esplicitamente sui due assi.
  Il focus da tastiera è un outline interno
  arancione e non ripristina il contorno blu al tap.
  Il nodo selezionato ha il solo contorno `#dd5c35`; le etichette predefinite
  italiane vengono tradotte soltanto nella vista mobile (`Layer`, `Text`,
  `Image`, `Clipping Mask`) senza mutare nomi, history o ABI del documento.
  Le miniature raster `52×52 px`, su tavola bianca, mostrano ora una cattura
  reale `64×64` del mip 0 autorevole. Strategia
  `lazy-idle-gpu-area-sample-64-readback-cache-v1`: una pipeline lazy campiona
  una griglia `8×8` dentro ciascuna delle `4096` celle della miniatura
  (`262144` texture load), scrive un target RGBA8 da `16 KiB` e mappa soltanto
  un buffer da `16 KiB`; target+buffer persistenti costano `32 KiB` GPU e la
  cache CPU costa `16 KiB` per raster (`256 KiB` al massimo di 16 layer).
  La cattura parte solo con pannello aperto, puntatore sollevato, history stabile
  e nessun cambio layer; è coalescente e aggiorna l'attivo dopo il gesto. Non
  reidrata mai un livello cold: ogni raster inattivo conserva l'ultima cattura
  ottenuta quando era attivo, mentre prima della prima cattura resta il fallback
  strutturale. La miniatura rappresenta i pixel raster autorevoli, non il
  composito dello stack o gli effetti derivati; testo/SVG/immagine mantengono il
  campione semantico. Il percorso caldo Paint e gli encoder autorevoli non sono
  stati modificati. Una dirty flag viene alzata soltanto da
  apertura, history, mutazioni dello stack/scena e fine gesto; durante Paint,
  Transform, una proprietà continua o una transazione di cambio layer il
  renderer della sidebar esce prima di creare viste, array o stringhe e lascia
  pendente il refresh fino al commit. Quando history torna stabile, un solo RAF
  coalescente aggiorna subito la lista senza attendere il polling da `500 ms`;
  a pannello chiuso esce al primo booleano. Le
  righe DOM conservano identità finché chiavi e ordine restano invariati; un
  vero cambio stack le sostituisce atomicamente. Il contenuto viene aggiornato
  soltanto se cambia la firma di stack/selezione/visibilità/contenuto/cache.
  Tutte le suite `*:verify`, TypeScript, build Vite/Sites e `git diff --check`
  verdi;
  nessuna misura prestazionale o QA fisica iPhone ancora eseguita.
  Dopo l'ottavo follow-up: TypeScript/build Vite+Sites, tutte le `22` suite
  `*:verify` e `git diff --check` verdi; nessuna nuova misura prestazionale o
  QA fisica iPhone eseguita.
  Dopo il nono follow-up (miniature raster reali): TypeScript/build Vite+Sites,
  tutte le `22` suite `*:verify`, la nuova regressione statica di scheduling,
  contabilità memoria e assenza dal `pointermove`, più `git diff --check`, verdi.
  Lo shader viene compilato asincronicamente al primo uso e conserva il fallback
  se il dispositivo lo rifiuta; non sono ancora state eseguite misura canonica
  né QA fisica iPhone, quindi non dichiarare costo nullo misurato.
  Decimo follow-up: un audit browser a viewport `390×844` ha misurato tutti i
  contenuti della rail a `x=26 px`; la rail era però centrata sull'intero
  viewport (`y=422`) e Layers nello spazio utile sotto l'header (`y=448`). Ora
  condividono gli stessi vincoli top/bottom e lo stesso centro verticale. La
  protezione doppio tap descritta sopra è coperta staticamente ma resta da
  provare su Safari/iPhone fisico. TypeScript/build Vite+Sites, tutte le `22`
  suite `*:verify` e `git diff --check` verdi.
  Undicesimo follow-up: sul bordo destro mobile sono comparsi due controlli
  verticali Size/Opacity con disco da `44 px` visibile a metà e target touch
  `52×56 px`. Il trascinamento usa soltanto `clientY`, aggiorna valore, ARIA e
  indicatore interno durante il gesto, poi applica le impostazioni autorevoli
  una sola volta al rilascio; Size resta disponibile anche per Blend, mentre
  Opacity segue il contratto Paint-only già esistente. Durante il gesto appare
  un pannello `155×204 px` con etichetta inglese e singola impronta reale:
  una Canvas2D dedicata, aggiornata al massimo una volta per RAF, riusa Shape e
  Hardness correnti senza readback o submission GPU e senza toccare il percorso
  caldo Paint. Tools e Layers sopprimono i controlli. QA browser locale passata
  a `430×932`, `393×852` e `375×667`, inclusi Size `1%`/circa `50%`, Opacity,
  Paint/Blend e overlay; console pulita. TypeScript, build Vite/Sites,
  `layers:verify`, `grain:verify`, `stroke:verify`, `history:verify` e
  `git diff --check` verdi. Non è ancora una QA Safari/iPhone fisico né una
  misura prestazionale canonica.
- …cache di presentazione persistente screen-space: display shader eseguito
  solo sulla dirty region, poi `copyTextureToTexture` alla swapchain
  (`#37/#38`: Base `+46%` FPS vs `#35`, migliore anche delle vecchie baseline).
- Piramide mip live condivisa per il display ridotto: 13 livelli, box filter
  `2×2` su premoltiplicato, LOD `floor(log2(1/zoom))` senza upscaling e rebuild
  atomico della cache al cambio LOD (`#61`: nessun costo misurabile). Nel
  display raster diretto con almeno due superfici, mip `1+` contiene ora il
  composito finale below→active→above costruito prima del filtro; negli altri
  percorsi conserva il contenuto `active-only` (strategia v3 descritta sotto).
- Tip preview Canvas2D (backpressure GPU): max `2` stamp in una patch
  `≤384×384` CSS a metà risoluzione, budget JS `1,25 ms`, commit atomico da
  scratch. Trigger: probe ogni `4` submission, timeout `60 ms` o due
  completion lente `≥58 ms`. `desynchronized: true` **solo su iPhone**
  (`#48`; su Android causava un rettangolo nero, `#47` suggerisce che
  sincronizzare su iPhone costa). Ritiro immediato del bitmap stale già
  confermato dalla GPU + max un retry per seriale (`#63`, promosso). Costo
  Base ~`1%` accettato. Telemetria probe dettagliata rev `15` (`#49/#50`).
- Spacing adattivo sulla congestione (promosso, `#53`): `+0,25` punti per
  probe in timeout o lento (max un incremento per probe), tetto `+1,5` punti
  (`+4` solo Android), nessuna discesa intra-stroke, reset al tratto nuovo.
  `#53`: coda finale `−91,6%`, p95 `26→17 ms` con `−25%` stamp. Il tetto
  Android esteso non basta su ARM Valhall (`#59/#60`: resta a secondi di
  ritardo) — su quel dispositivo serve altro, non più spacing.
- Il selettore Rendering pubblico espone soltanto **Light Glaze**,
  **Uniformed Glaze** e **Intense Blending**. Il vecchio slider Blend Intensity
  è rimosso: l'ABI/history conserva il campo ma il motore lo forza a `1×`, così
  Flow e Opacity non hanno un secondo moltiplicatore ambiguo.
- **Light Glaze pubblico** ha ora un contratto e una firma propri:
  `light-r8-max-per-gesture-source-over-between-gestures`. Ogni pointer-down
  parte da un accumulatore coverage `r8unorm` `4096²` vuoto; Flow partecipa al
  deposito candidato del singolo stamp, ma tutti gli stamp fisici della stessa
  gesture vengono combinati soltanto con `MAX`, mai con source-over. Opacity è
  forzata a `1` durante gli stamp e applicata una sola volta al risultato della
  gesture. Al lift avviene un solo commit source-over nel layer permanente; il
  pointer-down successivo riparte da un accumulatore vuoto e può quindi
  aumentare il colore già committato. `m1-glaze` resta soltanto un alias di
  replay storico, non l'identità del rendering pubblico. Mip finali
  `compose→filter`; memoria dedicata `37,3 MiB` in RGBA8 (`16 + 21,3`) o
  `58,7 MiB` in RGBA16F (`16 + 42,7`).
- QA browser locale non canonica del 30 luglio 2026, Circle/Grain Off/jitter
  zero/size `200`: con Flow `50%`, Opacity `50%`, la cattura presentation di
  Count `1` e quella di Count `24` sovrapposto nella stessa gesture sono
  identiche su tutta l'area raster (`0` pixel diversi); il centro passa da
  `[232,232,232]` a `[204,204,204]` in entrambi i casi. Una seconda gesture
  porta il centro a `[179,179,179]` e modifica `1585` pixel visibili. Con Flow
  e Opacity `100%`, Count `1` e `24` restano identici e il centro è `[0,0,0]`.
  `npm run light:verify` vincola inoltre numericamente MAX intra-gesture,
  source-over inter-gesture, routing R8, Opacity singola e lifecycle al lift.
- **Uniformed Glaze pubblico** usa sempre un accumulatore autorevole RGBA16F
  per-stroke `4096²`: gli stamp accumulano source-over in lineare con Flow,
  mentre Opacity viene applicata una sola volta all'intera gesture. Display,
  mip compositati ed effetti leggono lo stesso risultato live; al lift un
  resolver esatto a tile `1024²` campiona permanente+stroke e copia i pixel nel
  layer, quindi non cambia formula. Strategia firmata:
  `uniformed-linear-rgba16float-live-composite-mips-single-commit`. Memoria
  dedicata: `153,3 MiB` su layer RGBA8 (`128 + 21,3 + 4`) o `178,7 MiB` su
  layer RGBA16F (`128 + 42,7 + 8`).
- **Intense Blending pubblico** riusa la stessa classe di storage RGBA16F di
  Uniformed, ma conserva colori e source-over in sRGB codificato, come misurato
  su Procreate. Flow e Opacity moltiplicano ogni stamp fisico e non esiste un
  secondo cap finale. Il display live converte il permanente lineare in sRGB
  premoltiplicato, compone lo stroke, poi torna al formato lineare del layer;
  mip, Traccia, Smusso e Ombre usano la stessa formula. Il resolver a tile al
  lift esegue esattamente la stessa composizione. Strategia firmata:
  `intense-physical-stamps-source-over-srgb-rgba16float-live-single-commit`.
- Intense resta un vero tool Paint e attraversa il generatore standard: spacing,
  Count, jitter lineare/laterale per copia, Shape scatter, Shape mask, Grain,
  history, Undo/Redo e batching GPU sono gli stessi degli altri rendering.
  Non viene più rinominato come tool Blend e non alloca lo scratch carrier del
  Blend dry. Memoria dedicata: `153,3 MiB` su layer RGBA8 o `178,7 MiB` su
  layer RGBA16F, identica a Uniformed; passando fra i due modi la stessa texture
  RGBA16F e lo stesso tile vengono riutilizzati.
- Misura Procreate del 30 luglio 2026, configurazione dry Intense controllata:
  i PNG opachi su nero mostrano plateau interni `46 → 84 → 114/115 → 140 →
  160/161 → 178 → 191/192`. Coincidono entro un codice con la ricorrenza
  source-over `C_n = 255·[1-(1-46/255)^n]` per `n=1…7`: ogni stamp fisico
  accumula anche dentro la stessa gesture; Flow e Opacity agiscono sul deposito,
  non come cap finale. Spacing basso e jitter/scatter creano più sovrapposizioni
  e fanno tendere il risultato al 100%. Evidenze SHA-256: `523F8A5E…`
  (spacing) e `BF084072…` (jitter). La regressione `npm run intense:verify`
  vincola routing, Count, jitter/scatter e la serie numerica misurata.
- I tre rendering Paint non espongono simulazioni fluide aggiuntive: Light
  Glaze, Uniformed Glaze e Intense Blending usano esclusivamente i rispettivi
  percorsi autorevoli descritti sopra. Il tool Blend resta separato e solo dry.
- Pulizia del 30 luglio 2026: rimossi pannello, preset, campi ABI/history,
  routing, scratch dedicato, shader e verifiche della simulazione fluida
  aggiuntiva; `blend-renderer.ts` e `blend-shaders.ts` sono tornati al checkpoint
  dry `d802356`, senza modificare i tre percorsi Paint. TypeScript, quindici
  verifiche, ricerca dei residui attivi e build Vite risultano verdi. QA locale:
  un tratto con Light, Uniformed, Intense e Blend dry, incluse le transizioni di
  risorsa e il ritorno a Paint, con console priva di warning/errori.
- Ciclo di vita: Light usa R8; Uniformed e Intense usano RGBA16F. Le risorse
  sono pre-riscaldate alla selezione, lazy rispetto all'avvio, attese da
  benchmark/Undo/Redo e rilasciate in idle. Allocazione e retarget dei bind group
  passano in due transazioni WebGPU sotto scope `validation` + `out-of-memory`;
  la vecchia famiglia resta viva fino alla validazione finale e il rollback
  reinstalla il vecchio resource set prima di distruggere la candidata. Un gate
  blocca ogni pointer-down finché la transizione è in volo e una richiesta
  latest-only impedisce che `R8→RGBA→R8` pubblichi la famiglia obsoleta. Il fault
  injection OOM del retarget resta ancora da aggiungere: non descrivere il
  rollback come provato su iPhone. Durante il cambio esiste un picco logico
  old+new di circa `190,6 MiB` su layer RGBA8 o `237,4 MiB` su RGBA16F; la suite
  rev `4` lo separa dal totale stabile. Se il dispositivo non lo regge, il
  cambio viene rifiutato e il vecchio rendering resta residente.
- L'accumulatore autorevole non viene più pulito per intero a ogni gesto: dopo
  il commit si conserva la dirty rect del solo tratto precedente e il gesto
  successivo la azzera con un draw GPU scissored nello stesso render pass dei
  nuovi stamp, evitando anche una seconda frontiera attachment load/store. Un
  tap non provoca quindi più un clear di tutti i `4096²` texel RGBA16F; nuova
  texture, annullamento e cambio storage mantengono la stessa semantica zero.
- `blendIntensity` resta soltanto nel tipo/history ABI per compatibilità, ma la
  uniform GPU e la preview lo fissano sempre a `1`; anche una cronologia legacy
  con `4×` non può più riattivarlo. Il payload canonico remoto è revisionato a
  preset `4` e normalizzato a `1×`.
- La suite rev `4` Base/Grain Off/spacing `1%` è stata eseguita **per la prima
  volta completa (3/3) sulla traccia canonica reale** il 30 luglio 2026 su
  desktop: Light `37,3 MiB` dedicati / `140,5` stabili, Uniformed `153,3` /
  `256,5` (picco transizione `293,9`), Intense `153,3` / `256,5`, durata
  `20,69 s`, zero errori WebGPU. Il guard "Intense non alloca lo scratch
  Blend" confrontava con `0,001 MiB` ma l'uniform buffer del renderer
  (`0,0625 MiB`) esiste dalla costruzione: la soglia corretta è `1 MiB` (lo
  scratch parte da `52,9`). In dev `/api/human-stroke` è ora servito da un
  middleware in `vite.config.ts` che legge/scrive
  `.tmp-canonical-human-stroke.json`, altrimenti la suite resta disabilitata
  fuori da Sites. Il "Play tratto registrato" richiede un livello raster
  selezionato: sul nodo testo il pennello viene rifiutato e la run riporta `0`
  stamp. Resta da eseguire su iPhone prima di promuovere una baseline. Non
  dichiarare parità pixel completa con Procreate né vantaggi prestazionali: la
  misura dry valida soltanto la legge di deposito osservata.
- QA browser desktop del 30 luglio 2026: con nero, Flow `50%`, Opacity `100%`,
  Count `1`, spacing `5%`, Light resta semitrasparente mentre Uniformed e
  Intense raggiungono il nero con le sovrapposizioni. Catture durante il
  pointer-down dimostrano che entrambi i modi RGBA16F sono visibili prima del
  lift; nelle regioni ormai fuori dall'influenza degli stamp futuri, confronto
  live→post-lift: Intense `22.500/22.500` canali identici e Uniformed
  `4.050/4.050`, delta massimo `0`; dopo il consolidamento lifecycle, una nuova
  regione Intense conta `64.800/64.800` canali identici, ancora delta `0`.
  Rosso al `50%` sopra verde opaco in Intense
  produce `[127,128,0]`, coerente con source-over sRGB atteso `[128,128,0]` e
  non con il riferimento lineare `[188,188,0]`. Nessun warning/error WebGPU.
- La suite ha trovato un difetto reale nel passaggio Light→Uniformed: la sessione
  Uniformed veniva rinominata con l'identificatore storico `light-glaze`; la
  prima submission reinterpretava il nome pubblico come Light R8, scambiava lo
  storage e distruggeva la sessione attiva. Ora l'identità pubblica viene
  preservata fino al commit e `grain:verify` contiene una regressione statica
  vincolante. Diagnostica invariant: modo, batch e numero di sessioni attive.
- Grain M1 nativo: asset originale `graincottonfleece.PNG` RGBA `2500×2500`
  (SHA-256 `9AA1CE07…`), luma `0.299/0.587/0.114`, 12 mip NPOT generati in
  WGSL allo startup (~`31,8 MiB`). Fixed = UV layer; Moving = UV stamp (Scale
  disabilitato come in M1). Invert via segno dei coefficienti affini, nessun
  ramo WGSL. Non ridimensionare l'asset senza richiesta esplicita.
- Ciclo di vita Grain (sperimentale rev `39`, da validare):
  `GRAIN_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-grain-select-release-when-idle-unused"`. La texture non viene
  più caricata allo startup: fetch/decodifica/mip (pipeline invariata, stessa
  identità SHA) partono alla selezione di un grain mode; con mode `off` e
  motore fermo la texture viene rilasciata (−31,8 MiB) e un placeholder 1×1
  bianco tiene validi i bind group, ricostruiti a ogni scambio
  (`rebuildGrainBrushBindGroups`, più `setGrainTextureView` sul renderer
  Blend). Un tratto iniziato durante il load viene rifiutato con status
  («Grain M1 in caricamento…»): mai disegnare col placeholder. `waitForIdle`
  attende anche il load, quindi i replay benchmark restano corretti; il
  replay Undo/Redo ricarica da solo se un batch registra
  `grainTextureIdentity`. Identità e tempi di load restano riportati in
  telemetria (`grainTextureResident` nuova firma).
- Ciclo di vita Shape (sperimentale rev `39`, da validare):
  `SHAPE_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-shape-select-release-when-idle-unused"`, gemello del Grain. La
  maschera 2K (~5,3 MiB, decodifica e pre-mappe di occupazione invariate)
  viene caricata alla selezione della Shape e rilasciata con Cerchio
  selezionato e motore fermo; un placeholder r8 1×1 bianco tiene validi tutti
  i bind group (base pennello + coda spessore + grain + deposit Blend,
  ricostruiti da `rebuildShapeBrushBindGroups` e `setShapeMaskView`). Sprite
  della tip preview, identità e statistiche di occupazione (CPU) sopravvivono
  al rilascio; le mappe di occupazione GPU restano allocate (40 KiB) e
  vengono riscritte al load. Tratti Shape durante il load rifiutati con
  status; `waitForIdle` attende anche questo load (replay benchmark Fur
  coperti); il replay Undo/Redo ricarica se un batch ha `shape === "shape"`.
  Firma `shapeMaskResident` in telemetria.
- Dinamica spessore: solo `Spessore inizio` e `fine` (`0–200%`), finestre
  temporali `100 ms`, quadratic ease-out. Il tail holdback (attivo solo con
  fine `≠100%`) trattiene gli stamp degli ultimi `100 ms`; un overlay WebGPU
  predittivo li mostra con le stesse pipeline del pennello (Normal/Additive,
  anche Shape/Grain; Light/M1 Glaze esclusi per semantica). `Velocità →
  Spessore` e `Pressure → size/alpha` sono stati **rimossi** su richiesta:
  la pressione resta nei dati come campo inerte, `controls.w` azzerato.

### Trasformazioni testo vettoriale Kittl (WebGPU)

- Arch/Wave/Circle implementate il 29 luglio 2026 e congelate nel checkpoint
  `598d4b8`; il successivo comportamento live/no-flash è congelato in
  `76359f6`. Entrambi sono confluiti nel commit `30a1cb9`, pubblicato su
  Sites `94` dietro il gate di collaudo `?vectorTextTest=1`. Strategia
  `kittl-compatible-centered-arch-wave-cubic-distance-warp-circle-rigid-glyph-v2`.
  Il bundle pubblico Kittl `index.2bd1e2cd.js` è stato verificato direttamente:
  non si tratta di una ricostruzione basata soltanto su screenshot.
- Arch e Wave usano gli stessi sette punti normalizzati di Kittl (due Bézier
  cubiche), la stessa normalizzazione Curve `-100..100` e lo stesso epsilon
  a `0%`. Come `H5.transformCustom`, ogni anchor/maniglia OpenType viene
  mappata con la distanza X lungo la curva; verbi, numero di curve e winding
  restano invariati. Il layout è centrato sulla lunghezza reale della curva
  restituita da `getLineLength`, non sulla sola proiezione X: gli estremi di
  Arch restano quindi speculari e il centro del testo cade sull'apice.
  Nessuna tassellazione o bitmap viene generata allo zoom.
- Circle replica `HH`: line length `2πr`, testo centrato sulla circonferenza,
  pivot per glifo al centro della bbox di inchiostro e a
  `baseline - xHeight/2`, trasformazione affine rigida per glifo e
  Direction Inverted sull'arco inferiore. Il default `r = width/2` coincide
  con `calculateControlPoints(width,height,0)`; la UI locale aggiunge anche
  un controllo esplicito del raggio.
- Il path trasformato è la sorgente autorevole comune a fill Slug, Traccia,
  Block Shadow, Ombra singola e Ombra interna. La bbox semantica viene
  ricalcolata sulla trasformazione ma continua a escludere outline e ombre.
  Le guide Arch/Wave/Circle vivono soltanto nell'overlay Canvas2D di selezione;
  i pixel del testo restano WebGPU. Il seed del primo testo non applica più la
  precedente rotazione decorativa nascosta di `-4°`: Arch nasce orizzontale e
  simmetrico, mentre la rotazione manuale del nodo resta indipendente.
- Fix Traccia testo del 29 luglio: l'anello Clipper finiva esattamente sul
  bordo del fill Slug e le due coverage (mesh MSAA e Bézier analitica) potevano
  lasciare una fessura subpixel. Con colori diversi il bordo interno della
  traccia prosegue ora sotto il fill con una guardia LOD di `1 px`, senza
  cambiare larghezza o bbox esterne. Se riempimento e traccia hanno lo stesso
  colore lineare, il Worker compila direttamente la loro unione espansa e il
  renderer emette una sola draw: nessuna frontiera di compositing può restare
  visibile e l'opacità del nodo non viene applicata due volte. Strategie
  `webgpu-clipper64-worker-outside-offset-aa-overlap1px-same-color-fused-round-bevel-miter4-v6`
  e `clipper64-nonzero-worker-native-round-bevel-exact-miter-aa-overlap-same-color-union-earcut-v6`.
- Checkpoint live/no-flash `76359f6`, pubblicato tramite `30a1cb9`: il client non elimina più
  la mesh mostrata quando cambia la
  source revision. Ogni nodo conserva draw complete e bbox dell’ultima
  revisione pronta; se Traccia o Block Shadow sono ancora nel Worker, vecchia
  revisione, fill ed effetti restano insieme e vengono sostituiti soltanto
  quando tutti gli effetti richiesti coincidono. Posizione, scala e rotazione
  continuano invece a retargettare le draw conservate, quindi l’interazione
  resta live senza mostrare fill nudo, traccia mancante o bbox anticipata. Firma
  `disabled-vector-lod-worker-node-atomic-latest-only-v3`.
- La coda Worker è ora latest-only per slot: durante uno slider sostituisce il
  job non ancora iniziato, scarta la risposta del job attivo se non è più la
  revisione desiderata e non riproduce le forme intermedie in ritardo. La cache
  di mesh pronte conserva al massimo 48 entrate non mostrate; i path registrati
  sono LRU con tetto 128, protezione dei job/display attivi e messaggio esplicito
  `release-path` al Worker. I tetti possono essere superati solo dalle risorse
  effettivamente mostrate o in volo, mai da storico stale.
- Distort è incluso in `30a1cb9` ed è pubblicato su Sites `94` dietro il
  precedente gate di collaudo. Il
  bundle pubblico Kittl corrente `index.22e45a9c.js` è stato
  letto e il comportamento è stato verificato anche trascinando realmente i
  controlli nell’editor: l’interfaccia espone 6 vertici e 4 maniglie Bézier
  (Kittl conserva internamente 10 record di coordinate). I vertici centrali
  superiore/inferiore traslano entrambe le proprie maniglie; trascinare una
  maniglia ruota quella opposta di 180° conservandone la lunghezza. Maiusc
  blocca il delta sull’asse dominante.
- Il mapper Distort replica la classe `H1` di Kittl: quattro cubiche di bordo,
  lunghezze per i breakpoint superiore e inferiore, separatore obliquo fra i
  due breakpoint, rapporto X sul lato selezionato e interpolazione
  superiore→inferiore con il rapporto Y nella bbox di inchiostro sorgente.
  Ogni anchor e maniglia OpenType viene rimappata senza cambiare verbi,
  winding o numero di curve; il risultato resta quindi Slug/WebGPU anche allo
  zoom e alimenta la stessa Traccia, Block Shadow, Ombra singola e Ombra
  interna degli altri modi.
- Reset ricostruisce una gabbia rettangolare sulla bbox del path deformato
  corrente e resta in modalità Modifica, come Kittl. Aggiungere o togliere
  lettere non sposta la gabbia: la nuova bbox sorgente viene rimappata nello
  stesso inviluppo. QA locale verificata con `STREETWEAR`, `XX` e
  `STREETWEAR PLUS 2026`, trascinamento del vertice centrale e di entrambe le
  classi di maniglia, traccia rossa `12 px`, Block Shadow, Ombra singola,
  Ombra interna, zoom alto e reset. Coda Worker finale zero, zero errori e
  console browser pulita; è una prova funzionale desktop, non un benchmark
  prestazionale né una prova iPhone.
- Fix artefatti Slug del 29 luglio, incluso nello stesso commit pubblicato:
  i triangoli/denti periodici visibili sui bordi del fill Distort restavano con
  Traccia a 0 e Block Shadow disattivata, quindi non provenivano dalle mesh
  Clipper degli effetti. Una quadratica esattamente lineare in f64 può perdere
  la collinearità quando i suoi tre punti vengono convertiti separatamente in
  f32; l'epsilon precedente seguiva soltanto lo span corto del segmento e non
  l'ULP delle coordinate assolute. I solver orizzontale e verticale usano ora
  anche la magnitudine delle coordinate sorgente per scegliere in sicurezza
  l'interpolazione lineare, senza cambiare le curve con curvatura visibile.
  La regressione numerica riproduce `3,0518e-5` di seconda differenza contro
  `9,5367e-7` della vecchia soglia e `2,8613e-4` della nuova. Strategia
  `webgpu-slug-source-clipper-effect-mesh-msaa4-stable-lines-absolute-f32-scale-v5`.
  QA browser a Wave 100% e zoom massimo 64x: bordo diagonale pulito anche
  senza overlay, Worker effetti zero errori. `vector-text:verify`, TypeScript,
  tutte le verifiche core/mixed-scene e la build Vite di produzione sono verdi.
- QA no-flash locale: 48 cambi Arch rapidi hanno esercitato 96 hold atomici;
  sweep combinati di Traccia/Block Shadow/forme altri 72; Wave con colori
  diversi e sweep Traccia altri 111. Con un testo da 195 caratteri è stato
  catturato un frame mentre il Worker era ancora pending: il nodo precedente
  completo è rimasto visibile, senza sparizione parziale. Stress di 145 source
  revision uniche: `registeredPaths=128`, `readyJobs=48`, coda finale zero,
  Worker zero errori e console pulita; revisione evicted poi richiesta di nuovo
  senza errore. Sono prove funzionali non una baseline prestazionale iPhone.
- QA locale: quattro testi (Normal, Arch, Circle, Wave) con font ed effetti
  diversi, screenshot isolati, confronto visivo diretto con Kittl per Wave 35%,
  Circle normale e Circle invertito, controllo ad alto zoom senza curve
  seghettate. Dopo la correzione Arch è stato ricontrollato affiancato a Kittl
  al `47%`, con sweep di simmetria `-100/-47/0/47/100`, zoom rapido e console
  pulita; screenshot locale `vector-text-qa-arch-centered.png`. La Traccia
  nero-su-nero da `24 px` è stata verificata senza overlay su Normal, Arch,
  Wave e Circle, più rosso-su-nero per controllare il bordo esterno; Worker e
  console a zero errori. Screenshot `vector-text-outline-same-color-fused.png`
  e `vector-text-outline-contrast-after.png`. Stress non canonico 8 zoom-in + 8 zoom-out con quattro testi:
  render p95 `2,20 ms`, Worker effetti `0` errori e nessun nuovo
  warning/error browser sul desktop NVIDIA corrente. Non leggere questo numero
  come benchmark iPhone o come nuova baseline canonica.
- Verifiche verdi: `npm run mixed-scene:verify`,
  `npm run vector-text:verify`, TypeScript e build Vite di produzione.
- Promozione link pulito del 29 luglio 2026: l'editor testo vettoriale è ora
  inizializzato nell'app ordinaria senza query string; comprende livelli testo,
  Traccia, Ombra singola/interna, Block Shadow e Distort/Arch/Circle/Wave.
  `?innerShadowTest=1` non aveva alcun lettore nel sorgente ed era un suffisso
  inerte. Restano query-gated soltanto fixture e benchmark distruttivi
  (`mixedMemoryBenchmark`, stress memoria/compressione e relativi profili);
  non fanno parte dell'esperienza editor normale.
- Commit locale `75ee363` del 30 luglio 2026, **non pubblicato**: una
  pagina nuova contiene soltanto `Livello 1`; nessun `Testo 1` viene creato
  all'avvio. Il testo nasce esclusivamente da «Aggiungi testo» e la stessa
  azione è annullabile/ripristinabile.
- Robustezza Undo/Redo raster: le eccezioni del frame RAF vengono catturate e
  rese stato esplicito invece di lasciare l'app sospesa; `waitForIdle` pompa il
  lavoro anche se RAF non arriva, ha fallback a `50 ms`, watchdog di mancato
  progresso, attese GPU limitate e race con `device.lost`. I batch pending
  vengono rimossi solo dopo una submission riuscita; il replay cede il main
  thread ogni 8 submit e ripristina il rendering glaze selezionato. Il commit
  Light nel batch finale aspetta tutti gli stamp fuori dal batch corrente e
  viene codificato dopo quegli stamp nello stesso encoder.
- QA browser locale desktop: add/delete testo e SVG ripetuti tre volte con
  Undo/Redo; digitazione completa in una voce; colore SVG, Traccia, join,
  Block/Ombra singola/Ombra interna, visibilità, opacità, ordine e reset; uno
  slider `23→31→44→68→91` torna direttamente a `23`. Un drag posizione con 24
  pointermove torna interamente all'origine con un solo Undo; un gesto
  `360→420→360` non crea storia e conserva il Redo. Timeline mista
  raster→aggiunta testo→edit testo→raster verificata in entrambi i versi.
  Light, Uniformed e Intense hanno superato loop normali e Undo immediato dopo
  il tap (almeno `7/5/7` cicli per modalità). Il percorso dell'errore originale
  è stato stressato con 16 sequenze Light tratto→cambio Flow/Count oppure nuovo
  tratto, seguite da 3 Undo/Redo e 6 passaggi Light/Uniformed/Intense: nessun
  blocco e console browser `0` warning/error. Tutti i verifier npm, TypeScript
  e build Vite production sono verdi. È QA desktop funzionale, non una prova
  iPhone né una baseline.
- Commit locale `75ee363` del 30 luglio 2026, **non pubblicato**:
  cronologia raster GPU-only per il payload, con prewarm di una pagina da
  `2 MiB`, crescita paginata e rilascio dei rami Redo invalidati fuori dal
  percorso della pennellata. QA browser su Light, Uniformed, Intense e Blend
  dry, poi `3` Undo e `3` Redo consecutivi: tutti completati e console a zero
  warning/error. L'invalidazione di un ramo Redo ha mostrato il payload logico
  scendere da `0,4` a `0,3 MiB` alla compattazione; un replay raster stabilizzato
  prima/dopo Undo+Redo ha prodotto lo stesso PNG SHA-256
  `abb2c732764efa90d67dadb22c3a2b7b298be958b1971abf69de5432fc3a6147`.
- Modifica locale del 31 luglio 2026, **non committata e non pubblicata**: risolto
  il blocco comune a Undo/Redo cross-layer e spostamento testo sopra/sotto raster
  con effetti. Il `clear` delle cache vettoriali dentro una transazione non
  schedula più un frame e non ricrea bind group contro view già evacuate; il
  render viene invalidato una sola volta dopo pubblicazione e un rollback
  riuscito. `waitForIdle` ricontrolla il lavoro arrivato durante il fence GPU e,
  se trova lavoro render mentre la presentazione è congelata, fallisce subito
  invece di attendere il watchdog da `10 s`.
- Le mutazioni e la cronologia vettoriale riusano ora le superfici dei
  `raster-run` con chiave, raster attivo e lato invariati. I run obsoleti vengono
  distrutti prima di allocare i sostituti; in caso di errore i run riusabili
  restano raggiungibili per il rebuild di rollback e non vengono distrutti due
  volte. Attraversare un raster ricostruisce soltanto i gruppi la cui appartenenza
  cambia; un cambio del raster attivo rifiuta ogni riuso. Il banco WebGPU di
  Traccia/Smusso/Ombre resta singolo e retargetable: la memoria persistente per
  layer è cold storage/contenuto e cache raster, non una copia del banco effetti.
- Verifica solo codice, come richiesto: tutti i `15` verifier npm, TypeScript e
  build Vite production verdi. Aggiunte regressioni su riuso parziale, rifiuto
  del riuso al cambio raster attivo, clear transazionale, rollback delle risorse
  e fail-fast freeze/pending. Nessuna QA browser, screenshot o misura iPhone;
  quindi non dichiarare ancora una conferma interattiva o prestazionale.
  Anche il benchmark sintetico da `2000` stamp è rimasto annullabile. Tutti i
  `15` verifier npm, TypeScript e build Vite production sono verdi. È QA
  desktop funzionale: non dimostra guadagni prestazionali né copre iPhone.
- Misura locale controllata della stessa modifica, poi rimossa dal prodotto:
  `2000` stamp Base/Count 1/Circle, `64.000 B` copiati, submit finale con commit
  glaze, `12` coppie ABBA per modalità ripetute due volte. La cattura live GPU
  differisce dal controllo senza storia di `0…+0,1 ms` al p50 e resta entro il
  rumore del timer al p95: nessuna regressione CPU stabile al lift su questo
  desktop. Il replay buffer→buffer evita il repack/upload CPU: vantaggio p50
  ripetuto di `0,2 ms` Light, `0,1 ms` Uniformed e `0…0,1 ms` Intense.
  `timestamp-query` non è disponibile sulla GPU corrente; i tempi basati su
  `onSubmittedWorkDone()` contengono l'intera coda e jitter callback e non hanno
  mostrato un delta GPU stabile. Non estrapolare questi numeri a iPhone.
- Ottimizzazioni sicure misurate senza cambiare pixel o parametri: contabilità
  memoria O(1), rilascio multiplo con un solo merge per pagina, lookup O(B) del
  batch glaze finale invece della scansione O(B²), controlli action-id O(1) e
  ricerca pending senza array temporanei. Sulla suite canonica desktop, nelle
  sole run con firma esatta `12107` stamp e spacing `1%`, il p95 CPU osservato
  passa circa `1,4→1,1–1,2 ms` Light, `1,4→1,2 ms` Uniformed e
  `1,3→1,1–1,2 ms` Intense. È evidenza locale, non una nuova baseline né una
  prova di vantaggio GPU isolato.

### Traccia raster M1 (WebGPU)

- Stile di default equivalente al progetto M1: disattivato, `14 px`, esterno,
  colore `#FFA448`; posizioni supportate `inside` / `center` / `outside`, width
  `0–512 px`. Nessuna modifica ai parametri o ai pixel del pennello sorgente.
- Contratto visivo portato senza scorciatoie: seed duale sulla soglia alpha
  `0,5`, JFA per estensione con passo `1` extra, tie deterministico `y→x`,
  distanza Q10.6 half-up (cap `1023 px`), correzione subpixel dall'alpha,
  coverage quantizzata R8 e compositing premoltiplicato M1.
- Renderer sperimentale corrente
  `raster-stroke-webgpu-v5-direct-lod0-coarse-styled-mips-packed-r8-coverage-native-unorm-round-even`:
  seed, JFA, resolve, compositing e piramide mip restano sulla GPU. Non esiste
  un campo distanza residente: la distanza Q10.6 vive nei registri del resolve
  e viene convertita subito in coverage R8, packed quattro pixel per `u32` in
  un buffer da `16 MiB`, residente soltanto mentre la Traccia è abilitata.
- Il risultato styled full-resolution non è più residente: a LOD `0` il
  fragment shader ricostruisce e quantizza direttamente i quattro texel da
  layer + coverage; restano materializzati solo i mip logici `1–12`, circa
  `21,3 MiB` RGBA8 o `42,7 MiB` RGBA16F. Il mip `1` viene sempre mantenuto dal
  compose GPU e i livelli superiori derivano da quello, così uno zoom-out non
  dipende da un ricalcolo tardivo. Il renderer golden temporaneo conserva un
  mip `0` separato solo per readback e non viene allocato nell'uso normale.
- Con Traccia attiva, lo scratch dual-seed resta adattivo alla width: `1024²`
  (`16 MiB`) fino a
  `128 px`, `2048²` (`64 MiB`) da `129` a `512 px`; mask alpha e controllo
  costano ~`2,52 MiB`. Totale aggiuntivo v5 a width `≤128`: ~`55,9 MiB`
  RGBA8 o ~`77,2 MiB` RGBA16F; oltre `128`: ~`103,9 MiB` o ~`125,2 MiB`.
  Tutto resta lazy e viene liberato alla disabilitazione.
- Ciclo di vita geometria Traccia rev `50`:
  `allocate-on-stroke-enable-release-when-idle-disabled`. Coverage packed R8,
  mask soglia, flag gate e argomenti indirect (`18,023441 MiB` totali) sono
  allocati in una transazione WebGPU quando la Traccia passa ON e distrutti
  soltanto dopo GPU idle quando passa OFF. Quattro placeholder validi per
  complessivi `24 byte` mantengono i bind group del compositore Ombre/Smusso;
  styled mip `1+` e parametri comuni restano residenti perché servono agli altri
  effetti.
- La coverage è specifica di width/position: quei due cambi stile ricostruiscono
  l'area del contenuto (inclusa l'estensione del vecchio stile); il solo colore
  ricompone senza JFA. Durante il disegno il gate GPU controlla sia i cambi di
  soglia alpha `0,5` sia la coverage già presente nella dirty region con halo
  di un pixel. Se si disegna dentro una zona senza bordo vicino, gli indirect di
  seed/JFA/resolve/compose halo vengono azzerati; resta solo scan + compose della
  dirty region. Se cambia la soglia o si tocca il bordo, ricostruisce l'area
  espansa. Nessun readback CPU.
- L'integrazione v4 con Paint Normal/Additive, Light Glaze live + commit, M1
  Glaze, tail predittivo dello spessore, Blend dry e Undo/Redo è stata verificata
  su NVIDIA Ampere. La v5 riusa gli stessi ingressi ma resta da approvare con il
  golden mip e la prova percettiva dell'utente.
- Monitor memoria GPU rev `35`: pill apribile/chiudibile in basso a destra,
  totale aggiornato ogni `500 ms`, dettaglio per risorsa e badge temporaneo per
  ogni variazione di almeno `0,05 MiB`. Conta le dimensioni logiche delle risorse
  WebGPU create dal motore; non misura residency fisica e non include swapchain,
  pipeline/driver, RAM o memoria del browser. Il report include ora
  anche la strategia di storage styled v5.
- Riga «Cronologia raster · GPU»: mostra a destra i byte realmente riservati
  dai buffer WebGPU paginati, mentre l'etichetta riporta numero di pagine e
  payload logico usato. Una pagina calda da `2 MiB` è preallocata anche con
  storia vuota; una pagina standard già viva conta già come pagina calda, quindi
  il trim non ne aggiunge una seconda vuota. Le pagine sono incluse nel totale GPU
  e nel badge di variazione.
  «Layer compressi» resta l'unica riga RAM CPU esclusa dal totale. Il pannello
  contabilizza le allocazioni richieste al browser, non la residency fisica
  nascosta dal driver; il tetto della storia per uso prolungato resta aperto.
- Non esiste ancora una run canonica di prestazioni né la prova iPhone: non
  dichiarare guadagni di velocità né considerare conclusa la Traccia. Le run rev
  `35` riportano stile, build, strategie coverage/styled/distanza/gate, extent
  scratch e memoria corretta; non vanno aggregate con rev `34` o precedenti.
- Fix zoom-out del 23 luglio 2026, da segnalazione utente senza riproduzione
  visiva: nella v4 una mutazione del mip styled `0` lasciava erroneamente validi
  mip più piccoli non aggiornati nel frame. La v5 mantiene sempre il mip logico
  `1`, retrocede la validità a quel livello dopo ogni mutazione e ricostruisce i
  livelli mancanti prima della cache di presentazione. Verifiche statiche
  passate; prova percettiva lasciata all'utente come richiesto.
- Scratch adattivo verificato localmente il 24 luglio 2026 su NVIDIA Ampere:
  transizioni `14→512→14 px` riportano `16→64→16 MiB`; i totali allora misurati
  (`264,9→312,9→264,9 MiB`) precedono coverage R8 e v5. Nessun
  tratto è stato disegnato automaticamente; pacing e risultato percettivo sono
  lasciati alla prova utente prima di promuovere il tier compatto. Verifiche:
  `npm run stroke:verify`, `grain:verify`, `blend:verify`, `thickness:verify`,
  TypeScript e build Vite.
- Harness golden pixel Traccia v1 disponibile anche nella build pubblicata di
  prova: usa un renderer
  isolato `256×192`, sette casi canonici e readback RGBA8 senza padding, quindi
  produce SHA-256 per caso e combinato. I sette hash e i 63 hash mip della
  baseline sono vincolanti. Una diagnostica separata rev `3`, esclusa
  dall'identità canonica,
  aggiunge cinque prove: skip reale del gate in un interno profondo (flag `0`),
  calo alpha sotto soglia vicino alla coverage esterna (flag `2`) confrontato
  con rebuild forzato, Light Glaze source-over a opacità `0,43`, M1
  max-coverage letto da una vera texture `r8unorm` a `0,37` e tail spessore.
  Gli ultimi tre confrontano il mip `1` diretto v5 con il downsample GPU del
  mip `0` materializzato. Non tocca il layer dell'utente;
  `COPY_SRC` e la texture mip `0` esistono solo nel renderer temporaneo.
- Baseline golden catturata dall'utente il 24 luglio 2026:
  fixture `bcbaa02c…`, combinato `8d5a75a6…`, sette hash conservati in
  `goldens/raster-stroke-rgba8-v1.json`. La ripetizione center-31 prima/dopo
  width 129 è identica (`5cf27e7b…`), quindi il run è internamente stabile.
  Estensione mip v1 sulla stessa GPU: 63 hash (`7` casi × `9` livelli), combinato
  `f7f53472…`, conservati in `goldens/raster-stroke-rgba8-mips-v1.json`; questa
  baseline è vincolante per ogni modifica alla texture styled o allo zoom.
- Coverage R8 v4 **promossa** il 24 luglio 2026: il golden eseguito dall'utente
  restituisce tutti i sette hash v3 identici, combinato `8d5a75a6…`,
  `baselineMatches: true` e nessun mismatch. Risparmio logico deterministico
  `16 MiB`: sul desktop corrente width 14 `264,9→248,9 MiB`; width 512
  `312,9→296,9 MiB`.
- L'utente ha inoltre approvato il test percettivo richiesto sulla v4: disegno
  dentro una forma chiusa, cambi stile `14→129→31`, zoom e Undo/Redo. Verifiche
  automatiche: `npm run stroke:verify`, `grain:verify`, `blend:verify`,
  `thickness:verify`, TypeScript e build Vite. Nessuna dichiarazione
  prestazionale: pacing e iPhone richiedono ancora le rispettive run canoniche.
- Riduzione styled v5 implementata il 24 luglio 2026 come singolo esperimento:
  rimuove esattamente `64 MiB` RGBA8 dal runtime. Sul desktop corrente i totali
  attesi sono width 14 `248,9→184,9 MiB` e width 512 `296,9→232,9 MiB`.
- Hardening successivo alla revisione esterna: i parametri display dei modi
  permanent/Light Glaze/tail vivono in tre uniform buffer distinti e vengono
  riscritti esplicitamente prima di ogni pass display. Due modi nello stesso
  submit non possono più osservare l'ultimo `sourceMode` scritto; costo netto
  rispetto al candidato precedente: `160 byte`.
- Telemetria rev `36`: per i rebuild completi della cache di presentazione a
  LOD `0` separa numero di pass e millisecondi di sola codifica CPU con Traccia
  attiva/disattiva. Non è tempo GPU e su Safari la risoluzione ~`1 ms` impone
  di confrontare aggregati, non singoli frame.
- Esperimento isolato M1 R8 del 24 luglio 2026: il mip autorevole della
  pennellata passa da RGBA a `r8unorm`; una seconda texture conserva solo i mip
  finali RGBA logici `1–12`, necessari per mantenere identici i pixel durante
  lo zoom. Per i layer RGBA16F lo shader riapplica l'arrotondamento half-float
  che prima avveniva scrivendo l'accumulatore RGBA, preservando gli stessi
  input di compositing. Risparmio deterministico rispetto allo storage Light/RGBA:
  `48,0 MiB` in RGBA8 e `112,0 MiB` in RGBA16F. Light Glaze tradizionale resta
  invariato. La telemetria riporta il modo attivo
  (`r8-coverage`/`rgba16float-stroke`) e la relativa memoria.
- Telemetria rev `37`: firma il nuovo modo di storage M1 e la sua contabilità.
  La diagnostica Golden rev `2` usa una vera sorgente R8 per il caso M1.
- Golden GPU v5 pre-fix eseguito dall'utente il 24 luglio 2026: tutti i sette
  mip `0` e il combinato canonico `8d5a75a6…` sono identici; entrambi i test del
  gate passano (`0` e `2`). Il combinato mip è invece `9208e2a3…` contro
  `f7f53472…`; `outside-129` è interamente identico, mentre i casi con valori
  frazionari divergono nei primi mip. Falliscono anche i tre confronti
  Light/M1/tail tra mip `1` diretto e mip `0` materializzato.
- Candidato root cause: `pack4x8unorm` usa half-up e non riproduce ai tie la
  conversione nativa dell'attachment RGBA8. I tre helper `quantizeLayer` usano
  ora `round` ties-to-even; la quantizzazione coverage M1 resta volutamente
  `pack4x8unorm` e non è stata cambiata. Nessun mip `0` residente reintrodotto,
  nessun aumento di memoria.
- Telemetria rev `38`; diagnostica Golden rev `3`, che in caso di nuova
  divergenza riporta byte differenti, delta massimo e primo pixel/canale.
  Verifiche locali: `stroke:verify`, `grain:verify`, `blend:verify`,
  `thickness:verify`, TypeScript e build Vite tutte passate. Non promuovere né
  committare gli esperimenti finché l'utente non restituisce il golden
  (`8d5a75a6…` + `f7f53472…`, zero mismatch, `diagnosticsMatch: true`) e
  approva Light Glaze, M1, disegno/zoom/Undo-Redo sulla v5.
- Il 24 luglio 2026 la prima pubblicazione v5 non mostrava il comando Golden
  perché la UI era ancora racchiusa in `import.meta.env.DEV`: il renderer e la
  diagnostica erano presenti nel bundle, ma la sezione restava `hidden`.
  Rimosso il gate UI per consentire la cattura Golden sull'iPhone dalla build
  pubblicata; il test resta isolato e parte solo su pressione esplicita.

### Smusso/Rilievo raster M1 (WebGPU, sperimentale)

- Port Heightfield V2 implementato il 24 luglio 2026. Build corrente
  `raster-bevel-webgpu-v4-shared-effects-scratch-retargetable-layer-heightfield-v2-r32f-segment-jfa-workgroup-gaussian-gpu-gate`;
  non è un emboss derivato dall'alpha nel solo fragment shader.
- Il core tipizzato conserva modalità `inner` / `outer` / `emboss` / `pillow`,
  tecniche `smooth` / `chiselHard` / `chiselSoft`, direzione, size, soften,
  range, contour di altezza, gloss, AA, fill, profondità, luce, colori e
  opacità, con limiti, LUT spline e calibrazioni dell'originale
  `paint-webgpu-m1` (`0,5`, `0,15`, `1`, `0,31`).
- Morbida: alpha R8 → Gaussian separabile orizzontale/verticale con cache di
  workgroup → profilo altezza → Gaussian finale. Scalpello: marching squares
  subpixel sulla soglia `0,5` → JFA sui segmenti con passo `1` extra → signed
  distance R32F non quantizzata → profilo altezza → Gaussian finale. Tutti i
  pass del campo sono compute e non fanno readback CPU.
- L'altezza autorevole è una texture persistente `r32float` `4098²`: documento
  `4096²` più apron esterno di un pixel per Scharr `3×3`. Costa
  `64,063 MiB`; LUT, maschera alpha a due classi, controllo e indirect portano
  il persistente dedicato a `69,641 MiB`. Il workspace ROI logico default
  richiede `1,265869 MiB`, ma da rev `42` vive nel pool scratch condiviso e non
  si somma fisicamente allo scratch Traccia quando questo è più grande.
- L'arena ROI arriva al solo alone reale e al massimo di sicurezza di circa
  `1408²`. Comune e segmenti sono range distinti e allineati dello stesso
  `GPUBuffer`, ciascuno ancora vincolato da `maxStorageBufferBindingSize`.
  Il layout può crescere prima del tratto e rimpicciolisce solo in idle con
  isteresi; non esiste più uno scratch Smusso grow-only residente separato.
- Il gate alpha è interamente GPU: maschera persistente soglia/frazionario,
  scan della mutation rect e dispatch indirect. Un aggiornamento RGB-only in
  una zona completamente opaca o vuota azzera i dispatch del campo; alpha
  frazionario resta conservativo. Encoder e submit restano quelli unici
  dell'aggiornamento del motore.
- Ordine vincolante corrente nel compositore comune:
  `sorgente → Ombra interna → Smusso/Rilievo → Traccia → Ombra esterna dietro il nodo → dithering → layer opacity`.
  La Traccia continua a ricavare la distanza dall'alpha sorgente; il
  compositing outside usa invece l'alpha già modificata dagli effetti interni,
  come nell'originale. LOD `0`
  è ricostruito direttamente; sono residenti solo i mip styled logici `1–12`.
- Sono collegati gli stessi ingressi `permanent`, `light-glaze` / M1 R8 e
  `thickness-tail`; verificati in runtime su WebGPU insieme a Normal, Light
  Glaze, M1 Glaze, tail, Undo e Redo. I cambi geometry (mode, technique, size,
  soften, contour/range) invalidano l'heightfield; depth, luce, colori,
  opacità, gloss, AA e fill ricompongono soltanto i pixel. Una prova runtime ha
  confermato `depth` con delta build `0` e `size` con delta build `1`.
- Se Smusso è l'unico stile attivo, continua a forzare il compositore
  `RasterStrokeRenderer`: styled mip condivisi e coverage/mask restano
  residenti. Dal candidato del 27 luglio lo scratch Traccia è però il placeholder
  `8²`, mentre il pool fisico segue il workspace Smusso. Sul runtime storico
  rev `42`, prima di questa riduzione, tutti gli stili off misurano `92,7 MiB`;
  Traccia width `14` + Smusso default misurano `218,2 MiB` e width `512` +
  Smusso `266,2 MiB`. Disabilitare l'ultimo stile riporta il pool a `0 byte`.
- Da rev `42` Traccia e Smusso condividono un solo `GPUBuffer` scratch fisico.
  I rispettivi layout partono da offset zero perché i contenuti sono
  temporalmente disgiunti; dentro ciascun layout i range restano distinti e
  allineati. La capacità è `max(Traccia, Smusso)`, mai la somma. Il default
  misurato è `16 MiB` invece di `17,265869 MiB`; il tier Traccia `2048²` è
  `64 MiB` invece di `65,265869 MiB`.
- PR 3 bbox, Step 2 congelato nel commit `0f26957`: flag default-OFF; ON usa
  l'inviluppo tile-aligned dei job più apron fisico, origine documento→storage
  in uniform e rebuild dell'intero nuovo bbox alla riallocazione. Fuori dal
  dominio `bevelHeightAt()` usa una costante CPU: `0` per inner/outer/emboss e,
  per pillow, `1` oppure la stessa LUT contour a `min(1/range,1)`. Gli apron ai
  bordi documento restano leggibili, mentre un campo vuoto usa sempre la
  costante. Nessuna copia, passata o barriera è stata aggiunta; OFF conserva
  texture `4098²` e uniform da `80 byte`.
- PR 3 bbox, Step 3 candidato: una ROI dentro capacità resta incrementale; una
  crescita sostituisce la texture a inizio uso del campo e ricostruisce tutto
  il nuovo bbox. La riduzione fisica avviene solo dopo `1500 ms` idle e almeno
  `8 MiB` recuperabili; i bounds validi escludono subito i texel stale. Lo
  shrink del campo precede quello del pool, evitando shrink/regrow del workspace.
  `retargetEffectsWorkingSet` accetta content bounds espliciti, ma lascia
  coverage/mask/styled full-document per isolare la variabile. Mutation test
  CPU verdi: zero esterno forzato fallisce pillow ma non inner/outer; una
  crescita marcata come sola corona fallisce. Verifiche: `bevel:verify`,
  `effects-scratch:verify`, `stroke:verify` e TypeScript. Golden GPU, benchmark,
  HUD/telemetria rev 43 e prova browser restano aperti.
- Verifiche locali verdi: `bevel:verify`, `stroke:verify`, `grain:verify`,
  `blend:verify`, `thickness:verify`, TypeScript; inizializzazione WGSL e matrice
  delle tre tecniche/quattro modalità su WebGPU NVIDIA. Il warning Chromium
  secondo cui Windows ignora `powerPreference` è estraneo al renderer.
- Non esiste ancora un golden GPU Smusso WebGL2→WebGPU né una run iPhone:
  **non dichiarare il port pixel-identico o più veloce**. Il golden deve coprire
  almeno tutte le modalità/tecniche, edge frazionari sulle seam `256`, bordi e
  corner documento, mip `0–12`, AA, source mode e combinazione con le tre
  posizioni della Traccia. Lo Scalpello sulle seam è il rischio prioritario.

### Ombra esterna / Ombra interna raster (WebGPU, sperimentali)

- Implementate il 26 luglio 2026 come due effetti realmente distinti e
  non distruttivi. Core
  `raster-shadow-core-webgpu-v1-morphology-then-gaussian`, renderer
  `raster-shadow-webgpu-v1-independent-packed-r8-morphology-gaussian` e
  style stack
  `style-stack-webgpu-v14-lazy-stroke-geometry-independent-outer-inner-shadows-three-surface-layer-composite-transient-bake-bbox-bevel-field-shared-effects-scratch-retargetable-layer-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-native-unorm-round-even`.
  Ogni record livello conserva separatamente entrambi gli stili; cambiare o
  disattivare un'ombra non modifica i pixel autorevoli del layer.
- Parametri Ombra esterna: attivazione, `Normal` oppure `Multiply` nero,
  colore, opacità, angolo, distanza, Estensione, Dimensione, quattro contour,
  AA del contour, Disturbo e `Layer Knocks Out`. `Multiply` colorato viene
  rifiutato esplicitamente perché non è rappresentabile esattamente da un
  piano premoltiplicato indipendente dal backdrop; per il colore usare
  `Normal`. Parametri Ombra interna: attivazione, `Normal`/`Multiply`, colore,
  opacità, angolo, distanza, Riduci, Dimensione, contour, AA e Disturbo.
  `useGlobalLight` resta nel modello tipizzato ma non è ancora collegato a un
  controllo luce globale condiviso.
- Pipeline interamente GPU e senza readback CPU: alpha della sorgente
  (`permanent`, Light/M1 Glaze live o `thickness-tail`) → dilatazione massima
  per Estensione esterna / erosione minima per Riduci interna → Gaussian
  separabile orizzontale/verticale con cache workgroup → resolve packed R8.
  Tile `256`, Size massimo `250 px`; il Disturbo e i contour vengono applicati
  nel compositore comune.
- Ogni ombra abilitata possiede un matte packed R8 persistente full-document da
  esattamente `16 MiB` e `0,500061 MiB` di uniform/parametri. I due matte non
  sono condivisi. I due ping/pong f32 ROI vivono invece nel pool scratch comune
  con Traccia e Smusso: la capacità fisica resta il massimo dei layout attivi,
  non la loro somma. Le risorse sono lazy e il toggle OFF distrugge matte e
  controllo; il prewarm riusa lease e bind group finché l'extent non cambia.
- Baseline runtime locale pre-riduzione su NVIDIA Ampere: tutti gli effetti OFF
  `92,7 MiB`; sola Ombra esterna `165,0 MiB`; entrambe circa `181,6 MiB`.
  Il salto della prima ombra include il compositore `RasterStrokeRenderer`, non
  va attribuito al solo matte. Verificati tratto reale, contour Anello,
  Estensione, Riduci,
  Size/Distanza/Opacità, profilo Gaussiano con Disturbo `100%` senza riaccendere
  i pixel a coverage zero, compilazione WGSL dei due renderer, isolamento dello
  stato fra due livelli e rilascio completo senza warning/errori console.
- Esperimento isolato memoria del 27 luglio 2026: quando la Traccia è OFF ma il
  suo renderer serve soltanto da compositore per Ombre/Smusso, il requisito
  scratch Traccia passa dal tier `1024²` (`16 MiB`) al minimo di bind group
  `8²` (`1 KiB`). Con sola Ombra esterna default il pool fisico scende
  `16,0→0,6 MiB` e il totale conteggiato `165,0→149,6 MiB` (`−15,4 MiB`);
  con entrambe le ombre il totale corrente è `166,1 MiB`. Attivare la Traccia
  rialloca correttamente `16,0 MiB`; disattivarla di nuovo, dopo l'isteresi idle
  di `1500 ms`, riporta il pool a `0,6 MiB`. Il matte e le altre risorse
  persistenti non sono cambiati. Strategia firmata:
  `compositor-only-8-otherwise-width-tiered-1024-through-128-or-2048`.
- Secondo esperimento isolato memoria del 27 luglio 2026: coverage R8 Traccia,
  mask soglia, flag gate e indirect sono ora lazy insieme al toggle Traccia
  (`18,023441 MiB` liberati), mentre il compositore resta sui placeholder.
  Con sola Ombra esterna il totale scende `149,6→131,6 MiB`; con entrambe
  `166,1→148,1 MiB`; tutti gli effetti OFF restano `92,7 MiB`. Nel runtime,
  Traccia ON riporta le righe a coverage `16,0 MiB`, mask/controllo `2,5 MiB`
  e pool `16,0 MiB`; OFF torna rispettivamente a `0`, `0,5` e `0,6 MiB`.
  Due cicli ON/OFF (`131,6↔165,1` con esterna; `148,1↔181,6` con entrambe)
  sono passati senza warning/errori WebGPU. Allocazione sotto transazione GPU,
  rilascio solo dopo idle e bind group ricostruiti a ogni scambio. Strategia:
  `allocate-on-stroke-enable-release-when-idle-disabled`.
- Fix lifecycle display del 27 luglio 2026: la prima implementazione ricostruiva
  i bind group compute interni quando coverage reale e placeholder si
  scambiavano, ma non i tre bind group display LOD 0 posseduti dal motore. Con
  Traccia e Ombra esterna attive, Traccia OFF lasciava quindi il display legato
  al coverage appena distrutto e il canvas diventava nero fino alla ricreazione
  del compositore. `setRasterStrokeGeometryEnabled` centralizza ora tutti gli
  swap (toggle, rollback e cambio livello), invalida la coverage e ricostruisce
  subito i bind group display esterni. Verifica runtime NVIDIA Ampere:
  Traccia/Ombra `ON/ON → OFF/ON → ON/ON`, immagine e ombra sempre visibili,
  memoria `165,1→131,6→165,1 MiB`, zero warning/errori. Dieci suite `*:verify`,
  TypeScript, build Vite e `git diff --check` verdi; controllo statico nuovo
  vieta call site che bypassino l'helper.
- Prova percettiva dell'utente approvata il 27 luglio 2026 sulla build locale:
  Ombra esterna e Ombra interna, controlli e risultato visivo sono stati
  giudicati «perfetti». L'approvazione promuove il gate percettivo del candidato
  corrente; non sostituisce un oracle Photoshop→WebGPU né la futura misura
  iPhone.
- Golden di regressione Ombre v1 aggiunto il 27 luglio 2026: renderer isolato
  RGBA8 `256×192`, fixture `bcbaa02c…`, sei casi (esterna morbida, esterna
  dura/contour/Disturbo, interna morbida, interna dura/contour/Disturbo e
  combinata ripetuta) e mip `0–8`, cioè `54` hash. Baseline vincolante in
  `goldens/raster-shadow-rgba8-v1.json`: combinato mip `0`
  `2b812a001c7951ea…`, combinato catena mip `f5bcd1e4caee360a…`.
  Prima e dopo entrambe le riduzioni memoria: `baselineMatches: true`, ripetizione
  combinata identica e zero warning/errori WebGPU. Il comando UI è separato da
  quello della Traccia e non tocca il disegno dell'utente.
- Con entrambe le ombre OFF il fast path conserva il vecchio shader: Golden
  canonico mip `0` ancora `8d5a75a6…`; il combinato mip resta
  `9208e2a3…` con gli stessi `25` mismatch e i tre diagnostici delta massimo
  `1` già aperti; bake mip `0`, gate e i tre retarget restano verdi, quindi il
  lifecycle non ha nascosto o rigenerato la baseline. Telemetria rev `50` firma
  anche strategia e residenza della geometria Traccia, oltre a build, stili,
  source mode, conteggi pass/build, extent scratch e righe memoria dedicate.
- Verifiche finali locali: `shadow:verify`, `effects-scratch:verify`,
  `history:verify`, `layers:verify`, `stroke:verify`, `bevel:verify`,
  `grain:verify`, `blend:verify`, `thickness:verify`, TypeScript e build Vite.
  Il Golden v1 blocca regressioni del candidato WebGPU corrente, ma non è ancora
  un oracle Photoshop→WebGPU e non esiste una run iPhone: **non dichiarare le
  ombre pixel-identiche a Photoshop o più veloci**. L'estensione futura dovrà
  coprire Size `0/1/250`, seam `256`, bordi/corner, i tre source mode e l'ordine
  completo con Traccia/Smusso; la prova percettiva utente del candidato è già
  approvata.

### Banco effetti condiviso (Fasi 1–2, retargetable + pool scratch)

- Strategia corrente `single-retargetable-active-layer-source`: un solo
  `EffectsWorkbench` possiede Traccia, Smusso, Ombra esterna e Ombra interna
  per la sorgente attiva. Il numero di working set resta quindi O(1) rispetto ai layer futuri; questa fase
  non introduce ancora layer multipli.
- Build correnti: style stack
  `style-stack-webgpu-v14-lazy-stroke-geometry-independent-outer-inner-shadows-three-surface-layer-composite-transient-bake-bbox-bevel-field-shared-effects-scratch-retargetable-layer-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-native-unorm-round-even`,
  Smusso
  `raster-bevel-webgpu-v4-shared-effects-scratch-retargetable-layer-heightfield-v2-r32f-segment-jfa-workgroup-gaussian-gpu-gate`
  e Ombre
  `raster-shadow-webgpu-v1-independent-packed-r8-morphology-gaussian`.
- Il retarget a formato identico ricrea tutti i bind group che referenziano la
  source view nei quattro renderer e i display bind group lato engine, poi
  invalida coverage/mask/styled mip/heightfield/matte/cache di presentazione ed
  esegue in un solo encoder clear + rebuild del contenuto pertinente. I bind
  group dei downsample mip restano validi perché puntano soltanto alle texture
  interne riusate.
  Formati incompatibili restano sul fallback distruttivo `setLayerFormat()`.
- Diagnostica Golden rev `4`: il caso
  `stroke-bevel-same-view-retarget` passa con mip `0` e `1` identici, zero byte
  diversi e delta massimo `0`. Il combinato mip `0` resta `8d5a75a6…`; il
  mismatch v5 preesistente dei mip derivati resta `9208e2a3…` contro
  `f7f53472…` e non è stato nascosto né rigenerato.
- Benchmark dev del 24 luglio 2026 su NVIDIA Ampere, RGBA8 `4096²`, Traccia
  outside `14 px` + Smusso inner/smooth `32 px`, 5 campioni dopo warm-up:
  retarget `131,9 ms` totali mediani (`3,2 ms` CPU setup/encode + `128,8 ms`
  queue/callback) contro destroy+recreate `152,2 ms` (`25,1 + 126,8 ms`).
  `timestamp-query` non disponibile: sono misure wall-clock
  `onSubmittedWorkDone`, non tempo GPU isolato. Working set logico della prova
  `126,764 MiB`. Report completo in `docs/effects-workbench-pr1.md`.
- Fase 2, rev telemetria `42`: strategia pool
  `single-buffer-aliased-effect-layouts-grow-immediate-shrink-idle-hysteresis`;
  un solo buffer fisico, layout effect-locali aliasati, crescita prima del
  tratto e shrink idle dopo `1500 ms`. Nessuna riallocazione durante una
  pennellata, nessuna passata/copia/barriera nuova.
- Benchmark isolato finale Fase 2, stesso device/preset: retarget `128,3 ms`
  mediani (`2,7 ms` CPU + `125,6 ms` queue/callback), cioè `−2,73%` rispetto a
  `131,9 ms`; seconda ripetizione `125,4 ms`. Working set della prova
  `125,497726 MiB`.
- Golden GPU Fase 2: combinato mip `0` invariato `8d5a75a6…`; restano soltanto i
  tre diagnostici source-mode e i 25 mismatch mip preesistenti. Mutation
  offset `ping-b→0` osservata fallire sia staticamente (`0 != 256`) sia su GPU
  (`70d14e7a…`). Tabella completa in `docs/effects-workbench-pr2.md`.

### Campo Smusso a misura bbox (PR 3, dietro flag)

Flag runtime `?bevelField=bbox`, **default OFF**. L'heightfield R32F passa da
documento+apron (`64,06 MiB` fissi) a inviluppo tile-aligned dei job + apron.

- Gate di fattibilità documentato in `docs/effects-bbox-pr3.md`: l'invariante
  «fuori dai bounds il campo vale 0» è **falsa** per `pillow`
  (`x = abs(2*source-1)` con `source→0` vale `1`). Fuori dal campo si usa una
  costante dipendente da modo/tecnica/contour: `0` per inner, outer ed emboss;
  per pillow `1`, oppure la LUT contour a `min(1/range,1)`.
- Riallocazione ⇒ rebuild dell'intero nuovo bbox: una texture WebGPU riallocata
  non conserva i pixel, quindi «ricostruire solo la corona» non esiste.
- Crescita ammessa a inizio frame anche durante il tratto, mai a metà encoder.
- Golden invariato con flag OFF **e** ON, 24/24 combinazioni modo × tecnica.
- Benchmark contenuto piccolo: retarget `133,90 → 68,80 ms` (**−48,6%**).
- Pittura interattiva misurata (7 crescite dei bounds, anche a metà tratto):
  regime **identico** al flag OFF (mediana `6,9 ms`, p95 `7,2` vs `7,3`, p99
  `8,9` vs `9,0`); tutta la differenza è nei frame di crescita, frame peggiore
  `27,6` vs `13,4 ms`, **zero** frame oltre `33 ms`. Campo da `4,0` a `35,0 MiB`
  contro `64,1` fissi. A effetti attivi e tela vuota: `154,1` contro `218,1 MiB`.
- Non verificato: una sola GPU desktop. Su mobile il frame di crescita va
  rimisurato prima di considerare il default ON.

### Livelli multipli (Fase 2)

Il modello CPU resta in `src/layer-stack.ts` (`npm run layers:verify`): record
ordinati, id monotoni mai riusati, bounds/`hasContent`, visibilità, opacità e
stili Traccia/Smusso/Ombra esterna/Ombra interna per livello. La mappa GPU è
chiavata sull'id stabile. Il cap resta `16`, ma dal candidato commit 13 il
costo eager per livello è soltanto il mip `0` autorevole: `64 MiB` RGBA8 o
`128 MiB` RGBA16F.

Architettura display candidata:

- strategia bake promossa 14e
  `transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces`;
- strategia compositing corrente
  `merged-above-over-isolated-active-clipping-group-over-merged-below-source-atop-live-prefix-suffix-compose-before-filter-parent-opacity-once-deferred-to-fold-fence-bounded-visual-rect`;
- una sola piramide raw, riusata dal livello attivo (`21,33 MiB` RGBA8,
  `42,67 MiB` RGBA16F);
- al massimo due superfici fuse, `mergedBelow` e `mergedAbove`. Ciascuna ha mip
  `0` più catena completa: `85,33 MiB` RGBA8 o `170,67 MiB` RGBA16F;
- quando l'attivo appartiene a un gruppo di ritaglio, il gruppo viene escluso
  in blocco dai due fusi generali. Fino a due superfici RGBA ritagliate
  aggiuntive conservano il prefisso e il suffisso statici attorno all'attivo;
  sono dimensionate sul bbox, hanno la propria piramide e sono contate nella
  riga telemetrica compatibile `activeClippingMaskMiB`, ma non sono maschere R8;
- nessun livello inattivo possiede una piramide propria. I bake analitici mip `0`
  vengono creati dentro la transazione, fusi in ordine bottom-up e distrutti
  subito; `layerBakeMiB` deve quindi tornare a `0` a motore fermo;
- `layerMipChainMiB` dipende dal numero di lati fusi presenti, non dal numero di
  livelli: attivo in cima/fondo ⇒ due catene totali (attivo + un lato), attivo in
  mezzo ⇒ tre (attivo + due lati). Anche `layerCompositeMiB` è `64 MiB` RGBA8 o
  `128 MiB` RGBA16F per lato, non per livello.

Il fold evita il pass full-document per il primo livello opaco: copia
byte-esattamente la sorgente nella superficie nuova e limita la copia ai
`contentBounds` conservativi quando la sorgente è raw. Il candidato 14d limita
anche il bake analitico all'unione dei bounds visivi autorevoli di Traccia,
Smusso, Ombra esterna e Ombra interna; metadata incoerenti ricadono sul documento
completo. Gli altri fold source-over usano lo stesso rettangolo come scissor.
L'estensione è promossa dalla rev `8`; conservare il fallback full-document per metadata incoerenti.

Il display esegue in lineare premoltiplicato
`mergedAbove over isolatedGroup over mergedBelow`, poi scacchiera e conversione
lineare→sRGB. Senza ritaglio `isolatedGroup` coincide con l'attivo e conserva il
fast path precedente. Con ritaglio, il livello base fornisce l'alpha matte
**continuo** e ogni figlio contiguo viene composto in ordine con Porter-Duff
source-atop; non esistono soglie, `discard` o quantizzazione binaria. L'alpha
finale del gruppo resta esattamente quello del parent e l'opacità del parent
viene applicata una sola volta, dopo tutti i figli. Se l'attivo è il parent, il
suffisso contiene i figli; se è un figlio, il prefisso contiene parent e figli
precedenti e il suffisso quelli successivi. Il texel live dell'attivo viene
inserito fra i due nello stesso frame di presentazione, quindi pennello, Light
Glaze e code provvisorie aggiornano il gruppo prima del lift senza rebuild
differito della maschera. La stessa formula è cablata nel display permanente,
Light live, coda spessore, style stack, testo/scena mista ed effetti. La uniform
display è ora `96 byte`: include modo gruppo, opacità parent, scale e origini
dei due bbox oltre alla vista e ai fusi generali.

La piramide del gruppo rispetta `compose-before-filter`: il mip `1` compone
quattro texel documento completi, incluso source-atop, e soltanto dopo esegue il
box filter; i mip successivi filtrano quel risultato. Questo evita sia aloni sia
salti di alpha ai cambi LOD. Il percorso live non genera una texture-maschera
per stamp, non introduce readback CPU e non aspetta fence aggiuntivi: il costo
caldo è il branch di gruppo e, quando presente, fino ai sample di prefisso e
suffisso già residenti. La memoria aggiuntiva dipende dai bbox RGBA ritagliati,
non dal numero di stamp.

QA GPU locale del 3 agosto 2026 con `/?clippingGroupTest=1`: parent morbido,
figlio nero e alpha parent `16/255` hanno prodotto il RGB atteso `203` con
errore massimo `0`; durante un gesto Light sul parent il texel è cambiato da
`[209,209,209,255]` a `[0,0,0,255]` **prima** del pointer-up e il valore
committato è rimasto byte-identico. Il report ha passato contiguità, alpha
continuo, aggiornamento live e live=commit; console priva di warning/errori
WebGPU. Gli identificatori WGSL `active` sono stati rinominati perché riservati
e ogni `fwidth` dei percorsi style/gruppo è valutato prima del ramo non uniforme
`insideLayer`. TypeScript, tutte le suite `*:verify` e build Vite/Sites verdi.

UI maschere aggiornata il 3 agosto 2026: il vecchio pulsante globale «Crea
maschera» è rimosso e ogni riga raster espone il toggle `M`, utilizzabile anche
su un livello già creato e inattivo. L'attivazione unisce l'intera unità della
riga alla base raster contigua sotto di essa: più `M` consecutive ricevono lo
stesso `clippingParentId`, e due gruppi adiacenti vengono fusi senza perdere i
figli superiori. La disattivazione divide invece il gruppo in quel punto: la
riga diventa una nuova base e tutte le maschere sopra vengono riparentate a
essa, così un secondo click ricostruisce esattamente il gruppo precedente. Il
bottom raster ha `M` disabilitata; nella scena mista anche un vettore interposto
blocca il merge invece di essere riordinato implicitamente.

`setLayerClipping` non modifica pixel, tile, effetti o residenza autorevole:
attende l'idle, cambia atomicamente soltanto i parent id, ricostruisce lati
fusi/prefisso/suffisso WebGPU e invalida mip/presentazione. Se il rebuild fallisce
esegue il toggle inverso e ricostruisce lo stato derivato precedente; un secondo
fallimento alza il latch documentale. QA browser reale: `Livello 2` già creato
è stato collegato da inattivo a `Livello 1`, poi `Livello 3` ha condiviso la
stessa base; scollegando `Livello 2`, `Livello 3` è passato alla nuova base `2`,
e riattivandolo entrambi sono tornati alla base `1`. Console pulita. Regressioni
`layers`, `mixed-scene`, `history`, `view`, TypeScript e build Vite/Sites verdi.

La fusione è transazionale ma, dalla 14e, ha picco limitato: dopo GPU idle
congela la presentazione sull'ultima cache screen-space completa, scollega e
distrugge `mergedBelow/Above` precedenti, poi costruisce i candidati. Nessun
frame può essere inviato mentre view evacuate potrebbero ancora essere legate.
Sul successo pubblica i nuovi bind group e sblocca il display; su errore/OOM
distrugge i candidati e la transazione esterna ricostruisce lo stato precedente
dai raw hot/cold autorevoli. Anche il rollback di visibilità/opacità ricostruisce
esplicitamente i fusi precedenti. Le attese GPU e il retarget usato dalla
fusione hanno un tetto esplicito. Se anche il retarget inverso fallisce, il
documento alza il latch fatale e richiede reload: non consente di continuare
con un banco effetti dalla sorgente non dimostrata.

Il `caller` del retarget è un'invariante transazionale: `history-replay` deve
propagarsi da `activateLayer` a `rebuildMergedLayerSurfaces`, ai due builder e
fino a ogni materializzazione/retarget temporaneo, incluso il ripristino. In
Undo/Redo `historyBusy` è già alto; degradare uno di questi passaggi al default
`layer-switch` rifiuta il retarget e rompe soltanto i replay cross-layer con un
inattivo stilizzato. `layers:verify` vincola l'intera catena.

Gli stili restano accessori del record attivo. Lo switch persiste stato e cold
store esatto dell'uscente; dopo il fence evacua il suo hot full-canvas e
l'eventuale bake, quindi reidrata l'entrante, ritargetta Blend e banco effetti,
ricostruisce le due superfici fuse e invalida la cache. Il bake di hand-off non
è più residente nel percorso normale; resta soltanto la sonda DEV per i fault
transazionali. I bake analitici necessari al fold sono ancora creati uno alla
volta e distrutti subito. Smusso-only o
qualunque Ombra-only richiede comunque `RasterStrokeRenderer`, che è il
compositore comune. La UI risincronizza Traccia/Smusso/Ombra esterna/Ombra
interna a ogni cambio e ora espone selezione, visibilità e opacità
separatamente.

Costi storici pre-compositing misurati su desktop Ampere, effetti attivi e flag
bbox OFF (non riutilizzarli come risultato del candidato):

| Operazione | Prima del commit 13 |
|---|---:|
| `addLayer` vuoto | `8,3 – 9 ms` |
| switch con contenuto ed effetti | `151 – 215 ms` |
| switch con effetti spenti | `3,6 – 4 ms` |

La telemetria corrente rev `54` firma `layerCount`, `activeLayerId`,
`layerBakeStrategy` e `layerCompositeStrategy`; `layerMemoryMiB` conta hot
e cold reali. Le righe HUD distinte sono mip attivo+fusi, hydration temporanee,
bake transitori e mip `0` fusi. Il pannello resta campionato ogni `500 ms`:
può non mostrare un transitorio intero; l'harness rev `10` campiona invece le
statistiche ogni `1 ms`. Run con revisione/strategie diverse non sono
aggregabili.

#### Harness permanente corrente (rev 10)

`/?layerHistoryTest=1` resta distruttivo e richiede una pagina dev nuova. Oltre
alla cronologia bilaterale e ai rollback cross-layer già esistenti, conserva i
gate visivi introdotti dalla rev `4` e ora:

- misura lo scarto tra display live `fwidth` e bake analitico sullo stesso rect,
  riportando pixel/byte differenti, delta massimo per canale e primo byte;
- verifica tre texel assoluti (solo sotto, sovrapposizione, solo sopra) più la
  sola scacchiera contro un riferimento CPU source-over indipendente;
- prova che il riferimento sRGB errato sia discriminante;
- legge separatamente `mergedBelow` e `mergedAbove`;
- confronta byte-per-byte il fast path opaco raw con il mip `0` autorevole,
  compresi i texel trasparenti fuori dal tratto;
- forza il rollback post-submit del compositing e controlla bytes, record,
  working set e memoria;
- cambia opacità e visibilità di un inattivo e verifica l'invalidazione;
- porta la camera a mip logico `2`, legge il mip senza completarlo dalla sonda e
  lo confronta con due box filter CPU `2×2`;
- costruisce cinque livelli con effetti, controlla bake rilasciati e memoria
  `1/2/5`, misura switch a due livelli e stress a cinque;
- campiona ogni `1 ms` aggiunta, cima↔fondo e cima↔metà, riportando il massimo
  di hot, cold, hydration, mip, bake, compositi e totale realmente conteggiato;
- vincola i picchi estremi a una sola istanza per classe ricostruibile; nel mezzo
  ammette soltanto i due compositi finali realmente necessari;
- ha un tetto esterno di `180 s`; ogni nuovo submit atteso ha anche un timeout
  interno, così un blocco diventa un errore esplicito.

#### Decisione visiva provvisoria dell'utente — 26 luglio 2026

Il livello attivo usa il contorno live basato su `fwidth`; quando diventa
inattivo viene materializzato dal compositore analitico. La misura browser del
26 luglio 2026 confronta `22.528` pixel / `90.112` byte: `5.370` pixel e
`11.061` byte differiscono, delta massimo RGBA `[8, 68, 68, 0]`; il primo
scarto è a `(501, 479)`, canale verde, live `208` contro bake `209`.

Scelta esplicita dell'utente, **per ora**: conservare `fwidth` per il livello
attivo, accettare lo scarto misurato al cambio fuoco e mantenere
`layerBakeMiB = 0` a regime. È una decisione reversibile, non una promozione
pixel-identica: si potrà tornare a mostrare anche l'attivo dal bake analitico,
ma quel cambiamento richiederà una nuova decisione, circa `64 MiB` RGBA8
residenti in più e una nuova verifica Golden. Non riaprire o cambiare questa
scelta automaticamente.

#### Gate prima di pubblicare il commit 13

Verifiche locali finali del candidato eseguite il 26 luglio 2026: tutte le otto verify
(`stroke`, `grain`, `blend`, `thickness`, `history`, `layers`,
`effects-scratch`, `bevel`), `tsc --noEmit` e `git diff --check` sono verdi.

Verifiche browser e build eseguite il 26 luglio 2026:

- Golden mip `0`
  `8d5a75a6abb9f47cdf4a794d560b5795aa4b4c85520db2dd1466833157f6dcb0` e mip
  combinato `9208e2a30e5ece12dc92f31e74f6113ffd89af60672492cf534f1b5e08208196`
  invariati. `baselineMatches` resta volutamente falso per gli stessi 25 mismatch
  mip; restano rossi soltanto i tre diagnostici source-mode già aperti, delta
  massimo `1`;
- harness rev `4`: `105/105` controlli verdi entro il tetto. Il fast path raw
  confronta `3.076` byte con zero differenze. La mutazione della destinazione di
  copia di `+1 px` produce un solo rosso e `24` byte diversi, poi è stata
  ripristinata;
- memoria RGBA8: 1 livello `218,195 MiB` totali (`64` raw, `21,333` mip,
  bake/fuso `0`); 2 livelli `367,528 MiB` (`128` raw, `42,667` mip, bake `0`,
  fuso `64`); 5 livelli `489,887 MiB` (`320` raw, `42,667` mip, bake `0`,
  fuso `64`);
- prima dell'ottimizzazione il nuovo compositing misurava `238/27 ms` a due
  livelli. Il fold opaco con copia esatta e scissor misura `100,7/12,7 ms`,
  quindi resta sotto il tetto storico `215 ms` senza alzarlo. Lo stress a cinque
  livelli misura `376,7/368,1 ms`, coerente con la run precedente `371–404 ms`;
  una prima ripetizione contesa aveva prodotto `1176,6/1077,2 ms` e va conservata
  come outlier, non aggregata. La run pulita finale pre-commit, dopo tutte le
  mutazioni ripristinate, misura `85,7/10,2 ms` a due livelli e
  `356,1/359,9 ms` a cinque;
- build Vite finale in directory temporanea verde (`447 ms`; prima run `486 ms`), senza toccare `dist/`.

Mutation gate GPU completato il 26 luglio 2026; ogni mutazione è stata
ripristinata e la run successiva è tornata `105/105`:

| Mutazione | Rosso discriminante |
|---|---|
| ordine attivo/sotto invertito | sola sovrapposizione, delta massimo `22` |
| source-over dopo conversione sRGB | riferimenti assoluti e sovrapposizione, delta `30` |
| `hasMergedAbove = 0` | lato sopra assente, delta `81`, zoom sulla scacchiera |
| niente rebuild per opacità/visibilità inattiva | i due controlli di invalidazione, delta `57/81` |
| niente piramide mip del lato sopra | mip `2` nullo contro `[6,34,154,178]`, delta `178` |
| destinazione fast-copy spostata di `+1 px` | `24` byte diversi su `3.076` |

Il rollback post-submit è esercitato separatamente dall'iniezione di guasto
permanente. Nessun residuo delle mutazioni è presente nel sorgente. La scelta
percettiva `fwidth`/analitico è stata presa provvisoriamente dall'utente come
documentato sopra.

`dist/` era già sporca prima del candidato e non fa parte del lavoro: non
ripulirla, rigenerarla o includerla nel commit. Il Golden del passo 12 resta la
baseline storica misurata; non vale come esecuzione del commit 13.

#### Commit 14a — misura tile dei livelli inattivi, storage invariato

Il commit 14a non cambia ancora alcuna allocazione GPU: il livello attivo resta
sempre una texture full-canvas e anche gli inattivi continuano a occupare il mip
`0` intero. La strategia firmata è
`measure-only-active-full-inactive-256-dirty-tiles-vs-aligned-bbox`. Ogni record
mantiene soltanto una maschera CPU conservativa `16×16` di tile `256×256`, cioè
`8 u32` / `32 byte`; la mutazione centrale marca tutte le tile toccate e un
clear azzera la maschera. Non esistono texture sparse, texture array o buffer
tile in questo commit.

La telemetria rev `46` e le due righe HUD «Studio cold» confrontano tile
conservative e bbox allineata. Sono stime controfattuali: non entrano nel totale
GPU, non generano badge di allocazione e non vanno descritte come memoria già
risparmiata. La sonda dev esatta legge un livello alla volta, considera occupata
una tile quando **qualunque byte raw RGBA è non zero** e distrugge subito il
buffer temporaneo.

Run WebGPU finale su NVIDIA Ampere, RGBA8, cinque livelli della fixture:

| Modello raw | MiB |
|---|---:|
| allocazione reale corrente | `320` |
| proiezione esatta, attivo full | `69` |
| maschera conservativa, attivo full | `69` |
| bbox allineata, attivo full | `75,5` |

La maschera non perde nessuna tile esatta (`0` miss) e in questa fixture non ha
extra; la riduzione **ipotetica** rispetto ai soli mip `0` è `251 MiB`. La
contabilità GPU prima/dopo il readback resta identica a `489,887363 MiB`; la
contabilità separata dei buffer diagnostici misura `0 → 64 → 0 MiB`, quindi il
full readback avviene davvero e il buffer temporaneo viene rilasciato. Harness
rev `5`: `111/111` controlli verdi; switch a due livelli `90,6/12,1 ms`, stress
a cinque `360,1/380,0 ms`, sotto il tetto storico nella run pulita finale.


Mutation gate: rimossa la chiamata che marca la dirty rect, il riferimento esatto
trova `24` tile mancanti e rende rossi
`conservativeTilesContainEveryExactTile` e
`exactProjectionIsNoLargerThanConservative`. Rimossa poi la chiusura della sola
contabilità readback, lasciando `GPUBuffer.destroy()`, l'harness si interrompe
con `11.762.176` byte temporanei ancora segnati vivi. Dopo entrambi i ripristini
la run torna `111/111`. Golden invariato (`8d5a75a6…` mip `0`, `9208e2a3…` mip derivati),
con gli stessi 25 mismatch e tre diagnostici già aperti; otto verify, TypeScript,
`git diff --check` e build Vite temporanea (`350 ms`) verdi. `dist/` non è stata
toccata.

La scelta del backend cold resta aperta: questi numeri autorizzano il passo
successivo di prototipazione, non la conclusione che tile siano già migliori in
latenza o memoria fisica su mobile.


#### Commit 14b — cold storage GPU reale per i livelli inattivi

La strategia corrente è
`single-active-plus-optional-reference-full-inactive-256-array-tiles-rehydrate-fold`.
Il livello attivo conserva sempre il mip `0` full-canvas (`64 MiB` RGBA8 /
`128 MiB` RGBA16F); se esiste un Riferimento distinto, anche quello resta
full-resident per il Riempimento. Tutti gli altri livelli usano il percorso
cold originale: i tile conservativi `256×256` vengono copiati in una texture
array compatta e la texture full viene distrutta soltanto dopo che il nuovo
livello è stato reidratato e le superfici fuse sono state ricostruite con
successo. Un livello inattivo vuoto non conserva alcuna texture raw.

Lo switch è transazionale: il pack costruisce un candidato senza toccare il
full autorevole; la reidratazione costruisce e popola un nuovo full prima di
pubblicarlo. Se pack, hydrate o rebuild falliscono, candidato e temporanei sono
distrutti e pixel, indice attivo e banco effetti tornano allo stato precedente.
Gli inattivi vengono oggi reidratati temporaneamente anche durante il fold delle
superfici `merged`; il fold diretto dai tile resta il passo di ottimizzazione
successivo per ridurre la latenza con molti livelli, non una condizione di
correttezza di questo commit.

Telemetria rev `47`: `layerBaseMiB` conta soltanto i full hot,
`layerColdMiB` i tile array inattivi e `layerHydrationMiB` i full temporanei.
`layerMemoryMiB` e il totale GPU usano le allocazioni logiche reali; non sono
una misura della residency fisica del driver. Il pannello distingue livello
attivo, tile cold e un eventuale full trattenuto solo dal rollback di sicurezza.

Run WebGPU finale su NVIDIA Ampere, RGBA8:

| Stato | Full hot | Tile cold | Raw reale | Raw eager precedente |
|---|---:|---:|---:|---:|
| 1 livello | `64 MiB` | `0` | `64 MiB` | `64 MiB` |
| 2 livelli | `64 MiB` | `1 MiB` | `65 MiB` | `128 MiB` |
| 5 livelli | `64 MiB` | `11,5 MiB` | `75,5 MiB` | `320 MiB` |

Nella fixture a cinque livelli il riferimento esatto richiederebbe `69 MiB`:
la maschera conservativa non perde tile (`0` miss) e trattiene `26` tile extra,
perciò il costo reale è `75,5 MiB` e il risparmio raw rispetto all'eager è
`244,5 MiB`. A motore fermo `layerHydrationMiB` e `layerBakeMiB` tornano a
`0`; mip condivisi e superfici fuse restano O(1) rispetto al numero di livelli.

Harness GPU rev `6`: `128/128` controlli verdi. Le iniezioni di guasto dopo il
submit di pack e hydrate propagano l'errore ma lasciano il livello byte-identico
(`0` byte diversi), banco effetti coerente e nessun temporaneo vivo. Mutation
gate: omettendo la distruzione del vecchio full l'harness diventa rosso
(`Superficie merged below non allocata`); dopo il ripristino torna interamente
verde. Golden invariato: mip `0` `8d5a75a6…`, mip derivati `9208e2a3…`, con gli
stessi `25` mismatch e i tre diagnostici delta massimo `1` già documentati.

Nella run finale lo switch a due livelli misura `97,1/25,8 ms`; lo stress a
cinque livelli `403,8/403,0 ms`. Sono wall-clock di una sola GPU desktop, non
una dichiarazione prestazionale né una validazione mobile. La memoria è
promossa; il costo di fold/reidratazione con molti livelli resta il prossimo
problema misurabile.

#### Esperimento 14c promosso — una sola barriera GPU per record del fold

Esperimento isolato misurato e promosso il 27 luglio 2026. Non cambia tile,
texture, formati, pixel, shader, ordine source-over, bake analitico, rollback o
numero di allocazioni temporanee. Cambia soltanto la schedulazione interna della
materializzazione di un livello inattivo: hydrate, retarget del banco effetti e
bake vengono inviati in ordine FIFO senza `onSubmittedWorkDone()` intermedi; il
submit del fold chiude la catena con un solo `waitForGpuCapped` per record. Il
record successivo parte soltanto dopo quel fence, quindi restano vivi al massimo
una hydration full e un bake full, come prima. Pack dell'uscente, hydrate del
nuovo attivo, percorsi pubblici e fault injection conservano il completamento
immediato.

Baseline locale catturata prima della modifica con harness rev `6`, interamente
verde: switch a cinque livelli `437,1/472,3 ms`, media `454,70 ms`; switch a due
livelli `91,7/20,7 ms`; raw reale `75,5 MiB`, totale conteggiato fermo
`245,387451 MiB`.

La run GPU rev `7` restituita dall'utente è passata con tutti i `129` check veri,
`compositing.passed: true` e firma esatta
`merged-above-over-active-over-merged-below-source-over-deferred-to-fold-fence`.
I riferimenti assoluti, i fold sopra/sotto, il fast path opaco, zoom, rollback e
cronologia sono byte-identici o a delta zero dove previsto. Lo switch a cinque
livelli misura `317,1/316,0 ms`, media `316,55 ms`: `−27,45%` e `−33,09%` sui
due campioni, `−30,38%` sulla media (`−138,15 ms`). Lo switch a due livelli
misura `86,2/19,4 ms`, circa `−6,0%/−6,3%` sulla baseline.

La memoria specifica dei livelli resta invariata: raw reale `75,5 MiB`, stima
esatta `69 MiB`, conservativa `75,5 MiB`; al termine hydration e bake sono
entrambi `0 MiB`, base `64 MiB`, cold `11,5 MiB` e composito `64 MiB`. Il totale
globale del run è `248,666260 MiB`, ma non viene usato per attribuire il delta a
questo esperimento perché include risorse non specifiche dei livelli la cui
residenza non è firmata tra le due catture. Tutti i gate di memoria del run sono
verdi e la modifica non introduce nuove risorse.

Verifiche statiche candidate verdi: `stroke:verify`, `grain:verify`,
`blend:verify`, `thickness:verify`, `history:verify`, `layers:verify`,
`effects-scratch:verify`, `bevel:verify`, `shadow:verify`, `view:verify`,
TypeScript, `git diff --check` e build Vite temporanea (`379 ms`). La
schedulazione 14c è quindi la nuova base per il prossimo esperimento. Non
considerare però chiusa la latenza del cambio livello: `~316 ms` sul caso a
cinque livelli resta percepibile; il passo successivo deve ridurre o eliminare
la materializzazione full-canvas del record inattivo, senza sommare un'altra
variabile nello stesso run e senza dichiarazioni iPhone.

#### Esperimento 14d promosso — dominio visivo bounded per bake e fold

Esperimento isolato misurato e promosso il 27 luglio 2026 sulla baseline 14c.
Non cambia texture, formati, shader, blending, ordine source-over, parametri dei
pennelli o allocazioni: la texture bake resta full-canvas e zero-initialized.
Cambia soltanto il dominio di lavoro del percorso inattivo.

Il renderer accettava già `RasterStrokeBakeOptions.rect` e i core esponevano già
i bounds visivi conservativi usati dall'invalidazione di Traccia, Smusso, Ombra
esterna e Ombra interna. `layerCompositeVisualBounds` ne calcola l'unione con i
bounds raw; il bake scrive soltanto quel rettangolo e il fold usa lo stesso
rettangolo per copy/scissor. Anche il rebuild Traccia del retarget temporaneo è
limitato ai `contentBounds`; i retarget pubblici e del livello attivo conservano
il contratto full-document. Se `hasContent` non ha bounds coerenti, il fallback è
l'intero `4096²`: si perde solo la prestazione, mai un pixel.

Firme promosse: bake
`transient-analytic-bounded-visual-rect-mip0-fused-into-two-merged-surfaces`,
compositing
`merged-above-over-active-over-merged-below-source-over-deferred-to-fold-fence-bounded-visual-rect`,
telemetria rev `53`, harness GPU rev `8`. Il report conta `foldedPixels` e
`analyticBakePixels` e separa `effectsMs`, `compositeMs` e tempo residuo.

Sei run candidate pulite (`12` switch) sono passate tutte con `133/133` check
veri, firme esatte, riferimenti assoluti/fold/zoom/rollback byte-identici o delta
zero e nessun residuo hydration/bake. Il dominio di quattro livelli è
`1.225.344` pixel contro `67.108.864` del controllo full-document: `−98,17%`,
ovvero `54,77×` meno pixel di bake/fold. La memoria A/B è identica: totale
conteggiato `245,387451 MiB`, raw reale `75,5 MiB`, hydration e bake finali
`0 MiB`.

Controllo A/B sullo stesso codice, browser e GPU NVIDIA: un override temporaneo
solo di misura ha ripristinato esattamente il dominio 14c `4096²`; tre run, sei
switch, misurano `330,4–343,3 ms`, media `333,72 ms`, mediana `332,05 ms`.
L'override ha fallito soltanto i due check che richiedono esplicitamente il
dominio bounded, è stato rimosso e non compare nel codice finale. I dodici
campioni 14d misurano media `251,46 ms`, mediana `237,75 ms`: `−24,65%` e
`−28,40%` rispetto al controllo A/B. Undici campioni su dodici sono più veloci
del migliore controllo; resta un outlier freddo a `406,8 ms`, quindi non
nascondere il caso peggiore. Rispetto alla run 14c restituita dall'utente
(`317,1/316,0 ms`, media `316,55 ms`) la media/mediana 14d migliorano di
`−20,56%/−24,89%`.

La run finale dopo la rimozione dell'override misura `220,1/211,4 ms`
(media `215,75 ms`, `−31,84%` sulla 14c utente); il breakdown è
`effectsMs 52,1/52,3`, `compositeMs 158,7/153,0`, residuo `9,3/6,1 ms`. Il
bottleneck residuo è quindi il compositing per-record, non il retarget del
livello attivo. `~211–242 ms` tipici restano percepibili e l'outlier impone di
non considerare chiusa la latenza né fare dichiarazioni iPhone.

Verifiche statiche verdi: `stroke:verify`, `grain:verify`, `blend:verify`,
`thickness:verify`, `history:verify`, `layers:verify`, `effects-scratch:verify`,
`bevel:verify`, `shadow:verify`, `view:verify`, TypeScript, `git diff --check` e
build Vite finale (`452 ms`). La 14d è la nuova
base del prossimo esperimento; non sommare un'altra variabile senza una nuova
firma e un nuovo confronto.

#### Esperimento 14e promosso — picco limitato durante add e cambio livello

Esperimento isolato misurato il 27 luglio 2026 sulla baseline 14d. Non cambia
texture, formati, shader, pixel, ordine source-over, parametri del pennello,
contenuto cold o numero di superfici finali. Cambia soltanto l'ordine di vita
delle risorse ricostruibili durante una transizione.

Prima della 14e lo switch conservava contemporaneamente hot uscente, bake di
hand-off e vecchie superfici fuse mentre allocava hot/hydration, bake e fusi
nuovi. Il picco della fixture RGBA8 a cinque livelli conteneva quindi
`layerBase 128 MiB`, `layerHydration 64`, `layerMipChain 64`,
`layerBake 128` e `layerComposite 128`, anche quando il livello finale era
in cima o in fondo e richiedeva una sola superficie fusa.

La 14e esegue invece:

1. pack esatto dell'uscente nel cold store e fence GPU;
2. freeze della presentazione sull'ultima cache completa, poi distruzione di
   hot e bake uscenti;
3. distruzione dei fusi precedenti prima dei candidati;
4. una sola hydration e un solo bake transitorio per volta durante il fold;
5. pubblicazione dei nuovi bind group e sblocco del display soltanto a rebuild
   completo.

Un'attivazione fallita evacua il candidato hot prima di reidratare l'origine.
Un OOM durante `addLayer` rimuove il record incompleto e riattiva l'uscente dal
cold autorevole. Undo/Redo usa lo stesso ordine nel rollback. La guardia
`layerPresentationFrozen` impedisce submit con view già distrutte; un doppio
fallimento conserva il latch fatale già esistente.

Misura browser WebGPU, telemetria rev `54`, harness rev `10`, campionamento
`1 ms`:

| Operazione | Baseline rev 9: prima → picco (delta) | 14e rev 10: prima → picco (delta) |
|---|---:|---:|
| aggiunta D | `243,867 → 586,200 (+342,333) MiB` | `243,867 → 372,867 (+129,000) MiB` |
| aggiunta E | `244,867 → 586,700 (+341,833) MiB` | `244,867 → 373,367 (+128,500) MiB` |
| cima → fondo | `245,367 → 587,700 (+342,333) MiB` | `245,367 → 374,367 (+129,000) MiB` |
| fondo → cima | `240,367 → 587,700 (+347,333) MiB` | `240,367 → 374,367 (+134,000) MiB` |
| cima → mezzo | non campionato nella rev 9 | `245,367 → 459,700 (+214,333) MiB` |
| mezzo → cima | non campionato nella rev 9 | `330,700 → 374,367 (+43,667) MiB` |

Su aggiunte e switch estremi il picco assoluto cala di `213,333 MiB`, circa
`−36,3%`; l'escursione temporanea cala di circa `−61–62%`. Le massime 14e
sono `base 64`, `hydration 64`, `bake 64`, `composite 64` e mip
`42,667 MiB`: nessuna coppia vecchio+nuovo resta sovrapposta. Nel mezzo sono
legittimi `128 MiB` di compositi e `64 MiB` di mip perché servono davvero un
lato sotto e uno sopra; il test vieta comunque una terza copia.

Il run finale passa `138/138` check: riferimenti assoluti, fold, zoom,
cronologia, fault injection e rollback. Il rollback del compositing conserva
`0` byte differenti e la sua memoria torna `128 → 128 MiB`. Le dieci suite
`*:verify`, TypeScript, `git diff --check` e build Vite sono verdi. Lo switch
a cinque livelli misura `287,1/289,7 ms`: questo singolo run non dimostra un
guadagno di latenza e non va aggregato con la 14d; la promozione riguarda la
sicurezza del picco.

La segnalazione utente `~400 → ~900 MiB → ~400` con più effetti residenti è
coerente con la sovrapposizione eliminata, ma gli assoluti non sono direttamente
comparabili con la fixture. Il monitor conta memoria WebGPU logica, non residency
fisica del driver/browser. Manca ancora una prova iPhone reale: non dichiarare
eliminato il rischio di chiusura su iOS finché quella prova non viene eseguita.

#### Fixture manuale ~1 GiB per la prova iPhone

Il 27 luglio 2026 è stata aggiunta una pagina diagnostica esplicita,
`/?layerMemoryStressTest=1`, disponibile anche nella build pubblicata ma mai
avviata automaticamente. Richiede una pagina nuova RGBA8 e un click: solo per
questa query scrive un marker `64×64` diverso su ogni livello e forza la
maschera conservativa a tutti i `256` tile. Ogni inattivo alloca quindi davvero
`64 MiB` cold, mentre i bounds visivi restano piccoli per non confondere lo
stress di memoria con un fold full-document. Durante il setup le altre
mutazioni sono bloccate; alla fine la UI viene sbloccata e i livelli restano
selezionabili. Un campionatore `5 ms` riporta anche il picco dei cambi manuali.

Run locale NVIDIA Ampere, RGBA8: setup passato in `1.743,1 ms`, `14` livelli,
totale fermo `1010,030 MiB` e picco osservato `1074,030 MiB`. Breakdown fermo:
raw attivo `64`, cold `832`, mip condivisi `42,667`, composito `64`,
hydration/bake `0 MiB`. Tutti i tredici inattivi hanno `256/256` tile cold e
anche l'attivo ha la maschera `256/256` pronta per il primo cambio.

| Cambio manuale | Tempo | Picco osservato | Finale |
|---|---:|---:|---:|
| cima `14` → fondo `1` | `236 ms` | `1138,0 MiB` | `1010,0 MiB` |
| fondo `1` → mezzo `7` | `304 ms` | `1223,4 MiB` | `1095,4 MiB` |
| mezzo `7` → cima `14` | `255 ms` | `1159,3 MiB` | `1010,0 MiB` |

Il finale più alto nel mezzo è previsto: esistono contemporaneamente un lato
fuso sotto e uno sopra, quindi rispetto all'estremo restano `+64 MiB` di mip
`0` composito e `+21,333 MiB` di piramide. La pagina non si è bloccata e la
console non ha riportato warning/errori WebGPU. È solo una prova desktop della
contabilità logica: l'esito iPhone e l'eventuale chiusura di Safari restano da
misurare dall'utente.

#### Gate document-wide e cronologia da preservare

| Operazione | Stato con `layerCount > 1` | Si sblocca con |
|---|---|---|
| Undo / Redo | globali: un passo su un altro livello vivo lo seleziona e lo ricostruisce; rifiuto solo se il proprietario non esiste più | già implementato |
| `resetDocument()` | rifiutato | reset davvero document-wide |
| `runBenchmark()` | rifiutato | reset document-wide + parità baseline |
| `setLayerFormat()` | consentito | ricrea transazionalmente tutti i livelli |

Undo/Redo cross-layer resta una singola transazione. Su errore ripristina prima
cursore e target ancora attivo, poi esegue l'attivazione inversa completa;
fallire anche il rollback alza il latch fatale `historyStateInconsistent`, tiene
`historyBusy` alto e richiede reload. `layerSwitchBusy` copre tutta la durata
degli `await`: nessun tratto o cambio impostazioni può entrare in uno switch a
metà. Non sostituire questi rollback con il solo cambio indice o bind texture.

Blend (tool separato, vedi sezione dedicata più sotto).

## Esperimenti chiusi — esiti vincolanti

Non reintrodurre i bocciati senza dati nuovi che eliminino la causa misurata.

| Esperimento | Run | Esito | Causa/nota |
|---|---|---|---|
| Dodecagono circoscritto 36 vertici | `#4/#5` | bocciato | costo vertex > risparmio fragment su Apple |
| Backpressure cap 2 submission | `#10` | bocciato | batch 7–9× più grandi, p95 `100 ms` |
| Quad `triangle-strip` 4 vertici | `#11` | **promosso** | `−33%` invocazioni vertex, tutto migliora |
| Colore flat su 2 vertici | — | ritirato | rollback richiesto prima della misura |
| Fast path coverage interno | `#15` | bocciato | `−1,5%` FPS su GPU Apple |
| Riuso `copySeed` | `#16` | **promosso** | bit-identico, tutte le direzioni favorevoli |
| Dirty rect direzionale | `#19` | mantenuto | `−36,6%` scissor, FPS pari; utile per il futuro |
| Pipeline specializzata Count 16 | `#20` | bocciato | nessun guadagno, 4 pipeline inutili |
| Display su target sRGB (`viewFormats`) | `#21` | bocciato | costo della view ≥ aritmetica evitata |
| Compute prepass per copia | `#22` | bocciato | pass+traffico buffer > risparmio vertex |
| Layer tiled 512 / 1024 (pass per tile) | `#23/#25` | bocciati | duplicazione copie e pass distruggono il pacing; 1024 ≫ 512 ma < monolitico |
| Scratch dirty-rect con copyback | `#27` | bocciato | ~2 px copiati per px di attachment evitato |
| Supporti orientati Shape (6 quad) | `#30` | bocciato | estrazione runtime fallita su iPhone, fallback 6 vertici disastroso |
| Pre-mappa occupazione Shape | `#32` | **promosso** | `+18,5%` FPS Fur |
| Undo/Redo journal CPU | `#33/#34` | **promosso** | costo nullo sul tratto |
| Cache di presentazione | `#37/#38` | **promossa** | Base `+46%` FPS vs fullscreen nudo |
| Preview differita ½ risoluzione | `#39/#40` | bocciata | debito strutturale: resolve `4,4 s` al lift |
| Tip patch Canvas2D v2 | `#42/#44` | attiva | ~`1%` costo Base, sensazione approvata |
| Posizionamento `transform` della patch | `#46` | bocciato | `resizeCanvasTotalMs` invariato, nessun recupero |
| Canvas sincronizzato ovunque | `#47` | sostituito | fix Android corretto ma costo iPhone |
| Policy `desynchronized` per piattaforma | `#48` | **promossa** | iPhone `true`, Android/desktop `false` |
| Preview armata nascosta (probe 1) | `#51/#52` | bocciata | guadagno `17 ms`, regressione diffusa |
| Micro-benchmark raster vs compute | — | bocciato | compute `+66,7%` tempo su Apple, pixel identici |
| Spacing adattivo | `#53/#54` | **promosso** | vedi stato attuale |
| Tetto spacing Android `+4` | `#59/#60` | insufficiente | non è lo spacing il limite su quel device |
| Piramide mip live | `#61` | mantenuta | qualità migliore, costo non misurabile |
| Ritiro bitmap stale | `#63` | **promosso** | preview mai ferma sopra tratto avanzato |
| Grain nativo 2500 + M1 Glaze | `#70–#73` | accettati | end-to-end senza lag; scelta visiva all'utente |
| Velocità → Spessore | `#74/#75` | rimosso | decisione utente, matrice interrotta |
| Pressure → size/alpha | — | rimosso | decisione utente |
| Blend: batch limit 8 per size >512 | `#76` | superato | sostituito dal drenaggio a budget (sotto) |

## Revisioni di telemetria (per leggere le run storiche)

`2` CPU v2 · `3` tiled · `4` scratch copyback · `5` bitmask Shape · `6` decode
PNG diretto · `7` history · `8` UI fullscreen · `9` cache presentazione ·
`10` preview differita · `11` tip patch v2 · `12` transform patch ·
`13` canvas sincronizzato · `14` policy per piattaforma · `15` telemetria
probe · `16` armed-hidden · `17` spacing adattivo · `18` tetto Android ·
`19` piramide mip · `20` ritiro stale · `21` Opacità/Light Glaze · `22–23`
Grain/M1 matrice · `24` Grain Invert · `25` dinamica spessore · `26` bridge
Canvas2D tail · `27` overlay WebGPU tail · `28` rimozione velocità ·
`29` rimozione pressione · `30` firma Traccia raster · `31` gate alpha GPU
Traccia · `32` monitor e contabilità memoria GPU · `33` scratch Traccia adattivo
alla width · `34` coverage R8 packed senza distanza residente · `35` LOD 0
diretto + soli mip styled 1–12 · `36` diagnostica gate/source-mode e costo CPU
rebuild cache LOD 0 · `37` accumulatore M1 Glaze R8 con mip finali compositati
separati · `38` emulazione conversione UNORM nativa + diagnostica diff mip ·
`39` ciclo di vita di Blend scratch, storage Light/M1 Glaze, texture Grain M1
e maschera Shape 2K: alloca alla selezione, rilascia quando deselezionato e
il motore è fermo (revisione sperimentale corrente; nessuna run registrata
con i pool parziali, quindi la revisione copre i quattro pool insieme) · `40`
port sperimentale Smusso/Rilievo Heightfield V2, contabilità memoria dedicata,
invalidazioni geometry/hot e compositore comune Smusso→Traccia · `41` banco
effetti unico retargetable, diagnostica same-view e benchmark
retarget-vs-recreate · `42` pool scratch effetti fisico unico, extent/byte correnti,
picco storico, shrink idle e firma dei layout aliasati · `43` campo Smusso bbox e
relative allocazioni · `44` conteggio/id dei livelli e memoria raw moltiplicata ·
`45` strategie bake/compositing a tre superfici e contabilità mip/fusione ·
`46` studio tile cold contro bbox · `47` cold storage GPU reale e hydration ·
`48` Ombre indipendenti · `49` Golden Ombre e scratch compositore ridotto ·
`50` geometria Traccia lazy · `51` rotazione vista · `52` fence unico per
record del fold · `53` dominio visivo bounded per bake/fold · `54` evizione
prima della sostituzione e campionamento dei picchi add/switch · `55` worker
lossless per un solo livello distante, RAM compressa separata e ripristino
atomico · `56` fold transitorio dei compressi, multi-residenza con vicini raw e
progresso worker sospendibile/riprendibile ai tratti · `57` scenario misto e
working set esatto · `58` telemetria del renderer testo rapido/esatto · `59`
Riempimento GPU con sorgente Riferimento, residenza e memoria dedicata.

## Strumento Blend dry (WebGPU)

Port del Blend proprietario di `paint-webgpu-m1`, solo modalità **dry**. Tool
separato (`tool: "blend"`),
non un blend mode del Paint.

Fatti invarianti del modello:

- planner continuo dedicato: segmenti dal `6%` della size (min `2,5`, max
  `48 px`), un batch per segmento, FIFO;
- pigmento trasportato: pickup pesato `8×8` in un carrier persistente per
  tratto, deposito `mix(canvas, pigment, coverage×strength)`, carica del
  colore Paint con curva `Paint²`, persistenza carrier con `sqrt(Stretch)`;
- pressione normalizzata a `1`: non cambia size, intensità, planner o pixel;
- coordinate top-left, lettura/scrittura diretta del premoltiplicato lineare
  del motore: **non** reintrodurre conversioni sRGB o flip Y del sorgente
  WebGL2;
- bordo documento (`DRY_BLEND_PICKUP_BORDER_STRATEGY:
  "exclude-outside-document-preserve-carrier"`): tap fuori documento esclusi
  da somma e denominatore, lookup bilineare clampato al bordo, passo tutto
  fuori canvas trasporta il carrier invariato;
- default UI: size `100`, spacing `10%`, flow `45%`, hardness `8%`, Stretch
  `18%`, Paint `14%`; size max `1024`; Count/opacity/blend mode/jitter
  nascosti e ignorati;
- Undo/Redo: batch discriminati, carrier resettato a ogni azione, identità
  Shape/Grain verificate al replay.

### Drenaggio a budget di pixel

I vecchi tetti per size (8 batch/frame per size ≤256, ecc.), copiati dal
sidecar WebGL, limitavano il tratto a ~`48 px`/frame a size `100`: a zoom fit
sul layer `4096²` il dito li supera facilmente e la coda accumulava ritardo
visibile (run `#76`: input `6,8 s`, coda `17 s`). Ora la selezione per frame
usa `DRY_BLEND_FRAME_PIXEL_BUDGET = 24_000_000` con costo per batch
`readRect × 2` e tetto `DRY_BLEND_MAX_BATCHES_PER_FRAME = 256`;
`submitBlendImmediate` spezza in chunk da `renderer.maximumBatchesPerSubmit`.
FIFO, planner e pixel invariati.

### Renderer compute v3 (`dry-blend-webgpu-v3-compute-fused-sweep`)

Il renderer v1/v2 usava 5 render pass per segmento: con centinaia di segmenti
per frame il collo di bottiglia era l'overhead CPU dei pass (GPU sotto al 5%).
Il v3 mantiene identico il modello del pigmento ma:

- raggruppa i segmenti consecutivi finché la ROI unita sta nello scratch
  `1664²`; per gruppo: **un** compute pass (un dispatch di gather + per
  segmento un dispatch di pickup `8×8` con riduzione workgroup e un dispatch
  di deposit sulla writeRect) e **un** render pass di scatter gated sulla
  coverage unione;
- la mask swept è fusa nel deposit: coverage inline con antialias analitici
  (compute non ha `fwidth`): bordo cerchio `1,6/radius`, gate spacing `1,0`,
  gradienti grain analitici per mip/`textureSampleGrad`;
- stato scratch in storage buffer `vec4<f32>` con stride fisso (~`44,3 MiB`) +
  coverage `f32` (~`11,1 MiB`) azzerata dal gather; deposit read-modify-write
  in place, niente ping-pong; dentro un gruppo lo stato resta float pieno
  (meno riquantizzazioni `rgba8unorm` rispetto al v1);
- carrier = ring di `4096` slot in un buffer; il segmento `i` legge lo slot
  corrente e scrive il successivo; `beginStroke` azzera cursore e validità.

Avvertenze per le prossime run: `passCount` ora conta `2` pass per gruppo (+
eventuale clear) e **non** è confrontabile con i conteggi a 5 pass;
`largestBatchStamps` può arrivare a `256`; l'utilizzo GPU del Blend resta
basso anche a regime (pochi Mpx/frame) e non è un indicatore di regressione.
Confronto con `#76`; non dichiarare WebGPU più veloce del WebGL senza misura.
Verifiche fatte: `npm run blend:verify` (assert su budget/chunking/pickup),
TypeScript, avvio senza errori WGSL, tratto funzionante su NVIDIA Ampere;
l'utente conferma sul desktop che il tratto ora segue il puntatore. Manca la
run iPhone canonica del v3.

### Ciclo di vita dello scratch (sperimentale, da validare)

`DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY =
"allocate-on-tool-select-release-when-idle-deselected"` (telemetria rev `39`):
lo scratch (~`52,9 MiB`: state `42,25` + coverage `10,56` + carrier e uniform
`128 KiB`) non resta più residente per sempre dopo il primo tratto Blend.

- Allocazione spostata dal primo tratto alla **selezione dello strumento**
  (`prewarmScratch` in `setBrushSettings`): l'eventuale costo driver cade sul
  click UI, mai a metà pennellata.
- Rilascio (`maybeReleaseIdleBlendScratch`) solo quando **tutte** queste
  condizioni valgono: tool ≠ blend, nessun tratto attivo, coda
  `pendingBlendBatches` vuota, nessun replay in corso. Chiamato al cambio
  strumento e in coda a `renderFrame` (copre i cambi arrivati durante un
  tratto e la riallocazione fatta dal replay Undo/Redo con tool Paint).
- Il replay Undo/Redo rialloca da solo via `ensureScratchResources` e il
  frame successivo rilascia di nuovo se il tool è Paint. Pixel, planner,
  budget e FIFO invariati; cambia solo la residenza della memoria.
- **Avvertenza run**: la distinzione cold/warm cambia significato — "cold" ora
  è la prima run dopo una (ri)selezione dello strumento, e `scratchAllocated`
  parte già `true` al primo tratto. Non aggregare con run rev `≤38`.
- Da validare dall'utente: monitor a ~`0` MiB sulla riga Blend dopo il
  deselect, pacing invariato della prima pennellata dopo una riselezione,
  Undo/Redo di tratti Blend con tool Paint selezionato.
- Il gemello per lo storage Light/M1 Glaze (stessa rev `39`) è documentato
  nella sezione Paint. Effetto combinato: i due pool grossi non idle non
  restano mai residenti insieme — selezionare il Blend libera il glaze e
  viceversa.
- Rotazione vista (candidato del 27 luglio 2026): il gesto a due dita combina
  pan, pinch e rotazione attorno al centro delle dita; magnete a `0°` con
  ingresso `≤3°` e rilascio `>7°`, mantenendo separato l'angolo grezzo per
  poter uscire dallo snap senza salti. Desktop: pulsanti `−15° / 0° / +15°`
  e `R + trascina` per la rotazione libera. È una camera display-only: layer,
  stamp, ordine e blending non cambiano. Le quattro varianti display
  (permanent, tail, Light/M1 Glaze e style stack) applicano la stessa inversa;
  input pennello, pan/zoom ancorati, dirty rect e tip preview usano la
  trasformazione corrispondente. Il display uniform resta esattamente `48 B`:
  gli `8 B` prima usati da `layerSize` contengono `cos/sin`, mentre la misura
  `4096²` deriva dalle texture già collegate; nessuna nuova texture/buffer e
  delta memoria deterministico `0 B / 0 MiB`. Durante il gesto la cache
  screen-space fa rebuild completo; a vista ferma la dirty rect usa l'AABB dei
  quattro angoli ruotati. Telemetria rev `51`, con angolo firmato per run.
  Verificati round-trip/ancora/snap/ABI, tutte le suite statiche, TypeScript,
  build e runtime WebGPU locale (+15°, reset, layout 390 px, zero log errori).
  Restano prova percettiva touch/iPhone e misura pacing: nessun guadagno
  prestazionale dichiarato e candidato non ancora promosso dall'utente.

- Vista pixel raster (candidato locale del 29 luglio 2026): la pill in alto a
  destra mostra lo zoom reale della camera; da `581%` incluso passa a
  `581% · PIXEL` e tutti i soli ingressi raster mip `0` usano `textureLoad`
  nearest sul texel autorevole. Sotto soglia restano i sampler lineari e i mip
  correnti. Sono coperti livello permanent, coda spessore, Light/M1 Glaze,
  style stack con Traccia/Ombre/Smusso, superfici fuse e run raster del
  compositore misto. Testo e SVG continuano invece a essere ridisegnati come
  Slug/mesh WebGPU screen-space e non vengono pixelati. Strategia
  `display-only-nearest-raster-at-581-percent-v1`: solo presentazione, nessuna
  mutazione del documento, nuova texture/buffer o crescita memoria (`0 MiB`).
  Il badge usa floor sopra il `100%`, quindi non dichiara `581%` prima della
  soglia reale. La soglia è stata temporaneamente anticipata al `100%` durante
  la diagnosi del 1 agosto, ma l'utente l'ha rifiutata perché spostava il
  problema: quel tentativo è completamente ritirato. Runtime ricontrollato a
  `535%` senza PIXEL e `723% · PIXEL`, zero warning/errori WebGPU. Candidato
  non committato e non pubblicato su richiesta dell'utente.
- Fix alone fra Riempimento e Riferimento, candidato locale 1 agosto 2026. Due
  catture dello stesso bordo mostravano a `555%` una fascia scura e a
  `645% · PIXEL` nessun texel nero: sopra il `100%` il mip selezionato è ancora
  `0`, quindi non era una mipmap. La bilineare filtrava separatamente il giallo
  attivo e il nero coincidente sottostante, poi source-over ricomponeva due
  coverage già mediate. Il campione centrale osservato `[215,225,139]`
  coincide con il modello giallo `#EEFF00` sopra nero sopra bianco a coverage
  `0,5` (`[215,225,137]` teorico).
- Le nuove catture arancione/nero confermano la stessa causa: il PNG `645%`
  contiene texel reali `[224,39,0]`, `[188,31,0]`, `[137,20,0]`, mentre a
  `555%` compaiono componenti blu/grigie pur avendo entrambi gli estremi blu
  zero. Quel colore è impossibile interpolando il composito finale e prova che
  l'alpha filtrato separatamente lasciava trapelare lo sfondo.
- Strategia finale
  `lod0-edge-plus-final-stack-mips-compose-before-filter-v3`. Finché il LOD
  selezionato è `0` — quindi anche fra circa `50%` e `100%`, non soltanto in
  ingrandimento — i quattro texel coincidenti di active/below/above vengono
  composti per-texel e soltanto i quattro risultati premoltiplicati vengono
  interpolati. Il golden numerico passa da `[215,225,137]` alla transizione
  corretta `[247,255,188]`, senza mutare texture autorevoli, mask Fill, tile o
  history.
- Da mip logico `1` in poi, la piramide condivisa del livello attivo cambia
  contenuto in modo esplicito da `active-only` a `final-raster-stack`: il primo
  livello carica i quattro texel documento da merged below, active e merged
  above, esegue source-over nel loro ordine reale e poi media i quattro
  compositi. I mip successivi riusano lo stesso downsample esatto `2×2`. Il
  display usa un entrypoint dedicato che campiona quel risultato finale senza
  ricomporre i merged una seconda volta.
- Il primo gate v1 guardava soltanto il gradiente dell'attivo sopra un merged
  inferiore: non copriva il comune stack con Reference sopra il livello Fill.
  Il v3 continua a sommare `fwidth` di active, below e above, quindi rileva il
  bordo indipendentemente dall'ordine. Il candidato LOD `0` dipende soltanto da
  uniform (almeno due superfici, sotto PIXEL e merged `1×`): le derivate vengono
  valutate in controllo uniforme prima di `insideLayer`; nei frame non
  candidati i sample restano dopo il reject del documento. Il vecchio gate
  `zoom >= 1` è stato rimosso: non forza mip `0`, perché il percorso resta
  vincolato a `selectedMipLevel < 0.5`; quando il selettore passa davvero a mip
  `1`, entra la piramide final-stack.
- Nessuna texture o buffer aggiuntivo e delta memoria permanente conteggiata
  `0 MiB`: viene riusata la piramide già residente (`21,3 MiB` RGBA8 o
  `42,7 MiB` RGBA16F). Esistono una pipeline e un bind group nuovi; a zoom
  ridotto il pass composito sostituisce il vecchio primo downsample active e
  permette di saltare i mip separati merged, quindi non aggiunge pass alla
  catena diretta e può eliminarne uno o due. Il mode switch invalida piramide e
  cache atomicamente. Mixed scene, vettori, thickness tail, glaze live e style
  stack conservano `active-only`, evitando duplicazioni o riordini.
- QA browser locale NVIDIA Ampere, stesso SVG raster Reference: Fill verde sul
  raster sotto e sul raster sopra, osservato a `161%`, `119%`, `88,5%`,
  `48,6%` (mip `1`) e `19,7%` (mip `2`), senza il salto/aloncino prodotto dal
  filtraggio separato. Una sottile scuritura verde esattamente sotto un texel
  nero antialiasato del Reference superiore resta corretta source-over e non va
  cancellata: per alpha nero `25/50/75%` il verde sRGB atteso è circa
  `225/188/137`.
- Nella stessa QA, un Fill magenta eseguito direttamente sul raster seed del
  Reference viene ora annullato ripristinando il nero originale e rifatto con
  Redo ripristinando il magenta; i pulsanti conservano lo stato corretto. La
  causa era la presentazione del clear prima della reidratazione seed: il clear
  è ora sempre nascosto e, nel caso seed-only, dopo hydration passa una sola
  presentazione autorevole con invalidazione mip/effetti/cache.
- Compilazione runtime WebGPU pulita; il verifier vincola ordine uniforme,
  composizione prima del filtro, content-mode, primo mip final-stack e replay
  seed-only. TypeScript, tutte le sedici suite `*:verify`, `git diff --check` e
  build Vite production con preparazione Sites verdi. Nessun benchmark iPhone:
  non dichiarare impatto prestazionale nullo o vantaggio misurato. Candidato
  locale non committato e non pubblicato.
### Ricerca empirica del limite memoria iPhone (diagnostica pubblicabile)

- Il limite Safari/iOS non è una costante per modello: il jetsam è un limite
  morbido di processo e varia anche con la pressione di memoria del sistema.
  Non usare quindi un numero trovato online come soglia di prodotto; misurare
  l'iPhone reale e mantenere poi margine rispetto all'ultimo punto sicuro.
- Query isolata `?iphoneMemoryLimitTest=1`, distinta dallo stress storico
  `?layerMemoryStressTest=1`. È abilitata solo dalla query esplicita e non
  modifica sessioni normali. Richiede pagina nuova, RGBA8, un livello vuoto ed
  effetti disattivati.
- Scala reale rev `1`: `15` aggiunte fino al cap di `16` livelli; quattordici
  livelli uscenti conservano `224/256` tile (`56 MiB`) e uno `192/256`
  (`48 MiB`), totale cold `3328` tile / `832 MiB`. Il livello finale viene
  armato a `192` tile, poi il test seleziona automaticamente centro e cima.
- Prima e dopo **ogni** aggiunta, arm e cambio livello viene salvato l'intero
  checkpoint in D1 tramite `/api/iphone-memory-limit-runs`; `runId` resta
  anche nell'hash URL e in storage locale. Se Safari termina la pagina,
  l'ultimo record server conserva già valore sicuro e operazione tentata; alla
  riapertura una run ancora `running` diventa `interrupted`. Il risultato è
  interrogabile dal progetto senza copia manuale dell'utente.
- Verifica locale NVIDIA Ampere del 27 luglio 2026, query local-only: `16`
  livelli, stabile finale `1010,030 MiB`, picco aggiunta finale `1074,030 MiB`;
  cambio cima→centro stabile `1087,364 MiB`, picco `1207,364 MiB`; ritorno in
  cima stabile `1010,030 MiB`, picco `1143,364 MiB`. Tutte le `18` operazioni
  completate, `36` eventi ordinati, tile cold effettivi `3328/3840`; reload
  completo ha ripristinato automaticamente il report completato.
- Prima run iPhone reale del 27 luglio 2026: iPhone 15, iOS `18.7`, Safari
  `26.5`, DPR `3`, viewport `365×364`, GPU `apple`. L'harness rev `1` ha
  completato le aggiunte fino a `7` livelli (`515,539 MiB` stabili,
  `579,539 MiB` massimo conteggiato) e alla riapertura ha classificato la run
  `interrupted` durante l'aggiunta del livello `8`. Questa classificazione
  prova soltanto che una run rimasta `running` non ha scritto il checkpoint
  successivo: non distingue jetsam, reload/navigazione, device loss, errore o
  altra terminazione e quindi non misura da sola un limite di memoria.
- Controprova manuale dell'utente sullo stesso iPhone: l'applicazione è rimasta
  viva a `818,8 MiB` logici conteggiati e la chiusura è stata trovata soltanto
  intorno a `1000 MiB`. Il pannello a `818,8 MiB` mostrava `1` layer hot da
  `64,0 MiB`, `2057/2304` tile cold da `514,3 MiB`, raw layer effettivi
  `578,3 MiB`, mip attivo/superfici fuse `42,7 MiB` e mip `0` fusi `64,0 MiB`.
  Questo smentisce il confine precedentemente inferito
  `579,539–635,539 MiB` e invalida la proposta derivata di un tetto
  `450–500 MiB`; entrambi sono ritirati.
- I circa `1000 MiB` sono il punto di chiusura empirico della sessione e del
  dispositivo provati, non un budget sicuro né una costante iOS. Il budget di
  prodotto dovrà mantenere margine sotto questo punto e coprire anche i picchi,
  non soltanto il valore stabile della pill.
- L'harness rev `1` alloca, copia e distrugge grandi texture a gradini separati
  da soli `900 ms`. Il monitor sottrae subito una risorsa dopo
  `GPUTexture.destroy()`, ma misura soltanto le dimensioni logiche create dal
  motore e non la memoria fisica ancora trattenuta da Safari/driver. La
  spiegazione principale da verificare per l'interruzione è quindi il churn
  rapido con rilascio fisico differito, non il working set stabile mostrato
  dalla pill. `waitForIdle`/`onSubmittedWorkDone()` prova il completamento FIFO
  dei comandi, non che WebKit abbia già restituito quella memoria al sistema.
- Risultato: la rev `1` è respinta come misura del limite stabile iPhone. Il
  prossimo protocollo deve separare (a) residenza stabile, con gradini lenti e
  intervalli lunghi, da (b) churn di aggiunta/cambio livello; deve inoltre
  registrare separatamente `device.lost`, errori JS/WebGPU, reload/navigazione
  e assenza di heartbeat, senza chiamarli tutti crash di memoria.
- Verifiche: suite layer/history/stroke/grain/blend/thickness/effects-scratch/
  bevel/shadow/view verdi, TypeScript e build Vite verdi; handler D1 verificato
  in memoria per lista vuota, insert, lettura per id, upsert e lista più recente.

### Studio compressione lossless dei livelli (measurement-only)

- Esperimento isolato del 27 luglio 2026, non ancora storage runtime. Query
  `?layerCompressionTest=1`, combinabile con lo stress livelli ma inerte nelle
  sessioni normali. Build
  `lossless-gzip-256-tile-1mib-streamed-measurement-v1`: legge soltanto gli
  array texture cold dei livelli inattivi, quattro tile `256²` per volta
  (`1 MiB` RGBA8), usa `CompressionStream("gzip")`, decomprime subito e
  confronta ogni byte. Se gzip è più grande conserva nella proiezione il raw;
  nessuna texture viene sostituita o distrutta.
- Il report distingue raw, gzip e storage adattivo, tempi encode/decode, tile
  zero/solid, fallback raw, hash sorgente/ripristinato, picco readback, working
  set logico del chunk e memoria GPU prima/dopo. In produzione viene salvato
  automaticamente in D1 tramite `/api/layer-compression-runs`.
- Prova browser locale NVIDIA Ampere: un livello inattivo da `45` tile /
  `11,25 MiB`, di cui `22` tile zero conservativi, misura
  `0,969521 MiB` adattivi (`−91,382%`, `11,604×`), encode `323,7 ms`, decode
  `57,9 ms`, elapsed `1151,6 ms`; hash `f3178e41` identico, readback massimo
  `1 MiB`, working set logico massimo `2,258756 MiB`, totale GPU invariato
  `189,280281 → 189,280281 MiB`. Cambio livello successivo riuscito in `88 ms`
  e zero warning/errori console.
- Il rapporto locale non è una previsione di prodotto: quasi metà dei tile del
  campione era realmente zero. Il caso deterministico incomprimibile produce
  `262244` byte gzip contro `262144` raw e attiva correttamente il fallback,
  quindi la proiezione non cresce mai. Serve la run sull'iPhone con contenuto
  pittorico reale prima di scegliere codec/cache o dichiarare memoria liberata.
- Verifiche verdi: undici suite
  (`stroke/grain/blend/thickness/history/layers/effects-scratch/bevel/shadow/view/compression`),
  TypeScript, build Vite, schema/migrazione D1 `0004` e handler D1 in memoria.
  Questa rev misura soltanto:
  l'esperimento successivo, se approvato dai dati iPhone, sarà l'eviction
  reversibile di un singolo livello lontano con verifica byte-identica.
- Pubblicazione Sites `83`, run D1 `#1` di controllo desktop end-to-end:
  `105` tile / `26,25 MiB` raw, di cui `49` zero, diventano
  `2,358823 MiB` adattivi (`−91,014%`); encode `394,3 ms`, decode `96,4 ms`,
  elapsed `1000,5 ms`, hash `a0a9ec15` identico, readback massimo `1 MiB`,
  working set logico `2,238097 MiB` e GPU conteggiata invariata
  `204,280281 → 204,280281 MiB`. Il report è stato salvato automaticamente e
  la console non contiene warning/errori. Anche questo campione contiene molti
  tile vuoti: non sostituisce la run pittorica reale su iPhone.
- Run iPhone D1 `#2` del 27 luglio 2026, Safari su iPhone / Apple GPU:
  cinque livelli, quattro cold misurati, `530` tile / `132,5 MiB` raw diventano
  `19,315562 MiB` gzip/adattivi (`−85,422%`, `6,860×`), zero fallback raw.
  I `161/530` tile zero valgono `40,25 MiB`; attribuendo conservativamente
  tutti i byte compressi ai restanti `92,25 MiB`, anche il solo contenuto
  non-zero risparmia almeno `79,06%` (`4,776×`). Encode totale `1783 ms`,
  decode `179 ms`, elapsed diagnostico `4973 ms`; per livello encode
  `117–668 ms`, decode `11–62 ms`. Tutti gli hash sono identici, readback
  massimo `1 MiB`, working set logico `2,294702 MiB` e GPU conteggiata
  invariata `437,077560 → 437,077560 MiB`.
- Decisione conseguente: l'encode non può stare nel percorso sincrono di cambio
  livello; il primo esperimento runtime comprimerà in background e libererà
  soltanto un singolo livello distante, mantenendo intatti i vicini. Il
  ripristino deve decomprimere e ricaricare prima della selezione, verificare
  byte/hash e mostrare separatamente GPU liberata e RAM CPU compressa.
- Primo candidato runtime implementato il 27 luglio 2026, ancora query-gated e
  non promosso: `?layerCompressionRuntime=1`, build
  `worker-gzip-one-distant-layer-idle-atomic-v1`. Dopo `1500 ms` idle sceglie
  al massimo un livello RGBA8 inattivo a distanza `>=2` dall'attivo; attivo e
  vicini restano raw. Legge quattro tile / `1 MiB` alla volta e trasferisce
  l'ownership dell'`ArrayBuffer` a un Web Worker, che esegue gzip, gunzip,
  confronto byte-per-byte e hash. Il thread principale fa soltanto readback e
  upload WebGPU; un gesto o una mutazione annulla l'epoch dopo il chunk in
  corso.
- L'eviction è atomica: il cold GPU resta autorevole finché tutti i chunk sono
  compressi e verificati, l'identità generazione/cold è ancora corrente e il
  motore è di nuovo idle. Se Worker o `CompressionStream` non sono disponibili
  prima dell'eviction, non esiste fallback sul main thread e i tile GPU restano
  intatti. Il ripristino conserva sempre una copia dei byte compressi mentre li
  trasferisce al worker, verifica lunghezza/hash per chunk e aggregati, carica
  una texture cold candidata e libera la RAM compressa soltanto dopo il fence
  GPU; un errore distrugge la candidata e conserva lo storage compresso.
- Telemetria rev `55`: la riga `Layer · compressi · RAM CPU` mostra i byte
  compressi ma resta esclusa dal totale GPU, come la Cronologia. La lista
  livelli mostra raw equivalente e RAM; la reidratazione conteggia anche la
  texture cold candidata durante il ripristino. Il raw liberato resta visibile
  separatamente e non viene sommato come residenza.
- Prova browser locale NVIDIA Ampere: tre livelli con due tratti reali; il
  livello distante è passato da `10,5 MiB` cold GPU a `0,8 MiB` RAM senza
  bloccare l'interfaccia. La selezione successiva lo ha ripristinato dal worker
  ed è terminata in `200 ms`; il disegno composito è rimasto visivamente
  invariato e la console non contiene warning/errori. Undici suite, TypeScript
  e build Vite verdi; il bundle worker è separato (`3,15 kB`). Questa non è
  ancora una prova iPhone né una promozione: il prossimo passo è pubblicare la
  query e misurare reattività, memoria stabile e costo del primo cambio su iOS.
- Esperimento isolato successivo del 27 luglio 2026, build
  `worker-gzip-one-distant-layer-transient-fold-v2`: un livello compresso usato
  soltanto per ricostruire le superfici fuse non viene più promosso a cold GPU
  permanente. Ogni chunk viene verificato dal worker e scritto direttamente
  nella singola texture hot transitoria già prevista dal fold; il fence unico
  per record copre upload, eventuali effetti e compositing, poi la texture viene
  distrutta. I byte compressi restano autorevoli e residenti in RAM. Soltanto
  la selezione reale del livello conserva il percorso di ripristino cold→hot e
  libera lo storage compresso dopo la pubblicazione.
- Prova browser locale NVIDIA Ampere: con tre livelli il distante è passato da
  `9,0 MiB` GPU a `0,7 MiB` RAM. L'aggiunta del quarto livello ha ricostruito il
  fold lasciando lo stesso livello marcato compresso, senza messaggio di
  ripristino e senza cold GPU persistente; zero warning/errori. Verifiche
  `compression:verify`, `layers:verify` e TypeScript verdi. Il limite di un solo
  livello compresso resta intenzionalmente attivo in questa run: la v2 isola
  esclusivamente la semantica del fold transitorio.
- Esperimento isolato multi-residenza del 27 luglio 2026, build
  `worker-gzip-multi-distant-layers-adjacent-raw-v3`: rimosso il solo limite
  globale a un compresso. Il selettore continua a scegliere un solo candidato
  e il worker continua a processare un solo chunk per volta, ma al termine
  pianifica il successivo livello raw a distanza `>=2`. Prima di pubblicare un
  cambio livello, l'attivo viene reidratato hot e i due adiacenti eventualmente
  compressi vengono riportati cold raw; tutti gli altri possono restare
  compressi attraverso il fold transitorio v2.
- Prova browser locale NVIDIA Ampere con sei livelli e cinque tratti reali:
  attivo `6`, vicino `5` raw `9,0 MiB`; livelli `1–4` compressi insieme da
  `7,5 + 8,8 + 9,0 + 8,8 = 34,1 MiB` GPU a circa `2,8 MiB` RAM. Selezionando
  il livello compresso `3`, lo switch è terminato in `383 ms`: `2` e `4` sono
  tornati cold raw, `3` hot, mentre `1` è rimasto compresso; dopo l'idle anche
  il distante `5` è stato compresso. Il pannello nel mezzo riporta due
  compressi (`16,5 MiB` raw → `1,4 MiB` RAM), cold GPU `17,5 MiB`, zero
  reidratazione transitoria stabile e zero warning/errori. Verifiche
  `compression:verify`, `layers:verify` e TypeScript verdi. Questa run isola
  la politica multi-livello; l'interruzione di un job al gesto resta quella v1
  e viene cambiata soltanto nell'esperimento successivo.
- Esperimento isolato pausa/ripresa del 27 luglio 2026, build
  `worker-gzip-multi-distant-resumable-stroke-pause-v4`, telemetria rev `56`.
  Il progresso di un livello (cold/generazione, chunk verificati, prossimo array
  layer, hash e byte) sopravvive al gesto. Il pointer-down cancella soltanto il
  timer idle: non incrementa l'epoch. Prima di ogni nuovo readback il main thread
  richiede motore idle; se il readback era già partito, il worker può terminare
  gzip/gunzip/hash, il risultato viene aggiunto al progresso e poi il job si
  ferma. Al lift un progresso esistente usa delay `0`, mentre un livello nuovo
  conserva i `1500 ms` idle. Add/switch/delete/settings continuano invece a
  invalidare epoch e progresso, perché possono cambiare identità o distanza del
  cold autorevole.
- La UI mostra `compressione · completati/totali tile verificati` e aggiunge
  `pausa tratto` mentre il dito è giù. I byte dei chunk parziali sono inclusi
  nella riga RAM CPU ma restano esclusi dal totale GPU; il cold GPU viene
  distrutto soltanto al commit atomico dell'intero livello.
- Prova browser locale NVIDIA Ampere sulla fixture stress da `256` tile: il job
  era visibile a `44/256`; durante un tratto mantenuto attivo ha terminato il
  chunk già acquisito e si è fermato a `76/256`, con status e badge
  `pausa tratto`. Dopo il lift il primo campione osservato era `124/256`, non
  `0/256`: i chunk completati non sono stati rifatti. Il livello ha poi concluso
  l'eviction e la sequenza multi-livello è proseguita; zero warning/errori.
  `compression:verify`, `layers:verify`, `grain:verify`, `view:verify` e
  TypeScript verdi. Resta da eseguire la matrice completa e la prova iPhone
  della build pubblicata prima di promuovere il runtime fuori dalla query.
- Validazione finale locale della build Vite v4: undici suite verdi
  (`stroke/grain/blend/thickness/history/layers/effects-scratch/bevel/shadow/view/compression`),
  TypeScript e build production verdi. Sul bundle esatto, sei livelli con cinque
  tratti hanno lasciato il `6` hot, il `5` vicino raw e quattro livelli
  compressi insieme. Aggiungere il `7` ha conservato tutti e quattro i
  compressi senza alcun ripristino. Selezionare il `3` compresso è terminato in
  `439 ms`: `2/4` raw adiacenti, `1/5` compressi distanti. Un tratto successivo
  ha conservato entrambi; zero warning/errori. La firma e i test sono pronti
  per la pubblicazione query-gated, non per l'attivazione di default.
- Pubblicazione Sites `85` riuscita il 27 luglio 2026. Smoke test sul bundle
  production: tre livelli, due tratti reali; il livello distante è passato da
  `9,0 MiB` cold GPU a `0,7 MiB` RAM e il pannello rev `56` è presente. Zero
  warning/errori console. Questa prova conferma packaging/worker in produzione,
  non sostituisce la prova iPhone di memoria e latenza.
- UX caricamento livelli richiesta il 27 luglio 2026: selezione di un livello
  diverso e creazione di un nuovo livello mostrano un overlay a schermo intero
  prima di avviare il lavoro. Due `requestAnimationFrame` garantiscono almeno
  un paint dell'indicatore; dopo `setActiveLayer` / `addLayer`, l'overlay resta
  fino a `waitForIdle()`, quindi copre texture hot, superfici fuse, effetti,
  presentazione del nuovo frame e completamento della coda GPU. Il `finally` lo
  rimuove anche sugli errori; il livello già attivo non produce un lampeggio.
  La prima pubblicazione Sites `87` usava uno sfondo pieno; l'utente l'ha
  rifiutata perché sembrava un ricaricamento dell'intera app. Il candidato
  successivo mantiene visibile il disegno con velo `rgba(9,11,15,0.38)`, blur
  screen-space transitorio di `3 px` e una piccola scheda semitrasparente per
  spinner/testo. Il blur è limitato al viewport e alla durata dello switch, ma
  appartiene al compositore WebKit e non è incluso nel monitor memoria del
  motore. Pixel, compressione e contabilità WebGPU non cambiano. Undici suite,
  TypeScript e build Vite production verdi; `layers:verify` vincola paint
  iniziale, attesa GPU, cleanup, stile non opaco e applicazione sia a switch sia
  ad add.

### Testo vettoriale misto ai livelli raster (prima prova locale, superata)

- Questa prima prova con un solo testo e un semplice ordine relativo al raster
  è conservata come misura storica. È stata sostituita nello stesso giorno
  dalla scena eterogenea descritta nella sezione successiva.
- Prototipo query-gated implementato il 27 luglio 2026 su
  `?vectorTextTest=1`; resta solo locale e **non è stato pubblicato**. Il nodo
  autorevole è semantico (`testo`, famiglia/font size, colore, posizione,
  scala, rotazione e ordine relativo) e non possiede una texture documento
  `4096²`. Canvas2D rasterizza di nuovo soltanto la vista corrente in una cache
  transitoria; editing, zoom, pan e rotazione sono coalesciati a un upload per
  `requestAnimationFrame`.
- La cache GPU è `rgba8unorm-srgb` viewport-size con
  `COPY_DST | RENDER_ATTACHMENT | TEXTURE_BINDING`; un display shader dedicato
  compone in premoltiplicato `mergedBelow → testo → raster attivo →
  mergedAbove` oppure `mergedBelow → raster attivo → testo → mergedAbove`.
  Il primo smoke test ha scoperto una texture sempre trasparente: mancava
  `RENDER_ATTACHMENT`, richiesto da `copyExternalImageToTexture`. Il flag è
  stato aggiunto e `vector-text:verify` lo vincola esplicitamente.
- Smoke test WebGPU su NVIDIA Ampere, viewport `988×860`: cache testo GPU
  `3,24 MiB`, due backing Canvas2D logici `6,48 MiB` gestiti dal browser e totale GPU
  conteggiato a effetti off `95,9 MiB`. Il costo GPU del testo dipende quindi
  dal viewport e non dal numero di pixel del documento; un layer RGBA8
  `4096²` resterebbe `64 MiB`. I backing Canvas2D sono dichiarati nel pannello
  del prototipo ma, correttamente, non sommati al contatore WebGPU; la loro
  residenza fisica CPU/GPU resta opaca al browser e non viene dichiarata.
- Prova di ordine reale: un disco blu sul raster attivo ha coperto il testo in
  modalità `below-active`; cambiando a `above-active`, i glifi hanno coperto il
  disco. Con un secondo livello, il precedente è diventato cold
  (`20/256` tile, `5,0 MiB`), il nuovo è rimasto full `64 MiB`, il testo è
  rimasto `3,24 MiB` e il totale conteggiato è stato `186,3 MiB`. Un secondo
  disco sul nuovo attivo ha confermato la sequenza raster–testo–raster.
  Due incrementi di zoom e una rotazione vista di `15°` hanno mantenuto cache
  e maniglie allineate.
- Il timer del controller (raster Canvas2D + richiesta upload + overlay, non
  tempo GPU) ha mostrato `0,4–0,5 ms` negli aggiornamenti fermi, p95
  `2,7 ms` nella breve sequenza interattiva e un singolo aggiornamento a
  `4,1 ms` dopo zoom/rotazione. Sono misure desktop esplorative, non una run
  canonica e non autorizzano conclusioni su iPhone.
- Limiti intenzionali del candidato: un solo nodo dimostrativo, ordine
  relativo al raster attivo e nessuna persistenza nel modello eterogeneo della
  pila. Il percorso dedicato è attivo solo con style stack raster e tail
  transitorio spenti; Traccia/Ombre/Smusso, Light/M1 Glaze live, font
  incorporati, shaping/outlines espliciti, undo del nodo, più nodi e worker
  `OffscreenCanvas` restano da integrare. La sorgente resta semantica e viene
  rerasterizzata a ogni scala, ma questo non è ancora il renderer testo
  production.
- Verifiche verdi: `vector-text:verify`, `view:verify`, `layers:verify`,
  `compression:verify`, `history:verify`, `effects-scratch:verify`,
  `stroke:verify`, `grain:verify`, `blend:verify`, `thickness:verify`,
  `bevel:verify`, `shadow:verify`, TypeScript e build Vite production. La
  build è stata generata soltanto in locale; nessuna versione Sites è stata
  salvata o distribuita.

### Scena eterogenea raster/testo vettoriale (candidato locale)

- Correzione architetturale richiesta dall'utente il 27 luglio 2026, sempre
  query-gated da `?vectorTextTest=1` e **non pubblicata**. La strategia
  `heterogeneous-bottom-up-raster-text-single-selection-monotonic-ids-v1`
  mantiene un unico stack ordinato di riferimenti `raster:N` e nodi
  `text:N`. Il raster continua a essere autorevole nel `LayerStack` esistente;
  ciascun testo è invece un oggetto semantico distinto con contenuto, font,
  dimensione, colore, trasformazione, visibilità, opacità e posizione nello
  stack. Testo e pennello non condividono pixel né journal Undo/Redo.
- Esiste una sola selezione della scena. Se è raster, i controlli testo sono
  disabilitati, l'overlay di trasformazione è realmente `display:none` e il
  pennello riceve gli eventi. Se è testo, il canvas di interazione intercetta
  soltanto spostamento/scalatura/rotazione e `beginStroke` possiede anche un
  guard nel motore. Prova desktop reale: un gesto sul raster ha prodotto
  `2663` stamp; lo stesso tipo di trascinamento dopo la selezione del testo ha
  lasciato il contatore a `2663`. L'eliminazione del testo selezionato torna
  atomicamente al raster e sincronizza sia controlli sia messaggio UI.
- La UI permette più testi, aggiunta, eliminazione, visibilità, opacità e
  riordino sopra/sotto i raster nello stesso elenco. Verificati localmente due
  testi separati, ordine `testo → testo → raster`, poi
  `testo → raster → testo`, selezione di ogni tipo ed eliminazione del secondo
  testo. Nessun warning o errore console/WebGPU.
- Il testo selezionato usa una sola cache live `rgba8unorm-srgb` grande quanto
  il viewport. I testi non selezionati vengono piegati in ordine nelle
  superfici fuse già previste sotto/sopra il raster attivo tramite **un'unica
  patch sRGB limitata ai glifi**, riutilizzata sequenzialmente: non esiste una
  texture `4096²` per ogni testo. `copyExternalImageToTexture` richiede
  `COPY_DST | RENDER_ATTACHMENT | TEXTURE_BINDING`; il flag
  `RENDER_ATTACHMENT` è vincolato dal verifier perché Chromium altrimenti
  copia una patch trasparente.
- Il primo cambio selezione restava bloccato dopo che fold e mip erano già
  conclusi: Chromium non completava `popErrorScope` con una copia da canvas
  racchiusa in uno scope WebGPU di lunga durata. Ora la transazione copre
  soltanto l'allocazione della superficie; fold, fence e mip vivono fuori
  dallo scope e distruggono esplicitamente il candidato in caso di errore.
- Misure desktop NVIDIA Ampere, viewport `988×860`, RGBA8 ed effetti spenti:
  testo selezionato `96,0 MiB`; un solo lato statico `178,0 MiB`; un testo
  selezionato più un altro statico sullo stesso lato `181,3 MiB`; testi statici
  presenti sia sotto sia sopra il raster `263,4 MiB`. La cache live vale
  `3,26 MiB` e il picco della patch condivisa osservato `3,03 MiB`. Aggiungere
  testi sullo **stesso lato** non aggiunge una superficie full-document per
  testo; occupare entrambi i lati richiede però due superfici fuse complete.
  Questa seconda superficie è il rischio memoria ancora aperto per iPhone e
  deve essere il prossimo esperimento isolato prima delle ombre testo.
- Verifiche finali verdi:
  `mixed-scene:verify`, `vector-text:verify`, `layers:verify`,
  `stroke:verify`, `grain:verify`, `blend:verify`, `thickness:verify`,
  `history:verify`, `effects-scratch:verify`, `bevel:verify`,
  `shadow:verify`, `view:verify`, `compression:verify`, TypeScript e build
  Vite production. Non sono ancora implementati effetti/ombre del testo,
  font incorporati, persistenza documento o Undo/Redo semantico del testo;
  non è stata eseguita alcuna prova iPhone e non è stata salvata o distribuita
  alcuna versione Sites.
- Fix deadlock aggiunta raster del 28 luglio 2026. Riprodotto nel browser
  locale: il nuovo record e il cold uscente comparivano correttamente
  (`Livello 2` attivo, `Livello 1` cold anche con `256` tile), ma overlay e
  controlli restavano bloccati oltre `10 s`, senza warning/errori WebGPU.
  L'ultima fase raggiunta era l'ingresso nel retarget del banco effetti.
- Root cause: `prepareActiveLayerForSwitch()` evacuava l'hot uscente e poneva
  `layerPresentationFrozen = true`; subito dopo il ramo scena mista chiamava
  `clearVectorTextPresentation()`, che impostava `displayDirty` e richiedeva un
  frame. Il frame congelato usciva intenzionalmente senza pulire `displayDirty`,
  mentre il retarget successivo entrava in `waitForIdle()`: entrambe le parti
  aspettavano per sempre una condizione che non poteva cambiare.
- Correzione isolata: selezione e partizione del nuovo raster continuano a
  essere aggiornate prima dell'attivazione, ma la texture live del testo viene
  rilasciata soltanto dopo che `activateLayer()` ha ricostruito i lati statici
  e sbloccato la presentazione. Il rollback conserva così anche la preview
  precedente. `layers:verify` vincola esplicitamente questo ordine.
- Prova browser post-fix: aggiunta a documento vuoto terminata in `218 ms`;
  dopo un tratto reale, aggiunta successiva terminata in `80 ms`, con il
  precedente correttamente cold su `90` tile. Overlay chiuso, controlli
  riabilitati e zero warning/errori. Tredici suite, TypeScript e build Vite
  production verdi. Misure esplorative desktop, non benchmark prestazionale;
  nessuna pubblicazione Sites.
- Fix trasformazioni testo del 28 luglio 2026. Il ridimensionamento, e per la
  stessa causa anche spostamento/rotazione, applicavano soltanto il primo
  piccolo delta del gesto. `updateVectorTextNode()` pubblica correttamente una
  nuova snapshot dopo ogni `pointermove`; `MixedVectorTextController.syncScene`
  azzerava però incondizionatamente `activeInteraction`, quindi tutti gli
  eventi successivi dello stesso pointer venivano ignorati.
- La sincronizzazione conserva ora il gesto quando `selectedKey` identifica
  ancora esattamente `text:${startModel.id}`. Cambio selezione, eliminazione o
  altra modifica strutturale continuano ad annullarlo e a rimuovere le classi
  di cursore. Il rapporto di scala resta ancorato a modello e distanza
  catturati al `pointerdown`, senza accumulo incrementale.
- Prova browser locale: dal reset `360 px`, un drag multipunto della maniglia
  sud-est ha portato il riquadro da circa `170` a oltre `520` CSS px di
  larghezza, seguendo l'intero percorso; il reset successivo ha ripristinato
  posizione, scala e rotazione iniziali. Memoria conteggiata invariata a
  `95,9 MiB`, zero warning/errori. `vector-text:verify` vincola la conservazione
  dell'interazione e l'assenza del vecchio reset incondizionato; scena mista,
  livelli e TypeScript verdi. Nessuna pubblicazione Sites.

- Fix inserimento raster sopra la selezione del 28 luglio 2026. Riprodotto il
  bug con `Testo 1` selezionato: l'elenco top-down diventava
  `Testo 1 → Livello 2 → Livello 1`, perché `addLayer()` ancorava la scena
  mista all'ultimo raster attivo e ignorava la selezione eterogenea.
  `MixedSceneStack` usa ora la strategia
  `heterogeneous-bottom-up-raster-text-single-selection-selected-insertion-v2`:
  `addRasterAboveSelection()` inserisce subito dopo l'unico item selezionato,
  sia esso testo o raster, quindi il risultato reale è
  `Livello 2 → Testo 1 → Livello 1`.
- La verifica memoria separata ha confermato che il full-canvas visibile con il
  testo selezionato non è una duplicazione: `64,0 MiB` sono l'unico mip `0`
  autorevole del raster di lavoro, `21,3 MiB` i suoi mip e `2,9 MiB` la cache
  testo viewport; superfici fuse `0 MiB`, totale locale `95,2 MiB`. Evacuare il
  raster richiederebbe una materializzazione equivalente per mostrarlo e una
  reidratazione al ritorno al pennello, senza risparmio stabile. La UI lo chiama
  quindi «raster di lavoro» e dichiara che il pennello è sospeso mentre resta
  selezionato il testo.
- Prova browser post-fix: aggiunta completata in `168 ms`, overlay chiuso,
  nuovo raster selezionato immediatamente sopra il testo e zero warning/errori.
  Il totale successivo `177,7 MiB` include la superficie statica necessaria a
  comporre il testo sotto il nuovo raster attivo; non è stato usato come
  benchmark. Tredici suite (`stroke`, `grain`, `blend`, `thickness`, `history`,
  `layers`, `effects-scratch`, `bevel`, `shadow`, `view`, `compression`,
  `vector-text`, `mixed-scene`), TypeScript e build Vite production verdi.
  Nessuna pubblicazione Sites.

- Fix click intermittenti sui livelli del 28 luglio 2026. Misura browser
  pre-fix sul raster e sul testo: durante `1,1 s` di refresh il pulsante restava
  abilitato, ma il primo figlio sotto il puntatore veniva rimosso
  (`sameChild: false`, `originalStillConnected: false`). `updateStats()` gira
  ogni `500 ms` e i due renderer svuotavano `.layer-select` per ricreare nome e
  hint; se il refresh cadeva fra `pointerdown` e `pointerup`, il browser poteva
  annullare il click nativo.
- `createLayerRow()` crea ora una sola volta i due span stabili; sia la scena
  raster/testo sia la lista raster aggiornano solo testo e attributi. Le righe
  vengono sostituite soltanto quando cambia davvero la struttura o l'ordine
  dello stack. La stessa correzione copre il click sintetizzato dal touch, ma
  non è ancora stata eseguita una prova fisica su dispositivo touch.
- Prova browser post-fix: nome e hint di raster e testo sono rimasti gli stessi
  nodi connessi attraverso più refresh; `16/16` click alternati raster↔testo
  hanno prodotto ogni volta `aria-current=true` solo sul bersaglio. Zero
  warning/errori. Il verifier testo vincola l'assenza di ricostruzione dei nodi;
  tredici suite, TypeScript e build Vite production verdi. Nessuna
  pubblicazione Sites.
### Traccia testo parametrica (candidato locale)

- Implementazione del 28 luglio 2026, query-gated da `?vectorTextTest=1` e non
  pubblicata. Ispezione effettuata esclusivamente nella pagina Kittl aperta:
  sul testo selezionato `Outline Width` usa il dominio `0–100`; `Text
  Decoration` è una famiglia distinta di righe/tagli e non va confusa con il
  contorno. Kittl non espone nel pannello corrente la forma delle giunzioni. Il
  progetto Kittl è stato ripristinato allo stato iniziale dopo l'ispezione.
- Strategia locale
  `canvas2d-glyph-stroke-shared-bounded-patch-zero-extra-gpu-storage-v1`.
  Ogni nodo testo conserva `outlineWidth`, `outlineColor` e `outlineJoin`;
  larghezza `0–100 px`, con tre giunzioni richieste: `bevel` («Squadrata»),
  `miter` («A punta») e `round` («Tonda»). Il miter limit è `4`: conserva le
  punte usuali e pone un limite deterministico ai picchi patologici.
- La traccia è rasterizzata analiticamente con `strokeText` prima di `fillText`.
  Il valore UI descrive la parte esterna visibile, quindi il line width Canvas2D
  è il doppio. Il testo selezionato riusa la cache viewport esistente e viene
  rirasterizzato alla risoluzione dello schermo anche allo zoom; i testi statici
  riusano l'unica patch sRGB ritagliata ai glifi, ampliata conservativamente per
  width/join e poi piegata nella superficie fusa esistente. Nessuna texture,
  buffer o superficie GPU viene aggiunta dalla traccia.
- Lifecycle CPU aggiunto dopo la misura: il canvas nasce `1×1`, eliminando
  anche il default browser `300×150` (`0,17 MiB`), e viene riportato a `1×1`
  appena il fold ha terminato copia e fence GPU, anche su errore di copia o
  texture, senza invalidare `lastPatchBounds` e senza trattenere il backing del
  picco. Nel caso reale `STREETWEAR`, `360 px`, miter `40 px`, il picco GPU
  necessario è `6,4 MiB` e torna subito a `0`; il canvas CPU condiviso passava
  da `6,44 MiB` residente a `0,00 MiB` dopo il rilascio.
- Prova browser NVIDIA Ampere: totale selezione testo `97,7 MiB` sia con traccia
  OFF sia con miter `40 px`; cache testo `4,13 MiB`, quindi GPU aggiuntiva
  persistente `0 MiB`. Al Fit, dopo un run pulito, ultimo render `0,70 ms` e p95
  `0,90 ms`; il controllo a forte zoom è rimasto nitido. Selezionando il raster,
  la composizione statica conserva correttamente la traccia e misura
  `178,9 MiB`, totale che include la superficie fusa già prevista; tornando al
  testo rientra a `97,7 MiB`. Misure esplorative, non benchmark prestazionale.
- Zero warning/errori browser. Tredici suite, TypeScript e build Vite production
  verdi. Le tre forme sono state provate con mouse; nessuna prova touch/iPhone e
  nessuna pubblicazione Sites.
### Testo semantico viewport dopo ispezione JSON/canvas Kittl

- Revisione del 28 luglio 2026, query-gated da `?vectorTextTest=1`.
  La pagina Kittl già aperta è stata ispezionata senza ricerca web e
  senza leggere cookie/storage: il progetto usa due canvas Fabric viewport
  (`lower-canvas` e `upper-canvas`) entrambi `968×912`, dimensione invariata fra
  zoom `41%` e `800%`. Il bundle osservato dichiara Fabric.js `5.2.1`. I cinque
  JSON path pubblici caricati dalla pagina sono oggetti semantici con `type:
  "path"`, comandi geometrici `path`, dimensioni, fill/stroke, `strokeUniform`,
  `transform` e `pathOffset`; la richiesta JSON principale del design risponde
  `403` fuori dalla sessione, quindi non è stata inventata né dichiarata la sua
  struttura protetta.
- La precedente patch testo in coordinate documento e la relativa superficie
  adattiva sono state rimosse. Strategia corrente
  `semantic-text-dual-viewport-rgba8-srgb-cache-all-display-paths-v3`: il nodo
  CPU resta semantico e tutti i testi visibili vengono rirasterizzati con la
  trasformazione corrente in al massimo due cache `rgba8unorm-srgb` grandi
  quanto il viewport, una sotto e una sopra il raster attivo. La selezione usa
  soltanto il canvas di interazione; selezionato e statico condividono quindi
  gli stessi pixel. Nessuna texture testo `4096²`, nessun patch document-space
  e nessun rebuild dei raster a zoom/pan.
- Viewport NVIDIA Ampere `1258×860`: una cache testo misura `4,13 MiB`, entrambe
  `8,25 MiB`; i due backing Canvas2D logici misurano insieme `8,25 MiB`. Il
  totale default osservato è `97,7 MiB`. I `64,0 MiB` mostrati quando il testo è
  selezionato restano il solo mip `0` autorevole del raster di lavoro, non una
  copia del testo. A forte zoom i bordi del fill e della traccia restano
  rirasterizzati alla risoluzione viewport, mentre la scacchiera/raster conserva
  naturalmente i propri texel.
- Traccia testo corrente
  `canvas2d-glyph-stroke-semantic-viewport-zero-document-cache-v2`: width
  `0–100`, `bevel`/Squadrata, `miter`/A punta con limit `4`, `round`/Tonda.
  Prova reale width `24`: tutte e tre le forme hanno prodotto pixel distinti
  (`48.398`, `29.044` e `41.977` canali diversi nei tre confronti a coppie) e
  sono rimaste nitide ad alto zoom; selezionare il raster rimuove solo i
  controlli, non cambia la geometria.
- I compositori Traccia/Ombre/Smusso, Light Glaze live e coda spessore ora
  ricevono le stesse due cache testo e applicano l'ordine
  `mergedBelow → testo sotto → raster attivo → testo sopra → mergedAbove`.
  Prima del fix, attivare Traccia raster nascondeva il testo. Dopo il fix sono
  passate prove reali con Traccia raster ON (testo sia sopra sia sotto), un
  tratto Light Glaze e una pennellata con spessore finale `0%`; testo sempre
  visibile, zero warning/errori WebGPU. Totali esplorativi: Traccia `153,5 MiB`,
  Light Glaze `183,0 MiB`, coda dopo rilascio `100,2 MiB`; gli aumenti sono le
  risorse lazy degli effetti, la cache testo resta `4,13 MiB`. Non sono
  benchmark prestazionali.
- Inserimento reale: selezionando `Testo 1`, il nuovo `Livello 2` nasce
  immediatamente sopra quel testo e diventa attivo. Dodici alternanze con un
  solo clic raster↔testo hanno dato `12/12` `aria-current` corretti. La prova
  mouse non sostituisce ancora un test fisico touch/iPhone.
- Limite noto del candidato: le due cache preservano esattamente il rapporto di
  ogni testo con il raster attivo e coprono il caso d'inserimento richiesto; una
  sequenza arbitraria con più raster inattivi e più testi alternati sullo stesso
  lato richiederà un compositore segmentato prima di poter dichiarare parità
  completa con l'ordine oggetti di Kittl. Non dichiarare ancora questa parità.
- Verifica pre-pubblicazione: tredici suite (`stroke`, `grain`, `blend`,
  `thickness`, `history`, `layers`, `effects-scratch`, `bevel`, `shadow`,
  `view`, `compression`, `vector-text`, `mixed-scene`), TypeScript e build
  Vite production verdi. Il solo warning build è la dimensione del chunk già
  nota; revisione pronta per la pubblicazione Sites.
### Compositore segmentato raster/testo (candidato locale)

- Revisione del 28 luglio 2026. Questa sezione supera il limite del precedente
  compositore duale. Stack CPU
  `heterogeneous-bottom-up-raster-text-segmented-composition-selected-insertion-v3`
  e compositore GPU
  `ordered-raster-text-runs-rgba16f-viewport-source-over-v1`: l'ordine
  bottom-up del documento viene diviso in run contigui raster, raster attivo e
  run di testo, poi ricomposto nello stesso ordine con source-over
  premoltiplicato. La gerarchia visiva non dipende più dal raster attivo.
- I run raster inattivi restano superfici fuse ritagliate in coordinate
  documento; ogni run testo usa una cache `rgba8unorm-srgb` di solo viewport.
  L'accumulatore ordinato è un'unica texture viewport `rgba16float`, lazy e
  presente soltanto quando esiste testo. Il pass finale aggiunge scacchiera e
  conversione display. Non esiste alcuna texture testo `4096²` e il raster
  attivo autorevole resta l'unica voce full-canvas da `64,0 MiB` in RGBA8.
- Misura reale NVIDIA Ampere, viewport utile `1258×860`: caso comune con un run
  testo `12,38 MiB` GPU (`4,13 MiB` RGBA8 testo + `8,25 MiB` RGBA16F lineare);
  due run testo separati da un raster `16,51 MiB` (due RGBA8 + un RGBA16F).
  Sono misure di residenza logica, non un benchmark di velocità.
- Riproduzione del bug originale: ordine UI top-down
  `Testo 1 → Livello 2 → Livello 1`, pennellata blu su Livello 2. Il testo è
  rimasto sopra sia con Livello 2 attivo sia con Livello 1 attivo. Caso generale
  provato con ordine
  `Testo 1 → Livello 2 → Testo 2 → Livello 1`: Testo 1 è rimasto sopra la
  pennellata e Testo 2 sotto, invariati passando fra i due raster. A forte zoom
  i testi sono rimasti rirasterizzati e lisci.
- Inserimento verificato: con Testo 1 selezionato, Aggiungi livello raster ha
  prodotto esattamente `Livello 2 → Testo 1 → Livello 1`; il nuovo raster è
  attivo. Otto alternanze raster/testo con un singolo clic hanno dato `8/8`
  selezioni corrette; ulteriori alternanze fra i raster non hanno modificato
  l'ordine DOM né quello visivo.
- I pass active-only sono collegati a base, Traccia/Ombre/Smusso, coda spessore
  e Light Glaze. La prova browser ha trovato e corretto un errore WGSL reale:
  `fwidth` era chiamato dopo un ramo non uniforme nell'entrypoint active-only
  degli effetti; il campionamento derivativo viene ora calcolato prima del
  ramo, come nel pass canonico. Traccia e Light Glaze erano già stati provati
  con testo sovrapposto dopo il fix, senza perdita di gerarchia.
- Il dev server Vite che risponde `index.html` alla GET opzionale
  `/api/human-stroke` non genera più il falso errore JSON: una risposta 200 non
  JSON viene trattata come fixture assente. La UI mostra correttamente
  «Nessun tratto di riferimento».
- Verifica finale: tutte le tredici suite (`stroke`, `grain`, `blend`,
  `thickness`, `history`, `layers`, `effects-scratch`, `bevel`, `shadow`,
  `view`, `compression`, `vector-text`, `mixed-scene`), TypeScript e build Vite
  production verdi. Browser finale senza warning/errori console o WebGPU. Il
  warning build sul chunk principale oltre 500 kB resta quello noto e non è
  causato dalla gerarchia. Prova mouse desktop completata; nessuna prova fisica
  touch/iPhone, nessuna pubblicazione e nessuna dichiarazione prestazionale.

### Block Shadow vettoriale testo (candidato locale)

- Correzione richiesta dall'utente il 28 luglio 2026 dopo il rifiuto della
  prima sweep raster. Il riferimento autorevole non è una serie di copie del
  testo: è il core già approvato in `paint-webgpu-m1/geom/vector-shadow-3d.js`.
  Il file è stato portato senza modifiche con SHA-256
  `9A2676D7B510DAA9A01A95E7191409AFA2A48AA58198179A52071D63EE5F4FD0`;
  la strategia firmata è
  `paint-webgpu-m1-shadow3d-v2-single-extruded-vector-silhouette`.
- I glifi provengono ora da outline OpenType locali. `opentype.js 1.3.4`
  costruisce un solo PathData per testo; il core canonizza contorni esterni e
  buchi, spezza le curve soltanto ai cambi del lato esposto e aggiunge la
  geometria laterale verso il vettore offset/angolo. Canvas2D riempie quindi
  una sola `Path2D` vettoriale: nessuna sweep, nessun `fillText` ripetuto e
  nessun canvas/texture Block Shadow. Font locali inclusi: Anton, Bebas Neue e
  Poppins, con relative licenze OFL.
- Contratto UI del riferimento Kittl: default Block Shadow ON, colore
  `#727272`, opacità `100%`, Offset `23`, Angolo `-104°`, Outline Width `0`.
  L'offset è diretto in coordinate locali, non proporzionale al font. Il segno
  Y viene adattato soltanto fra angolo cartesiano e canvas.
- Vincolo esplicito dell'utente: Block Shadow è un effetto visivo e **non
  modifica bbox, maniglie, hit target o centro di trasformazione del testo**.
  Il verifier estrae `textCorners()` e vieta dipendenze da Block Shadow o
  outline. Prova browser ON/OFF: lo stesso rettangolo e le stesse quattro
  maniglie; l'ombra può estendersi fuori senza spostarle.
- `Outline Width` dell'ombra usa lo stesso valore diretto del core originale:
  il ramo stroke esiste soltanto per `> 0`; a `0` non viene impostata una
  larghezza minima, non viene raddoppiato il valore e non parte alcuno stroke.
  Browser verificato con output `0 px`, prova temporanea a `12 px` e ritorno a
  `0 px`, bbox invariata.
- Misura browser pulita, viewport `1280×668`: Block Shadow aggiunge `0 MiB`
  GPU e il PathData estruso corrente `STREETWEAR` pesa `11,6 KiB` CPU logici.
  La cache è una sola per nodo/stato e viene azzerata quando il toggle passa
  OFF; tornando ON viene ricostruita senza conservare le varianti precedenti.
  I tre file font precaricati pesano insieme `392.528 byte` (`0,374 MiB`) e
  sono condivisi da tutti i testi/effetti. Le due cache browser preesistenti
  restano `6,52 MiB` logici e le cache GPU testo+accumulatore `9,79 MiB`;
  `Path2D`, oggetti OpenType e backing fisici del browser non sono misurabili e
  non vengono stimati come memoria residente certa.
- Verifiche: tredici suite, TypeScript e build Vite production verdi. Build
  include i tre TTF (`61,40 + 160,31 + 170,81 kB`); il warning chunk oltre
  `500 kB` resta quello noto. Nuova scheda browser finale senza warning/errori
  console o WebGPU. Nessuna prova fisica touch/iPhone, nessuna pubblicazione e
  nessun commit di questo candidato.

### Ombra singola testo vettoriale (Canvas2D, candidata)

- Implementata il 28 luglio 2026 dopo confronto diretto con Kittl. Il modello
  mantiene una sola maschera offset, con colore, opacità, Offset `0–100`,
  Angolo `−180°…180°` e Blur `0–300`; Outline Width resta forzata e
  disabilitata a `0`. Il preset iniziale riproduce i valori osservati:
  `#727272`, `100%`, Offset `54`, Angolo `−180°`, Blur `6`.
- Strategia
  `paint-webgpu-m1-single-shadow-plan-roi-canvas2d-native-gaussian-v1`:
  rasterizza una sola silhouette in una ROI stretta dei glifi, applica il blur
  nativo Canvas2D sull'alpha e compone il testo sorgente nitido sopra. Non crea
  copie ripetute del nodo e non modifica la bbox semantica/selezionabile.
  Blur `0` usa direttamente il profilo vettoriale traslato e non conserva
  alcuna cache raster.
- Il planner e i limiti derivano dal prototipo locale
  `paint-webgpu-m1/geom/vector-shadow-blur-renderer.js`: supporto
  `blur × 3 + 1`, sigma massimo `8 px`, raggio kernel massimo `24 px`, ROI
  massimo `4M` pixel, texture massima `4096` e cache matte massima `32 MiB`.
  Uno scratch condiviso è limitato a `16 MiB`.
- Ombra singola e Block Shadow sono mutuamente esclusive. Disattivare l'effetto
  o portare Blur a `0` rilascia matte e scratch; cambiare solo offset, angolo
  od opacità riusa la maschera. Il costo appartiene alla cache logica del
  browser, non alle risorse WebGPU contate dal motore: `+0 MiB` GPU.
- Misure sul browser desktop corrente, viewport `1138×912`: Blur `6` in vista
  Fit usa `0,18 MiB` logici (`1` matte + scratch); ad alto zoom usa
  `1,97 MiB`. Blur `0` torna a `0,00 MiB`. Il confronto visivo affiancato con
  Kittl conferma una sola sagoma, bordo ammorbidito, nucleo pieno, sorgente
  nitida sopra e bbox invariata. Nessun warning/error in console.
- Verifiche del 28 luglio: tutte le `13` suite (`stroke`, `grain`, `blend`,
  `thickness`, `history`, `layers`, `effects-scratch`, `bevel`, `shadow`,
  `view`, `compression`, `vector-text`, `mixed-scene`), TypeScript e build
  Vite verdi. QA conservata in `design-qa.md`. Non ancora committata,
  pubblicata né provata su touch/iPhone.

### Scenario misto 800 MiB · testo/raster (benchmark rev 58)

- Limiti applicativi correnti, indipendenti dal dispositivo: massimo `64` nodi
  testo semantici (`VECTOR_TEXT_NODE_MAXIMUM`) e `16` livelli raster
  (`LAYER_STACK_MAXIMUM`). Non sono una promessa di fluidità: i testi contigui
  condividono una cache RGBA8 di viewport, mentre ogni run testo separata da un
  raster richiede una cache viewport distinta; lo zoom ridisegna inoltre tutti
  i glifi e le ombre visibili.
- Fixture query-gated `?mixedMemoryBenchmark=1`, strategia
  `mixed-raster-vector-64-text-nine-runs-counted-gpu-800mib-v1`: pagina nuova
  RGBA8, `64` testi visibili in griglia (`32` Block Shadow vettoriali e `32`
  Ombre singole Blur `6`, Outline Width sempre `0`), `9` run testo e raster con
  cold store reali fino a `800 MiB` GPU conteggiati. L'ultimo cold store viene
  regolato a tile da `0,25 MiB`; un raster finale vuoto resta attivo per la
  traccia canonica. Inserimento batch dei testi solo nella fixture, così la
  preparazione non paga 56 rebuild intermedi; ordine e rendering finali sono
  uguali alle normali aggiunte.
- Il replay umano usa nella sola fixture
  `resetActiveLayerForMemoryBenchmark`: pulisce esclusivamente il raster caldo
  di lavoro e la cronologia del replay, preservando cold raster, testi, cache e
  ordine. Il guard multi-layer di `resetDocument()` resta invariato nelle
  sessioni normali. La traccia, Count, size, spacing, flow, hardness, jitter,
  seed, stamp e blending non cambiano.
- Prova desktop NVIDIA Ampere del 28 luglio, stessa pagina e viewport fra il
  probe scarico e carico: `12` raster, `64` testi, `9` run; steady GPU
  `800,923 MiB`, picco transitorio setup `864,923 MiB`, canvas browser logici
  `7,631 MiB`, font+PathData noti `0,521 MiB`, working set logico noto
  `809,075 MiB`. Breakdown finale principale: raster attivo `64 MiB`, cold
  `663,25 MiB`, cache GPU testo `41,067 MiB`, mip `22,193 MiB`, superfici fuse
  `2,578 MiB`, cache schermo `3,733 MiB`.
- Probe zoom accoppiato (otto fattori identici, Fit ripristinato): CPU del
  renderer testo p95 `0,6→9,9 ms` (`16,5×`); completamento end-to-end fino a
  GPU idle p95 `25,1→163,8 ms` (`6,5×`). Lo scenario massimo resta modificabile
  e non genera errori, ma **non è fluido nello zoom** neppure sul desktop: usare
  questi limiti come stress/OOM envelope, non come budget consigliato.
- La rev `57` firmava working set totale, memoria testo GPU, conteggi
  scena/stili/run, memoria browser logica, baseline/carico zoom e rapporti di
  rallentamento. Le run benchmark rev `56` o precedenti non vanno aggregate con
  quelle misure esatte.
- Fallback zoom testo adattivo implementato il 28 luglio 2026, strategia
  `exact-until-frame-pressure-then-frozen-viewport-gpu-reprojection-idle-reraster-v1`.
  Il detector osserva soltanto i render esatti causati dalla vista: arma dopo
  due frame consecutivi con raster testo `≥20 ms` o end-to-end `≥36 ms`, oppure
  dopo un solo frame severo `≥40/60 ms`. Dal cambio vista successivo conserva
  le cache RGBA8 già presenti e le riproietta sulla GPU tramite le matrici di
  vista catturata/corrente; dopo `250 ms` senza input ridisegna una volta tutti
  i testi alla vista esatta e disattiva la riproiezione.
- Il percorso preciso e i suoi pixel restano invariati. Il modo rapido non crea
  copie dei nodi né nuove cache testo: aggiunge solo una uniform da `32 byte`.
  Durante il gesto usa però lo snapshot filtrato della viewport precedente e
  un'area appena rivelata fuori da quella viewport può restare trasparente fino
  al recupero esatto; l'HUD espone sempre `Zoom testo · preciso/rapido`.
- Il probe zoom canonico sospende esplicitamente il fallback, così continua a
  misurare il costo esatto ed è confrontabile con rev `57`. Sul desktop NVIDIA
  leggero, cinque cambi zoom consecutivi hanno dato ultimo render `0,30 ms`,
  p95 `0,50 ms` e zero attivazioni; nello stress `800,9 MiB` il renderer testo
  esatto è rimasto circa a p95 `12 ms`, quindi correttamente non si è attivato
  con le soglie production. Una prova controllata con soglie temporaneamente
  abbassate ha attraversato `preciso→rapido→preciso`, compilato ed eseguito il
  nuovo ramo WGSL e recuperato il raster esatto dopo idle; le soglie di test
  sono state subito ripristinate.
- La telemetria passa a rev `58` e aggiunge strategia, modo corrente,
  armamento, streak, attivazioni/recuperi e tempi trigger. Tutte le 13 suite,
  TypeScript e build Vite production sono verdi. La run fisica iPhone con il
  nuovo percorso vettoriale resta aperta. Il candidato di riproiezione bitmap
  descritto sopra è superato dal renderer seguente e non è più raggiungibile
  dal controller testo.

### Testo vettoriale GPU analitico + effetti Worker (candidato del 28 luglio 2026)

- Percorso corrente sempre vettoriale durante zoom e selezione: sorgente e
  ombra singola con Blur `0` usano Slug analitico per l'intero nodo; Traccia,
  Block Shadow e relativo outline sono insiemi canonici Clipper64 compilati in
  un Worker e triangolati con Earcut. Strategie firmate:
  `semantic-vector-gpu-runs-slug-clipper-msaa4-rgba16f-v6`,
  `webgpu-clipper64-worker-outside-offset-native-round-bevel-exact-miter4-v4`,
  `webgpu-clipper64-worker-visible-swept-union-separate-clipped-overlap2px-mesh-v8` e
  `webgpu-slug-zero-blur-or-r8-separable-gaussian-v2`.
- Il Blur dell'ombra singola non usa più Canvas2D: Slug genera una mask R8,
  due pass GPU eseguono il Gaussian separabile e la cache R8 viene composta
  premoltiplicata dietro il testo. La canvas di presentazione resta nascosta a
  `1×1`; Canvas2D sopravvive soltanto sull'overlay di hit-test/maniglie, mai
  come immagine del testo. Il depth/stencil testo inutilizzato è stato rimosso;
  fill, Slug e compositing blur usano MSAA `4×` e source-over premoltiplicato.
- LOD degli effetti dipende dal sigma reale vista×nodo. Esiste al massimo una
  richiesta Worker attiva; per ogni effetto resta solo l'ultima richiesta in
  coda e lo swap alla nuova mesh è atomico. Le mesh senza guardia screen-space
  già più fini servono anche lo zoom-out; Block Shadow, outline Block e outline
  sorgente separato richiedono invece il bucket esatto, perché la banda nascosta
  deve restare `1–2 px` fisici anche tornando da uno zoom alto. La mesh corrente
  rimane visibile mentre il Worker prepara quella corretta. Durante un tratto
  Paint non si sostituisce la mesh visualizzata. Non esiste più il fallback
  bitmap adattivo che poteva mostrare regioni vuote e completarle dopo il gesto.
- Robustezza geometrica verificata con NonZero/EvenOdd, outer+hole+island,
  contour sovrapposti e tangenti, bow-tie ad area algebrica zero, duplicati,
  quasi-collineari e curve quadratiche/cubiche a lunghezza zero. Le curve
  cubiche degeneri vengono scartate prima del packing Slug. `Outline Width 0`
  è un no-op vero e non invia job; ombre e outline restano esclusi dalla bbox
  semantica del testo.
- Prova browser finale con quattro nodi distinti: `STREETWEAR` con Block Shadow
  e outline `0`; `BOLD 8@` con Traccia bevel `18` e ombra singola Blur `18`;
  `ÁRCADE` con Traccia miter `12`, Block Shadow `40` e outline ombra `8`;
  `O R A` con ombra singola netta Blur `0` e Traccia `0`. A zoom Fit e
  ravvicinato, curve, fori, miter/bevel e lati dell'estrusione risultano continui
  senza seam o linee parassite. Screenshot in `artifacts/vector-text-*.png`.
- Stress interattivo locale: `24` eventi zoom alternati in sei raffiche e
  trascinamento Paint avviato subito dopo l'ultimo evento. Il frame catturato
  conserva tutti e quattro i testi completi e il nuovo tratto; indicatore
  `Zoom testo · vettoriale GPU`. Dopo lo stress: Worker `0` in attesa, `0`
  errori, p95 renderer mostrato `2,0 ms`; il caso blur riporta `0,06 MiB` per
  una matte+scratch GPU. I `13,7 s` della sequenza includono l'overhead del
  controllo browser e non sono un benchmark di latenza. Nessun nuovo warning o
  errore console/WebGPU nell'intervallo della prova.
- Verifiche verdi: TypeScript, `vector-text:verify`, `mixed-scene:verify`,
  `view:verify`, `stroke`, `shadow`, `bevel`, `effects-scratch`, `grain`,
  `blend`, `thickness`, `layers`, `history`, `compression` e build Vite
  production. Il solo warning build è il chunk principale oltre `500 kB`, già
  noto. Il candidato GPU è nel commit `449fda1` ed è stato pubblicato come Sites
  `92`; l'utente ha confermato su iPhone che il testo GPU non presenta il lag
  precedente. La fixture automatica da `800 MiB` ha però chiuso Safari durante
  la preparazione, prima del report: il limite osservato include quindi il
  picco transitorio di setup e non misura il solo working set steady-state.

- Fix Block Shadow del 29 luglio 2026, dopo segnalazione visiva su sfondo
  scuro: il fill della mesh non conserva più la faccia sorgente completa sotto
  il riempimento Slug. Quel bordo coincidente, rasterizzato con coverage MSAA
  diversa, poteva far trapelare il colore dell'ombra sui lati posteriori con
  `Outline Width = 0`. Il fill usa la faccia traslata più le sole pareti esposte;
  l'unione completa resta per l'outline Block. Offset `0` non invia alcun draw
  nascosto, sia per testo sia per SVG.
- La seconda sonda, fill e shadow entrambi `#111111` su fondo rosso, ha isolato
  un distacco a `70°` con offset `100`: la prima guardia spostava verso l'interno
  gli estremi della parete lunga e la deformava, sottraendo due triangoli quando
  il vettore aveva componente tangenziale. La correzione finale conserva sempre
  la parete esatta e aggiunge separatamente una banda locale di `2 px` fisici,
  ritagliata con Clipper64 dentro il fill sorgente e poi unita alla mesh visibile.
  L'overlap è quindi solo nascosto: non sottrae geometria visibile, non esce
  dallo sweep completo e non modifica profilo esterno o bbox.
- Gli effetti con guardia screen-space accettano ora anche un bucket LOD più
  basso dopo lo zoom-out. La mesh più fine già visibile resta sullo schermo finché
  il Worker latest-only prepara la sostituzione atomica; durante Paint non viene
  sostituita. La sequenza `119%→723%→119%` mantiene così la guardia fisica senza
  reintrodurre tagli o fallback bitmap.
- La bbox semantica, le maniglie e l'hit-test restano quelli del sorgente; al
  preset `23 @ -104°` resta invariato anche l'inviluppo visibile dell'effetto.
  Il compilatore passa a `clipper64-nonzero-lod-worker-v10`, la strategia
  geometrica a
  `clipper64-nonzero-worker-native-round-bevel-exact-miter-aa-overlap-same-color-union-visible-block-separate-clipped-overlap2px-earcut-v10`
  e la Block Shadow a
  `webgpu-clipper64-worker-visible-swept-union-separate-clipped-overlap2px-mesh-v8`;
  le cache precedenti non possono riutilizzare la mesh difettosa.
- QA browser: `E` isolata e `STREETWEAR`, outline sorgente/Block `0`, offset
  `100`, angoli `-70/20/70/140°`, colori uguali e shadow grigia su rosso pieno,
  zoom `119%/217%/723%` anche in ciclo zoom-in/out; inoltre SVG semantico a due
  colori con `29` contorni e `850` comandi. Nessuna fessura sulle concavità e
  nessun alone sul lato posteriore. Il fondo rosso era temporaneo ed è stato
  rimosso. Il verifier impone ora `baseVisible − overlap = ∅` e
  `overlap − fullBlock = ∅` su otto direzioni, `70°/100`, hole e bbox. Tutte le
  13 suite, TypeScript e build production sono verdi; resta il solo warning noto
  del chunk oltre `500 kB`. Nessun commit e nessuna pubblicazione.

### Ombra interna del riempimento testo (candidato locale del 29 luglio 2026)

- Effetto vettoriale non distruttivo e indipendente da Ombra singola/Block
  Shadow. Strategia modello
  `webgpu-slug-analytic-fill-clip-zero-blur-or-r8-separable-gaussian-v1`;
  core GPU `slug-analytic-fill-times-inverse-shifted-mask-v1`.
- Formula premoltiplicata: `fill(p) × [1 − shiftedFill(p)]` a Blur `0` e
  `fill(p) × [1 − Gaussian(fill)(p − offset)]` con Blur positivo. La prima
  variante valuta due coverage Slug analitiche nello stesso fragment e non
  alloca bitmap; la seconda riusa il planner ROI e i due pass Gaussian R8 già
  usati dall’ombra singola, poi ritaglia di nuovo con la coverage Slug esatta.
- Il matte contiene soltanto `Gaussian(fill)`: colore, opacità, direzione e
  clipping vengono applicati in compositing. Ombra esterna e interna con
  identici sorgente, Blur e LOD condividono quindi la stessa cache R8; una
  prova browser ha confermato `1 matte + scratch GPU`, non due.
- Ordine del nodo: ombre esterne/Block dietro, Traccia esterna, riempimento,
  Ombra interna sopra il solo riempimento. `vectorTextGpuRunBounds()` continua
  a usare i bounds Slug sorgente per entrambe le varianti interne e
  `textCorners()` non legge lo stile: blur, offset e colore non modificano bbox,
  maniglie o hit-test.
- UI per nodo: toggle indipendente, colore, opacità, offset `0–100`, angolo
  `−180–180°` e Blur `0–300`; default OFF, nero, `65%`, offset `12`, angolo
  `−135°`, Blur `12`.
- Prova browser locale NVIDIA Ampere: fill giallo, Traccia tonda blu `18 px`,
  ombra interna rossa con Blur `0`/`24`, Block Shadow e poi Ombra singola
  combinata. Il colore interno resta interamente dentro il riempimento, la
  Traccia non viene contaminata, fori e curve sono continui. Sei zoom-out e
  sei zoom-in consecutivi: render testo p95 mostrato `2,0 ms`, Worker `0` in
  attesa, nessun warning/errore console o WebGPU. È verifica locale, non una
  run canonica né una misura iPhone.
- Verifiche verdi: TypeScript/build Vite production, `vector-text:verify`,
  `mixed-scene:verify` e `git diff --check`. Candidato lasciato volutamente
  non committato e non pubblicato su richiesta dell’utente.
### Importazione SVG vettoriale GPU (candidato locale del 29 luglio 2026)

- Aggiunti un pulsante per il file di esempio e un selettore file SVG reale nel
  pannello vettoriale sempre disponibile. Ogni import crea un nodo `svg`
  separato nella pila mista, con visibilità, opacità, ordine, undo/redo,
  spostamento, scala e rotazione come il testo; non converte il documento in un
  canvas 4096².
- Strategia `sanitized-semantic-svg-solid-paints-worker-lod-mesh-webgpu-v1`:
  il parser conserva path Bézier e colori solidi, normalizza trasformazioni e
  forme (`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`),
  poi il Worker costruisce mesh LOD che restano WebGPU/MSAA durante lo zoom.
  Palette originale e campi HEX sono modificabili per colore.
- Gli SVG riusano lo stack effetti vettoriale: Traccia esterna
  round/bevel/miter, Ombra singola con Gaussian R8, Ombra interna ritagliata
  dal riempimento e Block Shadow estrusa. Le mask blur mesh condividono planner,
  scratch e cache GPU già usati dal testo; bbox/maniglie restano quelle della
  geometria sorgente.
- Contratto di sicurezza: limite sorgente `5 MiB` e `500000` comandi; rifiuto
  di script/elementi non ammessi, handler evento, href, URL esterni,
  DOCTYPE/ENTITY, filter/mask/clip-path, gradienti/pattern e tracce sorgente.
  Le tracce originali vanno convertite in fill; nell'app si può poi applicare
  la Traccia vettoriale non distruttiva. Fill-rule misti nello stesso oggetto
  sono per ora rifiutati esplicitamente.
- File utente `image (5) copiaasd.svg`: `0,018 MiB` sorgente, `2` colori,
  `29` contorni, `850` comandi e `0,074 MiB` di dati vettoriali CPU. Nel
  viewport desktop finale il contatore del nodo riporta `11,40 MiB` GPU senza
  effetti, `12,29 MiB` con Traccia 14 + Ombra singola + Ombra interna e
  `12,37 MiB` con Traccia 14 + Block Shadow + Ombra interna. Questi valori
  includono due cache viewport, mesh e matte e quindi dipendono dal viewport;
  non sono la sola dimensione del file.
- QA browser aggiuntiva con un secondo SVG indipendente: CSS, trasformazione,
  rettangolo arrotondato, cerchio, arco, Bézier e quattro colori; palette,
  Traccia, entrambe le ombre, Block Shadow, move/scale/rotate e zoom rapido
  verificati visivamente senza curve seghettate né errori console/WebGPU. Un
  file con `<script>`/`onload` è stato respinto mantenendo il livello valido.
- Fix palette SVG del 29 luglio: il picker colore mantiene ora lo stesso nodo DOM
  durante gli eventi `input`, sincronizza il campo HEX in tempo reale e usa
  `change` come fallback Safari/iPhone. Probe browser con tre colori consecutivi
  (`#1F7AE0` → `#35B56A` → `#E0529C`) ha mantenuto il controllo attivo e
  connesso dopo ogni variazione; build, `vector-text:verify` e diff check verdi.
- Verifiche verdi: build production/TypeScript, `vector-text:verify`,
  `mixed-scene:verify`, `stroke:verify`, `shadow:verify`, `layers:verify`,
  `history:verify`, `view:verify`, `effects-scratch:verify`, `blend:verify`,
  `grain:verify`, `thickness:verify`, `bevel:verify`, `compression:verify` e
  `git diff --check`. Candidato non committato e non pubblicato, come richiesto.
### Scenario misto staged 600 MiB · candidato rev 59

- Profilo aggiuntivo selezionato da
  `?mixedMemoryBenchmark=1&mixedMemoryTargetMiB=600`; il default da `800 MiB`
  conserva percorso, target e firma rev 58. La nuova firma è
  `mixed-raster-vector-64-text-nine-runs-counted-gpu-600mib-staged-v1`.
- Il percorso staged mantiene `64` testi, `32` Block Shadow, `32` ombre Blur e
  `9` run testo, ma usa `128` tile (`32 MiB`) per ciascuno degli otto cold store
  intermedi invece di `256`; i `56` testi restanti vengono creati in sette
  batch da `8`, con due frame visibili e GPU idle fra i batch.
- Il profilo `800 MiB` continua a usare cold store intermedi da `256` tile e un
  unico batch dei testi restanti, così le run canoniche precedenti non cambiano.
- Prova locale NVIDIA Ampere del 29 luglio: scenario completato in `3,936 s`,
  `13` raster, `64` testi, `9` run, steady GPU `600,930 MiB` e picco setup
  `664,930 MiB`; il raster finale è vuoto e attivo, con contratto replay pronto.
- Breakdown principale: raster attivo `64 MiB`, cold raster `463,25 MiB`, cache
  GPU testo `40,671 MiB`, mip `22,411 MiB`, cache schermo `3,262 MiB`, superfici
  fuse `3,234 MiB`; tile cold `[128×8, 256×3, 61]`.
- Probe zoom accoppiato locale: renderer testo p95 `0,9→2,5 ms` (`2,8×`) ed
  end-to-end p95 `31,8→23,0 ms` (`0,7×`). Questi numeri verificano soltanto il
  desktop e non vanno presentati come prestazione iPhone.
- Pubblicato su Sites `93` dal commit `8cda468` e verificato sulla URL di
  produzione: profilo staged riconosciuto, setup completato ancora a
  `600,9 MiB`, `64` testi / `9` run; zoom p95 testo `1,1→1,7 ms` ed end-to-end
  `40,5→20,9 ms`. Il replay canonico Base/Normal/Grain Off è terminato e ha
  salvato la run `#87`: coda GPU `11,30 ms`, CPU frame p95 `3,50 ms`, submit
  p95 `0,40 ms`, `132,0` FPS medi, `19` frame oltre `20 ms`, presentazione
  `6866,20 ms`, spacing adattivo `1,00→1,25%` e `9700` stamp base. È una prova
  desktop della build pubblicata, non una prova iPhone.
- Run fisica iPhone `#88` del 29 luglio completata sulla build Sites `93`:
  iPhone OS `18.7`, Safari `26.5`, DPR `3`, GPU `apple`, `12` raster, `64`
  testi / `9` run, `600,905 MiB` GPU conteggiati e working set logico noto
  `606,031 MiB`. Safari non ha chiuso la pagina durante setup né replay.
- Probe zoom iPhone: renderer testo p95 `1→3 ms`; end-to-end p95 `19→31 ms`.
  Replay Base/Normal/Grain Off: `8863` stamp base / `141808` copie fisiche,
  CPU frame p95 `1 ms`, intervallo render p95 `17 ms`, media `58,42 FPS`,
  `10` frame ritardati, input delay p95 `16 ms`, completamento GPU finale
  `18 ms` e presentazione `30 ms` dopo l'ultimo input consegnato.
- Due completion lente hanno portato lo spacing adattivo `1,00→1,50%`; nessun
  timeout e nessuna attivazione della tip preview. Questo promuove `600 MiB
  staged` come punto funzionante su questo iPhone per una run, non come limite
  universale o budget production. Poiché rispetto al fallimento da `800 MiB`
  sono cambiati sia target sia staging, la causa non è ancora isolata: il
  prossimo gradino scientificamente confrontabile è `700 MiB staged`.

### Rasterizzazione vettori -> livello RGBA8 tiled (candidato locale 31 luglio 2026)

- La conversione esplicita copre ora sia il nodo SVG sia il testo selezionato e
  produce un livello raster RGBA8 autorevole. RGBA16F non partecipa a questo
  percorso e viene rifiutato dal runtime dedicato.
- Strategia
  semantic-vector-slug-mesh-webgpu-linear-rgba8-msaa4-512-tile-chunks-history-seed-v2,
  senza fallback Canvas2D, screenshot o bitmap intermedia.
- Il testo conserva il riempimento Slug analitico fino al render finale; Traccia,
  Block Shadow e le ombre riusano le draw WebGPU esistenti. SVG ed effetti testo
  vengono bloccati al LOD esatto della risoluzione documento, indipendente dallo
  zoom corrente della viewport.
- Il job rasterizza con MSAA 4x in blocchi da 512 px e copia il risultato nel
  layer 4096 al confine dei tile da 256 px. Opacita e visibilita passano dal nodo
  semantico al record raster, mentre i pixel del job sono renderizzati a opacita
  unitaria per non applicarla due volte.
- La conversione conserva la posizione esatta nella pila mista e seleziona il
  nuovo livello per il pennello soltanto dopo il completamento atomico delle
  copie. L'azione cronologica unica vector-rasterize registra il tipo sorgente,
  testo o SVG, e il relativo stato semantico compatto.
- Undo/Redo e replay usano un seed freddo indipendente composto soltanto dai tile
  coperti; ripristinano lo stesso record di layer e lo stesso nodo vettoriale
  senza duplicare array di pixel sul CPU.
- Restano attive le due difese di lifecycle trovate dalla QA SVG: le draw
  vettoriali viewport gia accodate vengono eliminate prima di distruggere le
  risorse e il retarget del banco effetti usa structural-history.
- QA browser locale NVIDIA Ampere, testo con Slug, Traccia 12 px, Block Shadow e
  Ombra interna blur 12: conversione riuscita in 8 blocchi da 512 px e 16 tile
  da 256 px. Undo ha ripristinato il testo semantico con tutti gli effetti e Redo
  il raster nello stesso slot; console priva di warning/errori WebGPU.
- La precedente QA SVG resta valida: esempio rasterizzato in 8 blocchi e 24 tile
  (64 MiB hot + 6 MiB seed tiled), con Undo/Redo nello stesso slot e Worker
  finale vuoto.
- Verifiche finali verdi dopo l'estensione al testo: TypeScript, tutte e
  quindici le suite *:verify, git diff --check e build Vite production con
  preparazione del pacchetto Sites. Candidato locale, non committato e non
  pubblicato.

### Riempimento connesso WebGPU (candidato locale 31 luglio 2026)

- Nuovo strumento Canvas `Riempimento`, separato dall'ABI Paint/Blend. Un tap
  senza trascinamento riempie esclusivamente il livello raster selezionato;
  testo e SVG vengono rifiutati senza mutare il documento. Il controllo espone
  una tolleranza `0–100%`, normalizzata con tetto effettivo `97,6%`.
- Strategia
  `webgpu-hierarchical-ccl-4-connected-straight-srgb-alpha-bitmask-v2`:
  confronto sul colore straight sRGB più alpha, connettività esatta a quattro
  direzioni e nessun readback dei pixel. La CPU riceve soltanto `64 B` di
  metadati finali (conteggio, bounds e maschera tile).
- Il CCL gerarchico divide il layer `4096²` in `65536` blocchi `16×16`: label
  locali u8 packed, union-find globale, selezione 1-bit e lista dei soli blocchi
  attivi per il draw indiretto. Il pass di unione visita soltanto i due bordi
  utili con `16` thread per blocco (`1.048.576` invocazioni), invece di
  rilanciare tutti i `16.777.216` pixel.
- Lo scratch residente è `50,5 MiB`, allocato transazionalmente quando si
  seleziona Fill e rilasciato dopo `1,5 s` di inattività quando si torna a un
  altro tool. Pipeline e uniform buffer restano caldi. Sono controllati prima
  dell'allocazione limiti compute, storage binding e `9232 B` di workgroup
  storage; il prewarm è condiviso, quindi selezioni/tap rapidi non possono
  duplicare l'allocazione.
- Ogni azione conserva nella cronologia GPU la sola maschera autorevole da
  `2 MiB` (`1 bit/pixel`). Undo/Redo copia GPU→GPU la maschera, ricostruisce la
  lista blocchi in compute e ridisegna senza rieseguire il flood fill o fare
  repack CPU. Il journal globale è revisionato a
  `global-order-per-layer-clear-barrier-vector-seed-fill-v4`.
- La maschera degli storage tile `256²` viene prodotta esattamente sulla GPU e
  OR-ata nel record del livello: non si promuovono tile vuoti soltanto perché
  ricadono nella bounding box. Effetti, mip e cache di presentazione riusano il
  percorso autorevole già esistente tramite dirty rect; il percorso caldo delle
  pennellate (`submitImmediate` e generazione stamp) non contiene diramazioni
  Fill.
- La mutazione live viene registrata nella timeline solo dopo il completamento
  GPU. Un errore dopo il commit tenta il rebuild della storia visibile; se anche
  il rollback fallisce, il documento viene bloccato come incoerente. Cambio
  formato e cambio livello attendono il prewarm in volo e retargettano sempre
  la view più recente.
- QA browser locale non canonica su NVIDIA Ampere: fill completo `4096²` =
  `16.777.216` pixel e `256` tile in `223,3 ms` al primo caso RGBA8 della
  sessione, `95,2 ms` in un caso RGBA8 caldo, `233,0 ms` su un secondo livello
  appena creato e `306,3 ms` dopo ricreazione RGBA16F. Sono latenze end-to-end
  mostrate dall'app, comprendono coda FIFO e callback JS e non isolano il tempo
  GPU.
- Nella stessa QA due fill pieni di colori diversi sono rimasti isolati sui due
  livelli; il livello inattivo ha riportato `raster cold · 256 tile`; Undo ha
  svuotato soltanto il secondo livello e Redo lo ha ripristinato. Il cambio a
  Paint ha liberato `50,5 MiB`; ogni fill ha aggiunto `2 MiB` di history.
  Verificato anche il cambio RGBA8↔RGBA16F, con console finale senza warning o
  errori WebGPU.
- TypeScript, tutte le sedici suite `*:verify`, `git diff --check` e build Vite
  production con pacchetto Sites sono verdi. Candidato locale non committato e
  non pubblicato. Le misure non sono una baseline iPhone, né una prova di
  parità pixel completa o di superiorità prestazionale rispetto a Procreate.

### Livello Riferimento per Riempimento (candidato locale 1 agosto 2026)

- Un solo raster può essere marcato `Riferimento`; l'identità segue il record
  anche riordinando lo stack e viene rimossa insieme al record. La UI espone il
  pulsante `R` sulla riga raster selezionata. Senza Riferimento, la sorgente del
  Riempimento resta il raster attivo, come prima.
- Strategia firmata
  `single-raster-reference-full-resident-gpu-source-separate-active-target-no-fallback-v1`.
  Il compute CCL campiona direttamente il mip `0` raw del Riferimento, mentre
  il render commit scrive esclusivamente la view del livello attivo. Non esiste
  copia texture sorgente→destinazione, readback dei pixel, paging per fill o
  reidratazione sul tap; la maschera tile prodotta dal fill aggiorna soltanto il
  record di destinazione.
- Se il Riferimento è diverso dall'attivo, rimangono residenti esattamente due
  full texture autorevoli: costo aggiuntivo `64 MiB` in RGBA8 o `128 MiB` in
  RGBA16F. Il cambio livello preserva l'hot del Riferimento; cambiare
  Riferimento costruisce prima il cold autorevole del precedente e lo libera
  soltanto dopo il completamento GPU. Se l'allocazione fallisce, identità e
  binding precedenti restano intatti e l'errore viene propagato: nessun
  fallback lento o silenzioso sul livello attivo.
- Il bind group compute cambia soltanto quando cambia davvero la texture
  sorgente; i fill successivi sulla stessa coppia Riferimento/destinazione non
  pagano rebuild o copie. Un'identità stale o un Riferimento non residente sono
  errori d'invariante espliciti, non condizioni di degradazione.
- Undo/Redo continua a usare la maschera GPU autorevole da `2 MiB`: il replay
  non ricalcola la connettività e quindi non cambia se il Riferimento viene
  modificato dopo l'azione. `sourceLayerId` resta nel batch solo come
  diagnostica; il target autorevole resta `layerId`.
- Telemetria rev `59`: `referenceLayerId`, strategia, MiB extra e flag
  per-layer; le proiezioni cold escludono attivo e Riferimento, mentre la
  memoria effettiva conta entrambe le texture hot. Il cambio formato, che
  azzera tutti i raster e ricrea soltanto l'attivo, azzera anche il Riferimento.
- Verificati TypeScript, tutte le sedici suite `*:verify`, `git diff --check` e
  build Vite production con preparazione del pacchetto Sites, comprese
  regressioni sull'ordine transazionale candidate→publish→destroy, rollback
  senza fallback, preservazione hot nello switch, separazione sorgente/target,
  tile del target e UI. Nessuna nuova misura prestazionale o QA browser è stata
  attribuita a questo passo; candidato locale non committato e non pubblicato.

### Import raster nativo e Trasforma raster WebGPU (1 agosto 2026)

- L'importazione esterna accetta immagini statiche PNG, JPEG/JPG, WebP e AVIF
  quando il decoder nativo del browser supporta il formato. La strategia
  `byte-sniff-static-png-jpeg-webp-avif-create-image-bitmap-v1` verifica i byte,
  non la sola estensione/MIME, e rifiuta APNG, WebP animati, sequenze AVIF e
  JPEG concatenati/MPO. Non esistono fallback Canvas2D/CPU, decoder JavaScript,
  ridimensionamenti automatici o conversioni silenziose.
- L'immagine decodificata diventa immediatamente un normale `LayerRecord`
  raster del documento: non viene più creato un nodo immagine semantico. La GPU
  converte sRGB straight in lineare premoltiplicato, scrive la texture hot del
  livello, genera le mip necessarie, marca i tile occupati e crea il seed cold
  autorevole per Undo/Redo. Da quel momento brush, riempimento, effetti,
  riferimento, visibilità e stack usano esattamente lo stesso percorso degli
  altri livelli raster.
- La texture temporanea destinazione di `copyExternalImageToTexture` dichiara
  `COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT`, come richiesto da Dawn. Le
  mip NPOT usano filtro area esatto su alpha premoltiplicato e vengono generate
  soltanto fino al LOD richiesto per l'inserimento; nessun pixel passa dal CPU.
- Limiti senza fallback: file sorgente `64 MiB`, singola catena GPU
  transitoria/source `256 MiB` e importazioni persistenti ancora raggiungibili
  da scena o cronologia `256 MiB`. Non esiste più il falso tetto aggregato
  `384 MiB`, che sommava al picco logico dell'import anche la memoria GPU già
  residente dell'app e poteva rifiutare perfino una sorgente 2K. Ogni vera
  allocazione resta sotto scope WebGPU validation + OOM e la transazione
  esterna conserva il documento precedente in caso di fallimento. Il
  `ImageBitmap` decodificato viene chiuso subito dopo la cattura della sorgente
  da parte di `copyExternalImageToTexture`, prima di costruire il seed di
  cronologia. Una sorgente fino a `4096×4096` resta ora 1:1 e può occupare tutto
  il canvas; solo dimensioni superiori vengono adattate entro `4096²`.
- Il tool Canvas `Trasforma` usa ora lo stesso percorso raster per ogni livello
  non vettoriale, non soltanto per le immagini importate. All'apertura copia una
  sola volta la bbox tile realmente occupata in uno scratch WebGPU immutabile,
  aggiunge una guardia trasparente di `2 px` e genera la sua piramide mip NPOT.
  Durante spostamento, scala e rotazione aggiorna soltanto un uniform buffer da
  `64 B`; un solo frame latest-only esegue l'inversa affine. Poiché WebGPU non
  espone `clamp-to-border`, lo shader ricostruisce il bordo trasparente a ogni
  mip con due `textureSampleLevel` e trilineare esplicita; su ingrandimento o
  LOD intero un ramo draw-uniforme salta la seconda fetch. Il footprint è
  isotropo perché la trasformazione ammette solo scala uniforme+rotazione.
- La bbox geometrica dell'overlay resta separata dal supporto raster effettivo:
  non incorpora guardie artificiali, mentre dirty rect, storage tile, effetti e
  checkpoint conservano la `samplingBounds` scale/rotation-aware che comprende
  davvero i texel filtrati. Questo evita sia il taglio dei bordi ingranditi sia
  halo dei mip profondi da `clamp-to-edge`, e mantiene live, Apply e Redo
  byte-coerenti anche se la sola coda del filtro entra nel documento. La
  cronologia conserva inoltre `geometryBounds` separatamente dal raster
  filtrato, così una successiva sessione Trasforma recupera lo stesso pivot e
  overlay; se dopo la trasformazione intervengono Paint o Riempimento torna
  invece alla bbox reale del contenuto. Identità e traslazioni intere a scala
  `1` usano padding zero, quindi non allargano bbox o tile.
- `Applica` materializza il risultato raster e pubblica un solo checkpoint
  globale; `Annulla`/`Esc` ripristinano esattamente mip 0 senza aggiungere storia.
  Tutte le allocazioni di checkpoint, azione e maschera precedono il taglio del
  Redo. Gli errori di rollback conservano le risorse ancora necessarie e
  bloccano nuove modifiche invece di distruggere lo scratch o lasciare scena,
  selezione e livello attivo divergenti.
- Gli observer UI di stato, statistiche, storia, scena e livello attivo sono
  non-fallibili rispetto alle transazioni: un errore viene loggato ma non può
  lasciare `historyBusy` bloccato o separare cursore e documento. Il replay
  raster ripubblica inoltre la bbox dopo Undo/Redo, così l'overlay Trasforma non
  resta stale. `Aggiungi livello`, che non è ancora un'azione journalled,
  invalida un eventuale ramo Redo soltanto dopo l'attivazione riuscita.
- Le pipeline di trasformazione vengono create sotto scope WebGPU validation +
  OOM e soltanto per il `LayerFormat` attivo. L'obiettivo prestazionale e di QA
  è RGBA8; RGBA16F rimane compatibilità passiva e non riceve precompilazione o
  ottimizzazioni dedicate, perché è previsto che venga rimosso.
- Follow-up del 2 agosto: il record del livello attivo riceveva `hasContent` e
  `contentBounds` soltanto quando il livello diventava inattivo. Subito dopo un
  gesto Paint la scena Trasforma poteva quindi considerarlo vuoto fino al primo
  cambio livello. L'ingresso nel tool ora richiede uno snapshot fresco, lo
  snapshot usa i campi raster live per il livello attivo e il runtime li
  persiste al confine della sessione prima del controllo; nessun lavoro è stato
  aggiunto al percorso caldo del tratto. `transform:verify` vincola tutti e tre
  i punti.
- Follow-up import 4K del 2 agosto: un PNG reale `4096×4096` è stato importato
  1:1 su NVIDIA Ampere/RGBA8, ha occupato tutti i `256` tile e il livello hot ha
  riportato esattamente `64,0 MiB`; il totale GPU contato dall'app dopo l'import
  era `158,6 MiB`. Undo ha rimosso il livello e Redo lo ha ricostruito senza
  errori. Finché l'azione è raggiungibile, il seed cold immutabile per la
  cronologia può aggiungere fino ad altri `64 MiB` per un contenuto full-canvas:
  `64 MiB` è quindi il costo della texture hot del livello, non necessariamente
  l'intero costo persistente di livello più Undo/Redo.
- Verifica finale su questa macchina: `tsc --noEmit`, tutte le diciotto suite
  `*:verify`, `git diff --check` e build Vite production/Sites verdi. Le
  regressioni coprono decoder e cleanup, limiti residenti, import 4K 1:1, tile,
  guardia e bbox,
  ABI affine, frame latest-only, transazioni Apply/Cancel, Undo/Redo strutturale
  e rollback. QA browser desktop reale su NVIDIA Ampere/RGBA8: import PNG
  `512×512`, sessione Trasforma, drag, Applica, Undo, Annulla della sessione
  modale riaperta e Redo; overlay e posizione tornano coerenti e la console
  resta priva di warning/errori. Follow-up reale: Paint su un livello vuoto,
  ingresso immediato in Trasforma senza cambiare layer, drag+Applica, creazione
  e Paint su un secondo raster, apertura/Annulla e ritorno al primo livello
  cold ancora in Trasforma; entrambe le sessioni mostrano Applica/Annulla e lo
  stato GPU pronto. È prova funzionale, non benchmark; non sono state eseguite
  una misura canonica iPhone o una pubblicazione Sites.
- Correzione orientamento import del 2 agosto: il quad del blit finale associava
  `V=0` ai vertici clip inferiori e rifletteva verticalmente il bitmap prima di
  renderlo autorevole nel livello. Ora i vertici superiori campionano `V=0` e
  quelli inferiori `V=1`; la rotazione raster resta invariata e positiva in
  senso orario nello spazio documento Y-down. Strategia aggiornata a
  `decoded-straight-srgb-transient-exact-npot-mips-linear-premultiplied-top-left-native-layer-v2`.
  `image:verify` vincola l'associazione vertici/UV; `image:verify`,
  `transform:verify`, TypeScript, build Vite/Sites e avvio WebGPU locale senza
  warning/errori sono verdi.

### Sovrapposizione colore raster non distruttiva (2 agosto 2026)

- Aggiunto lo stile per-layer `Sovrapposizione colore`, separato dal tool
  Riempimento connesso. La strategia firmata è
  `analytic-linear-alpha-preserving-color-overlay-zero-scratch-v1`: il colore
  UI sRGB viene convertito in lineare e il compositore usa pixel
  premoltiplicati, `rgb' = mix(rgb, coloreLineare × alpha, opacità)` e
  `alpha' = alpha`. Pixel trasparenti, coverage morbida e antialias restano
  quindi invariati; l'effetto non può creare nuovi tile o contenuto.
- L'ordine comune è `sorgente → Sovrapposizione colore → Ombra interna →
  Smusso → Traccia → Ombra esterna`. Display diretto LOD 0, mip derivate,
  preview live, bake dei livelli inattivi, merged surfaces e trasformazioni
  raster attraversano lo stesso parametro WGSL. Lo stile segue il
  `LayerRecord`, incluse immagini importate già raster e cambi livello; non
  riscrive mai mip 0 autorevole.
- Nessuna texture, buffer o regione scratch è dedicata all'overlay. Se il
  compositore effetti non era già residente, la prima attivazione deve però
  creare la sua mip chain condivisa: nella QA RGBA8 il totale contato è passato
  da `132,0` a `153,9 MiB` (`+21,9 MiB`) ed è tornato a `132,0 MiB` a opacità
  `0%` quando l'overlay era l'unico effetto. Questo è costo condiviso del banco
  effetti, non scratch Color Overlay; in RGBA16F resta il costo passivo già
  definito dalla stessa chain.
- Il ramo WGSL disattivato è uniforme e restituisce subito il texel base, senza
  eseguire multiply/mix RGB per ogni pixel degli altri effetti. Un cambio caldo
  di colore o opacità non attende più `queue.onSubmittedWorkDone()` e non forza
  una ricostruzione full-screen: ricompone soltanto la dirty rect del contenuto
  e invalida le mip derivate necessarie. La coda GPU viene attesa soltanto prima
  di distruggere il compositore condiviso.
- Come Traccia, Smusso e Ombre raster correnti, la modifica dei parametri dello
  stile non è una voce della timeline globale; Undo/Redo continua a operare
  sulle mutazioni raster sottostanti e l'effetto viene ricalcolato sul risultato.
  La telemetria è salita a rev `60` e registra stile, strategia e scratch
  dedicato `0` per impedire confronti con run che non riportavano l'overlay.
- QA browser desktop reale su NVIDIA Ampere/RGBA8: campione Paint con bordo
  morbido, overlay al `100%`, `50%`, `0%` e `75%`, conversione colore live,
  rilascio memoria a zero, nuovo livello con stile predefinito e ritorno al
  livello originale con colore/opacità ripristinati. Shader WGSL compilato e
  console priva di warning/errori. TypeScript, tutte le diciotto suite
  `*:verify`, `git diff --check` e build Vite production/Sites verdi. È QA
  funzionale desktop, non un benchmark canonico o una misura iPhone; candidato
  locale non ancora pubblicato.

### Metodi di fusione raster live WebGPU (3 agosto 2026)

- Ogni riga raster espone ora il menu di fusione ordinato come Procreate 5.4:
  `Multiply`, `Darken`, `Shade`, `Color Burn`, `Linear Burn`, `Darker Color`,
  `Normal`, `Lighten`, `Screen`, `Color Dodge`, `Add`, `Lighter Color`,
  `Overlay`, `Soft Light`, `Hard Light`, `Vivid Light`, `Linear Light`,
  `Pin Light`, `Hard Mix`, `Difference`, `Exclusion`, `Subtract`, `Divide`,
  `Hue`, `Saturation`, `Color` e `Luminosity`. I codici GPU `0..26` sono
  stabili e condivisi da UI, storia e shader. Le formule seguono il modello
  W3C su colori non premoltiplicati con compositing source-over; `Darker Color`
  e `Lighter Color` confrontano la somma RGB totale, non i canali
  indipendentemente. `Shade` è intenzionalmente marcato provvisorio: Procreate
  lo documenta come compatibilità del vecchio Darken ma non pubblica la sua
  formula, quindi non dichiarare ancora parità pixel con quel solo modo.
- Su una scena solo raster, ogni modo non-Normal viene composto in spazio
  documento prima di bilineare e mipmap: tile native fino a `1024²`, fold
  ordinato GPU e piramide finale condivisa. Il percorso `Normal` conserva il
  compositing fixed-function esistente e rilascia il compositore tile quando
  nessun modo avanzato è attivo. Pan/zoom allo stesso LOD riusa la piramide
  valida; a LOD 0 si processano viewport e dirty core reali, una tile coperta
  interamente salta la copia ping-pong e il livello attivo senza effetti viene
  letto direttamente senza bake compute.
- I clipping layer conservano l'alpha del parent: i figli vengono applicati in
  ordine con source-atop, incluso il loro metodo di fusione, mentre il gruppo
  risultante entra nella scena esterna una sola volta con opacità e metodo del
  parent. Un figlio nascosto non nasconde più parent o fratelli. Con testo/SVG
  visibile, la compatibilità mixed-scene resta tutta GPU e usa un ping-pong
  viewport separato anche per parent/figli avanzati; testo e SVG invisibili o
  a opacità zero non spezzano le run. Questo percorso semantico è live ma
  applica ancora la fusione agli operandi già filtrati in viewport: non va
  descritto come equivalente document-pixel al percorso raster-only.
- Il cambio modo prealloca e valida sotto scope WebGPU `validation` + OOM la
  sola famiglia candidata (tile oppure viewport) prima di pubblicare metadata
  e storia; in errore mantiene modo, superfici e risorse precedenti. La
  cronologia registra una sola azione metadata `before/after`; mip 0 e tile
  autorevoli del livello non vengono mai riscritti. Undo/Redo ricompone quindi
  live lo stesso contenuto grezzo.
- Il working set tile stabile è di tre texture `1024²` (circa `12 MiB` in
  RGBA8 o `24 MiB` in RGBA16F) più ring uniformi; il fold statico può aggiungere
  transitoriamente due scratch (`8/16 MiB`). Il percorso mixed-scene avanzato
  usa quattro texture screen-space RGBA16F (canonica più tre peer ping-pong) e
  un operando raster ritagliato; è il costo da considerare nelle scene con
  testo/SVG. Il bake Traccia dei tile usa un buffer uniforme separato da quello
  del display/live stroke e un solo upload di batch, eliminando l'alias fra
  dispatch già codificati nello stesso submit.
- QA browser desktop reale su NVIDIA Ampere/RGBA8, gate
  `?layerBlendTest=1&semanticClipping=1`: tutti i 27 modi entro un codice del
  riferimento CPU, clipping `Multiply→Screen`, parent e figli attivi,
  figlio nascosto, suffissi con testo visibile, Undo/Redo e casi zoom `1,5×` e
  `0,4×` passano; i due casi zoom distinguono esplicitamente blend-before-filter
  dal risultato errato filter-before-blend. Nessun warning/error WebGPU in
  console. TypeScript, tutte le ventuno suite `*:verify`, `git diff --check` e
  build Vite production/Sites sono verdi. È QA funzionale desktop, non un
  benchmark prestazionale canonico, una prova iPhone o una pubblicazione Sites.

### Selezione pixel WebGPU (3 agosto 2026)

- Aggiunto lo strumento document-wide **Selezione pixel** con tre metodi:
  Bacchetta magica 4-connected, Lazo libero e selezione globale da un colore
  scelto. Tutti accettano `Sostituisci`, `+ Aggiungi` e `− Sottrai`; la
  tolleranza pubblica è `0–255` e viene confrontata nello straight-sRGB con
  alpha. Le firme sono
  `document-wide-gpu-r32-bitmask-replace-add-subtract-v1`,
  `fill-ccl-reused-4-connected-straight-srgb-alpha-v1`,
  `global-straight-srgb-alpha-max-channel-range-v1` e
  `cpu-even-odd-pixel-center-spans-gpu-bitmask-v1`.
- La maschera autorevole è un bit per pixel in un buffer GPU `r32` da `2 MiB`.
  Front/back evitano di corrompere la selezione pubblicata durante una nuova
  operazione; il lazo viene convertito sulla CPU in span exact even-odd
  campionati ai centri dei pixel e rasterizzato nella stessa maschera dalla
  GPU. Due mask, span preallocati, metadati/readback e uniformi occupano
  `5,0005 MiB` quando residenti. La sola readback per operazione è di `64 B`;
  pixel, bounds e tile attive vengono riepilogati in compute. Con mask vuota,
  tool spento e motore idle, un timer da `1.500 ms` attende la fence GPU,
  distrugge i buffer e fa `unconfigure()` del secondo canvas; la QA è tornata
  da `137,0` a `132,0 MiB`.
- La Bacchetta riusa la candidate mask CCL del renderer Riempimento, senza
  copiarla sul CPU. Legge sempre il mip 0 grezzo del raster attivo e non la
  sorgente `Riferimento`, effetti o scena composita. Lo scratch CCL resta quindi
  lazy: nella QA la memoria contata è passata da `132,0` a `137,0 MiB` per la
  sola selezione e a `187,5 MiB` con Bacchetta/CCL residente; passando a Lazo o
  Per colore lo scratch è stato rilasciato tornando a `137,0 MiB`.
- L'overlay firmato
  `separate-transparent-webgpu-mask-overlay-v1` vive su un canvas WebGPU
  premoltiplicato separato: tinta blu interna e bordo bianco/nero di un pixel
  screen-space restano leggibili a zoom e rotazione diversi senza sporcare la
  presentation cache o il layer. Ogni frammento verifica in modo conservativo
  qualsiasi bit nel proprio footprint raster, accelerato da bounds e tile mask:
  una selezione sottile non può sparire fra campioni nearest quando `zoom < 1`.
  Pan, zoom e rotazione accodano una sola presentazione latest-only per frame;
  una failure del solo overlay o di un observer UI, incluso lo stato di
  successo, è best-effort e non può dichiarare fallita una mask già
  committata. Un canvas 2D separato mostra soltanto il
  contorno provvisorio mentre si trascina il lazo. La selezione persiste
  cambiando tool o livello, viene ritargettata al raster attivo per le nuove
  candidate e viene azzerata da reset documento o cambio formato.
- Cambio tool/metodo e operazioni sono mutuamente esclusivi con Fill, replay,
  switch livello e tratto attivo. La configurazione UI usa una revisione
  latest-only: una vecchia prewarm Bacchetta non può più riportare a Paint o
  sovrascrivere un passaggio rapido a Lazo/Per colore. La regressione è stata
  riprodotta e verificata nel browser con cambio Bacchetta→Lazo durante la
  prewarm; la scelta finale resta Lazo. Con Bacchetta o Lazo il canvas entra
  nel tab order: frecce muovono un cursore visibile, Invio/Spazio aziona la
  Bacchetta; per il Lazo Spazio avvia, le frecce tracciano, Invio chiude ed Esc
  annulla. Negli altri tool e in Per colore torna fuori dal tab order e non
  dichiara shortcut ARIA inattive.
- QA browser desktop reale su NVIDIA Ampere/RGBA8, layer trasparente:
  Bacchetta `16.777.216` pixel / `256` tile; Lazo rettangolare `1.684.690` /
  `42`; `+ Aggiungi` `2.322.998` / `62`; `− Sottrai` `1.939.687` / `58`;
  ricerca globale `#ff5b35` con tolleranza `32` correttamente vuota sul layer
  trasparente. QA solo tastiera: Bacchetta full-layer e Lazo `26.244` pixel /
  `1` tile / bounds `162×162`; cursore, overlay e contorni sono visibili. Dopo
  Deseleziona+Paint il rilascio lazy riporta la memoria a `132,0 MiB`. La
  console resta priva di warning/errori WebGPU. TypeScript, tutte le ventidue
  suite `*:verify`, `git diff --check` e build Vite production/Sites sono verdi.
- Passo isolato del 4 agosto 2026: Paint e Riempimento rispettano ora la mask
  autorevole. Paint usa la strategia
  `separate-fragment-storage-mask-pipelines-history-snapshot-v1`: soltanto con
  selezione non vuota sceglie pipeline dedicate che leggono il bit per
  frammento, mentre il percorso senza selezione continua a usare direttamente
  gli shader e le pipeline precedenti. Bounds e tile da `256 px` limitano in
  modo conservativo scissor e dirty rect; il test per-pixel resta autorevole.
  La tip preview Canvas2D adattiva viene disabilitata per il solo gesto
  selezionato, così non può mostrare colore provvisorio fuori mask.
- La snapshot Paint della selezione viene copiata nel journal GPU prima del
  primo submit del gesto, deduplicata per revisione e riutilizzata dal replay:
  Undo/Redo non dipendono quindi dalla selezione corrente. Riempimento calcola
  prima la candidate CCL invariata e poi materializza `candidate ∩ selection`
  in un secondo pass compute; la history conserva il risultato finale. Blend
  dry e `Pulisci`, non ancora mascherati, rifiutano esplicitamente l'operazione
  quando la selezione è attiva. Anche benchmark sintetici e canonici rifiutano
  una mask attiva, senza cancellarla in silenzio.
- **Trasforma** con selezione non vuota entra in modalità traslazione intera
  `integer-cut-selection-mask-immutable-source-over-destination-v1`: taglia i
  pixel originali selezionati, ricompone la sorgente immutabile con source-over
  alla destinazione e sposta insieme la mask. L'anteprima quantizza già ai
  pixel interi e trasla le marching ants; non mostra maniglie di scala o
  rotazione. Trascinamento, frecce da `1 px`, Maiusc+frecce da `10 px`, Invio,
  Escape, hit target touch da almeno `44 px`, Applica e Annulla condividono una
  sola sessione. Undo/Redo ripristina pixel e mask con compare-and-swap
  sull'identità stabile, quindi una selezione manuale successiva non viene
  sovrascritta.
- QA browser desktop reale su NVIDIA Ampere/RGBA8: dopo un Fill full-layer da
  `16.777.216` pixel / `256` tile, il Lazo ha selezionato `2.978.206` pixel /
  `56` tile. Un tratto Paint attraversato da esterno a esterno è rimasto
  visivamente confinato al contorno; il Fill successivo ha modificato soltanto
  gli stessi `2.978.206` pixel / `56` tile (`197,6 ms`). Il trascinamento ha
  mostrato il foro alla sorgente e i pixel/marching ants alla destinazione;
  Applica, Undo e Redo hanno ripristinato insieme contenuto e selezione. Il
  test ha inoltre spinto il bordo destro fuori documento: il riepilogo è
  sceso coerentemente a `2.656.830` pixel / `48` tile, senza wrap o pixel oltre
  `4096²`. Console priva di warning/errori WebGPU.
- TypeScript, tutte le ventidue suite `*:verify`, `git diff --check` e build
  Vite production/Sites sono verdi. Limiti conservativi dichiarati: i metadata
  bounds/tile del contenuto dopo uno spostamento possono restare sovrainclusivi
  e un tratto interamente dentro un foro sparso di una tile selezionata può
  produrre un'azione Undo visivamente vuota; i pixel presentati restano
  corretti. È QA funzionale desktop, non benchmark canonico, prova iPhone o
  pubblicazione Sites.
