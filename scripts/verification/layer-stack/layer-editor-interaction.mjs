import assert from "node:assert/strict";
import { readRepositorySource } from "../source-contract.mjs";
import { readEngineSource } from "../../engine-source.mjs";
import { assertBoundedSourceSection as assertSection } from "../source-contract.mjs";

const engineSource = readEngineSource();
const mainSource = readRepositorySource("src/main.ts");
const rasterStyleSource = readRepositorySource("src/raster-style-controller.ts");
const canvasInputSource = readRepositorySource("src/canvas-input-controller.ts");
const sceneEditorSource = readRepositorySource("src/scene-editor-controller.ts");
const humanLabSource = readRepositorySource("src/labs/human-stroke-lab.ts");
const indexSource = readRepositorySource("index.html");
const stylesSource = readRepositorySource("src/styles.css");
const mobileToolSettingsSource = readRepositorySource("src/mobile-tool-settings-sheet.ts");

const mobileToolRailCssStart = stylesSource.indexOf("  .mobile-tool-rail {");
const mobileToolRailCssEnd = stylesSource.indexOf("\n  }", mobileToolRailCssStart);
assertSection("CSS mobile tool rail", mobileToolRailCssStart, mobileToolRailCssEnd);
const mobileToolRailCss = stylesSource.slice(mobileToolRailCssStart, mobileToolRailCssEnd);
assert.match(
  mobileToolRailCss,
  /top: calc\(64px \+ env\(safe-area-inset-top\)\);[\s\S]*?bottom: max\(12px, env\(safe-area-inset-bottom\)\);[\s\S]*?margin-block: auto;/,
);
assert.doesNotMatch(
  mobileToolRailCss,
  /top: 50%;|transform: translateY\(-50%\);/,
);
assert.match(
  stylesSource,
  /\.mobile-layer-reference,[\s\S]*?\.mobile-layer-visibility \{[\s\S]*?align-self: center;[\s\S]*?justify-self: center;/,
);
const pointerMoveStart = canvasInputSource.indexOf("const handlePointerMove =");
const pointerMoveEnd = canvasInputSource.indexOf("const finishPointer =", pointerMoveStart);
assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
assert.doesNotMatch(
  canvasInputSource.slice(pointerMoveStart, pointerMoveEnd),
  /Thumbnail|thumbnail/,
  "il pointermove Paint non deve conoscere né aggiornare le miniature",
);
assert.match(
  humanLabSource,
  /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 64/,
  "il contratto persistito del benchmark deve conservare la revisione 64",
);
assert.match(engineSource, /layerBakeStrategy: typeof LAYER_BAKE_STRATEGY;/);
assert.match(engineSource, /layerCompositeStrategy: typeof LAYER_COMPOSITE_STRATEGY;/);
assert.match(sceneEditorSource, /private async setLayerVisibilityTransaction\(/);
assert.match(sceneEditorSource, /private async setLayerOpacityTransaction\(/);
assert.match(sceneEditorSource, /LAYER_BLEND_MODE_LABELS/);
assert.match(mobileToolSettingsSource, /LAYER_BLEND_MODE_CATEGORIES/);
assert.match(
  mobileToolSettingsSource,
  /for \(const category of LAYER_BLEND_MODE_CATEGORIES\)[\s\S]*?this\.layerBlendMode\.append\(group\)/,
  "la UI visibile deve costruire l'elenco completo dei metodi di fusione",
);
assert.match(sceneEditorSource, /private async setRasterBlendModeTransaction\(/);
assert.match(
  sceneEditorSource,
  /await this\.options\.engine\.setLayerBlendMode\([\s\S]*?target\.rasterIndex,[\s\S]*?blendMode/,
  "la scelta UI deve pubblicare subito il modo, senza un pulsante Applica",
);
assert.match(mainSource, /mobileLayerClippingButton/);
assert.match(sceneEditorSource, /private async setRasterClippingTransaction\(/);
assert.match(
  sceneEditorSource,
  /const changed = await this\.options\.engine\.setLayerClipping\(target\.rasterIndex, enabled\)/,
  "il controllo per riga deve agire anche su un raster esistente, non crearne uno nuovo",
);
assert.match(sceneEditorSource, /Altre M consecutive useranno la stessa base/);
assert.doesNotMatch(indexSource, /id="addClippingMask"/,
  "il vecchio comando globale Crea maschera non deve restare duplicato");
assert.doesNotMatch(
  indexSource,
  /id="layerList"|id="addLayer"/,
  "la lista livelli invisibile non deve restare come seconda UI autorevole",
);
assert.match(indexSource, /id="mobileLayerClipping"/);
assert.match(mainSource, /function syncActiveLayerControls\(\): void \{/);
const syncStart = mainSource.indexOf("function syncActiveLayerControls(");
const syncBody = mainSource.slice(syncStart, syncStart + 600);
assert.match(syncBody, /mobileStrokeSheet\?\.sync\(rasterStyleController\.getStrokeStyle\(\)\)/);
assert.match(syncBody, /mobileRasterEffectsSheet\?\.syncOpenStyle\(\)/);
assert.match(syncBody, /syncMobileToolsMenuState\(\)/);
assert.doesNotMatch(
  syncBody,
  /syncRaster(?:ColorOverlay|Stroke|OuterShadow|InnerShadow|Bevel)Controls/,
  "il cambio livello non deve più sincronizzare controlli effetto nascosti",
);
const selectStart = sceneEditorSource.indexOf("private async selectLayerTransaction(");
assert.notEqual(selectStart, -1, "selectLayer deve esistere");
assert.match(
  sceneEditorSource.slice(selectStart, selectStart + 5_500),
  /await this\.options\.engine\.setActiveLayer\(target\.rasterIndex\);\s*this\.options\.syncActiveRasterControls\(\);/,
  "il cambio livello deve risincronizzare i controlli degli effetti",
);
assert.match(
  sceneEditorSource,
  /const result = await this\.options\.engine\.addLayer\(\);\s*this\.options\.syncActiveRasterControls\(\);/,
  "anche la creazione di un livello deve risincronizzare i controlli",
);
assert.match(
  rasterStyleSource,
  /colorOverlayTargetIsSelected\(\): boolean \{[\s\S]*?getMixedSceneSnapshot\(\) === null[\s\S]*?canPaintSelectedSceneItem\(\);/,
  "Color Overlay deve essere modificabile solo quando è selezionato un raster",
);
assert.match(
  rasterStyleSource,
  /requiresSelectedTarget && !this\.colorOverlayTargetIsSelected\(\)/,
  "il commit UI non può ricadere sul raster di lavoro sotto un nodo vettoriale",
);
assert.match(
  indexSource,
  /id="layerLoadingOverlay"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?hidden/,
  "il cambio livello deve avere un indicatore fullscreen annunciato e inizialmente nascosto",
);
assert.match(stylesSource, /\.layer-loading-overlay \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
assert.match(stylesSource, /\.layer-loading-overlay\[hidden\] \{\s*display: none;/);
const loadingStyles = stylesSource.slice(
  stylesSource.indexOf(".layer-loading-overlay {"),
  stylesSource.indexOf(".layer-loading-overlay[hidden]"),
);
assert.match(loadingStyles, /background: rgba\(9, 11, 15, 0\.38\);/);
assert.doesNotMatch(loadingStyles, /backdrop-filter|filter:\s*blur\(/);
assert.doesNotMatch(
  loadingStyles,
  /background: #0d0f13;/,
  "il loader non deve più sembrare un ricaricamento opaco dell'intera app",
);
assert.match(
  stylesSource,
  /\.layer-loading-content \{[\s\S]*?background: rgba\(20, 23, 31, 0\.84\);/,
  "spinner e testo devono restare in una piccola scheda semitrasparente",
);
const loadingStart = sceneEditorSource.indexOf("private async showLoading(");
const loadingBody = sceneEditorSource.slice(loadingStart, loadingStart + 1_300);
assert.match(loadingBody, /loadingOverlay\.hidden = false;/);
assert.match(
  loadingBody,
  /await this\.nextAnimationFrame\(\);\s*if \(this\.disposed\) return false;\s*await this\.nextAnimationFrame\(\);/,
  "il loader deve ricevere un paint prima del lavoro di cambio livello",
);
assert.match(loadingBody, /loadingOverlay\.hidden = true;/);
const selectUiBody = sceneEditorSource.slice(selectStart, selectStart + 5_500);
assert.match(
  selectUiBody,
  /await this\.showLoading\("Caricamento livello…"\)[\s\S]*?await this\.options\.engine\.setActiveLayer\(target\.rasterIndex\);[\s\S]*?await this\.options\.engine\.waitForIdle\(\);/,
  "il loader dello switch deve coprire anche presentazione e completamento GPU",
);
assert.match(selectUiBody, /finally \{[\s\S]*?this\.finish\(\{ loading: true \}\);/);
const addUiStart = sceneEditorSource.indexOf("private async addRasterLayerTransaction(");
const addUiBody = sceneEditorSource.slice(addUiStart, addUiStart + 1_300);
assert.match(
  addUiBody,
  /await this\.showLoading\("Creazione livello…"\)[\s\S]*?await this\.options\.engine\.addLayer\(\);[\s\S]*?await this\.options\.engine\.waitForIdle\(\);/,
  "anche il nuovo livello deve restare coperto finché il frame è pronto",
);
assert.match(addUiBody, /finally \{[\s\S]*?this\.finish\(\{ loading: true \}\);/);

// The record's hasContent is only written back when a layer stops being active,
// so reading it for the ACTIVE layer would report "empty" while the user paints.
assert.match(
  engineSource,
  /hasContent: record\.id === engine\.layerStack\.active\.id\s*\?\s*engine\.layerHasContent\s*:\s*record\.hasContent/,
  "hasContent del livello attivo deve venire dal campo vivo, non dal record",
);
// The switch result must not claim to report a rebuilt pyramid level: the switch
// only invalidates the pyramid, and the next frame rebuilds it.
assert.doesNotMatch(engineSource, /rebuiltPyramidThroughLevel/);
