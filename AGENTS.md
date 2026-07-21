# Memoria operativa: ottimizzazione del tratto WebGPU

## Obiettivo

Il tratto deve seguire il dito con la minima latenza possibile su iPhone senza modificare il risultato visivo del pennello. Non cambiare `Count`, size, spacing, flow, hardness, blend intensity, jitter, seed, ordine degli stamp o modalità di blending per ottenere prestazioni migliori.

## Benchmark canonico

Il pulsante **Play tratto registrato** riproduce sempre lo stesso input umano e salva la run in D1. Il preset attuale usa:

- size `750 px`
- spacing `1%`
- `Count 16`
- flow `100%`
- hardness `100%`
- blend intensity `4x`
- blend normale premoltiplicato
- jitter master, cromatico e di posizione come registrati nel benchmark canonico

Baseline iPhone, run `#1` del 21 luglio 2026:

- durata traccia: `6843 ms`
- campioni input: `1583`
- stamp base: `12107`
- copie fisiche: `193712`
- frame renderizzati: `383`
- frame oltre `20 ms`: `35`
- intervallo frame p95: `29 ms`
- intervallo frame massimo: `67 ms`
- coda GPU dopo la fine dell'input: `310 ms`
- CPU frame p95: `1 ms`
- formato layer: `rgba8unorm`
- GPU: Apple; `timestamp-query` non disponibile

La CPU non è il collo di bottiglia principale. Il valore `estimatedScissorPixels` non rappresenta i frammenti realmente rasterizzati: è la somma delle bounding rectangle usate come scissor.

## Passo 1 scelto

Ogni copia era disegnata come un quad di 6 vertici; il fragment shader scartava gli angoli fuori dal cerchio. Con 193712 copie da 750 px questo crea molto fragment work inutile.

Il quad è stato sostituito da un dodecagono circoscritto procedurale, 12 triangoli e 36 vertici per copia. Il poligono include tutta l'area che il vecchio quad poteva colorare, compreso il margine dell'antialiasing. Il fragment shader continua inoltre a ritagliare il supporto originale `[-1, 1]`, quindi non deve comparire colore in pixel che prima erano esterni al quad.

Restano invariati:

- dati e ordine degli stamp
- numero di copie fisiche
- calcolo di posizione e colore del jitter
- cerchio, hardness, alpha e antialiasing
- blending e formato del layer
- timing e campioni del replay

Le run sperimentali salvano `stampGeometry: "circumscribed-12-gon"`, `stampVerticesPerCopy: 36`, `averageRenderFps` e mostrano FPS medi e frame oltre 20 ms nell'app.

## Criteri per decidere se tenere il passo 1

Eseguire il Play sullo stesso iPhone e confrontare con la run `#1`. L'intervento è valido solo se:

1. il comportamento e il risultato visivo non cambiano;
2. diminuiscono la coda GPU e/o i frame oltre 20 ms;
3. migliorano FPS medi e intervallo frame p95;
4. `Count 16`, size 750, spacing 1% e tutti gli altri parametri restano identici.

Non introdurre più interventi contemporaneamente: ogni nuovo passo va isolato e confrontato con il quad usando lo stesso replay.

Aggiornare questo file dopo ogni passo misurato, annotando la nuova run, il confronto con la baseline e la decisione di mantenere o annullare l'intervento. Non sostituire il benchmark canonico o i suoi parametri senza una richiesta esplicita dell'utente.

## Risultato e decisione del passo 1

Le run `#4` e `#5` usano `stampGeometry: "circumscribed-12-gon"`. Le run `#1`, `#2` e `#3` usano il quad. Tutte hanno lo stesso fingerprint della traccia, gli stessi parametri, lo stesso iPhone, canvas e formato layer.

