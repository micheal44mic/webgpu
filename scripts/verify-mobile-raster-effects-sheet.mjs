import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const editorToolsSource = readFileSync(
  new URL("src/editor-tools-controller.ts", root),
  "utf8",
);
const controllerSource = readFileSync(
  new URL("src/mobile-raster-effects-sheet.ts", root),
  "utf8",
);
const sharedSheetControllerSource = readFileSync(
  new URL("src/mobile-bottom-sheet-controller.ts", root),
  "utf8",
);
const rasterStyleSource = readFileSync(
  new URL("src/raster-style-controller.ts", root),
  "utf8",
);

const controller = await import(new URL("src/mobile-raster-effects-sheet.ts", root));
const colorOverlay = await import(new URL("src/raster-color-overlay-core.ts", root));
const shadows = await import(new URL("src/shadow-core.ts", root));
const bevel = await import(new URL("src/bevel-core.ts", root));

const {
  MOBILE_RASTER_EFFECT_SPECS,
  mobileRasterEffectPeekHeight,
  resolveMobileRasterEffectDrag,
} = controller;

function controlKeys(kind) {
  return MOBILE_RASTER_EFFECT_SPECS[kind].controls
    .filter((control) => control.type !== "group")
    .map((control) => control.key);
}

function sorted(values) {
  return [...values].sort();
}

function styleKeys(defaultStyle, intentionallyPreservedOnly = []) {
  return Object.keys(defaultStyle).filter(
    (key) => key !== "enabled" && !intentionallyPreservedOnly.includes(key),
  );
}

const expectedKeys = {
  "color-overlay": styleKeys(colorOverlay.DEFAULT_RASTER_COLOR_OVERLAY_STYLE),
  "outer-shadow": styleKeys(
    shadows.DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    // The authoritative record preserves this field, but desktop does not
    // expose a control for it yet. Mobile must not invent a second setting.
    ["useGlobalLight"],
  ),
  "inner-shadow": styleKeys(
    shadows.DEFAULT_RASTER_INNER_SHADOW_STYLE,
    ["useGlobalLight"],
  ),
  bevel: styleKeys(bevel.DEFAULT_RASTER_BEVEL_STYLE),
};

for (const [kind, expected] of Object.entries(expectedKeys)) {
  const actual = controlKeys(kind);
  assert.equal(
    new Set(actual).size,
    actual.length,
    `${kind} must not render the same authoritative field twice`,
  );
  assert.deepEqual(
    sorted(actual),
    sorted(expected),
    `${kind} mobile controls must cover every setting already exposed by desktop`,
  );
}

for (const kind of ["color-overlay", "outer-shadow", "inner-shadow", "bevel"]) {
  assert.match(
    html,
    new RegExp(`data-mobile-effect-kind="${kind}"`),
    `${kind} must route directly from its visible Tools card`,
  );
}
assert.doesNotMatch(
  html,
  /data-mobile-effect-control=/,
  "effect cards must not route through hidden checkbox IDs",
);

assert.deepEqual(
  Object.fromEntries(
    Object.entries(MOBILE_RASTER_EFFECT_SPECS).map(([kind, spec]) => [kind, spec.title]),
  ),
  {
    "color-overlay": "Color Overlay",
    "outer-shadow": "Outer Shadow",
    "inner-shadow": "Inner Shadow",
    bevel: "Bevel",
  },
  "all mobile effect titles must remain in English",
);
const colorOverlaySpec = MOBILE_RASTER_EFFECT_SPECS["color-overlay"];
assert.equal(
  colorOverlaySpec.enabledLabel,
  undefined,
  "Color Overlay must keep the shared Enabled switch separate from alpha mode",
);
assert.deepEqual(
  colorOverlaySpec.controls.find((control) => control.key === "uniformAlpha"),
  {
    type: "check",
    key: "uniformAlpha",
    label: "Use uniform alpha for all non-transparent pixels",
    description:
      "Every pixel with alpha above 0 uses the alpha set by Opacity. "
      + "Fully transparent pixels stay transparent.",
  },
  "Color Overlay must expose uniform alpha as a separate, explained option",
);
assert.equal(
  controlKeys("color-overlay").includes("enabled"),
  false,
  "the effect Enabled switch must not be duplicated inside the controls",
);
assert.equal(
  controlKeys("color-overlay").includes("uniformAlpha"),
  true,
  "the alpha-mode checkbox must bind to its own authoritative style field",
);
for (const [kind, spec] of Object.entries(MOBILE_RASTER_EFFECT_SPECS)) {
  assert.equal(
    spec.expandable,
    true,
    `${kind} must reach the same expanded snap as Bevel`,
  );
}

