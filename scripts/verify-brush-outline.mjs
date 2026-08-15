import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import {
  BRUSH_OUTLINE_ALPHA_THRESHOLD,
  BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS,
  brushOutlineBoundingExtentCssPixels,
  brushOutlineDiameterCssPixels,
  brushOutlineRotationRadians,
  buildBrushMaskOutline,
} from "../src/brush-outline-core.ts";
import { decodeGrayscalePng8 } from "../src/png-mask.ts";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");
const coreSource = read("src/brush-outline-core.ts");
const controllerSource = read("src/brush-outline-controller.ts");
const engineSource = read("src/brush-engine.ts");
const resourcesSource = read("src/engine-resource-setup.ts");
const mainSource = read("src/main.ts");
const htmlSource = read("index.html");
const styleSource = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const coordinates = (path) => Array.from(path, (value) => Number(value.toFixed(6)));
const assertClose = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};
const assertNormalized = (outline) => {
  for (const path of outline.paths) {
    assert.ok(path.length >= 6 && path.length % 2 === 0, "contorno chiuso non valido");
    for (const coordinate of path) {
      assert.ok(coordinate >= -0.5 && coordinate <= 0.5, "coordinate fuori dalla tip");
    }
  }
};

assert.equal(BRUSH_OUTLINE_ALPHA_THRESHOLD, 0,
  "Krita include ogni alpha non trasparente, anche 1/255");
assert.equal(BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS, 1,
  "outlineSizeMinimum di Krita usa 1 px come default");

const empty = buildBrushMaskOutline(new Uint8Array(4), 2, 2);
assert.equal(empty.edgeCount, 0);
assert.deepEqual(empty.paths, []);
assert.equal(empty.precise, true);

const single = buildBrushMaskOutline(Uint8Array.of(1), 1, 1);
assert.equal(single.edgeCount, 4);
assert.equal(single.paths.length, 1);
assert.deepEqual(coordinates(single.paths[0]), [
  -0.5, -0.5,
  0.5, -0.5,
  0.5, 0.5,
  -0.5, 0.5,
]);

const rectangle = buildBrushMaskOutline(new Uint8Array(15).fill(255), 5, 3);
assert.equal(rectangle.edgeCount, 16);
assert.equal(rectangle.paths.length, 1);
assert.equal(rectangle.paths[0].length, 8,
  "i tratti collineari devono essere semplificati senza spostare la frontiera");

const ring = buildBrushMaskOutline(Uint8Array.of(
  255, 255, 255,
  255, 0, 255,
  255, 255, 255,
), 3, 3);
assert.equal(ring.edgeCount, 16);
assert.equal(ring.paths.length, 1,
  "setSimpleOutline(true) di Krita omette il foro interno");
assertNormalized(ring);

const diagonal = buildBrushMaskOutline(Uint8Array.of(
  255, 0,
  0, 255,
), 2, 2);
assert.equal(diagonal.edgeCount, 8);
assert.equal(diagonal.paths.length, 1,
  "Krita collega il contatto diagonale in un subpath auto-toccante");
assert.equal(coordinates(diagonal.paths[0]).filter((value, index, values) =>
  index % 2 === 0 && value === 0 && values[index + 1] === 0).length, 2,
"il vertice diagonale condiviso deve essere attraversato due volte");

const checkerSize = 64;
const checker = new Uint8Array(checkerSize * checkerSize);
for (let y = 0; y < checkerSize; y += 1) {
  for (let x = 0; x < checkerSize; x += 1) {
    checker[y * checkerSize + x] = (x + y) % 2 === 0 ? 255 : 0;
  }
}
const highFrequency = buildBrushMaskOutline(checker, checkerSize, checkerSize);
assert.equal(highFrequency.precise, true,
  "anche una tip patologica deve restare esatta, senza max-pooling lossy");
assert.equal(highFrequency.edgeCount, 8192);
assertNormalized(highFrequency);
assert.throws(() => buildBrushMaskOutline(new Uint8Array(3), 2, 2), /dimensioni non valide/);

assert.equal(
  brushOutlineDiameterCssPixels(100, 2, 1000, 500, 2000, 1000),
  100,
  "diametro CSS deve includere zoom e rapporto backing-store/CSS",
);
assert.equal(brushOutlineDiameterCssPixels(-10, 1, 100, 100, 100, 100), 0);
assert.equal(brushOutlineRotationRadians(false, 0.75, -1.25), 0.75);
assert.equal(brushOutlineRotationRadians(true, 0.75, -1.25), -1.25);
assert.equal(brushOutlineRotationRadians(true, 0.75, null), 0.75);
assert.equal(brushOutlineBoundingExtentCssPixels(single, 10, 0), 20);
const halfWidthTip = buildBrushMaskOutline(Uint8Array.of(255, 0), 2, 1);
assert.equal(brushOutlineBoundingExtentCssPixels(halfWidthTip, 10, 0), 15);
assertClose(
  brushOutlineBoundingExtentCssPixels(halfWidthTip, 10, Math.PI / 4),
  15 * Math.SQRT2,
  1e-6,
);

