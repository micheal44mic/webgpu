import { readEditorHtml } from "./ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const engineSource = readEngineSource();
const engineTypesSource = read("../src/engine-types.ts");
const brushDefinitionSource = read("../src/brush-definition.ts");
const historyTypesSource = read("../src/engine-history-types.ts");
const historyRuntimeSource = read("../src/engine-history-runtime.ts");
const mainSource = read("../src/main.ts");
const humanLabSource = read("../src/labs/human-stroke-lab.ts");
const htmlSource = readEditorHtml();
const sitesBuildSource = read("./prepare-sites-build.mjs");
const stabilizationCoreSource = read("../src/stroke-stabilization-core.ts");
const brushSettingsControllerSource = read("../src/brush-settings-controller.ts");
const brushStudioSource = read("../src/mobile-brush-studio.ts");
const brushSettingsRuntimeSource = read("../src/engine-brush-settings-runtime.ts");

// Settings ABI: normalized 0..1 and bit-for-bit legacy behavior at the default.
assert.match(engineTypesSource, /stabilization: number;/);
assert.match(brushDefinitionSource, /spacingPercent: 1,\s*stabilization: 0,/);
assert.match(
  brushSettingsRuntimeSource,
  /stabilization: clamp\(next\.stabilization \?\? engine\.settings\.stabilization, 0, 1\),/,
);

// Public control: Brush Studio owns the visible 0..100 editor and converts once.
assert.match(
  htmlSource,
  /id="mobileBrushStudioStabilizationOut"[\s\S]*?id="mobileBrushStudioStabilization" type="range" min="0" max="100" step="1" value="0"/,
);
assert.match(
  brushStudioSource,
  /bindRange\("mobileBrushStudioStabilization"[\s\S]*?draft\.stabilization = value \/ 100/,
);
assert.match(
  brushStudioSource,
  /setRange\("mobileBrushStudioStabilization"[\s\S]*?settings\.stabilization \* 100/,
);
assert.match(mainSource, /applyBrushSettings\(settings: Readonly<BrushSettings>\)/);
assert.match(brushSettingsControllerSource, /replace\(settings: Readonly<BrushSettings>\)/);
assert.doesNotMatch(mainSource, /rangeValue\("stabilization"\)/);

// Old recordings and every canonical benchmark path resolve to zero explicitly.
assert.match(
  humanLabSource,
  /function canonicalSettings\([\s\S]*?stabilization: 0,/,
);
assert.match(humanLabSource, /size: 750,[\s\S]*?spacingPercent: 1,[\s\S]*?stabilization: 0,/);
assert.match(sitesBuildSource, /payload\.settings\.stabilization === 0/);
assert.match(sitesBuildSource, /blendIntensity: 1,\s*stabilization: 0,/);

// Runtime contract: only public Paint glaze modes opt in, while 0% remains a
// hard branch around the pre-existing point generator.
assert.match(
  engineSource,
  /const stabilizer = tool === "paint"[\s\S]*?&& lightGlazeSettings[\s\S]*?&& lightGlazeSettings\.stabilization > 0/,
);
assert.match(
  engineSource,
  /if \(stroke\.stabilizer\) \{\s*this\.appendStabilizedPoint\(point, stroke, generationStart\);\s*return;\s*\}[\s\S]*?const start = stroke\.lastInput;/,
);
assert.match(
  stabilizationCoreSource,
  /const weight = isLatest\s*\? 0\s*:\s*strokeStabilizationSmoothstep\(ageMs \/ this\.tailDurationMs\);/,
);
assert.match(stabilizationCoreSource, /update\.tailWeight\[0\] = 1;/);
assert.match(
  engineSource,
  /const finalGeometry = endingStroke\.stabilizer\.finish\(\);[\s\S]*?for \(let index = 1; index < finalGeometry\.tailCount; index \+= 1\)/,
);

// Exact GPU revision order for non-invertible MAX/source-over deposits:
// restore the previous tail, draw newly mature stamps, snapshot the prefix,
// then draw the latest-only tail. Only authoritative `stamps` enter history.
const glazeSubmitStart = engineSource.indexOf("private submitLightGlazeImmediate(");
const glazeSubmitEnd = engineSource.indexOf("\n  submitImmediate(", glazeSubmitStart);
assert.ok(glazeSubmitStart >= 0 && glazeSubmitEnd > glazeSubmitStart);
const glazeSubmitSource = engineSource.slice(glazeSubmitStart, glazeSubmitEnd);
const restoreIndex = glazeSubmitSource.indexOf("{ texture: stabilizationRestoreTexture }");
const authoritativeDrawIndex = glazeSubmitSource.indexOf("if (stampCount > 0) {");
const prefixSnapshotIndex = glazeSubmitSource.indexOf(
  "{ texture: this.stabilizationSnapshotTexture }",
);
const previewDrawIndex = glazeSubmitSource.indexOf("this.encodeStabilizationTailFrame(");
const historyCaptureIndex = glazeSubmitSource.indexOf("this.encodePaintHistoryCapture(");
assert.ok(restoreIndex >= 0);
assert.ok(authoritativeDrawIndex > restoreIndex);
assert.ok(prefixSnapshotIndex > authoritativeDrawIndex);
assert.ok(previewDrawIndex > prefixSnapshotIndex);
assert.ok(historyCaptureIndex > previewDrawIndex);
assert.match(
  glazeSubmitSource.slice(historyCaptureIndex, historyCaptureIndex + 180),
  /this\.encodePaintHistoryCapture\(\s*encoder,\s*stamps,/,
);
assert.match(engineSource, /authoritativeDirtyRect: null,/);
assert.match(engineSource, /this\.noteLayerMutation\(authoritativeDirtyRect, false\);/);
assert.match(
  engineSource,
  /usage: GPUTextureUsage\.RENDER_ATTACHMENT[\s\S]*?GPUTextureUsage\.COPY_SRC[\s\S]*?GPUTextureUsage\.COPY_DST/,
);
assert.match(engineSource, /stabilizationTailMiB,/);

// Paint and Blend history retain the complete settings object and replay it,
// so the chosen stabilization value stays attached to the gesture even though
// the authoritative replay payload remains the already-generated GPU stamps.
assert.match(historyTypesSource, /interface PaintHistoryRenderBatch[\s\S]*?settings: BrushSettings;/);
assert.match(historyTypesSource, /interface BlendHistoryRenderBatch[\s\S]*?settings: BrushSettings;/);
assert.match(
  historyRuntimeSource,
  /engine\.submitBlendImmediate\([\s\S]*?batch\.settings,[\s\S]*?batch\.actionId/,
);
assert.match(
  historyRuntimeSource,
  /engine\.submitImmediate\([\s\S]*?batch\.settings,[\s\S]*?batch,/,
);

console.log("Stabilization UI/GPU/history verification passed.");