const expectedRangeContracts = {
  "color-overlay": {
    opacity: [0, 100, 1, "%"],
  },
  "outer-shadow": {
    opacity: [0, 100, 1, "%"],
    angle: [0, 359, 1, "°"],
    distance: [0, 1024, 1, "px"],
    spread: [0, 100, 1, "%"],
    size: [0, 250, 1, "px"],
    noise: [0, 100, 1, "%"],
  },
  "inner-shadow": {
    opacity: [0, 100, 1, "%"],
    angle: [0, 359, 1, "°"],
    distance: [0, 1024, 1, "px"],
    choke: [0, 100, 1, "%"],
    size: [0, 250, 1, "px"],
    noise: [0, 100, 1, "%"],
  },
  bevel: {
    size: [0.5, 250, 0.5, "px"],
    soften: [0, 64, 0.5, "px"],
    depth: [1, 1000, 1, "%"],
    angle: [0, 359, 1, "°"],
    altitude: [0, 90, 1, "°"],
    bevelRange: [1, 100, 1, "%"],
    fill: [0, 100, 1, "%"],
    highlightOpacity: [0, 100, 1, "%"],
    shadowOpacity: [0, 100, 1, "%"],
  },
};

for (const [kind, ranges] of Object.entries(expectedRangeContracts)) {
  const actualRanges = Object.fromEntries(
    MOBILE_RASTER_EFFECT_SPECS[kind].controls
      .filter((control) => control.type === "range")
      .map((control) => [
        control.key,
        [control.minimum, control.maximum, control.step, control.unit],
      ]),
  );
  assert.deepEqual(actualRanges, ranges, `${kind} ranges must match the desktop contract exactly`);
}

assert.deepEqual(
  MOBILE_RASTER_EFFECT_SPECS["outer-shadow"].controls
    .find((control) => control.key === "blendMode").options.map(([value]) => value),
  ["multiply", "normal"],
);
assert.deepEqual(
  MOBILE_RASTER_EFFECT_SPECS.bevel.controls
    .find((control) => control.key === "mode").options.map(([value]) => value),
  ["inner", "outer", "emboss", "pillow"],
);
assert.deepEqual(
  MOBILE_RASTER_EFFECT_SPECS.bevel.controls
    .find((control) => control.key === "technique").options.map(([value]) => value),
  ["smooth", "chiselHard", "chiselSoft"],
);

// Pure snap and gesture contract: all sheets open at the same compact Tools
// height and every effect may reach the same high snap as Bevel. Content
// scrolling remains independent.
assert.equal(mobileRasterEffectPeekHeight(300), 160);
assert.equal(mobileRasterEffectPeekHeight(800), 208);
assert.equal(mobileRasterEffectPeekHeight(2_000), 240);
for (const effectKind of Object.keys(MOBILE_RASTER_EFFECT_SPECS)) {
  assert.equal(
    resolveMobileRasterEffectDrag({
      effectKind,
      startSnap: "peek",
      deltaY: -36,
      releaseVelocityY: 0,
      offsetPx: 464,
      peekOffsetPx: 500,
      minimizedOffsetPx: 700,
    }),
    "expanded",
    `${effectKind} must expand with the same upward gesture as Bevel`,
  );
}
assert.equal(
  resolveMobileRasterEffectDrag({
    effectKind: "bevel",
    startSnap: "peek",
    deltaY: -36,
    releaseVelocityY: 0,
    offsetPx: 464,
    peekOffsetPx: 500,
    minimizedOffsetPx: 700,
  }),
  "expanded",
);
assert.equal(
  resolveMobileRasterEffectDrag({
    effectKind: "bevel",
    startSnap: "expanded",
    deltaY: 72,
    releaseVelocityY: 0.2,
    offsetPx: 72,
    peekOffsetPx: 500,
    minimizedOffsetPx: 700,
  }),
  "peek",
);
assert.equal(
  resolveMobileRasterEffectDrag({
    effectKind: "bevel",
    startSnap: "expanded",
    deltaY: 200,
    releaseVelocityY: 1,
    offsetPx: 200,
    peekOffsetPx: 500,
    minimizedOffsetPx: 700,
  }),
  "closed",
);
for (const effectKind of Object.keys(MOBILE_RASTER_EFFECT_SPECS)) {
  assert.equal(
    resolveMobileRasterEffectDrag({
      effectKind,
      startSnap: "peek",
      deltaY: 36,
      releaseVelocityY: 0.1,
      offsetPx: 536,
      peekOffsetPx: 500,
      minimizedOffsetPx: 700,
    }),
    "minimized",
    `${effectKind} must preserve a title-only minimized detent`,
  );
}
assert.equal(
  resolveMobileRasterEffectDrag({
    effectKind: "outer-shadow",
    startSnap: "minimized",
    deltaY: 36,
    releaseVelocityY: 0.1,
    offsetPx: 736,
    peekOffsetPx: 500,
    minimizedOffsetPx: 700,
  }),
  "closed",
  "a second downward gesture from minimized must close the sheet",
);
assert.equal(
  resolveMobileRasterEffectDrag({
    effectKind: "inner-shadow",
    startSnap: "minimized",
    deltaY: -36,
    releaseVelocityY: 0,
    offsetPx: 664,
    peekOffsetPx: 500,
    minimizedOffsetPx: 700,
  }),
  "peek",
  "an upward gesture from minimized must restore the compact editor",
);