// Fixed, real 2048x2048 assets guard both polarity and the exact topology.
for (const fixture of [
  { file: "Shape.png", authoredInvert: false, paths: 6, edges: 24596 },
  { file: "Shapepencil.png", authoredInvert: true, paths: 99, edges: 29312 },
]) {
  const bytes = readFileSync(new URL(fixture.file, root));
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoded = await decodeGrayscalePng8(source);
  if (fixture.authoredInvert) {
    for (let index = 0; index < decoded.pixels.length; index += 1) {
      decoded.pixels[index] = 255 - decoded.pixels[index];
    }
  }
  const outline = buildBrushMaskOutline(decoded.pixels, decoded.width, decoded.height);
  assert.equal(outline.paths.length, fixture.paths, `${fixture.file}: topologia inattesa`);
  assert.equal(outline.edgeCount, fixture.edges, `${fixture.file}: frontiera alpha spostata`);
  assert.equal(outline.precise, true);
}

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let BrushOutlineController;
let snapBrushOutlineCssCoordinate;
try {
  ({ BrushOutlineController, snapBrushOutlineCssCoordinate } = await moduleServer.ssrLoadModule(
    "/src/brush-outline-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

class FakeClassList {
  values = new Set();
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakePath2D {
  commands = [];
  moveTo(...values) { this.commands.push(["moveTo", ...values]); }
  lineTo(...values) { this.commands.push(["lineTo", ...values]); }
  closePath() { this.commands.push(["closePath"]); }
  ellipse(...values) { this.commands.push(["ellipse", ...values]); }
}

class FakeContext {
  lineCap = "butt";
  lineJoin = "miter";
  lineWidth = 1;
  strokeStyle = "";
  strokes = [];
  clears = [];
  currentTranslation = null;
  currentRotation = 0;
  currentScale = null;

  save() {}
  restore() {}
  setTransform() {
    this.currentTranslation = null;
    this.currentRotation = 0;
    this.currentScale = null;
  }
  clearRect(...values) { this.clears.push(values); }
  translate(...values) { this.currentTranslation = values; }
  rotate(value) { this.currentRotation = value; }
  scale(...values) { this.currentScale = values; }
  setLineDash() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke(path) {
    this.strokes.push({
      path,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      lineWidth: this.lineWidth,
      strokeStyle: this.strokeStyle,
      translation: this.currentTranslation,
      rotation: this.currentRotation,
      scale: this.currentScale,
    });
  }
}

class FakeCanvas extends EventTarget {
  width = 0;
  height = 0;
  hidden = false;
  dataset = {};
  classList = new FakeClassList();

  constructor(context = null) {
    super();
    this.context = context;
  }

  getContext() { return this.context; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 };
  }
}

class FakeResizeObserver {
  disconnected = false;
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() { this.disconnected = true; }
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  Path2D = FakePath2D;
  ResizeObserver = FakeResizeObserver;
  devicePixelRatio = 2;
  nextFrame = 1;
  frames = new Map();

  requestAnimationFrame(callback) {
    const id = this.nextFrame;
    this.nextFrame += 1;
    this.frames.set(id, callback);
    return id;
  }
  cancelAnimationFrame(id) { this.frames.delete(id); }
  flushFrames() {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(0);
  }
}

function pointerEvent(type, clientX, clientY, pointerType = "mouse") {
  const event = new Event(type);
  for (const [name, value] of Object.entries({ clientX, clientY, pointerType })) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

assert.equal(snapBrushOutlineCssCoordinate(10.26, 1), 10);
assert.equal(snapBrushOutlineCssCoordinate(10.26, 1.25), 10.4);
assert.equal(snapBrushOutlineCssCoordinate(10.26, 2), 10.5);

const browser = new FakeBrowser();
const context = new FakeContext();
const canvas = new FakeCanvas();
const overlay = new FakeCanvas(context);
let activeTool = "paint";
let snapshot = {
  kind: "circle",
  outline: null,
  diameterCssPixels: 10,
  viewRotationRadians: 0,
  followsStroke: false,
};
const controller = new BrushOutlineController({
  browser,
  canvas,
  overlay,
  engine: { getBrushOutlineSnapshot: () => snapshot },
  getActiveTool: () => activeTool,
});

canvas.dispatchEvent(pointerEvent("pointerenter", 10.26, 20.26));
browser.flushFrames();
assert.equal(overlay.hidden, false);
assert.equal(canvas.classList.contains("brush-outline-active"), true);
assert.equal(overlay.dataset.brushOutlineKind, "circle");
assert.equal(context.strokes.length, 1);
assert.deepEqual(context.strokes[0].translation, [10.5, 20.5], "snap alla griglia DPR 2");
assert.deepEqual(context.strokes[0].scale, [10, 10]);
assert.equal(context.strokes[0].lineWidth, 0.05, "una sola linea da un pixel fisico");
assert.equal(context.strokes[0].strokeStyle, "rgb(255 255 255)");

snapshot = { ...snapshot, diameterCssPixels: 0.49 };
controller.notifyEngineUpdate();
browser.flushFrames();
assert.deepEqual(context.strokes.at(-1).scale, [1, 1],
  "bbox sum appena sotto 1 deve usare il cerchio minimo da 1 px");
snapshot = { ...snapshot, diameterCssPixels: 0.5 };
controller.notifyEngineUpdate();
browser.flushFrames();
assert.deepEqual(context.strokes.at(-1).scale, [0.5, 0.5],
  "la soglia minima di Krita e stretta, non inclusiva");

snapshot = {
  kind: "shape",
  outline: halfWidthTip,
  diameterCssPixels: 100,
  viewRotationRadians: 0,
  followsStroke: false,
};
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(overlay.dataset.brushOutlineKind, "shape-alpha");
const strokesBeforeOversize = context.strokes.length;
snapshot = { ...snapshot, viewRotationRadians: Math.PI / 4 };
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(overlay.dataset.brushOutlineKind, "oversized-with-center");
assert.equal(context.strokes.length, strokesBeforeOversize + 2,
  "Krita mantiene il contorno oversize e aggiunge la croce centrale");
assert.deepEqual(context.strokes.at(-2).scale, [100, 100], "contorno originale preservato");
assert.equal(context.strokes.at(-1).scale, null, "seconda stroke riservata alla croce");

const strokesBeforeEmpty = context.strokes.length;
snapshot = {
  kind: "shape",
  outline: empty,
  diameterCssPixels: 100,
  viewRotationRadians: 0,
  followsStroke: false,
};
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(overlay.hidden, true, "alpha vuoto non deve produrre decorazioni");
assert.equal(canvas.classList.contains("brush-outline-active"), false,
  "con alpha vuoto il cursore nativo deve restare disponibile");
assert.equal(context.strokes.length, strokesBeforeEmpty);

snapshot = {
  kind: "shape",
  outline: single,
  diameterCssPixels: 10,
  viewRotationRadians: 0,
  followsStroke: true,
};
canvas.dispatchEvent(pointerEvent("pointermove", 10.26, 30.26));
browser.flushFrames();
assertClose(context.strokes.at(-1).rotation, Math.PI / 2, 1e-12);
activeTool = "fill";
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(overlay.hidden, true, "l'outline deve sparire fuori dai tool brush");
controller.dispose();

const polarityIndex = resourcesSource.indexOf(
  "if (!polarityAlreadyApplied && authoredInvert !== shapeInvert)",
);
const boundaryIndex = resourcesSource.indexOf("buildBrushMaskOutline(baseMask");
const uploadIndex = resourcesSource.indexOf("engine.device.createTexture", boundaryIndex);
assert.ok(polarityIndex >= 0 && boundaryIndex > polarityIndex && uploadIndex > boundaryIndex,
  "outline e texture WebGPU devono usare la stessa maschera post-polarita");
assert.match(engineSource, /getBrushOutlineSnapshot\(\): BrushOutlineSnapshot/);
assert.match(engineSource, /this\.shapeLoadedAssetId === shapeAssetIdForSettings\(this\.settings\)/);
assert.match(engineSource, /this\.shapeLoadedInvert === shapeInvertForSettings\(this\.settings\)/);
assert.doesNotMatch(coreSource, /maxPool|FALLBACK_MAX|MAX_PRECISE/,
  "la frontiera non deve avere un percorso lossy diverso da Krita");
assert.doesNotMatch(controllerSource, /getImageData|buildBrushMaskOutline|requestPointerLock/,
  "il puntatore deve riusare il Path2D in cache senza rileggere l'alpha");
assert.doesNotMatch(coreSource, /document|window|HTMLCanvasElement|CanvasRenderingContext2D/,
  "l'estrazione della frontiera deve restare indipendente dal DOM");

assert.match(mainSource, /new BrushOutlineController\(\{[\s\S]*?overlay: brushOutlineCanvas/);
assert.match(mainSource, /brushOutlineController\?\.dispose\(\)/);
assert.match(htmlSource, /<canvas id="brushOutlineCanvas" aria-hidden="true" hidden><\/canvas>/);
assert.match(styleSource, /#brushOutlineCanvas \{[\s\S]*?pointer-events: none/);
assert.match(styleSource, /#brushOutlineCanvas \{[\s\S]*?mix-blend-mode: difference/);
assert.match(styleSource, /#gpuCanvas\.brush-outline-active \{\s*cursor: none/);
assert.equal(packageJson.scripts["brush-outline:verify"], "node scripts/verify-brush-outline.mjs");

console.log("Brush outline verificato: topologia Krita, asset reali, controller, DPR e oversize.");
