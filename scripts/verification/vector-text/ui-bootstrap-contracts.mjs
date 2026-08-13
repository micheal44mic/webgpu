import assert from "node:assert/strict";
import fs from "node:fs";
import { VECTOR_TEXT_FONT_MANIFEST } from "../../../src/vector-text-font-geometry.ts";
import { readRepositorySource } from "../source-contract.mjs";

const mainSource = readRepositorySource("src/main.ts");
const htmlSource = readRepositorySource("index.html");
const packageJson = JSON.parse(readRepositorySource("package.json"));

// UI e font locali.
assert.equal(VECTOR_TEXT_FONT_MANIFEST.length, 3);
const fontLogicalBytes = VECTOR_TEXT_FONT_MANIFEST.reduce(
  (total, entry) => total + fs.statSync(entry.fileUrl).size,
  0,
);
assert.equal(fontLogicalBytes, 392_528);
for (const id of [
  "vectorSvgFileInput",
  "vectorSvgImportStatus",
  "rasterImageFileInput",
  "rasterImageImportStatus",
  "mobileSvgStyleRasterize",
  "mobileTextRasterize",
  "vectorTextRasterStatus",
  "mobileTextValue",
  "mobileTextFontFamily",
  "mobileTextFontSize",
  "mobileTextColor",
  "mobileTextWarpNone",
  "mobileTextWarpDistort",
  "mobileTextWarpArch",
  "mobileTextWarpCircle",
  "mobileTextWarpWave",
  "mobileTextOutlineWidth",
  "mobileTextOutlineColor",
  "mobileTextOutlineJoin",
  "mobileTextBlockShadowEnabled",
  "mobileTextDropShadowEnabled",
  "mobileTextInnerShadowEnabled",
  "vectorTextStatus",
  "vectorTextPresentationCanvas",
  "vectorTextInteractionCanvas",
]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `elemento #${id} mancante`);
}
assert.doesNotMatch(htmlSource, /id="vectorTextSingleShadowOutlineWidth"/);
assert.doesNotMatch(htmlSource, /id="vectorTextPrototypeSection"/);
assert.doesNotMatch(mainSource, /vectorTextEditorEnabled/);
assert.match(
  mainSource,
  /mixedSceneEnabled:\s*resolveMixedSceneEnabled\(editorExtensionEngineOptions, true\)/,
);
assert.match(mainSource, /if \(engine\.mixedSceneEnabled\)[\s\S]*?"deferred-mixed-scene"/);
assert.doesNotMatch(mainSource, /pageSearchParams\.get\("vectorTextTest"\)/);
assert.doesNotMatch(mainSource, /innerShadowTest/);
assert.doesNotMatch(htmlSource, /id="vectorTextZoomMode"/);
assert.match(mainSource, /__mixedSceneController = mixedSceneController/);
assert.doesNotMatch(mainSource, /vectorTextPrototype|MixedVectorText/);
assert.equal(packageJson.scripts["vector-text:verify"], "node scripts/verify-vector-text.mjs");
