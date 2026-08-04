import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const controller = readFileSync(
  new URL("../src/mobile-stroke-sheet.ts", import.meta.url),
  "utf8",
);

const start = html.indexOf('id="mobileStrokeSheet"');
const end = html.indexOf('id="mobileToolsSheet"', start);
assert.ok(start >= 0 && end > start, "Il foglio mobile Stroke deve precedere il foglio Tools.");
const sheet = html.slice(start, end);

for (const id of [
  "mobileStrokeSheet",
  "mobileStrokeHandle",
  "mobileStrokeColor",
  "mobileStrokeColorInput",
  "mobileStrokeAlignmentButton",
  "mobileStrokeAlignmentMenu",
]) {
  assert.match(sheet, new RegExp(`id="${id}"`), `Manca #${id}.`);
}

assert.match(
  sheet,
  /class="mobile-tools-sheet mobile-stroke-sheet"[\s\S]*?aria-hidden="true"[\s\S]*?data-snap="peek"/,
  "Stroke deve riusare il foglio mobile e partire chiuso allo snap peek.",
);
assert.match(sheet, /id="mobileStrokeTitle"[^>]*>Stroke<\/h2>/, "Il titolo visibile deve essere inglese.");
assert.match(sheet, /id="mobileStrokeColorInput"[\s\S]*?type="color"[\s\S]*?aria-label="Stroke color"/);
assert.match(
  sheet,
  /id="mobileStrokeAlignmentButton"[\s\S]*?aria-haspopup="listbox"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="mobileStrokeAlignmentMenu"[\s\S]*?data-stroke-alignment="outside"/,
  "Il trigger del dropdown deve esporre stato e relazione ARIA.",
);
assert.match(
  sheet,
  /id="mobileStrokeAlignmentMenu"[\s\S]*?role="listbox"[\s\S]*?hidden/,
  "Il menu deve essere un listbox chiuso inizialmente.",
);

const optionMatches = [...sheet.matchAll(
  /role="option"[\s\S]*?aria-selected="(true|false)"[\s\S]*?data-stroke-alignment="(outside|inside|center)"[\s\S]*?<span>(Outside|Inside|Centered)<\/span>/g,
)];
assert.deepEqual(
  optionMatches.map((match) => [match[1], match[2], match[3]]),
  [
    ["true", "outside", "Outside"],
    ["false", "inside", "Inside"],
    ["false", "center", "Centered"],
  ],
  "Le tre posizioni devono essere inglesi, ordinate e mappate sui valori autorevoli.",
);

for (const icon of ["square-dashed", "chevron-down", "check"]) {
  assert.match(sheet, new RegExp(`data-lucide="${icon}"`), `Manca l'icona Lucide ${icon}.`);
}

assert.match(
  css,
  /\.mobile-stroke-sheet\s*\{[\s\S]*?--mobile-tools-sheet-offset:\s*calc\(100% - clamp\(160px, 26dvh, 240px\)\);[\s\S]*?overflow:\s*visible;/,
  "Lo snap massimo visibile deve coincidere col peek Tools e il dropdown deve poter uscire sopra il foglio.",
);
assert.match(css, /\.mobile-stroke-alignment-button[\s\S]*?height:\s*52px;/);
assert.match(css, /\.mobile-stroke-alignment-menu button[\s\S]*?min-height:\s*44px;/);
assert.match(css, /\.mobile-stroke-alignment-menu\[hidden\]\s*\{\s*display:\s*none;/);
assert.match(
  css,
  /\.mobile-stroke-alignment-button:focus-visible,[\s\S]*?outline:\s*1px solid #dd5c35;/,
  "Il focus da tastiera deve usare l'accento arancione del prodotto.",
);

assert.match(
  main,
  /mobileStrokeSheet\s*=\s*new MobileStrokeSheetController\(\{[\s\S]*?getStyle:\s*\(\)\s*=>\s*engine\.getRasterStrokeStyle\(\)[\s\S]*?applyStyle:\s*applyRasterStrokeStyle/,
  "Il foglio mobile deve leggere e scrivere lo stile Stroke autorevole del motore.",
);
assert.match(
  main,
  /if \(controlId === "rasterStrokeEnabled" && mobileStrokeSheet\) \{\s*mobileStrokeSheet\.open\(\);\s*return;/,
  "La card Stroke deve aprire il pannello senza disattivare l'effetto già attivo.",
);
assert.match(
  html,
  /data-mobile-effect-control="rasterStrokeEnabled"[\s\S]*?aria-label="Open Stroke settings"/,
  "La card non deve più essere annunciata come toggle: apre e attiva le impostazioni Stroke.",
);
assert.match(
  main,
  /beforeOpen:\s*\(\)\s*=>\s*\{[\s\S]*?setMobileToolsSheetOpen\(false\);[\s\S]*?setMobileLayersPanelOpen\(false\);[\s\S]*?setMobileBrushLibraryOpen\(false\);[\s\S]*?mobileBrushStudio\?\.cancel\(false\);/,
  "Stroke deve chiudere tutti i pannelli mobile incompatibili prima di aprirsi.",
);
assert.match(
  main,
  /async function applyRasterStrokeStyle\(style: RasterStrokeStyle\): Promise<boolean>[\s\S]*?engine\.setRasterStrokeStyle\(style\)/,
  "Il controller deve riusare l'unica API Stroke esistente, non duplicare il renderer.",
);
assert.match(
  controller,
  /if \(!current\.enabled\) \{\s*this\.requestStyle\(\{ \.\.\.copiedStyle\(current\), enabled: true \}, false\);/,
  "Aprire Stroke dalla card deve attivare l'effetto senza usarlo come toggle-off.",
);
assert.match(
  controller,
  /this\.applyFrame = requestAnimationFrame\([\s\S]*?this\.startApplyLoop\(\)/,
  "Il colore live deve essere coalescente al massimo una volta per frame.",
);
assert.match(
  controller,
  /while \(this\.pendingStyle\)[\s\S]*?await this\.options\.applyStyle\(style\)/,
  "Le mutazioni live devono essere serializzate latest-only durante una submission asincrona.",
);
assert.match(
  controller,
  /this\.setOffset\(this\.dragStartOffsetPx \+ Math\.max\(0, deltaY\)\)/,
  "Il foglio Stroke non deve poter essere trascinato sopra lo snap basso.",
);
assert.doesNotMatch(
  controller,
  /colorInput\.click\(\)/,
  "Il picker nativo deve essere aperto dal label reale, senza un secondo click sintetico.",
);
assert.doesNotMatch(controller, /setInterval\(/, "Il controller Stroke non deve introdurre polling.");

console.log("Mobile Stroke sheet: markup, runtime autorevole, snap e accessibilità verificati.");
