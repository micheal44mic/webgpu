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