| Metrica | Mediana run #1–#3 quad | Run #4 dodecagono | Run #5 dodecagono |
|---|---:|---:|---:|
| FPS medi | circa `54,76` | `53,92` | `54,15` |
| intervallo frame p95 | `32 ms` | `31 ms` | `33 ms` |
| intervallo frame massimo | `67 ms` | `117 ms` | `66 ms` |
| frame oltre 20 ms | `41` | `42` | `40` |
| coda GPU finale | `386 ms` | `378 ms` | `423 ms` |
| input delay p95 | `21 ms` | `25 ms` | `24 ms` |

Il dodecagono non produce un miglioramento misurabile: la media delle run #4 e #5 ha meno FPS, più coda GPU e più ritardo input della mediana quad. L'utente riferisce inoltre che il tratto segue il dito visibilmente peggio. Non serve una run #6: il passo 1 è rifiutato.

Il motore è stato quindi riportato al quad originale da 6 vertici per copia. La telemetria aggiunta durante l'esperimento (`averageRenderFps`, frame oltre 20 ms e identificazione `stampGeometry`) resta disponibile. Non reintrodurre il dodecagono: l'aumento da 6 a 36 vertici e i calcoli trigonometrici per vertice annullano il risparmio teorico dei frammenti su iPhone.

Il rollback quad è stato pubblicato come versione Sites `16` prima di iniziare l'esperimento successivo.

## Passo 2: backpressure della coda GPU — bocciato e rimosso

L'esperimento limitava il render interattivo a `2` submission GPU in volo. Se entrambi gli slot erano occupati, gli stamp continuavano a essere generati in FIFO dentro `pendingStamps`, ma non venivano rimossi dalla coda e non veniva creato un nuovo command buffer. Al completamento di una submission, `GPUQueue.onSubmittedWorkDone()` liberava lo slot e pianificava il frame successivo.

L'implementazione non usava `await` dentro `renderFrame`: il secondo slot doveva mantenere una submission pronta mentre la precedente veniva completata. Anche il benchmark GPU sintetico passava dallo stesso tracker.

L'esperimento non cambiava shader, quad, Count, spacing, jitter, seed o ordine degli stamp ed era indipendente dalla size. Con impostazioni fisse il risultato doveva restare visivamente invariato, ma i confini dei render pass potevano cambiare e non era garantita identità byte-per-byte su `rgba8unorm`.

Telemetria sperimentale salvata nella run `#10` ma rimossa dal runtime con il rollback:

- `submissionLimit`: limite configurato, attualmente `2`;
- `peakInFlightSubmissions`: massimo numero osservato in volo;
- `backpressureWaits`: episodi distinti di saturazione, non durata dell'attesa;
- `maxPendingStamps`: massimo backlog di stamp base, non copie fisiche;
- `submissionCompletionP50/P95/MaxMs`: tempo dalla submission al completamento del relativo prefisso di coda; include eventuale lavoro precedente e il ritardo del callback JS, quindi non è il tempo GPU isolato del command buffer.

La run iPhone valida del passo 2 è la `#10`; le run intermedie non appartengono tutte allo stesso asset/canvas e non vanno aggregate alla cieca. Confrontare soprattutto con la mediana quad `#1–#3` e con la `#9`, ultimo quad senza backpressure sullo stesso iPhone, canvas `860×850`, fingerprint e preset.

Non reintrodurre questo cap. Il buffer temporaneo trasparente non è prioritario: il motore fonde già tutte le copie del frame in un solo render pass e una texture intermedia aggiungerebbe passaggi, memoria e possibili differenze di quantizzazione.

## Risultato e decisione del passo 2

| Metrica | Mediana #1–#3 quad | Run #9 quad pre-cap | Run #10 cap 2 |
|---|---:|---:|---:|
| FPS medi | circa `54,76` | `53,81` | `25,71` |
| frame renderizzati | `376` | `369` | `184` |
| intervallo frame p95 | `32 ms` | `33 ms` | `100 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` | `466 ms` |
| frame oltre 20 ms | `41` (~`10,9%`) | `46` (~`12,5%`) | `74` (~`40,4%`) |
| batch massimo | `124` stamp | `105` stamp | `910` stamp |
| coda GPU finale | `386 ms` | `454 ms` | `331 ms` |
| input delay p95 | `21 ms` | `23 ms` | `15 ms` |
| fine presentazione | `7245 ms` | `7298 ms` | `7180 ms` |

