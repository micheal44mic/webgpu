# PR 3 — Gate del campo Smusso a bounding box

## Esito

Il gate iniziale è stato correttamente fermato sul commit `e9851ed`: l'assunto
«altezza zero fuori dai bounds» era falso per `pillow` e una nuova texture
WebGPU non poteva conservare implicitamente l'intersezione precedente. Il
commit `2400548` registra quell'audit prima di qualsiasi modifica di
produzione.

Il 24 luglio 2026 il gate è stato riaperto con sei decisioni esplicite:

1. il dominio logico è l'inviluppo tile-aligned dei job;
2. una riallocazione ricostruisce l'intero **nuovo bbox**, mai il documento per
   scorciatoia e mai soltanto la corona;
3. finché l'allocazione non cambia, gli update restano incrementali per ROI;
4. la crescita durante un tratto è consentita solo all'inizio del frame, prima
   di qualsiasi comando dell'encoder che legga o scriva il campo;
5. il contratto di retarget trasporta i content bounds noti;
6. fuori dal campo il compositore usa una costante CPU dipendente dallo stile:
   zero per `inner`, `outer` ed `emboss`; per `pillow`, 1 senza contour oppure
   la stessa `profileValue(min(1 / bevelRange, 1))` del renderer con contour.

Le sezioni seguenti restano il verbale dell'audit che ha prodotto queste
correzioni; non descrivono più blocker aperti.

I riferimenti sotto sono stati verificati sul commit `e9851ed`.

## Stato dell'implementazione dopo gli Step 2–3

Lo Step 2 è congelato nel commit `0f26957`. Il flag
`bevelBoundingFieldEnabled` resta default-OFF. OFF conserva texture `4098²`,
uniform da 80 byte, shader e dominio full-document; ON usa un'allocazione
R32F pari al bbox tile-aligned più un apron fisico per lato e uniform da 112
byte con origine storage, bounds validi e costante esterna.

La transizione del campo è ora una funzione pura e verificata:

| Stato | Azione fisica | Lavoro del campo |
|---|---:|---:|
| prima allocazione o crescita oltre capacità | nuova texture | rebuild dell'intero nuovo bbox |
| ROI contenuta nella capacità | nessuna realloc | soli tile della ROI |
| dominio più piccolo ma motore non ancora idle | capacità trattenuta | bounds validi ridotti, nessun texel stale leggibile |
| idle per 1,5 s e risparmio almeno 8 MiB | nuova texture più piccola | rebuild dell'intero nuovo bbox |
| sorgente vuota dopo idle | placeholder R32F `1×1` | nessun job |

La sostituzione avviene all'ingresso di `RasterBevelRenderer.encode()`, prima
di qualunque comando dell'encoder che possa leggere o scrivere il campo. Non
esiste `copyTextureToTexture`: una crescita ricostruisce il nuovo bbox, quindi
non dipende dai texel della texture distrutta. Lo shrink del campo precede lo
shrink del pool condiviso, perché il rebuild usa ancora una volta il workspace
Smusso; questo evita una coppia shrink/regrow dello scratch.

`retargetEffectsWorkingSet()` accetta ora un terzo parametro `contentBounds`.
Parametro omesso conserva il contratto precedente 4096², `null` dichiara una
sorgente vuota. Nei confronti PR 3 Traccia, coverage, mask e styled restano
full-document; solo lo Smusso riceve i bounds piccoli, così il benchmark non
attribuisce a questa PR risparmi fuori scope.

### Test di mutazione CPU degli Step 2–3

Eseguiti da `npm run bevel:verify`; ogni mutazione viene caricata come modulo
separato e l'implementazione su disco resta corretta.

| Invariante | Implementazione corretta | Mutazione eseguita | Esito della mutazione |
|---|---:|---|---:|
| costante esterna `pillow` | passa | costante forzata a zero | fallisce `pillow`; `inner` e `outer` restano verdi |
| crescita con texture nuova | passa | `fullRebuild=false` (sola corona) | fallisce |
| ROI dentro capacità | passa | piano atteso `retain`, nessuna realloc | verde |
| ordine di realloc | passa | controllo statico prima di ogni comando encoder del campo | verde |
| nessuna copia di preservazione | passa | ricerca `copyTextureToTexture` | assente |

Il confronto pixel GPU contro un renderer full-document indipendente, le
mutazioni origine/clamp e i benchmark browser appartengono allo Step 4 e non
sono dichiarati verificati in questa fase.

## A. Copertura delle letture

La prova di centralizzazione **passa**.

- La texture è dichiarata una sola volta nel WGSL di composizione come
  `bevelHeight` (`src/stroke-renderer.ts:554`).
