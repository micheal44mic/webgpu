# PR 2 — Pool scratch unificato

## Step 1 — Prova di disgiunzione temporale

Stato del gate: **passato; Piano A ammesso**.

Questa sezione è stata scritta prima di modificare il codice di produzione.
La conclusione riguarda i percorsi reali del motore e il benchmark della PR 1,
non soltanto l'ordine teorico dei due effetti.

### Traccia del percorso di produzione

Tutti i percorsi Paint che aggiornano lo style stack convergono in
`BrushEngine.encodeRasterStrokeUpdate()`:

- Light Glaze live: `src/brush-engine.ts:8954`;
- commit Light Glaze: `src/brush-engine.ts:9121`;
- frame Paint/tail normale: `src/brush-engine.ts:9600`.

All'interno di quella funzione l'ordine è vincolante:

1. `RasterBevelRenderer.encode()` viene chiamato per primo
   (`src/brush-engine.ts:5943-5950`);
2. soltanto dopo il suo ritorno viene chiamato
   `RasterStrokeRenderer.encode()` (`src/brush-engine.ts:5998-6009`).

Nel renderer Smusso tutti i dispatch che usano il workspace ROI sono contenuti
nel compute pass aperto a `src/bevel-renderer.ts:1791` e chiuso a
`src/bevel-renderer.ts:1871`. L'ultimo uso dello scratch è il resolve finale:
legge l'ultima arena scalare e scrive la texture persistente heightfield R32F
(`src/bevel-renderer.ts:1866-1868`). Dopo `pass.end()` nessun comando Smusso
legge più il workspace.

Il renderer Traccia comincia successivamente. Il suo scratch ping-pong viene
usato dal compute pass seed/JFA/resolve
(`src/stroke-renderer.ts:2390-2460`). Il compose che segue legge la coverage
persistente e, quando Smusso è attivo, la texture heightfield già risolta; non
legge più il workspace Smusso (`src/stroke-renderer.ts:2463-2517`).

Il benchmark segue lo stesso ordine nello stesso encoder:
Smusso a `src/effects-benchmark.ts:184`, poi Traccia a
`src/effects-benchmark.ts:192`.

### Intervalli di vita

Sul queue timeline gli intervalli sono quindi:

```text
Smusso workspace
  coverage → gaussian/JFA → height → gaussian → resolveHeight
                                                      │
                                                      └─ output persistente R32F
                                                         ↓
Traccia scratch
  seed → JFA ping-pong → coverage R8 → compose(heightfield)
```

Le due famiglie di bind group possono esistere contemporaneamente lato CPU,
ma i **contenuti** dello scratch non devono restare vivi contemporaneamente
sulla GPU. Il solo dato che attraversa il confine è la texture heightfield
persistente, non il workspace che l'ha prodotta.