Telemetria specifica #10: `peakInFlightSubmissions 2/2`, `67` episodi di saturazione, backlog massimo `910` stamp base, submit→fine coda p95 `314 ms` e massimo `536 ms`.

Il cap riduce la coda finale di `55 ms` rispetto alla mediana storica e di `123 ms` rispetto alla #9, ma sposta il collo di bottiglia in `pendingStamps`: i batch diventano circa 7–9 volte più grandi, gli aggiornamenti scendono a metà frequenza e il p95 sale a `100 ms`. Il piccolo miglioramento della durata totale non compensa la perdita netta di fluidità.

Decisione: passo 2 rifiutato. Il cap a 2 è stato rimosso e il motore è tornato alla schedulazione quad precedente. Il prossimo esperimento isolato consigliato è lo stesso quad come `triangle-strip` da 4 vertici.

## Passo 3: quad `triangle-strip` da 4 vertici — promosso

Implementazione pubblicata: il quad usa gli stessi quattro angoli e gli stessi due triangoli del baseline, ma viene emesso come `triangle-strip` con ordine `A, B, C, D` invece della `triangle-list` `A, B, C, C, B, D`. Le pipeline normal e additive usano entrambe `triangle-strip`; la pipeline di display resta `triangle-list`.

Restano invariati fragment shader, area coperta, diagonale condivisa, coordinate interpolate, dati e ordine degli stamp, Count, size, spacing, flow, hardness, blend intensity, jitter, seed e blending. Il cambiamento vale per tutte le size. `stampGeometry` resta `"quad"`, mentre `stampVerticesPerCopy` passa da `6` a `4` e identifica senza ambiguità l'esperimento nelle run.

Obiettivo: eliminare il `33%` delle invocazioni vertex per copia senza ridurre o approssimare l'area rasterizzata. Nel benchmark canonico significa passare da `1.162.272` a `774.848` invocazioni vertex. Il beneficio atteso è modesto; non cambiare contemporaneamente shader, coda GPU o batching.

La run valida del passo è la `#11`; il confronto usa la `#9` e la mediana quad `#1–#3` con lo stesso fingerprint `18982412`, preset, iPhone, canvas `860×850`, `12107` stamp base e `193712` copie fisiche.

Verifica locale prima della pubblicazione: build TypeScript riuscita e confronto affiancato WebGPU sulla stessa GPU NVIDIA Ampere. Dopo lo stesso benchmark sintetico da `2000` stamp e `48.000` copie, le catture complete delle due build (baseline a 6 vertici e `triangle-strip` a 4 vertici) sono risultate identiche byte per byte; quindi, per questo caso, geometria e compositing visibile sono invariati. Il singolo smoke test GPU ha misurato `69,50 ms` sulla baseline e `53,70 ms` sullo strip, ma non va interpretato come risultato prestazionale: la decisione resta affidata alla run canonica su iPhone.

## Risultato e decisione del passo 3

La run iPhone `#11` usa la versione Sites `19` e il commit `ecc0f39`. La comparabilità con la `#9` è completa: stesso fingerprint `18982412`, stessi `1583` punti, preset, user agent, iPhone, GPU Apple, DPR `3`, schermo `414×896`, canvas `860×850`, `12107` stamp base e `193712` copie fisiche. L'unica differenza intenzionale del motore è `stampVerticesPerCopy: 4` invece di `6`.

| Metrica | Mediana #1–#3 quad 6 vertici | Run #9 quad 6 vertici | Run #11 strip 4 vertici |
|---|---:|---:|---:|
| FPS medi | circa `54,76` | `53,81` | `56,48` |
| frame renderizzati | `376` | `369` | `388` |
| intervallo frame p95 | `32 ms` | `33 ms` | `27 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` | `51 ms` |
| frame oltre 20 ms | `41` (~`10,9%`) | `46` (~`12,5%`) | `33` (~`8,5%`) |
| batch massimo | `124` stamp | `105` stamp | `122` stamp |
| coda GPU finale | `386 ms` | `454 ms` | `286 ms` |
| input delay p95 | `21 ms` | `23 ms` | `16 ms` |
| fine presentazione | `7245 ms` | `7298 ms` | `7134 ms` |

