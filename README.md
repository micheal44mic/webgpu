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
- Blend normale premoltiplicato e modalità additiva intensa.
- Scissor rectangle sul rettangolo sporco del batch.
- Canvas a tutta area con pannelli sovrapposti richiudibili; i pannelli si chiudono automaticamente quando parte un test.
- Un dito disegna, due dita eseguono pan e pinch-zoom; restano disponibili zoom, pan, fit, clear e benchmark sintetico.
- Undo/Redo per tratto con cronologia CPU degli stamp e ricostruzione GPU soltanto quando richiesta.
- Grain opzionale `Texturized` ancorato alle coordinate del layer, con texture
  Cotton Fleece R8 2K, mip CPU completi e filtri No/Classic/Improved.
- Registrazione locale di un tratto umano, con replay temporizzato e misure confrontabili tra versioni del motore.
- Telemetria CPU e tempo di completamento della coda GPU.

## Perché TypeScript

Il sorgente è TypeScript perché buffer, uniform layout, impostazioni del pennello e risorse GPU diventano rapidamente complessi. Vite produce JavaScript standard per il browser. La cartella `dist/` già compilata non richiede TypeScript né dipendenze runtime.

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

## Interpretazione del flow

In questo prototipo `Flow` è l'alpha di **ogni copia fisica** prima di pressione, copertura e `Blend intensity`. Per esempio, con flow 7% e Count 24, quando le copie sono sovrapposte al centro:

```text
1 - (1 - 0.07)^24 ≈ 82.5%
```

Con spacing 1%, gruppi successivi si sovrappongono molto e il tratto raggiunge rapidamente l'opacità. Questo è voluto per rendere evidente il costo dell'overdraw e la differenza tra flow per copia e opacità complessiva.

`Opacità` è un controllo separato. In `Normal premultiplied` e `Intense additive`
moltiplica l'alpha e il colore premoltiplicato di ogni stamp dopo il Flow. In
`Light Glaze`, invece, il Flow costruisce la coverage dentro una texture
temporanea per-stroke e Opacità viene applicata una sola volta all'intera
pennellata: una pennellata non può superare quel limite, mentre pennellate
distinte continuano a sovrapporsi normalmente.

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

## Grain Phase 1

Il controllo Grain offre soltanto `Off` e `Texturized`; la modalità Moving non
fa parte di questa fase. `Off` seleziona gli shader, bind group e pipeline
legacy senza ramo Grain. `Texturized` usa
`grain-cotton-fleece-2048.png`, un asset grayscale 8-bit opaco
`2048 × 2048` con repeat corretto, formato GPU `r8unorm` e catena completa di
12 mip generata deterministicamente sulla CPU prima del primo tratto.

La texture è ancorata a `@builtin(position)` nel render target autorevole del
layer: pan, zoom, viewport, posizione dello stamp e replay non possono farla
scorrere. Il valore campionato moltiplica la coverage della punta dopo la
coverage Circle/Shape e prima di alpha, pressione e compositing. Restano
disponibili Scale `10–400%`, Depth `0–100%`, Brightness e Contrast
`-100–100%`, filtro `No`, `Classic` o `Improved` e blend Grain `Multiply`.
I tre filtri corrispondono rispettivamente a texel e mip più vicino, bilineare
con mip più vicino e trilineare.

Il percorso copre Circle e Shape, inclusa la pre-mappa di occupazione, e tutti
i blend del brush: Normal, Additive e Light Glaze. Undo/Redo conserva
impostazioni e identità della texture. Quando Grain è attivo la tip preview
Canvas2D è disabilitata perché non può riprodurre fedelmente la texture
layer-space; probe FIFO e spacing adattivo continuano invece a funzionare.

`performanceTelemetryRevision: 22` salva strategia, coordinate, filtro,
pipeline, applicazione della coverage, risorsa/mip/identità, tempi di startup,
batch/stamp/copie Grain e skip della preview.

Per la prima misura sullo stesso dispositivo e con la stessa traccia canonica,
eseguire separatamente:

1. Base · Normal · Grain Off;
2. Base · Normal · Grain Texturized;
3. Fur · Normal · Grain Texturized.

Il selettore Grain del replay è indipendente da variante e blend. Il test fissa
Scale `100%`, Depth `100%`, Brightness `0%`, Contrast `0%`, filtro `Improved`
e Multiply; il preset canonico e le registrazioni storiche restano Grain Off.
Verificare `testVariant`, `testBlendMode`, `testGrainMode`, impostazioni,
fingerprint, punti, stamp e copie prima di confrontare le run. Le tre
combinazioni non vanno aggregate e questa fase locale non contiene ancora una
misura prestazionale su iPhone.

L’asset e le invarianti statiche si verificano con:

```bash
npm run grain:verify
```

## Cosa non è ancora incluso

Questo è un benchmark del brush core, non ancora un clone completo di Procreate. Mancano tile sparse, più layer, Grain Moving, smudge, wet mix e salvataggio del documento.

Gli esperimenti tiled delle run `#23` e `#25` e lo scratch sulla dirty rectangle della run `#27` sono stati misurati e bocciati. Il runtime pubblicato è tornato alla baseline monolitica della run `#19`; metriche, diagnosi e motivazioni dei rollback sono conservate in `AGENTS.md`.
