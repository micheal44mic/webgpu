import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RasterStyleController } from "../src/raster-style-controller.ts";

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const source = readFileSync(new URL("src/raster-style-controller.ts", root), "utf8");

assert.match(main, /new RasterStyleController\(\{[\s\S]*?isPointerActive:/);
assert.doesNotMatch(
  main,
  /rasterColorOverlayChanging|rasterStrokeChanging|rasterOuterShadowChanging|rasterInnerShadowChanging|rasterBevelChanging/,
);
assert.match(
  source,
  /private readonly busyKinds = new Set<NonDestructiveRasterEffectKind>\(\)/,
);

const styles = {
  colorOverlay: { enabled: true, color: "#ff0000", opacity: 1 },
  stroke: { enabled: false },
  outerShadow: { enabled: true },
  innerShadow: { enabled: false },
  bevel: { enabled: true },
};
let engineReady = true;
let pointerActive = false;
let mixedScene = null;
let rasterSelected = true;
let busyChanges = 0;
const calls = [];
let pendingStrokeResolve = null;
const engine = {
  getMixedSceneSnapshot: () => mixedScene,
  canPaintSelectedSceneItem: () => rasterSelected,
  getRasterColorOverlayStyle: () => styles.colorOverlay,
  getRasterStrokeStyle: () => styles.stroke,
  getRasterOuterShadowStyle: () => styles.outerShadow,
  getRasterInnerShadowStyle: () => styles.innerShadow,
  getRasterBevelStyle: () => styles.bevel,
  setRasterColorOverlayStyle: async (style) => {
    calls.push(["color-overlay", style]);
    return true;
  },
  setRasterStrokeStyle: (style) => {
    calls.push(["stroke", style]);
    return new Promise((resolve) => {
      pendingStrokeResolve = resolve;
    });
  },
  setRasterOuterShadowStyle: async (style) => {
    calls.push(["outer-shadow", style]);
    return true;
  },
  setRasterInnerShadowStyle: async (style) => {
    calls.push(["inner-shadow", style]);
    throw new Error("simulated failure");
  },
  setRasterBevelStyle: async (style) => {
    calls.push(["bevel", style]);
    return false;
  },
};

const controller = new RasterStyleController({
  engine,
  isEngineReady: () => engineReady,
  isPointerActive: () => pointerActive,
  onBusyChange: () => {
    busyChanges += 1;
  },
});

assert.equal(controller.effectEnabled("color-overlay"), true);
assert.equal(controller.effectEnabled("stroke"), false);
assert.equal(controller.effectEnabled("outer-shadow"), true);
assert.equal(controller.effectEnabled("inner-shadow"), false);
assert.equal(controller.effectEnabled("bevel"), true);
assert.equal(controller.colorOverlayTargetIsSelected(), true, "the base raster scene is valid");

engineReady = false;
assert.equal(await controller.applyBevelStyle({ enabled: true }), false);
assert.equal(calls.length, 0);
engineReady = true;
pointerActive = true;
assert.equal(await controller.applyOuterShadowStyle({ enabled: true }), false);
assert.equal(calls.length, 0);
pointerActive = false;

mixedScene = { selectedKey: "text:1", items: [] };
rasterSelected = false;
assert.equal(await controller.applyColorOverlayStyle(styles.colorOverlay), false);
assert.equal(calls.length, 0, "Color Overlay must reject a selected vector target");
rasterSelected = true;
assert.equal(await controller.applyColorOverlayStyle(styles.colorOverlay), true);
assert.equal(busyChanges, 2);

const strokePromise = controller.applyStrokeStyle({ enabled: true });
assert.equal(controller.isBusy, true);
assert.equal(await controller.applyStrokeStyle({ enabled: false }), false, "same-kind writes serialize");
assert.equal(
  await controller.applyOuterShadowStyle({ enabled: true }),
  true,
  "independent metadata kinds preserve the previous concurrency contract",
);
pendingStrokeResolve(true);
assert.equal(await strokePromise, true);
assert.equal(controller.isBusy, false);

assert.equal(await controller.applyInnerShadowStyle({ enabled: true }), false);
assert.equal(controller.isBusy, false, "failed mutations must always release their lock");
assert.equal(await controller.applyBevelStyle({ enabled: true }), false);
assert.equal(controller.isBusy, false);

console.log("Raster style controller: target guards, per-kind locks and failure recovery verified.");