const sheetStart = html.indexOf('id="mobileRasterEffectSheet"');
const sheetEnd = html.indexOf('id="mobileToolsSheet"', sheetStart);
assert.ok(sheetStart >= 0 && sheetEnd > sheetStart, "the raster-effect sheet must exist before Tools");
const sheetMarkup = html.slice(sheetStart, sheetEnd);
for (const id of [
  "mobileRasterEffectSheet",
  "mobileRasterEffectHandle",
  "mobileRasterEffectHeader",
  "mobileRasterEffectTitle",
  "mobileRasterEffectEnabledControl",
  "mobileRasterEffectEnabled",
  "mobileRasterEffectEnabledLabel",
  "mobileRasterEffectScroll",
  "mobileRasterEffectContent",
]) {
  assert.match(sheetMarkup, new RegExp(`id="${id}"`), `missing #${id}`);
}
assert.match(
  sheetMarkup,
  /class="mobile-tools-sheet mobile-raster-effect-sheet"[\s\S]*?aria-hidden="true"[\s\S]*?data-state="closed"[\s\S]*?data-snap="peek"/,
  "the shared sheet must start closed at the compact snap",
);
assert.match(
  controllerSource,
  /this\.enabledLabel\.textContent = spec\.enabledLabel \?\? "Enabled";/,
  "the shared effect switch must retain its Enabled label",
);
assert.match(
  controllerSource,
  /input\.setAttribute\("aria-describedby", helper\.id\);/,
  "the uniform-alpha checkbox must expose its helper to assistive technology",
);
assert.match(
  controllerSource,
  /this\.enabledInput\.checked = style\.enabled;/,
  "the shared effect switch must remain bound to the existing enabled field",
);
assert.match(
  css,
  /\.mobile-raster-effect-check-help\s*\{[\s\S]*?line-height:\s*1\.4;/,
  "the uniform-alpha helper must have a readable mobile treatment",
);

for (const title of ["Color Overlay", "Outer Shadow", "Inner Shadow", "Bevel"]) {
  assert.match(
    html,
    new RegExp(`aria-label="Open ${title} settings"`),
    `${title} must be announced as an editor, not a toggle`,
  );
}

assert.match(
  css,
  /\.mobile-raster-effect-sheet\s*\{[\s\S]*?--mobile-tools-sheet-offset:\s*calc\(100% - clamp\(160px, 26dvh, 240px\)\)/,
  "the default visible height must match the compact Tools sheet",
);
assert.match(
  css,
  /\.mobile-raster-effect-scroll\s*\{[\s\S]*?overflow-y:\s*auto;/,
  "settings must scroll inside the low snap without moving the sheet",
);
assert.match(
  css,
  /\.mobile-raster-effect-scroll\s*\{[\s\S]*?touch-action:\s*pan-y;/,
  "vertical touch scrolling must remain native inside the settings area",
);
assert.match(
  sharedSheetControllerSource,
  /handle\.addEventListener\("pointerdown"[\s\S]*?handle\.addEventListener\("pointermove"[\s\S]*?handle\.addEventListener\("pointerup"/,
  "only the grabber must own sheet dragging",
);
assert.doesNotMatch(
  controllerSource,
  /this\.scroll\.addEventListener\("pointer(?:down|move|up)"/,
  "scroll gestures must never be stolen by the sheet drag controller",
);
assert.match(
  controllerSource,
  /accessibilityRegions: \[this\.scroll, this\.enabledControl\]/,
  "the effect sheet must delegate only its declared regions to the shared controller",
);

assert.match(
  main,
  /mobileRasterEffectsSheet\s*=\s*new MobileRasterEffectsSheetController\(\{[\s\S]*?getColorOverlayStyle:\s*\(\)\s*=>\s*rasterStyleController\.getColorOverlayStyle\(\)[\s\S]*?applyColorOverlayStyle:\s*\(style\)\s*=>\s*rasterStyleController\.applyColorOverlayStyle\(style\)[\s\S]*?getOuterShadowStyle:\s*\(\)\s*=>\s*rasterStyleController\.getOuterShadowStyle\(\)[\s\S]*?applyOuterShadowStyle:\s*\(style\)\s*=>\s*rasterStyleController\.applyOuterShadowStyle\(style\)[\s\S]*?getInnerShadowStyle:\s*\(\)\s*=>\s*rasterStyleController\.getInnerShadowStyle\(\)[\s\S]*?applyInnerShadowStyle:\s*\(style\)\s*=>\s*rasterStyleController\.applyInnerShadowStyle\(style\)[\s\S]*?getBevelStyle:\s*\(\)\s*=>\s*rasterStyleController\.getBevelStyle\(\)[\s\S]*?applyBevelStyle:\s*\(style\)\s*=>\s*rasterStyleController\.applyBevelStyle\(style\)/,
  "mobile controls must be a view over the four existing authoritative style records",
);
assert.match(
  editorToolsSource + main,
  /const kind = button\.dataset\.mobileEffectKind;[\s\S]*?isEditorRasterEffectKind\(kind\)[\s\S]*?openRasterEffect\(kind, button\)[\s\S]*?openRasterEffect: \(kind, trigger\)[\s\S]*?mobileRasterEffectsSheet\?\.open\(kind, trigger\)/,
  "each Effects card must open its editor through a typed effect kind",
);
assert.doesNotMatch(
  main,
  /MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID|document\.getElementById\(controlId\)|control\.click\(\)/,
  "effect routing must not retain the hidden-control bus",
);
for (const [name, engineMethod] of [
  ["ColorOverlay", "setRasterColorOverlayStyle"],
  ["OuterShadow", "setRasterOuterShadowStyle"],
  ["InnerShadow", "setRasterInnerShadowStyle"],
  ["Bevel", "setRasterBevelStyle"],
]) {
  assert.match(
    rasterStyleSource,
    new RegExp(`apply${name}Style\\([\\s\\S]*?this\\.options\\.engine\\.${engineMethod}\\(style\\)`),
    `${name} must route through the existing BrushEngine setter`,
  );
}

// The UI queue must remain latest-only even while an asynchronous engine write
// is in flight. A rejected old version may not overwrite a newer optimistic one.
assert.match(controllerSource, /optimisticByKind = new Map</);
assert.match(
  controllerSource,
  /this\.draft = \{[\s\S]*?kind,[\s\S]*?inputKey: coalesceToFrame \? inputKey : null,[\s\S]*?\.\.\.versioned,[\s\S]*?\};\s*this\.optimisticByKind\.set\(kind, versioned\)/,
  "every UI edit must publish its optimistic version before RAF coalescing",
);
assert.match(
  controllerSource,
  /this\.content\.addEventListener\("change"[\s\S]*?control\.type === "range" \|\| control\.type === "color"[\s\S]*?this\.draft\?\.kind === this\.activeKind[\s\S]*?this\.draft\.inputKey === key[\s\S]*?this\.options\.browser\.cancelAnimationFrame\(this\.applyFrame\)[\s\S]*?this\.flushDraft\(\)[\s\S]*?else \{[\s\S]*?this\.handleControl\(control, false\)/,
  "range/color change must flush an existing input draft or process browsers that emit change only",
);
assert.doesNotMatch(
  controllerSource,
  /control\.type === "range" \|\| control\.type === "color"\)\) \{\s*return;/,
  "range and color change events must never be discarded unconditionally",
);
assert.match(
  controllerSource,
  /const optimistic = this\.optimisticByKind\.get\(kind\);\s*return optimistic \? copiedEffectStyle\(kind, optimistic\.style\) : this\.readStyle\(kind\)/,
  "a second control edit must build on the in-flight value, not stale engine state",
);
assert.match(
  controllerSource,
  /const latest = this\.optimisticByKind\.get\(kind\);[\s\S]*?const newerQueued = this\.pendingByKind\.get\(kind\);[\s\S]*?if \(latest\?\.version === pending\.version && !newerQueued\) \{[\s\S]*?this\.optimisticByKind\.delete\(kind\);[\s\S]*?if \(!accepted/,
  "only the latest completed version may clear or reject optimistic state",
);

// History ownership is property-specific. A fast Bevel → Shadow switch may
// not reuse Bevel's accepted transaction or commit it with Shadow's controls.
assert.match(
  controllerSource,
  /historyEditToken: number \| null = null;[\s\S]*?historyEditKind: MobileRasterEffectKind \| null = null/,
  "the controller must retain both the opaque token and its effect kind",
);
assert.match(
  controllerSource,
  /if \(this\.historyEditToken !== null\) \{\s*if \(this\.historyEditKind !== this\.activeKind\) return false;\s*this\.historyFinishRequested = false;\s*return true;\s*\}/,
  "a rapid effect switch must reject reuse of another effect's open transaction",
);
assert.match(
  controllerSource,
  /const token = this\.options\.beginHistoryEdit\(this\.activeKind\);\s*if \(token === null\) return false;\s*this\.historyEditToken = token;\s*this\.historyEditKind = this\.activeKind/,
  "the sheet must only enter edit state after an accepted engine handshake",
);
assert.match(
  controllerSource,
  /this\.historyEditToken === null[\s\S]*?this\.applyLoop[\s\S]*?this\.pendingOrder\.length > 0[\s\S]*?this\.pendingByKind\.size > 0[\s\S]*?const token = this\.historyEditToken;[\s\S]*?this\.options\.commitHistoryEdit\(token\)/,
  "close/focusout must commit exactly once and only after every latest-only write drains",
);
assert.match(
  main,
  /beginHistoryEdit:\s*\(kind: MobileRasterEffectKind\)[\s\S]*?return engine\.beginRasterLayerMetadataHistoryEdit\(kind\);[\s\S]*?commitHistoryEdit:\s*\(token\) => engine\.commitRasterLayerMetadataHistoryEdit\(token\)[\s\S]*?cancelHistoryEdit:\s*\(token\) => engine\.cancelRasterLayerMetadataHistoryEdit\(token\)/,
  "all four effects must forward the engine's atomic begin/commit/cancel token",
);

assert.doesNotMatch(
  controllerSource,
  /\bGPU(?:Device|Texture|Buffer|Queue|CommandEncoder|CanvasContext)\b|navigator\.gpu|createTexture\(|createBuffer\(|createCommandEncoder\(|queue\.submit\(|copyTextureToBuffer\(|mapAsync\(/,
  "the mobile editor must not allocate GPU resources or duplicate any renderer",
);
assert.doesNotMatch(
  controllerSource,
  /from ["'][^"']*(?:renderer|brush-engine)["']/,
  "the controller may depend on style contracts only, never renderer or engine internals",
);
assert.doesNotMatch(controllerSource, /setInterval\(/, "the effect sheet must not add polling");
assert.match(controllerSource, /readonly root: ParentNode;[\s\S]*?readonly browser: Window;[\s\S]*?readonly document: Document;/);
assert.match(controllerSource, /root\.querySelector<HTMLElement>\(`/);
assert.doesNotMatch(controllerSource, /document\.getElementById|\bwindow\./);
assert.match(
  main,
  /new MobileRasterEffectsSheetController\(\{[\s\S]*?root: element<HTMLElement>\("mobileRasterEffectSheet"\),[\s\S]*?browser: window,[\s\S]*?document,/,
  "the composition root must provide the effect sheet DOM and browser dependencies",
);
assert.match(
  sharedSheetControllerSource,
  /for \(const region of this\.options\.accessibilityRegions\)[\s\S]*?toggleAttribute\("inert", minimized\)[\s\S]*?setAttribute\("aria-hidden", String\(minimized\)\)/,
  "minimized effects must expose only their grabber and title",
);
assert.match(
  sharedSheetControllerSource,
  /if \(activeElement instanceof HTMLElement && this\.options\.sheet\.contains\(activeElement\)\)[\s\S]*?activeElement\.blur\(\);[\s\S]*?this\.options\.sheet\.setAttribute\("aria-hidden", "true"\)/,
  "focus must leave the effect sheet before its ancestor becomes aria-hidden",
);
assert.match(
  controllerSource,
  /async settleDocumentEdits\(\): Promise<void>[\s\S]*?this\.flushDraft\(\)[\s\S]*?await activeLoop[\s\S]*?this\.pendingByKind\.size > 0[\s\S]*?this\.historyEditToken !== null/,
  "document replacement must drain every coalesced effect and history token",
);

console.log("Mobile raster effects sheet: exact settings, routing, scroll, gestures and latest-only queue verified.");