Rispetto alla mediana storica, la `#11` guadagna circa il `3,1%` di FPS, riduce il p95 del `15,6%`, i frame ritardati del `19,5%` e la coda finale di `100 ms` (`25,9%`). Rispetto alla `#9`, guadagna circa il `5,0%` di FPS e riduce la coda finale di `168 ms` (`37,0%`). Il batch massimo `122` è dentro la normale variabilità del baseline e la CPU resta a `1 ms` p95.

Decisione: passo 3 promosso e mantenuto. Riduce le invocazioni vertex del `33,3%` (`1.162.272` → `774.848`) senza cambiare il risultato visivo e migliora tutte le metriche principali di fluidità della run canonica. Da ora la `#11` è la baseline di riferimento per i prossimi esperimenti; non ripristinare i 6 vertici salvo una regressione visiva riproducibile.

## Passo 4: colore flat sui soli vertici provocanti — ritirato

Il tentativo calcolava `jitteredLinearColor` soltanto sui vertici `0` e `2` del `triangle-strip`, cioè i primi vertici dei due triangoli, lasciando invariati geometria, stamp, parametri e blending. L'obiettivo era dimezzare i calcoli del colore per copia da `4` a `2`.

L'utente ha richiesto il rollback prima di una run canonica comparabile. Non esiste quindi un risultato prestazionale valido e non va dedotto che l'intervento fosse più veloce o più lento. Shader e telemetria sperimentale sono stati rimossi; il motore è tornato integralmente al passo 3 della run `#11`, con il colore calcolato su tutti e quattro i vertici. Non reintrodurre questo tentativo senza una richiesta esplicita.

## Passo preparatorio: telemetria CPU v2, nessuna ottimizzazione

Prima del prossimo esperimento è stata estesa la telemetria senza cambiare shader, pipeline, geometria, generazione o ordine degli stamp, impostazioni, render pass, chiamate di resize o aggiornamenti DOM. La run successiva alla `#11` deve quindi essere considerata una misura di controllo dello stesso motore, non una variante prestazionale.

`performanceTelemetryRevision: 2` identifica le nuove misure:

- `submitImmediateP50/P95/MaxMs`: tempo della sola codifica e submission già rappresentato dai vecchi `cpuFrameP50/P95/MaxMs`; i campi vecchi restano per confrontare le run storiche;
- `renderFrameTotalP50/P95/MaxMs`: percorso CPU dal principio di `renderFrame` fino alla pianificazione dell'eventuale frame successivo, inclusi resize, estrazione del batch, submission, contatori e callback DOM delle statistiche; esclude soltanto la registrazione della telemetria eseguita subito dopo la misura;
- `renderFrameOverheadP50/P95/MaxMs`: differenza per frame tra tempo totale e `submitImmediate`;
- `resizeCanvasTotalMs`, `batchExtractionTotalMs` e `statsPublishTotalMs`: somme sull'intero replay, utili per capire dove si trova l'overhead fuori dalla submission;
- `layerInputDispatchTotal/P50/P95/MaxMs`: tempo impiegato da `beginStrokeAtLayer` e `extendStrokeAtLayer` per consegnare i punti già convertiti al motore.

Il replay salva esplicitamente `inputDeliveryPath: "preconverted-layer-points"` e `pointerPipelineMeasured: false`: non misura `PointerEvent`, `getCoalescedEvents`, `getBoundingClientRect` o la conversione client→layer del disegno manuale. Non usare questa run per concludere che tale percorso sia gratuito. Dopo la misura di controllo, scegliere un solo intervento usando i dati; il candidato GPU isolato proposto è il fast path esatto della coverage nel fragment shader.

