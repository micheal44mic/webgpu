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

## Passo 9: display lineare su target sRGB — bocciato e rimosso

Ogni frame viene concluso da un pass a pieno canvas. Sulla baseline `#19` significa circa `860 × 850 × 386 = 282 milioni` di invocazioni fragment del display, oltre al lavoro del pennello. Il vecchio display shader convertiva manualmente la scacchiera da sRGB a lineare, componeva il layer e riconvertiva ogni canale da lineare a sRGB con `pow` prima di scrivere nel target `unorm`.

L'esperimento configura il canvas `unorm` con una view compatibile `*-srgb`, crea la display pipeline per quel formato e usa la stessa view nel render pass. Il display shader ora:

- usa costanti lineari precalcolate per le due tonalità della scacchiera e per lo sfondo esterno;
- campiona e compone il layer nello stesso spazio lineare di prima;
- restituisce direttamente il colore lineare;
- lascia alla conversione hardware del target sRGB la codifica finale.

Non cambiano texture del layer, formato `rgba8unorm`, pixel permanenti, brush shader, stamp, Count, size, spacing, jitter, seed, pressione, blending, ordine, scissor, batching o draw count. L'intervento vale per tutte le size e tutti i pennelli perché riguarda soltanto la presentazione del layer sul canvas.

Il percorso è semanticamente equivalente, ma la conversione sRGB hardware e la precedente formula WGSL possono arrotondare diversamente prima della quantizzazione a 8 bit. Oltre alle metriche bisogna quindi controllare che luminosità, colori, bordi e scacchiera non cambino visibilmente. Non dichiarare identità byte-per-byte senza un pixel-diff sul dispositivo di destinazione. Inoltre `viewFormats` può avere un costo dipendente dall'implementazione: il guadagno non è garantito.

La run `#21`, identificata da `displayColorStrategy: "srgb-render-target"`, è direttamente confrontabile con la `#19`: stesso fingerprint `18982412`, preset, iPhone, GPU Apple, canvas `860×850`, stamp, copie e dirty rect.

| Metrica | Run #19 display manuale | Run #21 target sRGB |
|---|---:|---:|
| FPS medi | `56,19` | `56,04` |
| intervallo frame p95 | `28 ms` | `28 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre 20 ms | `37` | `34` |
| coda GPU finale | `282 ms` | `308 ms` |
| input delay p95 | `17 ms` | `17 ms` |
| fine presentazione | `7132 ms` | `7157 ms` |

I frame lenti diminuiscono di `3`, ma gli FPS calano leggermente, il p95 non cambia e coda GPU e fine presentazione peggiorano di `26` e `25 ms`. Non c'è un miglioramento complessivo; il costo dipendente dall'implementazione della view sRGB probabilmente annulla il lavoro aritmetico eliminato.

Decisione: passo 9 bocciato. View sRGB, conversione hardware, costanti lineari e relativo marker sono stati rimossi. Il display è tornato esattamente alla conversione manuale della run `#19`. Non reintrodurre `viewFormats` senza nuove prove specifiche sulla GPU di destinazione.

## Passo 10: compute prepass per copia fisica — bocciato e rimosso

L'esperimento spostava direzione, seed, jitter di posizione e conversione colore dal vertex shader a un compute pass eseguito una volta per copia fisica. Una workgroup da `16` lane preparava un buffer `PhysicalCopy`; il vertex shader successivo leggeva centro, raggio, pressione e colore già calcolati. L'indice di uscita era `stampIndex * copyCount + copyIndex`, quindi ordine delle copie e blending restavano invariati. Il percorso supportava tutti i Count `1–24` e tutte le size.

La run `#22`, identificata da `copyPreparationStrategy: "compute-per-physical-copy"`, è direttamente confrontabile con la `#19`: stesso fingerprint `18982412`, preset, iPhone, GPU Apple, canvas `860×850`, `12107` stamp base e `193712` copie fisiche.

| Metrica | Run #19 vertex diretto | Run #22 compute prepass |
|---|---:|---:|
| FPS medi | `56,19` | `55,90` |
| intervallo frame p95 | `28 ms` | `29 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre 20 ms | `37` | `33` |
| coda GPU finale | `282 ms` | `316 ms` |
| input delay p95 | `17 ms` | `17 ms` |
| fine presentazione | `7132 ms` | `7166 ms` |
| encoding preparazione + brush | `20 ms` | `11 + 8 = 19 ms` |

Il pass riduce di quattro i frame oltre `20 ms`, ma perde circa lo `0,5%` di FPS, porta il p95 da `28` a `29 ms` e aggiunge `34 ms` sia alla coda GPU sia alla fine della presentazione. Il risparmio CPU misurato nell'encoding è soltanto `1 ms` sull'intero replay; non compensa il pass aggiuntivo e il traffico scrittura/lettura del buffer.

Decisione: passo 10 bocciato. Compute shader, pipeline, buffer `PhysicalCopy`, bind group, telemetria e marker sono stati rimossi. Il motore è tornato esattamente al percorso vertex diretto della run `#19`. Non reintrodurre il compute prepass senza una diagnosi nuova che elimini il passaggio intermedio di memoria.

## Handoff richiesto: prossimo salto architetturale

L'utente non vuole altri esperimenti di micro-ottimizzazione. Il prossimo lavoro deve affrontare il **layer persistente `4096×4096` suddiviso in tile con binning degli stamp/copie**, cioè il cambiamento strutturale con il maggiore potenziale su GPU Apple tile-based. Non riprovare fast path fragment, specializzazione Count 16, sRGB, compute prepass, dodecagono o cap della coda: sono già stati misurati e bocciati.

Prima di scrivere codice, progettare una prima fase isolabile e misurabile. Conservare rigorosamente ordine globale e relativo delle copie dentro ogni tile, formule WGSL, seed, jitter, Count `1–24`, tutte le size, spacing, pressione, alpha, blending premoltiplicato e risultato visivo. Gestire esplicitamente copie che attraversano più tile, antialiasing sui bordi, display/zoom e ricomposizione senza cuciture. Non ridurre la qualità e non dichiarare identità visiva senza una verifica pixel-diff.

La baseline per il nuovo lavoro è il commit successivo al rollback del passo 10 e la run iPhone `#19`. Il benchmark canonico resta size `750`, Count `16`, spacing `1%`, blend `4×`, `193712` copie. Aggiungere telemetria che identifichi senza ambiguità tile size, tile attive, assegnazioni/binning e pass eseguiti; cambiare una sola fase architetturale per run e pubblicarla prima del test iPhone.

Preferenza operativa esplicita dell'utente per la prossima chat: **lavorare senza agenti o subagenti; il modello principale deve leggere, progettare, implementare, revisionare e pubblicare da solo**.

## Passo 11: layer tiled 512 e binning stabile per copia — bocciato

La prima versione completa del salto architetturale sostituisce la singola texture persistente `4096×4096` con una `texture_2d_array` di `8×8` tile logiche da `512×512`. Ogni slice misura fisicamente `514×514`: il pixel aggiuntivo su ogni lato è un gutter usato dal display lineare. Il formato selezionato resta `rgba8unorm` o `rgba16float`; la memoria reale diventa rispettivamente circa `64,5 MiB` e `129,0 MiB`, quindi l'overhead dei gutter è inferiore all'1%.

Ogni batch viene impacchettato una sola volta nel buffer `Stamp` esistente. Un binning CPU a due passaggi visita le copie fisiche in ordine stamp-major/copy-minor, calcola le tile conservativamente intersecate e produce segmenti contigui per tile. Ogni riferimento è soltanto un `u32` con `stampIndex` e `copyIndex`; il vertex shader usa questi indici e continua a eseguire direttamente le formule WGSL originali per direzione, `copySeed`, jitter di posizione, jitter colore, pressione e geometria. Non è stato reintrodotto il compute prepass della #22 e non viene scritto alcun buffer `PhysicalCopy`.

L'ordine relativo delle copie dentro ogni tile è lo stesso della draw monolitica. Una copia che attraversa più tile viene inserita nello stesso punto relativo in tutte le tile interessate; ogni pixel logico appartiene comunque a una sola area centrale, quindi normal premultiplied e additive mantengono la stessa sequenza di blending. Il binning replica in JavaScript l'hash intero usato dallo shader soltanto per stimare il centro della copia. Usa i valori `f32` già impacchettati, un margine conservativo finale di `2 px` e, vicino alla soglia di normalizzazione della direzione WGSL, torna al limite isotropo prudenziale della baseline. Un errore di arrotondamento può quindi aggiungere un'assegnazione, non rimuovere la tile necessaria.

Per ogni tile attiva viene aperto un render pass sulla sola slice `514×514`, con scissor sull'area centrale `512×512`. La viewport include il gutter, così la geometria e le invocazioni helper restano disponibili attorno al bordo della tile; il gutter non riceve blending del pennello. Dopo avere composto tutto il batch, i bordi e gli angoli finali delle tile attive vengono copiati nei gutter dei vicini. Il display sceglie la slice dalle coordinate globali e usa il gutter con lo stesso sampler lineare, senza filtrare verso una slice diversa o verso trasparenza. Clear azzera tutte le 64 slice; zoom, pan, fit e composizione della scacchiera restano sul display pass esistente.

Non sono cambiati spacing, Count, size, flow, hardness, pressione, alpha, blend intensity, seed, sequenza degli stamp, formule del jitter, quad `triangle-strip`, coverage `smoothstep`, riuso di `copySeed`, conversione colore del display o formati del layer. Il percorso è generico per Count `1–24` e per tutte le size; la dimensione della tile non dipende dal preset canonico.

### Telemetria v3

`performanceTelemetryRevision: 3` aggiunge le firme `layerStorageStrategy: "tiled-2d-array"`, `tileBinningStrategy: "cpu-stable-physical-copy-references"` e `dirtyRectStrategy: "per-copy-tile-bounds"`, oltre a:

- `tileSizePx`, `tileGridWidth`, `tileGridHeight`, `tileGutterPixels`: configurazione fisica dell'esperimento;
- `activeTileVisits`: somma delle tile con almeno un'assegnazione in tutti i batch;
- `peakActiveTiles`: massimo numero di tile attive in un singolo batch;
- `physicalCopyTileAssignments`: riferimenti totali dopo la duplicazione conservativa delle copie multi-tile;
- `tileRenderPasses`, `tileBrushRenderPasses`, `tileClearRenderPasses`: pass totali, pass con copie e pass di clear;
- `tileGutterCopies`: copie GPU di bordi e angoli eseguite dopo i batch;
- `tileBinningMs` e `copyReferenceUploadMs`: costi CPU cumulativi del binning e dell'upload dei riferimenti;
- `estimatedTileAttachmentPixels`: somma di `514×514` per ogni pass tile, utile come proxy architetturale ma non come contatore hardware.

Da questo passo `estimatedScissorPixels` è la somma delle aree centrali `512×512` dei pass con pennello. Non è semanticamente confrontabile con il rettangolo sporco globale della #19 e non va usato da solo per dichiarare una riduzione dei frammenti.

### Verifica locale prima della pubblicazione

TypeScript e build Vite sono riusciti. La build di produzione ha inizializzato WebGPU su GPU NVIDIA Ampere in entrambi i formati, ha eseguito clear e benchmark sintetico senza errori di validazione e non ha mostrato cuciture ai confini delle tile nel confronto visivo affiancato. Le catture disponibili dal browser erano JPEG: il controllo esclude artefatti visibili e linee sui bordi, ma non dimostra identità byte-per-byte e non sostituisce il controllo visivo sull'iPhone.

Un singolo smoke sintetico locale da `2000` stamp base e `48000` copie, con impostazioni desktop predefinite e quindi non canoniche, ha misurato `24,20 ms` CPU submit e `55,70 ms` GPU completion sul tiled contro `4,50 ms` e `47,70 ms` sulla build #19. Il dato indica chiaramente il costo CPU del primo binning completo, ma non decide l'esperimento: usa GPU, size, Count, batching e percorso diversi dal replay iPhone. Non ottimizzare ulteriormente il binning prima della misura canonica, per non combinare fasi.

### Protocollo usato

La prossima run iPhone valida, attesa come `#23`, deve essere confrontata direttamente con la `#19`: fingerprint `18982412`, `1583` punti, canvas `860×850`, size `750`, Count `16`, spacing `1%`, blend `4×`, `12107` stamp base e `193712` copie fisiche. Verificare prima assenza di cuciture o variazioni di bordi, colore e accumulo; poi confrontare FPS medi, intervallo p95/massimo, frame oltre `20 ms`, coda GPU finale, input delay, fine presentazione e la nuova telemetria delle tile.

### Risultato e decisione: run #23

