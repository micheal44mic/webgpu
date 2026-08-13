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
assert.doesNotMatch(main, /selectionUiBusy|function runPixelSelectionOperation|function applySelectionColorRange/);

console.log("Pixel selection controller: serialization, guards and recovery verified.");
