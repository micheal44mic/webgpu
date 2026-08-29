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
const registrySource = read("src/gpu-resource-registry.ts");
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

assert.equal(BRUSH_OUTLINE_ALPHA_THRESHOLD, 8,
  "la preview deve ignorare copertura quasi trasparente senza cambiare la maschera paint");
assert.equal(BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS, 1,
  "the minimum outline size uses a 1 px default");

const empty = buildBrushMaskOutline(new Uint8Array(4), 2, 2);
assert.equal(empty.edgeCount, 0);
assert.deepEqual(empty.paths, []);
assert.deepEqual(Array.from(empty.boundingHull), []);
assert.equal(empty.precise, true);
const effectivelyTransparent = buildBrushMaskOutline(
  new Uint8Array(9).fill(BRUSH_OUTLINE_ALPHA_THRESHOLD),
  3,
  3,
);
assert.equal(effectivelyTransparent.edgeCount, 0);
assert.deepEqual(effectivelyTransparent.paths, []);

const transparentNoise = buildBrushMaskOutline(
  Uint8Array.of(
    1, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 255, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, BRUSH_OUTLINE_ALPHA_THRESHOLD,
  ),
  5,
  5,
);
assert.equal(transparentNoise.paths.length, 1,
  "pixel quasi trasparenti lontani non devono creare contorni fantasma");
assert.deepEqual(coordinates(transparentNoise.boundingHull), [
  -0.1, -0.1,
  0.1, -0.1,
  0.1, 0.1,
  -0.1, 0.1,
]);

const single = buildBrushMaskOutline(Uint8Array.of(255), 1, 1);
assert.equal(single.edgeCount, 4);
assert.equal(single.paths.length, 1);
assert.deepEqual(coordinates(single.paths[0]), [
  -0.5, -0.5,
  0.5, -0.5,
  0.5, 0.5,
  -0.5, 0.5,
]);
assert.deepEqual(coordinates(single.boundingHull), [
  -0.5, -0.5,
  0.5, -0.5,
  0.5, 0.5,
  -0.5, 0.5,
]);
const thresholdBoundary = buildBrushMaskOutline(Uint8Array.of(
  BRUSH_OUTLINE_ALPHA_THRESHOLD,
  BRUSH_OUTLINE_ALPHA_THRESHOLD + 1,
), 2, 1);
assert.equal(thresholdBoundary.paths.length, 1);
assert.deepEqual(coordinates(thresholdBoundary.boundingHull), [
  0, -0.5,
  0.5, -0.5,
  0.5, 0.5,
  0, 0.5,
], "la soglia e esclusiva: 8 e invisibile, 9 entra nel contorno");

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
  "simple outline mode omits the inner hole");
assertNormalized(ring);

const diagonal = buildBrushMaskOutline(Uint8Array.of(
  255, 0,
  0, 255,
), 2, 2);
assert.equal(diagonal.edgeCount, 8);
assert.equal(diagonal.paths.length, 1,
  "diagonal contact joins into a self-touching subpath");
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
assert.throws(() => buildBrushMaskOutline(new Uint8Array(3), 2, 2), /invalid dimensions/);

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
  { file: "Shape.png", authoredInvert: false, paths: 6, edges: 24584 },
  { file: "Shapepencil.png", authoredInvert: true, paths: 99, edges: 29376 },
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
let compileBrushOutlineSegments;
let snapBrushOutlineCssCoordinate;
try {
  ({
    BrushOutlineController,
    compileBrushOutlineSegments,
    snapBrushOutlineCssCoordinate,
  } = await moduleServer.ssrLoadModule("/src/brush-outline-controller.ts"));
} finally {
  await moduleServer.close();
}

