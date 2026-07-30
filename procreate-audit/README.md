# Procreate pixel audit

Pacchetto isolato dal motore WebGPU. Non modifica né viene importato
dall'applicazione.

## Generazione guide

```powershell
node procreate-audit/scripts/build-guides-final.mjs
```

## Analisi

Copia gli export Procreate in `procreate-audit/exports`, quindi:

```powershell
node procreate-audit/scripts/analyze.mjs
```

In alternativa passa i PNG direttamente:

```powershell
node procreate-audit/scripts/analyze.mjs `
  percorso/light-glaze.png `
  percorso/uniformed-glaze.png `
  percorso/color-space.png
```

Il comando stampa un riepilogo e salva `procreate-analysis.json` accanto al
primo PNG. Il risultato basato su Shape Count deve essere confermato in una
seconda fase con stamp spaziali successivi prima di dichiarare compatibilità.