- L'unico `textureLoad()` che la legge è dentro
  `bevelHeightAt()` (`src/stroke-renderer.ts:565-573`).
- Le otto letture usate da Scharr passano tutte da quell'helper
  (`src/stroke-renderer.ts:597-605`).
- Lo stesso sorgente WGSL viene incluso nel compose mip 0 e mip 1
  (`src/stroke-renderer.ts:782-809`) e nel display diretto
  (`src/stroke-renderer.ts:831-852`), quindi non esiste un secondo percorso di
  sampling nascosto nel display.
- Le view legate al compose, al readback golden e al display sono la stessa
  `bevelHeightView` (`src/stroke-renderer.ts:1407-1428`,
  `src/stroke-renderer.ts:2005-2028`).

Ricerca eseguita su `src/`: nessun altro `textureLoad`, `textureSample` o
readback dell'heightfield. Le occorrenze esterne di `heightView` sono solo
propagazione e binding della risorsa. Sul lato Smusso `heightOutput` è
`write-only` (`src/bevel-renderer.ts:222-232`) e l'unica scrittura persistente
è il `textureStore()` del resolve (`src/bevel-renderer.ts:718-722`).

**Eccezioni trovate: nessuna.**

## B. Supporto del campo e controesempio `pillow`

`deriveRasterBevelHeightfield()` calcola un apron finito che comprende size,
due gaussiane troncate e il margine di sicurezza
(`src/bevel-core.ts:272-302`). `rasterBevelInfluenceBounds()` espande i bounds
del contenuto di `apron + 1` e li limita al documento
(`src/bevel-core.ts:525-555`).

Questa espansione contiene il supporto utile di `inner`, `outer` ed `emboss`
per entrambe le famiglie di tecnica:

- nella tecnica `smooth`, una sorgente alpha nulla resta nulla dopo la prima
  gaussiana e le formule dei primi tre modi tornano a zero fuori dal supporto
  (`src/bevel-renderer.ts:610-638`);
- nelle tecniche `chiselHard` e `chiselSoft`, la distanza firmata viene
  saturata dalle stesse formule entro `size`, poi dalla gaussiana finale entro
  il suo raggio finito (`src/bevel-renderer.ts:500-529`,
  `src/bevel-renderer.ts:629-638`).

La modalità `pillow` è però un controesempio diretto:

- `smooth`: con alpha sorgente nulla, `source == 0` e
  `abs(2 * source - 1) == 1` (`src/bevel-renderer.ts:619-628`);
- scalpello: lontano dal bordo la distanza firmata ha modulo maggiore di
  `size`, quindi `clamp(abs(source) / size, 0, 1) == 1`
  (`src/bevel-renderer.ts:629-638`).

La gaussiana finale conserva una regione costante a 1. Il resolve scrive
quindi valori non nulli anche dove non esiste copertura sorgente
(`src/bevel-renderer.ts:649-723`).

C'è una seconda differenza fra bounds matematici e texel effettivamente
scritti: `buildJobs()` arrotonda la ROI ai tile da 256 e ogni job risolve
l'intero target tile (`src/bevel-renderer.ts:1345-1389`). I texel non nulli
`pillow` possono perciò arrivare fino all'inviluppo dei tile, oltre il rettangolo
grezzo restituito da `rasterBevelInfluenceBounds()`.

Il percorso corrente resta visivamente stabile perché il campo viene prima
azzerato (`src/bevel-renderer.ts:1808-1819`) e soltanto i tile schedulati sono
riscritti. Fuori dall'inviluppo schedulato rimane quindi lo zero della clear,
non lo zero prodotto dall'algoritmo Heightfield V2. Un bbox può riprodurre
questa semantica solo definendo esplicitamente come dominio l'inviluppo
tile-aligned dei job, non sostenendo che il valore matematico del campo sia
zero fuori dagli influence bounds.

Conclusione del punto B: la frase «i bounds di influenza contengono tutti i
pixel in cui il campo è diverso da zero, per tutte le modalità» non è
dimostrabile sul renderer corrente.

## C. Percorsi di crescita e osservatori

### Bounds persistenti del layer

`noteLayerMutation()` azzera `layerContentBounds` dopo una clear e altrimenti
unisce ogni dirty rect al massimo storico corrente
(`src/brush-engine.ts:6042-6051`). I chiamanti di produzione sono:

- clear e frame Light Glaze (`src/brush-engine.ts:8989`,
  `src/brush-engine.ts:9277`);
- Paint normale, Blend dry e replay Undo/Redo, che convergono nel frame comune
  (`src/brush-engine.ts:9720-9723`);
