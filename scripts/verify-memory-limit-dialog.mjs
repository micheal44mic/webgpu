import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryLimitDialogController } from "../src/memory-limit-dialog-controller.ts";

class FakeElement extends EventTarget {
  textContent = "";
  focused = false;
  isConnected = true;

  focus() {
    this.focused = true;
  }
}

class FakeDialog extends FakeElement {
  open = false;
  ownerDocument;

  constructor(ownerDocument) {
    super();
    this.ownerDocument = ownerDocument;
  }

  showModal() {
    if (this.open) throw new Error("already open");
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}

function harness() {
  const previousFocus = new FakeElement();
  const document = { activeElement: previousFocus };
  const root = new FakeDialog(document);
  const action = new FakeElement();
  const peak = new FakeElement();
  const available = new FakeElement();
  const cancelButton = new FakeElement();
  const proceedButton = new FakeElement();
  const controller = new MemoryLimitDialogController({
    root,
    action,
    peak,
    available,
    cancelButton,
    proceedButton,
  });
  return {
    controller,
    root,
    action,
    peak,
    available,
    cancelButton,
    proceedButton,
    previousFocus,
  };
}

const warning = {
  action: "Switch layers",
  category: "layer-switch",
  requiredBytes: 610.9 * 1024 * 1024,
  availableBytes: 313.4 * 1024 * 1024,
  usedBytes: 488.5 * 1024 * 1024,
  ceilingBytes: 801.9 * 1024 * 1024,
  reason: "fixture refusal",
};

// Proceed approves only the visible attempt, renders its estimates, and
// returns focus. A concurrent attempt must fail closed instead of borrowing it.
{
  const ui = harness();
  const first = ui.controller.confirm(warning);
  assert.equal(ui.root.open, true);
  assert.equal(ui.action.textContent, "Switch layers");
  assert.equal(ui.peak.textContent, "610.9 MiB");
  assert.equal(ui.available.textContent, "313.4 MiB");
  assert.equal(ui.cancelButton.focused, true, "Cancel must receive initial focus");
  assert.equal(
    await ui.controller.confirm({ ...warning, action: "Merge layers" }),
    false,
    "a second action cannot reuse the current confirmation",
  );
  ui.proceedButton.dispatchEvent(new Event("click"));
  assert.equal(await first, true);
  assert.equal(ui.root.open, false);
  assert.equal(ui.previousFocus.focused, true);
  ui.controller.dispose();
}

// Cancel, Escape, and disposal all preserve the governor refusal.
{
  const ui = harness();
  const cancelled = ui.controller.confirm(warning);
  ui.cancelButton.dispatchEvent(new Event("click"));
  assert.equal(await cancelled, false);

  const escaped = ui.controller.confirm(warning);
  const cancelEvent = new Event("cancel", { cancelable: true });
  ui.root.dispatchEvent(cancelEvent);
  assert.equal(cancelEvent.defaultPrevented, true);
  assert.equal(await escaped, false);

  const disposed = ui.controller.confirm(warning);
  ui.controller.dispose();
  assert.equal(await disposed, false);
}

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const main = read("../src/main.ts");
const engine = read("../src/brush-engine.ts");
const merge = read("../src/engine-layer-merge-runtime.ts");
const liquify = read("../src/engine-liquify-runtime.ts");
const historyRuntime = read("../src/engine-history-runtime.ts");

assert.match(html, /role="alertdialog"/);
assert.match(html, /We can't safely complete this action/);
assert.match(html, /may cause the app to close unexpectedly/);
assert.match(html, />Cancel</);
assert.match(html, />Proceed anyway</);
assert.match(main, /onMemoryAdmissionWarning\(warning\)[\s\S]*?memoryLimitDialogController\.confirm\(warning\)/);
assert.match(engine, /async reserveMemoryWithAdmissionOverride\(/);
assert.match(engine, /await this\.reserveLayerDuplicateMemory\(source\)/);
assert.match(engine, /await this\.reserveLayerSwitchMemory\(index\)/);
assert.match(merge, /await reserveLayerMergeCreateMemory\(engine, memoryPlan\)/);
assert.match(merge, /await reserveLayerMergeHistoryMemory\(/);
assert.match(liquify, /await reserveSessionMemory\(engine, memoryBytes\)/);
assert.match(
  historyRuntime,
  /applyLayerMergeHistory\(engine, crossedAction, delta, true\)/,
  "user Undo/Redo may ask for an override",
);
assert.match(
  merge,
  /allowMemoryOverride = false/,
  "internal merge recovery must remain fail-closed",
);

console.log("Memory limit dialog: one-shot proceed, fail-closed cancel/Escape/concurrency, copy and all five admission gates verified.");
