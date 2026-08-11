import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const css = read("../src/styles.css");
const main = read("../src/main.ts");
const limits = read("../src/engine-limits.ts");

assert.match(
  main,
  /const mobileUiMediaQuery = window\.matchMedia\("\(min-width: 0px\)"\)/,
  "La stessa superficie editor deve essere attiva su ogni larghezza.",
);
assert.doesNotMatch(
  css,
  /@media \(max-width: 699px\)/,
  "I controlli condivisi non devono tornare a essere esclusivi del telefono.",
);
assert.match(
  css,
  /Superficie editor condivisa[\s\S]*?@media \(min-width: 0px\)[\s\S]*?\.mobile-header\s*\{[\s\S]*?display:\s*flex/,
  "Header e controlli condivisi devono essere visibili su tutti i dispositivi.",
);
assert.match(
  css,
  /@media \(min-width: 700px\)[\s\S]*?\.mobile-tools-sheet\s*\{[\s\S]*?left:\s*auto;[\s\S]*?width:\s*min\(420px/,
  "Gli stessi fogli devono diventare dock laterali sui display larghi.",
);
assert.match(
  css,
  /@media \(min-width: 700px\)[\s\S]*?\.mobile-tools-sheet\.is-open\s*\{[\s\S]*?translate3d\(0, 0, 0\)/,
  "Il dock laterale deve avere uno stato aperto esplicito.",
);
assert.match(
  css,
  /@media \(min-width: 700px\)[\s\S]*?\.mobile-layers-panel\s*\{[\s\S]*?width:\s*min\(280px/,
  "Anche i livelli condivisi devono adattarsi al layout largo.",
);
assert.match(
  html,
  /<nav class="mobile-header" aria-label="Navigazione editor">/,
  "La navigazione condivisa non deve dichiararsi esclusiva del mobile.",
);
assert.match(
  main,
  /setControlsPanelOpen\(!mobileUiMediaQuery\.matches\)/,
  "Il vecchio pannello tecnico deve restare nascosto quando la UI unica e' attiva.",
);
assert.match(
  main,
  /if \(mobileBrushStudio && mobileUiMediaQuery\.matches\) \{[\s\S]*?restoreActiveMobileBrushLibraryBrush/,
  "Telefono e desktop devono ripristinare la stessa libreria pennelli.",
);
assert.match(
  limits,
  /return MOBILE_DEVICE_CLASS \? 2048 : 4096;/,
  "L'unificazione della UI non deve cambiare il documento 2K telefono / 4K desktop.",
);

console.log("ui-parity:verify ok");
