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
- Blend normale premoltiplicato, modalità additiva intensa, Light Glaze e
  M1 Glaze non accumulativo.
- Scissor rectangle sul rettangolo sporco del batch.
- Canvas a tutta area con pannelli sovrapposti richiudibili; i pannelli si chiudono automaticamente quando parte un test.
- Un dito disegna, due dita eseguono pan e pinch-zoom; restano disponibili zoom, pan, fit, clear e benchmark sintetico.
- Undo/Redo per tratto con cronologia CPU degli stamp e ricostruzione GPU soltanto quando richiesta.
- Grain Cotton Fleece M1 originale con modalità `Fixed` e `Moving`, texture
  RGBA nativa 2500² e mip generati in WebGPU/WGSL.
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

`M1 Glaze — non accumulativo` replica la semantica `cov8` di M1: durante una
singola pennellata conserva per ogni pixel la coverage R8 massima, non la somma
o il source-over degli stamp. In formula, `C(x) = maxᵢ coverageᵢ(x)`. Un solo
colore viene scelto per l'intero tratto e tinta e Opacità sono applicate una
volta al resolve. Due pennellate separate continuano invece a compositarsi
normalmente sul layer. `Light Glaze` resta disponibile e invariato per il
confronto.

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

Il vecchio derivato `grain-cotton-fleece-2048.png` non è più usato. Il runtime
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
percorso copre Circle, Shape e occupancy, Normal, Additive, Light Glaze e M1
Glaze. `Off` continua a selezionare il modulo WGSL e le pipeline legacy senza
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
Il selettore di blending applica l'intensità prevista dalla relativa modalità:

1. `Normal accumulativo — 4×`;
2. `M1 Glaze non accumulativo — 1×`.

Size, spacing, Count, flow, hardness, jitter, seed, pressione, traccia e ordine
degli stamp partono dai valori canonici. Per misurare il costo della texture
bisogna confrontare Off e Fixed con lo stesso blending. Se lo spacing adattivo
termina a un valore diverso e cambia stamp/copie fisiche, il confronto non
isola il costo della texture e va dichiarato come tale. Le run devono essere
eseguite dall'utente sullo stesso iPhone con **Play tratto registrato**; build e
smoke locali non sono risultati prestazionali e non sostituiscono la baseline.

L'asset e le invarianti statiche si verificano con:

```bash
npm run grain:verify
```

## Cosa non è ancora incluso

Questo è un benchmark del brush core, non ancora un clone completo di Procreate. Mancano tile sparse, più layer, smudge, wet mix e salvataggio del documento.

Gli esperimenti tiled delle run `#23` e `#25` e lo scratch sulla dirty rectangle della run `#27` sono stati misurati e bocciati. Il runtime pubblicato è tornato alla baseline monolitica della run `#19`; metriche, diagnosi e motivazioni dei rollback sono conservate in `AGENTS.md`.
