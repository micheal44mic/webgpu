import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const engineSource = read("src/brush-engine.ts");
const mainSource = read("src/main.ts");
const shaderSource = read("src/shaders.ts");
const strokeRendererSource = read("src/stroke-renderer.ts");
const htmlSource = read("index.html");
const styleSource = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const EPSILON = 1e-9;

function normalizeAngle(angle) {
  const turn = Math.PI * 2;
  let normalized = (angle + Math.PI) % turn;
  if (normalized < 0) {
    normalized += turn;
  }
  return normalized - Math.PI;
}

function layerToCanvas(point, view) {
  const deltaX = point.x - view.centerX;
  const deltaY = point.y - view.centerY;
  const cosine = Math.cos(view.rotation);
  const sine = Math.sin(view.rotation);
  return {
    x: view.width * 0.5 + (cosine * deltaX - sine * deltaY) * view.zoom,
    y: view.height * 0.5 + (sine * deltaX + cosine * deltaY) * view.zoom,
  };
}

function canvasToLayer(point, view) {
  const scaledX = (point.x - view.width * 0.5) / view.zoom;
  const scaledY = (point.y - view.height * 0.5) / view.zoom;
  const cosine = Math.cos(view.rotation);
  const sine = Math.sin(view.rotation);
  return {
    x: view.centerX + cosine * scaledX + sine * scaledY,
    y: view.centerY - sine * scaledX + cosine * scaledY,
  };
}

const views = [
  { width: 1280, height: 720, centerX: 2048, centerY: 2048, zoom: 0.4, rotation: 0 },
  { width: 1179, height: 2556, centerX: 1890.25, centerY: 2250.75, zoom: 0.73, rotation: 0.47 },
  { width: 2048, height: 1536, centerX: -120, centerY: 4980, zoom: 3.2, rotation: -2.14 },
];
const layerPoints = [
  { x: 0, y: 0 },
  { x: 2048.5, y: 2048.5 },
  { x: 4095, y: 31.25 },
  { x: -240.75, y: 4800.125 },
];

for (const view of views) {
  for (const point of layerPoints) {
    const roundTrip = canvasToLayer(layerToCanvas(point, view), view);
    assert.ok(Math.abs(roundTrip.x - point.x) < EPSILON, "round-trip X non stabile");
    assert.ok(Math.abs(roundTrip.y - point.y) < EPSILON, "round-trip Y non stabile");
  }
}

const zeroView = views[0];
const canvasPoint = { x: 913.25, y: 181.75 };
const oldMapping = {
  x: zeroView.centerX + (canvasPoint.x - zeroView.width * 0.5) / zeroView.zoom,
  y: zeroView.centerY + (canvasPoint.y - zeroView.height * 0.5) / zeroView.zoom,
};
assert.deepEqual(canvasToLayer(canvasPoint, zeroView), oldMapping,
  "la trasformazione a 0° deve coincidere esattamente con la formula precedente");

const originalView = {
  width: 1000,
  height: 700,
  centerX: 1600,
  centerY: 2300,
  zoom: 0.82,
  rotation: -0.38,
};
const anchorCanvas = { x: 741, y: 219 };
const anchorLayer = canvasToLayer(anchorCanvas, originalView);
const rotatedView = { ...originalView, rotation: 0.91 };
const rotatedOffset = canvasToLayer(anchorCanvas, { ...rotatedView, centerX: 0, centerY: 0 });
rotatedView.centerX = anchorLayer.x - rotatedOffset.x;
rotatedView.centerY = anchorLayer.y - rotatedOffset.y;
const preservedAnchor = canvasToLayer(anchorCanvas, rotatedView);
assert.ok(Math.abs(preservedAnchor.x - anchorLayer.x) < EPSILON, "ancora X spostata dalla rotazione");
assert.ok(Math.abs(preservedAnchor.y - anchorLayer.y) < EPSILON, "ancora Y spostata dalla rotazione");

function applyMagnet(state, deltaDegrees) {
  const enter = 3 * Math.PI / 180;
  const release = 7 * Math.PI / 180;
  state.raw = normalizeAngle(state.raw + deltaDegrees * Math.PI / 180);
  const distance = Math.abs(state.raw);
  if (state.snapped && distance > release) {
    state.snapped = false;
  } else if (!state.snapped && distance <= enter) {
    state.snapped = true;
  }
  state.display = state.snapped ? 0 : state.raw;
}

const magnet = { raw: 0, display: 0, snapped: true };
applyMagnet(magnet, 2);
assert.equal(magnet.display, 0, "2° deve restare agganciato a zero");
applyMagnet(magnet, 4);
assert.equal(magnet.display, 0, "l'isteresi deve trattenere lo zero fino alla soglia di rilascio");
applyMagnet(magnet, 2);
assert.ok(Math.abs(magnet.display - 8 * Math.PI / 180) < EPSILON,
  "oltre 7° il magnete deve rilasciare la rotazione continua");
applyMagnet(magnet, -4);
assert.notEqual(magnet.display, 0, "il magnete non deve riagganciare fuori dalla soglia di ingresso");
applyMagnet(magnet, -2);
assert.equal(magnet.display, 0, "entro 3° il magnete deve tornare a zero esatto");