## Risultato della telemetria CPU v2: run #14

La run `#14` è la prima con `performanceTelemetryRevision: 2`. È confrontabile con le run `#11–#13`: stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, canvas `860×850`, `12107` stamp base, `193712` copie e quad strip da `4` vertici.

| Metrica | Mediana #11–#13 | Run #14 |
|---|---:|---:|
| FPS medi | `55,86` | `56,04` |
| intervallo frame p95 | `28 ms` | `28 ms` |
| intervallo frame massimo | `66 ms` | `67 ms` |
| frame oltre 20 ms | `36` | `35` |
| coda GPU finale | `292 ms` | `298 ms` |
| input delay p95 | `18 ms` | `17 ms` |
| fine presentazione | `7143 ms` | `7149 ms` |

La telemetria aggiuntiva non ha perturbato materialmente il benchmark: tutte le differenze rientrano nella variabilità delle run precedenti. Nella #14 sia `submitImmediateP95Ms` sia `renderFrameTotalP95Ms` sono `1 ms`; anche il massimo misurato del frame CPU è `1 ms`, contro `28 ms` di intervallo frame p95. La risoluzione di `performance.now()` su questo Safari è circa `1 ms`, quindi non usare questi percentili per distinguere frazioni di millisecondo, ma il margine è sufficiente per confermare che la CPU del replay non è il collo di bottiglia principale.

Sull'intero replay: `resizeCanvasTotalMs 5`, `batchExtractionTotalMs 4`, `statsPublishTotalMs 153` e `layerInputDispatchTotalMs 5`. L'aggiornamento DOM delle statistiche è il maggiore costo CPU esterno alla submission, circa `0,40 ms` per frame, ma da solo non spiega il p95 da `28 ms`. Potrà essere rimosso dal percorso per-frame in un esperimento separato, lasciando il timer da `500 ms`; non combinarlo con un esperimento GPU.

Decisione: mantenere la telemetria v2. Il fast path della coverage è stato poi provato isolatamente nella run `#15`; il risultato e il rollback sono documentati sotto.

## Passo 5: fast path della coverage fragment — bocciato e rimosso

Il fragment shader continua a calcolare `radiusSquared` e `fwidth(radiusSquared)` senza controllo di flusso. Dopo il discard esterno, inizializza `coverage = 1` e chiama `smoothstep` soltanto quando `radiusSquared > innerEdge`.

L'equivalenza vale per ogni hardness e size: `innerEdge <= 1 - antialiasWidth < 1 + antialiasWidth`, quindi quando `radiusSquared <= innerEdge` il vecchio `smoothstep` restituiva esattamente `0` e la vecchia coverage era esattamente `1`. Per tutti gli altri frammenti resta la stessa espressione e lo stesso discard. `fwidth` rimane prima del ramo per non spostare le derivate in controllo di flusso non uniforme.

Non sono cambiati geometria, pipeline, uniform, dati o ordine degli stamp, Count, size, spacing, flow, hardness, jitter, seed, pressione, alpha, blending, resize, aggiornamenti DOM o display pass. Il cambiamento vale per tutti i pennelli; con hardness `100%` dovrebbe evitare `smoothstep` sulla maggior parte dell'interno del disco, ma il driver potrebbe già ottimizzare il vecchio codice e il guadagno non è garantito.

La run `#15`, identificata da `fragmentCoverageStrategy: "interior-fast-path"`, è confrontabile direttamente con la `#14`: stesso fingerprint, preset, iPhone, canvas, numero di stamp e telemetria v2.

| Metrica | Run #14 coverage generica | Run #15 fast path |
|---|---:|---:|
| FPS medi | `56,04` | `55,17` |
| intervallo frame p95 | `28 ms` | `30 ms` |
| intervallo frame massimo | `67 ms` | `66 ms` |
| frame oltre 20 ms | `35` | `41` |
| coda GPU finale | `298 ms` | `351 ms` |
| input delay p95 | `17 ms` | `20 ms` |
| fine presentazione | `7149 ms` | `7203 ms` |

