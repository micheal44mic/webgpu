# WebGPU Brush Engine — 4096² / Spacing 1% / Count 24

Prototipo TypeScript senza framework per verificare l'architettura di un motore di pittura WebGPU su desktop e dispositivi mobili.

## Cosa contiene

- Layer reale **4096 × 4096**.
- Formato selezionabile `rgba8unorm` (**64 MiB**) o `rgba16float` (**128 MiB**).
- Resampling del percorso per distanza, indipendente dalla frequenza dei `pointermove`.
- Supporto Pointer Events, pressione e `getCoalescedEvents()` quando disponibile.
- Cerchio analitico antialias: nessuna texture della punta e nessun MSAA.
- Una sola draw istanziata per i punti base del batch.
- `Count` fino a 24: copie fisiche dello stamp per ogni punto di spacing, tutte disegnate con instancing GPU in una sola draw call.

- Color jitter deterministico in HSL: Hue, Saturation, Lightness e Darkness.
- Jitter di posizione lineare e laterale, indipendente per ogni copia fisica.
- Color jitter condiviso dal gruppo oppure indipendente per copia.
- Tre rendering pubblici separati: Light Glaze, Uniformed Glaze e Intense
  Blending. Il vecchio nome `m1-glaze` resta solo per il replay storico.
- Scissor rectangle sul rettangolo sporco del batch.
- Canvas a tutta area con pannelli sovrapposti richiudibili; i pannelli si chiudono automaticamente quando parte un test.
- Un dito disegna, due dita eseguono pan e pinch-zoom; restano disponibili zoom, pan, fit, clear e benchmark sintetico.
- Undo/Redo per tratto con cronologia CPU degli stamp e ricostruzione GPU soltanto quando richiesta.
- Grain Cotton Fleece M1 originale con modalità `Fixed` e `Moving`, texture
  RGBA nativa 2500² e mip generati in WebGPU/WGSL.
- Registrazione locale di un tratto umano, con replay temporizzato e misure confrontabili tra versioni del motore.
- Telemetria CPU e tempo di completamento della coda GPU.

## Perché TypeScript

Il sorgente è TypeScript perché buffer, uniform layout, impostazioni del pennello e risorse GPU diventano rapidamente complessi. Vite produce JavaScript standard per il browser. La cartella `dist/`, generata con la build e non tracciata da Git, non richiede TypeScript né dipendenze runtime dopo la generazione.

## Avvio in sviluppo

È consigliato Node.js 22.

```bash
npm install
npm run dev
```

Apri l'indirizzo `http://localhost:5173` sul computer.

## Build statica

```bash
npm run build
```

Il risultato è in `dist/`. Grazie a `base: "./"`, la build usa percorsi relativi e può essere caricata in una cartella di un hosting statico.

## Test su iPhone, iPad e Android

WebGPU richiede un contesto sicuro. `localhost` funziona sul computer, ma `http://192.168.x.x:5173` aperto dal telefono normalmente non è sufficiente. Per il test mobile pubblica la cartella `dist/` su un hosting HTTPS.

Usa browser e sistema operativo aggiornati. La pagina mostra un errore esplicito quando `navigator.gpu` non è disponibile o il limite texture è inferiore a 4096.

## Protocollo di confronto consigliato

Mantieni gli stessi valori di dimensione, spacing, Count e flow, poi esegui il benchmark in questo ordine:

1. `RGBA8`, jitter per copia disattivato, blend normale.
2. `RGBA8`, jitter per copia attivato.
3. `RGBA16F`, jitter per copia disattivato.
4. `RGBA16F`, jitter per copia attivato.
5. Ripeti con modalità `Intense additive`.

Registra per ogni dispositivo:

- numero di base stamps;
- CPU submit;
- GPU completion;
- eventuale perdita del device o errore di allocazione;
- fluidità percepita durante un tratto manuale lungo.

`GPU completion` è misurato con `queue.onSubmittedWorkDone()`: include il lavoro già in coda e la presentazione, quindi è utile per confrontare dispositivi e modalità, ma non equivale a una timestamp query hardware isolata.

## Flow e Opacity in Light Glaze

In Light Glaze, `Flow` regola quanto colore e texture può depositare una singola
stampa candidata. Indichiamo con `D_i(x)` quel deposito, dopo punta, texture e
risposta del Flow. Le stampe della stessa gesture non vengono mai composte fra
loro con source-over: per ogni pixel l'accumulatore conserva soltanto il
deposito candidato più forte incontrato mentre il dito resta abbassato.

```text
C_gesture(x) = max_i(D_i(x))
```

Questa formula vincola il non-accumulo, non presume ancora che la curva numerica
del Flow sia lineare o già calibrata pixel-per-pixel su Procreate.
`Opacity` viene applicata una volta sola a `C_gesture`, non a ogni stampa. Count,
spacing e sovrapposizione non possono quindi far crescere progressivamente il
deposito della stessa gesture; una stampa successiva può soltanto sostituire un
valore più debole con un singolo valore candidato più forte.

Al rilascio, il risultato viene committato una volta nel livello permanente.
Una nuova gesture usa un accumulatore vuoto e, al proprio rilascio, viene
composita normalmente sopra il risultato precedente:

```text
A_nuova = A_gesture + A_precedente × (1 - A_gesture)
```

Di conseguenza, la ripetizione dentro una gesture non accumula; due gesture
separate invece sì. Questa regola appartiene soltanto a Light Glaze: Uniformed
Glaze e Intense Blending hanno motori distinti e verranno calibrati separatamente.