class FakeClassList {
  values = new Set();
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

globalThis.GPUBufferUsage = { VERTEX: 1, COPY_DST: 2, UNIFORM: 4 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 8 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };

class FakeGpuBuffer {
  destroyed = false;
  constructor(descriptor) {
    this.label = descriptor.label;
    this.descriptor = descriptor;
  }
  destroy() { this.destroyed = true; }
}

class FakeRenderPass {
  draws = [];
  bindGroups = [];
  vertexBuffers = [];
  ended = false;
  constructor(descriptor) { this.descriptor = descriptor; }
  setPipeline(pipeline) { this.pipeline = pipeline; }
  setBindGroup(index, bindGroup) { this.bindGroups.push([index, bindGroup]); }
  setVertexBuffer(slot, buffer) { this.vertexBuffers.push([slot, buffer]); }
  draw(...values) { this.draws.push(values); }
  end() { this.ended = true; }
}

class FakeCommandEncoder {
  constructor(device, descriptor) {
    this.device = device;
    this.descriptor = descriptor;
  }
  beginRenderPass(descriptor) {
    const pass = new FakeRenderPass(descriptor);
    this.device.renderPasses.push(pass);
    return pass;
  }
  finish() { return { encoder: this }; }
}

class FakeGpuDevice {
  buffers = [];
  renderPasses = [];
  pipelineDescriptors = [];
  queue = {
    writes: [],
    submissions: [],
    writeBuffer: (buffer, offset, data) => {
      const copy = data instanceof Float32Array
        ? Float32Array.from(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
      this.queue.writes.push({ buffer, offset, data: copy });
    },
    submit: (commands) => { this.queue.submissions.push(commands); },
  };

  createBuffer(descriptor) {
    const buffer = new FakeGpuBuffer(descriptor);
    this.buffers.push(buffer);
    return buffer;
  }
  createShaderModule(descriptor) { return { descriptor }; }
  createBindGroupLayout(descriptor) { return { descriptor }; }
  createPipelineLayout(descriptor) { return { descriptor }; }
  createRenderPipeline(descriptor) {
    this.pipelineDescriptors.push(descriptor);
    return { descriptor };
  }
  createBindGroup(descriptor) { return { descriptor }; }
  createCommandEncoder(descriptor) { return new FakeCommandEncoder(this, descriptor); }
}

class FakeGpuContext {
  configureCalls = [];
  unconfigureCalls = 0;
  configure(descriptor) { this.configureCalls.push(descriptor); }
  unconfigure() { this.unconfigureCalls += 1; }
  getCurrentTexture() { return { createView: () => ({ textureView: true }) }; }
}

class FakeCanvas extends EventTarget {
  width = 0;
  height = 0;
  hidden = false;
  dataset = {};
  classList = new FakeClassList();
  requestedContexts = [];

  constructor(context = null) {
    super();
    this.context = context;
  }

  getContext(kind) {
    this.requestedContexts.push(kind);
    return kind === "webgpu" ? this.context : null;
  }
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
  ResizeObserver = FakeResizeObserver;
  devicePixelRatio = 2;
  nextFrame = 1;
  frames = new Map();
  nextTimer = 1;
  timers = new Map();
  currentTime = 0;