- cambio formato e comando Pulisci, che azzerano esplicitamente i bounds
  (`src/brush-engine.ts:2121-2129`, `src/brush-engine.ts:2533-2541`).

Il contenuto persistente può quindi crescere a ogni dirty rect Paint/Blend e
durante un replay; non si restringe fra due clear.

### Bounds virtuali transienti

Light Glaze unisce `layerContentBounds` alla dirty rect della sessione prima
del commit (`src/brush-engine.ts:9113-9122`). Il tail predittivo fa lo stesso
con la sua dirty rect (`src/brush-engine.ts:9749-9767`). Questi bounds possono
crescere frame per frame durante la pennellata senza modificare ancora i bounds
persistenti.

### Cambi di stile e sorgente

Un cambio geometry invalida il campo e lo ricostruisce sui bounds esistenti
(`src/brush-engine.ts:1998-2055`). Size, soften, mode e technique possono
quindi allargare l'influenza anche senza una mutazione del layer. Un cambio fra
`permanent`, `light-glaze` e `thickness-tail` forza ugualmente clear e rebuild
(`src/brush-engine.ts:6093-6113`).

Il retarget è un caso separato: l'API riceve soltanto view e formato
(`src/brush-engine.ts:3147-3163`), poi passa intenzionalmente un rettangolo
4096×4096 come mutation e content bounds (`src/brush-engine.ts:3165-3197`).
Non esistono oggi metadati con cui ricavare la bbox della nuova texture.

### Osservatori

- `encodeRasterStrokeUpdate()` sceglie fra rebuild dell'influenza completa e
  ROI incrementale (`src/brush-engine.ts:6067-6118`).
- `rasterBevelInfluenceBounds()` è l'osservatore del dominio del campo
  (`src/brush-engine.ts:6035-6040`).
- `rasterBevelVisualBounds()` è distinto e serve a comporre soltanto la zona
  visibile (`src/brush-engine.ts:6028-6033`,
  `src/brush-engine.ts:2027-2065`).
- `RasterBevelRenderer.encode()` normalizza la ROI, la converte nei job
  tile-aligned e usa la mutation rect per il gate alpha
  (`src/bevel-renderer.ts:1482-1517`).

## D. Blocco strutturale della crescita “solo corona”

La texture corrente nasce con dimensione immutabile nel costruttore
(`src/bevel-renderer.ts:900-933`). Una nuova `GPUTexture`:

- non eredita i texel della precedente;
- richiede nuove view e nuovi bind group Smusso/Traccia/display
  (`src/bevel-renderer.ts:1234-1273`,
  `src/stroke-renderer.ts:1876-1884`);
- non può ricevere i texel vecchi tramite il percorso attuale, perché la
  texture non ha neppure `COPY_SRC`/`COPY_DST`
  (`src/bevel-renderer.ts:925-929`).

Se, dopo una crescita, si ricostruisce soltanto la corona, l'intersezione fra
vecchio e nuovo dominio resta non inizializzata. Per preservarla serve almeno
una delle seguenti scelte:

1. `copyTextureToTexture` della regione valida;
2. rebuild anche dell'intersezione dalla sorgente;
3. campo paged/tiled o più texture;
4. allocazione fisica full-document fin dall'inizio.

La prima viola «nessuna copia», la seconda viola «rebuild della sola corona»,
la terza è fuori scope e la quarta elimina il risparmio di memoria cercato.
Non esiste un quinto percorso implicito di resize/preserve in WebGPU.

Anche «nessuna realloc durante una pennellata attiva» entra in conflitto con la
crescita dei bounds transienti appena elencata: il percorso Light Glaze/tail
può attraversare in un frame un lato della capacità corrente mentre
`activeStroke` è ancora valorizzato. Garantire l'assenza di realloc richiede
preallocare il massimo documento all'inizio del tratto, rimandare
l'aggiornamento visivo al lift, oppure adottare una rappresentazione espandibile.
Le prime due opzioni perdono rispettivamente il beneficio di memoria o la
parità frame-per-frame; la terza è fuori scope.

## Decisioni emerse dal gate (risolte)

Le decisioni richieste dall'audit sono state fornite prima dello Step 2:

1. dominio tile-aligned e valore esterno esplicito, incluso `pillow`;
2. nessuna copia: alla sostituzione si ricostruisce tutto il nuovo bbox;
3. crescita della texture ammessa solo all'inizio del frame;
4. content bounds aggiunti a retarget e benchmark.

Il flag bbox resta default-OFF: il percorso full-document di `e9851ed` rimane
il controllo indipendente e non viene riscritto per condividere scorciatoie con
il candidato.
