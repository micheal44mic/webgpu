import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX,
  MOBILE_LAYER_REORDER_AUTO_SCROLL_MAX_PX_PER_SECOND,
  MOBILE_LAYER_REORDER_HOLD_MS,
  MOBILE_LAYER_REORDER_SLOP_PX,
  buildMobileLayerReorderPlan,
  mobileLayerReorderAutoScrollVelocity,
  mobileLayerReorderDropSlot,
  mobileLayerReorderHoldReached,
  mobileLayerReorderKeysAtSlot,
  mobileLayerReorderMovementExceeded,
} from "../src/mobile-layer-reorder-core.ts";

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");

assert.equal(MOBILE_LAYER_REORDER_HOLD_MS, 320);
assert.equal(MOBILE_LAYER_REORDER_SLOP_PX, 8);
assert.equal(MOBILE_LAYER_REORDER_AUTO_SCROLL_EDGE_PX, 36);
assert.equal(MOBILE_LAYER_REORDER_AUTO_SCROLL_MAX_PX_PER_SECOND, 520);
assert.equal(mobileLayerReorderMovementExceeded(0, 0, 8, 0), false);
assert.equal(mobileLayerReorderMovementExceeded(0, 0, 8.01, 0), true);
assert.equal(mobileLayerReorderHoldReached(100, 419.99), false);
assert.equal(mobileLayerReorderHoldReached(100, 420), true);

const items = [
  { key: "text:1", clippingParentKey: null },
  { key: "raster:3", clippingParentKey: "raster:1" },
  { key: "raster:2", clippingParentKey: "raster:1" },
  { key: "raster:1", clippingParentKey: null },
  { key: "svg:1", clippingParentKey: null },
];
const basePlan = buildMobileLayerReorderPlan(items, "raster:1");
assert.deepEqual(basePlan?.draggedKeys, ["raster:3", "raster:2", "raster:1"]);
assert.deepEqual(basePlan?.validSlots, [0, 1, 2]);
assert.deepEqual(
  mobileLayerReorderKeysAtSlot(basePlan, 0),
  ["raster:3", "raster:2", "raster:1", "text:1", "svg:1"],
  "moving a clipping base must preserve its complete contiguous group",
);

const maskPlan = buildMobileLayerReorderPlan(items, "raster:2");
assert.deepEqual(maskPlan?.draggedKeys, ["raster:2"]);
assert.deepEqual(maskPlan?.validSlots, [1, 2]);
assert.deepEqual(
  mobileLayerReorderKeysAtSlot(maskPlan, 1),
  ["text:1", "raster:2", "raster:3", "raster:1", "svg:1"],
  "a mask may reorder only above its own clipping parent",
);

const vectorPlan = buildMobileLayerReorderPlan(items, "text:1");
assert.deepEqual(vectorPlan?.validSlots, [0, 3, 4]);
assert.ok(!vectorPlan?.validSlots.includes(1));
assert.ok(!vectorPlan?.validSlots.includes(2));

const rows = [
  { key: "raster:3", top: 0, bottom: 64 },
  { key: "raster:2", top: 68, bottom: 132 },
  { key: "raster:1", top: 136, bottom: 200 },
  { key: "svg:1", top: 204, bottom: 268 },
];
assert.equal(mobileLayerReorderDropSlot(10, vectorPlan, rows), 0);
assert.equal(mobileLayerReorderDropSlot(260, vectorPlan, rows), 4);
assert.equal(mobileLayerReorderAutoScrollVelocity(100, 100, 500), -520);
assert.equal(mobileLayerReorderAutoScrollVelocity(118, 100, 500), -260);
assert.equal(mobileLayerReorderAutoScrollVelocity(300, 100, 500), 0);
assert.equal(mobileLayerReorderAutoScrollVelocity(500, 100, 500), 520);

