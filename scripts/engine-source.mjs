// Sorgente dichiarato del motore, per le suite `*:verify`.
//
// `src/brush-engine.ts` non e' piu' un file unico: conserva la classe
// `BrushEngine`, mentre tipi, strategie, limiti, risorse e funzioni pure vivono
// nei moduli elencati qui sotto. Le verifiche statiche asseriscono su COSA il
// motore dichiara, non su DOVE lo dichiara: leggendo l'insieme dei moduli
// restano valide anche quando un simbolo cambia file.
//
// Il testo restituito e' la concatenazione dei file nell'ordine di questa lista,
// quindi ogni dichiarazione resta contigua: continuano a funzionare sia i
// controlli di presenza sia le finestre `indexOf(...) + slice(...)`.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

/** La classe, e i moduli che ne contengono le dichiarazioni estratte. */
export const ENGINE_SOURCE_FILES = Object.freeze([
  "brush-engine.ts",
  "engine-types.ts",
  "destructive-raster-edit-contract.ts",
  "engine-brush-assets.ts",
  "engine-strategies.ts",
  "engine-stats.ts",
  "engine-limits.ts",
  "engine-math.ts",
  "engine-memory-model.ts",
  "shape-occupancy.ts",
  "adaptive-preview-runtime.ts",
  "engine-stroke-types.ts",
  "engine-raster-stroke-pipelines.ts",
  "engine-raster-stroke-pipeline-factory.ts",
  "engine-history-types.ts",
  "engine-history-storage-host.ts",
  "engine-layer-resources.ts",
  "engine-vector-text-resources.ts",
  "engine-paint-resources.ts",
  "engine-geometry.ts",
  "engine-gpu-utils.ts",
  "engine-stamp-upload.ts",
  "engine-cold-storage.ts",
  "engine-reports.ts",
  "engine-vector-text-runtime.ts",
  "engine-vector-text-resources-runtime.ts",
  "engine-vector-text-fast-runtime.ts",
  "engine-vector-text-fallback-runtime.ts",
  "engine-vector-text-segmented-runtime.ts",
  "engine-mixed-scene-mutation-runtime.ts",
  "engine-raster-image-runtime.ts",
  "engine-raster-transform-runtime.ts",
  "engine-gaussian-blur-runtime.ts",
  "engine-motion-blur-runtime.ts",
  "engine-noise-runtime.ts",
  "engine-liquify-runtime.ts",
  "engine-vector-raster-runtime.ts",
  "engine-history-runtime.ts",
  "engine-fill-runtime.ts",
  "engine-selection-runtime.ts",
  "engine-glaze-runtime.ts",
  "engine-adaptive-preview-runtime.ts",
  "engine-layer-runtime.ts",
  "engine-layer-recreation-runtime.ts",
  "engine-layer-effects-runtime.ts",
  "engine-layer-fold-runtime.ts",
  "engine-layer-surface-runtime.ts",
  "engine-layer-clipping-runtime.ts",
  "engine-layer-composite-runtime.ts",
  "engine-layer-command-runtime.ts",
  "engine-layer-effect-lifecycle-runtime.ts",
  "engine-layer-residency-runtime.ts",
  "engine-layer-structure-runtime.ts",
  "engine-layer-merge-runtime.ts",
  "engine-layer-blend-tile-runtime.ts",
  "engine-resource-setup.ts",
  "engine-brush-settings-runtime.ts",
  "engine-raster-style-runtime.ts",
  "engine-runtime-misc.ts",
  "engine-project-runtime.ts",
]);

function readModule(file) {
  // Static source contracts use exact multiline snippets. Normalize host line
  // endings so the same verification behaves identically on Windows and CI.
  const text = readFileSync(new URL(file, SRC), "utf8").replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) {
    throw new Error(`src/${file} e' vuoto: la lista ENGINE_SOURCE_FILES e' disallineata`);
  }
  return text;
}

/**
 * Legge il motore come un unico testo. Fallisce se un modulo dichiarato in
 * `ENGINE_SOURCE_FILES` non e' piu' raggiungibile da `brush-engine.ts`: senza
 * questo controllo la lista potrebbe invecchiare in silenzio e le verifiche
 * asserirebbero su codice che il motore non usa piu'. Le facade possono
 * delegare ai propri owner senza obbligare la classe a importarli tutti.
 */
export function readEngineSource() {
  const parts = ENGINE_SOURCE_FILES.map(readModule);
  const declared = new Set(ENGINE_SOURCE_FILES);
  const sourceByFile = new Map(
    ENGINE_SOURCE_FILES.map((file, index) => [file, parts[index]]),
  );
  const reachable = new Set(["brush-engine.ts"]);
  const pending = ["brush-engine.ts"];
  while (pending.length > 0) {
    const owner = pending.pop();
    const source = sourceByFile.get(owner);
    const importPattern = /(?:from\s+|import\s*\()(["'])\.\/([^"']+)\1/g;
    for (const match of source.matchAll(importPattern)) {
      const imported = match[2].endsWith(".ts") ? match[2] : `${match[2]}.ts`;
      if (!declared.has(imported) || reachable.has(imported)) continue;
      reachable.add(imported);
      pending.push(imported);
    }
  }
  const unreachable = ENGINE_SOURCE_FILES.filter((file) => !reachable.has(file));
  if (unreachable.length > 0) {
    throw new Error(
      `moduli dichiarati ma non raggiungibili da src/brush-engine.ts: ${unreachable.join(", ")}. `
      + "Aggiorna la facade proprietaria o scripts/engine-source.mjs.",
    );
  }
  // Controllo disco -> lista: estrarre un nuovo modulo `engine-*.ts` senza
  // registrarlo qui renderebbe invisibile quel codice a TUTTE le verifiche
  // statiche, in silenzio. Meglio fallire subito.
  const onDisk = readdirSync(fileURLToPath(SRC))
    .filter((file) => file.startsWith("engine-") && file.endsWith(".ts"));
  const missing = onDisk.filter((file) => !declared.has(file));
  if (missing.length > 0) {
    throw new Error(
      `moduli del motore non registrati in ENGINE_SOURCE_FILES: ${missing.join(", ")}. `
      + "Senza registrazione le suite *:verify non ne leggono il contenuto.",
    );
  }
  return parts.join("\n");
}

/** Percorso assoluto di un modulo del motore, per i messaggi d'errore. */
export function engineSourcePath(file) {
  return fileURLToPath(new URL(file, SRC));
}