Il fast path perde circa l'`1,5%` di FPS, aumenta il p95 di `2 ms`, i frame lenti del `17%` e la coda finale di `53 ms`. L'utente ha inoltre osservato durante il tratto un calo live fino a circa `21 FPS`. Decisione: esperimento bocciato; la coverage generica con `smoothstep` è stata ripristinata. Non reintrodurre il ramo interno: su questa GPU Apple il lavoro evitato non compensa il costo complessivo della variante.

## Passo 6: riuso esatto di `copySeed` — promosso

Il vertex shader calcola già `copySeed = hash32(stamp.seed ^ (copyIndex * costante))` per il jitter di posizione. Con jitter colore per copia attivo, la vecchia `jitteredLinearColor` ricalcolava lo stesso hash. La nuova `jitteredLinearColorFromCopySeed` riceve direttamente il seed già disponibile.

Con `jitterPerCopy: true` usa lo stesso `copySeed` e rimuove una chiamata `hash32` per invocazione vertex: nel benchmark canonico sono `774848` hash evitati. Con `jitterPerCopy: false` calcola esplicitamente `hash32(stamp.seed)`, identico al vecchio indice copia `0`; quindi il comportamento resta invariato anche per gli altri pennelli. Il ramo dipende da una uniform ed è uguale per tutte le invocazioni della draw.

Sono ripristinati la coverage generica e tutti gli altri aspetti della run `#14`. La telemetria salva `fragmentCoverageStrategy: "generic-smoothstep"` e `colorSeedStrategy: "reuse-position-copy-seed"`. La prossima run va confrontata con la `#14`, non con la #15, e attribuisce l'eventuale differenza al solo riuso del seed.

### Risultato e decisione del passo 6: run #16

La run `#16` ha le firme previste ed è pienamente confrontabile con la `#14`: stesso fingerprint, preset, iPhone, canvas, `12107` stamp base, `193712` copie, quad strip da 4 vertici, coverage generica e telemetria v2.

| Metrica | Run #14 | Run #16 copySeed |
|---|---:|---:|
| FPS medi | `56,04` | `56,33` |
| intervallo frame p95 | `28 ms` | `28 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre 20 ms | `35` | `33` |
| coda GPU finale | `298 ms` | `292 ms` |
| input delay p95 | `17 ms` | `16 ms` |
| fine presentazione | `7149 ms` | `7142 ms` |

La #16 migliora gli FPS di circa lo `0,5%`, mantiene p95 e massimo, riduce di `2` i frame lenti e di `6 ms` la coda finale. Tutte le direzioni sono favorevoli. Su decisione esplicita dell'utente, il riuso di `copySeed` è promosso e mantenuto: è bit-identico, generale e non ha mostrato regressioni. Non ripristinare il calcolo duplicato salvo una regressione riproducibile.

## Passo 7: dirty rect direzionale conservativo — mantenuto

Il vecchio `packStamps` estendeva entrambi gli assi di `2 * radius * (jitterLinear + jitterLateral)`, come se i due jitter raggiungessero contemporaneamente il massimo su X e Y. Il vertex shader sposta invece il centro lungo la direzione normalizzata e la sua perpendicolare.

Il nuovo limite usa gli stessi valori `f32` caricati nel buffer. Normalizza le direzioni normali; nell'intorno prudenziale della soglia dello shader usa invece il vecchio limite isotropo, evitando che differenze minime di arrotondamento CPU/GPU possano restringere troppo lo scissor. Per ogni stamp direzionale calcola:

- `linearReach = 2 * radius * positionJitterLinear`;
- `lateralReach = 2 * radius * positionJitterLateral`;
- estensione X: `radius + abs(dirX) * linearReach + abs(dirY) * lateralReach + 2`;
- estensione Y: `radius + abs(dirY) * linearReach + abs(dirX) * lateralReach + 2`.

È un limite conservativo della somma dei due offset, non un'approssimazione della posizione effettiva di una singola copia. Il margine finale di `2 px` resta invariato. Non cambiano stamp, seed, jitter, geometria, shader, ordine, blending o pixel; cambia soltanto lo scissor del render pass. Vale per tutte le size e direzioni. Con entrambi i jitter al 100%, il limite per asse scende da `5r` a `3r` su tratti allineati agli assi e a circa `3,83r` nel caso diagonale.

La telemetria salva `dirtyRectStrategy: "directional-jitter-bounds"`. La prima run valida attesa è la `#17` e va confrontata direttamente con la `#16`, che mantiene lo stesso `copySeed` ma usa il dirty rect isotropo precedente. Oltre a FPS, p95, frame lenti e coda GPU, confrontare `estimatedScissorPixels`; questo contatore è la somma delle aree scissor per batch, non il numero di frammenti realmente rasterizzati.

