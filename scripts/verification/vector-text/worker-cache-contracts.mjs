import assert from "node:assert/strict";
import { readRepositorySource } from "../source-contract.mjs";

const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const interactionOverlaySource = readRepositorySource("src/scene-interaction-overlay.ts");
const clientSource = readRepositorySource("src/vector-text-effect-client.ts");
const workerSource = readRepositorySource("src/vector-text-effect-worker.ts");
const workerProtocolSource = readRepositorySource("src/vector-text-effect-worker-protocol.ts");
const geometrySource = readRepositorySource("src/vector-text-effect-geometry.ts");
const fontGeometrySource = readRepositorySource("src/vector-text-font-geometry.ts");

assert.match(controllerSource, /if \(node\.outlineWidth > 0\) \{[\s\S]*kind: "source-outline"/);
assert.match(controllerSource, /if \(node\.blockShadowOutlineWidth > 0\) \{[\s\S]*kind: "block-outline"/);
assert.equal(
  (controllerSource.match(/Math\.hypot\(vector\.x, vector\.y\) > Number\.EPSILON/g) ?? []).length,
  2,
  "testo e SVG devono saltare la faccia Block Shadow completamente nascosta a offset zero",
);
assert.doesNotMatch(
  controllerSource,
  /Math\.hypot\(vector\.x, vector\.y\) <= Number\.EPSILON/,
);
assert.match(controllerSource, /node\.singleShadowBlur > 0[\s\S]*planMixedSceneSlugBlurDraw/);
assert.match(controllerSource, /else \{[\s\S]*planMixedSceneSlugDraw\(/);
assert.doesNotMatch(fontGeometrySource, /Path2D|canvasPath|buildShadow3dPath/);
assert.match(clientSource, /private activeRequestId: number \| null = null/);
assert.match(clientSource, /private readonly queuedBySlot = new Map/);
assert.match(clientSource, /this\.queuedBySlot\.set\(slotKey, queued\)/);
assert.match(clientSource, /desiredKeyBySlot\.values\(\)[\s\S]*desiredKey === response\.cacheKey/);
assert.match(clientSource, /requiresExactEffectLod[\s\S]*effect\.kind === "block"[\s\S]*effect\.kind === "block-outline"/);
assert.match(clientSource, /currentAlreadySuitable[\s\S]*current\.lodBucket === lod\.bucket[\s\S]*current\.lodBucket >= lod\.bucket/);
assert.match(clientSource, /if \(!currentAlreadySuitable\) \{[\s\S]*this\.requestEffect/);
assert.match(clientSource, /\|\| exactLod[\s\S]*ready\.lodBucket >= current\.lodBucket/);
assert.match(clientSource, /matchesRequestedIdentity: current\?\.effectIdentity === identity/);
assert.match(clientSource, /matchesRequestedLod: currentAlreadySuitable/);
assert.match(controllerSource, /!requireRequestedLod \|\| result\.matchesRequestedLod/);
assert.match(clientSource, /private readonly pinnedSlots = new Set<string>\(\)/);
assert.match(clientSource, /!liveSlots\.has\(slot\) && !this\.pinnedSlots\.has\(slot\)/);
assert.match(controllerSource, /slotNamespace = pinForRasterization \? "svg-raster" : "svg"/);
assert.match(controllerSource, /this\.effectCompiler\.pinSlot\(slotKey\)/);
assert.match(controllerSource, /finally \{[\s\S]*releasePinnedSlot\(slot\)/);
assert.doesNotMatch(clientSource, /displayed\.sourceRevision !== sourceRevision/);
assert.match(clientSource, /MAXIMUM_READY_EFFECT_CACHE_ENTRIES = 48/);
assert.match(clientSource, /MAXIMUM_REGISTERED_PATHS = 128/);
assert.match(clientSource, /protectedRevisions/);
assert.match(clientSource, /type: "release-path"/);
assert.match(workerProtocolSource, /ReleaseVectorTextPathMessage/);
assert.match(workerSource, /message\.type === "release-path"[\s\S]*paths\.delete/);
assert.match(controllerSource, /displayedDrawsByNodeKey/);
assert.match(controllerSource, /if \(allEffectsReady\) \{[\s\S]*else if \(displayedDraws\)/);
assert.match(controllerSource, /retargetMixedSceneDraws\(displayedDraws, node\)/);
assert.match(controllerSource, /dataset\.atomicEffectPendingNodes/);
assert.match(workerSource, /postMessage\([\s\S]*mesh\.vertices\.buffer[\s\S]*mesh\.indices\.buffer/);
assert.match(geometrySource, /const MITER_LIMIT = 4/);
assert.match(geometrySource, /Il contratto richiede bevel, non square/);
assert.match(geometrySource, /exactCrossSign\(vectorX, vectorY, edgeX, edgeY\) <= 0/);
assert.match(geometrySource, /canonicalSetFromPaths\(pieces\)/);
assert.match(geometrySource, /ClipType\.Difference/);
assert.match(geometrySource, /ClipType\.Intersection/);
assert.match(geometrySource, /overlapPieces/);
assert.match(geometrySource, /triangulationDeviation > 1e-8/);
assert.match(geometrySource, /if \(quantized\.length >= 3\)/);

const textCornersStart = interactionOverlaySource.indexOf("export function sceneOverlayCorners(");
const textCornersEnd = interactionOverlaySource.indexOf(
  "export function sceneOverlayRotationHandle(",
  textCornersStart,
);
assert.ok(textCornersStart >= 0 && textCornersEnd > textCornersStart);
const textCornersSource = interactionOverlaySource.slice(textCornersStart, textCornersEnd);
assert.doesNotMatch(textCornersSource, /blockShadow|singleShadow|outlineWidth|blur/);
assert.match(controllerSource, /effectLodForNode[\s\S]*Math\.abs\(node\.scale \* view\.zoom\)/);
assert.match(controllerSource, /!this\.host\.isPaintStrokeActive\(\)/);