assert.match(html, /id="mobileLayerReorderStatus"[\s\S]*?aria-live="polite"/);
assert.match(
  html,
  /id="mobileLayerContextMenu"[\s\S]*?role="menu"[\s\S]*?id="mobileLayerClipping"[\s\S]*?id="mobileLayerOptions"/,
  "the selected layer must expose Clipping Mask and Options in one anchored menu",
);
assert.match(
  html,
  /id="mobileLayersPanel"[\s\S]*?aria-hidden="true"[\s\S]*?inert/,
  "the initially hidden Layers panel must also be inert",
);
assert.match(css, /\.mobile-layer-row\.is-reordering/);
assert.match(css, /\.mobile-layer-row\.is-drop-before::before/);
assert.match(
  css,
  /\.mobile-layer-context-menu\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?background:\s*var\(--app-background\);/,
);
assert.match(css, /touch-action: none/);
assert.match(main, /setPointerCapture\(event\.pointerId\)/);
assert.match(main, /MOBILE_LAYER_REORDER_HOLD_MS/);
assert.match(
  main,
  /function armMobileLayerContextGesture\(\)[\s\S]*?openMobileLayerContextMenu\(gesture\.key, gesture\.row\)[\s\S]*?gesture\.phase = "armed"/,
  "a stationary hold must open the menu before it becomes a reorder gesture",
);
assert.match(
  main,
  /gesture\.phase === "armed"[\s\S]*?mobileLayerReorderMovementExceeded[\s\S]*?activateMobileLayerReorderGesture\(\)/,
  "continuing the same held gesture beyond the slop must transition to reorder",
);
assert.match(
  main,
  /gesture\.phase === "pending"[\s\S]*?mobileLayerReorderHoldReached\(gesture\.startTime, performance\.now\(\)\)[\s\S]*?armMobileLayerContextGesture\(\)/,
  "pointer-up must recover a long press when the browser throttles the hold timer",
);
assert.match(
  main,
  /mobileLayerOptionsButton\.addEventListener\("click"[\s\S]*?open\("layer-options"/,
  "Options must route to the shared compact bottom sheet",
);
assert.match(main, /mobileLayerReorderAutoScrollVelocity/);
assert.match(main, /event\.altKey[\s\S]*?ArrowUp[\s\S]*?ArrowDown/);
assert.match(
  main,
  /mobileLayerReorderGesture !== null[\s\S]*?event\.altKey[\s\S]*?ArrowUp[\s\S]*?ArrowDown[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/,
  "Alt+Arrow must be consumed while a pointer reorder is pending or dragging",
);
assert.match(
  main,
  /const focusWasInside = mobileLayersPanel\.contains\(document\.activeElement\)[\s\S]*?cancelMobileLayerReorderGesture\(false, true, false\);[\s\S]*?mobileLayersMenuButton\.focus\(\{ preventScroll: true \}\);[\s\S]*?removeAttribute\("inert"\)[\s\S]*?setAttribute\("inert", ""\)[\s\S]*?setAttribute\("aria-hidden", String\(!open\)\)/,
  "focus must leave Layers before inert/aria-hidden are applied",
);
assert.match(main, /row\.setAttribute\("aria-posinset", String\(position \+ 1\)\)/);
assert.match(main, /row\.setAttribute\("aria-setsize", String\(views\.length\)\)/);
assert.match(main, /document\.visibilityState !== "visible"/);

const pointerMoveStart = main.indexOf("function handleMobileLayerReorderPointerMove");
const pointerMoveEnd = main.indexOf("function handleMobileLayerReorderPointerUp", pointerMoveStart);
assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
assert.doesNotMatch(
  main.slice(pointerMoveStart, pointerMoveEnd),
  /engine\.|captureActiveLayerThumbnail|renderMobileLayerList/,
  "pointermove may schedule DOM/scroll RAF work only",
);

console.log("Mobile layer reorder: clipping plan, hold/drag, auto-scroll and UI contract verified.");
