import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const source = readFileSync(
  new URL("src/document-interaction-controller.ts", root),
  "utf8",
);

assert.match(main, /documentInteractionController = new DocumentInteractionController\(\{/);
assert.match(main, /documentInteractionController\?\.dispose\(\);/);
assert.doesNotMatch(
  main,
  /previousMobileTouchEnd|textSelectionEditableSelector|layerCompressionInteractionPointers/,
  "document-wide state must have exactly one owner",
);
assert.match(source, /DOUBLE_TAP_ZOOM_INTERVAL_MS = 350/);
assert.match(source, /DOUBLE_TAP_ZOOM_DISTANCE_PX = 32/);
assert.match(source, /new options\.browser\.AbortController\(\)/);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let DocumentInteractionController;
try {
  ({ DocumentInteractionController } = await server.ssrLoadModule(
    "/src/document-interaction-controller.ts",
  ));
} finally {
  await server.close();
}

class FakeEventHost {
  listeners = new Map();

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
    options.signal?.addEventListener("abort", () => {
      const current = this.listeners.get(type) ?? [];
      this.listeners.set(type, current.filter((entry) => entry !== listener));
    }, { once: true });
  }

  dispatch(type, event = {}) {
    event.type = type;
    event.defaultPrevented = false;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
}

class FakeElement {
  constructor(editable = false) {
    this.editable = editable;
  }

  closest() {
    return this.editable ? this : null;
  }
}

class FakeBrowser extends FakeEventHost {
  AbortController = globalThis.AbortController;
  Element = FakeElement;
}

class FakeDocument extends FakeEventHost {
  visibilityState = "visible";
  focused = true;

  hasFocus() {
    return this.focused;
  }
}

const browser = new FakeBrowser();
const document = new FakeDocument();
const calls = {
  cancel: 0,
  pause: 0,
  resume: 0,
  interrupt: 0,
  resumeHistory: 0,
};
const engine = {
  layerColdCompressionEnabled: true,
  pauseLayerColdCompressionForInteraction() { calls.pause += 1; },
  resumeLayerColdCompressionAfterInteraction() { calls.resume += 1; },
  interruptHistoryMaintenance() { calls.interrupt += 1; },
  resumeDiscardedHistoryMaintenance() { calls.resumeHistory += 1; },
};
const controller = new DocumentInteractionController({
  browser,
  document,
  engine,
  cancelTransientInteraction: () => { calls.cancel += 1; },
});

const nonEditableSelection = document.dispatch("selectstart", {
  target: new FakeElement(false),
});
assert.equal(nonEditableSelection.defaultPrevented, true);
const editableSelection = document.dispatch("selectstart", {
  target: new FakeElement(true),
});
assert.equal(editableSelection.defaultPrevented, false);
assert.equal(document.dispatch("dblclick").defaultPrevented, true);

const touchEnd = (timeStamp, clientX, clientY) => document.dispatch("touchend", {
  timeStamp,
  touches: [],
  changedTouches: [{ clientX, clientY }],
});
assert.equal(touchEnd(100, 20, 20).defaultPrevented, false);
assert.equal(touchEnd(300, 30, 30).defaultPrevented, true);
assert.equal(touchEnd(700, 20, 20).defaultPrevented, false);
assert.equal(touchEnd(900, 100, 100).defaultPrevented, false);
document.dispatch("touchstart", { touches: [{}, {}] });
assert.equal(touchEnd(950, 100, 100).defaultPrevented, false);

browser.dispatch("pointerdown", { pointerId: 1 });
browser.dispatch("pointerdown", { pointerId: 2 });
assert.equal(calls.pause, 2);
assert.equal(calls.interrupt, 2);
browser.dispatch("pointerup", { pointerId: 1 });
assert.equal(calls.resume, 0, "compression remains paused until every pointer ends");
assert.equal(calls.resumeHistory, 1);
browser.dispatch("pointercancel", { pointerId: 2 });
assert.equal(calls.resume, 1);
assert.equal(calls.resumeHistory, 2);

browser.dispatch("blur");
assert.equal(calls.cancel, 1);
assert.equal(calls.pause, 3);
document.focused = false;
browser.dispatch("focus");
assert.equal(calls.resume, 1);
document.focused = true;
browser.dispatch("focus");
assert.equal(calls.resume, 2);
document.visibilityState = "hidden";
document.dispatch("visibilitychange");
assert.equal(calls.pause, 4);
document.visibilityState = "visible";
document.dispatch("visibilitychange");
assert.equal(calls.resume, 3);

controller.dispose();
controller.dispose();
browser.dispatch("pointerdown", { pointerId: 3 });
document.dispatch("dblclick");
assert.equal(calls.interrupt, 2, "dispose must remove global listeners");

console.log(
  "Document interaction controller: zoom guard, selection exceptions, compression and lifecycle verified.",
);
