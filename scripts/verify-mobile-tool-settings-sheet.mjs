import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const editorTools = readFileSync(
  new URL("src/editor-tools-controller.ts", root),
  "utf8",
);
const controller = readFileSync(
  new URL("src/mobile-tool-settings-sheet.ts", root),
  "utf8",
);
const mixedController = readFileSync(
  new URL("src/mixed-scene-controller.ts", root),
  "utf8",
);
const mixedControllerContract = readFileSync(
  new URL("src/mixed-scene-controller-contract.ts", root),
  "utf8",
);
const canvasToolSettingsController = readFileSync(
  new URL("src/canvas-tool-settings-controller.ts", root),
  "utf8",
);
const canvasToolController = readFileSync(
  new URL("src/canvas-tool-controller.ts", root),
  "utf8",
);
const fillRuntime = readFileSync(
  new URL("src/engine-fill-runtime.ts", root),
  "utf8",
);
const {
  MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_VELOCITY_PX_PER_MS,
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
} = await import(new URL("src/mobile-bottom-sheet-gesture.ts", root));
const {
  mergeVectorEffectEditorPatches,
  mobileToolSettingsPeekHeight,
} = await import(
  new URL("src/mobile-tool-settings-sheet.ts", root)
);

assert.equal(mobileToolSettingsPeekHeight(300), 160);
assert.equal(mobileToolSettingsPeekHeight(800), 208);
assert.equal(mobileToolSettingsPeekHeight(2_000), 240);

const firstVectorEffectPatch = mergeVectorEffectEditorPatches(null, {
  outlineWidth: 3,
  singleShadowBlur: 4,
});
assert.deepEqual(firstVectorEffectPatch, {
  outlineWidth: 3,
  singleShadowBlur: 4,
});
assert.deepEqual(
  mergeVectorEffectEditorPatches(firstVectorEffectPatch, {
    outlineWidth: 9,
    innerShadowOpacity: 0.75,
  }),
  {
    outlineWidth: 9,
    singleShadowBlur: 4,
    innerShadowOpacity: 0.75,
  },
  "a coalesced vector-effect frame must retain distinct controls and keep the latest repeated value",
);

const baseDrag = {
  releaseVelocityY: 0,
  peekOffsetPx: 500,
  minimizedOffsetPx: 700,
};
assert.equal(resolveMobileBottomSheetDrag({
  ...baseDrag,
  startSnap: "peek",
  deltaY: 36,
  offsetPx: 536,
}), "minimized", "a gentle downward drag must preserve the title-only detent");
assert.equal(resolveMobileBottomSheetDrag({
  ...baseDrag,
  startSnap: "minimized",
  deltaY: -36,
  offsetPx: 664,
}), "peek", "an upward drag must restore the compact panel");
assert.equal(resolveMobileBottomSheetDrag({
  ...baseDrag,
  startSnap: "minimized",
  deltaY: 36,
  offsetPx: 736,
}), "closed", "a second downward drag from minimized must close the panel");
assert.equal(resolveMobileBottomSheetDrag({
  ...baseDrag,
  startSnap: "expanded",
  deltaY: 500,
  offsetPx: 700,
}), "minimized", "a slow full-height drag must stop at the title-only detent");
assert.equal(resolveMobileBottomSheetDrag({
  ...baseDrag,
  startSnap: "expanded",
  deltaY: 28,
  releaseVelocityY: MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_VELOCITY_PX_PER_MS,
  offsetPx: 28,
}), "closed", "a deliberate fast flick may close directly");
assert.equal(nextMobileBottomSheetTapSnap("minimized"), "peek");
assert.equal(nextMobileBottomSheetTapSnap("peek"), "expanded");
assert.equal(nextMobileBottomSheetTapSnap("expanded"), "peek");
assert.match(
  controller,
  /const initialSnap:[\s\S]*?kind === "warp" \|\| kind === "perspective"[\s\S]*?\? "minimized"[\s\S]*?this\.snapTo\(initialSnap\)/,
  "Warp and Perspective must start compact so their canvas handles remain reachable",
);

const sheetStart = html.indexOf('id="mobileToolSettingsSheet"');
const sheetEnd = html.indexOf('id="mobileRasterEffectSheet"', sheetStart);
assert.ok(sheetStart >= 0 && sheetEnd > sheetStart, "the shared mobile tool sheet must exist");
const sheet = html.slice(sheetStart, sheetEnd);