### Risultato preliminare del passo 7: run #19

La prima run iPhone valida con `dirtyRectStrategy: "directional-jitter-bounds"` è la `#19`. La #17 è stata eseguita su GPU NVIDIA Ampere e la #18 usa ancora la build precedente, canvas `828×819` e un backlog anomalo; non sono confrontabili con questo esperimento. La #19 e la #16 hanno invece stesso fingerprint, preset, iPhone, canvas `860×850`, stamp, copie, shader e `copySeed`.

| Metrica | Run #16 bounds isotropi | Run #19 bounds direzionali |
|---|---:|---:|
| FPS medi | `56,33` | `56,19` |
| intervallo frame p95 | `28 ms` | `28 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre 20 ms | `33` | `37` |
| coda GPU finale | `292 ms` | `282 ms` |
| input delay p95 | `16 ms` | `17 ms` |
| fine presentazione | `7142 ms` | `7132 ms` |
| somma aree scissor | `4.002.660.960` | `2.538.336.064` |
| packing CPU totale | `3 ms` | `6 ms` |

L'area scissor stimata diminuisce di circa il `36,6%`, quindi il limite direzionale funziona come previsto. Tuttavia la fluidità non migliora: FPS `-0,3%`, p95 invariato e `4` frame lenti in più; soltanto coda finale e presentazione migliorano di `10 ms`. Questo conferma che `estimatedScissorPixels` non equivale a lavoro raster reale: la geometria dei quad delimitava già i frammenti e lo scissor più largo non li generava automaticamente.

Decisione esplicita dell'utente: mantenere il dirty rect direzionale. È conservativo, non ha prodotto regressioni visive, aggiunge soltanto circa `3 ms` di packing CPU sull'intero replay e potrà essere utile come base per il futuro binning a tile. Non presentarlo come un miglioramento FPS dimostrato e non rimuoverlo salvo clipping o regressione riproducibile.

## Passo 8: pipeline vertex specializzata per `Count 16` — bocciato e rimosso

Il benchmark canonico usa sempre `Count 16`. Nel vertex shader, ogni istanza deve ricavare `stampIndex` e `copyIndex` dividendo e calcolando il modulo per il numero di copie. Quando il divisore arriva da una uniform, il compilatore GPU non può necessariamente sostituire queste operazioni con il percorso più economico disponibile per la costante `16`.

L'esperimento aggiunge un `override` WGSL chiamato `SPECIALIZED_COPY_COUNT`. Il motore crea in anticipo quattro pipeline per ogni formato layer: normal e additive generiche, più normal e additive specializzate con valore `16`. Non vengono create pipeline mentre si disegna o quando si muove un controllo. La variante specializzata viene selezionata esclusivamente quando `settings.count === 16`; tutti gli altri Count continuano a usare la pipeline generica e la stessa uniform di prima.

L'intervento non cambia:

- numero, ordine o indice delle copie;
- formula dei seed, jitter, posizione o colore;
- stamp, size, spacing, flow, hardness, pressione o blend intensity;
- geometria, fragment shader, blending, scissor, batching o draw count;
- comportamento alle altre size: la specializzazione riguarda soltanto il divisore Count, non il raggio.

Per `Count 16`, sia il vecchio clamp della uniform sia l'override producono esattamente `16`; quindi `stampIndex`, `copyIndex` e tutti i valori successivi restano uguali. L'obiettivo è soltanto permettere al compilatore della GPU Apple di trattare divisione e modulo come operazioni a divisore costante. Il guadagno non è garantito e va deciso soltanto con la run iPhone.

La run `#20`, identificata da `brushPipelineStrategy: "count16-override"`, è direttamente confrontabile con la `#19`: stesso fingerprint `18982412`, preset, iPhone, GPU Apple, canvas `860×850`, stamp, copie, shader e dirty rect.

