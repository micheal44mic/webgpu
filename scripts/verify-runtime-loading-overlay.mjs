import assert from "node:assert/strict";
import { createServer } from "vite";

class FakeStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) ?? "";
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
  }

  hidden = true;
  inert = false;
  textContent = "";
  dataset = {};
  style = new FakeStyle();
  attributes = new Map();
  children = [];
  parentElement = null;

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class FakeDocument {
  elements = new Map();

  register(element) {
    this.elements.set(element.id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
}

class FakeWindow {
  now = 0;
  nextTimer = 1;
  timers = new Map();
  nextAnimationFrame = 1;
  animationFrames = new Map();

  setTimeout(callback, delay = 0) {
    const id = this.nextTimer;
    this.nextTimer += 1;
    this.timers.set(id, { callback, due: this.now + Number(delay) });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  requestAnimationFrame(callback) {
    const id = this.nextAnimationFrame;
    this.nextAnimationFrame += 1;
    this.animationFrames.set(id, callback);
    return id;
  }

  flushAnimationFrame() {
    this.now += 1000 / 60;
    const callbacks = [...this.animationFrames.values()];
    this.animationFrames.clear();
    for (const callback of callbacks) callback(this.now);
  }

  advance(milliseconds) {
    const end = this.now + milliseconds;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= end)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.due;
      timer.callback();
    }
    this.now = end;
  }
}

const originalHTMLElement = globalThis.HTMLElement;
globalThis.HTMLElement = FakeElement;

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let CanvasStartupOverlayController;
try {
  ({ CanvasStartupOverlayController } = await moduleServer.ssrLoadModule(
    "/src/canvas-startup-overlay-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

const fixture = () => {
  const root = new FakeDocument();
  const browser = new FakeWindow();
  const editor = new FakeElement("editor");
  const application = new FakeElement("application");
  application.hidden = false;
  const preservedInert = new FakeElement("preservedInert");
  preservedInert.hidden = false;
  preservedInert.inert = true;
  const overlay = root.register(new FakeElement("canvasStartupOverlay"));
  const progress = root.register(new FakeElement("canvasStartupProgress"));
  const fill = root.register(new FakeElement("canvasStartupProgressFill"));
  const label = root.register(new FakeElement("canvasStartupLabel"));
  editor.append(application, preservedInert, overlay);
  return {
    browser,
    application,
    preservedInert,
    overlay,
    progress,
    fill,
    label,
    controller: new CanvasStartupOverlayController(root, browser),
  };
};

{
  const view = fixture();
  const outer = view.controller.beginRuntimeOperation("Importing image");
  assert.equal(view.application.inert, true, "runtime work must block input immediately");
  assert.equal(view.overlay.hidden, true, "short work must not flash the overlay");
  view.browser.advance(119);
  assert.equal(view.overlay.hidden, true);
  view.browser.advance(1);
  assert.equal(view.overlay.hidden, false);
  assert.equal(view.overlay.dataset.mode, "runtime");
  assert.equal(view.overlay.dataset.state, "loading");
  assert.equal(view.overlay.getAttribute("aria-busy"), "true");
  assert.equal(view.progress.getAttribute("aria-valuenow"), null);
  assert.equal(view.progress.getAttribute("aria-valuetext"), "Importing image");
  assert.equal(view.label.textContent, "Importing image");
  assert.equal(view.overlay.style.getPropertyValue("--canvas-startup-progress"), "0.12");

  const inner = view.controller.beginRuntimeOperation("Preparing image layer");
  assert.equal(view.label.textContent, "Preparing image layer");
  inner.update("Publishing image layer");
  assert.equal(view.label.textContent, "Publishing image layer");
  inner.complete();
  assert.equal(view.label.textContent, "Importing image");
  assert.equal(view.overlay.hidden, false, "one completion cannot hide nested work");

  outer.complete();
  assert.equal(view.overlay.dataset.state, "finishing");
  assert.equal(view.overlay.getAttribute("aria-busy"), "false");
  assert.equal(view.progress.getAttribute("aria-valuenow"), "100");
  assert.equal(view.label.textContent, "Ready");
  view.browser.advance(100);
  const replacement = view.controller.beginRuntimeOperation("Loading brush");
  assert.equal(view.overlay.dataset.state, "loading");
  assert.equal(view.label.textContent, "Loading brush");
  view.browser.advance(1_000);
  assert.equal(view.overlay.hidden, false, "a stale completion timer cannot hide new work");
  replacement.complete();
  view.browser.advance(239);
  assert.equal(view.overlay.dataset.state, "finishing");
  view.browser.advance(1);
  assert.equal(view.overlay.dataset.state, "complete");
  view.browser.advance(180);
  assert.equal(view.overlay.hidden, true);
  assert.equal(view.overlay.getAttribute("aria-busy"), "false");
  assert.equal(view.application.inert, false);
  assert.equal(view.preservedInert.inert, true, "pre-existing inert state must be preserved");
}

{
  const view = fixture();
  const outer = view.controller.beginRuntimeOperation("Outer operation");
  view.browser.advance(120);
  const inner = view.controller.beginRuntimeOperation("Inner operation");
  inner.fail();
  assert.equal(view.overlay.hidden, false);
  outer.complete();
  assert.equal(
    view.label.textContent,
    "Loading stopped",
    "a nested failure must survive until the final operation settles",
  );
}

{
  const view = fixture();
  const loading = view.controller.beginRuntimeOperation("Fast operation");
  loading.complete();
  view.browser.advance(1_000);
  assert.equal(view.overlay.hidden, true, "sub-threshold work must stay visually silent");
  assert.equal(view.application.inert, false, "sub-threshold work must still release input");
}

{
  const view = fixture();
  const loading = view.controller.beginRuntimeOperation(
    "Creating layer",
    { completionPresentation: "immediate" },
  );
  view.browser.advance(120);
  assert.equal(view.overlay.hidden, false, "slow layer creation still needs progress feedback");
  assert.equal(view.application.inert, true, "the GPU fence must keep input blocked");
  loading.complete();
  assert.equal(
    view.overlay.hidden,
    true,
    "an immediate runtime completion must not add the standard 420 ms terminal delay",
  );
  assert.equal(view.overlay.dataset.mode, "idle");
  assert.equal(view.application.inert, false, "input is released only after completion");
}

{
  const view = fixture();
  const quick = view.controller.beginRuntimeOperation(
    "Quick mutation",
    { completionPresentation: "immediate" },
  );
  const standard = view.controller.beginRuntimeOperation("Long nested operation");
  view.browser.advance(120);
  quick.complete();
  standard.complete();
  assert.equal(
    view.overlay.dataset.state,
    "finishing",
    "a standard nested operation must retain the shared completion presentation",
  );
}

{
  const view = fixture();
  let rejectOperation;
  const pending = new Promise((_, reject) => {
    rejectOperation = reject;
  });
  const operation = view.controller.runRuntimeOperation("Loading source", () => pending);
  view.browser.advance(120);
  rejectOperation(new Error("injected failure"));
  await assert.rejects(operation, /injected failure/);
  assert.equal(view.overlay.dataset.state, "finishing");
  assert.equal(view.label.textContent, "Loading stopped");
  view.browser.advance(420);
  assert.equal(view.overlay.hidden, true);
  assert.equal(view.application.inert, false);
}

{
  const view = fixture();
  let operationStarted = false;
  const operation = view.controller.runRuntimeOperation(
    "Preparing text",
    async () => {
      operationStarted = true;
      assert.equal(
        view.overlay.hidden,
        false,
        "paint-gated work must start with visible loading feedback",
      );
      return "prepared";
    },
    { revealImmediately: true, waitForPaint: true },
  );

  assert.equal(view.overlay.hidden, false, "cold work must reveal feedback synchronously");
  assert.equal(view.overlay.dataset.mode, "runtime");
  assert.equal(view.label.textContent, "Preparing text");
  assert.equal(operationStarted, false, "cold work must wait for the first paint checkpoint");

  view.browser.flushAnimationFrame();
  await Promise.resolve();
  assert.equal(operationStarted, false, "one animation frame is not a paint guarantee");

  view.browser.flushAnimationFrame();
  await Promise.resolve();
  assert.equal(operationStarted, true, "work starts after the second animation frame");
  assert.equal(await operation, "prepared");
  assert.equal(view.overlay.dataset.state, "finishing");
  view.browser.advance(420);
  assert.equal(view.overlay.hidden, true);
  assert.equal(view.application.inert, false);
}

{
  const view = fixture();
  const loading = view.controller.beginRuntimeOperation(
    "Preparing resources",
    { revealImmediately: true },
  );
  assert.equal(view.overlay.hidden, false, "manual cold work can also skip the reveal delay");
  assert.equal(view.label.textContent, "Preparing resources");
  loading.complete();
}

{
  const view = fixture();
  const loading = view.controller.beginRuntimeOperation("Saving project");
  view.browser.advance(120);
  view.controller.reset();
  assert.equal(view.overlay.dataset.mode, "startup");
  view.controller.dismiss();
  assert.equal(view.overlay.dataset.mode, "runtime");
  assert.equal(view.label.textContent, "Saving project");
  assert.equal(view.application.inert, true);
  loading.complete();
  view.browser.advance(420);
  assert.equal(view.overlay.hidden, true);
  assert.equal(view.application.inert, false);
}

if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
else globalThis.HTMLElement = originalHTMLElement;

console.log("Shared runtime loading overlay: delayed and paint-gated reveal, nesting, failure, timer replacement and startup handoff verified.");