I comandi appartengono allo stesso `GPUCommandEncoder` e sono accodati nello
stesso `GPUCommandBuffer`. La fine del compute pass Smusso precede l'inizio dei
dispatch Traccia; WebGPU conserva l'ordine dei comandi sul queue timeline e
tratta ogni dispatch come un usage scope. Riutilizzare lo stesso intervallo di
buffer in usage scope successivi non richiede una copia, una passata o una
barriera esplicita aggiuntiva. Riferimento:
[WebGPU specification — Command Encoding](https://gpuweb.github.io/gpuweb/#command-encoding).

### Decisione

Gli scratch sono temporalmente disgiunti: si adotta il **Piano A**.

Il pool potrà quindi possedere un solo `GPUBuffer`, con dimensione pari al
massimo fra:

- footprint corrente Traccia, composto dai due range ping-pong;
- footprint corrente Smusso, composto da arena comune e, quando necessaria,
  arena segmenti.

I range delle due famiglie possono aliasare gli stessi byte, mentre i range
interni a una singola famiglia restano distinti e allineati. Ogni binding
continuerà a rispettare `maxStorageBufferBindingSize`; il buffer complessivo
rispetterà `maxBufferSize`.

Condizione progettuale per lo Step 2: ogni crescita deve avvenire prima che il
primo comando che usa il pool venga registrato nell'encoder. Nessun renderer
potrà riallocare il pool dopo aver già codificato un altro utilizzatore nello
stesso encoder. Per i due effetti attuali questo è possibile perché:

- Traccia dichiara il proprio tier alla creazione o al cambio width, mai dentro
  il field pass;
- Smusso calcola il layout richiesto prima di aprire il proprio compute pass ed
  è sempre il primo utilizzatore dello stack.

Non verranno aggiunte passate, copie o barriere. Il benchmark retarget 4096²
resta il gate prestazionale dello Step 4.

## Step 2 — Implementazione del pool

`EffectsScratchPool` possiede un solo `GPUBuffer` con strategia
`single-buffer-aliased-effect-layouts-grow-immediate-shrink-idle-hysteresis`.
Ogni effetto dichiara un layout di range interni distinti e allineati a
`minStorageBufferOffsetAlignment`; i layout di effetti temporalmente disgiunti
partono invece dallo stesso offset e si sovrappongono intenzionalmente. La
capacità fisica è il massimo dei footprint dichiarati, non la loro somma.

Ogni range viene legato come `{ buffer, offset, size }`. La dimensione del
singolo range viene verificata contro `maxStorageBufferBindingSize` e il
footprint complessivo contro `maxBufferSize`, sia prima della dichiarazione sia
prima della sostituzione del buffer. Un layout invariato conserva versione,
buffer e bind group; non esiste sub-allocazione per frame.

La JFA Traccia ha una particolarità di validazione WebGPU: nello stesso dispatch
il range sorgente e quello destinazione appartengono ora allo stesso buffer
fisico. Dichiarare il primo `read-only-storage` e il secondo `storage` produce
l'errore di validazione «usage (Storage(read-write)|Storage(read-only)) includes
writable usage and another usage in the same synchronization scope», benché i
range non si intersechino. Entrambi i binding sono quindi dichiarati `storage`;
lo shader continua a non scrivere mai `inputSeeds`. Non cambia alcun indice,
algoritmo o pixel e non viene aggiunto nessun pass, copia o barriera.

La crescita avviene prima dell'assegnazione di `activeStroke`; il pool rifiuta
comunque ogni sostituzione fisica durante una pennellata. Lo shrink viene armato
solo quando il motore è davvero idle, dopo `GPUQueue.onSubmittedWorkDone()`, con
isteresi di `1500 ms`. Undo, Redo, Pulisci e ritorno a un tier più piccolo
convergono sulla stessa policy. Il picco resta storico anche dopo lo shrink.
## Step 3 — Contratto per gli effetti futuri

`EffectsScratchPool.declareEffect(effectId, ranges)` è il solo punto con cui un
renderer dichiara scratch effect-locali. I range di uno stesso effetto sono
distinti e allineati; i layout di effetti diversi partono da zero e possono
aliasare perché lo scheduler ne garantisce l'ordine provato sopra. Una nuova
dichiarazione uguale non rialloca il buffer e il layout non viene ricalcolato
dal renderer a ogni frame.

La dichiarazione vuota è intenzionale: `declareEffect(effectId, [])` registra
un footprint di zero byte e restituisce `null`, senza creare o ampliare il
buffer. Questo rende verificabile che un effetto compose-only non introduca
scratch per errore.

Due controlli di progetto, senza implementarli in questa PR:

- **Ombra esterna / glow.** Può dichiarare range ping-pong gaussiani e di
  distanza, riusare le passate già presenti nello Smusso e lasciare nel pool
  soltanto gli intermedi. L'eventuale output persistente resta fuori dal pool,
  come oggi l'heightfield. Il caso è coperto purché lo scheduler assegni
  all'effetto un intervallo ordinato e non sovrapposto a un altro utilizzatore.
- **Riempimento colore / gradiente.** È una composizione diretta e dichiara
  `[]`: footprint zero, nessun lease, nessuna crescita della capacità.

Il pool non promette condivisione simultanea. Se un futuro effetto dovesse
tenere intermedi vivi mentre ne parte un altro, servirà prima una nuova prova
di lifetime (o un piano B con range non aliasati), non una modifica silenziosa
alla dichiarazione.

## Step 4 — HUD, telemetria e misure

La telemetria sale a revisione `42`. Il monitor sostituisce le due righe
fisiche Traccia/Smusso con:

- pool scratch corrente, contato una sola volta nel totale GPU e accompagnato
dagli extent logici correnti;
- picco storico del pool, mostrato a parte e non sommato al totale corrente.

Build e strategie firmate dalla revisione:

- Traccia: `style-stack-webgpu-v9-shared-effects-scratch-retargetable-layer-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-native-unorm-round-even`;
- Smusso: `raster-bevel-webgpu-v4-shared-effects-scratch-retargetable-layer-heightfield-v2-r32f-segment-jfa-workgroup-gaussian-gpu-gate`;
- workspace Smusso: `shared-effects-pool-roi-split-common-segment-arenas-grow-until-idle-shrink`.

### Benchmark full-document 4096²

Ambiente uguale alla PR 1: NVIDIA Ampere, RGBA8, Traccia outside `14 px`,
Smusso inner/smooth `32 px`, soften `4`, cinque campioni dopo warm-up,
`timestamp-query` non disponibile. Prima della misura riportata sono state
chiuse le altre schede WebGPU, per non introdurre contesa esterna. Una seconda
ripetizione isolata ha dato `125,4 ms`, quindi la conclusione non dipende da una
singola serie.

| Percorso | PR 1 | PR 2 | Delta PR 2 |
|---|---:|---:|---:|
| Retarget: CPU setup + encode mediana | 3,2 ms | 2,7 ms | −0,5 ms |
| Retarget: coda + callback mediana | 128,8 ms | 125,6 ms | −3,2 ms |
| Retarget: totale mediano | 131,9 ms | 128,3 ms | **−2,73%** |
| Destroy + recreate: totale mediano | 152,2 ms | 147,0 ms | −3,42% |

Campioni retarget PR 2: `140,0`, `128,9`, `124,2`, `125,1`, `128,3 ms`.
La soglia di accettazione era al massimo `135,857 ms` (`+3%`): il pool non
aggiunge passate, copie o barriere e resta dentro il gate.

### Memoria scratch misurata

Il workspace Smusso default richiede `1 327 360 byte` (`1,265869 MiB`); la
Traccia richiede `16 777 216 byte` a extent `1024²` e `67 108 864 byte` a
`2048²`. Con i buffer precedenti le due quantità si sommavano; col pool conta il
massimo.

| Stato runtime | Prima: scratch separati | PR 2: pool fisico | Picco HUD |
|---|---:|---:|---:|
| Riposo, effetti disattivati | 0 byte | 0 byte | 0 byte su avvio pulito |
| Tratto con Traccia `1024²` + Smusso `384²` | 18 104 576 byte (`17,265869 MiB`) | 16 777 216 byte (`16 MiB`) | 16 MiB |
| Tier massimo provato: Traccia `2048²` + Smusso `384²` | 68 436 224 byte (`65,265869 MiB`) | 67 108 864 byte (`64 MiB`) | 64 MiB |
| Ritorno a Traccia `1024²` dopo isteresi | 18 104 576 byte | 16 777 216 byte | 64 MiB storico |
| Effetti nuovamente disattivati | 0 byte | 0 byte | 64 MiB storico |

Il risparmio fisico nei due stati attivi è `1 327 360 byte`, esattamente il
footprint Smusso che prima si sommava alla Traccia. Nel benchmark l'intero
working set persistente + scratch scende da `126,763596 MiB` a
`125,497726 MiB`; layer, heightfield, coverage, mask e styled mip sono invariati.

### Golden GPU

Con il pool corretto:

- fixture: `bcbaa02ce90eaa947fc76b9b0161840f8f6a8c02693624ad45520b64596733fb`;
- combinato mip 0: `8d5a75a6abb9f47cdf4a794d560b5795aa4b4c85520db2dd1466833157f6dcb0`;
- combinato mip preesistente: `9208e2a30e5ece12dc92f31e74f6113ffd89af60672492cf534f1b5e08208196`;
- restano esattamente i tre diagnostici source-mode già aperti e i 25 mismatch
mip già elencati nella PR 1;
- nessun warning o errore di validazione WebGPU.

Nessun golden è stato rigenerato o modificato.

### Mutation test obbligatori

Ogni riga è stata provata prima con l'implementazione corretta, poi con la
mutazione indicata e infine nuovamente dopo il ripristino.

| Invariante | Implementazione corretta | Mutazione deliberata | Fallimento osservato |
|---|---|---|---|
| Capacità = massimo, non somma | pool `512 byte` | `Math.max` sostituito da somma | `768 !== 512` |
| Nessuna riallocazione per richieste minori/uguali | allocation count `1` | guardia `<=` sostituita da `<` | allocation count `2 !== 1` |
| Range interni distinti e Golden probante | ping B a offset `256`; hash `8d5a…` | tutti i range forzati a offset `0` | `0 !== 256`; Golden `70d14e…`, tutti i casi canonici corrotti |
| Classe d'uso JFA compatibile col buffer unico | verifier verde; nessun errore GPU | `inputSeeds` riportato a `read-only-storage` | assert WGSL fallito; validazione WebGPU `Storage(read-write)|Storage(read-only)`; output trasparente |
| Shrink realmente eseguito in idle | `shrinkToFit() === true`, `512→0` | ramo idle reso no-op | `false !== true` |
| Nessuno shrink durante una pennellata | eligibility `false`; sostituzione rifiutata | rimossa la condizione `!activeStroke` | `true !== false` |
| Prewarm prima di `activeStroke` | chiamata presente e indice precedente | chiamata rinominata/disabilitata | `Bevel scratch prewarm call must exist` |
| Isteresi | `1500 ms` | costante portata a `0` | `0 !== 1500` |
| Effetto compose-only a zero scratch | `null`, nessuna allocazione | restituito un lease anche per `[]` | oggetto lease ricevuto invece di `null` |
| Limite del singolo binding | eccezione `maxStorageBufferBindingSize` | controllo disattivato | `Missing expected exception` |
| Limite del buffer fisico | eccezione `maxBufferSize` | entrambi i controlli disattivati | `Missing expected exception` |

Il primo controllo statico del prewarm era troppo permissivo: la mutazione
`prewarmWorkspaceDisabled` lo superava per coincidenza di prefisso e per il
confronto `-1 < indice`. Il test è stato quindi corretto per richiedere la
chiamata esatta e un indice diverso da `-1`; la stessa implementazione rotta è
stata rieseguita e ha fallito. Questo evita di ripetere il difetto tautologico
della PR 1.

## Revisione post-audit

Un audit indipendente (ricerca spec + revisione avversariale) ha prodotto le
correzioni seguenti, tutte applicate in questo branch.

### Legalità del binding aliasato: risolta, non aggirata

La domanda aperta era se dichiarare `storage` entrambi i binding JFA sullo stesso
buffer fosse legale per spec o soltanto tollerato da Dawn. **È legale per spec.**

- Un buffer è un'unica subresource: *"We define subresource to be either a whole
  buffer, or a texture subresource."*
- La lista di usage dev'essere omogenea, non di cardinalità uno: *"Each usage in
  U is storage. Multiple such usages are allowed even though they are writable.
  This is the usage scope storage exception."*
- L'esempio non normativo nomina il caso alla lettera: *"Disjoint ranges of a
  single buffer may be bound to two different binding points as storage."*
- Il controllo separato «Encoder bind groups alias a writable resource» scatta
  solo su range che **si intersecano**; i nostri sono disgiunti.

Il test CTS `api/validation/resource_usages/buffer/in_pass_encoder.spec.ts` lega
un buffer due volte a offset disgiunti e attende successo per `storage+storage`.
WebKit accetta con la stessa logica (`BindGroup::allowedUsage`, `OptionSet`).

**Invariante da non perdere:** entrambi i binding devono passare un `size`
esplicito. Se il size è omesso il range arriva a fine buffer, i due si
intersecano e il dispatch diventa invalido. `scratchBinding()` costruisce sempre
`{ buffer, offset, size }` dal lease.

Non serve quindi la variante a due buffer fisici: la memoria sarebbe identica ma
la complessità no.

### Correzioni applicate

| # | Difetto | Correzione |
|---|---|---|
| B1 | `declareEffect()` committava il requisito **prima** di validare la capacità: una riallocazione rifiutata lasciava la mappa con un footprint che il buffer non aveva, ogni lease successivo restituiva range oltre la fine del buffer e `shrinkToFit()` non recuperava più | compute-then-commit: la capacità si calcola su un candidato e si scrive solo a successo |
| B1b | `resizeScratch()` assegnava `_scratchExtent` prima di `updateScratchRequirement()` senza rollback: dopo un rifiuto la chiamata successiva prendeva l'early return e non riprovava mai | rollback di extent e byte in `catch`, poi rilancio |
| B2 | Nessun test poteva fallire cancellando il resync di generation/layoutVersion: nel golden la capacità non cresce mai, quindi la generation restava 1 per tutta la run | nuovo caso `stroke-bevel-pool-growth-resync`, che forza una sostituzione reale del buffer |
| M1 | `effectsScratchNeedsShrink()` escludeva `"bevel"` dai retained, quindi restava vero **in regime stazionario** quando il footprint Smusso supera quello Traccia: ogni pausa fra due tratti diventava un ciclo free/regrow | soglia `EFFECTS_SCRATCH_MINIMUM_SHRINK_BYTES` (8 MiB): uno swing da 2 MiB non paga più una realloc, la discesa dal tier 2048² sì |
| m3 | Il ramo `else` nel `finally` del golden era irraggiungibile, quindi un throw prima dell'attach perdeva i renderer | distruzione diretta dei renderer, **prima** del workbench, perché il loro `destroy()` rilascia il requisito su un pool ancora vivo |
| m4 | Il picco del pool si azzerava alla ricreazione del workbench, contraddicendo la riga «picco storico» | `initialPeakBytes` propagato attraverso la sostituzione |
| n1 | Il commento WGSL diceva «per buffer within this compute pass» | corretto: la subresource è il buffer intero, ma **ogni dispatch è un usage scope** |

### Mutation test delle nuove invarianti

Ogni riga provata con implementazione corretta, poi mutata, poi ripristinata.

| Invariante | Corretta | Mutazione | Fallimento osservato |
|---|---|---|---|
| Resync Traccia dopo sostituzione del buffer | `d1630de4`, 0 byte | `syncScratchBindGroups()` rimossa da `encode()` | `377b4d79` ≠ `d1630de4`, **148 969 byte** |
| Resync Smusso dopo sostituzione del buffer | `d1630de4`, 0 byte | fast path di `ensureWorkspace()` reso incondizionato | `377b4d79` ≠ `d1630de4`, **148 969 byte** |
| Rifiuto di riallocazione atomico | capacità e requisiti invariati | commit prima della validazione | requisiti divergenti, lease fuori dal buffer |
| Soglia di shrink | 2 MiB non shrinka, 48 MiB sì | soglia a 0 | `true !== false` |
| Picco preservato | `4096` dopo la ricreazione | `initialPeakBytes` ignorato | `0 !== 4096` |

Nota metodologica: **la prima versione del caso B2 passava anche con la
mutazione attiva.** Confrontava il risultato con l'immagine precedente, ma un
submit scartato per bind group stantii lascia in memoria esattamente
quell'immagine. È stato necessario (a) far muovere il bersaglio, retargettando
alla prima sorgente così che un rebuild riuscito produca l'immagine di contenuto
A, e (b) spostare il retarget **prima** della crescita del pool, perché il
retarget ricostruisce i bind group da solo e altrimenti riparava lo Smusso
mascherando il difetto. Entrambi gli ordini sono ora asseriti in
`verify-stroke-core.mjs`.

### Verifiche finali

- `npm run effects-scratch:verify`
- `npm run stroke:verify`
- `npm run bevel:verify`
- `npm run grain:verify`
- `npm run blend:verify`
- `npm run thickness:verify`
- `npx tsc --noEmit`
- build Vite, senza conservare modifiche in `dist/`
