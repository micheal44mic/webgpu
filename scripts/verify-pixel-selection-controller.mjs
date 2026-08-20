import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PixelSelectionController } from "../src/pixel-selection-controller.ts";

let ready = true;
let activeTool = "paint";
let settings = {
  method: "color-range",
  tolerance: 48,
  color: "#123456",
  combineMode: "add",
};
let selectArgs = null;
let releaseSelection;
const previewArgs = [];
const previewResolvers = [];
let finishPreviewCount = 0;
let invertCount = 0;
let clearShouldFail = false;
let busyChanges = 0;
let settled = 0;
const errors = [];

const controller = new PixelSelectionController({
  engine: {
    selectPixelsByColor(color, tolerance, combineMode) {
      selectArgs = { color, tolerance, combineMode };
      return new Promise((resolve) => { releaseSelection = resolve; });
    },
    previewPixelsByColor(color, tolerance, combineMode) {
      previewArgs.push({ color, tolerance, combineMode });
      return new Promise((resolve) => { previewResolvers.push(resolve); });
    },
    finishColorRangeSelectionPreview() {
      finishPreviewCount += 1;
    },
    async invertPixelSelection() {
      invertCount += 1;
    },
    async clearPixelSelection() {
      if (clearShouldFail) throw new Error("clear failed");
    },
  },
  isEngineReady: () => ready,
  getActiveTool: () => activeTool,
  getSelectionSettings: () => ({ ...settings }),
  onBusyChange: () => { busyChanges += 1; },
  onSettled: () => { settled += 1; },
  onError: (error) => errors.push(error),
});

assert.equal(await controller.applyColorRange(), false, "Color Range must require Selection.");
activeTool = "selection";
settings = { ...settings, method: "magic-wand" };
assert.equal(await controller.applyColorRange(), false, "The command must require Color Range.");
settings = { ...settings, method: "color-range" };

const pending = controller.applyColorRange();
await Promise.resolve();
assert.equal(controller.isBusy, true);
assert.deepEqual(selectArgs, { color: "#123456", tolerance: 48, combineMode: "add" });
assert.equal(await controller.clear(), false, "A second selection command must not overlap.");
releaseSelection();
assert.equal(await pending, true);
assert.equal(controller.isBusy, false);
assert.equal(busyChanges, 2, "Busy state must be published at begin and settle.");
assert.equal(settled, 1);

settings = { ...settings, tolerance: 24 };
assert.equal(controller.requestColorRangePreview(), true);
await Promise.resolve();
assert.equal(controller.isColorRangePreviewBusy, true);
assert.deepEqual(previewArgs, [{ color: "#123456", tolerance: 24, combineMode: "add" }]);
settings = { ...settings, tolerance: 64 };
assert.equal(controller.requestColorRangePreview(), true);
settings = { ...settings, tolerance: 96 };
assert.equal(controller.requestColorRangePreview(), true);
const finishPreview = controller.finishColorRangePreview();
previewResolvers.shift()();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(previewArgs[1], { color: "#123456", tolerance: 96, combineMode: "add" });
previewResolvers.shift()();
await finishPreview;
assert.equal(controller.isColorRangePreviewBusy, false);
assert.equal(finishPreviewCount, 1, "Finishing the gesture must release its stable GPU baseline.");
assert.equal(previewArgs.length, 2, "Rapid inputs must collapse to the latest requested preview.");

assert.equal(await controller.invert(), true);
assert.equal(invertCount, 1);

clearShouldFail = true;
assert.equal(await controller.clear(), false, "Engine failures must be recovered by the owner.");
assert.equal(errors.length, 1);
assert.equal(controller.isBusy, false);
ready = false;
assert.equal(await controller.clear(), false, "Commands must be rejected before engine readiness.");

const source = readFileSync(new URL("../src/pixel-selection-controller.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /BrushEngine|document\.|window\.|getElementById/);
assert.match(main, /new PixelSelectionController\(\{/);
assert.match(source, /requestColorRangePreview\(\)/);
assert.match(source, /finishColorRangePreview\(\)/);
assert.match(source, /invert\(\)/);
assert.doesNotMatch(main, /selectionUiBusy|function runPixelSelectionOperation|function applySelectionColorRange/);

console.log("Pixel selection controller: serialization, guards and recovery verified.");