La run `#23` è pienamente confrontabile con la `#19`: stesso fingerprint `18982412`, traccia, preset, iPhone, GPU Apple, canvas `860×850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche. Le firme tiled e la telemetria v3 sono presenti.

| Metrica | Run #19 monolitica | Run #23 tile 512 |
|---|---:|---:|
| FPS medi | `56,19` | `34,67` |
| frame renderizzati | `386` | `243` |
| intervallo frame p95 | `28 ms` | `106 ms` |
| intervallo frame massimo | `67 ms` | `210 ms` |
| frame oltre 20 ms | `37` (~`9,6%`) | `53` (~`21,8%`) |
| batch massimo | `90` stamp | `493` stamp |
| coda GPU finale | `282 ms` | `231 ms` |
| input delay p95 | `17 ms` | `118 ms` |
| fine presentazione | `7132 ms` | `7132 ms` |

La coda finale diminuisce di `51 ms`, ma l'input delivery aumenta di `52 ms` e la fine della presentazione resta identica: il lavoro non viene concluso prima, viene consegnato più tardi e in batch molto più grandi. Gli FPS calano del `38,3%`, il p95 diventa `3,8×` più alto e l'input delay p95 cresce di quasi `7×`.

La causa è visibile nella telemetria: `1124798` assegnazioni, pari a `5,81` tile per copia fisica; `6436` pass con pennello, cioè `26,5` per batch; picco di `61/64` tile attive; `45356` copie dei gutter. L'encoding brush cumulativo passa da `20 ms` a `124 ms`. La minore area attachment stimata non compensa il costo dei pass, delle duplicazioni e delle transizioni; i frame lenti generano inoltre batch più grandi che toccano ancora più tile.

Decisione: la variante da `512 px` è bocciata. Questo risultato non boccia ancora il layer tiled in generale: boccia la granularità `8×8` con un pass per tile per il pennello canonico da `750 px`. Il commit `6446c38` resta il riferimento della #23; non usarlo come versione prestazionale.

## Passo 12: tile 1024, stessa architettura — miglioramento netto sul 512, ma ancora bocciato contro la baseline

Il secondo esperimento tiled cambia esclusivamente la granularità: `TILE_SIZE` passa da `512` a `1024`, la griglia da `8×8` a `4×4` e le slice fisiche da `514×514` a `1026×1026`. Binning stabile, riferimenti `u32`, ordine stamp-major/copy-minor, shader, formule, blending, gutter da `1 px`, display, clear, Count `1–24`, tutte le size e telemetria v3 restano identici alla #23.

La memoria reale diventa circa `64,25 MiB` per `rgba8unorm` e `128,50 MiB` per `rgba16float`. Nel percorso normale una copia canonica ha diametro geometrico `750 px`, inferiore alla tile da `1024 px`: può quindi intersecare al massimo `2×2 = 4` tile invece delle `3×3 = 9` possibili con tile da `512`. I pass attivi sono inoltre limitati a `16` per batch invece di `64`. Il fallback conservativo vicino alla soglia direzionale può aggiungere assegnazioni, mai rimuoverne.

L'aspettativa è un miglioramento consistente rispetto alla #23 per minori duplicazioni, pass e copie gutter. Non è garantito un miglioramento rispetto alla #19: ogni attachment attivo contiene circa quattro volte i pixel della variante 512 e un batch spazialmente ampio può ancora attivare tutta la griglia.

Verifica locale prima della pubblicazione: TypeScript e build Vite riusciti; inizializzazione, clear e benchmark sintetico completati senza errori WebGPU su NVIDIA Ampere sia in `rgba8unorm` sia in `rgba16float`, senza cuciture visibili sui confini a `1024 px`. Sullo stesso smoke non canonico da `2000` stamp e `48000` copie con impostazioni desktop predefinite, la variante 1024 `rgba8unorm` ha misurato `9,30 ms` CPU submit e `48,10 ms` GPU completion, contro `24,20 ms` e `55,70 ms` della variante 512 e `4,50 ms` e `47,70 ms` della #19 monolitica. È un segnale locale favorevole per la granularità 1024, non un risultato trasferibile all'iPhone.

La prima run valida attesa era la `#24`, ma quella run è stata registrata prima della pubblicazione della nuova build e riporta ancora `tileSizePx: 512`, griglia `8x8`, memoria `64,50 MiB` e le stesse `1124798` assegnazioni della #23. Non misura quindi questo passo e non deve essere usata come risultato del 1024.

### Risultato e decisione: run #25

La run `#25` è la prima misura valida del passo: riporta `tileSizePx: 1024`, griglia `4x4`, memoria `64,25 MiB` e tutte le firme attese. È pienamente confrontabile sia con la #23 sia con la #19: stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, canvas `860x850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche.

| Metrica | Run #19 monolitica | Run #23 tile 512 | Run #25 tile 1024 |
|---|---:|---:|---:|
| FPS medi | `56,19` | `34,67` | `47,20` |
| frame renderizzati | `386` | `243` | `326` |
| intervallo frame p95 | `28 ms` | `106 ms` | `50 ms` |
| intervallo frame massimo | `67 ms` | `210 ms` | `134 ms` |
| frame oltre 20 ms | `37` (~`9,6%`) | `53` (~`21,9%`) | `54` (~`16,6%`) |
| batch massimo | `90` stamp | `493` stamp | `303` stamp |
| coda GPU finale | `282 ms` | `231 ms` | `201 ms` |
| input delay p95 | `17 ms` | `118 ms` | `55 ms` |
| fine presentazione | `7132 ms` | `7132 ms` | `7090 ms` |

Il cambio di granularità funziona: rispetto alla #23 gli FPS aumentano del `36,2%`, il p95 scende da `106` a `50 ms`, il ritardo input p95 da `118` a `55 ms` e il massimo da `210` a `134 ms`. Le assegnazioni scendono da `1124798` a `547545` (`5,81` -> `2,83` per copia), i pass da `6436` a `2778` (`26,5` -> `8,5` per batch), il picco da `61/64` a `15/16` tile e le copie gutter da `45356` a `16099`. L'encoding brush cumulativo scende da `124` a `71 ms`.

Il confronto decisivo con la #19 resta però negativo per la fluidità: FPS `-16,0%`, p95 da `28` a `50 ms`, massimo raddoppiato, quota di frame lenti dal `9,6%` al `16,6%` e input delay p95 da `17` a `55 ms`. La coda finale migliora di `81 ms` e la presentazione termina `42 ms` prima, segnale che il tiled riduce parte del lavoro finale, ma lo ottiene con una cadenza interattiva molto peggiore. I `2778` render pass, la duplicazione media di `2,83x` delle copie e i batch più grandi restano troppo costosi; inoltre l'attachment stimato sale da `1,70` a `2,92` miliardi di pixel rispetto al 512 perché ogni slice attiva è quattro volte più grande.

Decisione: la granularità `1024` è nettamente migliore della `512` ed è il riferimento per eventuali studi futuri sul tiled, ma la presente architettura `texture_2d_array` con un render pass per tile attiva è bocciata come sostituto della baseline monolitica #19. Non presentare la minore coda finale come vittoria complessiva: il requisito principale è seguire il dito, e tutte le metriche di frame pacing rimangono significativamente peggiori.

## Passo 13: attachment scratch sulla dirty rectangle — bocciato e rimosso

Le run #23 e #25 mostrano che la riduzione dell'attachment può essere utile, ma che pass per tile, duplicazione delle copie e gutter distruggono il frame pacing. Questo passo elimina insieme quei tre costi senza tornare al render pass `4096×4096` della #19.

Il documento persistente torna a essere una singola texture `4096×4096`, `rgba8unorm` o `rgba16float`, identica per forma e memoria alla #19. Per ogni batch il motore:

1. impacchetta gli stamp una sola volta e calcola la stessa dirty rectangle direzionale conservativa della #19;
2. assicura una texture scratch dello stesso formato, arrotondata separatamente sui due assi a multipli di `128 px`;
3. copia la dirty rectangle dal layer persistente all'origine dello scratch;
4. esegue un solo render pass e una sola draw istanziata nello scratch;
5. ricopia la stessa regione, già composta, nella posizione originale del layer;
6. presenta campionando direttamente il layer monolitico con lo shader display della #19.

Lo scratch è riutilizzato e cresce soltanto quando il batch corrente non entra nella sua allocazione. Il replay esegue `clear()` e `waitForIdle()` prima di iniziare il profilo: in quel punto lo scratch precedente viene rilasciato, quindi ogni run parte senza una dimensione ereditata. Il clear del documento è un render pass separato sul layer persistente e non passa dallo scratch.

### Identità semantica e bordi

La draw usa di nuovo direttamente `instanceIndex / copyCount` e `instanceIndex % copyCount`, quindi l'ordine è esattamente stamp-major/copy-minor come nella #19. Non esistono riferimenti duplicati, segmenti per tile o riordinamenti: normal premultiplied e additive vedono la stessa sequenza di frammenti. Le copie che attraversano qualunque confine ideale restano quad interi nella stessa draw.

La dirty rectangle usa i valori `f32` realmente caricati nel buffer, la stessa soglia prudenziale per la direzione e il margine finale di `2 px` della #19. Origine di copia e scissor sono interi. La geometria completa e il margine di antialiasing sono quindi interni allo scratch; il bordo fisico e la parte arrotondata dell'allocazione non possono tagliare coverage o derivate. Non servono gutter e il display non campiona mai lo scratch.

Non sono cambiati stamp, Count `1–24`, size `4–1500`, spacing, flow, hardness, pressione, alpha, blend intensity, seed, jitter, formule WGSL del colore e della posizione, quad `triangle-strip`, coverage `smoothstep`, riuso di `copySeed`, formati o conversione display. Non è stato aggiunto compute e non è stato reintrodotto il buffer `PhysicalCopy` della #22.

Il percorso è semanticamente equivalente, ma il calcolo clip ora trasla le coordinate nello scratch e usa le sue dimensioni; il controllo locale esclude differenze visibili, non dimostra identità byte-per-byte sull'iPhone. Prima di giudicare le prestazioni bisogna verificare visivamente bordi, colore, accumulo e assenza di clipping con il replay canonico.

### Telemetria v4

`performanceTelemetryRevision: 4` identifica l'esperimento con:

- `layerStorageStrategy: "monolithic-2d"`;
- `brushAttachmentStrategy: "dirty-rect-scratch-copyback"`;
- `scratchSizingStrategy: "grow-only-128px-buckets"`;
- `scratchSizeQuantumPx: 128`.

Le nuove misure sono `scratchTextureAllocations`, `scratchBrushRenderPasses`, `layerClearRenderPasses`, `scratchCopyInOperations`, `scratchCopyOutOperations`, `scratchCopiedPixels`, `requestedScratchPixels`, `estimatedScratchAttachmentPixels`, `peakScratchWidthPx`, `peakScratchHeightPx`, `peakScratchAttachmentPixels` e `scratchAllocationMs`. `estimatedScissorPixels` torna ad avere la semantica della #19: somma delle dirty rectangle richieste. `estimatedScratchAttachmentPixels` conta invece l'intera allocazione scratch usata da ogni pass e rende visibile l'eventuale perdita dovuta alla crescita; `scratchCopiedPixels` include entrambe le direzioni.

### Verifica locale prima della pubblicazione

TypeScript e build Vite sono riusciti. Su GPU NVIDIA Ampere la pagina ha inizializzato WebGPU, ricreato il layer, eseguito clear e benchmark sintetici senza errori o warning di validazione in entrambi i formati. Sono stati provati gli estremi Count `1` e `24`, size massima `1500`, normal premultiplied e additive. Lo stesso output deterministico da `250` stamp è stato catturato affiancato sulla build finale e sulla #19: non mostra differenze, bordi, cuciture o clipping visibili. Le catture fornite dal browser sono JPEG e non identiche come file, quindi il controllo non dimostra identità pixel-per-pixel.

Lo smoke sintetico desktop predefinito da `2000` stamp e `48000` copie ha misurato `2,80 ms` CPU submit e `72,60 ms` GPU completion, con scratch `3456×3456`. È peggiore dei `47,70 ms` locali della #19 e dei `48,10 ms` della #25, ma il generatore sintetico distribuisce deliberatamente l'intero batch a spirale su quasi tutto il documento: misura il caso sfavorevole in cui copie e scratch grande si sommano, non il batching temporale della traccia iPhone. Il dato non autorizza a dichiarare un miglioramento e rende essenziale leggere nella prossima run sia l'area scratch cumulativa sia i tempi reali.

### Protocollo previsto

La prossima run valida, attesa come `#26`, va confrontata direttamente con la #19 e non aggregata con #23/#25: stesso fingerprint `18982412`, `1583` punti, canvas `860×850`, size `750`, Count `16`, spacing `1%`, blend `4×`, `12107` stamp base, `193712` copie e `rgba8unorm`. Prima controllare l'identità visiva; poi confrontare FPS medi, intervallo p95/massimo, frame oltre `20 ms`, input delay, coda GPU e fine presentazione. Per capire il risultato architetturale registrare anche allocazioni, scratch massimo, `requestedScratchPixels`, `estimatedScratchAttachmentPixels` e `scratchCopiedPixels`.

Questa variante può raggiungere l'obiettivo soltanto se il risparmio di load/store dell'attachment rispetto a `4096×4096` supera il costo delle due copie. Non promettere `60 FPS` prima della misura iPhone e non aggiungere altre modifiche alla stessa run.

### Risultato e decisione: run #27

La `#26` riportava ancora `layerStorageStrategy: "tiled-2d-array"`, tile da `1024 px` e telemetria v3: era quindi un'altra misura della build tiled e non misurava questo passo. La `#27` è la prima run valida dello scratch. È pienamente confrontabile con la `#19`: stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, canvas `860×850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche.

| Metrica | Run #19 monolitica diretta | Run #27 dirty scratch |
|---|---:|---:|
| FPS medi | `56,19` | `54,39` |
| frame renderizzati | `386` | `374` |
| intervallo frame p95 | `28 ms` | `31 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre `20 ms` | `37` (~`9,6%`) | `41` (~`11,0%`) |
| batch massimo | `90` stamp | `112` stamp |
| coda GPU finale | `282 ms` | `394 ms` |
| input delay p95 | `17 ms` | `23 ms` |
| fine presentazione | `7132 ms` | `7245 ms` |
| encoding brush cumulativo | `20 ms` | `28 ms` |

La variante peggiora tutte le metriche interattive principali: FPS `-3,2%`, p95 `+3 ms`, quattro frame lenti in più, input delay p95 `+6 ms` e coda finale `+112 ms`. La CPU frame resta a `1 ms` p95, quindi la regressione non deriva da lavoro JavaScript sul percorso critico; l'encoding brush cumulativo cresce comunque del `40%` per le operazioni aggiuntive.

La telemetria spiega il risultato. In `374` batch sono stati eseguiti `374` pass scratch, `374` copy-in e `374` copy-out, con `17` riallocazioni. Le dirty rectangle richieste sommano `2.460.844.630` pixel; la crescita monotona e l'arrotondamento portano gli attachment scratch realmente usati a `3.806.035.968` pixel. Il picco è `3328×3456`, cioè `11.501.568` pixel, il `68,6%` del layer intero e `43,875 MiB` in `rgba8unorm`. Le due direzioni di copia muovono complessivamente `4.921.689.260` pixel.

Come proxy, `374` pass diretti sul layer `4096×4096` equivalgono a `6.274.678.784` pixel di attachment. Lo scratch ne evita circa `2,469` miliardi, ma copia circa `4,922` miliardi di pixel: quasi due pixel copiati per ogni pixel di attachment evitato. Su questa implementazione Safari/Metal, il pass monolitico con scissor probabilmente beneficia già della gestione a tile interna; copie, transizioni e attachment scratch aggiuntivo costano più del risparmio teorico di load/store.

Decisione: passo 13 bocciato, senza una seconda run e senza tentare bucket più piccoli. Texture scratch, trasformazione delle coordinate, copy-in/copy-out, telemetria v4 e indicatori UI sono stati rimossi. Il runtime è tornato esattamente al percorso monolitico del commit `ad37505`, riferimento della run `#19`: un solo render pass diretto sul layer persistente, quad strip da quattro vertici, coverage generica, riuso di `copySeed`, dirty rectangle direzionale e telemetria v2. Non reintrodurre tiled per-pass o dirty scratch senza un'architettura che eviti sia la moltiplicazione dei render pass sia il copyback per batch.

