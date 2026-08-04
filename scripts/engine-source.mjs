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
  "engine-strategies.ts",
  "engine-stats.ts",
  "engine-limits.ts",
  "engine-math.ts",
  "engine-memory-model.ts",
  "shape-occupancy.ts",
  "adaptive-preview-runtime.ts",
  "engine-stroke-types.ts",
  "engine-history-types.ts",
  "engine-layer-resources.ts",
  "engine-vector-text-resources.ts",
  "engine-paint-resources.ts",
  "engine-geometry.ts",
  "engine-gpu-utils.ts",
  "engine-stamp-upload.ts",
  "engine-cold-storage.ts",
  "shape-mask-decode.ts",
  "engine-reports.ts",
  "engine-vector-text-runtime.ts",
  "engine-raster-image-runtime.ts",
  "engine-raster-transform-runtime.ts",
  "engine-vector-raster-runtime.ts",
  "engine-history-runtime.ts",
  "engine-fill-runtime.ts",
  "engine-selection-runtime.ts",
  "engine-glaze-runtime.ts",
  "engine-adaptive-preview-runtime.ts",
  "engine-layer-runtime.ts",
  "engine-layer-blend-tile-runtime.ts",
  "engine-resource-setup.ts",
  "engine-runtime-misc.ts",
]);

function readModule(file) {
  const text = readFileSync(new URL(file, SRC), "utf8");
  if (text.trim().length === 0) {
    throw new Error(`src/${file} e' vuoto: la lista ENGINE_SOURCE_FILES e' disallineata`);
  }
  return text;
}

/**
 * Legge il motore come un unico testo. Fallisce se un modulo dichiarato in
 * `ENGINE_SOURCE_FILES` non e' piu' importato da `brush-engine.ts`: senza questo
 * controllo la lista potrebbe invecchiare in silenzio e le verifiche
 * asserirebbero su codice che il motore non usa piu'.
 */
export function readEngineSource() {
  const parts = ENGINE_SOURCE_FILES.map(readModule);
  const [engine] = parts;
  for (const file of ENGINE_SOURCE_FILES.slice(1)) {
    const specifier = `"./${file.replace(/\.ts$/, "")}"`;
    if (!engine.includes(`from ${specifier}`)) {
      throw new Error(
        `src/${file} e' in ENGINE_SOURCE_FILES ma brush-engine.ts non lo importa piu': `
        + "aggiorna scripts/engine-source.mjs.",
      );
    }
  }
  // Controllo disco -> lista: estrarre un nuovo modulo `engine-*.ts` senza
  // registrarlo qui renderebbe invisibile quel codice a TUTTE le verifiche
  // statiche, in silenzio. Meglio fallire subito.
  const declared = new Set(ENGINE_SOURCE_FILES);
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