for (const id of [
  "mobileToolSettingsSheet",
  "mobileToolSettingsHandle",
  "mobileToolSettingsHeader",
  "mobileToolSettingsTitle",
  "mobileToolSettingsScroll",
  "mobileFillColor",
  "mobileFillTolerance",
  "mobileSelectionMethod",
  "mobileSelectionReplace",
  "mobileSelectionAdd",
  "mobileSelectionSubtract",
  "mobileSelectionTolerance",
  "mobileSelectionColor",
  "mobileSelectionInvert",
  "mobileSelectionClear",
  "mobileTransformCancel",
  "mobileTransformApply",
  "mobileLayerOpacity",
  "mobileLayerBlendMode",
  "mobileRasterLayerOptions",
  "mobileLayerContentOpacity",
  "mobileLayerCutoutMode",
  "mobileLayerTonalCurrent",
  "mobileLayerTonalCurrentOut",
  "mobileLayerTonalUnderlying",
  "mobileLayerTonalUnderlyingOut",
  "mobileSvgStylePalette",
  "mobileSvgStyleRasterize",
  "mobileSvgStyleStatus",
  "mobileTextValue",
  "mobileTextFontFamily",
  "mobileTextFontSize",
  "mobileTextColor",
  "mobileTextAdd",
  "mobileTextReset",
  "mobileTextDelete",
  "mobileTextRasterize",
  "mobileTextWarpNone",
  "mobileTextWarpDistort",
  "mobileTextWarpArch",
  "mobileTextWarpCircle",
  "mobileTextWarpWave",
  "mobileTextDistortReset",
  "mobileTextDistortEdit",
  "mobileTextDistortCommitActions",
  "mobileTextDistortCancel",
  "mobileTextDistortApply",
  "mobileTextWarpCurve",
  "mobileTextCircleRadius",
  "mobileTextCircleInverted",
  "mobileTextOutlineWidth",
  "mobileTextOutlineColor",
  "mobileTextOutlineJoin",
  "mobileTextDropShadowEnabled",
  "mobileTextDropShadowColor",
  "mobileTextDropShadowOpacity",
  "mobileTextDropShadowOffset",
  "mobileTextDropShadowAngle",
  "mobileTextDropShadowBlur",
  "mobileTextInnerShadowEnabled",
  "mobileTextInnerShadowColor",
  "mobileTextInnerShadowOpacity",
  "mobileTextInnerShadowOffset",
  "mobileTextInnerShadowAngle",
  "mobileTextInnerShadowBlur",
  "mobileTextBlockShadowEnabled",
  "mobileTextBlockShadowColor",
  "mobileTextBlockShadowOpacity",
  "mobileTextBlockShadowOffset",
  "mobileTextBlockShadowAngle",
  "mobileTextBlockShadowOutlineWidth",
]) {
  assert.match(sheet, new RegExp(`id="${id}"`), `missing #${id}`);
}

assert.deepEqual(
  [...html.matchAll(/data-mobile-tool-sheet="([^"]+)"/g)]
    .map((match) => match[1]),
  [
    "fill",
    "selection",
    "transform",
    "warp",
    "perspective",
    "text",
    "svg-style",
    "text-warp",
    "text-outline",
    "text-drop-shadow",
    "text-inner-shadow",
    "text-block-shadow",
  ],
  "each canvas and text settings card must route to the shared sheet exactly once",
);
for (const title of [
  "Fill",
  "Selection",
  "Transform",
  "Perspective",
  "Text",
  "SVG Style",
  "Warp",
  "Outline",
  "Drop Shadow",
  "Inner Shadow",
  "Block Shadow",
]) {
  assert.match(html, new RegExp(`aria-label="Open ${title} settings"`));
}
const insertCategoryStart = html.indexOf(
  '<h2 class="mobile-tools-category-title">Insert</h2>',
);
const vectorsCategoryStart = html.indexOf(
  '<h2 class="mobile-tools-category-title">Vectors</h2>',
);
const effectsCategoryStart = html.indexOf(
  '<h2 class="mobile-tools-category-title">Effects</h2>',
);
assert.ok(
  insertCategoryStart >= 0
  && vectorsCategoryStart > insertCategoryStart
  && effectsCategoryStart > vectorsCategoryStart,
  "Vectors must be its own category between Insert and raster Effects",
);
assert.doesNotMatch(
  html.slice(insertCategoryStart, vectorsCategoryStart),
  /data-mobile-tool-sheet="text"/,
  "Text must no longer be duplicated inside Insert",
);
assert.doesNotMatch(
  html,
  /data-mobile-proxy-button/,
  "opening Text must not create a default text node immediately",
);
assert.match(html, /data-mobile-vector-command="import-svg"/);
assert.match(html, /data-mobile-vector-command="import-image"/);