| Metrica | Run #19 pipeline generica | Run #20 pipeline Count 16 |
|---|---:|---:|
| FPS medi | `56,19` | `55,89` |
| intervallo frame p95 | `28 ms` | `28 ms` |
| intervallo frame massimo | `67 ms` | `66 ms` |
| frame oltre 20 ms | `37` | `36` |
| coda GPU finale | `282 ms` | `288 ms` |
| input delay p95 | `17 ms` | `18 ms` |
| fine presentazione | `7132 ms` | `7138 ms` |

Gli FPS diminuiscono di circa lo `0,5%`, il p95 resta invariato e coda GPU, ritardo input e fine presentazione peggiorano di poco. Le differenze rientrano nella variabilità normale, ma non esiste alcun guadagno che giustifichi quattro pipeline al posto di due. Il costo dominante resta il raster e il blending delle `193712` copie fisiche, non la divisione e il modulo del vertex shader.

Decisione: passo 8 bocciato. Override WGSL, pipeline Count 16, selezione automatica e relativo marker di telemetria sono stati rimossi. Il motore è tornato esattamente alla pipeline generica della run `#19`; non reintrodurre questa specializzazione senza nuovi dati che dimostrino un costo vertex rilevante.

## Passo 9: display lineare su target sRGB — in prova

Ogni frame viene concluso da un pass a pieno canvas. Sulla baseline `#19` significa circa `860 × 850 × 386 = 282 milioni` di invocazioni fragment del display, oltre al lavoro del pennello. Il vecchio display shader convertiva manualmente la scacchiera da sRGB a lineare, componeva il layer e riconvertiva ogni canale da lineare a sRGB con `pow` prima di scrivere nel target `unorm`.

L'esperimento configura il canvas `unorm` con una view compatibile `*-srgb`, crea la display pipeline per quel formato e usa la stessa view nel render pass. Il display shader ora:

- usa costanti lineari precalcolate per le due tonalità della scacchiera e per lo sfondo esterno;
- campiona e compone il layer nello stesso spazio lineare di prima;
- restituisce direttamente il colore lineare;
- lascia alla conversione hardware del target sRGB la codifica finale.

Non cambiano texture del layer, formato `rgba8unorm`, pixel permanenti, brush shader, stamp, Count, size, spacing, jitter, seed, pressione, blending, ordine, scissor, batching o draw count. L'intervento vale per tutte le size e tutti i pennelli perché riguarda soltanto la presentazione del layer sul canvas.

Il percorso è semanticamente equivalente, ma la conversione sRGB hardware e la precedente formula WGSL possono arrotondare diversamente prima della quantizzazione a 8 bit. Oltre alle metriche bisogna quindi controllare che luminosità, colori, bordi e scacchiera non cambino visibilmente. Non dichiarare identità byte-per-byte senza un pixel-diff sul dispositivo di destinazione. Inoltre `viewFormats` può avere un costo dipendente dall'implementazione: il guadagno non è garantito.

La telemetria salva `displayColorStrategy: "srgb-render-target"`. La prima run valida attesa è la `#21` e va confrontata con la `#19`, non con la pipeline Count 16 della `#20`. Servono stesso fingerprint, preset, iPhone, GPU Apple, canvas e numero di stamp. Valutare FPS medi, p95, frame oltre 20 ms, coda GPU, fine presentazione e soprattutto qualsiasi differenza visiva.
