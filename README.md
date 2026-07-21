# WebGPU Brush Engine — 4096² / Spacing 1% / Count 24

Prototipo TypeScript senza framework per verificare l'architettura di un motore di pittura WebGPU su desktop e dispositivi mobili.

## Cosa contiene

- Layer logico **4096 × 4096**, suddiviso in una texture array di **4 × 4 tile da 1024 px**.
- Formato selezionabile `rgba8unorm` (**64,25 MiB**) o `rgba16float` (**128,5 MiB**), inclusi gutter da 1 px.
- Resampling del percorso per distanza, indipendente dalla frequenza dei `pointermove`.
- Supporto Pointer Events, pressione e `getCoalescedEvents()` quando disponibile.
- Cerchio analitico antialias: nessuna texture della punta e nessun MSAA.
- `Count` fino a 24: ogni copia fisica viene assegnata alle tile che interseca con un binning CPU stabile.
- Una draw istanziata per tile attiva; il vertex shader continua a calcolare direttamente seed, jitter, posizione e colore di ogni copia.

- Color jitter deterministico in HSL: Hue, Saturation, Lightness e Darkness.
- Jitter di posizione lineare e laterale, indipendente per ogni copia fisica.
- Color jitter condiviso dal gruppo oppure indipendente per copia.
- Blend normale premoltiplicato e modalità additiva intensa.
- Render pass limitati alle tile attive e sincronizzazione dei gutter per il campionamento lineare senza cuciture.
- Zoom, pan, fit, clear e benchmark sintetico.
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

## Layer tiled e ordine del blending

Il layer persistente è una `texture_2d_array` di 16 slice. Ogni tile ha un'area centrale da 1024 × 1024 pixel e un gutter da 1 px per lato. Il display seleziona la slice dalla coordinata globale e campiona anche il gutter, evitando discontinuità nell'antialiasing e nel filtro lineare ai bordi.

Il binning conserva l'ordine originale stamp-major/copy-minor dentro ogni tile. Una copia che attraversa un confine viene inserita, nello stesso punto relativo, in tutte le tile interessate. Nel buffer vengono salvati soltanto gli indici dello stamp e della copia: le formule WGSL del pennello restano il percorso autorevole e non esiste un compute prepass che materializza le copie fisiche.

## Interpretazione del flow

In questo prototipo `Flow` è l'alpha di **ogni copia fisica** prima di pressione, copertura e `Blend intensity`. Per esempio, con flow 7% e Count 24, quando le copie sono sovrapposte al centro:

```text
1 - (1 - 0.07)^24 ≈ 82.5%
```

Con spacing 1%, gruppi successivi si sovrappongono molto e il tratto raggiunge rapidamente l'opacità. Questo è voluto per rendere evidente il costo dell'overdraw e la differenza tra flow per copia e opacità complessiva.

## Cosa non è ancora incluso

Questo è un benchmark del brush core, non ancora un clone completo di Procreate. Mancano allocazione sparse/on-demand delle tile, undo, più layer, maschera temporanea del tratto, stroke opacity applicata una sola volta, texture/grain della punta, smudge, wet mix e salvataggio del documento.

La prima versione tiled va ora misurata con lo stesso replay e sullo stesso iPhone della baseline, prima di aggiungere altri cambiamenti architetturali.
