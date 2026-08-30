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
const reconfigureStart = projectRuntime.indexOf(
  "export async function reconfigureEngineForDocumentSwitch",
);
assert.ok(reconfigureStart > resetStart, "cross-dimension runtime is present");
const reconfigure = projectRuntime.slice(reconfigureStart, resetEnd);

assert.match(
  engine,
  /documentGeneration = 1;[\s\S]*?resetToFreshProjectState\(\): Promise<number> \{\s*return resetEngineToFreshProjectState\(this\);/,
  "the long-lived engine owns the document generation and reset API",
);
assert.match(
  engine,
  /resetForDocumentSwitch\(width: number, height: number\): Promise<number> \{[\s\S]*?this\.reusableBlendPlanner = null;[\s\S]*?return reconfigureEngineForDocumentSwitch\(this, width, height\);/,
  "the engine exposes a cross-dimension document boundary",
);
assert.match(
  engine,
  /isDocumentGenerationCurrent\(generation: number\)[\s\S]*?generation === this\.documentGeneration[\s\S]*?this\.deviceLostError === null[\s\S]*?!this\.historyStateInconsistent/,
  "late document work has a fail-closed generation predicate",
);

assert.match(
  reset,
  /releaseShapePreviewPresentation\(\)[\s\S]*?clearMixedSceneRasterTransformPreview\(\)[\s\S]*?waitForDocumentScopedPreparation\(engine\)[\s\S]*?assertFreshProjectResetAllowed\(engine, options\)/,
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

assert.match(
  reconfigure,
  /validateDocumentDimensions\(width, height, \{ allowLegacy4096: true \}\)[\s\S]*?width === engine\.documentWidth[\s\S]*?resetEngineToFreshProjectState\(engine\)/,
  "cross-dimension reset validates the target and preserves the same-size fast path",
);
assert.match(
  reconfigure,
  /reconfigureDocumentDimensions\(width, height, \{ allowLegacy4096: true \}\)[\s\S]*?recreateLayerResources[\s\S]*?reuseResidentPrograms: true[\s\S]*?releaseDocumentResourcesBeforeAllocation: true/,
  "cross-dimension reset keeps programs resident and releases verified source resources first",
);
assert.match(
  reconfigure,
  /beginPresentationTransaction\(\)[\s\S]*?resetEngineToFreshProjectState\(engine, \{\s*parentPresentationTransactionActive: true,\s*retainLayerSwitchBusyOnSuccess: true,[\s\S]*?recreateLayerResources[\s\S]*?completed = true[\s\S]*?if \(completed\) \{\s*engine\.layerSwitchBusy = false;[\s\S]*?engine\.endPresentationTransaction\(\)/,
  "an outer presentation transaction must cover reset, resource destruction and dimensional rebuild",
);
assert.match(
  projectRuntime,
  /expectedPresentationDepth = options\.parentPresentationTransactionActive === true \? 1 : 0[\s\S]*?presentationTransactionDepth !== expectedPresentationDepth/,
  "only the internal cross-size path may enter reset with one presentation owner",
);
assert.match(
  projectRuntime,
  /waitForDocumentScopedPreparation[\s\S]*?fillRenderer\?\.waitForPrewarm\(\)[\s\S]*?releasePreparedCloneSourceAndWait/,
  "Fill prewarming must settle before its source view becomes document-stale",
);
assert.match(
  reconfigure,
  /latchDocumentStateInconsistent\([\s\S]*?Reload before continuing/,
  "a failed destructive dimension replacement remains fail-closed",
);

console.log("Project switch engine runtime verification passed.");
