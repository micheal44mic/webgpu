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
const {
  MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_VELOCITY_PX_PER_MS,
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
} = await import(new URL("src/mobile-bottom-sheet-gesture.ts", root));
const { mobileToolSettingsPeekHeight } = await import(
  new URL("src/mobile-tool-settings-sheet.ts", root)
);

assert.equal(mobileToolSettingsPeekHeight(300), 160);
assert.equal(mobileToolSettingsPeekHeight(800), 208);
assert.equal(mobileToolSettingsPeekHeight(2_000), 240);

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
  "mobileFillTolerance",
  "mobileSelectionMethod",
  "mobileSelectionReplace",
  "mobileSelectionAdd",
  "mobileSelectionSubtract",
  "mobileSelectionTolerance",
  "mobileSelectionColor",
  "mobileSelectionColorApply",
  "mobileSelectionClear",
  "mobileTransformCancel",
  "mobileTransformApply",
  "mobileLayerOpacity",
  "mobileLayerBlendMode",
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
  /new EditorToolsController\(\{[\s\S]*?openToolSettings: \(kind, trigger\)[\s\S]*?mobileToolSettingsSheet\?\.open\(kind, trigger\)/,
  "the composition root must route typed tool cards to the shared settings sheet",
);
assert.match(
  main,
  /mobileToolSettingsSheet = new MobileToolSettingsSheetController\(\{[\s\S]*?selectCanvasTool: \(tool\) => canvasToolController\?\.select\(tool\) \?\? false/,
  "Fill, Selection and Transform must use the existing authoritative canvas-tool routing",
);
for (const action of [
  "getFillSettings",
  "setFillTolerance",
  "getSelectionSettings",
  "setSelectionMethod",
  "setSelectionTolerance",
  "setSelectionColor",
  "setSelectionCombineMode",
  "applySelectionColor",
  "clearSelection",
  "applyTransform",
  "cancelTransform",
  "getSelectedLayerOptions",
  "setSelectedLayerOpacity",
  "setSelectedLayerBlendMode",
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
  /private syncSelection\(\): void \{[\s\S]*?this\.options\.getSelectionSettings\(\)/,
  "Selection must read its explicit state port",
);
assert.doesNotMatch(
  controller,
  /sourceControl<[^>]+>\("(?:fillTolerance|selectionMethod|selectionTolerance|selectionColor|selectionReplace|selectionAdd|selectionSubtract|selectionColorApply|selectionClear)"\)/,
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
  /runVectorCommand: \(command\) => \{[\s\S]*?command === "import-svg"\) controller\.requestSvgImport\(\);[\s\S]*?else controller\.requestRasterImageImport\(\);/,
  "mobile file buttons must open each picker once through the controller API",
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
  /finishTransformToolOnSheetClose[\s\S]*?await controller\.applyTransform\(\)[\s\S]*?stopSelectedTextDistortEditing\(\)[\s\S]*?this\.activeCanvasTool === "transform" \? "paint" : this\.activeCanvasTool[\s\S]*?this\.select\(targetTool, true\)/,
  "closing Transform or Distort must commit safely, remove edit handles and return to Paint",
);
assert.match(
  controller,
  /MOBILE_LAYER_OPTIONS_MAX_VISIBLE_PX[\s\S]*?activeKind === "layer-options"/,
  "layer opacity and blend mode must open together in a content-sized compact detent",
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
  /private updateTransformCommitUi\(\): void[\s\S]*?this\.onEditorStateChange\?\.\(\)/,
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
assert.match(
  css,
  /#app:has\(#mobileToolSettingsSheet\.is-open\[data-tool="transform"\]\) #transformCommitBar,[\s\S]*?data-tool="text-warp"[\s\S]*?display:\s*none;/,
  "the upper Transform bar must disappear while the equivalent mobile actions are visible",
);

console.log("Mobile tool settings: authoritative controls, shared detents and accessibility verified.");
