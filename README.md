# M1M4 WebGPU Editor

Editor grafico locale basato su WebGPU, scritto in TypeScript senza framework UI.
Supporta pittura e fusione, livelli raster, selezioni, effetti, testo/SVG/immagini,
Undo/Redo e salvataggio dei progetti nel browser.

## Avvio rapido

Requisiti: Node.js 22.12 o successivo e un browser con WebGPU.

```powershell
npm ci
npm run dev
```

Comandi principali:

| Comando | Uso |
|---|---|
| `npm run dev` | Editor di produzione in sviluppo |
| `npm run labs:dev` | Laboratori, benchmark e test GPU manuali |
| `npm run typecheck` | Controllo TypeScript strict |
| `npm run verify` | Tutti i verifier registrati |
| `npm run build` | Typecheck e bundle di produzione |
| `npm run check` | Gate completo: typecheck, verifier, bundle editor e Labs |

`dist/` e `dist-labs/` sono output generati e ignorati da Git.

## Percorso di lettura

Per capire il progetto senza attraversare tutto il repository:

1. Leggere [ARCHITECTURE.md](./ARCHITECTURE.md).
2. Aprire `src/startup.ts`: decide fra libreria progetti ed editor.
3. Aprire `src/main.ts`: è la composition root dei controller e del motore.
4. Consultare il proprietario del dominio da modificare, non l'intero
   `BrushEngine`.
5. Leggere il verifier del dominio prima di cambiare un contratto.

## Mappa essenziale

| Area | Proprietari principali |
|---|---|
| Bootstrap e composizione | `src/startup.ts`, `src/main.ts` |
| Shell HTML/CSS | `src/ui-shell/`, `src/styles/` |
| Motore e percorso caldo del tratto | `src/brush-engine.ts`, renderer e runtime `engine-*` |
| Pennelli | `brush-definition.ts`, `brush-catalog.ts`, `brush-builtin-assets.ts` |
| Livelli e compositing | `engine-layer-*-runtime.ts`, `layer-stack.ts` |
| Scena testo/SVG/immagini | `mixed-scene-*`, `scene-*-model.ts` |
| Effetti raster | `raster-effects-contract.ts`, controller e runtime raster |
| Undo/Redo | `history-service.ts`, `engine-history-runtime.ts`, moduli `history-*` |
| Progetti persistiti | `project-storage-*`, `engine-project-runtime.ts` |
| Laboratori | `src/labs/`, raggiungibili soltanto da `labs.html` |
| Verifiche | `scripts/verify-*.mjs`, registro in `scripts/verification-suite.mjs` |

`engine-layer-runtime.ts`, `engine-vector-text-runtime.ts`, `project-storage.ts`
e `styles.css` sono facciate: indicano il confine pubblico ma non devono tornare
a contenere implementazioni monolitiche.

## Dati e compatibilità

- I pixel autorevoli del documento sono RGBA16F lineari.
- I nuovi documenti accettano lati da 64 a 4000 px; i progetti storici 4096²
  restano leggibili.
- I progetti sono persistenti e transazionali; la History è una cache di sessione
  separata, eventualmente trasferibile su IndexedDB/OPFS.
- ID storici e migrazioni compatibili vivono sotto `src/compat/`.
- `Shape.png`, `Shapepencil.png`, `Grainpencil.png`, i font, i golden e le fixture
  Labs sono asset autorevoli, non materiale temporaneo.

## Prima di consegnare una modifica

Eseguire almeno i verifier mirati e infine:

```powershell
npm run check
git diff --check
```

Le regole operative brevi per agenti e LLM sono in [AGENTS.md](./AGENTS.md).
