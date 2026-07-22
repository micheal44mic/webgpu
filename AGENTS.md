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

## Esperimento Shape: pre-mappa di occupazione conservativa — in attesa di run iPhone

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
