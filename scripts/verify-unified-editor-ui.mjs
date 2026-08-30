import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const css = read("../src/styles.css");
const main = read("../src/main.ts");
const limits = read("../src/engine-limits.ts");
const sharedControllers = [
  "../src/mobile-brush-studio.ts",
  "../src/mobile-gaussian-blur-sheet.ts",
  "../src/mobile-liquify-sheet.ts",
  "../src/mobile-motion-blur-sheet.ts",
  "../src/mobile-noise-sheet.ts",
  "../src/mobile-raster-effects-sheet.ts",
  "../src/mobile-stroke-sheet.ts",
  "../src/mobile-tool-settings-sheet.ts",
].map(read).join("\n");

assert.doesNotMatch(
  main + "\n" + sharedControllers,
  /mobileUiMediaQuery|mobileMediaQuery/,
  "La UI condivisa non deve conservare un media-query sempre vero o rami irraggiungibili.",
);
assert.doesNotMatch(
  css,
  /@media \(max-width: 699px\)/,
  "I controlli condivisi non devono tornare a essere esclusivi del telefono.",
);
assert.doesNotMatch(
  css,
  /@media \(min-width: 0px\)/,
  "Le regole condivise non devono essere nascoste in media query sempre vere.",
);
assert.match(
  css,
  /Superficie editor condivisa[\s\S]*?\.mobile-header\s*\{[\s\S]*?display:\s*flex/,
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
  /<nav class="mobile-header" aria-label="Editor navigation">/,
  "La navigazione condivisa non deve dichiararsi esclusiva del mobile.",
);
assert.doesNotMatch(
  html + "\n" + css + "\n" + main,
  /controlsPanel|toggleControls|setControlsPanelOpen/,
  "Il vecchio pannello tecnico non deve sopravvivere, neppure come bus di stato nascosto.",
);
assert.match(
  main,
  /runStartupPhase\(\s*"restore-active-brush"[\s\S]*?if \(\s*mobileBrushStudio\s*&& \(editorExtensionBootstrap\?\.restorePersistedBrushOnStartup \?\? true\)\s*\) \{\s*await brushLibraryController\.restoreActiveBrush\(\{ prepareResources: false \}\);\s*\}[\s\S]*?runStartupPhase\(\s*"project-session"[\s\S]*?projectSessionController\.initialize\(\)/,
  "Telefono e desktop devono preparare lo stesso pennello attivo prima del progetto.",
);
assert.match(
  limits,
  /const width = validDocumentEdge\(queryOverride\("documentWidth", "BRUSH_DOCUMENT_WIDTH"\)\);[\s\S]*?const height = validDocumentEdge\(queryOverride\("documentHeight", "BRUSH_DOCUMENT_HEIGHT"\)\);[\s\S]*?if \(width !== null && height !== null\) return \[width, height\];/,
  "La UI condivisa deve inoltrare larghezza e altezza personalizzate come assi indipendenti.",
);
assert.match(
  limits,
  /const fallback = MOBILE_DEVICE_CLASS \? 2048 : LEGACY_DOCUMENT_EDGE;\s*return \[fallback, fallback\];/,
  "Senza dimensioni esplicite devono restare i profili quadrati 2K telefono / 4K legacy desktop.",
);
assert.match(
  limits,
  /export let DOCUMENT_WIDTH = DOCUMENT_DIMENSIONS\[0\];[\s\S]*?export let DOCUMENT_HEIGHT = DOCUMENT_DIMENSIONS\[1\];/,
  "Il contratto pubblico del documento deve esporre entrambi gli assi come binding riconfigurabili.",
);
assert.doesNotMatch(
  limits,
  /return MOBILE_DEVICE_CLASS \? 2048 : 4096;/,
  "Il resolver non deve tornare a un unico lato scalare.",
);

console.log("ui-parity:verify ok");
