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

**Play tratto registrato**: traccia umana fissa, fingerprint `18982412`,
`1583` punti. Preset (revisione `3`): size `750 px`, spacing `1%`, Count `16`,
flow/hardness `100%`, blend intensity `4×`, Opacità `100%`, jitter come
registrato, pressione ininfluente. Selettori indipendenti:

- variante `Base` (cerchio, jitter posizione 100%) / `Fur` (Shape 2K, scatter
  100%, jitter posizione 0%);
- Grain `Off` / `Fixed M1` (Scale 140%, Depth 100%, Improved, Multiply);
- blending `Normal 4×` / `M1 Glaze non accumulativo 1×` (esiste anche la
  variante Light Glaze del selettore blending del replay).

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

## Stato attuale del motore (tutto ciò che è attivo)

Paint:

- Quad `triangle-strip` da 4 vertici per copia (passo 3, run `#11`: `+3%` FPS,
  p95 `−16%`). Fragment con coverage generica `smoothstep`.
- Riuso esatto di `copySeed` per il jitter colore (passo 6, `#16`).
- Dirty rect direzionale conservativo sui jitter di posizione (passo 7, `#19`:
  `−36,6%` area scissor, FPS invariati; mantenuto come base per binning
  futuro, non come vittoria FPS).
- Shape 2K: decodifica PNG grayscale deterministica (`png-gray8-direct`,
  SHA-256 `69978b6e…`) + pre-mappa di occupazione conservativa `256²` sui mip
  `0–4` con fallback automatico (radius `<128`, LOD `>4`, copertura `>50%`).
  Run `#32`: `+18,5%` FPS, coda finale `−96,9%`, frame lenti `−89%`.
- Undo/Redo: journal CPU dei batch inviati, replay GPU solo su richiesta
  (`#33/#34`: costo nullo sul tratto). Limite di memoria della cronologia
  ancora aperto per uso prolungato.
- UI full-canvas con cassetto overlay e navigazione a due dita; il canvas più
  grande costò `−30%` FPS (`#35/#36`), recuperati da…
- …cache di presentazione persistente screen-space: display shader eseguito
  solo sulla dirty region, poi `copyTextureToTexture` alla swapchain
  (`#37/#38`: Base `+46%` FPS vs `#35`, migliore anche delle vecchie baseline).
- Piramide mip live del layer per il display ridotto: 13 livelli, box filter
  `2×2` su premoltiplicato, LOD `floor(log2(1/zoom))` senza upscaling, rebuild
  atomico della cache al cambio LOD (`#61`: nessun costo misurabile).
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
- Opacità per-stamp (moltiplica l'alpha già presente nella uniform, ABI
  invariata) + **Light Glaze**: accumulatore RGBA per-stroke lazy `4096²`, mip
  finali compositati `compose→filter` separati e commit unico al lift con cap
  Opacità sull'intera pennellata. Costa ~`85,3 MiB` RGBA8 o ~`170,7 MiB`
  RGBA16F. **M1 Glaze non accumulativo**: accumulatore coverage R8 a un solo
  mip (`16 MiB`) con blending `MAX`, tinta unica campionata a inizio tratto e
  gli stessi mip finali compositati; totale ~`37,3 MiB` RGBA8 o ~`58,7 MiB`
  RGBA16F. Le risorse sono lazy e il cambio modo distrugge il formato precedente,
  quindi Light e M1 non sono residenti insieme. Non unire le due strategie.
- Ciclo di vita storage glaze (sperimentale rev `39`, da validare):
  `LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-glaze-select-release-when-idle-deselected"`. Lo storage viene
  allocato quando si seleziona un blending glaze sul Paint (prewarm al click,
  gestisce anche lo scambio rgba↔r8) e rilasciato da
  `maybeReleaseIdleLightGlazeResources` quando il glaze non è più selezionato
  e il motore è fermo — mai con sessione o tratto attivi, replay in corso o
  stamp in coda. Il replay Undo/Redo rialloca da solo e il frame successivo
  rilascia di nuovo. Pixel e commit invariati; cambia solo la residenza
  (−85,3 o −37,3 MiB quando si torna a Normal/Additive).
  `#70–#73` descrivono la semantica originale accettata; lo storage R8 corrente
  resta sperimentale finché non passa Golden GPU e prova percettiva.
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
- Riga «Cronologia stamp · RAM CPU» (con rev `39`): mostra il journal Undo/Redo
  (`historyStoredBaseStamps × 32 B`), unica voce CPU del pannello, **esclusa**
  dal totale GPU e dal badge di variazione. Rende visibile la crescita della
  cronologia — il tetto per l'uso prolungato resta un problema aperto. Le altre
  voci non conteggiate (swapchain, driver, tip preview) restano fuori perché
  sarebbero stime, non contabilità deterministica.
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
  (`r8-coverage`/`rgba-stroke`) e la relativa memoria.
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
- strategia compositing promossa 14e
  `merged-above-over-active-over-merged-below-source-over-evict-derived-before-rebuild-deferred-to-fold-fence-bounded-visual-rect`;
- una sola piramide raw, riusata dal livello attivo (`21,33 MiB` RGBA8,
  `42,67 MiB` RGBA16F);
- al massimo due superfici fuse, `mergedBelow` e `mergedAbove`. Ciascuna ha mip
  `0` più catena completa: `85,33 MiB` RGBA8 o `170,67 MiB` RGBA16F;
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
`mergedAbove over (active * activeLayerAlpha over mergedBelow)`, poi scacchiera e
conversione lineare→sRGB. Lo stesso ordine è cablato nei quattro percorsi:
permanente, Light/M1 Glaze live, coda spessore e display diretto dello style
stack. Visibilità e opacità dell'attivo passano nei tre slot prima
liberi della uniform da `48 byte`; cambiarle su un inattivo ricostruisce la
superficie fusa interessata, mentre sull'attivo basta invalidare la cache di
presentazione.

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
`single-active-full-inactive-256-array-tiles-rehydrate-fold`. Solo il livello
attivo conserva il mip `0` full-canvas (`64 MiB` RGBA8 / `128 MiB` RGBA16F),
così il disegno non paga paging o pass per tile. Quando si lascia un livello,
i tile conservativi `256×256` vengono copiati in una texture array compatta e
la texture full viene distrutta soltanto dopo che il nuovo livello è stato
reidratato e le superfici fuse sono state ricostruite con successo. Un livello
inattivo vuoto non conserva alcuna texture raw.

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
progresso worker sospendibile/riprendibile ai tratti.

## Strumento Blend dry (WebGPU)

Port del Blend proprietario di `paint-webgpu-m1`, solo modalità **dry** (non
aggiungere Wet senza richiesta esplicita). Tool separato (`tool: "blend"`),
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