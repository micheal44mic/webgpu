import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HISTORY_ACTION_CHARACTERIZATION,
  HISTORY_ACTION_KINDS,
  HISTORY_BATCH_KINDS,
} from "../src/history-action-matrix.ts";
import { verificationScripts } from "./verification-suite.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const registeredVerifiers = new Set(verificationScripts);
const unique = (values) => [...new Set(values)];

assert.equal(
  new Set(HISTORY_ACTION_CHARACTERIZATION.map((entry) => entry.id)).size,
  HISTORY_ACTION_CHARACTERIZATION.length,
  "ogni riga della matrice History deve avere un ID univoco",
);

assert.deepEqual(
  unique(HISTORY_ACTION_CHARACTERIZATION.flatMap((entry) => entry.actionKinds)).sort(),
  [...HISTORY_ACTION_KINDS].sort(),
  "la matrice deve coprire ogni discriminante HistoryAction",
);
assert.deepEqual(
  unique(HISTORY_ACTION_CHARACTERIZATION.flatMap((entry) => entry.batchKinds)).sort(),
  [...HISTORY_BATCH_KINDS].sort(),
  "la matrice deve coprire ogni discriminante HistoryRenderBatch",
);

assert.deepEqual(
  unique(HISTORY_ACTION_CHARACTERIZATION.map((entry) => entry.family)).sort(),
  [
    "layer-properties-effects",
    "layer-structure",
    "paint-blend",
    "raster-operations",
    "selection",
    "semantic-scene",
  ],
  "le sei famiglie della Fase 7 devono restare caratterizzate",
);

const requiredRows = [
  "paint",
  "blend",
  "fill",
  "clear",
  "destructive-raster-filters",
  "layer-rasterize",
  "raster-transform",
  "group-transform",
  "layer-blend-mode",
  "layer-metadata-effects",
  "document-background",
  "layer-add",
  "layer-duplicate",
  "layer-delete",
  "scene-reorder",
  "layer-merge",
  "pixel-selection",
  "text-svg-atomic",
  "text-svg-gesture",
  "legacy-image-compat",
  "raster-image-import",
  "vector-rasterize",
];
assert.deepEqual(
  HISTORY_ACTION_CHARACTERIZATION.map((entry) => entry.id),
  requiredRows,
  "la matrice non deve perdere una mutazione registrabile nota",
);

for (const entry of HISTORY_ACTION_CHARACTERIZATION) {
  assert(entry.currentMethods.length > 0, `${entry.id}: mancano gli entrypoint correnti`);
  assert(entry.owner.length > 0, `${entry.id}: manca il proprietario`);
  assert(entry.undoRedoPath.length > 0, `${entry.id}: manca il percorso Undo/Redo`);
  assert(entry.recovery.length > 0, `${entry.id}: manca la strategia di recovery`);
  assert(
    entry.currentAtomicity === "verified" || entry.currentRisk,
    `${entry.id}: un gap atomico deve dichiarare il rischio corrente`,
  );
  assert(entry.verifiers.length > 0, `${entry.id}: manca il verifier autorevole`);
  for (const verifier of entry.verifiers) {
    assert(
      existsSync(resolve(scriptsDirectory, verifier)),
      `${entry.id}: verifier inesistente ${verifier}`,
    );
    assert(
      registeredVerifiers.has(verifier),
      `${entry.id}: verifier non registrato nella suite ${verifier}`,
    );
  }
}

const selection = HISTORY_ACTION_CHARACTERIZATION.find((entry) => entry.id === "pixel-selection");
assert(selection, "manca la caratterizzazione della selezione pixel");
assert.equal(
  selection.selection,
  "not-independent",
  "la selezione non deve essere inventata come journal parallelo",
);
assert.deepEqual(
  [...selection.actionKinds],
  ["stroke", "raster-transform"],
  "Paint e Transform devono restare i proprietari delle snapshot di selezione",
);

const fill = HISTORY_ACTION_CHARACTERIZATION.find((entry) => entry.id === "fill");
assert.equal(fill?.selection, "baked-into-payload");
assert.equal(fill?.payload, "gpu-fill-mask");

const layerMetadata = HISTORY_ACTION_CHARACTERIZATION.find(
  (entry) => entry.id === "layer-metadata-effects",
);
assert.equal(layerMetadata?.cancelPolicy, "untouched-only");

const add = HISTORY_ACTION_CHARACTERIZATION.find((entry) => entry.id === "layer-add");
const duplicate = HISTORY_ACTION_CHARACTERIZATION.find((entry) => entry.id === "layer-duplicate");
assert.equal(add?.spillable, false);
assert.equal(duplicate?.spillable, true);
assert.equal(add?.payload, "none");
assert.equal(duplicate?.payload, "conditional-cold-seed");

const legacyImage = HISTORY_ACTION_CHARACTERIZATION.find(
  (entry) => entry.id === "legacy-image-compat",
);
assert.equal(legacyImage?.status, "legacy-compat");
assert.equal(legacyImage?.commitPolicy, "legacy-read-only");

for (const id of [
  "paint",
  "blend",
  "text-svg-atomic",
  "text-svg-gesture",
]) {
  assert.equal(
    HISTORY_ACTION_CHARACTERIZATION.find((entry) => entry.id === id)?.branchCut,
    "on-commit",
    `${id}: il taglio Redo deve avvenire soltanto al commit`,
  );
}

console.log("History action matrix verification passed.");
