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
  const cancelButton = new FakeElement();
  const proceedButton = new FakeElement();
  const controller = new MemoryLimitDialogController({
    root,
    cancelButton,
    proceedButton,
  });
  return {
    controller,
    root,
    cancelButton,
    proceedButton,
    previousFocus,
  };
}

// Proceed approves only the visible attempt and returns focus. A concurrent
// attempt must fail closed instead of borrowing the current confirmation.
{
  const ui = harness();
  const first = ui.controller.confirm();
  assert.equal(ui.root.open, true);
  assert.equal(ui.cancelButton.focused, true, "Cancel must receive initial focus");
  assert.equal(
    await ui.controller.confirm(),
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
  const cancelled = ui.controller.confirm();
  ui.cancelButton.dispatchEvent(new Event("click"));
  assert.equal(await cancelled, false);

  const escaped = ui.controller.confirm();
  const cancelEvent = new Event("cancel", { cancelable: true });
  ui.root.dispatchEvent(cancelEvent);
  assert.equal(cancelEvent.defaultPrevented, true);
  assert.equal(await escaped, false);

  const disposed = ui.controller.confirm();
  ui.controller.dispose();
  assert.equal(await disposed, false);
}

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const dialogHtml = html.match(/<dialog\s+id="memoryLimitDialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
const main = read("../src/main.ts");
const engine = read("../src/brush-engine.ts");
const merge = read("../src/engine-layer-merge-runtime.ts");
const liquify = read("../src/engine-liquify-runtime.ts");
const historyRuntime = read("../src/engine-history-runtime.ts");

assert.match(dialogHtml, /role="alertdialog"/);
assert.match(dialogHtml, />Memory limit warning</);
assert.match(dialogHtml, />Cancel</);
assert.match(dialogHtml, />Proceed anyway</);
assert.doesNotMatch(dialogHtml, /Estimated peak|required|Currently available|unsaved changes|accept the risk/i);
assert.doesNotMatch(dialogHtml, /memoryLimitDialogAction|memoryLimitDialogMessage|memoryLimitDialogMetrics/);
assert.match(main, /onMemoryAdmissionWarning\(\)[\s\S]*?memoryLimitDialogController\.confirm\(\)/);
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

console.log("Memory limit dialog: title-only copy, one-shot proceed, fail-closed cancel/Escape/concurrency and all five admission gates verified.");
