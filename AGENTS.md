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
  `#70–#73` descrivono la semantica originale accettata; lo storage R8 corrente
  resta sperimentale finché non passa Golden GPU e prova percettiva.
- Grain M1 nativo: asset originale `graincottonfleece.PNG` RGBA `2500×2500`
  (SHA-256 `9AA1CE07…`), luma `0.299/0.587/0.114`, 12 mip NPOT generati in
  WGSL allo startup (~`31,8 MiB`). Fixed = UV layer; Moving = UV stamp (Scale
  disabilitato come in M1). Invert via segno dei coefficienti affini, nessun
  ramo WGSL. Non ridimensionare l'asset senza richiesta esplicita.
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
  un buffer persistente da `16 MiB`.
- Il risultato styled full-resolution non è più residente: a LOD `0` il
  fragment shader ricostruisce e quantizza direttamente i quattro texel da
  layer + coverage; restano materializzati solo i mip logici `1–12`, circa
  `21,3 MiB` RGBA8 o `42,7 MiB` RGBA16F. Il mip `1` viene sempre mantenuto dal
  compose GPU e i livelli superiori derivano da quello, così uno zoom-out non
  dipende da un ricalcolo tardivo. Il renderer golden temporaneo conserva un
  mip `0` separato solo per readback e non viene allocato nell'uso normale.
- Lo scratch dual-seed resta adattivo alla width: `1024²` (`16 MiB`) fino a
  `128 px`, `2048²` (`64 MiB`) da `129` a `512 px`; mask alpha e controllo
  costano ~`2,52 MiB`. Totale aggiuntivo v5 a width `≤128`: ~`55,9 MiB`
  RGBA8 o ~`77,2 MiB` RGBA16F; oltre `128`: ~`103,9 MiB` o ~`125,2 MiB`.
  Tutto resta lazy e viene liberato alla disabilitazione.
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
  pipeline/driver, RAM, cronologia o memoria del browser. Il report include ora
  anche la strategia di storage styled v5.
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
separati · `38` emulazione conversione UNORM nativa + diagnostica diff mip
(revisione sperimentale corrente del Paint).

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