## Variante selezionabile del replay: `Fur`

Il replay del tratto umano offre due test distinti senza modificare punti, timing o fingerprint della traccia registrata:

- `Base`: mantiene il benchmark canonico con cerchio, scatter `0%` e jitter di posizione laterale/lineare al `100%`;
- `Fur`: usa la Shape 2K, scatter di rotazione al `100%` e jitter di posizione laterale/lineare allo `0%`.

Tutti gli altri parametri del benchmark restano quelli canonici, inclusi size `750 px`, spacing `1%`, Count `16`, flow `100%`, hardness `100%`, blend intensity `4x`, jitter cromatico, seed e ordine degli stamp. La scelta salva `testVariant: "base" | "fur"` e le impostazioni effettive nella run. Non aggregare run `Fur` e `Base` come se misurassero lo stesso pennello e non sostituire il benchmark canonico con `Fur`.

## Esperimento Shape: supporto conservativo con alpha esatta — in attesa di run iPhone

La prima run `Fur` con il quad completo è la `#28`. Rispetto alla `#19` Base mantiene `12107` stamp e `193712` copie, ma scende a `49,24 FPS`, porta il p95 a `43 ms`, i frame oltre `20 ms` a `56` e la coda GPU finale a `691 ms`. La CPU resta a `1 ms` p95. Il costo nuovo dominante è il campionamento trilineare della maschera R8 2K su quasi tutto il quad: la Shape contiene soltanto `48190` pixel non nulli su `4194304`, circa l'`1,15%`.

L'esperimento mantiene integralmente la maschera `2048×2048`, la conversione bianco × alpha, tutti i mip generati, il sampler lineare/trilineare, hardness, pressione, alpha finale e blending. Non approssima o vettorializza l'alpha. All'avvio individua invece le componenti connesse non nulle della maschera; per l'asset attuale sono `6`. Ogni componente viene racchiusa in un bounding quad orientato lungo il suo asse principale.

I quad sono allargati di `34 px` nella sorgente. Questo margine contiene in modo conservativo il supporto bilineare dei mip `0–4`: con raggio almeno `128 px`, il LOD implicito non supera `3`, mentre il livello `4` è incluso come margine per il filtro trilineare e gli arrotondamenti. Sotto `128 px`, oppure se la maschera produce più di `8` componenti, il motore torna automaticamente al quad completo. Il ritaglio del supporto originale `[-1, 1]` resta nel fragment shader.

I sei quad possono sovrapporsi. Ogni vertice porta l'indice flat del proprio supporto; prima del campione, il fragment shader assegna la zona sovrapposta al rettangolo con indice più basso. Le derivate UV vengono calcolate prima di questo test e il campione usa `textureSampleGrad` con quelle stesse derivate, evitando derivate in controllo non uniforme. Ogni copia continua quindi a contribuire una sola volta per pixel e legge la stessa texture con lo stesso LOD e filtro del quad precedente.

La verifica CPU sulla maschera reale trova zero pixel potenzialmente non nulli esclusi dal supporto dei mip `0–4`. I sei quad richiedono `36` vertici per copia. La somma delle loro aree raster è circa il `37,43%` del quad completo; dopo l'assegnazione delle sovrapposizioni, la regione unica che può eseguire il campionamento è circa il `28,50%`. Questi valori descrivono la geometria sorgente, non garantiscono lo stesso risparmio GPU.

La telemetria identifica l'esperimento con:

- `stampGeometry: "oriented-support-quads"`;
- `stampVerticesPerCopy: 36` nel preset Fur;
- `fragmentCoverageStrategy: "shape-alpha-mask-2k"`, perché l'alpha non cambia;
- `shapeSupportStrategy: "exact-alpha-oriented-components"`;
- `shapeSupportRectangles: 6`;
- `shapeSupportMinimumRadius: 128`.

La prossima run Fur valida, attesa come `#29`, va confrontata direttamente con la `#28`, non con la `#19`: stesso test `Fur`, fingerprint, preset, Shape, scatter, canvas, stamp e copie. Prima controllare visivamente che non esistano clipping, linee mancanti o accumulo doppio nelle sovrapposizioni; poi confrontare FPS, p95/massimo, frame oltre `20 ms`, input delay, coda GPU e fine presentazione. Il precedente dodecagono da `36` vertici era più lento sul cerchio, quindi il nuovo supporto va mantenuto soltanto se la riduzione molto maggiore dei frammenti e dei campioni compensa lo stesso aumento vertex.

### Risultato run #30: supporto non attivato, build bocciata

La `#29` è un'altra misura Fur della build precedente e riporta ancora `stampGeometry: "quad"`, `stampVerticesPerCopy: 4`, senza i marker del supporto. La `#30` è la prima run eseguita con la build dell'esperimento, ma non misura i sei quad orientati: sull'iPhone l'estrazione runtime ha restituito zero rettangoli e ha attivato il fallback. Le firme effettive sono:

- `stampGeometry: "quad"`;
- `stampVerticesPerCopy: 6`;
- `shapeSupportStrategy: "full-quad"`;
- `shapeSupportRectangles: 0`;
- `shapeSupportMinimumRadius: 128`.

La run è confrontabile con `#28` e `#29`: stesso fingerprint `18982412`, `1583` punti, variante Fur, preset, iPhone, GPU Apple, canvas `860×850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche.

| Metrica | Run #28 full quad | Run #29 full quad | Run #30 fallback build esperimento |
|---|---:|---:|---:|
| FPS medi | `49,24` | `50,04` | `30,13` |
| frame renderizzati | `342` | `345` | `223` |
| intervallo frame p95 | `43 ms` | `38 ms` | `121 ms` |
| intervallo frame massimo | `103 ms` | `88 ms` | `447 ms` |
| frame oltre `20 ms` | `56` (~`16,4%`) | `54` (~`15,7%`) | `58` (~`26,0%`) |
| batch massimo | `237` stamp | `169` stamp | `584` stamp |
| coda GPU finale | `691 ms` | `686 ms` | `3118 ms` |
| input delay p95 | `37 ms` | `34 ms` | `153 ms` |
| fine presentazione | `7592 ms` | `7530 ms` | `10056 ms` |

Rispetto alla `#28`, la `#30` perde il `38,8%` di FPS, porta il p95 da `43` a `121 ms`, il massimo da `103` a `447 ms`, la coda GPU da `691` a `3118 ms` e l'input delay p95 da `37` a `153 ms`. Il batch massimo cresce da `237` a `584` stamp. La CPU resta a `1 ms` p95, quindi la regressione è nel percorso GPU e nel backlog che ne consegue.

La minore somma delle aree scissor della `#30` (`392.940.818` contro `515.214.998` nella `#28`) non è un miglioramento: la run renderizza molti meno frame e raggruppa batch molto più grandi. La misura non autorizza inoltre ad attribuire il costo a una singola istruzione: il fallback combina quad `triangle-list` da 6 vertici e il nuovo fragment shader con derivate esplicite/`textureSampleGrad`, senza ottenere alcuna riduzione dell'area campionata.

Decisione: la build dell'esperimento è bocciata e non serve ripetere una run Fur finché `shapeSupportRectangles` non vale `6`. La `#30` non boccia il concetto dei supporti sparsi, perché quel percorso non è mai stato attivato; boccia l'estrazione runtime e soprattutto il fallback della build attuale su Safari/iPhone. Ripristinare come versione pubblica il full quad precedente. Un eventuale nuovo tentativo deve usare supporti deterministici precomputati dall'asset, mantenere il fallback shader precedente e verificare le firme prima del benchmark.

## Esperimento Shape: pre-mappa di occupazione conservativa — promosso

Il nuovo tentativo non modifica più la geometria. Sia il percorso ottimizzato sia il fallback usano il vero quad `triangle-strip` da `4` vertici della run #28. È stato inoltre ripristinato integralmente il fragment shader legacy del full quad: usa `textureSample` implicito e non eredita né i `6` vertici né `textureSampleGrad` dal fallback fallito della #30.

All'avvio, mentre viene costruita la stessa catena di mip R8 della Shape 2K, il motore genera automaticamente cinque mappe cumulative di occupazione per i mip `0–4`. La griglia è `256×256`; ogni cella rappresenta `8×8` texel della maschera base. Una cella viene marcata quando almeno un texel non nullo di uno dei mip considerati può contribuire, includendo in modo conservativo il supporto bilineare del filtro. La procedura dipende soltanto dai pixel della maschera e vale quindi anche per future immagini dell'utente, senza rettangoli o coordinate specifiche per l'asset Fur.

Ogni mappa è un bitmask da `8192 byte`; le cinque mappe occupano complessivamente `40 KiB`. Sono caricate una volta in cinque buffer uniform separati e hanno bind group già creati: durante il disegno il motore sceglie il bind group corretto, senza upload o `queue.writeBuffer` aggiuntivi per batch. Il fragment shader calcola le derivate UV prima del test; nelle celle marcate esegue `textureSampleGrad` sulla texture R8 2K originale con la stessa catena mip, filtro lineare/trilineare, hardness, pressione, alpha e blending. Nelle celle non marcate scarta soltanto perché tutti i texel che il filtro può leggere sono dimostrabilmente zero. L'alpha non nullo non viene quantizzato, sostituito o approssimato.

La selezione è automatica e conservativa. Il motore torna al percorso legacy quando:

- il raggio minimo del batch è inferiore a `128 px`;
- il LOD richiesto supera il mip `4` preanalizzato;
- la mappa richiesta copre più del `50%` del quad, caso in cui il controllo preliminare difficilmente ripaga il proprio costo.

Per Fur a size `750 px`, pressure-size `0%`, il raggio è `375 px` e viene selezionata la mappa cumulativa fino al mip `2`. Sono attive `3633` celle su `65536`, cioè il `5,54%`: il campione esatto della Shape 2K viene quindi autorizzato su circa il `5,5%` del quad invece che sul `100%`. Le altre mappe dell'asset attuale coprono circa `3,82%`, `4,36%`, `7,87%` e `10,24%` rispettivamente ai livelli `0`, `1`, `3` e `4`.

### Verifica locale prima della pubblicazione

TypeScript e build Vite sono riusciti. Su GPU NVIDIA Ampere entrambi i percorsi hanno inizializzato WebGPU ed eseguito il benchmark senza errori o warning di validazione. A size `96 px` la telemetria conferma il fallback `quad Shape legacy da 4 vertici`; a size `750 px` conferma `bitmask alpha 256², mip 2, campioni 2K ammessi 5.5%`.

Con stesso viewport, seed e preset sintetico Fur, la regione canvas catturata dalla build candidata e dal full quad precedente ha zero canali differenti dopo la decodifica della cattura. Questo è un controllo visivo pixel-per-pixel della presentazione, non una lettura byte-per-byte del layer interno; la conservatività dell'alpha deriva invece dal fatto che vengono scartate soltanto celle con supporto filtrato interamente nullo.

Il test sintetico da `250` stamp, `4000` copie, size `750`, Count `16`, flow/hardness `100%`, blend `4×`, jitter posizione `0%`, normal premultiplied e `rgba8unorm` è rumoroso, ma il confronto sequenziale ha dato una mediana di `64,65 ms` sulla variante, contro `96,60 ms` sul full quad dopo aver escluso le prime due misure: circa `-33%` di GPU completion locale. Non promuovere il passo con questo dato desktop e non aspettarsi un miglioramento del `94,5%`: rasterizzazione del quad, test bitmask, blending e display restano invariati.

### Telemetria v5 e protocollo iPhone

`performanceTelemetryRevision: 5` identifica il candidato. Le firme richieste sono:

- `stampGeometry: "quad"`;
- `stampVerticesPerCopy: 4`;
- `fragmentCoverageStrategy: "shape-alpha-mask-2k"`;
- `shapeSamplingStrategy: "coarse-occupancy-bitmask"` per Fur a 750 px;
- `shapeOccupancyGridSize: 256`;
- `shapeOccupancyMipLevel: 2`;
- `shapeOccupancyActiveCells: 3633`;
- `shapeOccupancyCoverageRatio` circa `0,0554`;
- `shapeOccupancyBitmaskBytes: 8192` per la mappa attiva.

La prossima run Fur valida, attesa come `#31`, va confrontata con le #28 e #29, non con la #30: stesso fingerprint `18982412`, preset, iPhone, canvas `860×850`, `12107` stamp e `193712` copie. Prima verificare le firme e l'assenza di clipping; poi giudicare FPS medi, p95/massimo, frame oltre `20 ms`, input delay, coda GPU e fine presentazione. Mantenere il passo soltanto se migliora la risposta al dito sul dispositivo reale; il dato desktop è preparatorio.

### Risultato run #31: pre-mappa non attivata

La `#31` usa la versione pubblicata con telemetria v5 ed è pienamente confrontabile con le #28 e #29: stesso fingerprint `18982412`, `1583` punti, variante Fur, preset, iPhone, GPU Apple, canvas `860×850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie. Il quad legacy corretto da quattro vertici è stato ripristinato, ma la pre-mappa non è stata selezionata. Le firme effettive sono:

- `stampGeometry: "quad"`;
- `stampVerticesPerCopy: 4`;
- `shapeSamplingStrategy: "legacy-full-mask"`;
- `shapeOccupancyMipLevel: -1`;
- `shapeOccupancyActiveCells: 0` nella telemetria del percorso scelto;
- `shapeOccupancyCoverageRatio: 0` nella telemetria del percorso scelto.

| Metrica | Run #28 full quad | Run #29 full quad | Run #31 candidato in fallback |
|---|---:|---:|---:|
| FPS medi | `49,24` | `50,04` | `49,43` |
| frame renderizzati | `342` | `345` | `341` |
| intervallo frame p95 | `43 ms` | `38 ms` | `42 ms` |
| intervallo frame massimo | `103 ms` | `88 ms` | `100 ms` |
| frame oltre `20 ms` | `56` | `54` | `51` |
| coda GPU finale | `691 ms` | `686 ms` | `676 ms` |
| input delay p95 | `37 ms` | `34 ms` | `37 ms` |
| fine presentazione | `7592 ms` | `7530 ms` | `7532 ms` |
| batch massimo | `237` stamp | `169` stamp | `170` stamp |

Rispetto alla mediana delle #28–#29, la #31 ha FPS circa `-0,4%`, p95 `+1,5 ms`, quattro frame lenti in meno, coda finale `-12,5 ms` e input delay `+1,5 ms`. Le direzioni sono miste e rientrano nella variabilità normale del full quad. Non esiste quindi un miglioramento prestazionale misurato: il risultato atteso dal test desktop non è stato esercitato sull'iPhone.

