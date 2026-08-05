import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const controllerSource = readFileSync(
  new URL("src/mobile-raster-effects-sheet.ts", root),
  "utf8",
);

const controller = await import(new URL("src/mobile-raster-effects-sheet.ts", root));
const colorOverlay = await import(new URL("src/raster-color-overlay-core.ts", root));
const shadows = await import(new URL("src/shadow-core.ts", root));
const bevel = await import(new URL("src/bevel-core.ts", root));

const {
  MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID,
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

assert.deepEqual(
  MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID,
  {
    rasterColorOverlayEnabled: "color-overlay",
    rasterOuterShadowEnabled: "outer-shadow",
    rasterInnerShadowEnabled: "inner-shadow",
    rasterBevelEnabled: "bevel",
  },
  "the four existing Tools cards must route to their matching sheet",
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
    }),
    "closed",
    `${effectKind} must close with the same short downward gesture`,
  );
}

const sheetStart = html.indexOf('id="mobileRasterEffectSheet"');
const sheetEnd = html.indexOf('id="mobileToolsSheet"', sheetStart);
assert.ok(sheetStart >= 0 && sheetEnd > sheetStart, "the raster-effect sheet must exist before Tools");
const sheetMarkup = html.slice(sheetStart, sheetEnd);
for (const id of [
  "mobileRasterEffectSheet",
  "mobileRasterEffectHandle",
  "mobileRasterEffectTitle",
  "mobileRasterEffectEnabled",
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
  controllerSource,
  /this\.handle\.addEventListener\("pointerdown"[\s\S]*?this\.handle\.addEventListener\("pointermove"[\s\S]*?this\.handle\.addEventListener\("pointerup"/,
  "only the grabber must own sheet dragging",
);
assert.doesNotMatch(
  controllerSource,
  /this\.scroll\.addEventListener\("pointer(?:down|move|up)"/,
  "scroll gestures must never be stolen by the sheet drag controller",
);

assert.match(
  main,
  /mobileRasterEffectsSheet\s*=\s*new MobileRasterEffectsSheetController\(\{[\s\S]*?getColorOverlayStyle:\s*\(\)\s*=>\s*engine\.getRasterColorOverlayStyle\(\)[\s\S]*?applyColorOverlayStyle:\s*applyRasterColorOverlayStyle[\s\S]*?getOuterShadowStyle:\s*\(\)\s*=>\s*engine\.getRasterOuterShadowStyle\(\)[\s\S]*?applyOuterShadowStyle:\s*applyRasterOuterShadowStyle[\s\S]*?getInnerShadowStyle:\s*\(\)\s*=>\s*engine\.getRasterInnerShadowStyle\(\)[\s\S]*?applyInnerShadowStyle:\s*applyRasterInnerShadowStyle[\s\S]*?getBevelStyle:\s*\(\)\s*=>\s*engine\.getRasterBevelStyle\(\)[\s\S]*?applyBevelStyle:\s*applyRasterBevelStyle/,
  "mobile controls must be a view over the four existing authoritative style records",
);
assert.match(
  main,
  /const effectKind = controlId[\s\S]*?MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID[\s\S]*?if \(effectKind && mobileRasterEffectsSheet\) \{\s*mobileRasterEffectsSheet\.open\(effectKind\);\s*return;/,
  "each Effects card must open its editor without clicking the old checkbox",
);
for (const [name, engineMethod] of [
  ["ColorOverlay", "setRasterColorOverlayStyle"],
  ["OuterShadow", "setRasterOuterShadowStyle"],
  ["InnerShadow", "setRasterInnerShadowStyle"],
  ["Bevel", "setRasterBevelStyle"],
]) {
  assert.match(
    main,
    new RegExp(`async function applyRaster${name}Style\\([\\s\\S]*?engine\\.${engineMethod}\\(style\\)`),
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
  /this\.content\.addEventListener\("change"[\s\S]*?control\.type === "range" \|\| control\.type === "color"[\s\S]*?this\.draft\?\.kind === this\.activeKind[\s\S]*?this\.draft\.inputKey === key[\s\S]*?cancelAnimationFrame\(this\.applyFrame\)[\s\S]*?this\.flushDraft\(\)[\s\S]*?else \{[\s\S]*?this\.handleControl\(control, false\)/,
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

console.log("Mobile raster effects sheet: exact settings, routing, scroll, gestures and latest-only queue verified.");