  requestAnimationFrame(callback) {
    const id = this.nextFrame;
    this.nextFrame += 1;
    this.frames.set(id, callback);
    return id;
  }
  cancelAnimationFrame(id) { this.frames.delete(id); }
  setTimeout(callback, delay = 0) {
    const id = this.nextTimer;
    this.nextTimer += 1;
    this.timers.set(id, { callback, dueAt: this.currentTime + delay });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  flushFrames() {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(0);
  }
  advanceTimersBy(milliseconds) {
    this.currentTime += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueAt <= this.currentTime);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

function pointerEvent(type, clientX, clientY, pointerType = "mouse", button = 0) {
  const event = new Event(type);
  for (const [name, value] of Object.entries({ clientX, clientY, pointerType, button })) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

assert.equal(snapBrushOutlineCssCoordinate(10.26, 1), 10);
assert.equal(snapBrushOutlineCssCoordinate(10.26, 1.25), 10.4);
assert.equal(snapBrushOutlineCssCoordinate(10.26, 2), 10.5);
assert.deepEqual(Array.from(compileBrushOutlineSegments(single)), [
  -0.5, -0.5, 0.5, -0.5,
  0.5, -0.5, 0.5, 0.5,
  0.5, 0.5, -0.5, 0.5,
  -0.5, 0.5, -0.5, -0.5,
], "il buffer GPU deve chiudere esattamente la frontiera alpha");

const browser = new FakeBrowser();
const device = new FakeGpuDevice();
const context = new FakeGpuContext();
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
  engine: {
    getBrushOutlineSnapshot: () => snapshot,
    getBrushOutlineGpuTarget: () => ({ device, format: "bgra8unorm" }),
  },
  getActiveTool: () => activeTool,
});

const lastUniform = (label) => device.queue.writes
  .filter((write) => write.buffer.label === label)
  .at(-1)?.data;
const alphaBoundaryUploads = () => device.queue.writes
  .filter((write) => write.buffer.label === "Brush outline · cached alpha boundary");

canvas.dispatchEvent(pointerEvent("pointerenter", 10.26, 20.26));
browser.flushFrames();
assert.equal(overlay.hidden, false);
assert.equal(canvas.classList.contains("brush-outline-active"), true);
assert.equal(overlay.dataset.brushOutlineKind, "circle");
assert.deepEqual(overlay.requestedContexts, ["webgpu"], "nessun contesto Canvas2D");
assert.equal(context.configureCalls.length, 1);
assert.equal(context.configureCalls[0].alphaMode, "premultiplied");
assert.equal(device.renderPasses.length, 1);
assert.deepEqual(device.renderPasses[0].draws, [[4, 256]]);
assert.deepEqual(Array.from(lastUniform("Brush outline · brush uniforms")), [
  21, 41, 20, 1, 200, 160, 1, 0,
], "centro, diametro e linea fisica devono essere uniformi GPU DPR-aware");
assert.equal(overlay.dataset.brushOutlineRenderer, "webgpu-shape-alpha-boundary");
assert.equal(device.pipelineDescriptors[0].vertex.buffers[0].stepMode, "instance",
  "un quad GPU istanziato per segmento, senza tessellazione per movimento");
assert.equal(device.pipelineDescriptors[0].fragment.targets[0].blend.alpha.operation, "max",
  "segmenti sovrapposti devono formare l'unione del tratto senza ispessirsi");

snapshot = { ...snapshot, diameterCssPixels: 0.49 };
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(lastUniform("Brush outline · brush uniforms")[2], 2,
  "bbox sum appena sotto 1 deve usare il cerchio minimo da 1 px");
snapshot = { ...snapshot, diameterCssPixels: 0.5 };
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(lastUniform("Brush outline · brush uniforms")[2], 1,
  "the minimum threshold is strict, not inclusive");

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
assert.equal(alphaBoundaryUploads().length, 1, "frontiera caricata sulla GPU una volta");
const shapeBuffer = alphaBoundaryUploads()[0].buffer;
const passesBeforeOversize = device.renderPasses.length;
snapshot = { ...snapshot, viewRotationRadians: Math.PI / 4 };
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(overlay.dataset.brushOutlineKind, "oversized-with-center");
assert.equal(device.renderPasses.length, passesBeforeOversize + 1);
assert.equal(device.renderPasses.at(-1).draws.length, 2,
  "the oversized outline remains visible and adds the center cross");
assert.deepEqual(device.renderPasses.at(-1).draws[1], [4, 2],
  "la seconda draw GPU e la croce centrale");
assert.equal(alphaBoundaryUploads().length, 1,
  "rotazione e oversize devono riusare lo stesso buffer alpha");
assert.equal(shapeBuffer.destroyed, false);
assert.equal(lastUniform("Brush outline · center mark uniforms")[2], 28,
  "la croce resta 14 CSS px anche a DPR 2");

const passesBeforeEmpty = device.renderPasses.length;
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
assert.equal(device.renderPasses.length, passesBeforeEmpty);
assert.equal(shapeBuffer.destroyed, true,
  "una shape non piu attiva deve liberare subito il proprio buffer GPU");

snapshot = {
  kind: "shape",
  outline: single,
  diameterCssPixels: 10,
  viewRotationRadians: 0,
  followsStroke: true,
};
canvas.dispatchEvent(pointerEvent("pointerleave", 10.26, 20.26, "pen"));
canvas.dispatchEvent(pointerEvent("pointerenter", 10.26, 20.26, "pen"));
browser.flushFrames();
canvas.dispatchEvent(pointerEvent("pointermove", 10.26, 30.26, "pen"));
browser.flushFrames();
assertClose(lastUniform("Brush outline · brush uniforms")[6], 0, 1e-6);
assertClose(lastUniform("Brush outline · brush uniforms")[7], 1, 1e-6);
assert.equal(overlay.hidden, false, "Apple Pencil deve usare il percorso pointerType pen");

const submissionsBeforeTouch = device.queue.submissions.length;
canvas.dispatchEvent(pointerEvent("pointerenter", 20, 20, "touch"));
browser.flushFrames();
assert.equal(overlay.hidden, true, "il touch non deve mostrare un cursore sospeso");
assert.equal(device.queue.submissions.length, submissionsBeforeTouch);

canvas.dispatchEvent(pointerEvent("pointerenter", 10, 20, "pen"));
browser.flushFrames();
canvas.dispatchEvent(pointerEvent("pointerdown", 10, 20, "pen", 0));
browser.flushFrames();
assert.equal(overlay.hidden, false, "il tratto conserva il riferimento nei primi millisecondi");
browser.advanceTimersBy(399);
assert.equal(overlay.hidden, false, "la preview deve restare visibile per tutti i 400 ms");
browser.advanceTimersBy(1);
assert.equal(overlay.hidden, true, "durante il tratto la preview deve sparire dopo 400 ms");
const submissionsWhileSuppressed = device.queue.submissions.length;
canvas.dispatchEvent(pointerEvent("pointermove", 11, 21, "pen"));
browser.flushFrames();
assert.equal(device.queue.submissions.length, submissionsWhileSuppressed,
  "nessuna draw GPU mentre il tratto e in corso");
canvas.dispatchEvent(pointerEvent("pointerup", 11, 21, "pen", 0));
browser.flushFrames();
assert.equal(overlay.hidden, false, "la preview ricompare al pointerup");

canvas.dispatchEvent(pointerEvent("pointerdown", 12, 22, "pen", 0));
const submissionsBeforeDelayedFrame = device.queue.submissions.length;
browser.advanceTimersBy(400);
assert.equal(overlay.hidden, true,
  "il timeout deve nascondere la preview anche con un frame ancora in coda");
browser.flushFrames();
assert.equal(overlay.hidden, true,
  "un frame iPad in ritardo non deve far riapparire la preview congelata");
assert.equal(device.queue.submissions.length, submissionsBeforeDelayedFrame,
  "il frame gia accodato deve essere annullato quando scattano i 400 ms");
canvas.dispatchEvent(pointerEvent("pointerup", 12, 22, "pen", 0));
browser.flushFrames();
assert.equal(overlay.hidden, false,
  "dopo la soppressione il pointerup deve ancora riattivare la preview");

snapshot = {
  kind: "shape",
  outline: highFrequency,
  diameterCssPixels: 10,
  viewRotationRadians: 0,
  followsStroke: false,
};
controller.notifyEngineUpdate();
browser.flushFrames();
const complexUploads = alphaBoundaryUploads().length;
const buffersAfterComplexCompile = device.buffers.length;
for (let index = 0; index < 500; index += 1) {
  canvas.dispatchEvent(pointerEvent("pointermove", 20 + index / 10, 30, "mouse"));
  browser.flushFrames();
}
assert.equal(alphaBoundaryUploads().length, complexUploads,
  "500 movimenti non devono ricaricare ne ritessellare una shape complessa");
assert.equal(device.buffers.length, buffersAfterComplexCompile,
  "il percorso caldo aggiorna solo 32 byte di uniformi e una draw");

activeTool = "fill";
controller.notifyEngineUpdate();
browser.flushFrames();
assert.equal(overlay.hidden, true, "l'outline deve sparire fuori dai tool brush");
controller.dispose();
assert.ok(device.buffers.every((buffer) => buffer.destroyed),
  "dispose deve liberare tutti i buffer GPU della preview");
assert.equal(context.unconfigureCalls, 1);

const shapeResourcesStart = resourcesSource.indexOf(
  "export async function createShapeMaskResources(",
);
const shapeResourcesEnd = resourcesSource.indexOf(
  "export function destroyShapeMaskResources(",
  shapeResourcesStart,
);
const shapeResourcesSource = resourcesSource.slice(shapeResourcesStart, shapeResourcesEnd);
const polarityIndex = shapeResourcesSource.indexOf(
  "if (authoredInvert !== shapeInvert)",
);
const polarityMutationIndex = shapeResourcesSource.indexOf(
  "scalar16[index] = 65535 - scalar16[index]",
  polarityIndex,
);
const boundaryIndex = shapeResourcesSource.indexOf(
  "buildBrushMaskOutline(baseMask",
  polarityMutationIndex,
);
const uploadIndex = shapeResourcesSource.indexOf(
  "const texture = await createR16FloatShapeTexture(",
  boundaryIndex,
);
assert.ok(
  shapeResourcesStart >= 0
    && shapeResourcesEnd > shapeResourcesStart
    && polarityIndex >= 0
    && polarityMutationIndex > polarityIndex
    && boundaryIndex > polarityMutationIndex
    && uploadIndex > boundaryIndex,
  "outline e texture WebGPU devono usare la stessa maschera post-polarita",
);
assert.match(
  shapeResourcesSource,
  /const value = quantizeSource\(scalar16\[index\]\)/,
  "l'outline deve derivare dal campo scalar16 dopo la polarita",
);
assert.match(
  shapeResourcesSource,
  /const texture = await createR16FloatShapeTexture\(\s*engine,\s*scalar16,\s*sourceWidth,\s*sourceHeight,\s*sourceLabel,\s*shapeMaskFormat,\s*\)/,
  "la texture R16F deve ricevere lo stesso campo scalar16 post-polarita dell'outline",
);
assert.match(engineSource, /getBrushOutlineSnapshot\(\): BrushOutlineSnapshot/);
assert.match(engineSource, /getBrushOutlineGpuTarget\(\): BrushOutlineGpuTarget \| null/);
assert.match(engineSource, /this\.shapeLoadedAssetId === shapeAssetIdForSettings\(this\.settings\)/);
assert.match(engineSource, /this\.shapeLoadedInvert === shapeInvertForSettings\(this\.settings\)/);
assert.doesNotMatch(coreSource, /maxPool|FALLBACK_MAX|MAX_PRECISE/,
  "the boundary must not have a separate lossy path");
assert.doesNotMatch(
  controllerSource,
  /getImageData|buildBrushMaskOutline|requestPointerLock|CanvasRenderingContext2D|Path2D|getContext\("2d"/,
  "il puntatore deve usare WebGPU senza rileggere o rasterizzare l'alpha sulla CPU",
);
assert.match(controllerSource, /getContext\("webgpu"\)/);
assert.match(controllerSource, /GPUBufferUsage\.VERTEX/);
assert.match(controllerSource, /stepMode: "instance"/);
assert.match(controllerSource, /STROKE_OUTLINE_HIDE_DELAY_MILLISECONDS = 400/);
assert.match(coreSource, /outline\.boundingHull\.length/,
  "i guard min\/oversize devono scansire solo il convex hull in cache");
assert.doesNotMatch(coreSource, /document|window|HTMLCanvasElement|CanvasRenderingContext2D/,
  "l'estrazione della frontiera deve restare indipendente dal DOM");

assert.match(mainSource, /new BrushOutlineController\(\{[\s\S]*?overlay: brushOutlineCanvas/);
assert.doesNotMatch(mainSource, /brushOutlineController\?\.prepareGpuResources\(\)/);
assert.match(
  controllerSource,
  /private drawGpuOutline\([\s\S]{0,350}const resources = this\.ensureGpuResources\(\)/,
  "the brush outline must allocate GPU resources only when it is first drawn",
);
assert.match(registrySource, /"Brush preview"/,
  "il costo GPU della preview deve comparire come riga autonoma nel pannello memoria");
assert.match(mainSource, /brushOutlineController\?\.dispose\(\)/);
assert.match(htmlSource, /<canvas id="brushOutlineCanvas" aria-hidden="true" hidden><\/canvas>/);
assert.match(styleSource, /#brushOutlineCanvas \{[\s\S]*?pointer-events: none/);
assert.match(styleSource, /#brushOutlineCanvas \{[\s\S]*?mix-blend-mode: difference/);
assert.match(styleSource, /#gpuCanvas\.brush-outline-active \{\s*cursor: none/);
assert.equal(packageJson.scripts["brush-outline:verify"], "node scripts/verify-brush-outline.mjs");

console.log(
  "Brush outline verified: diagonal-contact topology, GPU-only pointer movement, Pencil, stroke hiding, and cache.",
);