Con size `750 px` e pressure-size `0%`, tutti gli stamp hanno raggio `375 px`; il selettore richiede quindi il mip `2`, ben dentro il limite `0–4`. Le condizioni su raggio e LOD non possono spiegare il fallback. Per esclusione, la mappa di occupazione costruita sull'iPhone ha superato la soglia del `50%`, invece del `5,54%` calcolato localmente. Questo è coerente con la #30, nella quale la stessa lettura runtime della PNG tramite `createImageBitmap` + canvas aveva restituito una topologia incompatibile con i sei componenti locali e aveva fatto ricadere l'estrazione a zero rettangoli.

Decisione: la #31 non promuove né boccia il costo GPU della pre-mappa, perché il relativo shader non è stato usato. Il fallback legacy è visivamente e prestazionalmente sicuro, ma il preprocessing della Shape non deve più dipendere dalla conversione canvas della piattaforma. Il prossimo candidato deve decodificare deterministicamente i byte della PNG grayscale 8-bit, usare lo stesso array R8 sia per la texture sia per la bitmask e salvare anche motivo del fallback e ratio calcolata prima della selezione. Non forzare l'attuale bitmask: se la mappa fosse davvero densa, aggiungerebbe il controllo senza eliminare campioni e potrebbe regredire.

## Correzione preparatoria: decodifica PNG grayscale deterministica

La Shape inclusa è una PNG `2048×2048`, grayscale 8-bit, non interlacciata, senza profilo colore né orientamento EXIF. Il runtime non usa più `createImageBitmap` e canvas per questo formato. Un decoder dedicato:

1. valida firma, `IHDR`, dimensioni, profondità, tipo colore e interlacciamento;
2. concatena i chunk `IDAT`;
3. decomprime il flusso zlib con `DecompressionStream("deflate")`;
4. ricostruisce le scanline applicando esattamente i filtri PNG `0–4`;
5. restituisce direttamente l'array R8 della sorgente.

Lo stesso identico `Uint8Array` viene usato per caricare il mip `0`, generare tutti i mip successivi e costruire le mappe di occupazione. Texture e bitmask non possono quindi più divergere a causa della conversione colore o della lettura canvas della piattaforma. La decodifica avviene una volta all'inizializzazione, fuori dal percorso del tratto. Per formati PNG non supportati o browser privi di `DecompressionStream` resta il decoder canvas precedente, identificato esplicitamente in telemetria; non viene forzata una bitmask quando il selettore giudica la mappa troppo densa.

### Verifica locale

TypeScript e build Vite sono riusciti. La decodifica diretta della sorgente produce:

- `4194304` byte R8;
- `48190` pixel non nulli;
- valore massimo `255`;
- somma dei campioni `9100015`;
- SHA-256 dell'array R8 `69978b6ecb707965204c7551789eb1a6ecab481c0959ea796cf0bfbe77b1b94c`.

Le cinque mappe cumulative ricostruite dallo stesso array hanno rispettivamente `2503`, `2860`, `3633`, `5158` e `6710` celle attive, cioè `3,8193%`, `4,3640%`, `5,5435%`, `7,8705%` e `10,2386%`. Fur a raggio `375 px` deve quindi scegliere il mip `2` e non può raggiungere la soglia fallback del `50%` se usa il decoder diretto.

### Telemetria v6 e protocollo previsto

`performanceTelemetryRevision: 6` aggiunge:

- `shapeMaskDecodeStrategy`: `"png-gray8-direct"` oppure `"canvas-fallback"`;
- `shapeOccupancyFallbackReason`: `"none"`, `"minimum-radius"`, `"mip-out-of-range"`, `"coverage-too-dense"` o `"mixed"`;
- `shapeOccupancyCandidateMipLevel`;
- `shapeOccupancyCandidateActiveCells`;
- `shapeOccupancyCandidateCoverageRatio`.

La prossima run Fur, attesa come `#32`, è valida per misurare finalmente la pre-mappa soltanto se riporta contemporaneamente:

- `shapeMaskDecodeStrategy: "png-gray8-direct"`;
- `shapeSamplingStrategy: "coarse-occupancy-bitmask"`;
- `shapeOccupancyFallbackReason: "none"`;
- mip selezionato e candidato `2`;
- celle selezionate e candidate `3633`;
- ratio selezionata e candidata circa `0,055435`;
- quad da `4` vertici.

Se anche una sola firma differisce, diagnosticare il motivo prima di leggere le prestazioni. Se tutte coincidono, confrontare #32 con #28–#29 su FPS, p95/massimo, frame oltre `20 ms`, input delay, coda GPU e fine presentazione. Non confrontare il guadagno con #30 e non attribuirlo alla decodifica: la decodifica corregge l'attivazione; l'eventuale differenza durante il tratto misura il pre-test bitmask e i campioni 2K evitati.

### Risultato e decisione: run #32

La `#32` riporta tutte le firme richieste ed è pienamente confrontabile con le `#28–#29`: stesso fingerprint `18982412`, `1583` punti, variante Fur, preset, iPhone, GPU Apple, canvas `860×850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche. La decodifica e il selettore hanno prodotto esattamente i valori deterministici previsti:

- `performanceTelemetryRevision: 6`;
- `shapeMaskDecodeStrategy: "png-gray8-direct"`;
- `shapeSamplingStrategy: "coarse-occupancy-bitmask"`;
- `shapeOccupancyFallbackReason: "none"`;
- mip selezionato e candidato `2`;
- celle selezionate e candidate `3633` su `65536`, ratio `0,0554351806640625`;
- quad `triangle-strip` da `4` vertici.

| Metrica | Mediana run #28–#29 full mask | Run #32 bitmask | Differenza |
|---|---:|---:|---:|
| FPS medi | `49,64` | `58,82` | `+18,5%` |
| frame renderizzati | `343,5` | `404` | `+17,6%` |
| intervallo frame p95 | `40,5 ms` | `17 ms` | `-58,0%` |
| intervallo frame massimo | `95,5 ms` | `67 ms` | `-29,8%` |
| frame oltre `20 ms` | `55` | `6` | `-89,1%` |
| coda GPU finale | `688,5 ms` | `21 ms` | `-96,9%` |
| input delay p95 | `35,5 ms` | `14 ms` | `-60,6%` |
| fine presentazione | `7561 ms` | `6882 ms` | `-679 ms` (`-9,0%`) |
| batch massimo | `203` stamp | `90` stamp | `-55,7%` |

La CPU resta a `1 ms` p95; il miglioramento deriva dal percorso GPU che evita il campione della Shape 2K nelle celle sicuramente vuote. Non deriva dalla decodifica PNG, che avviene una sola volta all'avvio e serve a rendere affidabile la selezione. Il p95 uguale alla mediana dei frame (`17 ms`) e la coda finale di soli `21 ms` indicano che il replay ora resta quasi sempre vicino ai `60 FPS`, invece di accumulare lavoro GPU durante l'input.

Decisione: pre-mappa promossa e mantenuta. Il risultato è ampio e coerente su tutte le metriche principali, mentre l'alpha non nullo continua a essere campionato dalla texture R8 2K originale con gli stessi mip, filtro, hardness, pressione e blending. Il bitmask elimina soltanto celle il cui supporto filtrato è dimostrabilmente nullo; il fallback legacy resta automatico per radius/LOD/copertura non convenienti. Non sostituire questo percorso con supporti geometrici specifici per Fur e non rimuovere la decodifica deterministica: insieme permettono la stessa ottimizzazione automatica anche per future Shape compatibili.

## Funzione Undo/Redo con cronologia CPU — candidato da misurare

Undo e Redo sono stati aggiunti come funzione isolata, senza modificare shader, pipeline, geometria, formule WGSL, stamp, Count, size, spacing, flow, hardness, pressione, alpha, blend intensity, seed, jitter, ordine delle copie, blending, scissor o percorso Shape promosso nella #32.

La cronologia è un journal CPU dei batch realmente inviati al renderer, identificato da:

- `historyStorageStrategy: "cpu-render-batch-journal"`;
- `historyStampRetentionStrategy: "shared-immutable-references"`;
- `historyReplayStrategy: "clear-and-stable-gpu-replay"`.

Durante il tratto non vengono create texture di snapshot, copie GPU, readback, render pass o submission aggiuntive. Gli array di stamp già estratti da `pendingStamps` vengono trattenuti senza copiare gli stamp; per ogni batch si conservano il riferimento alle impostazioni effettive, il flag di clear originale, dirty rect, selezione della bitmask Shape e identità hash della maschera. Il costo CPU nuovo sul percorso live è l'ID dell'azione assegnato allo stamp e un record per batch. Dopo un Undo, il primo stamp del ramo nuovo tronca il Redo logicamente in O(1); l'eventuale scansione per liberare i batch abbandonati viene rimandata alla successiva operazione esplicita di cronologia o a `Pulisci`, mai eseguita durante o subito dopo una pennellata.

Quando l'utente preme Undo o Redo, il motore attende che la coda corrente sia vuota, pulisce il layer e riproduce sulla GPU soltanto le azioni visibili, nello stesso ordine e con gli stessi confini brush/clear, impostazioni, scissor e selezione Shape registrati. I pass di display intermedi vengono omessi e il canvas viene presentato una volta alla fine. La cronologia quindi lascia invariato il carico GPU mentre si disegna; la GPU viene usata per la ricostruzione soltanto quando Undo/Redo viene richiesto. Un fallimento tenta di ripristinare cursore e layer precedenti.

`Pulisci` è un'azione annullabile. Il reset tecnico usato dal replay canonico azzera invece documento e cronologia prima della misura. Un cambio del formato layer azzera la cronologia soltanto dopo la creazione riuscita del nuovo layer. Pennello, zoom, formato e benchmark sintetico restano bloccati durante il replay canonico, così la run salvata non può dichiarare il preset fissato mentre l'utente lo modifica.

`performanceTelemetryRevision: 7` aggiunge:

- `historyCapturedBaseStamps` e `historyCapturedBatches`;
- `historyCommittedActions`;
- `historyStoredBaseStampsAtEnd`;
- `historyLogicalStampBytesAtEnd`;
- `historyReplayOperations`;
- le tre firme di strategia riportate sopra.

`historyLogicalStampBytesAtEnd` conta `32 byte` di payload logico per stamp e non è una misura dell'heap JavaScript: oggetti, riferimenti e array hanno overhead reale maggiore. Non usare questo campo per stimare la RAM totale su iPhone e non è ancora presente un limite della cronologia.

### Protocollo iPhone previsto

Servono una run `Base`, da confrontare con la `#19`, e una run `Fur`, da confrontare direttamente con la `#32`, perché sono le baseline promosse dei due percorsi. Devono restare invariati fingerprint `18982412`, `1583` punti, canvas `860×850`, formato `rgba8unorm`, size `750`, spacing `1%`, Count `16`, `12107` stamp base e `193712` copie fisiche; per Fur devono inoltre coincidere tutte le firme Shape della #32.

Prima di leggere le prestazioni verificare anche:

- `historyCapturedBaseStamps === baseStamps === 12107`;
- `historyCapturedBatches === brushBatches`;
- `historyCommittedActions === 1`;
- `historyReplayOperations === 0`;
- `historyStoredBaseStampsAtEnd === 12107`;
- `historyLogicalStampBytesAtEnd === 387424`.

Confrontare FPS medi, intervallo frame p95/massimo, frame oltre `20 ms`, input delay, coda GPU finale, fine presentazione, `renderFrameTotalP95Ms` e `layerInputDispatchTotalMs`. Non premere Undo/Redo durante il replay; i controlli sono disabilitati apposta. Dopo il salvataggio della run, provare separatamente Undo, Redo e Undo di `Pulisci`, controllando identità visiva e tempo di ricostruzione. Quella latenza non va confusa con l'influenza della cattura CPU sul tratto.

### Risultato e decisione: run #33 Base e #34 Fur

Le due run usano lo stesso fingerprint `18982412`, `1583` punti, preset canonico, iPhone, GPU Apple, canvas `860×850`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche delle rispettive baseline. Entrambe riportano `performanceTelemetryRevision: 7` e le tre strategie previste per la cronologia CPU.

La telemetria della cronologia è internamente coerente in entrambe le run:

| Contatore cronologia | Run #33 Base | Run #34 Fur |
|---|---:|---:|
| stamp catturati | `12107` | `12107` |
| batch catturati / brush batch | `387 / 387` | `404 / 404` |
| azioni confermate | `1` | `1` |
| stamp conservati a fine run | `12107` | `12107` |
| payload logico | `387424 byte` | `387424 byte` |
| operazioni di replay | `0` | `0` |

Questo conferma che ogni batch del tratto viene registrato una sola volta e che il benchmark non ha eseguito Undo o Redo. Durante il replay canonico non è stato quindi aggiunto lavoro GPU di ricostruzione.

#### Base: #33 contro #19

