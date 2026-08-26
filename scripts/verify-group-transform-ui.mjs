import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const workspaceRoot = fileURLToPath(root);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const main = read("src/main.ts");
const canvasTools = read("src/canvas-tool-controller.ts");
const layerPanel = read("src/layer-panel-controller.ts");
const controller = read("src/mixed-scene-controller.ts");
const vectorContract = read("src/vector-editor-contract.ts");
const contract = read("src/mixed-scene-controller-contract.ts");
const node = read("src/mixed-scene-node.ts");
const geometry = read("src/scene-transform-geometry.ts");
const overlay = read("src/scene-interaction-overlay.ts");
const historyTypes = read("src/engine-history-types.ts");
const historyRuntime = read("src/engine-history-runtime.ts");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `Missing section end after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const panelCallback = section(
  main,
  "  onMultiSelectionChange: ({ enabled, orderedKeys }) => {",
  "  canMergeMultiSelection:",
);

assert.match(
  layerPanel,
  /onMultiSelectionChange\?:[\s\S]*?LayerPanelMultiSelectionSnapshot/,
  "The layer panel must expose its multiple selection to the editor shell.",
);
assert.match(
  layerPanel,
  /private orderedSelectedKeys\([\s\S]*?selectionItems\(stats\)[\s\S]*?filter\(\(item\) => this\.selectedKeys\.has\(item\.key\)\)[\s\S]*?map\(\(item\) => item\.key\)[\s\S]*?private notifyMultiSelection\([\s\S]*?orderedSelectedKeys\(stats\)[\s\S]*?onMultiSelectionChange/,
  "The callback must publish every selected key in stable scene order.",
);
assert.match(
  panelCallback,
  /const transformKeys = enabled && orderedKeys\.length >= 2 \? orderedKeys : \[\]/,
  "Transform must activate only after at least two selected layers exist.",
);
assert.match(
  panelCallback,
  /if \(transformKeys\.length === 0\) \{[\s\S]*?setTransformSelection\(\[\]\);[\s\S]*?return;[\s\S]*?\}/,
  "Zero or one selected layer must clear the group instead of changing tools.",
);
assert.match(
  panelCallback,
  /initializeMixedSceneController\(\)\.then\(\(controller\) => \{[\s\S]*?controller\.setTransformSelection\(transformKeys\)[\s\S]*?selectCanvasToolWithMixedScene\("transform"\)/,
  "The group selection must reach the controller before Transform can prepare a raster session.",
);
assert.match(
  panelCallback,
  /controller\.setTransformSelection\(transformKeys\)/,
  "The exact callback keys must reach the Transform controller.",
);
assert.match(
  panelCallback,
  /const revision = \+\+layerMultiTransformSelectionRevision[\s\S]*?if \(revision !== layerMultiTransformSelectionRevision\) return;[\s\S]*?controller\.setTransformSelection\(transformKeys\)/,
  "A late controller initialization must not restore a stale multiple selection.",
);
assert.doesNotMatch(
  panelCallback,
  /merge|contiguous|adjacent|clippingParent|currentMergePlan|buildMobileLayerMergeSelectionPlan/i,
  "Transform selection must not inherit merge adjacency or clipping-group constraints.",
);

const toolExitCoordinator = section(
  main,
  "function canFinishLayerMultiSelection()",
  "const engine = new BrushEngine(",
);
const transformSettlement = section(
  main,
  "async function settleLayerMultiSelectionTransform()",
  "function leaveLayerMultiSelectionTransformTool()",
);
assert.match(
  toolExitCoordinator,
  /if \(!await settleLayerMultiSelectionTransform\(\)\) return false;[\s\S]*?if \(!leaveLayerMultiSelectionTransformTool\(\)\) return false;[\s\S]*?panel\.finishMultiSelection\(\)/,
  "Changing tools must settle the owned group and verify tool exit before closing multiple selection.",
);
assert.doesNotMatch(
  toolExitCoordinator,
  /mergeLayers|mergeSceneItems|requestMerge/,
  "Leaving multiple selection through a tool must never merge layers.",
);
assert.match(
  toolExitCoordinator,
  /if \(layerMultiSelectionFinishPromise\) return layerMultiSelectionFinishPromise;[\s\S]*?layerMultiSelectionFinishPromise = pending/,
  "Done and tool changes must share one completion owner.",
);
assert.match(
  main,
  /canChangeMultiSelection:[\s\S]*?canSettleLayerMultiSelectionTransform\(false\)[\s\S]*?prepareMultiSelectionChange: settleLayerMultiSelectionTransform,[\s\S]*?canMergeMultiSelection: canMergeLayerMultiSelection,[\s\S]*?prepareMultiSelectionMerge: prepareLayerMultiSelectionMerge,[\s\S]*?onMultiSelectionMergeStart:[\s\S]*?leaveLayerMultiSelectionTransformTool\(\)[\s\S]*?canFinishMultiSelection: canFinishLayerMultiSelection,[\s\S]*?requestFinishMultiSelection: finishLayerMultiSelectionForToolChange/,
  "The panel Done button must use the same exit coordinator as tool changes.",
);
assert.match(
  canvasTools,
  /activeCanvasTool === "transform"[\s\S]*?tool !== "transform"[\s\S]*?isMultiSelectionActive\(\)[\s\S]*?queueToolAfterMultiSelection/,
  "Every canvas-tool route must pass through the shared multiple-selection exit gate.",
);
assert.match(
  canvasTools,
  /pendingMultiSelectionTool = \{ tool, preserveToolSettings \}[\s\S]*?if \(this\.multiSelectionExitPromise\) return/,
  "Concurrent tool requests must share one completion and retain the latest target.",
);
const canvasToolLock = section(
  main,
  "function canvasToolSelectionLocked(): boolean {",
  "/**\n * Pan, zoom e rotazione",
);
assert.match(
  canvasToolLock,
  /isMultiSelect === true[\s\S]*?activeTool === "transform"[\s\S]*?action\?\.active === true \|\| action\?\.preparing === true/,
  "Canvas-tool buttons must remain reachable while a group is preparing or awaiting Apply.",
);
const controllerExitReadiness = section(
  main,
  "function canSettleLayerMultiSelectionTransform(requireApply: boolean): boolean {",
  "async function settleLayerMultiSelectionTransform(): Promise<boolean> {",
);
assert.match(
  controllerExitReadiness,
  /if \(!transformActionBelongsToLayerMultiSelection\(action, selection\)\) return false;[\s\S]*?if \(action\.preparing\) return true;/,
  "Only a Transform owned by the exact panel selection may keep its layer rows actionable.",
);
assert.match(
  controllerExitReadiness,
  /return requireApply \? action\.canApply : action\.canApply \|\| action\.canCancel;[\s\S]*?return action\.canCancel;/,
  "Done may recover by cancelling, while Merge requires Apply for an exact group.",
);
assert.match(
  controllerExitReadiness,
  /return !interactionLocked\(\);/,
  "An unrelated engine lock must not inherit the group-selection escape hatch.",
);
assert.match(
  layerPanel,
  /multiSelectButton\.disabled = this\.multiSelectEnabled[\s\S]*?canFinishMultiSelection\?\.\(\) === false[\s\S]*?: locked \|\| layerCount < 2/,
  "Done must remain available while the open group transaction owns the generic lock.",
);
assert.match(
  transformSettlement,
  /!await controller\.applyTransform\(\)[\s\S]*?recovery\.canCancel[\s\S]*?await controller\.cancelTransform\(\)/,
  "A failed Apply must use Cancel as the final recovery exit.",
);
assert.match(
  layerPanel,
  /canChangeMultiSelection\?: \(\) => boolean[\s\S]*?prepareMultiSelectionChange\?: \(\) => Promise<boolean>[\s\S]*?canMergeMultiSelection\?: \(\) => boolean[\s\S]*?prepareMultiSelectionMerge\?: \(\) => Promise<boolean>[\s\S]*?onMultiSelectionMergeStart\?: \(\) => Promise<boolean>/,
  "Selection changes and Merge must settle only the Transform lock they own.",
);
assert.match(
  layerPanel,
  /mergeRequestBusy = false[\s\S]*?prepareMultiSelectionMerge[\s\S]*?setMultiSelect\(false, false\)[\s\S]*?await this\.options\.onMultiSelectionMergeStart\(\)[\s\S]*?mergeLayers\(latestPlan\.orderedKeys\)/,
  "Merge must capture its exact selection, verify tool exit, then mutate the stack.",
);
assert.match(
  controller,
  /cancelledPendingRasterPointerGeneration[\s\S]*?await this\.cancelTransformSession\(\)/,
  "A release during async preparation must close the no-op transaction after preparation.",
);
assert.match(
  controller,
  /async cancelTransform\(\): Promise<boolean> \{[\s\S]*?if \(preparation\) await preparation;/,
  "Cancel must serialize behind an in-flight group preparation.",
);

const setSelection = section(
  controller,
  "  setTransformSelection(orderedKeys:",
  "  private transformNodeForGroupKey(",
);
assert.match(setSelection, /const uniqueKeys = \[\.\.\.new Set\(orderedKeys\)\]/);
assert.match(
  setSelection,
  /this\.requestedGroupTransformKeys = uniqueKeys\.length >= 2 \? uniqueKeys : \[\]/,
  "The controller must retain the exact requested two-or-more key set, even when it cannot currently form a group.",
);
assert.match(
  setSelection,
  /if \(!this\.transformSessionOpen\) \{[\s\S]*?this\.refreshGroupTransformSelection\(\)/,
  "A selection change during an open session must be recorded without replacing the transaction owner.",
);
assert.doesNotMatch(
  setSelection,
  /sort\(|splice\(|slice\(|merge|contiguous|adjacent|clippingParent/i,
  "The group-selection boundary must not fill gaps or add related layers.",
);

const groupCreation = section(
  controller,
  "  private createGroupTransformSelection(",
  "  private refreshGroupTransformSelection(",
);
assert.match(
  groupCreation,
  /const normalizedKeys = orderedKeys\.filter\(\(key\) => liveKeys\.has\(key\)\)/,
  "Only stale keys may be removed; non-adjacent live keys must remain exact.",
);
assert.match(groupCreation, /const members = normalizedKeys\.flatMap/);
assert.match(
  groupCreation,
  /members\.length < 2 \|\| members\.length !== normalizedKeys\.length/,
  "An exact selection must not silently drop empty or otherwise non-transformable layers.",
);
assert.match(
  groupCreation,
  /members\.reduce<SceneAxisAlignedBounds \| null>/,
  "The group must derive one bounding box from every selected member.",
);
for (const edge of ["left", "top", "right", "bottom"]) {
  const reducer = edge === "left" || edge === "top" ? "min" : "max";
  assert.match(
    groupCreation,
    new RegExp(`${edge}: Math\\.${reducer}\\(union\\.${edge}, next\\.${edge}\\)`),
    `The group bounding box must union its ${edge} edge.`,
  );
}
assert.match(groupCreation, /kind: "group-transform"/);
assert.match(groupCreation, /keys: normalizedKeys/);
assert.match(
  groupCreation,
  /localBounds: \{[\s\S]*?left: bounds\.left - x,[\s\S]*?top: bounds\.top - y,[\s\S]*?right: bounds\.right - x,[\s\S]*?bottom: bounds\.bottom - y/,
  "The one group box must be centered around the shared transform pivot.",
);
assert.match(
  controller,
  /if \(isSceneGroupTransformNode\(selectedTransformNode\)\) \{[\s\S]*?this\.metrics = \{ \.\.\.selectedTransformNode\.localBounds, baseline: 0 \}/,
  "The overlay must render the shared group box, not a member box.",
);
assert.match(node, /export interface SceneGroupTransformNode[\s\S]*?readonly keys:/);

const selectedTransformNode = section(
  controller,
  "  private selectedTransformNode()",
  "  private prepareSelectedRasterTransform()",
);
assert.match(
  selectedTransformNode,
  /if \(this\.requestedGroupTransformKeys\.length >= 2\) \{[\s\S]*?return this\.groupTransformSelection\?\.node \?\? null;/,
  "An invalid exact group must not silently fall back to the active single layer.",
);

const activation = section(
  controller,
  "  setTransformToolActive(",
  "  private updateTransformUi()",
);
assert.doesNotMatch(
  activation,
  /prepareSelectedRasterTransform|prepareSelectedGroupTransform/,
  "Selecting Transform must not eagerly open a raster or group transaction.",
);
assert.match(
  activation,
  /if \(!active && this\.transformSessionOpen\) \{[\s\S]*?this\.transformToolDeactivationPending = true;[\s\S]*?return false;/,
  "A rejected deactivation must be observable and queued until the owning session settles.",
);
const sceneSync = section(controller, "  syncScene(", "  scheduleViewSync()");
assert.doesNotMatch(
  sceneSync,
  /prepareSelectedRasterTransform|prepareSelectedGroupTransform/,
  "Scene synchronization must not eagerly open a Transform transaction.",
);
assert.match(
  vectorContract,
  /interface VectorTransformActionSnapshot[\s\S]*?toolActive: boolean;[\s\S]*?sessionKind: "vector" \| "raster" \| "group" \| null;[\s\S]*?selectionKeys: readonly string\[\];/,
  "The shell must be able to verify Transform tool, session, and exact selection ownership.",
);
assert.match(
  controller,
  /private async nudgeSelectedTransform\([\s\S]*?await this\.prepareSelectedGroupTransform\(\)[\s\S]*?await this\.prepareSelectedRasterTransform\(\)/,
  "Keyboard movement must lazily prepare its group or raster transaction.",
);
assert.match(
  controller,
  /const lazyPointerIntent = needsGroupPreparation \|\| needsRasterPreparation[\s\S]*?lazyTransformPointerIntent\(event, node\)[\s\S]*?lazyPointerIntent === null\) return;[\s\S]*?needsGroupPreparation[\s\S]*?lazyPointerIntent === "transform"[\s\S]*?resumeGroupPointerAfterPreparation[\s\S]*?needsRasterPreparation[\s\S]*?lazyPointerIntent === "transform"[\s\S]*?resumeRasterPointerAfterPreparation/,
  "Raster and group transactions must start only after the pointer targets a real transform gesture.",
);

assert.match(
  contract,
  /beginMixedSceneGroupTransform\([\s\S]*?orderedKeys:[\s\S]*?\): Promise<boolean>;[\s\S]*?updateMixedSceneGroupTransform\([\s\S]*?\): void;[\s\S]*?commitMixedSceneGroupTransform\(\): Promise<boolean>;[\s\S]*?cancelMixedSceneGroupTransform\(\): Promise<boolean>;/,
  "The host contract must expose the complete group transaction lifecycle.",
);
const preparation = section(
  controller,
  "  private async runGroupTransformPreparation(",
  "  private async runRasterTransformPreparation(",
);
assert.match(preparation, /beginMixedSceneGroupTransform\(orderedKeys\)/);
assert.match(
  preparation,
  /current\.orderedKeys\.some\(\(key, index\) => key !== orderedKeys\[index\]\)/,
  "An asynchronous begin must be cancelled if the exact selection changed.",
);
assert.match(preparation, /await this\.host\.cancelMixedSceneGroupTransform\(\)/);

const groupUpdate = section(
  controller,
  "  private updateGroupTransformNode(",
  "  private syncControlsFromSelection(",
);
assert.match(groupUpdate, /selection\.members\.map\(\(member\) =>/);
assert.match(groupUpdate, /key: member\.key/);
assert.match(groupUpdate, /this\.host\.updateMixedSceneGroupTransform\(updates\)/);

const apply = section(
  controller,
  "  private async applyTransformSession()",
  "  private async cancelTransformSession()",
);
assert.match(apply, /const groupSession = this\.transformSessionKind === "group"/);
assert.match(
  apply,
  /if \(groupSession\) \{[\s\S]*?await this\.host\.commitMixedSceneGroupTransform\(\)[\s\S]*?\} else if \(rasterSession\)/,
  "Apply must commit the group through one atomic host operation.",
);
const groupApplyBranch = section(apply, "      if (groupSession) {", "      } else if (rasterSession)");
assert.doesNotMatch(
  groupApplyBranch,
  /for \(|\.map\(|commitVectorHistoryEdit|commitRasterLayerTransform/,
  "Apply must not expose one history commit per selected member.",
);
assert.match(
  apply,
  /catch \(error\)[\s\S]*?if \(groupSession\) \{[\s\S]*?this\.transformSessionOpen = false;[\s\S]*?this\.transformSessionKind = null;/,
  "A rolled-back group Apply failure must not leave a stale UI session open.",
);

const cancel = section(
  controller,
  "  private async cancelTransformSession()",
  "  private abortActiveTransformInteraction()",
);
assert.match(cancel, /const groupSession = this\.transformSessionKind === "group"/);
assert.match(
  cancel,
  /groupSession[\s\S]*?await this\.host\.cancelMixedSceneGroupTransform\(\)[\s\S]*?: rasterSession/,
  "Cancel must restore the group through one atomic host operation.",
);
assert.match(
  historyTypes,
  /interface MixedSceneGroupTransformHistoryAction[\s\S]*?kind: "group-transform";[\s\S]*?vectors:[\s\S]*?rasters:/,
  "Undo/Redo must own every selected member in one group history action.",
);
const historyCommit = section(
  historyRuntime,
  "export function recordMixedSceneGroupTransformHistoryAction(",
  "export function captureMixedSceneOrderState(",
);
assert.match(historyCommit, /kind: "group-transform"/);
assert.equal(
  (historyCommit.match(/commitHistoryActionAtomically\(engine, action\)/g) ?? []).length,
  1,
  "One Apply must publish exactly one atomic history action.",
);

assert.match(
  geometry,
  /export type SceneTransformSideHandle =[\s\S]*?"north"[\s\S]*?"east"[\s\S]*?"south"[\s\S]*?"west"/,
  "Transform must expose four side-center handles.",
);
assert.match(overlay, /SCENE_TRANSFORM_SIDE_HANDLE_WIDTH_CSS_PX = 20/);
assert.match(overlay, /SCENE_TRANSFORM_SIDE_HANDLE_HEIGHT_CSS_PX = 6/);
assert.match(overlay, /function renderSceneBoundingBoxSideHandle[\s\S]*?context\.lineTo/);
assert.match(overlay, /SCENE_TRANSFORM_TOUCH_HIT_RADIUS_CSS_PX = 22/);
assert.match(
  overlay,
  /pointerType === "touch"[\s\S]*?SCENE_TRANSFORM_TOUCH_HIT_RADIUS_CSS_PX[\s\S]*?return \{ corner: radius, side: radius, rotation: radius \}/,
  "The small visual side handles must retain a larger touch target.",
);
assert.match(
  controller,
  /private touchInteractionAcceptsConstraint\([\s\S]*?interaction\.mode === "rotate"[\s\S]*?interaction\.mode === "scale"[\s\S]*?interaction\.handle === "north"[\s\S]*?interaction\.handle === "east"[\s\S]*?interaction\.handle === "south"[\s\S]*?interaction\.handle === "west"/,
  "Only rotation and side handles may consume the second touch as a transform modifier.",
);
assert.match(
  controller,
  /private sideScaleUpdate\([\s\S]*?centered: boolean[\s\S]*?sceneSideScaleUpdate\([\s\S]*?centered,/,
  "Side resizing must forward the desktop or touch center constraint to geometry.",
);
assert.match(
  controller,
  /event\.pointerId === this\.touchTransformModifierPointerId[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/,
  "The modifier touch must never contribute coordinates to the transform.",
);
assert.match(
  controller,
  /this\.interactionCanvas\.classList\.add\(`is-\$\{mode\}`\);\s*this\.updateTransformUi\(\);/,
  "Starting a transform gesture must immediately lock Apply and tool changes.",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: workspaceRoot,
  server: { middlewareMode: true },
});
let MixedSceneController;
try {
  ({ MixedSceneController } = await moduleServer.ssrLoadModule(
    "/src/mixed-scene-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

function rasterSceneItem(id, bounds) {
  return {
    key: `raster:${id}`,
    kind: "raster",
    rasterLayerId: id,
    rasterLayerIndex: id - 1,
    rasterLayerName: `Layer ${id}`,
    rasterVisible: true,
    rasterOpacity: 1,
    rasterClippingParentId: null,
    rasterHasContent: bounds !== null,
    rasterContentBounds: bounds,
    rasterTransform: null,
    clippingParentKey: null,
  };
}

const emptyRasterKey = "raster:1";
const activeRasterKey = "raster:2";
const otherRasterKey = "raster:3";
const exactSelectionShell = Object.create(MixedSceneController.prototype);
Object.assign(exactSelectionShell, {
  host: {
    getPixelSelectionState: () => ({ selectedPixels: 0, bounds: null }),
  },
  snapshot: {
    selectedKey: activeRasterKey,
    activeRasterLayerId: 2,
    items: [
      rasterSceneItem(1, null),
      rasterSceneItem(2, { x: 20, y: 30, width: 40, height: 50 }),
      rasterSceneItem(3, { x: 90, y: 100, width: 30, height: 20 }),
    ],
  },
  transformToolActive: false,
  transformToolDeactivationPending: false,
  transformSessionOpen: false,
  transformSessionKind: null,
  requestedGroupTransformKeys: [],
  groupTransformSelection: null,
  rasterTransformPreparation: null,
  groupTransformPreparation: null,
  transformCommitBusy: false,
  activeInteraction: null,
  rasterTransformRecoveryOnly: false,
  interactionCanvas: {
    hidden: false,
    classList: { toggle() {} },
    setAttribute() {},
  },
  updateTransformUi() {},
  scheduleRender() {},
});
exactSelectionShell.setTransformSelection([emptyRasterKey, activeRasterKey]);
assert.deepEqual(
  exactSelectionShell.requestedGroupTransformKeys,
  [emptyRasterKey, activeRasterKey],
);
assert.equal(exactSelectionShell.groupTransformSelection, null);
assert.equal(
  exactSelectionShell.selectedTransformNode(),
  null,
  "an exact group containing the empty default layer must not fall back to the active raster",
);
assert.deepEqual(
  exactSelectionShell.getTransformActionSnapshot().selectionKeys,
  [emptyRasterKey, activeRasterKey],
);

exactSelectionShell.setTransformSelection([activeRasterKey, otherRasterKey]);
const openGroupOwner = exactSelectionShell.groupTransformSelection;
assert.ok(openGroupOwner, "two transformable layers must create the requested group");
exactSelectionShell.transformSessionOpen = true;
exactSelectionShell.transformSessionKind = "group";
exactSelectionShell.setTransformSelection([emptyRasterKey, activeRasterKey]);
assert.deepEqual(
  exactSelectionShell.requestedGroupTransformKeys,
  [emptyRasterKey, activeRasterKey],
  "selection changes must be retained while the previous group owns the transaction",
);
assert.equal(
  exactSelectionShell.groupTransformSelection,
  openGroupOwner,
  "an open group transaction must keep its original owner until it settles",
);
assert.deepEqual(
  exactSelectionShell.getTransformActionSnapshot().selectionKeys,
  [activeRasterKey, otherRasterKey],
  "the action snapshot must report the open session owner, not the deferred request",
);
exactSelectionShell.transformSessionOpen = false;
exactSelectionShell.transformSessionKind = null;
exactSelectionShell.refreshGroupTransformSelection();
assert.equal(
  exactSelectionShell.groupTransformSelection,
  null,
  "the latest exact selection must be reconciled immediately after the old session closes",
);
assert.equal(exactSelectionShell.selectedTransformNode(), null);
assert.deepEqual(
  exactSelectionShell.getTransformActionSnapshot().selectionKeys,
  [emptyRasterKey, activeRasterKey],
  "after settlement the action snapshot must expose the reconciled request",
);

exactSelectionShell.transformSessionOpen = true;
exactSelectionShell.transformSessionKind = "raster";
exactSelectionShell.setTransformSelection([activeRasterKey, otherRasterKey]);
assert.equal(
  exactSelectionShell.groupTransformSelection,
  null,
  "a pending group request must not replace a raster session owner",
);
assert.deepEqual(exactSelectionShell.getTransformActionSnapshot().selectionKeys, []);
assert.equal(exactSelectionShell.selectedTransformNode()?.layerId, 2);
exactSelectionShell.transformSessionOpen = false;
exactSelectionShell.transformSessionKind = null;
exactSelectionShell.refreshGroupTransformSelection();
assert.ok(
  exactSelectionShell.groupTransformSelection,
  "the pending group request must become active after the raster session settles",
);

let eagerRasterPreparations = 0;
const lazyActivationShell = Object.create(MixedSceneController.prototype);
Object.assign(lazyActivationShell, {
  host: { getMixedSceneSnapshot: () => null },
  transformToolActive: false,
  transformToolDeactivationPending: false,
  transformSessionOpen: false,
  transformSessionKind: null,
  rasterTransformToolMode: "affine",
  selectedTransformNode: () => ({ kind: "raster-layer", scope: "layer", mode: "affine" }),
  prepareSelectedRasterTransform: () => {
    eagerRasterPreparations += 1;
    return Promise.resolve();
  },
  interactionCanvas: {
    hidden: true,
    classList: { toggle() {} },
    setAttribute() {},
  },
  updateTransformUi() {},
  scheduleRender() {},
});
assert.equal(lazyActivationShell.setTransformToolActive(true), true);
assert.equal(
  eagerRasterPreparations,
  0,
  "activating Transform must not create a raster transaction before a real gesture",
);

let queuedCancelCalls = 0;
Object.assign(lazyActivationShell, {
  transformSessionOpen: true,
  transformSessionKind: "vector",
  transformCommitBusy: false,
  activeInteraction: null,
  rasterTransformRecoveryOnly: false,
  requestedGroupTransformKeys: [],
  groupTransformSelection: null,
  host: {
    getMixedSceneSnapshot: () => null,
    cancelVectorHistoryEdit: async () => {
      queuedCancelCalls += 1;
      return true;
    },
  },
  status: { textContent: "" },
  refreshGroupTransformSelection() {},
  syncControlsFromSelection() {},
  selectedVectorNode: () => null,
});
assert.equal(lazyActivationShell.setTransformToolActive(false), false);
assert.equal(lazyActivationShell.transformToolActive, true);
assert.equal(lazyActivationShell.transformToolDeactivationPending, true);
assert.equal(await lazyActivationShell.cancelTransformSession(), true);
assert.equal(queuedCancelCalls, 1);
assert.equal(lazyActivationShell.transformToolActive, false);
assert.equal(lazyActivationShell.transformToolDeactivationPending, false);

function touchEvent(pointerId) {
  return {
    pointerId,
    pointerType: "touch",
    clientX: pointerId * 10,
    clientY: pointerId * 12,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function touchShell(activeInteraction, options = {}) {
  let viewNavigationStarts = 0;
  const shell = Object.create(MixedSceneController.prototype);
  Object.assign(shell, {
    transformCommitBusy: false,
    rasterTransformRecoveryOnly: false,
    transformToolActive: true,
    activeInteraction,
    pendingRasterPointerId: options.pendingPointerId ?? null,
    pendingRasterPointerMove: null,
    touchContacts: new Map(options.contacts ?? [[1, { x: 10, y: 12 }]]),
    touchTransformModifierPointerId: options.modifierPointerId ?? null,
    touchNavigationActive: false,
    selectedTransformNode: () => ({}),
    interactionCanvas: {
      setPointerCapture() {},
    },
    enterTouchNavigation: () => {
      viewNavigationStarts += 1;
    },
  });
  return { shell, viewNavigationStarts: () => viewNavigationStarts };
}

const rotateTouch = touchShell({
  pointerId: 1,
  mode: "rotate",
  handle: "rotate",
});
rotateTouch.shell.onPointerDown(touchEvent(2));
assert.equal(rotateTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(rotateTouch.viewNavigationStarts(), 0);

const sideTouch = touchShell({
  pointerId: 1,
  mode: "scale",
  handle: "east",
});
sideTouch.shell.onPointerDown(touchEvent(2));
assert.equal(sideTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(sideTouch.viewNavigationStarts(), 0);

const modifierMove = touchEvent(2);
sideTouch.shell.onPointerMove(modifierMove);
assert.equal(modifierMove.defaultPrevented, true);
assert.equal(sideTouch.shell.activeInteraction.pointerId, 1);

const unsupportedTouch = touchShell({
  pointerId: 1,
  mode: "move",
  handle: null,
});
unsupportedTouch.shell.onPointerDown(touchEvent(2));
assert.equal(unsupportedTouch.shell.touchTransformModifierPointerId, null);
assert.equal(unsupportedTouch.viewNavigationStarts(), 1);

const pendingTouch = touchShell(null, { pendingPointerId: 1 });
pendingTouch.shell.onPointerDown(touchEvent(2));
assert.equal(pendingTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(pendingTouch.viewNavigationStarts(), 0);

const extraTouch = touchShell({
  pointerId: 1,
  mode: "rotate",
  handle: "rotate",
}, {
  contacts: [[1, { x: 10, y: 12 }], [2, { x: 20, y: 24 }]],
  modifierPointerId: 2,
});
extraTouch.shell.onPointerDown(touchEvent(3));
assert.equal(extraTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(extraTouch.viewNavigationStarts(), 0);

let releasePreparation;
const groupPreparationGate = new Promise((resolve) => {
  releasePreparation = resolve;
});
let preparedApplyCalls = 0;
const preparedApplyShell = Object.create(MixedSceneController.prototype);
Object.assign(preparedApplyShell, {
  groupTransformPreparation: groupPreparationGate,
  rasterTransformPreparation: null,
  transformSessionOpen: false,
  applyTransformSession: async () => {
    preparedApplyCalls += 1;
    return true;
  },
});
let preparedApplySettled = false;
const preparedApply = preparedApplyShell.applyTransform().then((result) => {
  preparedApplySettled = true;
  return result;
});
await Promise.resolve();
assert.equal(preparedApplySettled, false);
preparedApplyShell.transformSessionOpen = true;
releasePreparation();
assert.equal(await preparedApply, true);
assert.equal(preparedApplyCalls, 1);

let releaseCancelPreparation;
const cancelPreparationGate = new Promise((resolve) => {
  releaseCancelPreparation = resolve;
});
let preparedCancelCalls = 0;
const preparedCancelShell = Object.create(MixedSceneController.prototype);
Object.assign(preparedCancelShell, {
  groupTransformPreparation: cancelPreparationGate,
  rasterTransformPreparation: null,
  transformSessionOpen: false,
  cancelTransformSession: async () => {
    preparedCancelCalls += 1;
    return true;
  },
});
const preparedCancel = preparedCancelShell.cancelTransform();
await Promise.resolve();
preparedCancelShell.transformSessionOpen = true;
releaseCancelPreparation();
assert.equal(await preparedCancel, true);
assert.equal(preparedCancelCalls, 1);

let releaseEarlyPointerPreparation;
const earlyPointerPreparation = new Promise((resolve) => {
  releaseEarlyPointerPreparation = resolve;
});
let earlyPointerCancels = 0;
const earlyPointerShell = Object.create(MixedSceneController.prototype);
Object.assign(earlyPointerShell, {
  pendingRasterPointerId: null,
  pendingRasterPointerMove: null,
  pendingRasterPointerGeneration: 4,
  cancelledPendingRasterPointerGeneration: 4,
  transformSessionKind: null,
  activeInteraction: null,
  prepareSelectedGroupTransform: () => earlyPointerPreparation,
  cancelTransformSession: async () => {
    earlyPointerCancels += 1;
    return true;
  },
});
const earlyPointerResume = earlyPointerShell.resumeGroupPointerAfterPreparation(
  { pointerId: 31 },
  4,
);
await Promise.resolve();
earlyPointerShell.transformSessionKind = "group";
releaseEarlyPointerPreparation();
await earlyPointerResume;
assert.equal(earlyPointerCancels, 1);
assert.equal(earlyPointerShell.cancelledPendingRasterPointerGeneration, null);

let noGestureCancels = 0;
const noGestureShell = Object.create(MixedSceneController.prototype);
Object.assign(noGestureShell, {
  pendingRasterPointerId: 41,
  pendingRasterPointerMove: null,
  pendingRasterPointerGeneration: 7,
  cancelledPendingRasterPointerGeneration: null,
  transformSessionOpen: false,
  transformSessionKind: null,
  activeInteraction: null,
  prepareSelectedGroupTransform: async function prepareGroup() {
    this.transformSessionOpen = true;
    this.transformSessionKind = "group";
  },
  onPointerDown() {
    // Deliberately leave activeInteraction empty: the pointer hit no handle or body.
  },
  cancelTransformSession: async () => {
    noGestureCancels += 1;
    return true;
  },
});
await noGestureShell.resumeGroupPointerAfterPreparation({ pointerId: 41 }, 7);
assert.equal(
  noGestureCancels,
  1,
  "a prepared group session must be cancelled when the resumed pointer creates no gesture",
);

let pointerFinishUiUpdates = 0;
const pointerFinishShell = Object.create(MixedSceneController.prototype);
const pointerInteraction = { pointerId: 17, mode: "move" };
Object.assign(pointerFinishShell, {
  pendingRasterPointerId: null,
  pendingRasterPointerMove: null,
  touchContacts: new Map(),
  touchTransformModifierPointerId: null,
  touchNavigationActive: false,
  activeInteraction: pointerInteraction,
  clearActiveInteraction(interaction) {
    if (this.activeInteraction === interaction) this.activeInteraction = null;
  },
  updateTransformUi() {
    pointerFinishUiUpdates += 1;
  },
  endViewGesture() {},
  restoreInteractionStart() {},
  closeNewNoopTransformSession() {},
  scheduleRender() {},
});
pointerFinishShell.finishPointer({
  pointerId: 17,
  pointerType: "mouse",
  type: "pointerup",
});
assert.equal(pointerFinishShell.activeInteraction, null);
assert.equal(
  pointerFinishUiUpdates,
  1,
  "releasing the pointer must immediately re-enable Apply and canvas-tool changes",
);

console.log(
  "Group Transform UI: exact ownership, lazy preparation, shared box, side handles and atomic Apply/Cancel verified.",
);
