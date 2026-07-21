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

Le nuove run salvano `stampGeometry: "circumscribed-12-gon"`, `stampVerticesPerCopy: 36`, `averageRenderFps` e mostrano FPS medi e frame oltre 20 ms nell'app.

## Criteri per decidere se tenere il passo 1

Eseguire il Play sullo stesso iPhone e confrontare con la run `#1`. L'intervento è valido solo se:

1. il comportamento e il risultato visivo non cambiano;
2. diminuiscono la coda GPU e/o i frame oltre 20 ms;
3. migliorano FPS medi e intervallo frame p95;
4. `Count 16`, size 750, spacing 1% e tutti gli altri parametri restano identici.

Non introdurre ancora stroke buffer, canvas software a tile, binning compute o una riscrittura Metal: vanno valutati soltanto dopo il confronto di questo singolo passo.

Aggiornare questo file dopo ogni passo misurato, annotando la nuova run, il confronto con la baseline e la decisione di mantenere o annullare l'intervento. Non sostituire il benchmark canonico o i suoi parametri senza una richiesta esplicita dell'utente.

## Misura preliminare del passo 1

La run `#4` è la prima eseguita con `stampGeometry: "circumscribed-12-gon"`. Le run `#1`, `#2` e `#3` usano ancora il quad. Tutte e quattro hanno lo stesso fingerprint della traccia, gli stessi parametri, lo stesso iPhone, canvas e formato layer.

| Metrica | Run #1 quad | Mediana run #1–#3 quad | Run #4 dodecagono |
|---|---:|---:|---:|
| FPS medi | circa `55,77` | circa `54,76` | `53,92` |
| intervallo frame p95 | `29 ms` | `32 ms` | `31 ms` |
| intervallo frame massimo | `67 ms` | `67 ms` | `117 ms` |
| frame oltre 20 ms | `35` | `41` | `42` |
| coda GPU finale | `310 ms` | `386 ms` | `378 ms` |
| input delay p95 | `18 ms` | `21 ms` | `25 ms` |

La run #4 è peggiore della baseline formale #1. Rispetto alla mediana delle tre run quad, i risultati sono misti e non mostrano un miglioramento significativo: coda GPU e p95 migliorano appena, mentre FPS medi, frame lenti e hitch massimo peggiorano. Non decidere ancora sulla base di una sola run ottimizzata: raccogliere le run #5 e #6 con il dodecagono e confrontare la mediana #4–#6 con la mediana #1–#3. Se non emerge un guadagno netto, ripristinare il quad.