| Metrica | Run #19 senza cronologia | Run #33 con cronologia |
|---|---:|---:|
| FPS medi | `56,19` | `56,34` |
| frame renderizzati | `386` | `387` |
| intervallo frame p95 | `28 ms` | `28 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre `20 ms` | `37` | `34` |
| coda GPU finale | `282 ms` | `293 ms` |
| input delay p95 | `17 ms` | `17 ms` |
| fine presentazione | `7132 ms` | `7144 ms` |
| CPU frame p95 | `1 ms` | `1 ms` |

Le direzioni sono miste ma tutte entro la variabilità già osservata: FPS leggermente migliori, tre frame lenti in meno e p95 invariato, a fronte di `11 ms` di coda finale e `12 ms` di presentazione in più sull'intera traccia. Non emerge una regressione misurabile del tratto Base.

#### Fur: #34 contro #32

| Metrica | Run #32 senza cronologia | Run #34 con cronologia |
|---|---:|---:|
| FPS medi | `58,82` | `58,82` |
| frame renderizzati | `404` | `404` |
| intervallo frame p95 | `17 ms` | `17 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` |
| frame oltre `20 ms` | `6` | `6` |
| coda GPU finale | `21 ms` | `22 ms` |
| input delay p95 | `14 ms` | `14 ms` |
| fine presentazione | `6882 ms` | `6882 ms` |
| CPU frame p95 | `1 ms` | `1 ms` |

Le firme Shape coincidono esattamente con la #32: decoder `png-gray8-direct`, percorso `coarse-occupancy-bitmask`, nessun fallback, mip `2`, `3633` celle, ratio `0,0554351806640625`, bitmask da `8192 byte`, batch massimo `90` e somma delle aree scissor `580188708`. La sola differenza principale è `1 ms` di coda GPU finale, irrilevante alla risoluzione del timer. L'ottimizzazione Shape è quindi rimasta attiva e non mostra alcuna regressione.

Decisione: Undo/Redo con cronologia CPU è promosso e mantenuto. La cattura del journal non ha prodotto un costo misurabile sul tratto né Base né Fur; la #34 conferma inoltre che il percorso Shape ottimizzato della #32 è invariato. Le run non includono una cattura pixel, quindi l'identità visiva resta una verifica manuale separata. La ricostruzione GPU eseguita quando si premono Undo o Redo non è misurata da queste run e non va confusa con il costo nullo osservato durante il disegno. Il limite di memoria della cronologia resta un tema separato prima di un uso prolungato in produzione.

## UI full-canvas e navigazione touch — pubblicata, da misurare

L'implementazione è stata pubblicata come versione Sites `41` dal commit `0aa6f53`.

I pannelli dei controlli sono ora un cassetto sovrapposto al canvas: laterale su desktop e inferiore su schermi fino a `820 px`. Il pulsante menu nella barra superiore li apre e li nasconde completamente. Il canvas occupa sempre tutta l'area sotto la barra, indipendentemente dallo stato del cassetto; per questo chiudere il pannello non provoca un resize proprio all'avvio del test. Il pannello si chiude automaticamente quando partono il benchmark GPU sintetico, il replay canonico o la registrazione del tratto umano, e resta chiuso al termine finché l'utente non lo riapre.

La navigazione touch mantiene un dito per il disegno e usa due dita per pan e pinch-zoom simultanei, con lo zoom ancorato al punto medio del gesto. Dopo l'inizio di un gesto a due dita, l'eventuale dito rimasto sul canvas non ricomincia a disegnare finché tutte le dita non vengono sollevate. Se il secondo dito arriva prima che il primo stamp sia stato inviato alla GPU, `cancelStrokeBeforeRender()` rimuove quel solo tratto ancora pendente, ripristina seed e stato Redo e impedisce il punto accidentale; se il tratto era già stato renderizzato, viene concluso e conservato prima di passare alla navigazione. Questa cancellazione viene eseguita soltanto all'ingresso del gesto touch e non modifica il percorso normale di generazione o rendering del tratto.

`performanceTelemetryRevision: 8` aggiunge due firme di ambiente:

- `controlsLayoutStrategy: "full-stage-overlay-drawer"`;
- `touchNavigationStrategy: "two-finger-pan-pinch"`.

Non sono cambiati shader, pipeline, geometria, formule, stamp, seed del replay, Count, spacing, jitter, Shape, blending o journal Undo/Redo. Cambia però l'area visibile: su iPhone il canvas non cede più circa il `38%` dell'altezza al pannello inferiore. Le prossime run registreranno quindi un canvas più alto e includeranno un display pass più grande. Non confrontare direttamente i loro valori di GPU, FPS o coda finale con le #33–#34 come se fosse cambiato soltanto il pannello; acquisire una nuova coppia Base/Fur con pannello overlay, stesso dispositivo e stesse dimensioni canvas per stabilire il controllo del nuovo layout.

### Risultato full-canvas: run #35 Base e #36 Fur

Le `#35–#36` sono valide e usano lo stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, viewport `430×775`, formato `rgba8unorm`, `12107` stamp base e `193712` copie fisiche delle `#33–#34`. Riportano entrambe le firme UI v8 previste. Il canvas passa però da `860×850` (`731000` pixel) a `860×1454` (`1250440` pixel), cioè `+71,1%` di pixel per ogni display pass.

| Metrica Base | Run #33 pannello in layout | Run #35 full-canvas | Differenza |
|---|---:|---:|---:|
| FPS medi | `56,34` | `39,35` | `-30,2%` |
| frame renderizzati | `387` | `274` | `-29,2%` |
| intervallo frame p95 | `28 ms` | `67 ms` | `+39 ms` |
| intervallo frame massimo | `67 ms` | `312 ms` | `+245 ms` |
| frame oltre `20 ms` | `34` | `56` | `+64,7%` |
| coda GPU finale | `293 ms` | `1685 ms` | `+1392 ms` |
| input delay p95 | `17 ms` | `136 ms` | `+119 ms` |
| fine presentazione | `7144 ms` | `8572 ms` | `+1428 ms` |
| batch massimo | `110` | `508` | `+398` stamp |

| Metrica Fur | Run #34 pannello in layout | Run #36 full-canvas | Differenza |
|---|---:|---:|---:|
| FPS medi | `58,82` | `52,23` | `-11,2%` |
| frame renderizzati | `404` | `361` | `-10,6%` |
| intervallo frame p95 | `17 ms` | `35 ms` | `+18 ms` |
| intervallo frame massimo | `67 ms` | `66 ms` | `-1 ms` |
| frame oltre `20 ms` | `6` | `54` | `+800%` |
| coda GPU finale | `22 ms` | `491 ms` | `+469 ms` |
| input delay p95 | `14 ms` | `25 ms` | `+11 ms` |
| fine presentazione | `6882 ms` | `7374 ms` | `+492 ms` |
| batch massimo | `90` | `134` | `+44` stamp |

In entrambe le run la CPU resta a `1 ms` p95. I contatori della cronologia sono coerenti: `12107` stamp catturati e conservati, un'azione, `387424 byte` logici, zero replay e batch catturati uguali ai brush batch (`274` nella #35, `361` nella #36). La #36 mantiene inoltre esattamente decoder diretto, bitmask, nessun fallback, mip `2`, `3633` celle, ratio `0,0554351806640625` e bitmask da `8192 byte`. Non emerge quindi una regressione del journal o del percorso Shape.

Il totale dei pixel del display pass è circa `282,9 M` nella #33 contro `342,6 M` nella #35, e `295,3 M` nella #34 contro `451,4 M` nella #36, nonostante il numero inferiore di frame nelle nuove run. Poiché il lavoro CPU e tutte le firme brush restano invariati, i dati indicano che il target di presentazione più grande è la causa dominante della regressione. `estimatedScissorPixels` non include il display pass e non va usato per contraddire questa diagnosi.

Decisione: il layout full-canvas pubblicato è nettamente più lento alla risoluzione interna `860×1454`; le #35–#36 diventano il controllo del layout corrente, non nuove baseline prestazionali promosse. Non modificare Shape, brush shader o Undo/Redo per compensare. Il prossimo intervento isolato consigliato è mantenere il canvas CSS a tutto schermo ma limitare il buffer di presentazione a un budget vicino ai precedenti `731000` pixel, riducendo uniformemente la scala interna per conservare le proporzioni. Va valutata separatamente la nitidezza su iPhone e poi ripetuta la coppia Base/Fur.

## Esperimento: cache persistente di presentazione a piena risoluzione — promosso

La riduzione della risoluzione non è stata applicata. Il canvas resta alla risoluzione fisica corrente, quindi sul dispositivo delle #35–#36 rimane `860×1454`. È stata invece aggiunta una texture GPU persistente screen-space, nello stesso formato e con le stesse dimensioni della texture del canvas, che conserva il risultato già composto e convertito dallo shader display.

Il display shader è esattamente quello precedente: stesso campionamento lineare del layer monolitico `4096×4096`, stessa scacchiera, stessa composizione premoltiplicata e stessa conversione manuale lineare→sRGB. Cambia soltanto dove e su quanti pixel viene eseguito:

- alla creazione della cache, dopo un resize, pan, zoom, Fit, clear, cambio formato o ricostruzione Undo/Redo, lo shader ricostruisce l'intera cache;
- durante una pennellata con vista stabile, il dirty rect conservativo del layer viene trasformato in coordinate schermo e lo shader viene limitato a quello scissor;
- il rettangolo schermo viene ampliato di `2 px` nel layer e `1 px` nel canvas per includere il supporto del filtro lineare, gli arrotondamenti f32 e i confini interi dello scissor;
- se il dirty rect è completamente fuori dalla vista, la cache non viene aggiornata;
- la texture restituita dalla swapchain resta transiente: ogni frame copia quindi l'intera cache già pronta nella `currentTexture` tramite `copyTextureToTexture`. Il contesto richiede esplicitamente `COPY_DST`, mentre la cache usa `RENDER_ATTACHMENT | COPY_SRC`.

La copia finale continua a muovere tutti i pixel del canvas, ma non ripete su tutti quei pixel campionamento del layer, scacchiera e funzioni `pow`. Il vantaggio su Safari/Metal non è garantito: il costo della copia completa e del render pass parziale con `loadOp: "load"` deve essere deciso soltanto dalle run iPhone. Alla dimensione `860×1454`, la cache aggiunge circa `4,77 MiB` di memoria GPU con il formato canvas a 4 byte per pixel.

Non sono cambiati layer del documento, shader brush, quad `triangle-strip`, stamp, ordine, Count, size, spacing, flow, hardness, pressione, alpha, blend intensity, seed, jitter, dirty rect direzionale, Shape/bitmask, blending o journal Undo/Redo. Le submission omesse durante il replay della cronologia invalidano la cache; soltanto l'ultima presentazione la ricostruisce, evitando che una cache precedente possa sopravvivere a un layer ricreato.

### Telemetria v9

`performanceTelemetryRevision: 9` aggiunge:

- `presentationCacheStrategy: "persistent-full-resolution-screen-cache"`;
- `presentationTransferStrategy: "copy-texture-to-current-texture"`;
- `presentationCacheFullRebuilds` e `presentationCachePartialUpdates`;
- `presentationCacheOffscreenSkips`;
- `presentationCacheUpdatedPixels`: pixel sui quali è stato realmente eseguito lo shader display nella cache;
- `legacyDisplayShaderPixels`: pixel sui quali il percorso precedente avrebbe eseguito lo shader display completo;
- `presentationCopiedPixels`: pixel copiati dalla cache alla swapchain, normalmente uguali a `legacyDisplayShaderPixels`.

I contatori vengono accumulati nei dati della run e non introducono aggiornamenti DOM per frame. Nel replay canonico `resetDocument()` e il relativo full rebuild terminano prima dell'avvio del profilo; con vista e dimensioni stabili ci si aspetta quindi `presentationCacheFullRebuilds: 0`, un aggiornamento parziale per ogni batch visibile e `presentationCopiedPixels === legacyDisplayShaderPixels`.

### Verifica locale prima della pubblicazione

TypeScript e build Vite sono riusciti. Su GPU NVIDIA Ampere il nuovo uso `COPY_DST` della texture canvas, il render nella cache e la copia finale non hanno prodotto errori o warning WebGPU. È stata confrontata la build candidata con un worktree non modificato del commit `7aee64f`, sullo stesso browser, viewport, seed e sequenza di operazioni. Le catture PNG complete sono risultate identiche byte per byte dopo:

- benchmark sintetico deterministico da `2000` stamp e `48000` copie, che esercita un full rebuild;
- singolo stamp con cache valida, che esercita l'aggiornamento parziale;
- aggiornamento parziale dopo sei livelli di zoom;
- pan e zoom con ricostruzione completa;
- clear, Undo del clear e Redo;
- nuova inizializzazione alla viewport `430×775`.

Un harness temporaneo, rimosso dopo il test, ha verificato anche i contatori: un batch da `169` stamp ha prodotto `1` partial update e `2288` pixel display aggiornati contro `312610` pixel del percorso legacy; uno zoom ha prodotto `1` full rebuild da `312610` pixel; uno stamp completamente fuori vista ha prodotto `1` offscreen skip e `0` pixel aggiornati. In tutti e tre i casi la copia finale è rimasta di `312610` pixel, come richiesto dalla swapchain transiente.

### Protocollo iPhone previsto

Le prossime run valide, attese come `#37` Base e `#38` Fur, vanno confrontate direttamente con le #35 e #36: stesso fingerprint `18982412`, `1583` punti, viewport `430×775`, canvas `860×1454`, formato `rgba8unorm`, preset, `12107` stamp base e `193712` copie fisiche. Fur deve mantenere inoltre decoder `png-gray8-direct`, bitmask, nessun fallback, mip `2`, `3633` celle e ratio `0,0554351806640625`.

Prima di leggere le prestazioni verificare entrambe le firme di presentazione, `presentationCacheFullRebuilds === 0`, `presentationCachePartialUpdates === brushBatches`, `presentationCacheOffscreenSkips === 0` e `presentationCopiedPixels === legacyDisplayShaderPixels === renderFrames × 1250440`. Controllare anche che `presentationCacheUpdatedPixels` sia minore del valore legacy; la sua riduzione non prova da sola un guadagno hardware.

Confrontare FPS medi, p95/massimo, frame oltre `20 ms`, input delay p95, coda GPU finale e fine presentazione. Mantenere il candidato soltanto se il risultato visivo resta invariato e la fluidità migliora chiaramente su entrambe le varianti, soprattutto Base. Se la copia completa o il `loadOp` parziale annullano il risparmio, rimuovere l'esperimento senza modificare contemporaneamente brush o Shape.

### Risultato e decisione: run #37 Base e #38 Fur

Le run iPhone `#37` Base e `#38` Fur hanno tutte le firme previste e sono direttamente confrontabili con i controlli fullscreen `#35` e `#36`: stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, DPR `3`, viewport `430×775`, canvas `860×1454`, layer `rgba8unorm`, `12107` stamp base e `193712` copie fisiche. Fur mantiene decoder diretto, bitmask, nessun fallback, mip `2`, `3633` celle e ratio `0,0554351806640625`.

| Metrica | #35 Base pre-cache | #37 Base cache | #36 Fur pre-cache | #38 Fur cache |
|---|---:|---:|---:|---:|
| FPS medi | `39,35` | `57,50` | `52,23` | `59,25` |
| frame renderizzati | `274` | `396` | `361` | `408` |
| intervallo frame p95 | `67 ms` | `25 ms` | `35 ms` | `17 ms` |
| intervallo frame massimo | `312 ms` | `67 ms` | `66 ms` | `67 ms` |
| frame oltre `20 ms` | `56` | `25` | `54` | `3` |
| coda GPU finale | `1685 ms` | `224 ms` | `491 ms` | `19 ms` |
| input delay p95 | `136 ms` | `15 ms` | `25 ms` | `15 ms` |
| fine presentazione | `8572 ms` | `7084 ms` | `7374 ms` | `6892 ms` |
| batch massimo | `508` stamp | `88` stamp | `134` stamp | `88` stamp |

