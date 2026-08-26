import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const inputSource = readFileSync(new URL("src/canvas-input-controller.ts", root), "utf8");

assert.match(html, /data-mobile-canvas-tool="shapes"[\s\S]*?data-lucide="shapes"[\s\S]*?>Shapes</);
assert.match(html, /id="shapeToolDock"[\s\S]*?data-shape-kind="rectangle"[\s\S]*?data-shape-kind="ellipse"[\s\S]*?data-shape-kind="star"/);
assert.match(html, /id="shapeCreationCanvas"/);
assert.match(mainSource, /shapeToolController = new ShapeToolController\(\{/);
assert.match(mainSource, /shapeToolController\?\.setActive\(tool === "shapes"\)/);
assert.match(mainSource, /getShapeController: \(\) => shapeToolController/);
assert.match(inputSource, /pointerMode === "shape"[\s\S]*?addPointer\(/,
  "a second touch must route to the shape modifier instead of view navigation");
assert.match(inputSource, /completedPointerMode === "shape"[\s\S]*?activeTouchContacts\.clear\(\)/,
  "finishing the drawing touch must release modifier contacts");

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let ShapeToolController;
try {
  ({ ShapeToolController } = await moduleServer.ssrLoadModule(
    "/src/shape-tool-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

class FakeElement extends EventTarget {
  hidden = false;
  inert = false;
  disabled = false;
  tabIndex = 0;
  value = "";
  dataset = {};
  attributes = new Map();

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

class FakeContext {
  clearCount = 0;
  fillCount = 0;
  fillStates = [];
  strokeCount = 0;
  globalAlpha = 1;
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;

  clearRect() { this.clearCount += 1; }
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  ellipse() {}
  setLineDash() {}
  fill() {
    this.fillCount += 1;
    this.fillStates.push({
      globalAlpha: this.globalAlpha,
      fillStyle: this.fillStyle,
    });
  }
  stroke() { this.strokeCount += 1; }
}

class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;
  context = new FakeContext();

  getContext() {
    return this.context;
  }
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  performance = { now: () => 100 };
}

function pointer(pointerId, pointerType, clientX, clientY, constrainAspect) {
  return {
    pointerId,
    pointerType,
    clientX,
    clientY,
    ...(constrainAspect === undefined ? {} : { constrainAspect }),
  };
}

function createHarness() {
  const browser = new FakeBrowser();
  const overlay = new FakeCanvas();
  const dock = new FakeElement();
  const rectangle = new FakeElement();
  rectangle.dataset.shapeKind = "rectangle";
  const ellipse = new FakeElement();
  ellipse.dataset.shapeKind = "ellipse";
  const star = new FakeElement();
  star.dataset.shapeKind = "star";
  const fillColor = new FakeElement();
  const status = new FakeElement();
  const additions = [];
  const engine = {
    getVectorTextViewState: () => ({
      canvasWidth: 1000,
      canvasHeight: 800,
      cssWidth: 500,
      cssHeight: 400,
      centerX: 0,
      centerY: 0,
      zoom: 1,
      rotationRadians: 0,
      rotationCos: 1,
      rotationSin: 0,
    }),
    toLayerPoint: (sample) => ({ x: sample.clientX, y: sample.clientY }),
    async addVectorSvgNode(seed, name) {
      additions.push({ seed, name });
      return { id: additions.length, kind: "svg", name, ...seed };
    },
  };
  const controller = new ShapeToolController({
    browser,
    engine,
    elements: {
      overlay,
      dock,
      kindButtons: [rectangle, ellipse, star],
      fillColor,
      status,
    },
    initialColor: "#345678",
  });
  controller.setActive(true);
  return {
    additions,
    controller,
    ellipse,
    fillColor,
    overlay,
    rectangle,
    star,
    status,
  };
}

// One touch grows symmetrically from its fixed center; touch two changes only
// the aspect policy and lifting it restores the centered free rectangle before
// the single release-time commit.
{
  const harness = createHarness();
  assert.equal(harness.controller.beginPointer(pointer(1, "touch", 10, 20)), true);
  harness.controller.updatePointer(pointer(1, "touch", 90, 60));
  assert.match(harness.status.value, /160 × 80 · centered · free/);
  assert.equal(harness.controller.addPointer(pointer(2, "touch", -900, 700)), true);
  assert.match(harness.status.value, /160 × 160 · centered · 1:1 by second finger/);
  await harness.controller.endPointer(pointer(2, "touch", 300, -400), true);
  assert.match(harness.status.value, /160 × 80 · centered · free/);
  assert.equal(await harness.controller.endPointer(pointer(1, "touch", 90, 60), true), true);
  assert.equal(harness.additions.length, 1);
  assert.equal(harness.additions[0].name, "Rectangle");
  assert.equal(harness.additions[0].seed.shapeDefinition.kind, "rectangle");
  assert.deepEqual(
    [harness.additions[0].seed.shapeDefinition.width, harness.additions[0].seed.shapeDefinition.height],
    [160, 80],
  );
  assert.equal(harness.additions[0].seed.paintColors[0], "#345678");
  assert.deepEqual(
    [harness.additions[0].seed.x, harness.additions[0].seed.y],
    [10, 20],
  );
  assert.ok(harness.overlay.context.fillCount > 0);
  assert.deepEqual(harness.overlay.context.fillStates.at(-1), {
    globalAlpha: 1,
    fillStyle: "#345678",
  });
  assert.equal(harness.overlay.context.strokeCount, 0);
  harness.controller.dispose();
}

// Releasing while the second touch remains produces a circle; the second
// contact position never enters the geometry.
{
  const harness = createHarness();
  harness.ellipse.dispatchEvent(new Event("click"));
  harness.controller.beginPointer(pointer(5, "touch", 100, 100));
  harness.controller.updatePointer(pointer(5, "touch", 180, 140));
  harness.controller.addPointer(pointer(6, "touch", 9_000, -9_000));
  assert.equal(await harness.controller.endPointer(pointer(5, "touch", 180, 140), true), true);
  assert.equal(harness.additions[0].name, "Circle");
  assert.deepEqual(
    [harness.additions[0].seed.shapeDefinition.width, harness.additions[0].seed.shapeDefinition.height],
    [160, 160],
  );
  assert.deepEqual(
    [harness.additions[0].seed.x, harness.additions[0].seed.y],
    [100, 100],
  );
  harness.controller.dispose();
}

// Stars are intrinsically proportional, while a canceled draft never enters
// the scene or History.
{
  const harness = createHarness();
  harness.star.dispatchEvent(new Event("click"));
  harness.controller.beginPointer(pointer(9, "mouse", 0, 0));
  harness.controller.updatePointer(pointer(9, "mouse", 70, 30));
  assert.match(harness.status.value, /140 × 140 · centered · proportional/);
  await harness.controller.endPointer(pointer(9, "mouse", 70, 30), false);
  assert.equal(harness.additions.length, 0);
  harness.controller.dispose();
}

// Desktop 1:1 keeps the same fixed-center geometry and commits one square.
{
  const harness = createHarness();
  harness.controller.beginPointer(pointer(15, "mouse", 100, 100, true));
  harness.controller.updatePointer(pointer(15, "mouse", 180, 140, true));
  assert.match(harness.status.value, /160 × 160 · centered · 1:1/);
  assert.equal(await harness.controller.endPointer(
    pointer(15, "mouse", 180, 140, true),
    true,
  ), true);
  assert.equal(harness.additions[0].name, "Square");
  assert.deepEqual(
    [harness.additions[0].seed.shapeDefinition.width, harness.additions[0].seed.shapeDefinition.height],
    [160, 160],
  );
  assert.deepEqual(
    [harness.additions[0].seed.x, harness.additions[0].seed.y],
    [100, 100],
  );
  harness.controller.dispose();
}

console.log(
  "Shape tool controller: unified picker, fixed-center drag, two-touch 1:1 modifier and one release-time vector commit verified.",
);
