# Regole operative per agenti

Leggere prima `README.md` e `ARCHITECTURE.md`. Considerare autorevole il codice
corrente, non vecchi commit o descrizioni storiche.

## Prima di modificare

- Eseguire `git status --short` e preservare tutte le modifiche preesistenti.
- Cercare con `rg` import statici e dinamici, Worker, HTML, CSS, script e fixture.
- Individuare il proprietario del dominio e il relativo verifier.
- Non usare reset, checkout distruttivi, commit, push o deploy senza richiesta.

## Confini da rispettare

- `src/main.ts` compone; non deve possedere funzionalità complete.
- `BrushEngine` è la facciata e conserva il percorso caldo Paint/Eraser/Blend. I moduli
  di dominio possono importarlo soltanto come tipo/capability prevista.
- Eraser è un'operazione raster destination-out, non un `BrushTool`: non va
  inserito nei preset o nello schema progetto.
- `engine-layer-runtime.ts`, `engine-vector-text-runtime.ts`,
  `project-storage.ts` e `styles.css` sono facciate, non contenitori di logica.
- Modificare la UI nei frammenti `src/ui-shell/` e `src/styles/`, non nell'HTML
  assemblato della build.
- Il codice produttivo non importa mai `src/labs/`.
- Project storage e History storage sono sistemi diversi: il primo è durevole,
  il secondo è una cache di sessione eliminabile.
- Le pubblicazioni History passano da `HistoryService`; preservare atomicità,
  branch Redo, rollback e una sola azione per gesto.
- Non cambiare schema progetto, formati History, ID persistiti o `src/compat/`
  senza migrazione esplicita e test di compatibilità.
- `canvas-tool-capabilities.ts` è la fonte autorevole per le capacità degli strumenti canvas.
- `destructive-raster-edit-contract.ts` definisce l'elenco esaustivo delle sessioni raster distruttive.
- Text Warp è semantico/vettoriale, distinto da un eventuale futuro Raster Warp/Puppet.
- Un filtro colore futuro deve prima essere classificato:
  a) non distruttivo: metadata/schema/history/compositor;
  b) distruttivo: core/shader/runtime/session e checkpoint pixel esatto.
- Non modificare budget, checkpoint, compressione o spill senza baseline e
  confronto nei Labs.
- Non eliminare file basandosi soltanto sull'assenza di import statici.

## Verifica

Durante il lavoro usare il comando mirato definito in `package.json`; prima della
consegna eseguire:

```powershell
npm run typecheck
npm run verify
npm run build:bundle
npm run labs:build
git diff --check
```

`npm run check` esegue insieme i primi quattro gate. Se si aggiunge un verifier,
registrarlo in `scripts/verification-suite.mjs`.

Per modifiche visive verificare anche layout stretto e largo, console, Paint,
Undo/Redo e il flusso direttamente interessato.

Non modificare o versionare `dist/`, `dist-labs/`, log e `node_modules/`.
Aggiornare `README.md` o `ARCHITECTURE.md` quando cambia un confine stabile.