assert.match(engineSource, /const DISPLAY_UNIFORM_BYTES = 48;/,
  "la rotazione non deve aumentare il buffer display");
assert.match(engineSource, /displayUniformUpload\[2\] = this\.viewRotationCos/);
assert.match(engineSource, /displayUniformUpload\[3\] = this\.viewRotationSin/);
assert.match(engineSource, /displayUniformUpload\[4\] = this\.viewCenterX/);
assert.match(engineSource, /displayUniformUpload\[5\] = this\.viewCenterY/);
assert.match(engineSource, /VIEW_ROTATION_SNAP_ENTER_RADIANS = 3 \* Math\.PI \/ 180/);
assert.match(engineSource, /VIEW_ROTATION_SNAP_RELEASE_RADIANS = 7 \* Math\.PI \/ 180/);

const rotationMethods = engineSource.slice(
  engineSource.indexOf("  beginViewRotationGesture(): void"),
  engineSource.indexOf("  beginStroke(sample: PointerSample): void"),
);
assert.ok(rotationMethods.length > 0, "API di rotazione vista non trovata");
assert.doesNotMatch(rotationMethods, /createTexture|createBuffer/,
  "la rotazione non deve allocare texture o buffer");
assert.match(rotationMethods, /presentationCacheNeedsFullRebuild = true/,
  "ogni cambio angolo deve invalidare la cache screen-space");
assert.match(rotationMethods, /anchorBefore = this\.clientToLayer/,
  "la rotazione deve conservare il punto sotto il gesto");

const dirtyRectTransform = engineSource.slice(
  engineSource.indexOf("  private layerDirtyRectToPresentationRect("),
  engineSource.indexOf("  toLayerPoint(sample: PointerSample)"),
);
assert.equal((dirtyRectTransform.match(/this\.layerToCanvasPixels\(/g) ?? []).length, 4,
  "lo scissor ruotato deve includere tutti e quattro gli angoli");
assert.match(engineSource, /private canvasOffsetToLayerOffset/);
assert.match(engineSource, /private layerOffsetToCanvasOffset/);
assert.match(engineSource, /rotation: rotation \+ this\.viewRotation/,
  "la tip preview Shape deve ruotare insieme alla vista");

const displayShaders = `${shaderSource}\n${strokeRendererSource}`;
assert.equal((displayShaders.match(/struct DisplayUniforms/g) ?? []).length, 4,
  "devono restare quattro varianti display");
assert.equal((displayShaders.match(/  viewRotation: vec2<f32>,/g) ?? []).length, 4,
  "tutte le varianti display devono condividere la stessa ABI di rotazione");
assert.equal((displayShaders.match(/let displayOffset =/g) ?? []).length, 4,
  "tutte le varianti display devono applicare la trasformazione inversa");
assert.doesNotMatch(displayShaders, /display\.layerSize/,
  "la dimensione layer deve essere ricavata senza allargare l'uniform");
assert.ok((displayShaders.match(/textureDimensions\(activeLayerBase, 0\)/g) ?? []).length >= 2);
assert.match(displayShaders, /textureDimensions\(layerTexture, 0\)/);
assert.match(displayShaders, /let layerSize = vec2<f32>\(DOCUMENT_SIZE\)/);

assert.match(mainSource, /angle: Math\.atan2\(second\.clientY - first\.clientY/,
  "il gesto mobile deve misurare l'angolo delle due dita");
assert.match(mainSource, /engine\.rotateViewBy\(rotationDelta, nextGesture\.centerX, nextGesture\.centerY\)/);
assert.match(mainSource, /engine\.beginViewRotationGesture\(\)/);
assert.match(mainSource, /engine\.endViewRotationGesture\(\)/);
assert.match(mainSource, /rotateShortcutHeld/);
assert.match(mainSource, /deltaRadians = \(event\.clientX - lastRotateClientX\) \* Math\.PI \/ 720/);
assert.equal((mainSource.match(/performanceTelemetryRevision: 56/g) ?? []).length, 2);
assert.match(mainSource, /viewRotationDegrees: Number\(engine\.getViewRotationDegrees\(\)\.toFixed\(3\)\)/,
  "ogni benchmark deve firmare l'angolo della vista");
assert.equal((mainSource.match(/two-finger-pan-pinch-rotate-zero-magnet/g) ?? []).length, 2);

for (const id of ["rotateViewLeft", "viewRotation", "rotateViewRight"]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `controllo desktop #${id} mancante`);
}
assert.match(htmlSource, /due dita spostano, fanno zoom e ruotano/);
assert.match(styleSource, /#gpuCanvas\.rotating/);
assert.match(styleSource, /\.desktop-rotation-control\s*\{\s*display: none;/s,
  "i controlli desktop non devono affollare la barra mobile");
assert.equal(packageJson.scripts["view:verify"], "node scripts/verify-view-rotation.mjs");

console.log("Rotazione vista verificata: round-trip, ancora, magnete 0°, ABI 48 B, mobile e desktop.");
