import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const inputSource = readFileSync(new URL("src/canvas-input-controller.ts", root), "utf8");
const controllerSource = readFileSync(new URL("src/shape-tool-controller.ts", root), "utf8");
const engineSource = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const tileSource = readFileSync(new URL("src/engine-layer-blend-tile-runtime.ts", root), "utf8");
const compositorSource = readFileSync(new URL("src/engine-vector-text-runtime.ts", root), "utf8");

assert.match(html, /data-mobile-canvas-tool="shapes"[\s\S]*?data-lucide="shapes"[\s\S]*?>Shapes</);
assert.match(html, /id="shapeToolDock"[\s\S]*?data-shape-kind="rectangle"[\s\S]*?data-shape-kind="ellipse"[\s\S]*?data-shape-kind="star"/);
assert.doesNotMatch(html, /id="shapeCreationCanvas"/);
assert.match(mainSource, /shapeToolController = new ShapeToolController\(\{/);
assert.match(mainSource, /shapeToolController\?\.setActive\(tool === "shapes"\)/);
assert.match(mainSource, /getShapeController: \(\) => shapeToolController/);
assert.doesNotMatch(controllerSource, /getContext\(|CanvasRenderingContext2D|\.fill\(\)/,
  "the live draft must not bypass layer order through a DOM canvas");
assert.match(controllerSource, /updateShapePreview\(\{/,
  "pointer updates must feed the persistent GPU preview resource");
assert.match(engineSource, /shapePreviewAfterKey !== null[\s\S]*?visibleSemanticCount/,
  "a raster-only document must enter ordered presentation while the preview is prepared");
assert.match(tileSource, /shapePreviewAfterKey === null/,
  "the raster-only tile path cannot bypass the inserted preview slot");
assert.match(compositorSource, /segment\.kind === "shape-preview"[\s\S]*?mixedSceneShapePreviewPipeline/,
  "the preview segment must be encoded inside the ordered WebGPU compositor");
const liveUpdateBody = engineSource.match(
  /updateShapePreview\([\s\S]*?\n  private async changeShapePreviewPlacement/,
)?.[0] ?? "";
assert.match(liveUpdateBody, /queue\.writeBuffer/,
  "live pointer updates must upload only the persistent preview uniforms");
assert.match(liveUpdateBody, /semanticPresentationDirtyRect/,
  "live pointer updates must invalidate only their affected presentation region");
assert.doesNotMatch(liveUpdateBody, /waitForIdle|rebuildMergedLayerSurfaces|createBuffer|createTexture/,
  "pointer movement must not synchronize, rebuild the stack or allocate GPU resources");
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

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  performance = { now: () => 100 };
  requestAnimationFrame(callback) {
    queueMicrotask(() => callback(116));
    return 1;
  }
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

async function createHarness({ deferPreparation = false, awaitActivation = true } = {}) {
  const browser = new FakeBrowser();
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
  const previewUpdates = [];
  let preparations = 0;
  let releases = 0;
  let releasePreparation = () => {};
  const preparationBarrier = deferPreparation
    ? new Promise((resolve) => { releasePreparation = resolve; })
    : Promise.resolve();
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
    async prepareShapePreviewPresentation() {
      preparations += 1;
      await preparationBarrier;
    },
    async releaseShapePreviewPresentation() {
      releases += 1;
    },
    updateShapePreview(preview) {
      if (preview && (preview.width <= 0 || preview.height <= 0)) {
        throw new RangeError("Shape preview bounds must be greater than zero.");
      }
      previewUpdates.push(preview ? { ...preview } : null);
      return true;
    },
  };
  const controller = new ShapeToolController({
    browser,
    engine,
    elements: {
      dock,
      kindButtons: [rectangle, ellipse, star],
      fillColor,
      status,
    },
    initialColor: "#345678",
  });
  const activation = controller.setActive(true);
  if (awaitActivation) await activation;
  return {
    activation,
    additions,
    controller,
    ellipse,
    fillColor,
    get preparations() { return preparations; },
    get releases() { return releases; },
    previewUpdates,
    releasePreparation,
    rectangle,
    star,
    status,
  };
}

// Touch may begin and even finish before the ordered preview transaction is
// ready. The zero-area pointerdown stays valid, movement is retained, and the
// single SVG commit waits for preparation instead of losing the gesture.
{
  const harness = await createHarness({ deferPreparation: true, awaitActivation: false });
  assert.equal(harness.controller.isPresentationPreparing, true);
  assert.equal(harness.controller.beginPointer(pointer(41, "touch", 20, 30)), true);
  assert.equal(harness.previewUpdates.at(-1), null);
  harness.controller.updatePointer(pointer(41, "touch", 90, 70));
  const completion = harness.controller.endPointer(pointer(41, "touch", 90, 70), true);
  assert.equal(harness.additions.length, 0);
  harness.releasePreparation();
  await harness.activation;
  assert.equal(await completion, true);
  assert.equal(harness.additions.length, 1);
  assert.equal(harness.additions[0].name, "Rectangle");
  assert.deepEqual(
    [harness.additions[0].seed.shapeDefinition.width, harness.additions[0].seed.shapeDefinition.height],
    [140, 80],
  );
  harness.controller.dispose();
}

// One touch grows symmetrically from its fixed center; touch two changes only
// the aspect policy and lifting it restores the centered free rectangle before
// the single release-time commit.
{
  const harness = await createHarness();
  assert.equal(harness.preparations, 1);
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
  assert.deepEqual(harness.previewUpdates.findLast((preview) => preview !== null), {
    kind: "rectangle",
    x: -70,
    y: -20,
    width: 160,
    height: 80,
    color: "#345678",
  });
  assert.equal(harness.previewUpdates.at(-1), null);
  await harness.controller.setActive(false);
  assert.equal(harness.releases, 1);
  harness.controller.dispose();
}

// Releasing while the second touch remains produces a circle; the second
// contact position never enters the geometry.
{
  const harness = await createHarness();
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
  await harness.controller.setActive(false);
  harness.controller.dispose();
}

// Stars are intrinsically proportional, while a canceled draft never enters
// the scene or History.
{
  const harness = await createHarness();
  harness.star.dispatchEvent(new Event("click"));
  harness.controller.beginPointer(pointer(9, "mouse", 0, 0));
  harness.controller.updatePointer(pointer(9, "mouse", 70, 30));
  assert.match(harness.status.value, /140 × 140 · centered · proportional/);
  await harness.controller.endPointer(pointer(9, "mouse", 70, 30), false);
  assert.equal(harness.additions.length, 0);
  assert.equal(harness.previewUpdates.at(-1), null);
  await harness.controller.setActive(false);
  harness.controller.dispose();
}

// Desktop 1:1 keeps the same fixed-center geometry and commits one square.
{
  const harness = await createHarness();
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
  await harness.controller.setActive(false);
  harness.controller.dispose();
}

console.log(
  "Shape tool controller: ordered GPU preview lifecycle, fixed-center drag, two-touch modifier and one release-time commit verified.",
);
