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

## Passo 2: backpressure della coda GPU

Il render interattivo ora ammette al massimo `2` submission GPU in volo. Se entrambi gli slot sono occupati, gli stamp continuano a essere generati in FIFO dentro `pendingStamps`, ma non vengono rimossi dalla coda e non viene creato un nuovo command buffer. Al completamento di una submission, `GPUQueue.onSubmittedWorkDone()` libera lo slot e pianifica il prossimo frame se esiste lavoro pendente.

Non usare `await` dentro `renderFrame`: il limite a 2 serve a mantenere una submission pronta mentre la precedente viene completata. Il benchmark GPU sintetico è serializzato e passa dallo stesso tracker, quindi non può aggirare il limite.

Questo passo non cambia shader, quad, Count, spacing, jitter, seed o ordine degli stamp. È valido per tutte le size; il beneficio dipende dalla saturazione della GPU. Con impostazioni fisse il risultato deve restare visivamente invariato, ma i confini dei render pass possono cambiare e non va promessa identità byte-per-byte su `rgba8unorm`. Se i parametri del pennello vengono modificati mentre esiste backlog, gli stamp ancora pending usano gli uniform più recenti: il Play canonico non è coinvolto perché mantiene il preset fisso.

Nuova telemetria salvata nella run:

- `submissionLimit`: limite configurato, attualmente `2`;
- `peakInFlightSubmissions`: massimo numero osservato in volo;
- `backpressureWaits`: episodi distinti di saturazione, non durata dell'attesa;
- `maxPendingStamps`: massimo backlog di stamp base, non copie fisiche;
- `submissionCompletionP50/P95/MaxMs`: tempo dalla submission al completamento del relativo prefisso di coda; include eventuale lavoro precedente e il ritardo del callback JS, quindi non è il tempo GPU isolato del command buffer.

La prossima run iPhone dovrebbe essere la `#6`. Confrontarla soprattutto con la mediana quad `#1–#3`, usando lo stesso fingerprint e preset. Il passo 2 è valido solo se il tratto segue meglio il dito e diminuiscono coda GPU e ritardi senza peggiorare chiaramente scatti, FPS o risultato visivo. Un calo degli FPS di submission non basta da solo per rifiutarlo: controllare anche backlog, completion p95 e prova a occhio.

Non implementare insieme il prossimo candidato. Se il passo 2 fallisce, fare rollback prima di provare il quad identico come `triangle-strip` da 4 vertici. Il buffer temporaneo trasparente non è prioritario: il motore fonde già tutte le copie del frame in un solo render pass e una texture intermedia aggiungerebbe passaggi, memoria e possibili differenze di quantizzazione.