assert.match(
  editorTools,
  /for \(const button of elements\.toolSettingsButtons\)[\s\S]*?openToolSettings\(kind, button\)/,
  "tool cards must open the shared editor and preserve their opener for focus restoration",
);
assert.match(
  main,
  /new EditorToolsController\(\{[\s\S]*?openToolSettings: \(kind, trigger\)[\s\S]*?const openRequestedSettings[\s\S]*?mobileToolSettingsSheet\?\.open\(requestedKind, trigger\)/,
  "the composition root must route typed tool cards to the shared settings sheet",
);
assert.match(
  main,
  /toolSettingsRequireMixedScene\(requestedKind\)[\s\S]*?const scope:[\s\S]*?requestedKind === "text"[\s\S]*?"controller-only"[\s\S]*?initializeMixedSceneController\(scope\)/,
  "vector settings must initialize only their requested capability after the user opens them",
);
assert.match(
  main,
  /mobileToolSettingsSheet = new MobileToolSettingsSheetController\(\{[\s\S]*?selectCanvasTool: selectCanvasToolWithMixedScene/,
  "Fill and Selection must use the authoritative route, while Transform initializes its deferred editor on demand",
);
for (const action of [
  "getFillSettings",
  "setFillColor",
  "setFillTolerance",
  "getSelectionSettings",
  "setSelectionMethod",
  "setSelectionTolerance",
  "setSelectionColor",
  "previewSelectionColor",
  "finishSelectionColorPreview",
  "setSelectionCombineMode",
  "invertSelection",
  "clearSelection",
  "applyTransform",
  "cancelTransform",
  "getSelectedLayerOptions",
  "beginSelectedLayerOptionsEdit",
  "finishSelectedLayerOptionsEdit",
  "setSelectedLayerOpacity",
  "setSelectedLayerBlendMode",
  "setSelectedLayerContentOpacity",
  "setSelectedLayerCutoutMode",
  "setSelectedLayerTonalBlend",
  "getSelectedSvgStyle",
  "setSelectedSvgPaintColor",
  "beginSvgPaintEdit",
  "commitSvgPaintEdit",
  "rasterizeSelectedSvg",
  "getTextCreationColor",
  "getTextEditorSnapshot",
  "getVectorEffectEditorSnapshot",
  "getTransformActionSnapshot",
  "updateSelectedTextProperties",
  "updateSelectedVectorEffectProperties",
  "setSelectedVectorShadowEnabled",
  "beginSelectedVectorPropertyEdit",
  "commitSelectedVectorPropertyEdit",
  "createText",
  "resetText",
  "deleteText",
  "rasterizeText",
  "setTextWarpMode",
  "resetTextDistort",
  "toggleTextDistortEditing",
  "hasSelectedVectorEffectTarget",
  "onClose",
]) {
  assert.match(
    controller,
    new RegExp(`readonly ${action}:`),
    `mobile action ${action} must use an explicit controller callback`,
  );
}
assert.doesNotMatch(
  controller,
  /sourceControl<HTMLButtonElement>\([^)]*\)\.click\(\)/,
  "mobile action buttons must not simulate clicks on hidden desktop controls",
);
assert.match(canvasToolSettingsController, /class CanvasToolSettingsController/);
assert.match(main, /const canvasToolSettingsController = new CanvasToolSettingsController\(\)/);
assert.match(
  controller,
  /private syncFill\(\): void \{[\s\S]*?this\.options\.getFillSettings\(\)/,
  "Fill must read its explicit state port",
);
assert.match(
  controller,
  /private syncFill\(\): void \{[\s\S]*?this\.fillColor\.value = colorInputValue\(snapshot\.color\)/,
  "Fill must expose the authoritative current color in its own sheet",
);
assert.match(
  main,
  /setFillColor: \(color\) => \{[\s\S]*?canonicalBrushColorForFormat\(color, current\.shapeMaskFormat\)[\s\S]*?brushQuickControlsController\?\.syncSettings/,
  "the Fill color picker must update the shared authoritative paint color",
);
assert.match(
  main,
  /getFillSettings: \(\) => \{[\s\S]*?engine\.getFillPreviewState\(\)[\s\S]*?historyState\.openEdit === "fill"[\s\S]*?locked: previewState\.terminal \|\| \(interactionLocked\(\) && !adjustingPreview\)/,
  "only a live non-terminal Fill preview may keep its own controls enabled through the document lock",
);
assert.match(
  main,
  /setFillTolerance: \(tolerance\) => \{[\s\S]*?const fill = canvasToolSettingsController\.setFillTolerance\(tolerance\)[\s\S]*?engine\.updateFillPreview\(fill\.tolerance\)/,
  "Fill tolerance input must update the engine preview live",
);
const setFillColorSource = main.slice(
  main.indexOf("  setFillColor: (color) => {"),
  main.indexOf("  getSelectionSettings:", main.indexOf("  setFillColor: (color) => {")),
);
assert(!setFillColorSource.includes("engine.updateFillPreview("));
assert(setFillColorSource.includes("canonicalBrushColorForFormat(color, current.shapeMaskFormat)"));
assert.match(
  controller,
  /for \(const eventType of \["input", "change"\] as const\)[\s\S]*?setFillTolerance[\s\S]*?setFillColor/,
  "native range and color controls must both publish continuous and final Fill values",
);
assert.match(
  main,
  /onClose: \(kind\) => \{[\s\S]*?finishFillToolOnSheetClose\(kind\)/,
  "every normal, swipe, or Escape Fill close must finalize through one shared callback",
);
assert.match(
  canvasToolController,
  /finishFillToolOnSheetClose\(kind: MobileToolSettingsKind\): void[\s\S]*?configurationInProgress[\s\S]*?fillClosePanRequested[\s\S]*?this\.configure\("pan", false\)/,
  "Fill close must bypass the public interaction lock and select Hand without recursive configuration",
);
assert.match(
  fillRuntime,
  /const batches = \[\.\.\.session\.stagedBatches, batch\];[\s\S]*?commitHistoryActionAtomically\([\s\S]*?batches,/,
  "all Fill clicks in one panel session must publish as one ordered History action",
);
assert.match(
  fillRuntime,
  /releasePayloadOnCancel: \(\) => \{[\s\S]*?batches\.map\(\(item\) => item\.gpuSlice\)[\s\S]*?prepareReleaseMany\(slices\)\.commitNoThrow\(\)[\s\S]*?session\.stagedBatches\.length = 0;/,
  "a canceled History publication must release every staged Fill payload",
);
assert.match(
  fillRuntime,
  /rollbackFillSessionPixels[\s\S]*?session\.stagedFillCount === 0[\s\S]*?restoreOriginalFillPixels[\s\S]*?rebuildActiveLayerFromHistory/,
  "rollback must replay the panel-opening History state even after canceled publication emptied staged slices",
);
const updateFillPreviewSource = fillRuntime.slice(
  fillRuntime.indexOf("export function updateFillPreview("),
  fillRuntime.indexOf("export async function setFillToolSelected("),
);
assert(updateFillPreviewSource.includes("const pendingClick = session.pendingClicks.at(-1)"));
assert(updateFillPreviewSource.includes("pendingClick.tolerancePercent = normalizedTolerance"));
assert(updateFillPreviewSource.includes("session.tolerancePercent = normalizedTolerance"));
assert(!updateFillPreviewSource.includes("linearColor ="));
assert(!updateFillPreviewSource.includes("session.color ="));
assert.match(
  fillRuntime,
  /session\.pendingClicks\[0\] !== click[\s\S]*?session\.pendingClicks\.shift\(\);/,
  "queued Fill clicks must be installed in strict FIFO order",
);
assert.match(
  fillRuntime,
  /async function finalizeFillPreview[\s\S]*?await session\.tapDrainPromise;[\s\S]*?await flushFillPreview\(engine, session\);[\s\S]*?renderer\.encodeFinalMaskCapture/,
  "closing Fill must drain every queued click before capturing the final mask",
);
assert.match(
  fillRuntime,
  /session\.baseLayerHasContent = engine\.layerHasContent;[\s\S]*?session\.baseStorageTileMask = record\.storageTileMask\.slice\(\);[\s\S]*?session\.analysis = null;[\s\S]*?session\.presentedBounds = null;/,
  "rollover must advance authoritative metadata before resetting the latest preview state",
);
assert.match(
  controller,
  /private syncSelection\(\): void \{[\s\S]*?this\.options\.getSelectionSettings\(\)/,
  "Selection must read its explicit state port",
);
assert.doesNotMatch(
  controller,
  /sourceControl<[^>]+>\("(?:fillColor|fillTolerance|selectionMethod|selectionTolerance|selectionColor|selectionReplace|selectionAdd|selectionSubtract|selectionInvert|selectionClear)"\)/,
  "Fill and Selection must not read legacy controls",
);
assert.match(
  canvasToolController,
  /private startTextDistortEditing\(\): boolean \{[\s\S]*?startSelectedTextDistortEditing\(\)[\s\S]*?this\.select\("transform", true\)/,
  "choosing Distort must immediately enter the authoritative Transform canvas",
);
assert.match(
  canvasToolController,
  /setTextWarpMode\(mode: MobileTextWarpMode\): boolean \{[\s\S]*?mode === "distort"\) return this\.startTextDistortEditing\(\)/,
  "the Distort mode button must start editing without a second Edit click",
);
assert.match(
  controller,
  /const editing = this\.options\.toggleTextDistortEditing\(\);[\s\S]*?this\.snapTo\(editing \? "minimized" : "peek"\);/,
  "Distort Edit must expose the canvas by minimizing the sheet and restore it on Done",
);
assert.match(
  mixedController,
  /toggleSelectedTextDistortEditing\(\): boolean \{[\s\S]*?return this\.isSelectedTextDistortEditing\(\);/,
  "mobile Distort must call the text controller directly",
);
assert.match(
  mixedController,
  /startSelectedTextDistortEditing\(\): boolean \{[\s\S]*?this\.activateTransform\("distort"\)[\s\S]*?this\.distortEditingNodeId = node\.id/,
  "Distort activation and edit mode must be idempotent and preserve the selected node",
);
assert.match(
  editorTools,
  /if \(!isEditorVectorCommand\(command\) \|\| button\.disabled\) return;[\s\S]*?this\.options\.runVectorCommand\(command\);/,
  "mobile file buttons must delegate one typed command through the tools controller",
);
assert.match(
  main,
  /runVectorCommand: \(command\) => \{[\s\S]*?sceneImportBridge\.request\(command\);/,
  "mobile file buttons must preserve native picker activation through the import bridge",
);

assert.doesNotMatch(
  controller,
  /sourceControl|dispatchMirrored|dispatchEvent\(new Event|MutationObserver/,
  "the shared sheet must not use hidden DOM or synthetic events as a state bus",
);
assert.match(
  controller,
  /private bindVectorHistoryControl\(control: HTMLElement\)[\s\S]*?pointerup[\s\S]*?pointercancel[\s\S]*?keyup[\s\S]*?blur/,
  "visible vector controls must preserve one begin/update/commit lifecycle per gesture",
);
assert.match(
  controller,
  /commitOpenHistoryEdits\(\): void \{[\s\S]*?finishSvgPaintEdit\(\)[\s\S]*?finishVectorPropertyEdit\(\)/,
  "closing or suspending the sheet must commit every open property edit",
);
assert.match(
  controller,
  /control\.addEventListener\("input", \(\) => \{\s*this\.stageVectorEffectProperties\(patch\(\)\);/,
  "vector effect range and color controls must stage their live values",
);
assert.match(
  controller,
  /private stageVectorEffectProperties\([\s\S]*?mergeVectorEffectEditorPatches\([\s\S]*?if \(this\.vectorEffectUpdateFrame !== null\) return;[\s\S]*?requestAnimationFrame\([\s\S]*?flushVectorEffectUpdates\(\)/,
  "a burst of vector effect inputs must merge into at most one update per animation frame",
);
assert.match(
  controller,
  /private flushVectorEffectUpdates\(\): void \{[\s\S]*?cancelAnimationFrame\(this\.vectorEffectUpdateFrame\)[\s\S]*?this\.pendingVectorEffectPatch = null;[\s\S]*?updateSelectedVectorEffectProperties\(patch\);[\s\S]*?this\.syncOpenState\(\);/,
  "one coalesced vector effect patch must drive one engine update and one panel sync",
);
assert.match(
  controller,
  /private finishVectorPropertyEdit\(\): void \{\s*this\.flushVectorEffectUpdates\(\);[\s\S]*?commitSelectedVectorPropertyEdit\(\)/,
  "history commit, close, blur and page suspension must flush the final staged vector effect value first",
);
assert.match(
  controller,
  /setSelectedVectorShadowEnabled\(kind, mobile\.checked\);[\s\S]*?requestAnimationFrame\(\(\) => this\.syncOpenState\(\)\)/,
  "vector effect toggles must remain immediate",
);
assert.match(
  mixedController,
  /getTextEditorSnapshot\(\)[\s\S]*?getVectorEffectEditorSnapshot\(\)[\s\S]*?getTransformActionSnapshot\(\)/,
  "vector UI state must cross a typed controller port",
);
assert.match(
  mixedController,
  /beginSelectedVectorPropertyEdit\(\)[\s\S]*?beginVectorHistoryEdit\("property"\)[\s\S]*?commitSelectedVectorPropertyEdit\(\)/,
  "the direct vector port must retain the engine history transaction",
);
assert.match(
  controller,
  /TEXT_SELECTION_REQUIRED_KINDS[\s\S]*?this\.options\.hasSelectedText\(\)/,
  "Warp must remain text-only",
);
assert.match(
  controller,
  /VECTOR_EFFECT_SELECTION_REQUIRED_KINDS[\s\S]*?this\.options\.hasSelectedVectorEffectTarget\(\)/,
  "Outline and the three shadows must accept selected text or SVG nodes",
);
assert.match(
  main,
  /selectedEffectNode = selectedText \?\? selectedSvg[\s\S]*?selectedEffectNode\?\.outlineWidth[\s\S]*?singleShadowEnabled[\s\S]*?innerShadowEnabled[\s\S]*?blockShadowEnabled/,
  "vector effect cards must derive their state from the selected authoritative text or SVG node",
);
assert.match(
  main,
  /hasSelectedText:\s*\(\) => selectedMobileTextNode\(\) !== null[\s\S]*?hasSelectedVectorEffectTarget:\s*\(\) => selectedMobileVectorItem\(\) !== null/,
  "the shared sheet must use distinct text-only and vector-effect selection gates",
);
assert.match(
  canvasToolController,
  /finishTransformToolOnSheetClose[\s\S]*?getTransformActionSnapshot\(\)\.active[\s\S]*?await controller\.applyTransform\(\)[\s\S]*?stopSelectedTextDistortEditing\(\)[\s\S]*?activeIsTransform[\s\S]*?const targetTool = activeIsTransform \? "paint"[\s\S]*?this\.select\(targetTool, true\)/,
  "closing Transform or Distort must commit safely, remove edit handles and return to Paint",
);
assert.match(
  controller,
  /MOBILE_LAYER_OPTIONS_MAX_VISIBLE_PX[\s\S]*?activeKind === "layer-options"/,
  "layer opacity and blend mode must open together in a content-sized compact detent",
);
assert.match(
  controller,
  /const MOBILE_LAYER_OPTIONS_MAX_VISIBLE_PX = 360;/,
  "Layer Options must keep Fill above the lower safe-area lane on short phones",
);
const layerOptionsStart = sheet.indexOf('data-mobile-tool-settings-panel="layer-options"');
const layerOptionsEnd = sheet.indexOf(
  'data-mobile-tool-settings-panel="svg-style"',
  layerOptionsStart,
);
const layerOptions = sheet.slice(layerOptionsStart, layerOptionsEnd);
assert.match(layerOptions, />Fill</);
assert.match(layerOptions, />Knockout</);
assert.match(layerOptions, />Blend If</);
assert.match(layerOptions, />Current Layer</);
assert.match(layerOptions, />Underlying Layer</);
assert.match(
  layerOptions,
  /<option value="off">None<\/option>[\s\S]*?<option value="group">Shallow<\/option>[\s\S]*?<option value="document">Deep<\/option>/,
  "the three knockout scopes must remain explicit in the raster layer panel",
);
for (const prefix of ["Current", "Underlying"]) {
  for (let index = 0; index < 4; index += 1) {
    assert.match(
      layerOptions,
      new RegExp(
        `id="mobileLayerTonal${prefix}${index}"[^>]*type="range"[^>]*min="0"[^>]*max="255"[^>]*step="1"`,
      ),
      `${prefix} tonal stop ${index} must be a native 8-bit range control`,
    );
  }
}
assert.match(
  controller,
  /private syncLayerTonalRange\([\s\S]*?input\.min = String\(minimums\[index\]\)[\s\S]*?input\.max = String\(maximums\[index\]\)/,
  "tonal range controls must expose ordered dynamic bounds",
);
assert.match(
  controller,
  /private updateLayerTonalBlendDraft\([\s\S]*?this\.runLayerOptionAction\(\(\) => this\.options\.setSelectedLayerTonalBlend/,
  "tonal range drags must publish their latest ordered draft during every input",
);
assert.match(
  controller,
  /\["current", this\.layerTonalCurrent\][\s\S]*?\["underlying", this\.layerTonalUnderlying\][\s\S]*?elements\.inputs\.forEach\(\(input, index\)[\s\S]*?input\.addEventListener\("input"[\s\S]*?updateLayerTonalBlendDraft\(kind, index/,
  "all eight Blend If stops must share the live input path",
);
assert.match(
  controller,
  /this\.bindLayerRange\(\s*this\.layerOpacity,[\s\S]*?"opacity"[\s\S]*?this\.bindLayerRange\(\s*this\.layerContentOpacity,[\s\S]*?"content-opacity"/,
  "Opacity and Fill must share the touch-safe live range path",
);
assert.match(
  controller,
  /private bindLayerRange\([\s\S]*?addEventListener\("input", publish\)[\s\S]*?addEventListener\("pointerdown", beginGesture\)[\s\S]*?addEventListener\("pointerup", finishGesture\)[\s\S]*?addEventListener\("pointercancel", finishGesture\)[\s\S]*?addEventListener\("change", finishGesture\)/,
  "touch, cancel and final native range events must share one flush lifecycle",
);
assert.match(
  controller,
  /pendingLayerRangeUpdates\.set\(field,[\s\S]*?requestLayerRangeUpdate\(\)[\s\S]*?requestAnimationFrame\([\s\S]*?flushLayerRangeUpdates\(\)/,
  "range bursts must keep only the latest value for each field and publish at most once per frame",
);
assert.match(
  controller,
  /closedKind === "layer-options"\) this\.flushLayerRangeUpdates\(\)[\s\S]*?finishSelectedLayerOptionsEdit\(\)/,
  "closing Layer Options must flush the final range value before committing its one History action",
);
assert.match(
  controller,
  /activeLayerRangeGestures\.has\(this\.layerOpacity\)[\s\S]*?this\.layerOpacity\.value[\s\S]*?activeLayerRangeGestures\.has\(this\.layerContentOpacity\)[\s\S]*?this\.layerContentOpacity\.value/,
  "async UI synchronization must not rewrite either native range while its pointer is active",
);
assert.match(
  main,
  /setSelectedLayerOpacity: \(key, opacity\) => \{[\s\S]*?setLayerOpacity\(key, opacity\);[\s\S]*?setSelectedLayerContentOpacity: \(key, contentOpacity\) => \{[\s\S]*?setRasterContentOpacity\(key, contentOpacity\);/,
  "raw range input must reuse the captured layer key instead of rebuilding a full stats snapshot",
);
assert.match(
  controller,
  /kind === "layer-options" && !this\.options\.beginSelectedLayerOptionsEdit\(\)/,
  "opening Layer Options must open its single history transaction",
);
assert.match(
  controller,
  /closedKind === "layer-options"[\s\S]*?finishSelectedLayerOptionsEdit\(\)/,
  "the Layer Options history transaction must commit only after the panel closes",
);
assert.match(
  controller,
  /this\.layerBlendMode\.addEventListener\("change"[\s\S]*?setSelectedLayerBlendMode[\s\S]*?this\.layerCutoutMode\.addEventListener\("change"[\s\S]*?setSelectedLayerCutoutMode/,
  "Blend Mode and Knockout selects must publish immediately on selection",
);
assert.match(
  controller,
  /private async openWhenReady\([\s\S]*?if \(this\.openState\) this\.closeCurrent\(false\);[\s\S]*?await pendingClose[\s\S]*?selectCanvasTool\(kind\)[\s\S]*?this\.activeKind = kind/,
  "a different panel must wait for the single Layer Options commit before selecting its tool",
);
assert.match(
  controller,
  /pagehide[\s\S]*?this\.activeKind === "layer-options"[\s\S]*?this\.close\(false\)/,
  "pagehide must close and commit Layer Options instead of leaving History locked",
);
assert.match(
  main,
  /settleTransientProjectEdits\(\)[\s\S]*?toolKind === "layer-options"[\s\S]*?mobileToolSettingsSheet\.close\(false\)[\s\S]*?await sceneEditorController\?\.finishLayerOptionsEdit\(\)/,
  "Save and Home must await the final live Layer Options value before capture or navigation",
);
assert.match(
  controller,
  /this\.rasterLayerOptions\.hidden = !rasterOptionsAvailable/,
  "Fill, Knockout and tonal blending must remain hidden for non-raster layers",
);
assert.doesNotMatch(
  main,
  /(?:blendMode|contentOpacity|cutoutMode|tonalBlend): documentPixelWritesRestricted \? null/,
  "validated RGBA8 documents must expose all raster Layer Options",
);
assert.doesNotMatch(
  main,
  /reportDocumentPixelWriterPaused\("(?:Layer blend modes|Layer fill opacity|Layer knockout|Tonal blend)"\)/,
  "validated Layer Options must not silently reject edits in RGBA8 documents",
);
assert.match(
  main,
  /openLayerOptions: \(trigger\) => \{[\s\S]*?engine\.ensureLayerBlendEditorResources\(\)[\s\S]*?mobileToolSettingsSheet\?\.open\("layer-options", trigger\)/,
  "opening Layer Options must prepare the compositor for every document profile",
);
assert.match(
  css,
  /\.mobile-layer-tonal-control input\[type="range"\][\s\S]*?height:\s*44px;[\s\S]*?touch-action:\s*none;/,
  "each tonal stop must retain a touch-sized native range target",
);
assert.match(
  css,
  /#gpuCanvas\.layer-options-active ~ \.gpu-memory-monitor\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/,
  "Layer Options must remove compact telemetry from the Fill touch lane",
);
assert.match(
  main,
  /onOpenChange: \(open\) => \{[\s\S]*?classList\.toggle\(\s*"layer-options-active"[\s\S]*?toolKind === "layer-options"/,
  "the composition root must expose the Layer Options overlap state on the canvas sibling",
);
assert.match(
  css,
  /#mobileLayerOpacity::-webkit-slider-thumb,[\s\S]*?#mobileLayerContentOpacity::-webkit-slider-thumb[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;/,
  "Opacity and Fill need deterministic touch thumbs on WebKit",
);
assert.match(
  controller,
  /startSvgPaintEdit\(index\)[\s\S]*?setSelectedSvgPaintColor\(index, input\.value\)[\s\S]*?finishSvgPaintEdit\(\)/,
  "SVG colors must update live while one picker gesture remains one history edit",
);
assert.match(
  main,
  /rasterizeSelectedSvg:\s*\(\) => mixedSceneController\?\.rasterizeSelectedSvgNode\(\)/,
  "mobile SVG rasterization must call the controller API directly",
);
assert.match(
  mixedController,
  /createText\(color\?: string\)[\s\S]*?defaultSeed\(textCount, color\)/,
  "new mobile text must pass its chosen color into the authoritative seed",
);
assert.match(
  mixedController,
  /blockShadowEnabled:\s*false/,
  "new text must start without Block Shadow",
);
assert.doesNotMatch(
  html,
  /id="vectorTextBlockShadowEnabled"[^>]*\schecked(?:\s|>)/,
  "the initial text UI must also start with Block Shadow disabled",
);
assert.doesNotMatch(
  css,
  /\.mobile-tools-item\[aria-pressed="true"\]\s*\{[^}]*#dd5c35/s,
  "the main Tools cards must not gain an orange active indicator",
);
assert.match(
  controller,
  /this\.scroll\.toggleAttribute\("inert", minimized\);[\s\S]*?this\.scroll\.setAttribute\("aria-hidden", String\(minimized\)\);/,
  "only grabber and title may remain exposed at the minimized detent",
);
assert.match(
  controller,
  /if \(activeElement instanceof HTMLElement && this\.sheet\.contains\(activeElement\)\)[\s\S]*?activeElement\.blur\(\);[\s\S]*?this\.sheet\.setAttribute\("aria-hidden", "true"\)/,
  "focus must leave the panel before its ancestor becomes aria-hidden",
);
assert.match(
  mixedControllerContract,
  /readonly onEditorStateChange\?: \(\) => void/,
  "the mixed-scene contract must expose explicit editor state changes",
);
assert.match(
  mixedController,
  /private updateTransformUi\(\): void[\s\S]*?this\.onEditorStateChange\?\.\(\)/,
  "Transform Apply and Cancel must publish explicit state changes",
);
assert.match(controller, /this\.options\.getTransformActionSnapshot\(\)/);
assert.doesNotMatch(controller, /MutationObserver/);
assert.doesNotMatch(controller, /setInterval\(/, "the tool sheet must not poll");
assert.match(controller, /readonly root: ParentNode;[\s\S]*?readonly browser: Window;[\s\S]*?readonly document: Document;/);
assert.match(controller, /root\.querySelector<HTMLElement>\(`/);
assert.doesNotMatch(controller, /document\.getElementById|\bwindow\./);
assert.match(
  main,
  /new MobileToolSettingsSheetController\(\{[\s\S]*?root: element<HTMLElement>\("mobileToolSettingsSheet"\),[\s\S]*?browser: window,[\s\S]*?document,/,
  "the composition root must provide the shared sheet DOM and browser dependencies",
);
assert.doesNotMatch(
  controller,
  /\bGPU(?:Device|Texture|Buffer|Queue|CommandEncoder|CanvasContext)\b|navigator\.gpu|createTexture\(|createBuffer\(|createCommandEncoder\(|queue\.submit\(/,
  "the settings sheet must not allocate GPU resources or create a second renderer",
);
assert.match(
  css,
  /\.mobile-tool-settings-scroll\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?touch-action:\s*pan-y;/,
  "controls must retain native scrolling inside the compact panel",
);
assert.match(
  css,
  /\.mobile-tool-settings-header\s*\{[\s\S]*?flex:\s*0 0 48px;/,
  "the regular minimized detent must reserve exactly one title row",
);
assert.match(
  css,
  /@media \(max-height: 700px\)[\s\S]*?\.mobile-tool-settings-header\s*\{[\s\S]*?flex-basis:\s*44px;/,
  "short iPhones must use the compact title row",
);
assert.match(
  css,
  /\.mobile-tool-actions button:active\s*\{[\s\S]*?height:\s*44px;[\s\S]*?max-height:\s*44px;[\s\S]*?-webkit-appearance:\s*none;/,
  "mobile action buttons must keep a fixed native-independent box while pressed",
);
assert.match(html, /id="mobileTransformCancel"[\s\S]*?id="mobileTransformApply"/);
assert.match(controller, /actionSnapshot\.preparing[\s\S]*?Preparing[\s\S]*?Perspective/);
assert.doesNotMatch(
  html,
  /transformCommitBar|transformCommitLabel|id="transformApply"|id="transformCancel"/,
  "the obsolete centered Transform toolbar must not exist in the DOM",
);
assert.doesNotMatch(css, /transform-commit-bar|#transformCommitBar/);
assert.doesNotMatch(mixedController, /transformCommitBar|transformCommitLabel|transformApplyButton|transformCancelButton/);
assert.match(
  controller,
  /async settleDocumentEdits\(\): Promise<void>[\s\S]*?this\.close\(false\)[\s\S]*?while \(this\.layerOptionsClosePromise\)[\s\S]*?await this\.layerOptionsClosePromise/,
  "document replacement must invalidate queued opens and await layer-option closure",
);
assert.match(
  css,
  /@media \(min-width: 700px\)[\s\S]*?\.mobile-tool-settings-sheet\[data-snap="minimized"\][\s\S]*?width:\s*64px;[\s\S]*?\.mobile-tool-settings-shell[\s\S]*?display:\s*none;/,
  "the desktop Perspective dock must collapse instead of covering the right-side corners",
);

console.log("Mobile tool settings: authoritative controls, shared detents and accessibility verified.");