Rispetto al controllo fullscreen, Base guadagna il `46,1%` di FPS, riduce il p95 da `67` a `25 ms`, i frame lenti del `55,4%`, la coda finale dell'`86,7%` e la fine presentazione di `1488 ms`. Fur guadagna il `13,4%` di FPS, dimezza il p95, riduce i frame lenti del `94,4%`, la coda finale del `96,1%` e termina `482 ms` prima.

Il recupero non dipende da un confronto favorevole soltanto con le run degradate: rispetto al vecchio canvas `860×850`, la #37 supera la #33 di circa il `2,1%` negli FPS, porta il p95 da `28` a `25 ms`, i frame lenti da `34` a `25` e la coda da `293` a `224 ms`; la #38 è sostanzialmente equivalente o migliore della #34, con `59,25` contro `58,82` FPS, p95 identico a `17 ms`, `3` contro `6` frame lenti e coda `19` contro `22 ms`. La CPU resta a `1 ms` p95.

I contatori della cache sono coerenti. La #37 registra `396` aggiornamenti parziali per `396` brush batch, nessun rebuild e nessuno skip; lo shader display elabora `102525367` pixel invece dei `495174240` del percorso legacy, una riduzione del `79,3%`. La #38 registra `408/408` aggiornamenti parziali, nessun rebuild e nessuno skip; elabora `23499061` pixel invece di `510179520`, una riduzione del `95,39%`. In entrambe le run la copia finale resta esattamente pari ai pixel legacy, confermando che la swapchain riceve ogni frame completo. Questi contatori spiegano la direzione del risultato, ma non rappresentano tempo GPU isolato.

Decisione: cache persistente promossa e mantenuta. Le verifiche locali erano identiche byte per byte e le run Apple migliorano nettamente entrambe le varianti senza cambiare il layer o il pennello. Le #37 e #38 diventano le baseline prestazionali del layout fullscreen; le #35 e #36 restano i controlli pre-cache. Non sostituire la cache con una riduzione permanente della risoluzione e non rimuoverla salvo regressione visiva o incompatibilità riproducibile su un dispositivo supportato.

## Esperimento: Instant Preview adattiva a metà risoluzione — candidato, non pubblicato

Questo passo è costruito sopra la cache di presentazione promossa nelle #37–#38. Il percorso normale resta quello della #37/#38: gli stamp vengono renderizzati direttamente nel layer monolitico `4096×4096`, lo shader display originale aggiorna soltanto la dirty region della cache screen-space e la cache viene copiata nella swapchain. Se la preview non si attiva, shader, pipeline selezionate, render pass, ordine, journal e pixel finali del percorso promosso non cambiano.

Il candidato prealloca una texture trasparente document-space `2048×2048`, cioè scala lineare `0,5`, nello stesso formato del layer (`rgba8unorm` o `rgba16float`). Richiede `16 MiB` nel primo formato e `32 MiB` nel secondo. La texture viene creata e azzerata insieme alle risorse del layer, fuori dal profilo del replay. Non sostituisce mai il layer definitivo.

### Trigger passivo e isteresi

Safari/iPhone non espone `timestamp-query`, quindi il runtime non dichiara una percentuale di utilizzo GPU. Mantiene al massimo un probe `GPUQueue.onSubmittedWorkDone()` pendente e ne campiona uno ogni `4` submission interattive. La latenza del probe misura il completamento di un prefisso FIFO e include anche il ritardo con cui Safari esegue la callback JavaScript; è quindi una stima conservativa del ritardo della coda, non tempo GPU isolato.

La preview viene richiesta quando si verificano due probe consecutivi da almeno `42 ms`, oppure quando un singolo probe resta irrisolto per almeno `70 ms`. Due campioni riducono il rischio che un solo frame anomalo attivi Fur; la soglia bassa è circa due frame e mezzo a `60 Hz`, mentre quella urgente impedisce che un prefisso già molto arretrato debba prima completarsi. La #37 Base, con p95 `25 ms` e coda finale `224 ms`, dovrebbe attraversare la soglia durante il tratto; la #38 Fur, con p95 `17 ms` e coda `19 ms`, idealmente no. Questa distinzione deve essere verificata sull'iPhone e non è garantita dai soli dati storici.

Il probe non viene `await`-ato in `renderFrame`, non limita il numero di submission e non trattiene stamp prima dell'attivazione. Non è quindi il cap a due submission bocciato nella #10. Una volta attivata, la preview resta attiva per tutto il resto del tratto; non oscilla quando un probe successivo migliora.

### Overlay temporaneo e resolve esatto

Dall'attivazione in poi ogni batch live viene:

1. impacchettato con gli stessi stamp e le stesse impostazioni effettive;
2. registrato una sola volta nel journal Undo/Redo;
3. renderizzato soltanto nell'overlay `2048²`, con le stesse pipeline brush, stesso ordine stamp-major/copy-minor, seed, jitter, Count, coverage e blend;
4. conservato in FIFO per il resolve definitivo, senza inviarlo ancora al layer `4096²`.

Il vertex shader continua a usare `layerSize = 4096`, quindi la riduzione dipende esclusivamente dalla risoluzione dell'attachment. Per Shape, la bitmask della preview viene scelta usando il raggio effettivo moltiplicato per `0,5`: il LOD più grossolano resta conservativo e non può ritagliare texel che il filtro della preview può leggere. La selezione salvata nel journal resta invece quella del resolve esatto a piena risoluzione.

Una pipeline display separata, usata soltanto durante la preview, campiona layer definitivo e overlay. Per `normal` applica source-over premoltiplicato; per una sequenza omogenea `additive` somma il colore e conserva la stessa equazione source-over dell'alpha. Le due composizioni sono algebricamente equivalenti a sovrapporre quel segmento sul prefisso esatto, salvo campionamento e quantizzazione temporanei a metà risoluzione. Un cambio `normal`↔`additive` durante la preview forza prima un resolve sicuro: un singolo RGBA non rappresenta in generale una sequenza mista. Colore, size, Count, Shape e gli altri cambi con blend invariato restano rappresentabili.

Al lift, i batch differiti vengono risottomessi al layer definitivo con gli stessi array, impostazioni, dirty rect, scelta Shape e confini di render pass originali. Durante questo replay ogni chiamata usa `present = false`: non esiste quindi un frame che componga contemporaneamente overlay e stamp già riversati, e il contributo non può apparire doppio. L'ultima cache preview rimane visibile mentre il prefisso esatto completa. Soltanto dopo il relativo `onSubmittedWorkDone()` viene inviata una singola presentazione finale che:

- azzera l'overlay;
- ricostruisce tutta la cache con lo shader display originale e il solo layer esatto;
- copia la cache nella swapchain.

Un secondo completion chiude la sessione. `waitForIdle()` comprende sia il resolve esatto sia questa presentazione, quindi il profilo canonico termina soltanto dopo che il risultato definitivo è stato inviato. Un nuovo tratto iniziato nel frattempo conserva gli stamp in `pendingStamps`: `renderFrame` non li consuma durante il vecchio resolve e li pianifica appena la presentazione finale completa. Clear, Undo/Redo e cambio formato attendono lo stesso stato idle; `resetDocument()` rifiuta esplicitamente di agire durante preview/resolve. Pan, zoom e resize possono invalidare la cache mentre il resolve è in corso: la presentazione finale usa l'ultima vista disponibile. Device loss invalida sessione, probe e callback pendenti senza tentare di continuare su risorse perse.

### Telemetria v10

`performanceTelemetryRevision: 10` aggiunge le firme:

- `adaptivePreviewStrategy: "gpu-lag-triggered-half-resolution-overlay"`;
- `adaptivePreviewTriggerStrategy: "sampled-queue-prefix-latency"`;
- scala, memoria overlay, soglie, numero di probe consecutivi e intervallo di campionamento.

I contatori nuovi sono attivazioni e motivo, frame e tempo totale in preview, massimo numero stimato di submission interattive non completate, massima latenza probe, stamp/batch differiti e risolti, numero di resolve, CPU di enqueue, attesa della coda esatta, attesa della presentazione finale, fallback e motivo, full/partial update della cache mentre la preview è attiva e presentazioni finali. Non introducono aggiornamenti DOM per frame.

Se la preview si attiva correttamente devono valere:

- `adaptivePreviewDeferredBaseStamps === adaptivePreviewResolvedBaseStamps`;
- `adaptivePreviewDeferredBatches === adaptivePreviewResolvedBatches`;
- `historyCapturedBaseStamps === baseStamps === 12107`;
- `historyCapturedBatches === brushBatches`;
- `historyCommittedActions === 1` e `historyReplayOperations === 0`;
- `presentationCopiedPixels === (renderFrames + adaptivePreviewFinalPresentations) × canvasPixels` nel replay visibile senza skip;
- un solo resolve e una sola presentazione finale per la normale traccia a tratto singolo.

`adaptivePreviewMaxEstimatedInFlightSubmissions` è un limite superiore campionato: tra due probe può includere submission già concluse ma non ancora osservate. `adaptivePreviewMaxQueueProbeLatencyMs` include la callback JavaScript. Nessuno dei due campo è utilizzo GPU.

### Verifiche completate e test diagnostico

TypeScript e build Vite riescono. Due harness logici in memoria, non conservati nel repository, hanno verificato:

- nessuna attivazione con probe ripetuti da `17 ms`, attivazione dopo due probe da `50 ms` e percorso urgente oltre `70 ms`;
- conservazione di ordine e confini dei batch nel resolve;
- `present = false` per ogni batch esatto e zero presentazioni intermedie;
- presentazione finale inviata soltanto dopo la completion esatta e sessione mantenuta fino alla completion finale;
- input arrivato subito dopo il lift conservato e ripianificato, senza consumo durante il vecchio resolve;
- fallback prima del cambio normal/additive;
- equivalenza algebrica della composizione separata per segmenti normal e additive omogenei.

La build normale non espone un interruttore UI. Soltanto il server Vite in modalità `DEV` riconosce `?adaptivePreview=force`, che forza il ramo dal primo batch del tratto successivo; `import.meta.env.DEV` è `false` nella build di produzione. Il parametro serve a confrontare la preview mentre il resolve è pendente, il finale dopo il lift e il finale dopo Undo/Redo. Non trasformarlo in un controllo utente e non abilitarlo in produzione.

La verifica runtime WebGPU è stata poi eseguita dall'agente principale su GPU NVIDIA Ampere, confrontando il candidato con un worktree pulito di `c01ac1c` nello stesso browser e viewport. Durante la prima prova è stato trovato e corretto un errore nel `loadOp` dell'overlay: dal secondo batch veniva azzerata la preview già accumulata. Ora il primo batch riusa la texture trasparente preparata dal resolve precedente, oppure elimina un overlay stale dopo un errore; tutti i batch successivi della stessa sessione usano `load` e conservano il contenuto precedente. Dopo la correzione la preview è continua, senza le regioni rettangolari mancanti osservate nel prototipo iniziale.

Le prove runtime completate sono:

- percorso inattivo: benchmark sintetico deterministico da `2000` stamp, cattura PNG completa identica byte per byte a `c01ac1c`;
- preview forzata normal/circle con size `750`, spacing `1%`, Count `16`, flow/hardness `100%` e blend `4x`: risultato finale identico byte per byte alla baseline dopo la stessa sequenza di input;
- stesso confronto forzato con Shape 2K e scatter `100%`: finale identico byte per byte;
- stesso confronto con blending additive: finale identico byte per byte;
- Undo seguito da Redo dopo una sessione Shape: il crop del canvas dopo Redo è identico byte per byte al finale precedente;
- zoom richiesto mentre il resolve era ancora pendente: la presentazione conclusiva usa la nuova vista ed è identica byte per byte alla baseline zoomata dopo il completamento;
- secondo tratto inviato immediatamente dopo il primo, mentre il vecchio resolve poteva essere ancora in corso: nessuno stamp perso e canvas finale dei due tratti identico byte per byte alla baseline;
- nessun errore o warning WebGPU/console nelle prove candidata e baseline.

Una cattura diagnostica preview→finale sul canvas `628×629` visibile ha misurato, per Circle, differenza media assoluta `1,183/255` per canale, PSNR `38,70 dB` e soltanto lo `0,36%` dei pixel con differenza massima oltre `20/255`: lo scambio è difficile da percepire alla scala dello schermo desktop. Shape è volutamente meno fedele perché il dettaglio molto fine attraversa un attachment e un LOD a metà risoluzione: differenza media `9,385/255`, PSNR `24,21 dB` e `22,35%` dei pixel oltre `20/255`, pur mantenendo visivamente forma e densità del Fur. Sono misure diagnostiche su Ampere, non una decisione di qualità sull'iPhone.

I test logici già descritti coprono anche il fallback di blend. Restano utili, prima della promozione definitiva, una prova manuale iPhone del pop Shape e una verifica tattile di pan/pinch durante il resolve: lo zoom programmatico è corretto, ma non misura la sensazione dell'interazione a due dita. Il candidato non è promosso e non è stato pubblicato.

### Protocollo iPhone previsto

Dopo le verifiche locali, pubblicare una sola build candidata ed eseguire `#39 Base` e `#40 Fur` sullo stesso iPhone delle #37–#38, con fingerprint `18982412`, `1583` punti, viewport `430×775`, canvas `860×1454`, `rgba8unorm`, size `750`, spacing `1%`, Count `16`, `12107` stamp base e `193712` copie. Fur deve mantenere tutte le firme decoder/bitmask della #38.

Prima delle prestazioni verificare coerenza di history, stamp differiti/risolti e presentazione. Base dovrebbe avere una sola attivazione `queue-lag`; Fur idealmente zero. Confrontare separatamente:

- durante input: FPS, p95/massimo, frame oltre `20 ms`, input delay e batch massimo;
- dopo input: `inputToGpuCompletionMs`, `adaptivePreviewResolveEnqueueMs`, `adaptivePreviewResolveQueueMs`, `adaptivePreviewFinalPresentationQueueMs` e tempo totale in preview;
- qualità: vicinanza dell'overlay, assenza di doppio contributo e pop finale accettabile.

Promuovere soltanto se Base segue visibilmente meglio il dito senza attivazioni frequenti su Fur, il finale resta identico e il costo del resolve dopo il lift è accettabile. Un tail totale maggiore può essere il prezzo intenzionale del feedback temporaneo, ma va riportato esplicitamente e non nascosto dentro la nuova telemetria.

### Risultato iPhone: run #39 Base e #40 Fur — candidato non promuovibile

