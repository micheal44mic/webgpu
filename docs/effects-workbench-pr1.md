# PR 1 — Banco effetti retargetable

## Ambito

Questa modifica introduce un solo `EffectsWorkbench` per il layer attivo. Il
workbench possiede i renderer Traccia e Smusso e mantiene una sola coppia di
campi persistenti/scratch, indipendentemente dal numero futuro di layer.

Non introduce layer multipli, tile, nuovi formati o cambiamenti agli shader
visivi. Coverage, threshold mask, heightfield e styled mip mantengono le
allocazioni e l'aggiornamento incrementale per ROI esistenti.

## Contratto di retarget

`EffectsWorkbench.retarget()` accetta una nuova view soltanto se il formato
coincide con quello del working set.

1. `RasterBevelRenderer.retarget()` sostituisce la view e ricostruisce i bind
   group delle tre source mode, preservando eventuali view transient esplicite.
2. `RasterStrokeRenderer.retarget()` sostituisce la view e ricostruisce
   seed/resolve/compose/threshold per le tre source mode.
3. L'engine ricostruisce i display bind group esterni.
4. L'engine invalida coverage, threshold mask, styled mip, heightfield e cache
   di presentazione.
5. Un unico encoder esegue `clearHeight`, `clearStyled`,
   `resetThresholdMask` e il rebuild dell'intero documento `4096×4096`.

I bind group di downsample dei mip styled non vengono ricreati: referenziano
soltanto le texture interne del workbench, che il retarget riusa.

Un formato incompatibile viene rifiutato con indicazione esplicita di usare
`setLayerFormat()`, cioè il percorso esistente di ricreazione completa.

## Benchmark obbligatorio

Ambiente:

- GPU: `nvidia · ampere`
- layer: RGBA8 lineare, `4096×4096`
- Traccia: outside `14 px`
- Smusso: inner/smooth `32 px`, soften `4`
- working set logico durante la prova: `126,764 MiB`
- 5 campioni per percorso, dopo warm-up
- `timestamp-query`: non disponibile nel browser della prova
- misura: wall clock fino a `GPUQueue.onSubmittedWorkDone()`; include il
  completamento del prefisso FIFO e il ritardo della callback JS, non è tempo
  GPU isolato

| Percorso | CPU setup + encode mediana | Coda + callback mediana | Totale mediano |
|---|---:|---:|---:|
| Retarget + rebuild full-document | 3,2 ms | 128,8 ms | 131,9 ms |
| Destroy + recreate + rebuild full-document | 25,1 ms | 126,8 ms | 152,2 ms |

Campioni totali:

- retarget: `150,9`, `131,9`, `130,1`, `131,4`, `133,1 ms`
- destroy+recreate: `150,5`, `154,9`, `152,2`, `156,6`, `147,1 ms`

Sul dispositivo provato il retarget evita `21,9 ms` mediani di setup/encode CPU
e riduce il totale mediano di `20,3 ms` (`−13,3%`). Il costo dominante rimane il
rebuild full-document, circa `127–129 ms` nella misura queue-prefix.

Il benchmark è disponibile solo in modalità dev e aggiorna il workbench
temporaneo esposto alle statistiche, così il monitor memoria continua a
conteggiare le allocazioni durante la prova.

Footprint logico delle sole risorse effetto (layer, swapchain e risorse Paint
esclusi):

| Stato | Memoria effetti |
|---|---:|
| Traccia e Smusso disattivati | 0 MiB |
| Dopo il rebuild full-document, durante il lavoro e al successivo idle | 126,764 MiB |
| Dopo il retarget e il relativo rebuild | 126,764 MiB |
| Destroy/recreate | 0 MiB nel gap, poi 126,764 MiB |

Il retarget non crea una seconda copia transitoria del working set: il
footprint prima e dopo resta identico. Lo scratch allocato dal rebuild resta
conteggiato all'idle secondo le policy già esistenti.

## Identità pixel

La diagnostica GPU rev 4 aggiunge il caso
`stroke-bevel-same-view-retarget`: costruisce Traccia + Smusso, esegue retarget
verso una seconda view della stessa texture, ricostruisce tutto e confronta
mip logico 0 e 1.

- mip 0 prima/dopo:
  `d1630de4de49ec60e3c8a30849357c485ab99f6c2f67e95c2181dd3fd8da9639`
- mip 1 prima/dopo:
  `f5bc2ae6ae117a3ebb5b604cfeba228d7b3e347fef3f8d8dfeae73a5bfebffd2`
- byte differenti: `0`
- delta massimo: `0`

Il combinato canonico mip 0 resta
`8d5a75a6abb9f47cdf4a794d560b5795aa4b4c85520db2dd1466833157f6dcb0`.
Nessun golden è stato modificato o rigenerato.

Il ramo di partenza conserva il mismatch v5 già registrato per i mip derivati
(`9208e2a3…` contro `f7f53472…`) e le tre diagnostiche source-mode già aperte.
La PR non modifica quegli hash; il nuovo caso di retarget passa.

## Verifiche

- `npm run stroke:verify`
- `npm run bevel:verify`
- `npm run grain:verify`
- `npm run blend:verify`
- `npm run thickness:verify`
- `npx tsc --noEmit`
- build Vite in directory temporanea, senza toccare `dist/`
- runtime WebGPU: nessun warning o errore di validazione