La texture Light Glaze viene allocata soltanto al primo uso della modalità. Il
mip 0 conserva l'accumulatore raw dello stroke; i mip successivi conservano il
composito finale già filtrato sopra il layer permanente, così lo zoom ridotto
non scambia l'ordine fra filtering e source-over. Prima del filtro ogni texel
compositato viene quantizzato come il formato reale (`rgba8unorm` o
`rgba16float`); a LOD 0 la bilineare viene ricostruita dopo la stessa
quantizzazione per-texel. Il compositing è visibile live e il contributo viene
committato una sola volta nel layer permanente dopo l'ultimo batch pendente; la
cache di presentazione viene poi canonicalizzata dal layer committato.
La tip preview Canvas2D adattiva è disabilitata in Light Glaze e, come descritto
sotto, quando Grain Texturized è attivo: una patch di due stamp non può
rappresentare correttamente il limite globale della pennellata né una texture
ancorata al layer.

## Grain M1: Fixed e Moving

Il vecchio derivato `grain-cotton-fleece-2048.png` è stato rimosso: non era più
usato da nessuna parte. Il runtime
carica direttamente `graincottonfleece.PNG`, byte per byte uguale all'asset di
M1. Il file reale non è 4K: misura **2500 × 2500 px**, è RGBA8, conserva il
profilo ICC originale e ha SHA-256
`9AA1CE073885B83EA223AF0941EF74604548A85F54442228EC15522ACE3EF2D7`.
Non viene ridimensionato né convertito in grayscale prima dell'upload.

La texture GPU è `rgba8unorm`; la luma M1 viene ricavata in WGSL dai canali RGB
con i coefficienti `0.299 / 0.587 / 0.114`, mentre l'alpha del PNG non modula
il pennello. La catena NPOT completa
`2500→1250→625→312→156→78→39→19→9→4→2→1` viene costruita all'avvio con
render pass WebGPU e shader WGSL. Occupa circa **31,79 MiB**. Tutto il percorso
di disegno resta WebGPU/WGSL; M1 WebGL2/GLSL è usato soltanto come riferimento
semantico.

Le due impostazioni valutabili sono:

- `Texturized — Fixed M1`: la grana è carta ancorata alle coordinate
  autorevoli del layer. Pan, zoom, posizione e rotazione dello stamp non la
  spostano. Scale `10–400%` controlla il periodo, con default M1 `140%`.
- `Texturized — Moving M1`: una copia completa della texture segue ogni stamp
  nelle sue coordinate locali e ruota con esso. Come in M1, il controllo Scale
  è ignorato e viene disabilitato nella UI.

Depth, Brightness, Contrast, Invert e i filtri No/Classic/Improved restano
disponibili. Invert scambia chiaro e scuro dopo Brightness/Contrast e prima di
Depth. È incorporato nei coefficienti affini già caricati nella uniform: con
Invert spento i valori GPU restano identici, mentre acceso non aggiunge rami,
pipeline, binding o operazioni al fragment WGSL. Il campione moltiplica la
coverage dopo Circle/Shape e prima di flow, pressione, alpha e blending. Il
percorso copre Circle, Shape e occupancy nei tre rendering pubblici. `Off`
continua a selezionare il modulo WGSL e le pipeline legacy senza
binding o ramo Grain.

Undo/Redo conserva impostazioni e identità dell'asset. Con Grain attivo la tip
preview Canvas2D resta disabilitata perché non può riprodurre fedelmente
coordinate e filtering della texture; probe FIFO e spacing adattivo
continuano a funzionare. La telemetria distingue asset nativo, coordinate
Fixed/Moving, sampling, memoria, mip e strategia del glaze.

Fixed e Moving restano confrontabili manualmente per scegliere l'aspetto. Nel
replay prestazionale iPhone Moving non è usato: il selettore Grain offre
`Off — senza texture` e `Texturized — Fixed M1`. Quando Fixed è selezionato
usa Scale `140%`, Depth `100%`, Brightness/Contrast `0`, Improved e Multiply.
Invert viene forzato spento per conservare le baseline `#70–#73`.
La suite pubblica mantiene l'intensità interna neutra `1×` e confronta:

1. `Light Glaze`;
2. `Uniformed Glaze`;
3. `Intense Blending`.

Size, spacing, Count, flow, hardness, jitter, seed, pressione, traccia e ordine
degli stamp partono dai valori canonici. Per misurare il costo della texture
bisogna confrontare Off e Fixed con lo stesso blending. Se lo spacing adattivo
termina a un valore diverso e cambia stamp/copie fisiche, il confronto non
isola il costo della texture e va dichiarato come tale. Le run devono essere
eseguite dall'utente sullo stesso iPhone con **Play tratto registrato**; build e
smoke locali non sono risultati prestazionali e non sostituiscono la baseline.

Il contratto Light e le invarianti Grain si verificano con:

```bash
npm run light:verify
npm run grain:verify
```

## Cosa non è ancora incluso

Questo è un prototipo del brush core WebGPU, non un clone completo di Procreate.

Gli esperimenti tiled delle run `#23` e `#25` e lo scratch sulla dirty rectangle della run `#27` sono stati misurati e bocciati. Il runtime pubblicato è tornato alla baseline monolitica della run `#19`; metriche, diagnosi e motivazioni dei rollback sono conservate in `AGENTS.md`.
