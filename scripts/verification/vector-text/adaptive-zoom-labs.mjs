import assert from "node:assert/strict";
import {
  VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
  VECTOR_TEXT_ZOOM_C_START_ZOOM,
  VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
} from "../../../src/vector-text-adaptive-zoom.ts";
import { readRepositorySource } from "../source-contract.mjs";

const mixedCompositorSource = readRepositorySource("src/mixed-scene-compositor-shader.ts");
const mainSource = readRepositorySource("src/main.ts");
const editorLabsSource = readRepositorySource("src/labs/editor-labs.ts");
const vectorZoomLabSource = readRepositorySource("src/labs/vector/vector-zoom-labs.ts");
const sitesBuildSource = readRepositorySource("scripts/prepare-sites-build.mjs");
const vectorZoomMigrationSource = readRepositorySource(".openai/drizzle/0005_vector_zoom_runs.sql");

assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_START_ZOOM/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_TARGET_ZOOM/);
assert.match(vectorZoomLabSource, /__vectorZoomCoverageReport/);
assert.match(vectorZoomLabSource, /fallbackProbeAlphaPixelCounts/);
assert.match(vectorZoomLabSource, /fastCompositeProbeAlphaPixelCounts/);
assert.match(vectorZoomLabSource, /finalFastFrameAcknowledged/);
assert.match(vectorZoomLabSource, /initialRasterWasEmpty/);
const coverageFunctionStart = vectorZoomLabSource.indexOf("async function runVectorZoomCoverage");
const coverageFunctionEnd = vectorZoomLabSource.indexOf("async function runVectorZoomAb", coverageFunctionStart);
assert.ok(coverageFunctionStart >= 0 && coverageFunctionEnd > coverageFunctionStart);
const coverageFunctionSource = vectorZoomLabSource.slice(coverageFunctionStart, coverageFunctionEnd);
const rasterLifecycleIndex = coverageFunctionSource.indexOf('engine.addLayer("C raster lifecycle")');
const beginCoverageGestureIndex = coverageFunctionSource.indexOf("controller.beginViewGesture()");
assert.ok(rasterLifecycleIndex >= 0 && beginCoverageGestureIndex > rasterLifecycleIndex);
assert.doesNotMatch(
  coverageFunctionSource.slice(rasterLifecycleIndex, beginCoverageGestureIndex),
  /captureVectorTextFallbackPresentation/,
  "C deve provare il rebuild production dopo addLayer senza autoripararsi manualmente",
);
assert.match(coverageFunctionSource, /automaticFallbackRebuildDelta/);
assert.match(coverageFunctionSource, /rasterLifecycleRebuiltFallback/);
assert.match(vectorZoomLabSource, /const duringTrace = controller\.getDiagnostics\(\)/);
assert.match(
  vectorZoomLabSource,
  /fastPresentationSubmitDelta =\s*duringTrace\.zoomFastPresentationSubmissionCount/,
  "il drain di verifica non deve migliorare retroattivamente la metrica dei 650 ms",
);
assert.match(vectorZoomLabSource, /fastSubmittedRevisionLagMaximum <= 2/);
assert.match(vectorZoomLabSource, /fastPresentationMaximumInFlight >= 1/);
assert.match(vectorZoomLabSource, /fastPresentationMaximumInFlight <= 2/);
assert.match(vectorZoomLabSource, /fastPresentationCoalescedDelta <= Math\.ceil\(sampleCount \* 0\.1\)/);
assert.match(vectorZoomLabSource, /finalFastAckDurationMs <= 250/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS/);
assert.match(vectorZoomLabSource, /\/api\/vector-zoom-runs/);
assert.match(vectorZoomLabSource, /runCode: report\.runCode/);
assert.match(editorLabsSource, /import\("\.\/vector\/vector-zoom-labs"\)/);
assert.doesNotMatch(mainSource, /__vectorZoom(?:Ab|Coverage|Stress)Report|\/api\/vector-zoom-runs/);
assert.match(sitesBuildSource, /handleVectorZoomRuns/);
assert.match(sitesBuildSource, /\/api\/vector-zoom-runs/);
assert.match(sitesBuildSource, /report\.passed !== VECTOR_ZOOM_CHECK_NAMES\.every/);
assert.doesNotMatch(
  sitesBuildSource,
  /report\.fallbackTextureCount !== 1|report\.exactRecoveryDelta !== 1/,
  "il backend deve salvare anche i report C falliti, non soltanto gli esiti verdi",
);
assert.match(vectorZoomMigrationSource, /CREATE TABLE IF NOT EXISTS vector_zoom_runs/);
assert.equal(
  (mixedCompositorSource.match(/return textureLoad\(sourceTexture, pixel, 0\);/g) ?? []).length,
  1,
  "il campionamento screen-space diretto deve esistere soltanto nel modo preciso",
);
