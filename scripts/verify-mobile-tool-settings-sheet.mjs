import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const controller = readFileSync(
  new URL("src/mobile-tool-settings-sheet.ts", root),
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
const textCategoryStart = html.indexOf(
  '<h2 class="mobile-tools-category-title">Text</h2>',
);
const effectsCategoryStart = html.indexOf(
  '<h2 class="mobile-tools-category-title">Effects</h2>',
);
assert.ok(
  insertCategoryStart >= 0
  && textCategoryStart > insertCategoryStart
  && effectsCategoryStart > textCategoryStart,
  "Text must be its own category between Insert and raster Effects",
);
assert.doesNotMatch(
  html.slice(insertCategoryStart, textCategoryStart),
  /data-mobile-tool-sheet="text"/,
  "Text must no longer be duplicated inside Insert",
);
assert.doesNotMatch(
  html,
  /data-mobile-proxy-button="addVectorText"/,
  "opening Text must not create a default text node immediately",
);
assert.match(html, /data-mobile-proxy-button="vectorSvgImportButton"/);
assert.match(html, /data-mobile-proxy-button="rasterImageImportButton"/);

assert.match(
  main,
  /for \(const button of mobileToolSettingsButtons\)[\s\S]*?mobileToolSettingsSheet\?\.open\(kind(?: as MobileToolSettingsKind)?, button\);/,
  "tool cards must open the shared editor and preserve their opener for focus restoration",
);
assert.match(
  main,
  /mobileToolSettingsSheet = new MobileToolSettingsSheetController\(\{[\s\S]*?selectCanvasTool: selectMobileCanvasTool/,
  "Fill, Selection and Transform must use the existing authoritative canvas-tool routing",
);

for (const sourceId of [
  "fillTolerance",
  "selectionMethod",
  "selectionTolerance",
  "selectionColor",
  "selectionReplace",
  "selectionAdd",
  "selectionSubtract",
  "selectionColorApply",
  "selectionClear",
  "transformCommitBar",
  "transformCancel",
  "transformApply",
  "vectorTextValue",
  "vectorTextFontFamily",
  "vectorTextFontSize",
  "vectorTextColor",
  "addVectorText",
  "vectorTextReset",
  "deleteVectorText",
  "vectorTextRasterize",
  "vectorTextTransformNone",
  "vectorTextTransformDistort",
  "vectorTextTransformArch",
  "vectorTextTransformCircle",
  "vectorTextTransformWave",
  "vectorTextDistortReset",
  "vectorTextDistortEdit",
  "vectorTextTransformCurve",
  "vectorTextCircleRadius",
  "vectorTextCircleInverted",
  "vectorTextOutlineWidth",
  "vectorTextOutlineColor",
  "vectorTextOutlineJoin",
  "vectorTextSingleShadowEnabled",
  "vectorTextSingleShadowColor",
  "vectorTextSingleShadowOpacity",
  "vectorTextSingleShadowOffset",
  "vectorTextSingleShadowAngle",
  "vectorTextSingleShadowBlur",
  "vectorTextInnerShadowEnabled",
  "vectorTextInnerShadowColor",
  "vectorTextInnerShadowOpacity",
  "vectorTextInnerShadowOffset",
  "vectorTextInnerShadowAngle",
  "vectorTextInnerShadowBlur",
  "vectorTextBlockShadowEnabled",
  "vectorTextBlockShadowColor",
  "vectorTextBlockShadowOpacity",
  "vectorTextBlockShadowOffset",
  "vectorTextBlockShadowAngle",
  "vectorTextBlockShadowOutlineWidth",
]) {
  assert.match(controller, new RegExp(`"${sourceId}"`), `missing authoritative source #${sourceId}`);
}
assert.match(
  controller,
  /bindMirroredHistoryControl\(mobile, sourceId\)/,
  "mobile text inputs must forward the source history lifecycle so one slider gesture remains one undo action",
);
assert.match(
  controller,
  /TEXT_SELECTION_REQUIRED_KINDS[\s\S]*?this\.options\.hasSelectedText\(\)/,
  "text effects must refuse stale SVG or raster selections",
);
assert.match(
  main,
  /selectedText\?\.transformType[\s\S]*?selectedText\?\.outlineWidth[\s\S]*?singleShadowEnabled[\s\S]*?innerShadowEnabled[\s\S]*?blockShadowEnabled/,
  "text tool cards must derive their ivory/gray state from the selected authoritative text node",
);
assert.match(
  main,
  /hasSelectedText:\s*\(\) => selectedMobileTextNode\(\) !== null/,
  "the shared sheet must gate text-only editors with the mixed-scene selection",
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
  controller,
  /new MutationObserver\([\s\S]*?attributeFilter: \["hidden"\]/,
  "Transform Apply and Cancel must follow the existing transaction bar without polling",
);
assert.doesNotMatch(controller, /setInterval\(/, "the tool sheet must not poll");
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

console.log("Mobile tool settings: authoritative controls, shared detents and accessibility verified.");
