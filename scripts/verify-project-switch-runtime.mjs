import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const projectRuntime = readFileSync(
  new URL("../src/engine-project-runtime.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const cloneRuntime = readFileSync(
  new URL("../src/engine-clone-runtime.ts", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");

const resetStart = projectRuntime.indexOf(
  "export async function resetEngineToFreshProjectState",
);
const resetEnd = projectRuntime.indexOf(
  "/**\n * Restores a validated project",
  resetStart,
);
assert.ok(resetStart >= 0 && resetEnd > resetStart, "project reset runtime is present");
const reset = projectRuntime.slice(resetStart, resetEnd);

assert.match(
  engine,
  /documentGeneration = 1;[\s\S]*?resetToFreshProjectState\(\): Promise<number> \{\s*return resetEngineToFreshProjectState\(this\);/,
  "the long-lived engine owns the document generation and reset API",
);
assert.match(
  engine,
  /isDocumentGenerationCurrent\(generation: number\)[\s\S]*?generation === this\.documentGeneration[\s\S]*?this\.deviceLostError === null[\s\S]*?!this\.historyStateInconsistent/,
  "late document work has a fail-closed generation predicate",
);

assert.match(
  reset,
  /releaseShapePreviewPresentation\(\)[\s\S]*?clearMixedSceneRasterTransformPreview\(\)[\s\S]*?waitForDocumentScopedPreparation\(engine\)[\s\S]*?assertFreshProjectResetAllowed\(engine\)/,
  "structural previews and asynchronous preparation settle before the final gate",
);
assert.match(
  reset,
  /oldActiveGpu\.hot[\s\S]*?createColdLayerGpuResources\(\)[\s\S]*?freshGpu\.hot = reusableBlankHot/,
  "the active authoritative texture is reused as the fresh restore target",
);
assert.doesNotMatch(
  reset,
  /allocateLayerGpuResources\(/,
  "a project reset must not allocate a second full-size authoritative texture",
);
assert.match(
  reset,
  /documentGeneration \+ 1[\s\S]*?layerSwitchBusy = true[\s\S]*?cancelLayerColdCompressionIdle\(\)[\s\S]*?waitForColdCompressionCancellation\(engine\)[\s\S]*?waitForIdle\(\)/,
  "generation, mutation gate, compression cancellation and GPU idle form the reset gate",
);
assert.match(
  reset,
  /beginPresentationTransaction\(\)[\s\S]*?destructiveCommitStarted = true[\s\S]*?clearHotLayerForFreshProject\(engine, reusableBlankHot\)[\s\S]*?waitForGpuCapped/,
  "the last complete frame remains protected across the destructive clear fence",
);
assert.match(
  reset,
  /resetHistoryState\(\)[\s\S]*?resetDocumentScopedTransientState\(engine\)[\s\S]*?layers: \[freshRecord\][\s\S]*?referenceLayerId: null[\s\S]*?layerGpu\.set\(freshRecord\.id, freshGpu\)/,
  "history and document resources are replaced by one blank hot raster",
);
assert.match(
  reset,
  /new MixedSceneStack\(\[freshRecord\.id\]\)[\s\S]*?normalizeDocumentBackground\(undefined\)[\s\S]*?viewRotation = 0[\s\S]*?fitView\(\)[\s\S]*?activateLayer\(0, "layer-switch"\)/,
  "scene, background, view and active renderers are rebuilt for the blank project",
);
assert.match(
  reset,
  /latchDocumentStateInconsistent\([\s\S]*?presentationTransactionStarted[\s\S]*?completed \|\| !destructiveCommitStarted/,
  "post-clear failures stay non-editable and keep mixed presentation hidden",
);

assert.match(
  projectRuntime,
  /resetDocumentScopedTransientState[\s\S]*?destroyLightGlazeResources\(engine\)[\s\S]*?destroyThicknessTailOverlayResources\(\)[\s\S]*?fillRenderer\?\.releaseScratch\(\)[\s\S]*?blendRenderer\?\.releaseScratch\(\)[\s\S]*?resetPixelSelectionState\(engine\)[\s\S]*?clearVectorTextPresentation\(undefined, true\)/,
  "document-scoped scratch, carrier, selection and vector presentation are withdrawn",
);
assert.match(
  cloneRuntime,
  /export async function releasePreparedCloneSourceAndWait[\s\S]*?releasePreparedCloneSource\(engine\)[\s\S]*?const inFlight = state\.promise[\s\S]*?await inFlight[\s\S]*?destroyPreparedCloneSource\(engine, state\.ready\)/,
  "an in-flight Clone snapshot is invalidated and joined before layer destruction",
);

console.log("Project switch engine runtime verification passed.");