Le run `#39` Base e `#40` Fur usano la versione Sites `43` e sono pienamente confrontabili con le baseline cache `#37` e `#38`: stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, DPR `3`, viewport `430×775`, canvas `860×1454`, layer `rgba8unorm`, `12107` stamp base e `193712` copie fisiche. Fur conserva decoder diretto, bitmask, nessun fallback, mip `2`, `3633` celle e ratio `0,0554351806640625`.

| Metrica | #37 Base cache | #39 Base preview | #38 Fur cache | #40 Fur preview |
|---|---:|---:|---:|---:|
| FPS medi | `57,50` | `58,38` | `59,25` | `58,53` |
| frame renderizzati | `396` | `401` | `408` | `402` |
| intervallo frame p95 | `25 ms` | `17 ms` | `17 ms` | `17 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` | `67 ms` | `67 ms` |
| frame oltre `20 ms` | `25` | `8` | `3` | `8` |
| coda GPU finale | `224 ms` | `4416 ms` | `19 ms` | `1216 ms` |
| input delay p95 | `15 ms` | `16 ms` | `15 ms` | `15 ms` |
| fine presentazione | `7084 ms` | `11281 ms` | `6892 ms` | `8079 ms` |
| batch massimo | `88` stamp | `158` stamp | `88` stamp | `87` stamp |

La preview migliora realmente la cadenza live di Base: p95 `25→17 ms`, frame lenti `25→8` e FPS `+1,5%`. Si attiva però dopo il prefisso iniziale e differisce `9290` stamp (`76,7%` della traccia, `257` batch). Al lift deve quindi ridisegnare esattamente `148640` copie fisiche sul layer `4096²`: il solo `adaptivePreviewResolveQueueMs` è `4379 ms`, la coda finale cresce di `4192 ms` e la presentazione termina `4197 ms` più tardi. `adaptivePreviewTimeMs` raggiunge `8779 ms`, quindi l'overlay temporaneo resta coinvolto molto oltre la fine dell'input.

Fur doveva idealmente non attivarsi, ma due probe oltre la soglia lo attivano comunque (`max 55 ms`). Differisce `3416` stamp (`28,2%`, `100` batch) e aggiunge `1178 ms` di resolve; la coda passa da `19` a `1216 ms`, gli FPS calano dell'`1,2%` e i frame lenti salgono da `3` a `8`. I massimi probe `68 ms` Base e `55 ms` Fur mostrano che le soglie `42/70 ms` non separano in modo affidabile i due casi.

La correttezza è confermata in entrambe le run: stamp e copie invariati, journal completo, una sola azione, nessun fallback, batch e stamp differiti uguali a quelli risolti, un solo resolve e una sola presentazione finale. Non è stato perso o duplicato alcun contributo.

Decisione tecnica: il concetto di feedback a bassa risoluzione è validato per la fluidità durante Base, ma questa implementazione monolitica non va promossa. Sposta il collo di bottiglia dopo il lift e introduce una regressione enorme anche su Fur. Non tentare di salvarla cambiando soltanto la soglia: una soglia più alta può evitare Fur o ridurre gli stamp differiti, ma non elimina il costo strutturale di ridisegnare a fine tratto tutto il segmento rimandato. La versione `43` resta soltanto il candidato misurato finché non viene eseguito il rollback esplicito; la baseline promossa rimane la `42` con le run `#37–#38`.

## Esperimento successivo: tip preview Canvas2D senza debito GPU — candidato locale, non pubblicato

Questo candidato rimuove integralmente l'architettura differita della versione `43` e riparte dal renderer esatto promosso della versione `42`/commit `c01ac1c`. Ogni batch viene impacchettato, inviato una sola volta al layer WebGPU esatto e registrato nel journal nello stesso `renderFrame` della baseline. Shader, pipeline brush/display, `submitImmediate`, Count, ordine stamp-major/copy-minor, seed, jitter, Shape, blending e pixel permanenti restano invariati. Non esistono texture WebGPU di preview, batch differiti, resolve, replay esatti o presentazioni WebGPU speciali al lift.

### Trigger e patch transiente

Il trigger mantiene al massimo un solo `GPUQueue.onSubmittedWorkDone()` pendente, campionato ogni `4` submission quando la preview è inattiva. Un timeout irrisolto da `60 ms` attiva subito la patch; in alternativa servono due completion campionate consecutive da almeno `58 ms`. Queste durate misurano il completamento di un prefisso FIFO più il ritardo della callback JavaScript, non tempo GPU isolato né utilizzo percentuale.

Quando il trigger scatta, soltanto gli ultimi `2` stamp base vengono approssimati in una piccola patch Canvas2D screen-space:

- massimo `384×384` CSS pixel, mai un canvas trasparente full-screen;
- risoluzione lineare `0,5×` rispetto al backing WebGPU esatto per ciascun asse; con DPR limitato a `2` equivale a circa `1×` CSS su iPhone;
- budget sincrono JavaScript `1,25 ms`, con `0,2 ms` riservati al commit;
- supporto normal blend; additive disabilita la preview senza cambiare il percorso esatto;
- Circle ricostruisce seed, jitter di posizione e colore per copia;
- Shape usa il mip CPU `128×128` già derivato dalla stessa maschera decodificata, applica anche `mix(source², source, hardness)` e sceglie il colore più vicino da una palette pre-tinta di `12` sprite.

Il rendering è atomico: tutte le copie vengono prima disegnate su un canvas staccato. La patch visibile viene sostituita soltanto se l'intero frame termina entro il budget; uno sforamento, una patch troppo grande o una preparazione incompleta conserva l'ultimo bitmap completo. Non vengono mai pubblicate nuvole parziali di copie. Lo spostamento DOM usa `left/top`, non una trasformazione 3D forzata. Se la patch è già invisibile, pan/zoom/pinch ripetuti azzerano soltanto lo stato logico e non ripetono `clearRect` o scritture di stile.

Canvas2D è separato dalla coda WebGPU, ma Safari sceglie liberamente il backend di raster e compositing. Non dichiarare quindi che la patch sia garantita CPU-only o GPU-free. La telemetria `adaptivePreviewJs*` misura soltanto il lavoro JavaScript sincrono per preparare ed emettere i comandi Canvas2D e gli stili; non include raster differito, upload o compositing.

### Lift senza replay e ritiro della patch

Il replay canonico chiama `endStroke()` nello stesso rAF dell'ultimo input, prima del normale `renderFrame` successivo. Al lift il candidato aggiunge quindi alla patch gli ultimi stamp ancora presenti in `pendingStamps` come candidati provvisori, senza inviarli alla GPU. Quando il normale `renderFrame` della baseline consuma quel batch, i candidati vengono legati per identità al relativo seriale esatto. La patch resta congelata finché il prefisso esatto più recente che rappresenta non completa; viene rimossa soltanto nel rAF successivo alla completion, lasciando alla texture WebGPU il tempo di essere presentata.

Questo passaggio non chiama `queue.submit`, non estrae stamp dalla FIFO, non crea un batch aggiuntivo e non ridisegna nulla nel layer. Anche il catch-up durante un tratto attivo rimuove la patch soltanto in un rAF successivo alla completion, mai direttamente nella microtask di `onSubmittedWorkDone()`. Un eventuale clear di catch-up già pianificato viene cancellato prima di congelare la patch, evitando che il retirement frozen resti senza callback.

Nuovo stroke, cambio impostazioni, clear/reset, Undo/Redo, formato, resize, fit, pan, zoom e device loss invalidano deterministicamente la patch e usano un token di generazione per ignorare callback stale. Un secondo stroke o un pinch arrivato prima del rAF di retirement va incluso nello stress test manuale, perché l'invalidazione intenzionale privilegia la nuova interazione e può rimuovere subito il vecchio tip transiente.

### Telemetria v11 e invarianti

`performanceTelemetryRevision: 11` salva strategia, scala rispetto all'esatto, budget JS, dimensione massima, intervallo e soglie complete del trigger, attivazioni, frame/copie disegnate, skip atomici o oversized, pixel della patch, tempi JS, durata, latenza probe, stamp non confermati, retirement e freeze. `adaptivePreviewLiftPendingBaseStamps` conta i candidati provvisori conservati al lift; `adaptivePreviewLiftPendingSerialBindings` conta quanti vengono poi associati al normale batch esatto.

Per ogni run valida devono valere:

- `adaptivePreviewDeferredBaseStamps === 0`;
- `adaptivePreviewResolvedBaseStamps === 0`;
- `adaptivePreviewExactReplayBatches === 0`;
- `adaptivePreviewLiftGpuSubmissions === 0`;
- `adaptivePreviewExactBaseStampsSubmitted === baseStamps`;
- `adaptivePreviewExactBatchesSubmitted === brushBatches`;
- `adaptivePreviewLiftPendingSerialBindings === adaptivePreviewLiftPendingBaseStamps` quando la preview è congelata con un tip pending;
- history, stamp, copie, cache di presentazione e firme Shape identici alla baseline `#37–#38`.

Soltanto Vite `DEV` riconosce `?adaptivePreview=force` ed espone `window.__brushEngine` con `getAdaptivePreviewDiagnostics()` per il test della sequenza completion → catch-up pianificato → `endStroke()` prima del rAF. La build di produzione elimina sia il parametro force sia l'hook globale.

### Verifiche locali completate e protocollo iPhone

TypeScript, Vite e preparazione Sites riescono. `src/shaders.ts` è identico al commit `c01ac1c`; il corpo di `submitImmediate` è identico dopo normalizzazione dei newline e nel sorgente esiste una sola chiamata `device.queue.submit`, quella del renderer esatto della baseline. `git diff --check` non segnala errori. Il candidato non è stato pubblicato e non è promosso.

Gli smoke test runtime forzati sono stati completati nel browser locale su GPU NVIDIA Ampere:

- Circle con preset canonico: patch osservata durante il drag e ritirata al termine senza residui;
- Shape/Fur con size `750`, spacing `1%`, Count `16`, flow/hardness `100%`, blend `4x` e scatter `100%`: patch osservata in `16/55` campioni di polling e poi nascosta;
- due tratti immediatamente consecutivi: patch osservata in entrambe le finestre attive e stato finale nascosto;
- Undo e Redo Shape: replay completati, controlli ripristinati e nessuna patch stale;
- zoom seguito da Fit durante il retirement: invalidazione riuscita e patch finale nascosta;
- console senza errori o warning applicativi; soltanto messaggi debug di Vite.

L'audit statico indipendente non ha rilevato P0/P1 e ha verificato anche la race catch-up pianificato → lift, il binding per identità del tip pending e l'aggiornamento atomico tramite scratch canvas. Il gesto pinch reale e il pop percepito non sono valutabili in modo affidabile con il mouse del browser: restano controlli tattili da fare sull'iPhone dopo la pubblicazione.

Dopo la pubblicazione ripetere Base e Fur sullo stesso iPhone delle `#37–#38`. Confrontare soprattutto fluidità durante input e coda finale: l'obiettivo è rendere il tip leggibile quando la coda arretra senza spostare lavoro WebGPU al lift. Se `adaptivePreviewJsP95Ms` supera stabilmente il budget, gli skip sono frequenti, il compositing peggiora la GPU o il cambio patch→esatto resta visibile, rimuovere il candidato senza modificare contemporaneamente il renderer esatto.

### Risultato iPhone preliminare: run #42 Base e #43 Fur

Le run `#42` Base e `#43` Fur usano la versione Sites `44` e sono pienamente confrontabili con le baseline cache `#37` e `#38`: stesso fingerprint `18982412`, `1583` punti, preset, iPhone, GPU Apple, DPR `3`, viewport `430×775`, canvas `860×1454`, layer `rgba8unorm`, `12107` stamp base e `193712` copie fisiche. Fur conserva decoder diretto, bitmask, nessun fallback, mip `2`, `3633` celle e ratio `0,0554351806640625`.

| Metrica | #37 Base baseline | #42 Base tip patch | #38 Fur baseline | #43 Fur tip patch |
|---|---:|---:|---:|---:|
| FPS medi | `57,50` | `56,49` | `59,25` | `59,26` |
| intervallo frame p95 | `25 ms` | `26 ms` | `17 ms` | `17 ms` |
| intervallo frame massimo | `67 ms` | `66 ms` | `67 ms` | `66 ms` |
| frame oltre `20 ms` | `25` | `33` | `3` | `3` |
| coda GPU finale | `224 ms` | `256 ms` | `19 ms` | `18 ms` |
| input delay p95 | `15 ms` | `16 ms` | `15 ms` | `15 ms` |
| fine presentazione | `7084 ms` | `7105 ms` | `6892 ms` | `6891 ms` |
| batch massimo | `88` stamp | `93` stamp | `88` stamp | `88` stamp |

La correttezza architetturale è confermata in entrambe le run: stamp e copie invariati, journal completo, una sola azione, nessun replay history, zero stamp differiti/risolti, zero replay esatti e zero submission GPU speciali al lift. Gli stamp esatti inviati coincidono con `baseStamps`, i batch esatti coincidono con `brushBatches` e nella #42 i `2` stamp pending congelati al lift sono stati entrambi legati al normale seriale esatto.

Nella #42 la preview si attiva due volte, pubblica `201` patch complete, rappresenta `402` stamp base e `6432` copie fisiche. Il lavoro JavaScript sincrono totale è `156 ms`, con p95 `1 ms`, massimo `3 ms` e `9` skip di budget; la patch massima è `82944` pixel backing. La sessione più lunga dura `2816 ms`, la latenza massima del probe raggiunge `461 ms` e il backlog massimo osservato è `1745` stamp base. Rispetto alla #37 gli FPS scendono dell'`1,77%`, il p95 aumenta di `1 ms`, i frame lenti aumentano di `8` e la coda finale di `32 ms`. `renderFrameTotalP95Ms` passa da `1` a `2 ms` e `resizeCanvasTotalMs` da `10` a `60 ms`; una sola run non basta per attribuire con certezza quest'ultimo aumento, ma è compatibile con overhead DOM/layout della patch e va ricontrollato.

La #43 è invece sostanzialmente identica alla #38: la latenza probe massima è `44 ms`, sotto soglia, quindi la preview non si attiva e non introduce lavoro Canvas2D. FPS, p95, frame lenti, coda e presentazione restano uguali entro `1 ms`.

Rispetto alla vecchia preview differita della #39, la #42 elimina il debito strutturale: coda finale `4416→256 ms` e fine presentazione `11281→7105 ms`. Il renderer esatto non viene più alleggerito durante l'input, quindi non mantiene il p95 artificiosamente migliore della #39; il beneficio cercato è soltanto percettivo sul tip transiente.

