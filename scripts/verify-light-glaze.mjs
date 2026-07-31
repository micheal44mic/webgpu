import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = readEngineSource();
const shaders = read("../src/shaders.ts");
const html = read("../index.html");

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Sezione iniziale assente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Sezione finale assente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const closeTo = (actual, expected, epsilon = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Atteso ${expected}, ricevuto ${actual}`,
  );
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const accumulateInsideGesture = (current, candidate) => (
  Math.max(clamp01(current), clamp01(candidate))
);
const sourceOverGesture = (destination, gesture) => {
  const source = clamp01(gesture);
  return source + clamp01(destination) * (1 - source);
};

for (const deposit of [0, 0.08, 0.25, 0.5, 0.73, 1]) {
  let gesture = 0;
  for (let index = 0; index < 4096; index += 1) {
    gesture = accumulateInsideGesture(gesture, deposit);
  }
  closeTo(gesture, deposit);
}

let varyingGesture = 0;
for (const candidate of [0.12, 0.31, 0.18, 0.72, 0.44]) {
  varyingGesture = accumulateInsideGesture(varyingGesture, candidate);
}
closeTo(varyingGesture, 0.72);

const oneGesture = 0.25;
const twoGestures = sourceOverGesture(oneGesture, oneGesture);
closeTo(twoGestures, 0.4375);
assert.ok(twoGestures > oneGesture, "Una gesture successiva deve potersi accumulare.");
closeTo(sourceOverGesture(0, 1), 1);
closeTo(sourceOverGesture(1, 1), 1);

assert(
  engine.includes('"light-r8-max-per-gesture-source-over-between-gestures"'),
  "Firma pubblica Light Glaze no-build-up assente.",
);

const modeRouting = section(
  engine,
  "function lightGlazeStrategyForBlendMode",
  "function usesStrokeGlazeRenderer",
);
assert.match(
  modeRouting,
  /if \(mode === "light-glaze"\) \{\s*return LIGHT_GLAZE_STRATEGY;/,
  "Light Glaze pubblico non ha una strategy distinta dal vecchio alias M1.",
);
assert.match(
  modeRouting,
  /return mode === "m1-glaze"\s*\? M1_GLAZE_STRATEGY\s*:\s*UNIFORMED_GLAZE_STRATEGY;/,
  "Routing legacy/uniformed non è esplicito.",
);

const storageRouting = section(
  engine,
  "export function lightGlazeStorageModeFor",
  "export function isTexturizedGrainActive",
);
assert.match(
  storageRouting,
  /blendMode === "light-glaze" \|\| blendMode === "m1-glaze"\s*\? "r8-coverage"/,
  "Light Glaze non usa l'accumulatore coverage R8 isolato per gesture.",
);

const maxPipeline = section(
  engine,
  "const createLightNoBuildUpPipeline",
  "const lightGlazeCompositeMipPipeline",
);
assert.equal(
  (maxPipeline.match(/operation: "max"/g) ?? []).length,
  2,
  "L'accumulatore Light deve usare MAX per colore e alpha.",
);
assert.doesNotMatch(
  maxPipeline,
  /one-minus-src-alpha/,
  "Gli stamp della stessa gesture non devono usare source-over.",
);
assert.match(maxPipeline, /format: "r8unorm"/);
assert.match(maxPipeline, /Light Glaze circle MAX per gesture r8unorm/);
assert.match(maxPipeline, /Light Glaze Texturized circle MAX per gesture r8unorm/);

const submit = section(
  engine,
  "private submitLightGlazeImmediate",
  "submitBlendImmediate",
);
for (const requirement of [
  'const lightNoBuildUp = settings.blendMode === "light-glaze"',
  'opacity: intenseBlending ? settings.opacity : 1',
  'intenseBlending ? 1 : settings.opacity',
  '"light-no-build-up"',
  "this.lightNoBuildUpPipeline",
  "this.lightNoBuildUpShapePipeline",
  "this.lightNoBuildUpShapeOccupancyPipeline",
  "this.grainLightNoBuildUpPipeline",
]) {
  assert(submit.includes(requirement), `Contratto submit Light assente: ${requirement}`);
}
assert.match(
  submit,
  /if \(session\.commitRequested\)[\s\S]*Commit complete Light Glaze stroke once/,
  "Light Glaze non viene committato una sola volta al lift.",
);

const finalComposite = section(
  engine,
  "const lightGlazeCompositePipeline =",
  "const lightGlazeCommitTilePipeline =",
);
assert.equal(
  (finalComposite.match(/one-minus-src-alpha/g) ?? []).length,
  2,
  "Il commit fra gesture deve essere source-over premoltiplicato.",
);
assert.match(finalComposite, /label: `Light Glaze final source-over composite/);

const beginStroke = section(engine, "beginStrokeAtLayer", "extendStroke(");
assert.match(beginStroke, /this\.startLightGlazeSession\(historyActionId, lightGlazeSettings\)/);
const endStroke = section(engine, "endStroke(timeMs?", "cancelStrokeBeforeRender");
assert.match(endStroke, /this\.lightGlazeSession\.endRequested = true/);
// Ancorato alla firma del metodo: il solo nome atterrerebbe in un commento
// JSDoc migliaia di righe prima, allargando la sezione a mezzo motore.
const renderFrame = section(engine, "  renderFrame(timestamp: number): void", "recordRenderedFrame(");
assert.match(
  renderFrame,
  /let hasPendingStampForGesture = false[\s\S]*for \(let index = batchSize;[\s\S]*commitRequested = lightGlazeSession\.endRequested[\s\S]*&& !hasPendingStampForGesture/,
  "Il commit Light deve attendere ogni stamp non incluso nel batch finale della gesture.",
);

assert.match(
  shaders,
  /coverage \* brush\.controls\.x \* brush\.baseHslAlpha\.w \* brush\.controls\.z/,
  "Flow non raggiunge il deposito candidato dello stamp.",
);
assert.match(shaders, /unpack4x8unorm\(pack4x8unorm\(vec4<f32>\(alpha\)\)\)\.r/);
assert.match(shaders, /fn storedLightCoverage\(value: f32\)/);
assert.match(
  shaders,
  /if \(lightGlaze\.accumulationMode == 1u\)[\s\S]*tintLinear\.rgb \* coverage, coverage\) \* opacity/,
  "Opacity non viene applicata una sola volta al risultato MAX della gesture.",
);

assert.match(html, /value="light-glaze">Light Glaze/);
assert.doesNotMatch(html, /value="m1-glaze"/);

console.log("Light Glaze contract verification passed.");
