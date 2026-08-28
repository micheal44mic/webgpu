import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = resolve(root, "dist");

function outputFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? outputFiles(absolute) : [absolute];
  });
}

const files = outputFiles(outputRoot);
const relativeFiles = files.map((file) => relative(outputRoot, file).replaceAll("\\", "/"));
assert.ok(relativeFiles.some((file) => file.endsWith("index.html")), "Build senza index.html.");
assert.ok(relativeFiles.some((file) => file.endsWith(".js")), "Build senza JavaScript.");
assert.ok(!relativeFiles.some((file) => file.endsWith("labs.html")), "labs.html nel build editor.");

const serverSource = readFileSync(resolve(root, "scripts/prepare-sites-build.mjs"), "utf8");
assert.match(
  serverSource,
  /IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"/,
  "Il Worker non rende persistente la cache degli asset versionati.",
);
assert.match(
  serverSource,
  /IMMUTABLE_ASSET_PATH\.test\(url\.pathname\)/,
  "La cache lunga non è limitata agli asset con hash.",
);

const forbiddenFileFragments = [
  "bevel-bbox-golden",
  "clipping-group-gpu-test",
  "editor-labs",
  "effects-benchmark",
  "engine-lab-operations",
  "human-stroke-lab",
  "group-transform-gpu-test",
  "gpu-startup-diagnostics",
  "iphone-memory-limit-test",
  "layer-blend-gpu-test",
  "layer-cold-tile-composite-gpu-test",
  "layer-composite-gpu-test",
  "layer-compression-study-contract",
  "layer-history-gpu-test",
  "layer-memory-stress-test",
  "layer-merge-gpu-test",
  "mixed-memory-benchmark",
  "shadow-golden",
  "stroke-golden",
  "vector-zoom-labs",
];
const forbiddenFiles = relativeFiles.filter((file) => {
  const lower = file.toLowerCase();
  return forbiddenFileFragments.some((fragment) => lower.includes(fragment));
});
assert.deepEqual(
  forbiddenFiles,
  [],
  `Chunk di laboratorio presenti nel bundle editor:\n${forbiddenFiles.join("\n")}`,
);

const forbiddenContentMarkers = [
  "WebGPU Brush Engine Labs",
  "Laboratorio sconosciuto:",
  "Test livelli scaduto dopo 180 s",
  "/api/iphone-memory-limit-runs",
  "/api/layer-compression-runs",
  "/api/vector-zoom-runs",
  "__vectorZoomCoverageReport",
  "__vectorZoomStressReport",
  "gpu-startup-rgba16f-timed-app-boot-v4",
  "gpu-startup-app-frame-v3",
  "/api/gpu-startup-diagnostics",
  "gpuDiagnosticAppFrame",
];
const forbiddenItalianPatterns = [
  {
    label: "accented Italian UI vocabulary",
    pattern: /\b(?:perché|più|già|così|può|verrà|continuità|qualità|opacità|attività|unità|metà|modalità|proprietà|funzionalità|disponibilità|visibilità)\b/i,
  },
  {
    label: "Italian UI vocabulary",
    pattern: /\b(?:annulla|applica|seleziona|selezionato|selezionata|selezione|livello|livelli|pennello|pennelli|gomma|sposta|disegna|disegno|riempimento|colore|colori|strumenti|cronologia|memoria|ombra|sovrapposizione|smusso|immagine|testo|scena|errore|fallito|fallita|riuscito|riuscita|pronto|pronta|mancante|disponibile|creazione|eliminazione|duplicazione|caricamento|trasformazione|rasterizzazione|ripristino|riprova|attendi|nessun|nessuna|vuoto|vuota|documento|progetto|maschera|tratto|riordino|fusione|ritaglio|riferimento|anteprima|dimensione|dimensioni|larghezza|altezza|trasparenza|opacita|pulisci|chiudi|apri|incolla|rapporto|diagnosi|corrente|picco|risorsa|risorse|effetto|effetti|coda|spessore|piramide|piramidi|pagina|pagine|attivo|attiva|nascosto|nascosta|interrotto|interrotta|completato|completata)\b/i,
  },
  {
    label: "Italian UI phrase",
    pattern: /\b(?:prima di|in corso|non disponibile|non consentit[oa]|non trovat[oa]|non inizializzat[oa]|ricarica la pagina|tocca una regione|premi subito|sola memoria)\b/i,
  },
  {
    label: "Italian runtime vocabulary",
    pattern: /\b(?:attesi?|oltre|gi[aà]|finalizzat[oa]|richiede|campioni|capacit[aà]|insufficiente|assegnat[oa]|errat[oa]|deve|devono|restare|trovat[ai]|impossibile|cambio|impostazioni|duplicat[oa]|reidratat[oa]|incompatibile|periodici|azioni|possedut[oa]|viva|scartat[oa]|contemporaneamente|incomplet[oa]|lunghezza|tropp[oa]|compress[oa]|inattes[oa]|dichiarat[oa]|riservati|aggiornamento|bloccat[oa]|altra|scheda|sessione|assente|durante|registrazione|conflitto|generazione|attesa|terminat[oa]|risposta|lettura|chius[oa]|richiesta|scrittura|parziale|avanzamento|malformat[oa]|fuori|decompressione|divers[oa]|nonostante|confronto|numero|finit[oa]|negativ[oa]|lavoro|sfondo|sospes[oa]|zona|entra|margine|privi|prive|validi|valide|allineamento|guardia|contenuto|eccede|limite|miniature|intero|positiv[oa]|corta|canale|lineare|posizione|sconosciut[oa]|obbligatori[oa]|iniziale|incoerent[ei]|indice|lato|null[oa]|espansione|raggio|maggiore|punti|consecutivi|registrat[oa]|dati|portabile|sorgente|accetta|canonizzato|griglia|angolo|alto|basso|sinistro|destro|gesto|usare|quattro|spostati|isolatamente|rettangolo|vertici)\b/i,
  },
];
const textFiles = files.filter((file) => /\.(?:css|html|js|json|map)$/.test(file));
const contentViolations = [];
for (const file of textFiles) {
  const source = readFileSync(file, "utf8");
  for (const marker of forbiddenContentMarkers) {
    if (source.includes(marker)) {
      contentViolations.push(`${relative(outputRoot, file).replaceAll("\\", "/")}: ${marker}`);
    }
  }
  for (const { label, pattern } of forbiddenItalianPatterns) {
    if (pattern.test(source)) {
      contentViolations.push(
        `${relative(outputRoot, file).replaceAll("\\", "/")}: ${label}`,
      );
    }
  }
}
assert.deepEqual(
  contentViolations,
  [],
  `Codice di laboratorio presente nel bundle editor:\n${contentViolations.join("\n")}`,
);

console.log(`Bundle di produzione verificato: ${relativeFiles.length} file, nessun laboratorio.`);
