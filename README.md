# WebGPU Brush Engine — 4096² / Spacing 1% / Count 24

Prototipo TypeScript senza framework per verificare l'architettura di un motore di pittura WebGPU su desktop e dispositivi mobili.

## Cosa contiene

- Layer persistente monolitico **4096 × 4096**.
- Formato selezionabile `rgba8unorm` (**64 MiB**) o `rgba16float` (**128 MiB**).
- Resampling del percorso per distanza, indipendente dalla frequenza dei `pointermove`.
- Supporto Pointer Events, pressione e `getCoalescedEvents()` quando disponibile.
- Cerchio analitico antialias: nessuna texture della punta e nessun MSAA.
- `Count` da 1 a 24 con una sola draw istanziata per batch; il vertex shader continua a calcolare direttamente seed, jitter, posizione e colore di ogni copia.

- Color jitter deterministico in HSL: Hue, Saturation, Lightness e Darkness.
- Jitter di posizione lineare e laterale, indipendente per ogni copia fisica.
- Color jitter condiviso dal gruppo oppure indipendente per copia.
- Blend normale premoltiplicato e modalità additiva intensa.
- Composizione del batch in un attachment scratch limitato alla dirty rectangle: copia dal layer, un render pass ordinato e copia di ritorno.
- Scratch riutilizzabile, dello stesso formato del layer, con dimensioni arrotondate a blocchi da 128 px e crescita solo quando necessaria.
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

## Attachment scratch e ordine del blending

Il documento resta in una singola texture persistente `4096×4096`. Per ogni batch il motore calcola la stessa dirty rectangle direzionale conservativa della baseline, ne copia i pixel nella posizione `(0, 0)` di una texture scratch, esegue un solo render pass e ricopia il risultato nella stessa regione del layer. Il display continua a campionare direttamente il layer monolitico.

La draw usa l'ordine originale stamp-major/copy-minor, perciò normal premultiplied e additive ricevono la stessa sequenza di blending. Una copia che oltrepassa una divisione ideale non viene spezzata né duplicata: la dirty rectangle contiene l'intero supporto del quad e un margine conservativo di 2 px, quindi antialiasing e derivate non incontrano un bordo dello scratch. Non ci sono tile, binning per copia, gutter o compute prepass.

La dimensione fisica dello scratch viene arrotondata separatamente sui due assi a multipli di 128 px e cresce soltanto quando un batch non entra nell'allocazione corrente. Un `clear` seguito da `waitForIdle()` lo rilascia; il replay canonico parte quindi da uno scratch non allocato. La telemetria revisione 4 registra allocazioni, dimensione massima, area richiesta e reale dell'attachment, pixel copiati, pass scratch e pass di clear.

## Interpretazione del flow

In questo prototipo `Flow` è l'alpha di **ogni copia fisica** prima di pressione, copertura e `Blend intensity`. Per esempio, con flow 7% e Count 24, quando le copie sono sovrapposte al centro:

```text
1 - (1 - 0.07)^24 ≈ 82.5%
```

Con spacing 1%, gruppi successivi si sovrappongono molto e il tratto raggiunge rapidamente l'opacità. Questo è voluto per rendere evidente il costo dell'overdraw e la differenza tra flow per copia e opacità complessiva.

## Cosa non è ancora incluso

Questo è un benchmark del brush core, non ancora un clone completo di Procreate. Mancano undo, più layer, maschera temporanea del tratto, stroke opacity applicata una sola volta, texture/grain della punta, smudge, wet mix e salvataggio del documento.

La variante dirty-scratch va misurata con il replay canonico sullo stesso iPhone e confrontata direttamente con la run monolitica `#19`. Le run tiled `#23` e `#25` restano utili soltanto per spiegare perché sono stati eliminati pass per tile, duplicazione delle copie e gutter.
