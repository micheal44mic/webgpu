import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(`${root}/index.html`, "utf8");
const main = readFileSync(`${root}/src/main.ts`, "utf8");
const studio = readFileSync(`${root}/src/mobile-brush-studio.ts`, "utf8");
const storage = readFileSync(`${root}/src/brush-studio-storage.ts`, "utf8");
const engine = readFileSync(`${root}/src/brush-engine.ts`, "utf8");

for (const id of [
  "mobileBrushStudioSheet",
  "mobileBrushStudioHandle",
  "mobileBrushStudioCancel",
  "mobileBrushStudioDone",
  "mobileBrushStudioPreviewCanvas",
  "mobileBrushStudioStrokeTab",
  "mobileBrushStudioShapeTab",
  "mobileBrushStudioGrainTab",
  "mobileBrushStudioDynamicsTab",
  "mobileBrushStudioShapeFile",
  "mobileBrushStudioGrainFile",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}

assert.equal(
  (html.match(/data-mobile-brush-studio-tab=/g) ?? []).length,
  4,
  "Brush Studio must keep exactly four footer categories",
);
assert.doesNotMatch(
  html.slice(html.indexOf('id="mobileBrushStudioSheet"'), html.indexOf('id="mobileToolsSheet"')),
  /Hardness/i,
  "Paint Hardness must not be exposed in Brush Studio",
);
assert.match(main, /brushId === activeMobileBrushLibraryBrushId[\s\S]*?studio\.open\(/);
assert.match(studio, /this\.cancelButton\.addEventListener\("click"/);
assert.match(studio, /this\.doneButton\.addEventListener\("click"/);
assert.match(studio, /requestAnimationFrame\(\(\) => \{[\s\S]*?this\.applyDraftNow\(\)/);
assert.match(studio, /this\.cancel\(true\)/, "drag-close must use Cancel semantics");
assert.match(studio, /saveBrushStudioSavedBrush/);
assert.match(storage, /window\.indexedDB\.open/);
assert.match(
  storage,
  /assetId \? `\$\{brushId\}:\$\{kind\}:\$\{assetId\}`/,
  "custom asset blobs must use immutable per-asset keys",
);
assert.match(storage, /m1m4\.brush-studio\.library-state\.v1/);
assert.match(storage, /export function loadBrushStudioLibraryState/);
assert.match(storage, /export function saveBrushStudioLibraryState/);
assert.match(
  main,
  /restoredMobileBrushLibraryBrushId[\s\S]*?activeMobileBrushLibraryBrushId[\s\S]*?restoredMobileBrushLibraryBrushId/,
  "the last active saved brush must remain selected after refresh",
);
assert.match(
  main,
  /onCommit: \(brushId,[\s\S]*?persistActiveMobileBrushLibraryBrush\(\)/,
  "Done must persist which visible library card owns the saved settings",
);
assert.match(
  main,
  /mobileBrushStudio\.resolveBrushSettings\([\s\S]*?activeMobileBrushLibraryBrushId/,
  "startup must restore the active brush instead of always forcing the legacy brush",
);
assert.match(
  main,
  /function mobileBrushLibrarySettingsForBrush[\s\S]*?previewIsActive[\s\S]*?settingsSnapshot\(brushId, fallbackSettings\)/,
  "the library preview must use the saved per-card settings",
);
assert.match(
  studio,
  /saveBrushStudioSavedBrush\([\s\S]*?deleteSupersededStoredAssets\(/,
  "old custom blobs may be deleted only after the new settings record commits",
);
assert.match(engine, /registerCustomShapeAsset\(/);
assert.match(engine, /registerCustomGrainAsset\(/);
assert.match(engine, /hardness: tool === "paint" \? 1/);

console.log("Brush Studio verification passed.");
