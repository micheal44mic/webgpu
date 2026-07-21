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