Decisione preliminare: l'architettura v2 è sicura e Fur non regredisce, ma Base mostra un piccolo costo misurabile. Non promuovere né rimuovere ancora il candidato sulla base di una sola run. Eseguire almeno un'altra Base identica e raccogliere il giudizio tattile dell'utente: se il tip non appare sensibilmente più vicino al dito o la regressione si ripete, rimuovere la patch; se la sensazione migliora, isolare in un passo successivo l'overhead di aggiornamento/posizionamento DOM senza cambiare contemporaneamente trigger o resa.

### Run esplorative #44–#45 e problema Android — candidato sospeso, non bocciato

L'utente riferisce che la sensazione della tip preview gli piace e vuole continuare a sviluppare l'idea, ma chiede di fermare le modifiche prima del passo successivo. Riferisce inoltre che su Android gli stamp transitori Canvas2D appaiono con uno sfondo nero rettangolare. Questa osservazione manuale non è associata a una run Android salvata nel registro.

La `#44` è una seconda Base canonica sullo stesso iPhone della `#42`, con lo stesso fingerprint, viewport `430×775`, canvas `860×1454`, DPR `3`, preset, GPU Apple, stamp e copie. È quindi utile come replica anche se è stata eseguita come prova informale:

| Metrica | #37 Base baseline | #42 Base tip patch | #44 Base tip patch |
|---|---:|---:|---:|
| FPS medi | `57,50` | `56,49` | `56,86` |
| intervallo frame p95 | `25 ms` | `26 ms` | `25 ms` |
| frame oltre `20 ms` | `25` | `33` | `30` |
| coda GPU finale | `224 ms` | `256 ms` | `253 ms` |
| input delay p95 | `15 ms` | `16 ms` | `15 ms` |
| fine presentazione | `7084 ms` | `7105 ms` | `7100 ms` |

La #44 conferma la direzione della #42 con una regressione piccola: FPS circa `-1,1%`, `5` frame lenti in più e `29 ms` di coda aggiuntiva rispetto alla #37. La preview si attiva due volte, emette `208` patch, accumula `131 ms` di lavoro JS, p95 `1 ms`, massimo `2 ms` e `7` skip di budget. La sessione massima dura `2812 ms`; probe massimo `414 ms` e backlog massimo `1610` stamp. Gli invarianti esatti restano tutti validi e non compare debito GPU al lift.

La `#45` non va aggregata alle run canoniche: pur dichiarando user agent iPhone, usa Safari `26.5.2`, lingua italiana, DPR `2`, viewport `414×750` e canvas `828×1404`. È inoltre una condizione di saturazione estrema: FPS `25,60`, p95 `157 ms`, massimo `604 ms`, batch massimo `1025`, input delay p95 `208 ms` e coda finale `5349 ms`. La preview resta coinvolta fino a `11157 ms`, con probe massimo `4751 ms` e `6975` stamp non confermati. Anche in questo stress test non differisce né ripete lavoro esatto: `12107` stamp e `193` batch esatti coincidono con il renderer normale, mentre deferred, replay e submit al lift restano zero. La run dimostra soltanto che una tip patch di due stamp non può nascondere una GPU arretrata di molti secondi.

Il candidato crea il contesto visibile con `{ alpha: true, desynchronized: true }`. La documentazione Chrome del percorso low-latency specifica che un canvas traslucido desincronizzato può funzionare soltanto se non ha altri elementi DOM sopra. Nel layout corrente `.hint` ha `z-index: 2`, sopra `#tipPreviewCanvas` con `z-index: 1`. La violazione è una causa plausibile del rettangolo nero Android: il percorso desincronizzato può bypassare la composizione ordinaria/front-buffer, mentre i pixel trasparenti della patch vengono presentati come nero. `globalCompositeOperation = "copy"` durante il commit visibile è un secondo punto da verificare, ma non va cambiato contemporaneamente senza prima isolare il contesto desincronizzato.

Decisione aggiornata: la tip preview v2 non è bocciata, ma il candidato è sospeso e non vanno effettuate altre modifiche finché non viene concordato il passo successivo. La prima correzione isolata consigliata è rimuovere soltanto `desynchronized: true` dal canvas visibile, mantenendo alpha, scratch atomico, trigger, resa e renderer esatto invariati; aggiungere la lettura di `getContextAttributes()` alla diagnostica e verificare su Android che il rettangolo nero sparisca. Soltanto dopo va affrontato separatamente il piccolo overhead Base, senza combinare fix di correttezza e ottimizzazione.

## Esperimento: posizionamento della tip patch senza layout — candidato locale

Le run Base `#42` e `#44` hanno portato `resizeCanvasTotalMs` da `10 ms` della baseline `#37` a `60–67 ms`. La patch Canvas2D aggiorna la propria posizione a ogni frame; nella versione misurata lo faceva scrivendo `left` e `top` subito prima che il normale `renderFrame` leggesse `getBoundingClientRect()` sul canvas WebGPU. Questo è compatibile con un flush sincrono del layout, ma non lo dimostra ancora: la decisione resta affidata a una nuova run iPhone.

Questo esperimento cambia esclusivamente il posizionamento DOM della patch. `#tipPreviewCanvas` resta ancorato a `top: 0` e `left: 0`; la posizione per-frame usa `transform: translate(x, y)` 2D. Quando viene ritirato, il canvas diventa invisibile tramite `opacity: 0` senza riscrivere coordinate geometriche. Non vengono usati `translate3d`, `will-change` o altre richieste esplicite di promozione a layer. Dimensioni CSS quantizzate, backing Canvas2D, risoluzione, patch massima, disegno scratch atomico e commit restano identici.

Non sono cambiati:

- trigger, intervallo probe e soglie `60/58 ms`;
- massimo `2` stamp base, Count e copie fisiche;
- budget JavaScript `1,25 ms`, riserva commit e comportamento degli skip;
- resa Circle/Shape, alpha, colore, jitter e ordine;
- candidati provvisori al lift, seriali, retirement e invalidazioni;
- renderer WebGPU esatto, shader, `submitImmediate`, cache di presentazione e journal;
- contesti Canvas2D: `desynchronized: true` resta intenzionalmente presente sia sul canvas visibile sia sullo scratch. Il rettangolo nero Android non viene corretto in questo passo.

`performanceTelemetryRevision: 12` aggiunge il marker `adaptivePreviewPositionStrategy: "fixed-origin-2d-transform"` sia al profilo sia all'ambiente. Non aggiunge contatori per-frame. La prima Base canonica valida attesa è la `#46`, da confrontare soprattutto con le `#42/#44` e con la baseline `#37`. Oltre a FPS, p95, frame lenti e coda finale, verificare se `resizeCanvasTotalMs` torna verso `10 ms`; una diminuzione di questo solo contatore non basta se la fluidità peggiora.

Verifica locale precedente alla pubblicazione della `#46`: TypeScript, Vite e preparazione Sites riusciti; `git diff --check` pulito; `src/shaders.ts` invariato; corpo di `submitImmediate` identico byte-per-byte dopo normalizzazione dei newline e una sola chiamata `queue.submit`. La build di produzione non conteneva l'hook `window.__brushEngine`, il parametro force o `URLSearchParams`. Con la preview forzata in sviluppo erano riusciti gli smoke Circle, Shape, doppio tratto, zoom e Undo/Redo: durante ogni tratto `left` e `top` restavano a `0`, la patch visibile seguiva il tip tramite la sola trasformazione 2D e tornava a `opacity: 0` dopo il retirement; nessun errore o warning era comparso nella console.

### Risultato del posizionamento senza layout: run #46 — bocciato e rimosso

La `#46` è pienamente comparabile con `#42` e `#44`: stesso fingerprint `18982412`, preset Base, iPhone, viewport, canvas `860×1454`, `12107` stamp base, `193712` copie fisiche, shader, trigger e tip patch. Salva `performanceTelemetryRevision: 12` e `adaptivePreviewPositionStrategy: "fixed-origin-2d-transform"`.

| Metrica | Baseline #37 senza preview | Run #42/#44 con `left/top` | Run #46 con `transform` |
|---|---:|---:|---:|
| FPS medi | `57,50` | `56,49–56,86` | `56,77` |
| intervallo frame p95 | `25 ms` | `25–26 ms` | `25 ms` |
| intervallo frame massimo | `67 ms` | `66–67 ms` | `67 ms` |
| frame oltre 20 ms | `25` | `30–33` | `32` |
| coda GPU finale | `224 ms` | `253–256 ms` | `257 ms` |
| input delay p95 | `15 ms` | `15–16 ms` | `15 ms` |
| fine presentazione | `7084 ms` | `7100–7105 ms` | `7106 ms` |
| `resizeCanvasTotalMs` | `10 ms` | `60–67 ms` | `61 ms` |
| `renderFrameTotalP95Ms` | `1 ms` | `2 ms` | `2 ms` |

La preview si comporta come nelle repliche precedenti: `2` attivazioni, `210` patch, `420` stamp rappresentati, `6720` copie, `134 ms` JS totali, p95 `1 ms`, `6` skip, lifetime massimo `2816 ms` e backlog massimo `1633` stamp. Tutti gli invarianti del percorso esatto sono validi: zero deferred/replay/lift submission, `12107` stamp esatti e `390` batch sottoposti una volta sola.

Il passaggio a `transform` non recupera il calo Base e non riduce il tempo attribuito a `resizeCanvas`: `61 ms` resta nello stesso intervallo `60–67 ms`. La scrittura per-frame di `left/top` non era quindi la spiegazione sufficiente del costo osservato; il contatore può includere risoluzione degli stili o il costo della lettura del rettangolo dopo altre mutazioni della patch. Decisione: esperimento bocciato come ottimizzazione e rimosso. Il canvas torna al posizionamento originale con `left/top`, così i passi successivi ripartono dalla v2 misurata nelle `#42/#44`.

## Esperimento Android: canvas visibile sincronizzato — candidato locale

Il rettangolo nero Android viene affrontato isolatamente partendo dal codice v2 originale delle `#42/#44`, incluso il posizionamento `left/top`. Il canvas Canvas2D visibile viene ora creato con il solo `{ alpha: true }`: non richiede più `desynchronized: true`, il cui valore predefinito è falso. Lo scratch detached conserva invece `{ alpha: true, desynchronized: true }`. Restano invariati `globalCompositeOperation = "copy"`, scratch atomico, trasparenza, z-index, trigger, soglie, patch, budget, Circle/Shape, seriali, lift, retirement e renderer WebGPU esatto.

`performanceTelemetryRevision: 13` aggiunge:

- `adaptivePreviewVisibleCanvasStrategy: "alpha-synchronized-canvas2d"`;
- alpha, `desynchronized` e spazio colore effettivamente restituiti da `getContextAttributes()` per canvas visibile e scratch.

Sul browser locale sono attesi `visible alpha=true`, `visible desynchronized=false`, mentre lo scratch deve restare `alpha=true`, `desynchronized=true`; la run Android dovrà confermare i valori realmente concessi dalla piattaforma. Prima va verificato visivamente che durante l'attivazione della tip patch non compaia più il rettangolo nero. Se resta, il passo successivo deve essere isolato: prima rimuovere il flag dallo scratch, e soltanto dopo provare separatamente `clearRect` + `source-over` al posto di `copy`.

Verifica locale del candidato: build TypeScript/Vite/Sites riuscita; smoke con preview forzata riusciti per Circle, Shape, zoom, lift e Undo/Redo; il canvas visibile torna a `left/top: -10000px` dopo il retirement; nessun errore o warning runtime. Shader e percorso WebGPU esatto non sono stati modificati. Il candidato Android non è ancora pubblicato.

### Risultato Android e controllo iPhone #47

Il candidato sincronizzato è stato pubblicato e il controllo manuale Android ha confermato che il rettangolo nero della tip patch è scomparso. Poiché rispetto alla build Android difettosa il posizionamento `left/top`, lo scratch e il commit `copy` sono invariati, il confronto identifica il contesto visibile `desynchronized` come causa operativa del difetto di presentazione. Il controllo manuale non ha salvato una run benchmark.

La successiva Base iPhone `#47` è comparabile con `#42/#44`: stesso fingerprint, preset, dispositivo, viewport, canvas, stamp e copie. La telemetria conferma `visible desynchronized=false`, `scratch desynchronized=true` e spazio colore `srgb`; Safari non espone il campo `alpha` in `getContextAttributes()`, quindi il valore salvato è `null` e non significa che l'alpha sia disabilitato.

| Metrica | Run #42/#44 sincronizzazione precedente | Run #47 canvas visibile sincronizzato |
|---|---:|---:|
| FPS medi | `56,49–56,86` | `55,90` |
| intervallo frame p95 | `25–26 ms` | `28 ms` |
| frame oltre 20 ms | `30–33` | `37` |
| coda GPU finale | `253–256 ms` | `285 ms` |
| input delay p95 | `15–16 ms` | `17 ms` |
| fine presentazione | `7100–7105 ms` | `7138 ms` |
| `resizeCanvasTotalMs` | `60–67 ms` | `66 ms` |

La #47 peggiora tutte le metriche principali, ma una singola replica non dimostra da sola il costo del contesto sincronizzato. L'utente ha comunque scelto una politica deterministica per conservare il percorso iPhone originale e il fix Android: `desynchronized: true` soltanto su iPhone, `false` su Android e desktop.

## Strategia Canvas2D per piattaforma — candidato locale

Il canvas visibile usa ora `adaptivePreviewVisibleCanvasStrategy: "iphone-desynchronized-others-synchronized-canvas2d"`. Il rilevamento iPhone controlla `navigator.platform === "iPhone"` oppure la presenza della parola `iPhone` nello user agent. Non abilita il flag su iPad, Android o desktop. Lo scratch resta `desynchronized: true` su tutte le piattaforme.

`performanceTelemetryRevision: 14` aggiunge `adaptivePreviewVisibleCanvasRequestedDesynchronized` oltre agli attributi effettivi già presenti. Valori attesi:

- iPhone: requested `true`, actual `true` quando Safari onora il flag;
- Android e desktop: requested `false`, actual `false`;
- scratch: actual `true` su tutte le piattaforme che espongono l'attributo.

Non cambiano trigger, intervallo probe `4`, soglie `60/58 ms`, tip patch, disegno, compositing, lift, renderer WebGPU esatto o shader. La build locale TypeScript/Vite/Sites riesce. Il candidato non è ancora pubblicato; la prima Base iPhone attesa dopo la pubblicazione è la `#48`.
