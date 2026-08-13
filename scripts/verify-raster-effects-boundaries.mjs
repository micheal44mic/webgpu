import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = await import("../src/raster-effects-contract.ts");
const editContract = await import("../src/destructive-raster-edit-contract.ts");

assert.deepEqual(contract.NON_DESTRUCTIVE_RASTER_EFFECT_KINDS, [
  "color-overlay",
  "stroke",
  "outer-shadow",
  "inner-shadow",
  "bevel",
]);
assert.deepEqual(contract.DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS, [
  "liquify",
  "gaussian-blur",
  "motion-blur",
  "noise",
]);
const overlap = contract.NON_DESTRUCTIVE_RASTER_EFFECT_KINDS.filter(
  (kind) => contract.DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS.includes(kind),
);
assert.deepEqual(overlap, []);
assert.equal(contract.RASTER_EFFECT_DOMAIN.nonDestructive.stateOwner, "layer-metadata");
assert.equal(contract.RASTER_EFFECT_DOMAIN.nonDestructive.mutation, "re-renderable-style");
assert.equal(contract.RASTER_EFFECT_DOMAIN.destructive.stateOwner, "raster-adjustment-transaction");
assert.equal(contract.RASTER_EFFECT_DOMAIN.destructive.mutation, "baked-pixels");
assert.equal(contract.isNonDestructiveRasterEffectKind("stroke"), true);
assert.equal(contract.isNonDestructiveRasterEffectKind("noise"), false);
assert.equal(contract.isDestructiveRasterAdjustmentKind("noise"), true);
assert.equal(contract.isDestructiveRasterAdjustmentKind("bevel"), false);
assert.deepEqual(editContract.DESTRUCTIVE_RASTER_EDIT_KINDS, [
  "transform",
  "liquify",
  "gaussian-blur",
  "motion-blur",
  "noise",
]);
assert.equal(editContract.destructiveRasterEditLabel("transform"), "Trasforma");
assert.equal(editContract.destructiveRasterEditLabel("noise"), "Noise");

const root = new URL("../", import.meta.url);
const styleController = readFileSync(new URL("src/raster-style-controller.ts", root), "utf8");
const adjustmentsController = readFileSync(
  new URL("src/raster-adjustments-controller.ts", root),
  "utf8",
);
const strokeSheet = readFileSync(new URL("src/mobile-stroke-sheet.ts", root), "utf8");
const effectSheet = readFileSync(new URL("src/mobile-raster-effects-sheet.ts", root), "utf8");
const sharedSheet = readFileSync(
  new URL("src/mobile-bottom-sheet-controller.ts", root),
  "utf8",
);
const brushEngine = readFileSync(new URL("src/brush-engine.ts", root), "utf8");

assert.match(styleController, /NonDestructiveRasterEffectKind/);
assert.match(styleController, /non-destructive raster metadata/);
assert.match(adjustmentsController, /DestructiveRasterAdjustmentKind/);
assert.match(adjustmentsController, /destructive raster-adjustment transactions/);
assert.match(strokeSheet, /new MobileBottomSheetController/);
assert.match(effectSheet, /new MobileBottomSheetController/);
assert.match(sharedSheet, /class MobileBottomSheetController/);
assert.doesNotMatch(strokeSheet, /private (?:start|move|finish)Drag/);
assert.doesNotMatch(effectSheet, /private (?:start|move|finish)Drag/);
assert.match(
  brushEngine,
  /satisfies Readonly<Record<DestructiveRasterEditKind, boolean>>/,
  "adding a destructive edit kind must force its active-session guard to be updated",
);
assert.match(brushEngine, /for \(const kind of DESTRUCTIVE_RASTER_EDIT_KINDS\)/);

console.log("Raster effects: destructive domains and shared sheet lifecycle verified.");
